/**
 * Treasury Basket's arithmetic (2026-11-13, the owner: "không bỏ idea Treasury Basket"). A basket is
 * a list of assets — Coinbase stocks and verified crypto on Base — each with a whole-percent weight
 * summing to 100. Buying it is one USDC swap per asset, into the buyer's OWN wallet: no index token,
 * no manager, no fee on the basket. What sets it apart from an index token (Bankr's, 2026-11-12) is
 * exactly that: the buyer holds the assets themselves.
 *
 * Pure: amounts are USDC base units (bigint) and never rounded up — what is left over by flooring
 * goes to the largest leg, so the legs always add up to exactly what was typed.
 */

export type BasketAsset = { readonly symbol: string; readonly address: string; readonly decimals: number; readonly kind: "stock" | "crypto" };
export type Leg = { readonly asset: BasketAsset; readonly weight: number };

/** Ready-made baskets, by TICKER — resolved against Coinbase's own list when the window opens (hard rule 2). */
export const PRESETS: readonly { readonly id: string; readonly name: string; readonly picks: readonly (readonly [string, number])[] }[] = [
  {
    id: "mag7",
    name: "MAG7, equal weight",
    picks: [
      ["AAPL", 15],
      ["AMZN", 15],
      ["GOOGL", 14],
      ["META", 14],
      ["MSFT", 14],
      ["NVDA", 14],
      ["TSLA", 14],
    ],
  },
  {
    id: "mag7-btc",
    name: "MAG7 + Bitcoin (70/30)",
    picks: [
      ["AAPL", 10],
      ["AMZN", 10],
      ["GOOGL", 10],
      ["META", 10],
      ["MSFT", 10],
      ["NVDA", 10],
      ["TSLA", 10],
      ["cbBTC", 30],
    ],
  },
  {
    id: "ai",
    name: "AI compute",
    picks: [
      ["NVDA", 40],
      ["MSFT", 20],
      ["GOOGL", 20],
      ["META", 20],
    ],
  },
];

/** The most legs a basket takes — each is two signatures. */
export const MAX_LEGS = 10;
/** What is wrong with a basket, in words, or `null` when it can be bought. */
export function basketProblem(legs: readonly Leg[]): string | null {
  if (legs.length === 0) return "Add at least one asset.";
  if (legs.length > MAX_LEGS) return `A basket takes at most ${MAX_LEGS} assets.`;
  const seen = new Set<string>();
  for (const l of legs) {
    if (!Number.isInteger(l.weight) || l.weight <= 0) return `${l.asset.symbol}'s weight must be a whole percent above 0.`;
    const a = l.asset.address.toLowerCase();
    if (seen.has(a)) return `${l.asset.symbol} is in the basket twice.`;
    seen.add(a);
  }
  const sum = legs.reduce((s, l) => s + l.weight, 0);
  return sum === 100 ? null : `The weights add up to ${sum}%, not 100%.`;
}

/** `total` split by weight, floored; the remainder goes to the largest leg so the parts sum to `total`. */
export function split(total: bigint, weights: readonly number[]): bigint[] {
  const parts = weights.map((w) => (total * BigInt(w)) / 100n);
  const rest = total - parts.reduce((s, p) => s + p, 0n);
  const big = weights.indexOf(Math.max(...weights));
  if (big >= 0) parts[big] = parts[big]! + rest;
  return parts;
}

/** Minimum per-leg top-up allocation ($0.05 in USDC base units) before dust is dropped to 0. */
export const MIN_TOP_UP_LEG = 50_000n;

/**
 * A top-up of `total` that brings the basket toward its weights: each leg's shortfall against its
 * target after the top-up, scaled down if the shortfalls exceed `total`; whatever is left goes by
 * weight. `values` are what each leg is worth now, in USDC base units. When `minLeg > 0n`, any leg
 * whose allocation falls below `minLeg` (while at least one leg meets it) is dropped to `0n` and
 * redistributed across the remaining underweight legs so tiny dust never fails Relay's minimum swap.
 */
export function topUp(total: bigint, weights: readonly number[], values: readonly bigint[], minLeg = 0n): bigint[] {
  if (total === 0n) return weights.map(() => 0n);
  const now = values.reduce((s, v) => s + v, 0n);
  const after = now + total;
  const short = weights.map((w, i) => {
    const target = (after * BigInt(w)) / 100n;
    return target > values[i]! ? target - values[i]! : 0n;
  });
  const allocate = (shortfalls: readonly bigint[]): bigint[] => {
    const need = shortfalls.reduce((s, v) => s + v, 0n);
    if (need === 0n) return split(total, weights);
    const parts = shortfalls.map((s) => (s * total) / need);
    const rem = total - parts.reduce((s, p) => s + p, 0n);
    // the flooring's crumbs go to the largest part, which is one with a shortfall (need > 0)
    let big = 0;
    for (let i = 1; i < parts.length; i++) if (parts[i]! > parts[big]!) big = i;
    parts[big] = parts[big]! + rem;
    return parts;
  };
  let parts = allocate(short);
  if (minLeg > 0n && parts.some((p) => p >= minLeg)) {
    const active = short.map((s, i) => (parts[i]! >= minLeg ? s : 0n));
    if (active.some((s, i) => s !== short[i])) parts = allocate(active);
  }
  return parts;
}

/** Each leg's share of the basket now, in whole percent of `values`' sum (0 for an empty basket). */
export function weightsNow(values: readonly bigint[]): number[] {
  const sum = values.reduce((s, v) => s + v, 0n);
  return values.map((v) => (sum === 0n ? 0 : Number((v * 1000n) / sum) / 10));
}
