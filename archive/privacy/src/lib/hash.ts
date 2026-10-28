/**
 * The field hash the note scheme is built on, and the reason there is no Poseidon
 * in this file.
 *
 * ── The trap this file is shaped to avoid ────────────────────────────────────
 * A note commitment is `H(...)` for some `H` that the circuit also computes. Get
 * `H` wrong and everything still works: commitments are deterministic, they land
 * in the field, they do not collide, the tree accepts them, the tests pass. The
 * only symptom is that **no proof can ever be produced for them**, because the
 * circuit computes a different `H` and therefore disagrees about which leaf the
 * note is. Money in, nothing out, no error.
 *
 * `contracts/test/doubles/TestHasher.sol` documents the same hazard from the
 * Solidity side, and `contracts/README.md` records it as one of the two most
 * dangerous files in the repo. This is that hazard's browser half.
 *
 * ── So why not just write Poseidon ───────────────────────────────────────────
 * Poseidon's round constants and MDS matrix are derived by a specified procedure
 * (a Grain LFSR, per the paper) for a specific field, width and round count. They
 * are not memorable and they are not guessable. Writing them from recall produces
 * a hash function that passes every property test in this file and matches no
 * circuit anybody will ever generate — which is to say it produces exactly the
 * failure described above, while looking like progress.
 *
 * 🔴 **Do not add a Poseidon implementation here from memory, from a blog post, or
 * from another chain's constants.** It must come with test vectors that are checked
 * in and that a generated circuit reproduces. Until then this module has no
 * Poseidon, and that absence is the honest state rather than a gap to plug.
 *
 * ── What exists instead ──────────────────────────────────────────────────────
 * `standInHash` — SHA-256, folded into the field. It is a real hash and the note
 * scheme is a real scheme on top of it, so the local pool's money model is the one
 * the on-chain pool will have. It is simply **not the hash any circuit uses**, and
 * it never will be: SHA-256 inside a SNARK costs tens of thousands of constraints,
 * which is why Poseidon exists at all.
 *
 * The `scheme` tag is how that stays true at the type level rather than in a
 * comment. It propagates into every commitment and nullifier derived from it — see
 * `lib/note.ts` — so a stand-in value cannot be handed to something expecting a
 * real one without the discriminant being handled first.
 */

import { FIELD_MODULUS, intoField, isInField } from "@/lib/field";

/**
 * Which hash produced a value.
 *
 * `"stand-in"` is not a lesser variant of `"poseidon"` — they are different
 * functions with different outputs for the same input, and a value from one is
 * meaningless to code expecting the other.
 */
export type HashScheme = "poseidon" | "stand-in";

export interface FieldHash {
  readonly scheme: HashScheme;
  /** Why this hash cannot be used in a circuit, or `null` when it can. */
  readonly whyNotCircuitReady: string | null;
  hash(domain: string, inputs: readonly bigint[]): Promise<bigint>;
}

const WHY_STAND_IN =
  "SHA-256 folded into the field — a real hash, but not the one any circuit " +
  "computes, so nothing hashed with it can ever be proven";

/**
 * Domain separation, and why it is a required argument rather than an option.
 *
 * A commitment and a nullifier are both `H` of a tuple containing the same secret.
 * Without a domain tag, a tuple that happens to line up produces a nullifier equal
 * to some commitment, and the pool cannot tell a spend from a deposit. Making the
 * tag mandatory means a new use of this hash has to name itself; an optional tag
 * would default to "no tag" at exactly the call site that forgot to think about it.
 */
function encodeDomain(domain: string): Uint8Array {
  if (!domain) throw new Error("A hash domain tag is required — see lib/hash.ts.");
  return new TextEncoder().encode(`quadra.v1.${domain}`);
}

/**
 * Field elements as fixed 32-byte big-endian words.
 *
 * Fixed width so that `H(1, 256)` and `H(256, 1)` cannot encode to the same bytes,
 * and so the same number always encodes the same way regardless of leading zeros.
 * A variable-width encoding here is the classic length-extension-shaped bug: it
 * fails rarely and looks like flakiness.
 */
function encodeInputs(inputs: readonly bigint[]): Uint8Array {
  if (inputs.length === 0) throw new Error("Cannot hash an empty input list.");

  const out = new Uint8Array(inputs.length * 32);
  inputs.forEach((input, index) => {
    if (!isInField(input)) {
      throw new Error(
        `Input ${index} is not a field element: ${input}. Fold it with intoField first, ` +
          "or find out why it is out of range — do not fold an amount.",
      );
    }
    let value = input;
    for (let byte = 31; byte >= 0; byte--) {
      out[index * 32 + byte] = Number(value & 0xffn);
      value >>= 8n;
    }
  });
  return out;
}

/**
 * SHA-256 over `domain || inputs`, folded into the field.
 *
 * Async because `crypto.subtle.digest` is, and because a real Poseidon in a browser
 * will most likely be async too (a wasm module has to load). Making the interface
 * async now means swapping the implementation later is not also an API change that
 * ripples through every caller.
 */
export const standInHash: FieldHash = {
  scheme: "stand-in",
  whyNotCircuitReady: WHY_STAND_IN,

  async hash(domain: string, inputs: readonly bigint[]): Promise<bigint> {
    const tag = encodeDomain(domain);
    const body = encodeInputs(inputs);

    const message = new Uint8Array(tag.length + body.length);
    message.set(tag, 0);
    message.set(body, tag.length);

    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", message));

    let value = 0n;
    for (const byte of digest) value = (value << 8n) | BigInt(byte);

    /**
     * A 256-bit digest folded into a ~254-bit field. `intoField` rather than a
     * mask: masking the top bits throws away entropy and, worse, makes the top
     * bits unable to affect the result at all, so two digests differing only up
     * there would collide.
     */
    return intoField(value);
  },
};

/**
 * Guard for the boundary where a stand-in value must not be allowed through.
 *
 * Called by anything that would put a value on chain or into a proof. It throws
 * with the hash's own `whyNotCircuitReady` sentence rather than a generic message,
 * so the reason reaches the user instead of only the stack trace.
 */
export function assertCircuitReady(hash: FieldHash): void {
  if (hash.whyNotCircuitReady !== null) {
    throw new Error(
      `This build cannot produce a provable note: ${hash.whyNotCircuitReady}. ` +
        "See lib/hash.ts — a real Poseidon is still missing.",
    );
  }
}

/** Exposed so a test can assert the fold target is the field and not a mask. */
export const HASH_FOLD_MODULUS = FIELD_MODULUS;
