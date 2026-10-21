import { formatAmount } from "@/lib/amount";
import { BASE } from "@/config/chain";

/**
 * How numbers read on screen. DISPLAY ONLY — nothing here feeds a transaction; amounts a
 * person types still go through `parseAmount` (hard rule 7).
 */

/** `0x1234…abcd`. */
export function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * A token amount in base units, with thousands separators and at most `digits` decimal
 * places, TRUNCATED rather than rounded — a balance must never read as more than it is.
 * A non-zero amount that truncates to zero says `<0.0001`, not `0`.
 */
export function tokenAmount(raw: bigint, decimals: number, digits = 4): string {
  const exact = formatAmount(raw, decimals);
  const [whole = "0", frac = ""] = exact.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const kept = frac.slice(0, digits).replace(/0+$/, "");
  if (grouped === "0" && kept === "" && raw > 0n) return `<0.${"0".repeat(digits - 1)}1`;
  return kept ? `${grouped}.${kept}` : grouped;
}

/** Dollars: two decimals, `<$0.01` for dust, grouped. */
export function usd(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * A unit price. Unlike `usd`, a price below a cent is the normal case for a new token, so it
 * keeps four significant digits instead of collapsing to `<$0.01` — "$0.0000274" and
 * "$0.009" are different tokens.
 *
 * Written out in positional notation on purpose: `Number#toString` switches to exponent form
 * below 1e-6, and "$2.74e-8" is a price most people read as 2.74 dollars.
 */
export function price(value: number): string {
  if (value >= 1) return usd(value);
  return `$${value.toLocaleString("en-US", { maximumSignificantDigits: 4 })}`;
}

/** A quote amount for prose: two decimals from 1 up, four significant digits below. */
export function quoteWords(n: number): string {
  return n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}

export const explorer = {
  address: (a: string) => `${BASE.explorer}/address/${a}`,
  token: (a: string) => `${BASE.explorer}/token/${a}`,
  tx: (h: string) => `${BASE.explorer}/tx/${h}`,
};
