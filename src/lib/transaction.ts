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
 * ── `extDataHash` is real now, and the union that described its absence is gone ──
 * This file shipped on 2026-09-28 with an `ExtDataHash` union whose `unavailable` arm
 * carried a sentence explaining that the browser had no keccak-256, and an injected
 * `Keccak256` parameter for the day one arrived. `src/lib/keccak.ts` is that day, so
 * both are **deleted** rather than kept: a union with one inhabitable variant is a
 * `bigint` wearing a costume, and the sentence was a user-facing claim that the build
 * could no longer honour. An absence that has ended stops being a type.
 *
 * Kept from that design, because it was right about something else: the hash is folded
 * with `% FIELD_SIZE` and never truncated, and a digest of the wrong length throws
 * rather than being padded. `input[2]` is the slot where a wrong value means "this
 * proof is about a different recipient than the one being paid", so nothing may produce
 * a plausible number there.
 *
 * 🔴 **`buildPublicInputs` no longer accepts the hash — it derives it from the same
 * `extData` it is given.** That is not tidying. While it was a parameter, a caller
 * could pass `extData: A` alongside `extDataHash(B)`, and the result would be
 * well-formed, in-field, fully typed, and a statement about a transaction that is not
 * the one being sent. The only defence was that every call site remembered. Deriving it
 * deletes the entire class. Do not reintroduce the parameter for testability — pass a
 * different `extData` instead.
 *
 * ── EIP-55 is enforced here now, and the check happens BEFORE the lowercasing ────
 * `assertAddress` used to check shape and length only, then lowercase. It now delegates
 * to `assertChecksummedAddress` in `lib/address.ts`, which refuses a mixed-case address
 * whose EIP-55 checksum is contradicted.
 *
 * 🔴 **The order is the point, and reversing it would be invisible.** Lowercasing first
 * destroys the evidence: a mistyped mixed-case recipient becomes a well-formed lowercase
 * one, `abiEncodeExtData` encodes it canonically, `extDataHash` binds it, the proof
 * verifies, and the money is gone to an account nobody chose. Every check downstream of
 * the lowercasing passes, because by then there is nothing wrong with the string. This is
 * the same shape as the `extData: A` / `extDataHash(B)` hole above — a well-formed
 * statement about the wrong transaction — which is why both are fixed in the type rather
 * than in a comment asking call sites to be careful.
 *
 * ⚠️ An all-lowercase address still passes, and must: explorers hand those out, and
 * refusing them would make the app unusable. A lowercase address carries no checksum at
 * all, so `checkAddress` reports `unchecked` and a panel is expected to say so out loud
 * rather than imply it verified something. See `lib/address.ts`'s header for why that
 * distinction lives in the type and not in a boolean.
 *
 * ── Status: NOTHING IMPORTS THIS YET ─────────────────────────────────────────
 * ⚠️ Re-measured 2026-09-28 after the keccak rewiring: no file under `src/` outside this
 * one imports this module, so it is absent from the production bundle and no panel calls
 * it. Written down because the usual signals say the opposite — it is at 100% coverage
 * with a vector the Solidity suite asserts, which is what a wired-up module looks like.
 *
 * Note this module now *has* an import of its own (`lib/keccak`), which is the direction
 * that does not count: depending on something is not being depended upon. Re-grep for
 * `from "@/lib/transaction"` rather than trusting this paragraph.
 *
 * That is deliberate rather than abandoned: it is the piece T5/T6/T8 and the proof path
 * all need, and building it against the compiler now is cheaper than discovering the
 * encoding is wrong from inside a panel. But treat "the tests pass" as saying only that
 * the arithmetic agrees with the contract — **no transaction has ever been assembled
 * end to end**, and the first one will find whatever this file gets wrong about the
 * shape of a real spend rather than about a number.
 */

import { ZERO_ADDRESS, assertChecksummedAddress } from "@/lib/address";
import { FIELD_MODULUS, MAX_NOTE_VALUE, intoField, isInField } from "@/lib/field";
import type { FieldHash } from "@/lib/hash";
import { keccak256Uint } from "@/lib/keccak";
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
 * Plural `why` because a panel showing one blocker at a time makes a user fix them one
 * round-trip each. Until keccak landed there was always at least one blocker — the
 * missing hash — so `complete` was unreachable in practice; it is reachable now, which
 * is the whole point of the increment.
 */
export type PublicInputs =
  | { readonly kind: "complete"; readonly input: PublicInputVector }
  | { readonly kind: "incomplete"; readonly why: readonly string[] };

/**
 * Shape, EIP-55, and the canonical lowercase spelling, in that order.
 *
 * A thin pass-through to `assertChecksummedAddress` rather than a re-implementation, and
 * kept as a named export because three call sites below read better with `assertAddress`
 * in them. The lowercasing on the way out is what stops two spellings of one address
 * producing two different ABI encodings and therefore two different `extDataHash` values
 * for what is meant to be the same transaction — and it happens *after* the checksum
 * check, which is the ordering argument in the header.
 */
export function assertAddress(value: string, label: string): string {
  return assertChecksummedAddress(value, label);
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
 * The binding hash. Mirrors `ShieldedPool.hashExtData`:
 * `uint256(keccak256(abi.encode(extData))) % FIELD_SIZE`.
 *
 * `keccak256Uint` reads the digest **big-endian**, which is what `uint256(bytes32)`
 * means in Solidity and the opposite of how Keccak's own lanes are ordered. Both
 * directions are correct in their own place and conflating them yields a byte-reversed
 * field element that is in range, deterministic, and about nothing — see the
 * endianness tests in `tests/keccak.test.ts`.
 *
 * Folded with `%`, never truncated, so the high bits still affect the result — see
 * `intoField` in `lib/field.ts`. The 32-byte length check that used to guard an injected
 * implementation is gone with the injection: `keccak256` returns `DIGEST_BYTES` by
 * construction and `tests/keccak.test.ts` asserts it, so a check here would be an
 * unreachable branch against the 100% gate forever.
 */
export function extDataHash(extData: ExtData): bigint {
  return intoField(keccak256Uint(abiEncodeExtData(extData)));
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
   * Both derived here rather than accepted, for the same reason the contract derives
   * them: a value handed in is a value that can disagree with the `extData` beside it.
   * A thrown bound or shape error becomes a blocker rather than propagating, so a panel
   * can show it next to the others instead of losing the whole render to one bad field.
   *
   * ⚠️ **One `try` for both, and `extDataHash` first. Both halves of that are
   * load-bearing and neither is style.**
   *
   * One `try`: `abiEncodeExtData` calls `publicAmountFor` for its bounds, so two
   * separate catches would report an out-of-range amount **twice**, once under each
   * label, for a single mistake.
   *
   * This order: it is what keeps each `=== null` below independently able to decide the
   * guard, which is the only honest way to hold a 100% branch gate.
   *
   *   - a malformed address throws inside `extDataHash` → both stay null → the first
   *     operand decides.
   *   - an `extAmount` and `fee` that are **each** within 2^248 while their difference
   *     is not → `extDataHash` succeeds, `fieldEncodeAmount` throws → the second operand
   *     decides on its own.
   *
   * Swap the two assignments and that second case vanishes: `fieldEncodeAmount` would
   * throw before the hash was computed, so `encodedAmount === null` could never be the
   * sole reason and the branch would be covered by a condition nobody can exercise.
   */
  let hashValue: bigint | null = null;
  let encodedAmount: bigint | null = null;
  try {
    hashValue = extDataHash(args.extData);
    encodedAmount = fieldEncodeAmount(publicAmountFor(args.extData));
  } catch (error) {
    why.push(`extData: ${messageOf(error)}`);
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
