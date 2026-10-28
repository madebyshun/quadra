import { formatAmount, parseAmount } from "@/lib/amount";
import { USDC } from "@/config/chain";
import { MAX_TOOL_PRICE_BASE_UNITS } from "@/lib/requirements";

/**
 * Spending limits the user sets, checked before anything signs.
 *
 * `lib/requirements.ts` already refuses what no user could mean — a wrong chain, a
 * permit2 method, a price over its hard ceiling. This is the other half: what THIS user
 * is willing to spend. It exists now, while every payment is still a click, because the
 * product is built for agents to pay (TASKS.md T6), and an agent that can pay without a
 * limit is a wallet with a hole in it. Built first so that the day an agent can sign, it
 * signs inside limits that were already tested against real clicks.
 *
 * ── What is counted, and why it is SIGNED and not settled ────────────────────
 * The ledger records every authorization this browser signed, at the moment it signed
 * it — before it is sent. An EIP-3009 authorization is a bearer instrument: once signed
 * it can be redeemed by whoever holds it until it expires, whether or not the call that
 * carried it succeeded. So the exposure is what was signed, and counting only settled
 * payments would let a run of failed calls sign past the daily limit with every one of
 * those signatures still redeemable.
 *
 * ── 🔴 An unreadable record fails CLOSED ─────────────────────────────────────
 * If the ledger cannot be read, the daily total is unknown, and "unknown" is not "zero".
 * `loadSpend` throws and the panel refuses to sign, saying why. The user can reset it —
 * deliberately, with the reason in front of them.
 */

/** A frozen identifier — see `PINS_KEY` in `lib/pins.ts`. */
export const SPEND_KEY = "quadra.spend.v1";

/** USDC base units. */
export type Limits = { readonly perPayment: bigint; readonly perDay: bigint };

/**
 * Anchored, not invented: the most expensive tool measured on either directory is
 * $1.00 (BlueAgent's `blue-audit`), and the typical x402 call is well under a cent. One
 * dollar a payment covers every measured price; five a day is five of the dearest.
 */
export const DEFAULT_LIMITS: Limits = { perPayment: 1_000_000n, perDay: 5_000_000n };

export type SignedPayment = {
  /** ms since epoch */
  readonly at: number;
  readonly value: bigint;
  readonly payee: string;
  /** what was paid for — a tool id or a URL */
  readonly resource: string;
};

export const DAY_MS = 86_400_000;

/** How long entries are kept. Longer than the window, so "last 24 h" is never short of data. */
const KEEP_MS = 7 * DAY_MS;

const usdc = (v: bigint) => `${formatAmount(v, USDC.decimals)} ${USDC.symbol}`;

/** What this browser signed in the 24 hours before `now`. */
export function signedInLastDay(ledger: readonly SignedPayment[], now: number): bigint {
  return ledger.filter((p) => p.at > now - DAY_MS).reduce((sum, p) => sum + p.value, 0n);
}

/** Why a payment of `value` may not be signed now, or `null` when it may. */
export function whyNotSpend(
  limits: Limits,
  ledger: readonly SignedPayment[],
  value: bigint,
  now: number,
): string | null {
  if (value > limits.perPayment) {
    return `This asks for ${usdc(value)}, above your limit of ${usdc(limits.perPayment)} per payment. Raise the limit if you mean it.`;
  }
  const spent = signedInLastDay(ledger, now);
  if (spent + value > limits.perDay) {
    return `You have signed ${usdc(spent)} in the last 24 hours, and this would take it past your daily limit of ${usdc(limits.perDay)}.`;
  }
  return null;
}

/**
 * Limits typed by a person, or a thrown sentence. Through `parseAmount`, like every
 * amount here (hard rule 7).
 *
 * The per-payment limit may not exceed the hard ceiling in `lib/requirements.ts`: a
 * limit the checker would refuse anyway is a setting that does nothing while looking
 * like it does something.
 */
export function parseLimits(perPayment: string, perDay: string): Limits {
  const one = parseAmount(perPayment, USDC.decimals);
  const day = parseAmount(perDay, USDC.decimals);
  if (one <= 0n || day <= 0n) {
    throw new Error("Limits must be above zero. To stop paying altogether, just don't press Run.");
  }
  if (one > MAX_TOOL_PRICE_BASE_UNITS) {
    throw new Error(
      `No single payment above ${usdc(MAX_TOOL_PRICE_BASE_UNITS)} is signed by this build at all, ` +
        "so a higher per-payment limit would never apply.",
    );
  }
  if (day < one) {
    throw new Error("The daily limit is below the per-payment limit, so the per-payment one could never be reached.");
  }
  return { perPayment: one, perDay: day };
}

type Stored = { limits: { perPayment: string; perDay: string }; ledger: { at: number; value: string; payee: string; resource: string }[] };

const WHOLE = /^\d+$/;

function decodeSpend(raw: string): { limits: Limits; ledger: SignedPayment[] } | null {
  let s: Stored;
  try {
    s = JSON.parse(raw) as Stored;
  } catch {
    return null;
  }
  if (typeof s !== "object" || s === null || typeof s.limits !== "object" || s.limits === null || !Array.isArray(s.ledger)) return null;
  const { perPayment, perDay } = s.limits;
  if (typeof perPayment !== "string" || typeof perDay !== "string" || !WHOLE.test(perPayment) || !WHOLE.test(perDay)) return null;
  const ledger: SignedPayment[] = [];
  for (const e of s.ledger) {
    if (
      typeof e !== "object" || e === null || typeof e.at !== "number" || typeof e.value !== "string" ||
      !WHOLE.test(e.value) || typeof e.payee !== "string" || typeof e.resource !== "string"
    ) {
      return null;
    }
    ledger.push({ at: e.at, value: BigInt(e.value), payee: e.payee, resource: e.resource });
  }
  return { limits: { perPayment: BigInt(perPayment), perDay: BigInt(perDay) }, ledger };
}

/** The limits and the ledger, defaults when nothing is stored, or a thrown reason. */
export function loadSpend(storage: Storage): { limits: Limits; ledger: SignedPayment[] } {
  const raw = storage.getItem(SPEND_KEY);
  if (raw === null) return { limits: DEFAULT_LIMITS, ledger: [] };
  const decoded = decodeSpend(raw);
  if (decoded === null) {
    throw new Error(
      "The record of what this browser has signed could not be read, so today's total is unknown " +
        "and nothing will be signed until it is reset. Resetting clears the record and restores the default limits.",
    );
  }
  return decoded;
}

/** Write both back, dropping entries older than a week. */
export function saveSpend(
  storage: Storage,
  limits: Limits,
  ledger: readonly SignedPayment[],
  now: number,
): SignedPayment[] {
  const kept = ledger.filter((p) => p.at > now - KEEP_MS);
  const stored: Stored = {
    limits: { perPayment: `${limits.perPayment}`, perDay: `${limits.perDay}` },
    ledger: kept.map((p) => ({ ...p, value: `${p.value}` })),
  };
  storage.setItem(SPEND_KEY, JSON.stringify(stored));
  return kept;
}

/** Throw away an unreadable record. Only ever on the user's explicit request. */
export function resetSpend(storage: Storage): void {
  storage.removeItem(SPEND_KEY);
}
