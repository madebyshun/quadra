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

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";

/** At this many zeros after the point (0.0000x) a small number switches to the subscript form. */
export const SUBSCRIPT_FROM = 4;

/**
 * A small-or-large positive number the way a DEX screen writes it (2026-10-22, the owner): grouped with
 * two decimals from 1 up; below 1, `sig` significant digits, TRUNCATED; and from four zeros after the
 * point, the zeros are COUNTED in a subscript — 0.00000299 is "0.0₅299", 4.09e-8 is "0.0₇409".
 * Never exponent form: "2.99e-6" reads as 2.99 to most people. A missing, non-finite or negative
 * number is "not read" — an amount on this page is never negative, so a negative one is a misread,
 * and printing it would be the misread as fact.
 */
export function compact(n: number | null | undefined, sig = 4): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return "not read";
  if (n === 0) return "0";
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  // "2.99000000e-6": the mantissa's digits, and how many zeros sit between the point and them
  const [mantissa, exp] = n.toExponential(sig + 3).split("e") as [string, string];
  const zeros = -Number(exp) - 1;
  // 0.99999999… rounds to "1.000…e+0" at this precision; truncated, it is still under one
  if (zeros < 0) return `0.${"9".repeat(sig)}`;
  const digits = mantissa.replace(".", "").slice(0, sig).replace(/0+$/, "");
  if (zeros < SUBSCRIPT_FROM) return `0.${"0".repeat(zeros)}${digits}`;
  const count = String(zeros)
    .split("")
    .map((d) => SUBSCRIPT[Number(d)])
    .join("");
  return `0.0${count}${digits}`;
}

/** An amount in a quote currency, "0.0₅299 AAPLc" — or "not read". */
export function quoteAmountText(n: number | null | undefined, symbol: string): string {
  const c = compact(n);
  return c === "not read" ? c : `${c} ${symbol}`.trim();
}

/**
 * An amount in the quote with its dollar value in front — and the dollar half DROPPED when it is under
 * a cent (zero included), so a line never reads "<$0.01" next to a number that already says how small it is.
 */
export function quoteWithUsd(n: number | null | undefined, symbol: string, quoteUsd: number | null): string {
  const q = quoteAmountText(n, symbol);
  if (q === "not read" || quoteUsd === null || !Number.isFinite(quoteUsd)) return q;
  const dollars = n! * quoteUsd;
  return dollars < 0.01 ? q : `${usd(dollars)} · ${q}`;
}

/** A unit price in dollars on a coin's page: `usd` from $1, the compact form below — "$0.0₇409". */
export function tinyPrice(value: number | null | undefined): string {
  const c = compact(value);
  if (c === "not read") return c;
  return value! >= 1 ? usd(value!) : `$${c}`;
}

/** A quote amount for prose: the same compact form (two decimals from 1 up, subscript zeros for dust). */
export function quoteWords(n: number): string {
  return compact(n);
}

export const explorer = {
  address: (a: string) => `${BASE.explorer}/address/${a}`,
  token: (a: string) => `${BASE.explorer}/token/${a}`,
  tx: (h: string) => `${BASE.explorer}/tx/${h}`,
};

/** Blockscout's own site for Base (the API in blockscout.ts lives under it) — a second explorer to check against. */
export const BLOCKSCOUT_SITE = "https://base.blockscout.com";
