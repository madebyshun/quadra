/** A value-only preview. No quotes, token amounts, approvals or transactions are built here. */
export type RebalanceRow = { symbol: string; current: bigint; target: bigint; delta: bigint; driftBps: bigint };
export function rebalance(held: readonly bigint[], weights: readonly number[], symbols: readonly string[], minimum: bigint): readonly RebalanceRow[] {
  if (held.length !== weights.length || held.length !== symbols.length || held.some((v) => v < 0n) || weights.some((v) => !Number.isInteger(v) || v < 0) || weights.reduce((n, v) => n + v, 0) !== 100 || minimum < 0n) throw new Error("The preview needs matching assets, non-negative values and weights totaling 100%.");
  const total = held.reduce((sum, v) => sum + v, 0n);
  const targets = weights.map((w) => total * BigInt(w) / 100n);
  // Allocate the rounding remainder to the final asset, preserving the portfolio value exactly.
  targets[targets.length - 1] = targets[targets.length - 1]! + total - targets.reduce((sum, v) => sum + v, 0n);
  return held.map((current, i) => {
    const delta = targets[i]! - current;
    return { symbol: symbols[i]!, current, target: targets[i]!, delta: (delta < 0n ? -delta : delta) < minimum ? 0n : delta, driftBps: total === 0n ? 0n : current * 10000n / total - BigInt(weights[i]!) * 100n };
  });
}
