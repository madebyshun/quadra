import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { erc20Abi } from "viem";
import { WETH } from "@/config/chain";
import { CBBTC, DEFAULT_WATCH, THIN_MARKET_USD, watchKey } from "@/config/markets";
import { ROBINHOOD } from "@/config/routes";
import {
  baseStocks,
  stocksUrl,
  candles,
  change,
  DEXSCREENER,
  fillGaps,
  forgetCatalog,
  parseBaseStocks,
  parseCandles,
  parseQuotes,
  parseSpots,
  spots,
  stockQuotes,
  type Candle,
} from "@/adapters/http/markets";
import { COINBASE_STOCKS, stocksHandler, STOCKS_PATH } from "@/server/stocks";
import { chartsHandler, CHARTS_PATH, FRESH_MS, STALE_MS as SERVER_STALE_MS, upstreamUrl } from "@/server/charts";
import { loadWatch, saveWatch, WATCH_KEY } from "@/lib/watchlist";
import { direction, formatChange, points, PriceChart, Sparkline } from "@/features/markets/Chart";
import { MarketsProvider, REFRESH_MS, useMarkets } from "@/features/markets/MarketsProvider";
import { MarketsGadget } from "@/features/markets/MarketsGadget";
import { MarketsPanel, pausedText, STALE_MS } from "@/features/panels/MarketsPanel";
import { copy } from "./fixtures/base";
import { AAPL_ON_BASE, CAPTURED_AT, MARKETS_FX, NVDA_ON_BASE, SPY, TSLA, TSLA_PAIR, WETH_PAIR } from "./fixtures/markets";
import { contractAt, DOWN, ethCalls, json, net, useNet } from "./net";
import { renderAt } from "./helpers";

/**
 * Robinhood Chain is HIDDEN in the product (FLAGS.robinhood, 2026-10-02) but its half of Markets is
 * kept, so these tests keep it switched ON — except the ones that check the hiding.
 */
const flags = vi.hoisted(() => ({ robinhood: true }));
vi.mock("@/config/chain", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/config/chain")>();
  return { ...real, FLAGS: new Proxy(real.FLAGS, { get: (t, k) => (k === "robinhood" ? flags.robinhood : t[k as keyof typeof t]) }) };
});

useNet();

beforeEach(() => {
  forgetCatalog();
  // "now" is when the captures were taken, so a 24-hour window lands on the captured candles
  vi.useFakeTimers({ now: CAPTURED_AT, toFake: ["Date"] });
});
afterEach(() => vi.useRealTimers());

type Json = Record<string, unknown>;

/** DexScreener, this app's chart and stock routes — answered from the captures unless told otherwise. */
function markets(over: { get?: (url: string) => unknown; rpc?: (m: string, p: readonly unknown[]) => unknown } = {}) {
  return net({
    get: (url) => {
      const special = over.get?.(url);
      if (special !== undefined) return special;
      if (url === `${STOCKS_PATH}/prices`) return freshPrices();
      if (url === `${STOCKS_PATH}/base`) return MARKETS_FX.coinbaseStocks;
      if (url.startsWith(`${DEXSCREENER}/base/`)) return MARKETS_FX.dexBase;
      if (url.startsWith(`${DEXSCREENER}/robinhood/`)) return MARKETS_FX.dexRobinhood;
      if (url.startsWith(`${CHARTS_PATH}/ohlcv?network=base`)) return MARKETS_FX.wethOhlcv;
      if (url.startsWith(`${CHARTS_PATH}/ohlcv?network=robinhood`)) return MARKETS_FX.tslaOhlcv;
      return undefined;
    },
    ...(over.rpc ? { rpc: over.rpc } : {}),
  });
}

/** A captured candle list with its newest close moved to `factor` × its oldest open. */
function trend(fixture: unknown, factor: number): unknown {
  const c = copy(fixture) as { data: { attributes: { ohlcv_list: number[][] } } };
  const rows = c.data.attributes.ohlcv_list;
  rows[0]![4] = rows[rows.length - 1]![1]! * factor; // newest first
  return c;
}

/** The captured quotes, re-dated to now — a capture from this morning would otherwise read as stale. */
function freshPrices(edit: (q: Json) => void = () => {}): unknown {
  const p = copy(MARKETS_FX.prices) as { quotes: Json[] };
  for (const q of p.quotes) q.generatedAt = new Date().toISOString();
  edit(p.quotes.find((q) => q.tokenSymbol === "TSLA")!);
  return p;
}

/** The captured Base pairs with every pair's liquidity set to `usd` — a thin market, built from a real answer. */
function dexAt(usd: number): unknown {
  const c = copy(MARKETS_FX.dexBase) as { liquidity: Json }[];
  for (const p of c) p.liquidity.usd = usd;
  return c;
}

async function settle() {
  for (let i = 0; i < 12; i++) await act(async () => {});
}

// ── the server routes ───────────────────────────────────────────────────────

describe("the stock list routes", () => {
  const req = (path: string, init: { method?: string; header?: boolean } = {}) =>
    new Request(`http://localhost${STOCKS_PATH}${path}`, { method: init.method ?? "GET", headers: init.header === false ? {} : { "x-quadra": "1" } });

  it("forwards each route to its one upstream and passes the answer back, cacheable", async () => {
    const seen: string[] = [];
    const handle = stocksHandler((async (url: string) => {
      seen.push(url);
      return json({ quotes: [] });
    }) as unknown as typeof fetch);
    const prices = await handle(req("/prices"));
    const base = await handle(req("/base"));
    expect(seen).toEqual(["https://api.robinhood.com/rhj/prices/", "https://api.coinbase.com/v1/tokenized-stocks"]);
    expect(await prices.json()).toEqual({ quotes: [] });
    expect(prices.headers.get("cache-control")).toBe("max-age=15");
    expect(base.headers.get("cache-control")).toBe("max-age=300");
  });

  it("refuses without the header, off the routes, or with the wrong method, and names an outage", async () => {
    const never = (() => Promise.reject(new Error("must not be called"))) as unknown as typeof fetch;
    expect((await stocksHandler(never)(req("/prices", { header: false }))).status).toBe(403);
    expect((await stocksHandler(never)(req("/assets"))).status).toBe(404);
    // an object's own keys only — `constructor` is not a route
    expect((await stocksHandler(never)(req("/constructor"))).status).toBe(404);
    expect((await stocksHandler(never)(req("/base", { method: "POST" }))).status).toBe(405);
    const down = await stocksHandler((() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch)(req("/base"));
    expect(down.status).toBe(502);
    expect(await down.json()).toMatchObject({ detail: "Coinbase's tokenized stocks API could not be reached.", origin: "quadra-server" });
    expect(typeof stocksHandler()).toBe("function");
  });
});

describe("the chart route", () => {
  const Q = `network=base&pool=${WETH_PAIR}&token=${WETH.address}&frame=hour&aggregate=1&limit=24`;
  const req = (query = Q, init: { method?: string; header?: boolean; path?: string } = {}) =>
    new Request(`http://localhost${CHARTS_PATH}${init.path ?? "/ohlcv"}?${query}`, {
      method: init.method ?? "GET",
      headers: init.header === false ? {} : { "x-quadra": "1" },
    });
  const url = (q: string) => upstreamUrl(new URLSearchParams(q));

  it("builds the one GeckoTerminal URL a request stands for, and refuses anything else by name", () => {
    expect(url(Q)).toBe(`https://api.geckoterminal.com/api/v2/networks/base/pools/${WETH_PAIR}/ohlcv/hour?aggregate=1&limit=24&currency=usd&token=${WETH.address}`);
    expect(url(Q.replace("network=base", "network=ethereum"))).toEqual({ refused: "network must be base or robinhood." });
    expect(url(Q.replace(WETH_PAIR, "0x12"))).toEqual({ refused: "pool must be a 20- or 32-byte hex id." });
    expect(url(Q.replace(`token=${WETH.address}`, "token=base"))).toEqual({ refused: "token must be an address." });
    expect(url(Q.replace("aggregate=1", "aggregate=2"))).toMatchObject({ refused: expect.stringMatching(/frame\/aggregate/) });
    expect(url(Q.replace("frame=hour", "frame=minute"))).toMatchObject({ refused: expect.stringMatching(/frame\/aggregate/) });
    expect(url(Q.replace("limit=24", "limit=500"))).toEqual({ refused: "limit must be 1–100." });
    expect(url(`pool=${TSLA_PAIR}`)).toEqual({ refused: "network must be base or robinhood." });
    // a parameter left out is refused like a wrong one
    expect(url("network=base")).toEqual({ refused: "pool must be a 20- or 32-byte hex id." });
    expect(url(`network=base&pool=${WETH_PAIR}`)).toEqual({ refused: "token must be an address." });
    expect(url(`network=base&pool=${WETH_PAIR}&token=${WETH.address}`)).toMatchObject({ refused: expect.stringMatching(/frame\/aggregate/) });
    expect(url(`network=base&pool=${WETH_PAIR}&token=${WETH.address}&frame=hour&aggregate=1`)).toEqual({ refused: "limit must be 1–100." });
    // a 32-byte v4 pool id is a pool too
    expect(typeof url(Q.replace(WETH_PAIR, TSLA_PAIR))).toBe("string");
  });

  it("serves one upstream answer to every caller while it is fresh, and asks again after", async () => {
    let clock = 1_000_000;
    let asked = 0;
    const handle = chartsHandler((async () => {
      asked++;
      return json(MARKETS_FX.wethOhlcv);
    }) as unknown as typeof fetch, () => clock);
    const [a, b] = await Promise.all([handle(req()), handle(req())]);
    expect(asked).toBe(1);
    expect(await a.json()).toEqual(MARKETS_FX.wethOhlcv);
    expect(await b.json()).toEqual(MARKETS_FX.wethOhlcv);
    expect(a.headers.get("cache-control")).toContain("s-maxage=120");
    expect(a.headers.get("x-quadra-stale")).toBeNull();
    await handle(req());
    expect(asked).toBe(1);
    clock += FRESH_MS;
    await handle(req());
    expect(asked).toBe(2);
  });

  /** MEASURED 2026-09-30: GeckoTerminal answered this machine 429 for over an hour. */
  it("keeps serving a remembered chart, marked stale, while GeckoTerminal says no", async () => {
    let clock = 1_000_000;
    let answer: () => Response | Promise<Response> = () => json(MARKETS_FX.wethOhlcv);
    const handle = chartsHandler((async () => answer()) as unknown as typeof fetch, () => clock);
    await handle(req());
    clock += FRESH_MS + 90_000;
    answer = () => new Response("", { status: 429 });
    const stale = await handle(req());
    expect(stale.status).toBe(200);
    expect(stale.headers.get("x-quadra-stale")).toBe(String((FRESH_MS + 90_000) / 1000));
    answer = () => Promise.reject(new TypeError("offline"));
    expect((await handle(req())).headers.get("x-quadra-stale")).not.toBeNull();
    clock += SERVER_STALE_MS;
    const gone = await handle(req());
    expect(gone.status).toBe(502);
    expect(await gone.json()).toMatchObject({ detail: "GeckoTerminal could not be reached." });
  });

  it("says a rate limit is a rate limit, and any other refusal by its status", async () => {
    const limited = await chartsHandler((async () => new Response("", { status: 429 })) as unknown as typeof fetch)(req());
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ detail: expect.stringMatching(/GeckoTerminal is rate-limiting this server right now/) });
    const broken = await chartsHandler((async () => new Response("", { status: 503 })) as unknown as typeof fetch)(req());
    expect(broken.status).toBe(502);
    expect(await broken.json()).toMatchObject({ detail: "GeckoTerminal answered 503." });
  });

  it("refuses without the header, off the route, with the wrong method, or with a bad parameter", async () => {
    const handle = chartsHandler((() => Promise.reject(new Error("must not be called"))) as unknown as typeof fetch);
    expect((await handle(req(Q, { header: false }))).status).toBe(403);
    expect((await handle(req(Q, { path: "/pools" }))).status).toBe(404);
    expect((await handle(req(Q, { method: "POST" }))).status).toBe(405);
    const bad = await handle(req(Q.replace("limit=24", "limit=0")));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ detail: "limit must be 1–100." });
    expect(typeof chartsHandler()).toBe("function");
  });
});

// ── reading the sources ─────────────────────────────────────────────────────

describe("DexScreener prices", () => {
  it("reads each token's deepest pair where it is the base token", () => {
    const got = parseSpots(MARKETS_FX.dexBase);
    expect([...got.keys()]).toEqual([WETH.address, CBBTC.address, NVDA_ON_BASE, AAPL_ON_BASE, "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b"].map((a) => a.toLowerCase()));
    expect(got.get(WETH.address.toLowerCase())).toEqual({ price: 2670.91, change: -1.7, depth: 4963660.28, pool: WETH_PAIR, symbol: "WETH", name: "Wrapped Ether" });
    // a v4 pool id is 32 bytes
    expect(parseSpots(MARKETS_FX.dexRobinhood).get(TSLA.toLowerCase())!.pool).toBe(TSLA_PAIR);
  });

  it("keeps the deeper of two pairs, counts an unreported depth as the shallowest, and skips what it cannot identify", () => {
    const [weth] = copy(MARKETS_FX.dexBase) as Json[];
    const shallow = { ...weth, pairAddress: "0x" + "1".repeat(40), liquidity: { usd: 5 } };
    const undepthed = { ...weth, pairAddress: "0x" + "2".repeat(40), liquidity: {} };
    const got = parseSpots([shallow, 7, { ...weth, baseToken: {} }, { ...weth, pairAddress: "0x12" }, weth, undepthed]);
    expect(got.size).toBe(1);
    expect(got.get(WETH.address.toLowerCase())!.pool).toBe(WETH_PAIR);
    expect(parseSpots([undepthed]).get(WETH.address.toLowerCase())!.depth).toBeNull();
    // a pair with a depth beats one held without
    expect(parseSpots([undepthed, weth]).get(WETH.address.toLowerCase())!.pool).toBe(WETH_PAIR);
    expect(parseSpots(null).size).toBe(0);
  });

  it("asks once per 30 tokens per chain, and says why when it cannot", async () => {
    const calls = markets();
    const many = Array.from({ length: 31 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}`);
    await spots("base", [...many, many[0]!.toUpperCase().replace("0X", "0x")]);
    const asked = calls.filter((c) => c.url.startsWith(DEXSCREENER));
    expect(asked).toHaveLength(2);
    expect(asked[0]!.url.split("/").at(-1)!.split(",")).toHaveLength(30);
    expect(await spots("base", [])).toEqual(new Map());
    markets({ get: (u) => (u.startsWith(DEXSCREENER) ? DOWN : undefined) });
    await expect(spots("base", [WETH.address])).rejects.toThrow("DexScreener could not be reached for prices.");
    markets({ get: (u) => (u.startsWith(DEXSCREENER) ? json({}, 429) : undefined) });
    await expect(spots("base", [WETH.address])).rejects.toThrow("DexScreener answered 429.");
    markets({ get: (u) => (u.startsWith(DEXSCREENER) ? new Response("<html>") : undefined) });
    await expect(spots("base", [WETH.address])).rejects.toThrow("not JSON");
  });
});

describe("charts from GeckoTerminal", () => {
  it("reads candles oldest first, in milliseconds, dropping rows it cannot read", () => {
    const got = parseCandles(MARKETS_FX.wethOhlcv);
    expect(got).toHaveLength(24);
    expect(got[0]!.t).toBeLessThan(got[1]!.t);
    expect(got[23]!.t).toBe(1790769600 * 1000);
    expect(parseCandles({ data: { attributes: { ohlcv_list: [[1, 2, 3], "x", [1, 1, 1, 1, "c"]] } } })).toEqual([]);
    expect(parseCandles(null)).toEqual([]);
  });

  /** MEASURED: NVDA on Base came back as ONE hourly candle, and its sparkline read "no chart". */
  it("fills hours with no trade with the last price, and the hours before the first with its open", () => {
    const H = 3_600_000;
    const c = (t: number, o: number, cl: number): Candle => ({ t: t * H, o, h: Math.max(o, cl), l: Math.min(o, cl), c: cl });
    const filled = fillGaps([c(10, 5, 6), c(12, 6, 8)], H, 5, 13.5 * H);
    expect(filled.map((x) => [x.t / H, x.o, x.c])).toEqual([
      [9, 5, 5],
      [10, 5, 6],
      [11, 6, 6],
      [12, 6, 8],
      [13, 8, 8],
    ]);
    // a candle newer than "now" still ends the series
    expect(fillGaps([c(20, 1, 2)], H, 2, 10 * H).map((x) => x.t / H)).toEqual([19, 20]);
    // a candle from before the window sets the price the window starts at
    expect(fillGaps([c(1, 3, 4)], H, 2, 5 * H).map((x) => x.c)).toEqual([4, 4]);
    expect(fillGaps([], H, 24, 0)).toEqual([]);
  });

  it("computes change from first open to last close, and none from too little", () => {
    const c = (o: number, cl: number, t = 0): Candle => ({ t, o, h: Math.max(o, cl), l: Math.min(o, cl), c: cl });
    expect(change([c(100, 101), c(101, 110, 1)])).toBeCloseTo(10);
    expect(change([c(100, 110)])).toBeNull();
    expect(change([])).toBeNull();
    expect(change([c(0, 1), c(1, 2, 1)])).toBeNull();
  });

  it("asks this app's server for the pool DexScreener named, per range, and fills the series", async () => {
    const calls = markets();
    const day = await candles("robinhood", TSLA_PAIR, TSLA, "1D");
    expect(day.candles).toHaveLength(24);
    expect(day.staleSeconds).toBeNull();
    await candles("robinhood", TSLA_PAIR, TSLA, "7D");
    await candles("robinhood", TSLA_PAIR, TSLA, "30D");
    expect(calls.map((c) => c.url)).toEqual([
      `${CHARTS_PATH}/ohlcv?network=robinhood&pool=${TSLA_PAIR}&token=${TSLA}&frame=hour&aggregate=1&limit=24`,
      `${CHARTS_PATH}/ohlcv?network=robinhood&pool=${TSLA_PAIR}&token=${TSLA}&frame=hour&aggregate=4&limit=42`,
      `${CHARTS_PATH}/ohlcv?network=robinhood&pool=${TSLA_PAIR}&token=${TSLA}&frame=day&aggregate=1&limit=30`,
    ]);
  });

  it("passes on how old a remembered chart is, and says why a chart could not be had", async () => {
    const stale = new Response(JSON.stringify(MARKETS_FX.wethOhlcv), { headers: { "x-quadra-stale": "600" } });
    markets({ get: (u) => (u.startsWith(CHARTS_PATH) ? stale : undefined) });
    expect((await candles("base", WETH_PAIR, WETH.address, "1D")).staleSeconds).toBe(600);
    markets({ get: (u) => (u.startsWith(CHARTS_PATH) ? DOWN : undefined) });
    await expect(candles("base", WETH_PAIR, WETH.address, "1D")).rejects.toThrow("This app's server could not be reached for the chart.");
    markets({ get: (u) => (u.startsWith(CHARTS_PATH) ? new Response("<!doctype html>") : undefined) });
    await expect(candles("base", WETH_PAIR, WETH.address, "1D")).rejects.toThrow("Charts need this app's server, which is not running here.");
    markets({ get: (u) => (u.startsWith(CHARTS_PATH) ? json({ detail: "GeckoTerminal is rate-limiting this server right now." }, 429) : undefined) });
    await expect(candles("base", WETH_PAIR, WETH.address, "1D")).rejects.toThrow("GeckoTerminal is rate-limiting this server right now.");
    markets({ get: (u) => (u.startsWith(CHARTS_PATH) ? json([], 500) : undefined) });
    await expect(candles("base", WETH_PAIR, WETH.address, "1D")).rejects.toThrow("The chart is unavailable right now (HTTP 500).");
  });
});

describe("Coinbase's stocks on Base", () => {
  it("reads each stock by its ticker, with its multiplier, paused features and NAV", () => {
    const got = parseBaseStocks(MARKETS_FX.coinbaseStocks);
    expect([...got.keys()].sort()).toEqual(["AAPL", "AMD", "DKNG", "GOOGL", "NVDA", "TSLA"]);
    expect(got.get("NVDA")).toMatchObject({ ticker: "NVDA", symbol: "NVDAc", name: "NVIDIA Corporation", address: NVDA_ON_BASE, decimals: 8, multiplier: 1, paused: [] });
    expect(got.get("NVDA")!.navAt!.toISOString()).toMatch(/^2026-09-30T/);
    expect(got.get("GOOGL")!.multiplier).toBeGreaterThan(1);
    expect(got.get("DKNG")!.paused).toEqual([0, 1, 2]);
    expect(got.get("AMD")).toMatchObject({ nav: null, navAt: null });
  });

  /** MEASURED: Coinbase's own list sends AMDc with a capitalisation that is not an EIP-55 checksum. */
  it("keeps the hex Coinbase names and drops its capitalisation, which is not a checksum", () => {
    const raw = (MARKETS_FX.coinbaseStocks as { tokens: { symbol: string; contract_address: string }[] }).tokens.find((t) => t.symbol === "AMDc")!;
    expect(raw.contract_address).toBe("0xB2000000000000000000000d8ce462E99ee7A47B");
    const amd = parseBaseStocks(MARKETS_FX.coinbaseStocks).get("AMD")!;
    expect(amd.address).toBe("0xB2000000000000000000000d8Ce462E99ee7A47B");
    expect(amd.address.toLowerCase()).toBe(raw.contract_address.toLowerCase());
  });

  it("drops a record it cannot identify, and names a stock by its ticker when it has no name", () => {
    const [good] = (copy(MARKETS_FX.coinbaseStocks) as { tokens: Json[] }).tokens;
    const odd = parseBaseStocks({
      tokens: [
        7,
        { ...good, symbol: null },
        { ...good, contract_address: "0x12" },
        { ...good, decimals: 8.5 },
        { ...good, decimals: null },
        { ...good, multiplier: "x" },
        { ...good, symbol: "XYZc", name: null, icon_url: null, paused_features: [0, "1"] },
      ],
    });
    expect([...odd.values()]).toMatchObject([{ ticker: "XYZ", name: "XYZ", icon: null, paused: [0] }]);
    expect(parseBaseStocks(null).size).toBe(0);
  });

  it("is read once per page through this app's server, and read again after a failure", async () => {
    const calls = markets();
    await baseStocks();
    await baseStocks();
    expect(calls.filter((c) => c.url === `${STOCKS_PATH}/base`)).toHaveLength(1);
    forgetCatalog();
    markets({ get: (u) => (u === `${STOCKS_PATH}/base` ? DOWN : undefined) });
    await expect(baseStocks()).rejects.toThrow("This app's server could not be reached for the list of stocks on Base.");
    markets({ get: (u) => (u === `${STOCKS_PATH}/base` ? new Response("<html>") : undefined) });
    await expect(baseStocks()).rejects.toThrow("needs this app's server, which is not running here");
    markets({ get: (u) => (u === `${STOCKS_PATH}/base` ? json({ detail: "Coinbase's tokenized stocks API could not be reached." }, 502) : undefined) });
    await expect(baseStocks()).rejects.toThrow("(Coinbase's tokenized stocks API could not be reached.)");
    markets({ get: (u) => (u === `${STOCKS_PATH}/base` ? json([], 503) : undefined) });
    await expect(baseStocks()).rejects.toThrow("(HTTP 503)");
  });

  it("is asked of Coinbase directly where there is no page — an agent's run of a skill", () => {
    expect(stocksUrl()).toBe(`${STOCKS_PATH}/base`);
    vi.stubGlobal("document", undefined);
    try {
      expect(stocksUrl()).toBe(COINBASE_STOCKS);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Robinhood's quotes", () => {
  it("reads each quote with its contract on Robinhood Chain", () => {
    const q = parseQuotes(MARKETS_FX.prices);
    expect([...q.keys()].sort()).toEqual(["AAPL", "CRM", "NVDA", "SPY", "TSLA"]);
    const tsla = q.get("TSLA")!;
    expect(tsla.address).toBe(TSLA);
    expect(tsla.mid).toBeCloseTo((tsla.bid + tsla.ask) / 2);
    expect(tsla.halted).toBe(false);
    expect(tsla.at.toISOString()).toMatch(/^2026-09-30T/);
  });

  it("drops a quote it cannot identify or price", () => {
    const [good] = (copy(MARKETS_FX.prices) as { quotes: Json[] }).quotes;
    const bad = (edit: Json) => ({ ...good, ...edit });
    const q = parseQuotes({
      quotes: [
        7,
        bad({ tokenSymbol: "" }),
        bad({ deployments: [{ chainId: 8453, contractAddress: "0xabc" }] }),
        bad({ bid: "x" }),
        bad({ ask: null }),
        bad({ generatedAt: "soon" }),
        bad({ generatedAt: null }),
        bad({ tokenSymbol: "OK", dailyHigh: null, isTradingHalt: true }),
      ],
    });
    expect([...q.keys()]).toEqual(["OK"]);
    expect(q.get("OK")).toMatchObject({ high: null, halted: true });
    expect(parseQuotes(null).size).toBe(0);
  });

  it("reads them through this app's server, and says why when it cannot", async () => {
    markets();
    expect((await stockQuotes()).size).toBe(5);
    markets({ get: (u) => (u.startsWith(`${STOCKS_PATH}/prices`) ? DOWN : undefined) });
    await expect(stockQuotes()).rejects.toThrow("This app's server could not be reached for stock prices.");
    markets({ get: (u) => (u.startsWith(`${STOCKS_PATH}/prices`) ? new Response("<!doctype html>") : undefined) });
    await expect(stockQuotes()).rejects.toThrow("Stock prices need this app's server, which is not running here.");
    markets({ get: (u) => (u.startsWith(`${STOCKS_PATH}/prices`) ? json({ detail: "Robinhood's stock price API could not be reached." }, 502) : undefined) });
    await expect(stockQuotes()).rejects.toThrow("Stock prices are unavailable right now (Robinhood's stock price API could not be reached.).");
    markets({ get: (u) => (u.startsWith(`${STOCKS_PATH}/prices`) ? json([], 503) : undefined) });
    await expect(stockQuotes()).rejects.toThrow("(HTTP 503)");
  });
});

// ── the watchlist ───────────────────────────────────────────────────────────

describe("the watchlist", () => {
  const ADDR = "0x1111111111111111111111111111111111111111";

  it("starts from the default list", () => {
    expect(loadWatch()).toEqual(DEFAULT_WATCH);
  });

  it("keeps valid entries once each, and drops anything odd", () => {
    localStorage.setItem(
      WATCH_KEY,
      JSON.stringify([
        { kind: "stock", symbol: "TSLA" },
        { kind: "stock", symbol: "TSLA" },
        { kind: "basestock", symbol: "TSLA" },
        { kind: "stock", symbol: "bad symbol" },
        { kind: "token", address: ADDR, label: "A very long label indeed" },
        { kind: "token", address: "0x12", label: "x" },
        { kind: "token", address: "0xABCDEF0123456789abcdef0123456789ABCDEF01", label: "mismatch" },
        { kind: "token", address: ADDR },
        null,
        "x",
      ]),
    );
    expect(loadWatch()).toEqual([
      { kind: "stock", symbol: "TSLA" },
      // the same ticker on another chain is another asset (hard rule 2)
      { kind: "basestock", symbol: "TSLA" },
      { kind: "token", address: ADDR, label: "A very long " },
    ]);
  });

  it("falls back to the default when the record is unreadable — it is a preference, not money", () => {
    localStorage.setItem(WATCH_KEY, "{not json");
    expect(loadWatch()).toEqual(DEFAULT_WATCH);
    localStorage.setItem(WATCH_KEY, JSON.stringify({ kind: "stock" }));
    expect(loadWatch()).toEqual(DEFAULT_WATCH);
  });

  it("saves, and survives storage that refuses", () => {
    saveWatch([{ kind: "stock", symbol: "NVDA" }]);
    expect(loadWatch()).toEqual([{ kind: "stock", symbol: "NVDA" }]);
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    try {
      expect(() => saveWatch([])).not.toThrow();
    } finally {
      set.mockRestore();
    }
  });
});

// ── charts ──────────────────────────────────────────────────────────────────

describe("charts", () => {
  const series = parseCandles(MARKETS_FX.wethOhlcv);

  it("scales closes into the box and colours by direction", () => {
    const pts = points(series, 90, 26).split(" ");
    expect(pts).toHaveLength(24);
    expect(pts[0]!.startsWith("2.0,")).toBe(true);
    expect(pts[23]!.startsWith("88.0,")).toBe(true);
    const flat: Candle[] = [{ t: 0, o: 1, h: 1, l: 1, c: 1 }];
    expect(points(flat, 90, 26)).toBe("2.0,24.0");
    expect(direction([{ t: 0, o: 1, h: 2, l: 1, c: 2 }, { t: 1, o: 2, h: 2, l: 1, c: 1 }])).toBe("up");
    expect(direction([{ t: 0, o: 2, h: 2, l: 1, c: 2 }, { t: 1, o: 2, h: 2, l: 1, c: 1 }])).toBe("down");
  });

  it("writes change with its sign", () => {
    expect(formatChange(1.234)).toBe("+1.23%");
    expect(formatChange(-2.82)).toBe("−2.82%");
    expect(formatChange(0)).toBe("+0.00%");
    expect(formatChange(null)).toBe("—");
  });

  it("draws nothing it was not given", () => {
    render(
      <>
        <Sparkline series={series.slice(0, 1)} label="one" />
        <PriceChart series={[]} label="none" format={String} />
      </>,
    );
    expect(screen.getByText("no chart")).toBeInTheDocument();
    expect(screen.getByText(/fewer than two candles/)).toBeInTheDocument();
  });

  it("labels the chart's high, low, last and time span", () => {
    render(<PriceChart series={series} label="ETH, 1D" format={(n) => n.toFixed(0)} />);
    expect(screen.getByRole("img", { name: "ETH, 1D" })).toBeInTheDocument();
    expect(screen.getByText(/^high \d+ · low \d+ · last \d+$/)).toBeInTheDocument();
    expect(screen.getByText(/→/)).toBeInTheDocument();
  });

  it("names B20's paused features", () => {
    expect(pausedText([])).toBe("nothing paused");
    expect(pausedText([0, 1, 2, 3, 9])).toBe("paused: transfers, minting, burning, seizing, feature 9");
  });
});

// ── the provider, the gadget and the window ─────────────────────────────────

function Probe({ onReady }: { onReady: (m: ReturnType<typeof useMarkets>) => void }) {
  onReady(useMarkets());
  return null;
}

function mountMarkets(node: React.ReactNode, onOpen = vi.fn()) {
  let latest: ReturnType<typeof useMarkets> | null = null;
  const view = render(
    <MarketsProvider onOpen={onOpen}>
      <Probe onReady={(m) => (latest = m)} />
      {node}
    </MarketsProvider>,
  );
  return { onOpen, markets: () => latest!, view };
}

describe("MarketsProvider", () => {
  it("throws outside the provider", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<Probe onReady={() => {}} />)).toThrow("useMarkets() must be called inside <MarketsProvider>");
    } finally {
      quiet.mockRestore();
    }
  });

  it("prices every row from DexScreener in one request per chain, and Robinhood stocks from Robinhood's quote", async () => {
    const calls = markets();
    const { markets: m } = mountMarkets(null);
    await settle();
    const rows = m().rows;
    // Base first: the two tokens and the two Base stocks, then Robinhood Chain
    expect(rows.map((r) => `${r.venue}:${r.label}`)).toEqual(["base:ETH", "base:cbBTC", "base:NVDA", "base:AAPL", "robinhood:TSLA", "robinhood:SPY"]);
    expect(calls.filter((c) => c.url.startsWith(DEXSCREENER))).toHaveLength(2);
    expect(rows[0]).toMatchObject({ price: 2670.91, change: -1.7, depth: 4963660.28, pool: WETH_PAIR, name: null, stock: null, problem: null });
    expect(rows[2]).toMatchObject({ address: NVDA_ON_BASE, name: "NVIDIA Corporation", price: 230.55, quote: null });
    expect(rows[2]!.stock!.symbol).toBe("NVDAc");
    const tsla = rows[4]!;
    expect(tsla.price).toBe(parseQuotes(MARKETS_FX.prices).get("TSLA")!.mid);
    expect(tsla).toMatchObject({ address: TSLA, change: -1.7, pool: TSLA_PAIR });
    expect(rows[5]!.address).toBe(SPY);
    expect(m().symbols).toEqual(["AAPL", "CRM", "NVDA", "SPY", "TSLA"]);
    expect(m().baseSymbols).toEqual(["AAPL", "AMD", "DKNG", "GOOGL", "NVDA", "TSLA"]);
    expect(m().updatedAt).not.toBeNull();
  });

  it("reads charts one at a time, after the prices, from each row's own pool", async () => {
    const calls = markets();
    const { markets: m } = mountMarkets(null);
    await settle();
    const charts = calls.filter((c) => c.url.startsWith(CHARTS_PATH)).map((c) => c.url);
    expect(charts).toHaveLength(6);
    expect(charts[0]).toContain(`pool=${WETH_PAIR}`);
    const firstChart = calls.findIndex((c) => c.url.startsWith(CHARTS_PATH));
    expect(calls.slice(firstChart).some((c) => c.url.startsWith(DEXSCREENER))).toBe(false);
    expect(m().rows.every((r) => r.series?.length === 24)).toBe(true);
  });

  it("asks nothing it does not need: no stock lists for a watchlist of tokens", async () => {
    const calls = markets();
    localStorage.setItem(WATCH_KEY, JSON.stringify([{ kind: "token", address: WETH.address, label: "ETH" }]));
    mountMarkets(null);
    await settle();
    expect(calls.map((c) => c.url).filter((u) => u.startsWith("/api/stocks") || u.includes("/robinhood/"))).toEqual([]);
  });

  it("keeps an added Robinhood stock after the Base rows, whatever order it was added in", async () => {
    markets();
    localStorage.setItem(WATCH_KEY, JSON.stringify([{ kind: "stock", symbol: "TSLA" }, { kind: "token", address: WETH.address, label: "ETH" }]));
    const { markets: m } = mountMarkets(null);
    await settle();
    await act(async () => m().add({ kind: "basestock", symbol: "GOOGL" }));
    expect(m().rows.map((r) => r.label)).toEqual(["ETH", "GOOGL", "TSLA"]);
  });

  it("names a stock its list does not name, and says why when a list is down", async () => {
    let down = false;
    markets({ get: (u) => (u.startsWith("/api/stocks") && down ? DOWN : undefined) });
    localStorage.setItem(WATCH_KEY, JSON.stringify([{ kind: "basestock", symbol: "NOPE" }, { kind: "stock", symbol: "NOPE" }]));
    const { markets: m } = mountMarkets(null);
    await settle();
    expect(m().rows.map((r) => r.problem)).toEqual([
      "Coinbase's list of stocks on Base does not name NOPE.",
      "Robinhood's stock token list does not name NOPE.",
    ]);
    expect(m().rows[0]).toMatchObject({ address: null, depth: null, pool: null, chartProblem: "Coinbase's list of stocks on Base does not name NOPE." });
    forgetCatalog();
    down = true;
    await act(async () => m().add({ kind: "basestock", symbol: "NVDA" }));
    await act(async () => m().add({ kind: "stock", symbol: "NOPE3" }));
    await settle();
    expect(m().rows.find((r) => r.key === "basestock:NVDA")!.problem).toBe("This app's server could not be reached for the list of stocks on Base.");
    expect(m().rows.find((r) => r.key === "stock:NOPE3")!.problem).toBe("This app's server could not be reached for stock prices.");
  });

  it("keeps the last Robinhood quotes when one refresh fails", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ now: CAPTURED_AT, shouldAdvanceTime: true });
    let quotesDown = false;
    markets({ get: (u) => (u.startsWith(`${STOCKS_PATH}/prices`) && quotesDown ? DOWN : undefined) });
    localStorage.setItem(WATCH_KEY, JSON.stringify([{ kind: "stock", symbol: "TSLA" }]));
    const { markets: m } = mountMarkets(null);
    await settle();
    quotesDown = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS);
    });
    await settle();
    expect(m().rows[0]!.price).not.toBeNull();
    expect(m().rows[0]!.address).toBe(TSLA);
  });

  it("says why a price is missing — DexScreener down, or no market at all", async () => {
    markets({ get: (u) => (u.startsWith(`${DEXSCREENER}/base/`) ? DOWN : u.startsWith(`${DEXSCREENER}/robinhood/`) ? [] : undefined) });
    localStorage.setItem(WATCH_KEY, JSON.stringify([{ kind: "token", address: WETH.address, label: "ETH" }, { kind: "stock", symbol: "TSLA" }]));
    const { markets: m } = mountMarkets(null);
    await settle();
    const [eth, tsla] = m().rows;
    expect(eth).toMatchObject({ price: null, series: null, problem: "DexScreener could not be reached for prices. They are read again on the next refresh." });
    expect(eth!.chartProblem).toBe(eth!.problem);
    // a Robinhood stock keeps Robinhood's own quote even with no DEX market
    expect(tsla).toMatchObject({ problem: "No DEX market for it was found on DexScreener.", chartProblem: "No DEX market for it was found on DexScreener." });
    expect(tsla!.price).not.toBeNull();
  });

  it("keeps the price when the chart fails, and keeps the last chart when a later read fails", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ now: CAPTURED_AT, shouldAdvanceTime: true });
    let chartsDown = true;
    markets({ get: (u) => (u.startsWith(CHARTS_PATH) && chartsDown ? json({ detail: "GeckoTerminal is rate-limiting this server right now." }, 429) : undefined) });
    localStorage.setItem(WATCH_KEY, JSON.stringify([{ kind: "token", address: WETH.address, label: "ETH" }]));
    const { markets: m } = mountMarkets(null);
    await settle();
    expect(m().rows[0]).toMatchObject({ price: 2670.91, series: null, chartProblem: "GeckoTerminal is rate-limiting this server right now." });
    chartsDown = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS);
    });
    await settle();
    expect(m().rows[0]!.series).toHaveLength(24);
    chartsDown = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS);
    });
    await settle();
    expect(m().rows[0]!.series).toHaveLength(24);
    expect(m().rows[0]!.chartProblem).toBeNull();
  });

  it("stops an older refresh from writing over a newer one", async () => {
    markets();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const answered = globalThis.fetch;
    vi.stubGlobal("fetch", (u: string, i?: RequestInit) => (u.startsWith(CHARTS_PATH) || u.startsWith(DEXSCREENER) ? gate.then(() => answered(u, i)) : answered(u, i)));
    localStorage.setItem(WATCH_KEY, JSON.stringify([{ kind: "token", address: WETH.address, label: "ETH" }]));
    const { markets: m, view } = mountMarkets(null);
    await settle();
    // a new watchlist starts a new refresh while the first one is still waiting on DexScreener
    await act(async () => m().add({ kind: "token", address: CBBTC.address, label: "cbBTC" }));
    release();
    await settle();
    expect(m().rows.map((r) => r.price)).toEqual([2670.91, 83546.65]);
    // unmounting mid-chart leaves nothing to write
    let hold: () => void = () => {};
    const second = new Promise<void>((r) => (hold = r));
    vi.stubGlobal("fetch", (u: string, i?: RequestInit) => (u.startsWith(CHARTS_PATH) ? second.then(() => answered(u, i)) : answered(u, i)));
    await act(async () => m().add({ kind: "basestock", symbol: "NVDA" }));
    await settle();
    view.unmount();
    hold();
    await settle();
  });

  it("adds without duplicates, removes, resets, and opens on a pick", async () => {
    markets();
    const { markets: m, onOpen } = mountMarkets(null);
    await settle();
    await act(async () => m().add({ kind: "stock", symbol: "CRM" }));
    await act(async () => m().add({ kind: "stock", symbol: "CRM" }));
    expect(m().rows.filter((r) => r.label === "CRM")).toHaveLength(1);
    expect(m().focus).toBe("stock:CRM");
    await act(async () => m().remove("stock:CRM"));
    expect(m().rows.map((r) => r.label)).not.toContain("CRM");
    await act(async () => m().remove(watchKey(DEFAULT_WATCH[0]!)));
    await act(async () => m().reset());
    expect(m().rows).toHaveLength(DEFAULT_WATCH.length);
    await act(async () => m().pick("stock:TSLA"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(m().focus).toBe("stock:TSLA");
  });
});

describe("the desktop gadget", () => {
  it("says it is reading, with each chart pending, before anything answers", async () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    mountMarkets(<MarketsGadget />);
    await settle();
    expect(screen.getByRole("complementary", { name: "Markets" })).toHaveTextContent("Reading prices…");
    expect(screen.getByRole("button", { name: /ETH/ })).toHaveTextContent("…");
  });

  it("lists each asset with its price, change and sparkline, grouped by chain, Base first", async () => {
    markets();
    mountMarkets(<MarketsGadget />);
    await settle();
    const gadget = screen.getByRole("complementary", { name: "Markets" });
    expect(within(gadget).getAllByRole("button")).toHaveLength(6);
    expect(within(gadget).getByRole("img", { name: "TSLA, last 24 hours" })).toBeInTheDocument();
    expect(gadget).toHaveTextContent(/Updated/);
    expect(gadget).toHaveTextContent("Prices: DexScreener; Robinhood stocks: Robinhood's quote. Charts: GeckoTerminal, 24h.");
    const groups = within(gadget).getAllByRole("list");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Base", "Robinhood Chain"]);
    expect(within(groups[0]!).getByRole("button", { name: /NVDA/ })).toHaveTextContent("Base · stock");
    expect(within(groups[0]!).getByRole("button", { name: /ETH/ })).toHaveTextContent(/^ETHBase\$2,670\.91−1\.70%/);
    expect(within(groups[1]!).getByRole("button", { name: /TSLA/ })).toHaveTextContent("Robinhood · stock");
  });

  it("hides Robinhood Chain while it is switched off: no rows, no request, nothing to add — and keeps what was saved", async () => {
    flags.robinhood = false;
    const calls = markets();
    const { markets: m } = mountMarkets(
      <>
        <MarketsGadget />
        <MarketsPanel />
      </>,
    );
    await settle();
    const gadget = screen.getByRole("complementary", { name: "Markets" });
    expect(within(gadget).getAllByRole("list").map((g) => g.getAttribute("aria-label"))).toEqual(["Base"]);
    expect(gadget).toHaveTextContent("Prices: DexScreener. Charts: GeckoTerminal, 24h.");
    expect(m().rows.every((r) => r.venue === "base")).toBe(true);
    expect(calls.some((c) => c.url === `${STOCKS_PATH}/prices`)).toBe(false);
    expect(screen.queryByLabelText("Robinhood stock")).not.toBeInTheDocument();
    // an edit to the visible list keeps the hidden Robinhood entries in what is saved
    m().remove(watchKey(DEFAULT_WATCH.find((w) => w.kind === "token")!));
    expect(loadWatch().some((w) => w.kind === "stock")).toBe(true);
    m().add({ kind: "basestock", symbol: "AAPL" });
    expect(loadWatch().some((w) => w.kind === "stock")).toBe(true);
    flags.robinhood = true;
  });

  it("shows a dash and the reason instead of a zero, and a chart it could not read as none", async () => {
    markets({ get: (u) => (u.startsWith(DEXSCREENER) ? json({}, 500) : undefined) });
    localStorage.setItem(WATCH_KEY, JSON.stringify([{ kind: "token", address: WETH.address, label: "ETH" }]));
    mountMarkets(<MarketsGadget />);
    await settle();
    const row = screen.getByRole("button", { name: /ETH/ });
    expect(row).toHaveTextContent("—");
    expect(row).toHaveTextContent("no chart");
    expect(row).toHaveAttribute("title", "DexScreener answered 500. Prices are read again on the next refresh.");
  });

  it("says why only the chart is missing when the price is there", async () => {
    markets({ get: (u) => (u.startsWith(CHARTS_PATH) ? json({ detail: "GeckoTerminal is rate-limiting this server right now." }, 429) : undefined) });
    localStorage.setItem(WATCH_KEY, JSON.stringify([{ kind: "token", address: WETH.address, label: "ETH" }]));
    mountMarkets(<MarketsGadget />);
    await settle();
    const row = screen.getByRole("button", { name: /ETH/ });
    expect(row).toHaveTextContent("$2,670.91");
    expect(row).toHaveAttribute("title", "GeckoTerminal is rate-limiting this server right now.");
  });

  it("opens the window on the asset clicked", async () => {
    markets();
    const { onOpen, markets: m } = mountMarkets(<MarketsGadget />);
    await settle();
    await userEvent.click(screen.getByRole("button", { name: /NVDA/ }));
    expect(onOpen).toHaveBeenCalled();
    expect(m().focus).toBe("basestock:NVDA");
  });

  it("marks a price from a thin market, with its depth in the tooltip — but not a Robinhood quote", async () => {
    const thinTsla = copy(MARKETS_FX.dexRobinhood) as { liquidity: Json }[];
    thinTsla[0]!.liquidity.usd = 604.1;
    markets({ get: (u) => (u.startsWith(`${DEXSCREENER}/base/`) ? dexAt(604.1) : u.startsWith(`${DEXSCREENER}/robinhood/`) ? thinTsla : undefined) });
    localStorage.setItem(WATCH_KEY, JSON.stringify([{ kind: "basestock", symbol: "NVDA" }, { kind: "stock", symbol: "TSLA" }]));
    mountMarkets(<MarketsGadget />);
    await settle();
    const nvda = screen.getByRole("button", { name: /NVDA/ });
    expect(nvda.querySelector(".gadget__px")).toHaveClass("gadget__px--thin");
    expect(nvda).toHaveAttribute("title", "Thin market: $604 of liquidity — a small trade can move this price.");
    expect(screen.getByRole("button", { name: /TSLA/ }).querySelector(".gadget__px")).not.toHaveClass("gadget__px--thin");
  });

  it("marks a falling asset down and a rising one up", async () => {
    const rising = copy(MARKETS_FX.dexRobinhood) as { priceChange: Json }[];
    rising[0]!.priceChange.h24 = 4.2;
    markets({
      get: (u) =>
        u.includes("network=base")
          ? trend(MARKETS_FX.wethOhlcv, 0.5)
          : u.includes("network=robinhood")
            ? trend(MARKETS_FX.tslaOhlcv, 2)
            : u.startsWith(`${DEXSCREENER}/robinhood/`)
              ? rising
              : undefined,
    });
    localStorage.setItem(WATCH_KEY, JSON.stringify([{ kind: "token", address: WETH.address, label: "ETH" }, { kind: "stock", symbol: "TSLA" }]));
    mountMarkets(<MarketsGadget />);
    await settle();
    expect(screen.getByRole("button", { name: /ETH/ }).querySelector(".gadget__chg")).toHaveClass("down");
    expect(screen.getByRole("button", { name: /TSLA/ }).querySelector(".gadget__chg")).toHaveClass("up");
    expect(screen.getByRole("button", { name: /ETH/ }).querySelector(".spark--down")).not.toBeNull();
  });
});

describe("the Markets window", () => {
  it("shows the selected asset's chart and every fact about it, with sources", async () => {
    markets({ get: (u) => (u.includes("network=robinhood") ? trend(MARKETS_FX.tslaOhlcv, 2) : undefined) });
    const { markets: m } = mountMarkets(<MarketsPanel />);
    await settle();
    await act(async () => m().select("stock:TSLA"));
    expect(screen.getByRole("img", { name: "TSLA, 1D" })).toBeInTheDocument();
    const facts = screen.getByRole("region", { name: "TSLA" });
    expect(facts).toHaveTextContent("Robinhood's quote for the share (bid/ask mid)");
    expect(facts).toHaveTextContent(`${ROBINHOOD.name} (${ROBINHOOD.id})`);
    expect(within(facts).getByRole("link", { name: TSLA })).toHaveAttribute("href", `${ROBINHOOD.explorer}/token/${TSLA}`);
    expect(facts).toHaveTextContent("Bid / ask");
    expect(facts).toHaveTextContent("trading");
    expect(facts).toHaveTextContent("Sources: Robinhood Stock Token API, DexScreener (price), GeckoTerminal via this app's server (chart)");
    expect(facts).toHaveTextContent("Market depth$430,097 in the deepest pool");
    expect(facts).not.toHaveTextContent("thin");
    expect(facts).not.toHaveTextContent("stale");
    expect(within(facts).getByText("−1.70% — DexScreener").closest(".report__row")).toHaveClass("report__row--warn");
  });

  it("marks a stale or halted quote and a missing day range", async () => {
    markets({
      get: (u) =>
        u === `${STOCKS_PATH}/prices`
          ? freshPrices((q) => Object.assign(q, { isTradingHalt: true, dailyHigh: null, generatedAt: new Date(Date.now() - STALE_MS - 60_000).toISOString() }))
          : undefined,
    });
    const { markets: m } = mountMarkets(<MarketsPanel />);
    await settle();
    await act(async () => m().select("stock:TSLA"));
    const facts = screen.getByRole("region", { name: "TSLA" });
    expect(facts).toHaveTextContent("trading halted");
    expect(facts).toHaveTextContent("— stale");
    expect(facts).toHaveTextContent("Day rangenot reported");
  });

  it("shows a Base token's facts, and a longer range read for it alone from its own pool", async () => {
    const rising = copy(MARKETS_FX.dexBase) as { priceChange: Json }[];
    rising[0]!.priceChange.h24 = 3;
    const calls = markets({ get: (u) => (u.startsWith(`${DEXSCREENER}/base/`) ? rising : undefined) });
    mountMarkets(<MarketsPanel />);
    await settle();
    const facts = screen.getByRole("region", { name: "ETH" });
    expect(facts).toHaveTextContent("its deepest DEX pair (DexScreener)");
    expect(within(facts).getByText("+3.00% — DexScreener").closest(".report__row")).toHaveClass("report__row--ok");
    expect(facts).not.toHaveTextContent("Bid / ask");
    expect(within(facts).getByRole("link", { name: WETH.address })).toHaveAttribute("href", `https://basescan.org/token/${WETH.address}`);
    await userEvent.click(screen.getByRole("button", { name: "7D" }));
    await waitFor(() => expect(screen.getByRole("img", { name: "ETH, 7D" })).toBeInTheDocument());
    expect(calls.some((c) => c.url.includes(`pool=${WETH_PAIR}`) && c.url.includes("aggregate=4&limit=42"))).toBe(true);
  });

  it("says a chart could not be read, says when one is still being read, and says a chart is remembered", async () => {
    const stale = () => new Response(JSON.stringify(MARKETS_FX.wethOhlcv), { headers: { "x-quadra-stale": "1200" } });
    markets({ get: (u) => (u.includes("aggregate=4") ? json({ detail: "GeckoTerminal answered 503." }, 502) : u.includes("network=base") ? stale() : undefined) });
    const answered = globalThis.fetch;
    vi.stubGlobal("fetch", (u: string, i?: RequestInit) => (u.includes("limit=30") ? new Promise<Response>(() => {}) : answered(u, i)));
    mountMarkets(<MarketsPanel />);
    await settle();
    expect(screen.getByRole("region", { name: "ETH" })).toHaveTextContent("The chart is this app's remembered copy, 20 min old");
    await userEvent.click(screen.getByRole("button", { name: "7D" }));
    expect(await screen.findByLabelText("Chart unavailable")).toHaveTextContent("GeckoTerminal answered 503.");
    await userEvent.click(screen.getByRole("button", { name: "30D" }));
    expect(screen.getByText("Reading the chart…")).toBeInTheDocument();
  });

  it("shows a Coinbase stock by its name, shares per token, status and NAV — and says who may hold it", async () => {
    markets();
    const { markets: m } = mountMarkets(<MarketsPanel />);
    await settle();
    await act(async () => m().select("basestock:NVDA"));
    const facts = screen.getByRole("region", { name: "NVDA" });
    expect(facts).toHaveTextContent("NameNVIDIA Corporation");
    expect(facts).toHaveTextContent("Shares per token1 — one token is not always one share");
    expect(within(facts).getByText("nothing paused").closest(".report__row")).toHaveClass("report__row--ok");
    expect(facts).toHaveTextContent(/Reference \(NAV\)\$231\.28 per token — Chainlink, .*; not a trade price/);
    expect(facts).toHaveTextContent("Base (8453)");
    expect(within(facts).getByRole("link", { name: NVDA_ON_BASE })).toHaveAttribute("href", `https://basescan.org/token/${NVDA_ON_BASE}`);
    expect(facts).toHaveTextContent("only for persons in eligible jurisdictions outside the U.S.");
    expect(facts).toHaveTextContent("Sources: Coinbase Tokenized Stocks API, DexScreener (price)");
  });

  it("marks a paused stock, a multiplier that is not one, and a NAV with no time or none at all", async () => {
    const cb = copy(MARKETS_FX.coinbaseStocks) as { tokens: Json[] };
    cb.tokens.find((t) => t.symbol === "GOOGLc")!.nav_price_updated_at = null;
    markets({ get: (u) => (u === `${STOCKS_PATH}/base` ? cb : undefined) });
    localStorage.setItem(WATCH_KEY, JSON.stringify([{ kind: "basestock", symbol: "DKNG" }, { kind: "basestock", symbol: "GOOGL" }, { kind: "basestock", symbol: "AMD" }]));
    const { markets: m } = mountMarkets(<MarketsPanel />);
    await settle();
    const dkng = screen.getByRole("region", { name: "DKNG" });
    expect(within(dkng).getByText("paused: transfers, minting, burning").closest(".report__row")).toHaveClass("report__row--bad");
    await act(async () => m().select("basestock:GOOGL"));
    const googl = screen.getByRole("region", { name: "GOOGL" });
    expect(within(googl).getByText(/^1\.0003\d* — one token is not always one share$/).closest(".report__row")).toHaveClass("report__row--warn");
    expect(googl).toHaveTextContent("time not reported");
    await act(async () => m().select("basestock:AMD"));
    expect(screen.getByRole("region", { name: "AMD" })).toHaveTextContent("Reference (NAV)not published");
  });

  it("warns that a thin market's price is rough", async () => {
    markets({ get: (u) => (u.startsWith(`${DEXSCREENER}/base/`) ? dexAt(604.1) : undefined) });
    localStorage.setItem(WATCH_KEY, JSON.stringify([{ kind: "basestock", symbol: "AAPL" }]));
    mountMarkets(<MarketsPanel />);
    await settle();
    const facts = screen.getByRole("region", { name: "AAPL" });
    expect(within(facts).getByText("$604 in the deepest pool — thin").closest(".report__row")).toHaveClass("report__row--warn");
    expect(facts).toHaveTextContent(`Under $${THIN_MARKET_USD.toLocaleString("en-US")} of liquidity`);
  });

  it("shows a stock its list does not name as unnamed, with its reason", async () => {
    markets();
    localStorage.setItem(WATCH_KEY, JSON.stringify([{ kind: "basestock", symbol: "NOPE" }, { kind: "stock", symbol: "NOPE2" }]));
    const { markets: m } = mountMarkets(<MarketsPanel />);
    await settle();
    const facts = screen.getByRole("region", { name: "NOPE" });
    expect(facts).toHaveTextContent("not named by Coinbase's list of stocks on Base");
    expect(facts).toHaveTextContent("Pricenot available");
    expect(facts).toHaveTextContent("Market depthnot read");
    await userEvent.click(screen.getByRole("button", { name: "7D" }));
    expect(screen.getByText("Reading the chart…")).toBeInTheDocument();
    await act(async () => m().select("stock:NOPE2"));
    expect(screen.getByRole("region", { name: "NOPE2" })).toHaveTextContent("not named by Robinhood's list");
  });

  it("adds a Base stock from Coinbase's list, before anything from Robinhood", async () => {
    markets();
    const { markets: m } = mountMarkets(<MarketsPanel />);
    await settle();
    const form = screen.getByRole("group", { name: "Add to the watchlist" });
    expect(within(form).getAllByRole("combobox").map((c) => c.getAttribute("aria-label"))).toEqual(["Base stock", "Robinhood stock"]);
    await userEvent.selectOptions(screen.getByLabelText("Base stock"), "GOOGL");
    await userEvent.click(screen.getAllByRole("button", { name: "Add" })[0]!);
    expect(m().rows.map((r) => r.key)).toContain("basestock:GOOGL");
    expect(m().focus).toBe("basestock:GOOGL");
    expect(screen.getByLabelText("Base stock")).toHaveValue("");
  });

  it("says when a stock list is not loaded", async () => {
    markets({ get: (u) => (u.startsWith("/api/stocks") ? DOWN : undefined) });
    mountMarkets(<MarketsPanel />);
    await settle();
    expect(screen.getByRole("option", { name: "Coinbase's list is not loaded" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Robinhood's list is not loaded" })).toBeInTheDocument();
  });

  it("adds a stock from Robinhood's own list, and a Base token by address", async () => {
    const TOKEN = "0x2222222222222222222222222222222222222222";
    markets({ rpc: ethCalls({ [TOKEN]: contractAt(erc20Abi, { decimals: 8, symbol: "B20" }) }) });
    const { markets: m } = mountMarkets(<MarketsPanel />);
    await settle();
    expect(screen.getAllByRole("button", { name: "Add" })[2]).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Robinhood stock"), "CRM");
    await userEvent.click(screen.getAllByRole("button", { name: "Add" })[2]!);
    expect(m().rows.map((r) => r.label)).toContain("CRM");
    await userEvent.type(screen.getByLabelText("Base token address"), "0x12");
    await userEvent.click(screen.getAllByRole("button", { name: "Add" })[1]!);
    expect(await screen.findByLabelText("Markets error")).toHaveTextContent(/Token address/);
    await userEvent.clear(screen.getByLabelText("Base token address"));
    await userEvent.type(screen.getByLabelText("Base token address"), TOKEN);
    await userEvent.click(screen.getAllByRole("button", { name: "Add" })[1]!);
    await waitFor(() => expect(m().rows.map((r) => r.label)).toContain("B20"));
    expect(screen.getByLabelText("Base token address")).toHaveValue("");
  });

  it("removes the selected asset, empties to a message, and resets", async () => {
    markets();
    localStorage.setItem(WATCH_KEY, JSON.stringify([{ kind: "stock", symbol: "TSLA" }]));
    mountMarkets(<MarketsPanel />);
    await settle();
    await userEvent.click(screen.getByRole("button", { name: "Remove TSLA from the watchlist" }));
    expect(screen.getByText(/The watchlist is empty/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reset to the default list" }));
    await settle();
    expect(screen.getAllByRole("button", { name: /ETH|TSLA/ }).length).toBeGreaterThan(0);
  });

  it("selects an asset from its own list", async () => {
    markets();
    mountMarkets(<MarketsPanel />);
    await settle();
    const list = within(screen.getByRole("region", { name: "Watchlist" }));
    await userEvent.click(list.getByRole("button", { name: /SPY/ }));
    expect(list.getByRole("button", { name: /SPY/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "SPY" })).toBeInTheDocument();
  });
});

describe("on the desktop", () => {
  it("shows the gadget, and a click opens the Markets window on that asset", async () => {
    markets();
    renderAt("/");
    await settle();
    const gadget = screen.getByRole("complementary", { name: "Markets" });
    await userEvent.click(within(gadget).getByRole("button", { name: /AAPL/ }));
    await waitFor(() => expect(screen.getByLabelText("Markets", { selector: "section" })).toBeInTheDocument());
    expect(screen.getByRole("region", { name: "AAPL" })).toBeInTheDocument();
  });
});
