import type { Note } from "@/adapters/types";

/**
 * A balance, out of the notes that make it up — so the Send window can show one
 * number and never ask anybody to pick a note.
 *
 * The notes are still there, underneath: they are what the pool spends, and what
 * a backup carries. What changed is who chooses among them. Asking the user to
 * pick "note 3 of 5" before paying someone was the pool's bookkeeping leaking
 * into the one decision they came to make, so the choice lives here instead.
 *
 * 🔴 One payment spends ONE note, and that is a real limit rather than a
 * shortcut to be papered over. The local pool's `send` takes a single note id;
 * the contract's `transact` takes two input nullifiers. So a balance of 7 + 5
 * cannot pay 10 in one go, and `largestPayment` is how the panel says so up
 * front instead of letting "12 available" promise it. Splitting a payment into
 * several transfers to the same recipient behind the user's back would hide
 * exactly the kind of on-chain pattern this product exists to avoid.
 */

/** The notes in one token. Compared case-blind: an address's case is a checksum, not an identity. */
export function inToken(notes: readonly Note[], address: string): Note[] {
  const wanted = address.toLowerCase();
  return notes.filter((n) => n.token.address.toLowerCase() === wanted);
}

/** Everything these notes hold, in base units. */
export function balanceOf(notes: readonly Note[]): bigint {
  return notes.reduce((sum, n) => sum + n.amount, 0n);
}

/** The most one payment can move: the largest single note, or zero with none. */
export function largestPayment(notes: readonly Note[]): bigint {
  return notes.reduce((max, n) => (n.amount > max ? n.amount : max), 0n);
}

/**
 * The note to spend for `amount`: the SMALLEST one that covers it, or `null`
 * when none does.
 *
 * Smallest, not largest, and not first. Spending the largest note on every
 * payment breaks the one big note into change over and over, until nothing is
 * left that can cover a big payment. Taking the tightest fit leaves the large
 * notes whole, and an exact fit leaves no change at all — which is also the
 * payment that leaves the least behind on chain.
 */
export function pickNote(notes: readonly Note[], amount: bigint): Note | null {
  let best: Note | null = null;
  for (const n of notes) {
    if (n.amount >= amount && (best === null || n.amount < best.amount)) best = n;
  }
  return best;
}
