/** Blue Agent observations are context, never executable quotes or transfer permission. */
export type StockObservation = {
  contract: string; ticker: string; dexUsd: number | null; oracleUsd: number | null;
  driftPct: number | null; liquidityUsd: number | null; oracleUpdatedAt: number | null;
};
export type StockSnapshot = {
  observedAt: string; stale: boolean; catalog: number | null; observed: number | null;
  rows: readonly StockObservation[];
};
const obj = (v: unknown): Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {};
const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;

export function parseStockSnapshot(input: unknown, now: number): StockSnapshot {
  const b = obj(input), desk = obj(b.base_desk), coverage = obj(desk.coverage);
  if (b.chain_filter !== "base" || !Array.isArray(b.rows)) throw new Error("Blue Agent did not return a Base stock snapshot.");
  const at = typeof desk.as_of === "string" ? desk.as_of : "";
  const age = now - Date.parse(at);
  const rows: StockObservation[] = [];
  for (const value of b.rows) {
    const r = obj(value);
    if (r.chain_id !== 8453 || typeof r.contract !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(r.contract) || typeof r.ticker !== "string") continue;
    rows.push({ contract: r.contract, ticker: r.ticker, dexUsd: number(r.dex_usd), oracleUsd: number(r.oracle_usd), driftPct: number(r.drift_pct), liquidityUsd: number(r.primary_pool_tvl_usd), oracleUpdatedAt: typeof r.oracle_updated_at === "number" && r.oracle_updated_at >= 0 && r.oracle_updated_at <= 8640000000000 ? r.oracle_updated_at : null });
  }
  return { observedAt: at, stale: !Number.isFinite(age) || age < 0 || age > 900_000 || b.is_stale === true,
    catalog: number(coverage.catalog_total), observed: number(coverage.observed), rows };
}

export async function readStockSnapshot(signal: AbortSignal): Promise<StockSnapshot> {
  const res = await fetch("/api/weekend/live", { headers: { "x-quadra": "1" }, signal });
  if (!res.ok) throw new Error(`Blue Agent data unavailable (${res.status}). Trading quotes are checked separately.`);
  return parseStockSnapshot(await res.json(), Date.now());
}
