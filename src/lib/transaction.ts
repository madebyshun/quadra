/**
 * Assembling the argument pair `ShieldedPool.transact` takes, in the browser.
 *
 * ── What this file is for ────────────────────────────────────────────────────
 * `transact(Proof, ExtData)` is the pool's only entry point, and every number in
 * those two structs has to be computed client-side: the amounts, the field encoding
 * of the amount, the hash that binds the payout details, and the public-input vector
 * the proof is checked against. Getting any of them wrong produces a transaction
 * that reverts (a bad afternoon) or — worse — one that is accepted with a proof
 * nobody can ever produce against it (lost money, no error).
 *
 * So this module mirrors four contract functions exactly, and says so at each one:
 * `publicAmountFor`, `fieldEncode`, `hashExtData` and `_publicInputs`. Where the
 * contract and the browser enforce the same rule, the browser enforces it **the
 * contract's way** — see the header of `lib/field.ts` for why a local shortcut that
 * happens to be correct is still the wrong choice here.
 *
 * ── The one thing this file cannot do, and does not pretend to ───────────────
 * 🔴 **`extDataHash` needs keccak-256, and a zero-dependency browser does not have
 * one.** `crypto.subtle` offers SHA-1, SHA-256, SHA-384 and SHA-512 — keccak is not
 * among them, and Ethereum's keccak-256 is not the same function as SHA-3-256
 * either (different padding), so there is no standards-track substitute. The pool
 * computes `uint256(keccak256(abi.encode(extData))) % FIELD_SIZE`, and nothing in
 * this repo can reproduce that number.
 *
 * Which is why `extDataHash` returns a **union** and not a bigint. The tempting
 * alternatives are all worse:
 *
 *   - hash it with SHA-256 instead → a number that is deterministic, in-field and
 *     collision-resistant, that every test would accept, and that the contract
 *     disagrees with. Exactly the `TestHasher` failure one layer up.
 *   - return `0n` when unavailable → a valid-looking field element, and the
 *     `input[2]` slot is precisely where a wrong value means "this proof is about a
 *     different recipient than the one being paid".
 *   - throw → the panel could not then show a user what is missing and why, and the
 *     rest of the vector is genuinely computable and worth showing.
 *
 * The union is the same device as `Anchoring` in `adapters/types.ts` and
 * `TaggedField` in `lib/note.ts`: the variant that cannot be proven carries a `why`
 * meant to be read by a person, and the type makes ignoring it impossible.
 *
 * ⚠️ A second, quieter cost of the same gap: **EIP-55 checksums cannot be verified
 * here.** The checksum is defined in terms of keccak over the lowercased address, so
 * `assertAddress` below can only check shape and length, not that a typo'd address
 * is a typo. When a keccak arrives, checking it becomes possible and should be done
 * — a mistyped recipient is an irreversible payment to nobody.
 *
 * ── Status: NOTHING IMPORTS THIS YET ─────────────────────────────────────────
 * ⚠️ Measured 2026-09-28: no file under `src/` outside this one imports this module, so
 * it is absent from the production bundle and no panel calls it. Written down because
 * the usual signals say the opposite — it is at 100% coverage with 41 tests and a
 * vector the Solidity suite asserts, which is what a wired-up module looks like.
 *
 * That is deliberate rather than abandoned: it is the piece T5/T6/T8 and the proof path
 * all need, and building it against the compiler now is cheaper than discovering the
 * encoding is wrong from inside a panel. But treat "the tests pass" as saying only that
 * the arithmetic agrees with the contract — **no transaction has ever been assembled
 * end to end**, and the first one will find whatever this file gets wrong about the
 * shape of a real spend rather than about a number.
 */

import { FIELD_MODULUS, MAX_NOTE_VALUE, intoField, isInField } from "@/lib/field";
import type { FieldHash } from "@/lib/hash";
import {
  type Commitment,
  type NoteSecrets,
  type Nullifier,
  type TaggedField,
  derivePaddingCommitment,
  newNoteSecret,
} from "@/lib/note";

/**
 * The external half of a transaction: who gets paid, and how much crosses the
 * pool's boundary. Mirrors `ShieldedPool.ExtData` field for field, in declaration
 * order, because that order is what `abi.encode` serialises.
 *
 * 🔴 There is deliberately **no `publicAmount` field**, exactly as in the contract.
 * It is derived by `publicAmountFor`. An earlier version of the contract took it as
 * calldata and that was a real insolvency — the fee was charged against the payout
 * on a withdrawal but against the pool on a deposit, so one field meant two things
 * depending on the sign of another. Adding it back here would recreate the same
 * defect from the client side: the browser could send a `publicAmount` that
 * disagreed with its own transfers.
 */
export type ExtData = {
  /** Where a withdrawal is paid. Ignored by the pool when `extAmount >= 0`. */
  readonly recipient: string;
  /** Who receives `fee`. Ignored by the pool when `fee == 0`. */
  readonly relayer: string;
  /**
   * What crosses the boundary on the user's behalf: positive deposits into the
   * pool, negative withdraws out of it, zero is a note-to-note transfer.
   */
  readonly extAmount: bigint;
  /** Paid to `relayer` on top of `extAmount`, never carved out of it. */
  readonly fee: bigint;
};

/**
 * `keccak256(abi.encode(extData)) % FIELD_SIZE`, or the reason it is missing.
 *
 * See the header. The `unavailable` variant is the honest state of this build, not
 * a transient error.
 */
export type ExtDataHash =
  | { readonly kind: "keccak256"; readonly value: bigint }
  | { readonly kind: "unavailable"; readonly why: string };

/**
 * A keccak-256 implementation: 32 bytes in, 32 bytes out.
 *
 * Injected rather than imported so that this module stays dependency-free and so the
 * day a real keccak arrives — a wasm module, a wallet RPC, or a vetted package —
 * nothing here changes shape. Same reasoning as `FieldHash` in `lib/hash.ts`.
 */
export type Keccak256 = (message: Uint8Array) => Uint8Array;

/** How many public inputs a proof is checked against. Mirrors `uint256[7]`. */
export const PUBLIC_INPUT_COUNT = 7;

/** The vector `IVerifier.verifyProof` takes, in the contract's order. */
export type PublicInputVector = readonly [
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
];

/**
 * A complete vector, or the list of reasons it could not be built.
 *
 * Plural `why` because a panel showing one blocker at a time makes a user fix them
 * one round-trip each, and in this build there is always at least the keccak one.
 */
export type PublicInputs =
  | { readonly kind: "complete"; readonly input: PublicInputVector }
  | { readonly kind: "incomplete"; readonly why: readonly string[] };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const WHY_NO_KECCAK =
  "this build has no keccak-256 — crypto.subtle offers only the SHA families, and " +
  "Ethereum's keccak-256 differs from SHA-3-256 in its padding, so extDataHash " +
  "cannot be computed here and no substitute would match the pool";

/**
 * Shape and length only, and the "only" is the point — see the ⚠️ in the header.
 *
 * Lowercases on the way out so that two spellings of one address cannot produce two
 * different ABI encodings and therefore two different `extDataHash` values for what
 * is meant to be the same transaction.
 */
export function assertAddress(value: string, label: string): string {
  if (!ADDRESS.test(value)) {
    throw new Error(
      `${label} is not a 20-byte hex address: "${value}". ` +
        "Chain plus address identifies a token or an account; a name or a ticker never does.",
    );
  }
  return value.toLowerCase();
}

/**
 * What the pool's balance changes by. Mirrors `ShieldedPool.publicAmountFor`.
 *
 * Both terms are bounded before the subtraction, in the same order and against the
 * same constant as the contract, so a value this function accepts is one `transact`
 * will not revert `AmountTooLarge` on. The derived result is bounded separately by
 * `fieldEncodeAmount`, again matching the contract — `MAX_NOTE_VALUE` applies to the
 * single field element the circuit sees, so a `extAmount` and `fee` that are each
 * legal can still be illegal together.
 *
 * JavaScript `bigint` is arbitrary-precision, so there is no overflow to guard here
 * the way the contract guards `int256`. The bounds are enforced anyway, because the
 * purpose is to agree with the contract rather than to protect the arithmetic.
 */
export function publicAmountFor(extData: ExtData): bigint {
  if (extData.fee < 0n) {
    throw new Error(`A fee cannot be negative, got ${extData.fee}. The pool's fee is a uint256.`);
  }
  if (extData.fee > MAX_NOTE_VALUE) {
    throw new Error(
      `A fee of ${extData.fee} is above the 2^248 bound the pool enforces (AmountTooLarge).`,
    );
  }
  const outward = magnitude(extData.extAmount);
  if (outward > MAX_NOTE_VALUE) {
    throw new Error(
      `An external amount of ${extData.extAmount} exceeds the 2^248 bound the pool ` +
        "enforces (AmountTooLarge).",
    );
  }
  return extData.extAmount - extData.fee;
}

/**
 * A signed amount as the field element the circuit sees. Mirrors
 * `ShieldedPool.fieldEncode`.
 *
 * Negative values become `FIELD_MODULUS - magnitude`, which is what subtraction
 * means inside the field — not a sign bit, and not a two's-complement pattern. An
 * encoding that used either would be a number the circuit reads as enormous and
 * positive, so a withdrawal would prove a deposit.
 *
 * The bound is re-applied rather than inherited from `publicAmountFor`, because that
 * function bounds its two inputs individually and their difference can reach
 * `-2·MAX_NOTE_VALUE`. One field element, one bound, checked where the element is
 * made.
 */
export function fieldEncodeAmount(amount: bigint): bigint {
  const size = magnitude(amount);
  if (size > MAX_NOTE_VALUE) {
    throw new Error(
      `${amount} does not fit the 2^248 bound on a single public amount ` +
        "(the pool reverts AmountTooLarge). Both extAmount and fee can be legal on their " +
        "own while their difference is not.",
    );
  }
  return amount >= 0n ? size : FIELD_MODULUS - size;
}

/**
 * `abi.encode(extData)` — 128 bytes, four static 32-byte words.
 *
 * ── Why this is written out rather than pulled from a library ─────────────────
 * It is the whole of what `abi.encode` does for this struct: every member is a
 * static type, so the encoding is the four head words concatenated with no offsets,
 * no length prefix and no tail. That is small enough to write correctly and pin
 * against the compiler, which `contracts/test/ShieldedPool.t.sol` does with a
 * checked-in 128-byte literal that `tests/transaction.test.ts` reads back out — one
 * vector, asserted from both sides, so neither can drift alone.
 *
 * Addresses are left-padded into the low 20 bytes. `extAmount` is two's complement
 * over 256 bits, which is what `int256` is on the wire — note this is the **only**
 * place a negative amount is encoded that way; `fieldEncodeAmount` above uses field
 * negation instead, and conflating the two encodings is the kind of mistake that
 * yields a verifying proof for the wrong transaction.
 */
export function abiEncodeExtData(extData: ExtData): Uint8Array {
  const recipient = assertAddress(extData.recipient, "recipient");
  const relayer = assertAddress(extData.relayer, "relayer");

  // Bounds first, so an out-of-range amount fails with a sentence rather than
  // silently wrapping into a valid-looking word.
  publicAmountFor(extData);

  const out = new Uint8Array(4 * 32);
  writeWord(out, 0, BigInt(recipient));
  writeWord(out, 1, BigInt(relayer));
  writeWord(out, 2, twosComplement256(extData.extAmount));
  writeWord(out, 3, extData.fee);
  return out;
}

/**
 * The binding hash, when something can compute it.
 *
 * `keccak` is nullable rather than optional so that a caller has to state that it
 * has none. An optional parameter would default to "no keccak" at exactly the call
 * site that forgot to pass one, and the failure would be a wrong `input[2]` rather
 * than a missing one.
 */
export function extDataHash(extData: ExtData, keccak: Keccak256 | null): ExtDataHash {
  const message = abiEncodeExtData(extData);
  if (keccak === null) return { kind: "unavailable", why: WHY_NO_KECCAK };

  const digest = keccak(message);
  if (digest.length !== 32) {
    throw new Error(
      `A keccak-256 digest must be 32 bytes, got ${digest.length}. ` +
        "A short digest folded into the field would be a valid-looking wrong answer.",
    );
  }

  let value = 0n;
  for (const byte of digest) value = (value << 8n) | BigInt(byte);
  /**
   * Folded, matching the contract's `% FIELD_SIZE`. Folding rather than truncating
   * so the top bits still affect the result — see `intoField` in `lib/field.ts`.
   */
  return { kind: "keccak256", value: intoField(value) };
}

/**
 * A note worth zero, with a secret nobody else will ever hold.
 *
 * 🔴 **The freshness is the entire point, and a constant here would be a
 * denial-of-service on the whole pool.** `transact` is 2-in/2-out and the shape is
 * not optional, so a transaction spending one real note still has to supply a second
 * nullifier. If that padding note had a fixed secret, its nullifier would be a fixed
 * number: the first transaction to use one burns it on chain, `nullifierSpent`
 * records it forever, and every later transaction needing a padding input reverts
 * `AlreadySpent` — for everyone, permanently, with the pool appearing to be broken
 * for no visible reason.
 *
 * It is also a privacy leak in the meantime: a recognisable constant nullifier
 * announces "this transaction used only one real input", which is a fact the 2-in
 * shape exists to hide.
 *
 * So this returns a new secret on every call and must never be memoised, cached, or
 * hoisted into a module constant.
 */
export function newPaddingNote(): NoteSecrets {
  return { amount: 0n, secret: newNoteSecret() };
}

/**
 * The padding note's commitment, for an unused output slot.
 *
 * Goes through `derivePaddingCommitment` because `deriveCommitment` refuses a zero
 * amount, and it is right to: a note a *user* holds worth zero means an amount went
 * missing. See `lib/note.ts`.
 */
export async function derivePaddingOutput(hash: FieldHash): Promise<Commitment> {
  return derivePaddingCommitment(hash, newPaddingNote());
}

/**
 * The vector the proof is checked against. Mirrors `ShieldedPool._publicInputs`.
 *
 * ── Why this refuses instead of returning a best effort ──────────────────────
 * Every element has to be a value the circuit agrees with. A vector containing one
 * stand-in-hashed commitment is not 6/7 correct — it is a statement about a
 * different note, and a proof against it would be a proof of something nobody
 * wanted. So a single unusable element makes the whole vector unusable, and the
 * union says which ones and why.
 *
 * The order is the contract's and is load-bearing: the circuit indexes this array
 * positionally, so swapping `input[3]` and `input[5]` yields a vector that is
 * well-formed, in-field, and about a transaction that does not exist.
 */
export function buildPublicInputs(args: {
  readonly root: TaggedField;
  readonly inputNullifiers: readonly [Nullifier, Nullifier];
  readonly outputCommitments: readonly [Commitment, Commitment];
  readonly extData: ExtData;
  readonly extDataHash: ExtDataHash;
}): PublicInputs {
  const why: string[] = [];

  const labelled: ReadonlyArray<readonly [string, TaggedField]> = [
    ["root", args.root],
    ["inputNullifier[0]", args.inputNullifiers[0]],
    ["inputNullifier[1]", args.inputNullifiers[1]],
    ["outputCommitment[0]", args.outputCommitments[0]],
    ["outputCommitment[1]", args.outputCommitments[1]],
  ];
  for (const [label, field] of labelled) {
    if (field.scheme === "stand-in") why.push(`${label}: ${field.why}`);
    if (!isInField(field.value)) {
      why.push(`${label} is not a field element (${field.value}) and no circuit can reference it`);
    }
  }

  /**
   * Narrowed into a local rather than re-tested at the bottom.
   *
   * ⚠️ Not a style preference — it is what makes the guard below **reachable in both
   * directions on every operand.** Written as one combined
   * `why.length > 0 || hash.kind !== "keccak256"` at the end, the second half can
   * never be the deciding factor, because an unavailable hash has already pushed a
   * blocker: the operand exists only to convince the type checker, no test can make
   * it decide anything, and the 100% branch gate would be met by a condition nobody
   * can exercise. Capturing the value here means each `=== null` below is the sole
   * reason for some real input, which is the only honest way to hold that gate.
   */
  let hashValue: bigint | null = null;
  if (args.extDataHash.kind === "keccak256") {
    hashValue = args.extDataHash.value;
  } else {
    why.push(`extDataHash: ${args.extDataHash.why}`);
  }

  /**
   * The amount is derived here rather than accepted, for the same reason the
   * contract derives it. A thrown bound error is reported as a blocker rather than
   * propagated, so a panel can show it beside the others instead of losing the
   * whole render to one bad field.
   */
  let encodedAmount: bigint | null = null;
  try {
    encodedAmount = fieldEncodeAmount(publicAmountFor(args.extData));
  } catch (error) {
    why.push(`publicAmount: ${messageOf(error)}`);
  }

  if (hashValue === null || encodedAmount === null || why.length > 0) {
    return { kind: "incomplete", why };
  }

  return {
    kind: "complete",
    input: [
      args.root.value,
      encodedAmount,
      hashValue,
      args.inputNullifiers[0].value,
      args.inputNullifiers[1].value,
      args.outputCommitments[0].value,
      args.outputCommitments[1].value,
    ],
  };
}

/**
 * Sanity checks the pool performs, restated where a user can read them.
 *
 * Not a substitute for the contract's own reverts — the contract is the authority
 * and these run before anything is signed. Each maps to a named revert so the two
 * cannot drift apart silently.
 */
export function describeExtDataProblems(extData: ExtData): readonly string[] {
  const problems: string[] = [];

  try {
    publicAmountFor(extData);
  } catch (error) {
    problems.push(messageOf(error));
  }

  // `_payOut` reverts RecipientIsZero, but only when money is actually leaving.
  if (extData.extAmount < 0n && extData.recipient.toLowerCase() === ZERO_ADDRESS) {
    problems.push(
      "A withdrawal needs a recipient — the pool reverts RecipientIsZero rather than " +
        "burning the payout.",
    );
  }

  // `_payFee` reverts RelayerIsZero, and only when a fee is actually charged.
  if (extData.fee > 0n && extData.relayer.toLowerCase() === ZERO_ADDRESS) {
    problems.push(
      "A fee needs a relayer — the pool reverts RelayerIsZero, because a fee sent to the " +
        "zero address would leave notes backed by tokens nobody can move.",
    );
  }

  return problems;
}

/**
 * A thrown value as a sentence a panel can render.
 *
 * ── Why this is exported, and why it is not inlined twice ────────────────────
 * Everything in this file throws `Error`, so the `String(error)` arm is unreachable
 * through any caller here. It is kept because a panel showing "undefined" beside a
 * user's money is a worse failure than a defensive line — and it is exported so a test
 * can reach that arm **directly**.
 *
 * The alternative was the version this replaced: `error instanceof Error ? … : …`
 * written out at both call sites, covered by handing `buildPublicInputs` an object
 * whose `fee` is a throwing getter. That test passed and was measuring nothing useful
 * — it asserted the behaviour of its own getter, and it broke as soon as the function
 * read `fee` a second time. A contrived object reaching for an unreachable branch is
 * how a 100% number stops meaning anything; one named function with two honest tests
 * is the same coverage and a true statement.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function magnitude(amount: bigint): bigint {
  return amount < 0n ? -amount : amount;
}

/** `int256` on the wire: the low 256 bits of the two's-complement representation. */
function twosComplement256(amount: bigint): bigint {
  const modulus = 1n << 256n;
  return ((amount % modulus) + modulus) % modulus;
}

function writeWord(out: Uint8Array, index: number, value: bigint): void {
  let remaining = value;
  for (let byte = 31; byte >= 0; byte--) {
    out[index * 32 + byte] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}
