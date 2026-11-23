import { useState } from "react";
import { rebalance } from "@/lib/rebalance";
import { QuadraSelect } from "@/ui/Select";
import { formatAmount, parseAmount } from "@/lib/amount";

export function RebalancePreview({ held, weights, symbols }: { held: readonly bigint[]; weights: readonly number[]; symbols: readonly string[] }) {
  const [mode, setMode] = useState<"all" | "add">("add");
  const [minimum, setMinimum] = useState("0.01");
  const min = /^\d+(\.\d{0,6})?$/.test(minimum) ? parseAmount(minimum, 6) : null;
  const rows = min === null ? null : rebalance(held, weights, symbols, min);
  const buys = rows?.reduce((sum, r) => sum + (r.delta > 0n ? r.delta : 0n), 0n);
  const sells = rows?.reduce((sum, r) => sum + (r.delta < 0n ? -r.delta : 0n), 0n);
  return <details className="group">
    <summary>basket / rebalance preview</summary>
    <p className="dim">Wallet balances shared by multiple saved baskets are the same assets, not separate accounts. This preview uses the holdings values above.</p>
    <div className="label"><span>preview mode</span><QuadraSelect ariaLabel="preview mode" value={mode} onChange={(v) => setMode(v as "all" | "add")} options={[{ value: "add", label: "add only - no sales" }, { value: "all", label: "buy and sell" }]} /></div>
    <label className="label">skip changes below / USDC<input className="field" inputMode="decimal" value={minimum} onChange={(e) => setMinimum(e.target.value)} /></label>
    {rows === null ? <p role="status">enter a non-negative minimum with at most 6 decimals.</p> : <>
      <table className="basket__review"><thead><tr><th>asset</th><th>drift / pp</th><th>value change / USDC</th></tr></thead><tbody>{rows.map((r) => <tr key={r.symbol}><th>{r.symbol}</th><td>{(Number(r.driftBps) / 100).toFixed(2)}</td><td>{r.delta === 0n || (mode === "add" && r.delta < 0n) ? "skip" : `${r.delta > 0n ? "buy" : "sell"} ${formatAmount(r.delta < 0n ? -r.delta : r.delta, 6)}`}</td></tr>)}</tbody></table>
      <p>buys / {formatAmount(buys!, 6)} USDC - {mode === "all" ? `sales / ${formatAmount(sells!, 6)} USDC` : "new funds required; weights will need another review after adding funds"}</p>
    </>}
    <p className="dim">preview only / before gas, fees and price impact. Sales do not guarantee funding for buys. Fresh quotes and your approval are required for any future execution. Nothing is signed here.</p>
  </details>;
}
