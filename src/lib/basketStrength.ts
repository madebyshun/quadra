import { split, type Leg } from "@/lib/basket";
import { messageOf } from "@/lib/errors";

/** Sampled lower bound, never a pool-liquidity guess or a claim to know the exact maximum. */
export const STRENGTH_SIZES = [100, 1_000, 10_000, 100_000] as const;
export type Strength = { readonly passed: number; readonly tested: number; readonly limiting: string | null; readonly problem: string | null };
export async function measureStrength(
  legs: readonly Leg[],
  quote: (leg: Leg, amount: bigint) => Promise<{ readonly impact: string | null }>,
  progress: (total: number, symbol: string) => void,
): Promise<Strength> {
  let passed = 0;
  for (const total of STRENGTH_SIZES) {
    const amounts = split(BigInt(total) * 1_000_000n, legs.map((l) => l.weight));
    for (const [i, leg] of legs.entries()) {
      progress(total, leg.asset.symbol);
      let impact: number;
      try {
        const q = await quote(leg, amounts[i]!);
        impact = q.impact === null ? NaN : Math.abs(Number(q.impact));
        if (!Number.isFinite(impact)) return { passed, tested: total, limiting: leg.asset.symbol, problem: "Relay did not give a price impact" };
      } catch (e) {
        const why = messageOf(e);
        const high = /impact is too high:\s*-?(\d+(?:\.\d+)?)%/i.exec(why);
        if (!high) return { passed, tested: total, limiting: leg.asset.symbol, problem: why };
        impact = Number(high[1]);
      }
      if (impact > 2) return { passed, tested: total, limiting: leg.asset.symbol, problem: null };
    }
    passed = total;
  }
  return { passed, tested: passed, limiting: null, problem: null };
}
