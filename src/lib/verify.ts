import { BRAND } from "@/brand";
import { CONTRACTS } from "@/config/chain";
import { type AddressCheck, checkAddress, describeChecksum, hasAddressShape } from "@/lib/address";

/**
 * What the Verify box can honestly tell you without a network call.
 *
 * Recognising the shape of a string is local and certain. Confirming that a
 * transaction happened is neither — it needs an RPC and a deployed pool. So
 * this reports the shape, and says outright that the on-chain half is not
 * available yet. The alternative is a box that looks like it checked something.
 *
 * ── Why this file uses the shape check and not the checksum check ─────────────
 * ⚠️ This is the one deliberate caller of `hasAddressShape`, the shape-only predicate
 * `lib/address.ts` warns about. The reason is that this box's job is to **name what you
 * pasted**, and a bad-checksum string still *is* an address. Routing it through
 * `assertChecksummedAddress` would make it come back "not a hash, an address, or a note
 * from this site" — hiding the exact mistake the user opened this page to find.
 *
 * So it classifies on shape and reports the checksum **alongside**, which is strictly
 * more information than either check alone. The Verify box is now the one place in the
 * app that can catch a mistyped address without spending any money to find out.
 */

export type Recognized =
  | { kind: "empty" }
  | { kind: "txHash"; value: string }
  /**
   * Address-shaped. `checksum` carries the EIP-55 verdict, which is a separate question
   * from whether this is an address at all — a `mismatch` here is still an address,
   * and saying so is the point.
   *
   * ⚠️ `checksum.kind` can never be `malformed` in this position, because
   * `hasAddressShape` already passed. It is in the type anyway rather than being narrowed
   * away, because narrowing it would mean re-deriving the verdict here and the two
   * could then disagree.
   */
  | { kind: "address"; value: string; checksum: AddressCheck }
  | { kind: "note"; value: string }
  | { kind: "unrecognized"; value: string };

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export function recognize(raw: string): Recognized {
  const value = raw.trim();
  if (!value) return { kind: "empty" };
  if (TX_HASH.test(value)) return { kind: "txHash", value };
  if (hasAddressShape(value)) return { kind: "address", value, checksum: checkAddress(value) };
  if (value.startsWith(BRAND.notePrefix)) return { kind: "note", value };
  return { kind: "unrecognized", value };
}

/**
 * One line naming what it is, in the second person.
 *
 * The address case appends the checksum verdict rather than replacing the sentence,
 * because both facts matter and they answer different questions: "this is not the
 * transaction you meant to paste" and "this address may be mistyped".
 */
export function describe(r: Recognized): string {
  switch (r.kind) {
    case "empty":
      return "Nothing pasted.";
    case "txHash":
      return "That is a transaction hash: 32 bytes, the right shape for a Base transaction.";
    case "address":
      return (
        "That is an address, not a transaction. Paste the transaction that paid it. " +
        describeChecksum(r.checksum)
      );
    case "note":
      return "That is one of this site's notes. Keep it secret: it is the money.";
    case "unrecognized":
      return "That is not a hash, an address, or a note from this site.";
  }
}

/**
 * Whether the on-chain half of the check can run at all. False while the pool
 * is undeployed, and the UI must say so rather than showing an empty result.
 */
export function canCheckOnChain(): boolean {
  return CONTRACTS.shieldedPool !== null;
}
