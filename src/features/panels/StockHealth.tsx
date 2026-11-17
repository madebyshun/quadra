import { useEffect, useState } from "react";
import type { BaseStock } from "@/adapters/http/markets";
import { readStockSnapshot, type StockSnapshot } from "@/lib/stockHealth";
import { messageOf } from "@/lib/errors";
import { usd } from "@/skills/format";

export function StockHealth({ stock }: { stock: BaseStock }) {
  const [snapshot, setSnapshot] = useState<StockSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null); setError(null);
    readStockSnapshot(controller.signal).then((value) => { if (!controller.signal.aborted) setSnapshot(value); }, (e: unknown) => { if (!controller.signal.aborted) setError(messageOf(e)); });
    return () => controller.abort();
  }, [stock.address, refresh]);
  const row = snapshot?.rows.find((r) => r.contract.toLowerCase() === stock.address.toLowerCase());
  const value = (n: number | null) => n === null ? "unknown" : usd(n);
  return <section className="group stack" aria-label="Stock health">
    <h3>stocks / health</h3>
    <p className="dim">{stock.symbol} / Base / {stock.address}</p>
    <p>1 token = {stock.multiplier} shares. Issuer transfer policies and pauses still apply.</p>
    <button type="button" className="chip" onClick={() => setRefresh((n) => n + 1)}>refresh stock data</button>
    {error ? <p role="status">{error}</p> : snapshot === null ? <p role="status">reading Blue Agent stock data...</p> : <>
      <p role="status">{snapshot.stale ? "stale snapshot - for reference only" : "snapshot available - not an executable quote"} / {snapshot.observedAt || "update time unknown"}</p>
      <p className="dim">coverage / {snapshot.observed ?? "unknown"} observed / {snapshot.catalog ?? "unknown"} listed. Other stocks have not been assessed by this poller.</p>
      {row ? <dl className="stock-health__facts">
        <dt>DEX price</dt><dd>{value(row.dexUsd)}</dd>
        <dt>oracle reference</dt><dd>{value(row.oracleUsd)} - source reference, not a fill price</dd>
        <dt>source-reported gap</dt><dd>{row.driftPct === null ? "unknown" : `${row.driftPct.toFixed(2)}%`}</dd>
        <dt>deepest pool liquidity</dt><dd>{value(row.liquidityUsd)} - liquidity does not guarantee a route</dd>
        <dt>oracle updated</dt><dd>{row.oracleUpdatedAt === null ? "unknown" : new Date(row.oracleUpdatedAt * 1000).toISOString()}</dd>
      </dl> : <p>not assessed / this stock is outside the returned watchlist. This does not mean it is illiquid or unavailable to trade.</p>}
    </>}
    <p className="dim"><a href="https://blueagent.dev" target="_blank" rel="noreferrer">data / Blue Agent</a>. Review a fresh quote for your amount below. A snapshot does not authorize a trade.</p>
  </section>;
}
