import { BRAND } from "@/brand";
import { CONTRACTS } from "@/config/chain";

/**
 * What the Verify box can honestly tell you without a network call.
 *
 * Recognising the shape of a string is local and certain. Confirming that a
 * transaction happened is neither — it needs an RPC and a deployed pool. So
 * this reports the shape, and says outright that the on-chain half is not
 * available yet. The alternative is a box that looks like it checked something.
 */

export type Recognized =
  | { kind: "empty" }
  | { kind: "txHash"; value: string }
  | { kind: "address"; value: string }
  | { kind: "note"; value: string }
  | { kind: "unrecognized"; value: string };

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function recognize(raw: string): Recognized {
  const value = raw.trim();
  if (!value) return { kind: "empty" };
  if (TX_HASH.test(value)) return { kind: "txHash", value };
  if (ADDRESS.test(value)) return { kind: "address", value };
  if (value.startsWith(BRAND.notePrefix)) return { kind: "note", value };
  return { kind: "unrecognized", value };
}

/** One line naming what it is, in the second person. */
export function describe(r: Recognized): string {
  switch (r.kind) {
    case "empty":
      return "Nothing pasted.";
    case "txHash":
      return "That is a transaction hash: 32 bytes, the right shape for a Base transaction.";
    case "address":
      return "That is an address, not a transaction. Paste the transaction that paid it.";
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
