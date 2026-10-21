/**
 * What a note commitment and a nullifier actually are.
 *
 * ── The bug this file replaces ───────────────────────────────────────────────
 * `LocalShieldedPool` used to set `commitment: randomHex(32)` — a random number
 * with no relationship to the note's amount or its secret. It passed every test,
 * because the only assertion was that it differed from the secret and any random
 * value does. But a commitment that commits to nothing is not a commitment: there
 * is no secret whose knowledge it proves, so the on-chain pool could never accept
 * one of those notes and no circuit could ever be written against them.
 *
 * That is the shape the header of `adapters/types.ts` warns about — a stub you
 * cannot tell from the real thing by looking at the output — except the type
 * system did not catch this one, because `commitment: string` accepts anything.
 * Hence the types below, where it does.
 *
 * ── What the scheme is, and what it is not ───────────────────────────────────
 *     commitment = H("note.commitment", [amount, secret])
 *     nullifier  = H("note.nullifier",  [secret, leafIndex])
 *
 * The commitment binds the amount and hides it behind the secret. The nullifier
 * identifies the note being spent without revealing which leaf it was, and
 * includes the leaf index so the same secret at two positions cannot produce one
 * nullifier. Different domain tags keep the two from ever colliding — see the note
 * on `encodeDomain` in `lib/hash.ts`.
 *
 * ⚠️ **This is the right shape, not the final scheme.** The real one is whatever a
 * generated circuit computes, and it will likely carry an owner public key so a
 * note can be sent to someone who did not create it. When the circuit lands, this
 * file changes to match **it**, not the other way around: the circuit is the
 * specification and this is the client that has to agree with it.
 */

import {
  assertNoteCapacity,
  assertNoteValue,
  isInField,
  randomFieldElement,
  toFieldHex,
} from "@/lib/field";
import type { FieldHash, HashScheme } from "@/lib/hash";

/**
 * A field element, tagged with the hash that produced it.
 *
 * Same asymmetry as `Anchoring` in `adapters/types.ts`, for the same reason: the
 * variant that cannot be proven carries a `why` and the one that can does not, so
 * code that needs a provable value must narrow the union and cannot simply ignore
 * a boolean. `why` exists to be shown to a user, not to be checked and discarded.
 */
export type TaggedField =
  | { scheme: "poseidon"; value: bigint }
  | { scheme: "stand-in"; value: bigint; why: string };

/**
 * Three names for one shape, and **TypeScript does not keep them apart** — these are
 * structurally identical, so a `Nullifier` is assignable wherever a `Commitment` is
 * wanted. The names are for whoever reads a signature, and they earn their keep there:
 * `deriveCommitment` returning `Commitment` says what it computed.
 *
 * Written as aliases rather than three copies of the union so that nobody can mistake
 * them for a type-level guarantee. What actually stops a nullifier being passed off as
 * a commitment is the **domain tag** in `lib/hash.ts`, which makes the two numbers
 * unrelated for the same inputs. The aliases document; the tag enforces.
 */
export type Commitment = TaggedField;
export type Nullifier = TaggedField;
export type TreeRoot = TaggedField;

/** The private half of a note. Never logged, never in a URL, never sent anywhere. */
export type NoteSecrets = {
  amount: bigint;
  secret: bigint;
};

const COMMITMENT_DOMAIN = "note.commitment";
const NULLIFIER_DOMAIN = "note.nullifier";

/**
 * A fresh note secret.
 *
 * `randomFieldElement` rejection-samples rather than folding, which matters here
 * specifically — this is the value an attacker would attack. See its comment.
 */
export function newNoteSecret(): bigint {
  return randomFieldElement();
}

/**
 * Tag a value with the scheme of the hash that produced it, in one place.
 *
 * Written as a single helper so the `why` sentence on a stand-in value comes from
 * the hash itself rather than being retyped at each call site. Two hand-written
 * copies of that sentence is how one of them ends up saying something reassuring.
 *
 * Exported because the commitment tree's root needs the same treatment and is not
 * derived in this file — a root computed from stand-in hashes matches no deployed pool,
 * and that has to travel with the number rather than be remembered about it. Takes the
 * whole `FieldHash` so a caller cannot pair one hash's scheme with another's reason.
 */
export function tagWithScheme(hash: FieldHash, value: bigint): TaggedField {
  return tagged(hash.scheme, hash.whyNotCircuitReady, value);
}

function tagged(
  scheme: HashScheme,
  whyNotCircuitReady: string | null,
  value: bigint,
): TaggedField {
  if (scheme === "poseidon") {
    /**
     * A `poseidon` tag with a `whyNotCircuitReady` reason is a contradiction: it
     * claims to be provable while carrying the reason it is not. Refusing here
     * rather than trusting the caller because this is the exact combination that
     * would let an unprovable value through the guard at the chain boundary.
     */
    if (whyNotCircuitReady !== null) {
      throw new Error(
        `A hash tagged "poseidon" cannot also say why it is not circuit-ready: ` +
          `${whyNotCircuitReady}`,
      );
    }
    return { scheme, value };
  }
  return {
    scheme,
    value,
    why: whyNotCircuitReady ?? "produced by a stand-in hash",
  };
}

export async function deriveCommitment(
  hash: FieldHash,
  note: NoteSecrets,
): Promise<Commitment> {
  /**
   * The amount is checked, never folded. `intoField` on an amount would turn
   * 2^248 + 1 tokens into 1 token and the receipt would read as perfectly normal —
   * see the warning on `intoField` in `lib/field.ts`.
   */
  assertNoteValue(note.amount);
  return commitmentOf(hash, note);
}

/**
 * The same commitment, for a note that is allowed to be worth zero.
 *
 * ── Why this is a second function and not a flag ─────────────────────────────
 * `deriveCommitment` refuses a zero amount and should keep refusing it: a note a
 * user holds worth nothing means an amount went missing upstream, and that is worth
 * a loud failure. But `ShieldedPool` is 2-in/2-out with no way to say "I only need
 * one output", so a withdrawal leaving no change still has to commit to something,
 * and the honest something is a real note worth zero.
 *
 * A boolean parameter on `deriveCommitment` would collapse the two, and the default
 * would be wrong at whichever call site forgot to think about it. Two names cost
 * nothing and make the padding case searchable — `lib/transaction.ts` is the only
 * caller, which is the property to preserve.
 */
export async function derivePaddingCommitment(
  hash: FieldHash,
  note: NoteSecrets,
): Promise<Commitment> {
  assertNoteCapacity(note.amount);
  return commitmentOf(hash, note);
}

async function commitmentOf(hash: FieldHash, note: NoteSecrets): Promise<Commitment> {
  assertSecret(note.secret);
  const value = await hash.hash(COMMITMENT_DOMAIN, [note.amount, note.secret]);
  return tagged(hash.scheme, hash.whyNotCircuitReady, value);
}

export async function deriveNullifier(
  hash: FieldHash,
  note: Pick<NoteSecrets, "secret">,
  leafIndex: number,
): Promise<Nullifier> {
  assertSecret(note.secret);
  if (!Number.isInteger(leafIndex) || leafIndex < 0) {
    throw new Error(`A leaf index must be a non-negative integer, got ${leafIndex}.`);
  }

  const value = await hash.hash(NULLIFIER_DOMAIN, [note.secret, BigInt(leafIndex)]);
  return tagged(hash.scheme, hash.whyNotCircuitReady, value);
}

/**
 * The public hex form, for display and for calldata.
 *
 * Takes the tagged type rather than a bare bigint so that the only way to get a
 * hex string is to have gone through a derivation. A `toFieldHex(someBigint)` call
 * sitting next to a note would work but would prove nothing about what the number
 * is; this way the string on screen is a value the scheme produced.
 */
export function commitmentHex(commitment: Commitment | Nullifier): string {
  return toFieldHex(commitment.value);
}

function assertSecret(secret: bigint): void {
  if (!isInField(secret)) {
    throw new Error(
      "A note secret must be a field element. Generate it with newNoteSecret() — " +
        "a value out of range here means it came from somewhere it should not have.",
    );
  }
  /**
   * Zero is in the field and is a catastrophic secret: it is the value an
   * uninitialised variable holds, so a bug that forgets to generate a secret
   * produces a note whose commitment anybody can recompute and whose nullifier
   * anybody can derive. Refusing it costs nothing and closes the whole class.
   */
  if (secret === 0n) {
    throw new Error(
      "A note secret of zero is what an uninitialised variable looks like. " +
        "Anybody could recompute that commitment — generate one with newNoteSecret().",
    );
  }
}
