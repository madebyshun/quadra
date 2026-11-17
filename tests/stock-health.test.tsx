import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parseStockSnapshot, readStockSnapshot } from "@/lib/stockHealth";
import { StockHealth } from "@/features/panels/StockHealth";
import { IndexNotice } from "@/ui/IndexNotice";
import type { BaseStock } from "@/adapters/http/markets";
const address = `0x${"12".repeat(20)}`;
const now = Date.now();
const stock: BaseStock = { ticker: "AAPL", symbol: "AAPLc", name: "Apple", address, decimals: 8, multiplier: 1.02, paused: [], nav: null, navAt: null, icon: null };
const row = { chain_id: 8453, contract: address, ticker: "AAPL", dex_usd: 100, oracle_usd: 101, drift_pct: -1, primary_pool_tvl_usd: 1000, oracle_updated_at: now / 1000 };
const body = (extra = {}) => ({ chain_filter: "base", base_desk: { as_of: new Date(now).toISOString(), coverage: { observed: 12, catalog_total: 338 } }, rows: [row], ...extra });
const settle = () => act(async () => { await Promise.resolve(); });
const serve = (value: unknown, status = 200) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(value), { status })));

describe("stock observations keep identity, coverage and time separate", () => {
  it("accepts only Base observations and preserves unknowns", () => {
    expect(parseStockSnapshot(body(), now).rows[0]).toMatchObject({ contract: address, dexUsd: 100 });
    const invalid = [null, [], { ...row, chain_id: 4663 }, { ...row, contract: 7 }, { ...row, contract: "bad" }, { ...row, ticker: null }];
    expect(parseStockSnapshot(body({ rows: invalid }), now).rows).toEqual([]);
    expect(() => parseStockSnapshot(null, now)).toThrow("Base stock snapshot");
    expect(() => parseStockSnapshot({ chain_filter: "base" }, now)).toThrow();
    const missing = parseStockSnapshot({ chain_filter: "base", rows: [{ ...row, dex_usd: "100", oracle_usd: NaN, drift_pct: null, primary_pool_tvl_usd: undefined, oracle_updated_at: -1 }] }, now);
    expect(missing).toMatchObject({ stale: true, observedAt: "", catalog: null, observed: null });
    expect(missing.rows[0]).toMatchObject({ dexUsd: null, oracleUsd: null, driftPct: null, liquidityUsd: null, oracleUpdatedAt: null });
    expect(parseStockSnapshot(body({ rows: [{ ...row, oracle_updated_at: "bad" }, { ...row, oracle_updated_at: 9e15 }] }), now).rows.every(r=>r.oracleUpdatedAt === null)).toBe(true);
  });
  it("expires by the Base dataset time, not the wrapper time", () => {
    expect(parseStockSnapshot(body(), now).stale).toBe(false);
    expect(parseStockSnapshot(body(), now + 900001).stale).toBe(true);
    expect(parseStockSnapshot(body(), now - 1).stale).toBe(true);
    expect(parseStockSnapshot(body({ is_stale: true }), now).stale).toBe(true);
    expect(parseStockSnapshot(body({ base_desk: { as_of: "bad" } }), now).stale).toBe(true);
  });
  it("never accepts an HTTP error as a snapshot", async () => {
    serve({}, 429);
    await expect(readStockSnapshot(new AbortController().signal)).rejects.toThrow("429");
    serve(body());
    expect((await readStockSnapshot(new AbortController().signal)).rows).toHaveLength(1);
  });
  it("shows observed values, refresh and explicit reference limits", async () => {
    serve(body()); render(<StockHealth stock={stock} />);
    expect(screen.getByRole("status")).toHaveTextContent("reading"); await settle();
    expect(screen.getByText(/12 observed \/ 338 listed/)).toBeInTheDocument();
    expect(screen.getByText(/-1.00%/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("refresh stock data")); await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("shows missing measurements and a stale dataset without inventing zeros", async () => {
    serve(body({ is_stale: true, base_desk: {}, rows: [{ ...row, dex_usd: null, oracle_usd: null, drift_pct: null, primary_pool_tvl_usd: null, oracle_updated_at: null }] }));
    render(<StockHealth stock={stock} />); await settle();
    expect(screen.getByRole("status")).toHaveTextContent("stale");
    expect(screen.getByText(/update time unknown/)).toBeInTheDocument();
    expect(screen.getAllByText(/unknown/).length).toBeGreaterThan(3);
  });
  it("labels an unobserved stock without calling it illiquid", async () => {
    serve(body({ rows: [] })); render(<StockHealth stock={stock} />); await settle();
    expect(screen.getByText(/outside the returned watchlist/)).toBeInTheDocument();
  });
  it("reports a source failure and ignores results after unmount", async () => {
    serve({}, 503); const a = render(<StockHealth stock={stock} />); await settle();
    expect(screen.getByRole("status")).toHaveTextContent("unavailable"); a.unmount();
    for (const reject of [false,true]) {
      let finish: (v: Response) => void = () => {}; let fail: (e: Error) => void = () => {};
      vi.stubGlobal("fetch",()=>new Promise<Response>((yes,no)=>{finish=yes;fail=no;}));
      const view=render(<StockHealth stock={stock} />); view.unmount();
      await act(async()=>{if(reject)fail(new Error("late"));else finish(new Response(JSON.stringify(body())));});
    }
  });
  it("qualifies complete, incomplete, unknown and failed index snapshots", () => {
    for (const props of [{ behind: 0, error: null }, { behind: 2, error: null }, { behind: null, error: null }, { behind: 0, error: "RPC down" }]) {
      render(<IndexNotice {...props} />);
      expect(screen.getByRole("status")).toHaveTextContent(props.error ? "source error" : props.behind === null ? "unknown" : props.behind ? "catching up" : "caught up"); cleanup();
    }
  });
});
