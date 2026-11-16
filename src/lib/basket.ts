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
/** The smallest leg worth a swap, in USDC base units ($1). */
export const MIN_LEG = 1_000_000n;

/**
 * The legs the split made too small to swap, in words, or `null`. A leg of a few cents is not a
 * bargain: it costs as much gas as it buys, and it is the size at which a routed swap has the least
 * room to be filled at all. MEASURED 2026-11-15 on a 7-asset basket: its legs were ~$0.17 each, one
 * approval confirmed and the buy behind it reverted on chain. That revert was NOT reproduced — a
 * replay of the same transaction, at the parent and at its own block, succeeded, with the balance
 * and allowance both sufficient and the gas limit only two thirds used, so the on-chain cause is
 * still unknown. This floor is a guard against a size that is not worth signing, not a fix for a
 * proven cause. A leg the top-up left at zero is not dust — it is already at its weight, and
 * `priceAll` says so.
 */
export function dustProblem(amounts: readonly bigint[], legs: readonly Leg[]): string | null {
  const dust = legs.filter((_, i) => amounts[i]! > 0n && amounts[i]! < MIN_LEG);
  if (dust.length === 0) return null;
  const [one, ...rest] = dust;
  if (rest.length === 0) return `${one!.asset.symbol} would be under ${Number(MIN_LEG) / 1e6} USDC — put in more, or give that asset more weight.`;
  return `${dust.map((l) => l.asset.symbol).join(", ")} would each be under ${Number(MIN_LEG) / 1e6} USDC — put in more, or give those assets more weight.`;
}

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

/**
 * A top-up of `total` that brings the basket toward its weights: each leg's shortfall against its
 * target after the top-up, scaled down if the shortfalls exceed `total`; whatever is left goes by
 * weight. `values` are what each leg is worth now, in USDC base units.
 */
export function topUp(total: bigint, weights: readonly number[], values: readonly bigint[]): bigint[] {
  const now = values.reduce((s, v) => s + v, 0n);
  const after = now + total;
  const short = weights.map((w, i) => {
    const target = (after * BigInt(w)) / 100n;
    return target > values[i]! ? target - values[i]! : 0n;
  });
  const need = short.reduce((s, v) => s + v, 0n);
  if (need === 0n) return split(total, weights);
  // the shortfalls add up to at least `total` (the targets sum to what is held plus `total`), so they
  // are always scaled down to it; the floors' crumbs go by weight below
  const parts = short.map((s) => (s * total) / need);
  const used = parts.reduce((s, p) => s + p, 0n);
  const extra = split(total - used, weights);
  return parts.map((p, i) => p + extra[i]!);
}

/** Each leg's share of the basket now, in whole percent of `values`' sum (0 for an empty basket). */
export function weightsNow(values: readonly bigint[]): number[] {
  const sum = values.reduce((s, v) => s + v, 0n);
  return values.map((v) => (sum === 0n ? 0 : Number((v * 1000n) / sum) / 10));
}
