import { FEATURES, isEnabled } from "@/features/registry";
import { CONTRACTS } from "@/config/chain";

export type Badge = { text: string; tone: "ok" | "warn" | "neutral" };

/**
 * The badges on the desktop are derived, never typed by hand.
 *
 * Super Compute prints "13 tools tested" as a literal string. A literal is a
 * claim that rots the first time a tool breaks, and it can be wrong without
 * anything failing. These recompute, so the page cannot advertise something
 * that is not switched on.
 */
export function badges(): Badge[] {
  return [
    countBadge(FEATURES.filter(isEnabled).length, FEATURES.length),
    { text: "holds no key", tone: "ok" },
    poolBadge(CONTRACTS.shieldedPool !== null),
  ];
}

/** Takes its numbers, so the all-on wording is checked before everything is on. */
export function countBadge(on: number, total: number): Badge {
  return { text: `${on} of ${total} switched on`, tone: on === total ? "ok" : "neutral" };
}

/**
 * Taken as an argument rather than read from CONTRACTS, so the deployed wording
 * is checked now instead of first appearing on the day the pool goes live. This
 * badge is a claim about where proofs are made; it should not debut untested.
 */
export function poolBadge(deployed: boolean): Badge {
  return deployed
    ? { text: "proofs made in your browser", tone: "ok" }
    : { text: "local pool, not deployed yet", tone: "warn" };
}
