import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { WalletProvider } from "@/ui/WalletProvider";
import { OpenWindowProvider } from "@/features/openWindow";
import userEvent from "@testing-library/user-event";
import { erc20Abi } from "viem";
import { WETH } from "@/config/chain";
import { CBBTC, DEFAULT_WATCH, watchKey } from "@/config/markets";
import {
  baseStocks,
  stocksUrl,
  candles,
  change,
  DEXSCREENER,
  fillGaps,
  forgetCatalog,
  nextPageOf,
  STOCK_PAGES,
  parseBaseStocks,
  parseCandles,
  parsePoolTrades,
  parseQuotes,
  parseSpots,
  parseTokenPools,
  poolTrades,
  spots,
  stockQuotes,
  tokenPools,
  type Candle,
} from "@/adapters/http/markets";
import { COINBASE_STOCKS, stocksHandler, STOCKS_PATH } from "@/server/stocks";
import { chartsHandler, CHARTS_PATH, FRESH_MS, poolsUpstreamUrl, STALE_MS as SERVER_STALE_MS, tradesUpstreamUrl, upstreamUrl } from "@/server/charts";
import { loadWatch, saveWatch, WATCH_KEY } from "@/lib/watchlist";
import { CandleChart, direction, formatChange, points, PriceChart, Sparkline } from "@/features/markets/Chart";
import { MarketsProvider, REFRESH_MS, useMarkets } from "@/features/markets/MarketsProvider";
import { MarketsGadget } from "@/features/markets/MarketsGadget";
import { MarketsPanel, pausedText } from "@/features/panels/MarketsPanel";
import { categoriesOf, StocksLaunchPanel } from "@/features/panels/StocksLaunchPanel";
import { MemoryRouter, useLocation } from "react-router-dom";
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

  it("passes Coinbase's page token on for the stock list, and nothing else (2026-10-29)", async () => {
    const seen: string[] = [];
    const handle = stocksHandler((async (url: string) => {
      seen.push(url);
      return json({ tokens: [] });
    }) as unknown as typeof fetch);
    expect((await handle(req("/base?page_token=MHhiMjAw%2B%2F%3D"))).status).toBe(200);
    expect(seen).toEqual([`${COINBASE_STOCKS}?page_token=MHhiMjAw%2B%2F%3D`]);
    // a token of the wrong shape, or on the other route, is refused before anything is asked
    expect((await handle(req("/base?page_token=a%26b%3Dc"))).status).toBe(400);
    expect((await handle(req("/prices?page_token=abc"))).status).toBe(400);
    expect(seen).toHaveLength(1);
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
    expect(url(Q.replace("frame=hour", "frame=second"))).toMatchObject({ refused: expect.stringMatching(/frame\/aggregate/) });
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
    expect((await handle(req(Q, { path: "/unknown" }))).status).toBe(404);
    expect((await handle(req(Q, { method: "POST" }))).status).toBe(405);
    const bad = await handle(req(Q.replace("limit=24", "limit=0")));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ detail: "limit must be 1–100." });
    expect(typeof chartsHandler()).toBe("function");
  });

  it("validates and serves /trades and /pools routes", async () => {
    expect(tradesUpstreamUrl(new URLSearchParams())).toEqual({ refused: "network must be base or robinhood." });
    expect(tradesUpstreamUrl(new URLSearchParams("network=base"))).toEqual({ refused: "pool must be a 20- or 32-byte hex id." });
    expect(tradesUpstreamUrl(new URLSearchParams(`network=eth&pool=${WETH_PAIR}`))).toEqual({ refused: "network must be base or robinhood." });
    expect(tradesUpstreamUrl(new URLSearchParams("network=base&pool=bad"))).toEqual({ refused: "pool must be a 20- or 32-byte hex id." });
    expect(tradesUpstreamUrl(new URLSearchParams(`network=base&pool=${WETH_PAIR}`))).toContain(`/networks/base/pools/${WETH_PAIR}/trades`);
    expect(poolsUpstreamUrl(new URLSearchParams())).toEqual({ refused: "network must be base or robinhood." });
    expect(poolsUpstreamUrl(new URLSearchParams("network=base"))).toEqual({ refused: "token must be an address." });
    expect(poolsUpstreamUrl(new URLSearchParams(`network=eth&token=${WETH.address}`))).toEqual({ refused: "network must be base or robinhood." });
    expect(poolsUpstreamUrl(new URLSearchParams("network=base&token=bad"))).toEqual({ refused: "token must be an address." });
    expect(poolsUpstreamUrl(new URLSearchParams(`network=base&token=${WETH.address}`))).toContain(`/networks/base/tokens/${WETH.address.toLowerCase()}/pools?page=1`);
    const handle = chartsHandler((async () => json({ data: [] })) as unknown as typeof fetch);
    expect((await handle(req(`network=base&pool=${WETH_PAIR}`, { path: "/trades" }))).status).toBe(200);
    expect((await handle(req(`network=base&token=${WETH.address}`, { path: "/pools" }))).status).toBe(200);
    expect((await handle(req("network=base&pool=bad", { path: "/trades" }))).status).toBe(400);
  });
});

// ── reading the sources ─────────────────────────────────────────────────────

describe("DexScreener prices", () => {
  it("reads each token's deepest pair where it is the base token", () => {
    const got = parseSpots(MARKETS_FX.dexBase);
    expect([...got.keys()]).toEqual([WETH.address, CBBTC.address, NVDA_ON_BASE, AAPL_ON_BASE, "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b"].map((a) => a.toLowerCase()));
    expect(got.get(WETH.address.toLowerCase())).toMatchObject({ price: 2670.91, change: -1.7, depth: 4963660.28, pool: WETH_PAIR, symbol: "WETH", name: "Wrapped Ether" });
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

  it("reads EVERY page of Coinbase's list — AAPLc, NVDAc and SPCXc sat past the first (MEASURED 2026-10-29)", async () => {
    const page = (symbol: string, next?: string) => ({
      tokens: [{ symbol, contract_address: `0xb2${symbol.length.toString(16).padStart(38, "0")}`, decimals: 8, multiplier: 1, nav_price: 1 }],
      ...(next ? { next_page_token: next } : {}),
    });
    const asked: string[] = [];
    forgetCatalog();
    net({
      get: (u) => {
        asked.push(u);
        return u === `${STOCKS_PATH}/base` ? page("GOOGLc", "p2") : u === `${STOCKS_PATH}/base?page_token=p2` ? page("AAPLc", "p3") : u === `${STOCKS_PATH}/base?page_token=p3` ? { tokens: [], next_page_token: "p4" } : undefined;
      },
    });
    expect([...(await baseStocks()).keys()]).toEqual(["GOOGL", "AAPL"]);
    // an empty page ends the list even when it names a next one
    expect(asked).toHaveLength(3);
    expect(nextPageOf(null)).toBeNull();
  });

  it("stops after STOCK_PAGES pages, however many Coinbase says remain", async () => {
    let n = 0;
    forgetCatalog();
    net({ get: (u) => (u.startsWith(`${STOCKS_PATH}/base`) ? { tokens: [{ symbol: `S${n}c`, contract_address: `0xb2${(n++).toString(16).padStart(38, "0")}`, decimals: 8, multiplier: 1 }], next_page_token: "more" } : undefined) });
    expect((await baseStocks()).size).toBe(STOCK_PAGES);
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

  it("removes a watched asset, empties to a message, and resets", async () => {
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

  it("renders no bottom detail panel and no Check buttons", async () => {
    markets();
    mountMarkets(<MarketsPanel />);
    await settle();
    expect(screen.queryByRole("button", { name: "Check" })).toBeNull();
    expect(screen.queryByRole("region", { name: /Selected market/ })).toBeNull();
  });
});

describe("on the desktop", () => {
  it("is not on the desktop any more — one door per job (2026-10-29); the Markets window keeps it", async () => {
    markets();
    renderAt("/");
    await settle();
    expect(screen.queryByRole("complementary", { name: "Markets" })).toBeNull();
  });
});

describe("the Markets window's table and directory", () => {
  function mountWithCommands() {
    const open = vi.fn();
    const view = render(
      <OpenWindowProvider open={open as never}>
        <MarketsProvider onOpen={vi.fn()}>
          <MarketsPanel />
        </MarketsProvider>
      </OpenWindowProvider>,
    );
    return { open, view };
  }
  const watchlist = () => screen.getByRole("region", { name: "Watchlist" });
  const marketNames = () => within(watchlist()).queryAllByRole("row").slice(1).map((r) => r.querySelector("strong")?.textContent);

  it("filters by kind and by a search, sorts by Price, 24h Change, Vol 24h, Liquidity, and Oracle Gap, and says when nothing matches", async () => {
    markets();
    mountWithCommands();
    await settle();
    const all = marketNames();
    expect(all.length).toBeGreaterThan(2);
    await userEvent.click(screen.getByRole("button", { name: "Stock tokens" }));
    expect(marketNames()).not.toContain("ETH");
    await userEvent.click(screen.getByRole("button", { name: "Crypto" }));
    expect(marketNames()).toContain("ETH");
    expect(marketNames()).not.toContain("NVDA");
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    for (const column of ["Price", "24h Change", "Vol 24h", "Liquidity", "Oracle Gap"]) {
      await userEvent.click(within(watchlist()).getByRole("button", { name: new RegExp(`^${column}`) }));
      const once = marketNames();
      await userEvent.click(within(watchlist()).getByRole("button", { name: new RegExp(`^${column}`) }));
      expect(marketNames()).toHaveLength(once.length);
    }
    await userEvent.type(screen.getByLabelText("Search markets"), "nvidia");
    expect(marketNames().filter(Boolean)).toContain("NVDA");
    await userEvent.clear(screen.getByLabelText("Search markets"));
    await userEvent.type(screen.getByLabelText("Search markets"), WETH.address.toLowerCase());
    expect(marketNames()).toContain("ETH");
    await userEvent.clear(screen.getByLabelText("Search markets"));
    await userEvent.type(screen.getByLabelText("Search markets"), "zzzz-no-such");
    expect(screen.getByText("No markets match that filter.")).toBeInTheDocument();
  });

  it("opens an independent token window when clicking an active pill, watchlist row, or Trade button", async () => {
    markets();
    const { open } = mountWithCommands();
    await settle();
    const pills = screen.getAllByRole("button", { pressed: false }).filter((b) => b.classList.contains("mk__pill"));
    await userEvent.click(pills[0]!);
    expect(open).toHaveBeenLastCalledWith(expect.stringMatching(/^token:0x[0-9a-f]{40}$/));
    const rows = within(watchlist()).getAllByRole("row").slice(1);
    await userEvent.click(within(rows[0]!).getByRole("button", { name: "Trade" }));
    expect(open).toHaveBeenLastCalledWith(expect.stringMatching(/^token:0x[0-9a-f]{40}$/));
  });

  it("lists every Base market in a directory with Price, Vol 24h, Watch toggle, Trade token window, and Show more", async () => {
    markets();
    const { open } = mountWithCommands();
    await settle();
    const directory = screen.getByRole("region", { name: "All Base markets" });
    const dirRows = () => within(directory).getAllByRole("row").slice(1);
    const unwatched = () => dirRows().filter((r) => within(r).queryByRole("button", { name: "+ Watch" }));
    const before = unwatched().length;
    await userEvent.click(within(unwatched()[0]!).getByRole("button", { name: "+ Watch" }));
    expect(unwatched().length).toBe(before - 1);
    await userEvent.click(within(dirRows()[0]!).getByRole("button", { name: "Trade" }));
    expect(open).toHaveBeenLastCalledWith(expect.stringMatching(/^token:0x[0-9a-f]{40}$/));
    expect(within(directory).queryByRole("button", { name: "Check" })).toBeNull();
  });
});

describe("the Markets window's edges and table behavior", () => {
  function mountAll(open = vi.fn(), withCommands = true) {
    let latest: ReturnType<typeof useMarkets> | null = null;
    const inner = (
      <WalletProvider>
        <MarketsProvider onOpen={vi.fn()}>
          <Probe onReady={(m) => (latest = m)} />
          <MarketsPanel />
        </MarketsProvider>
      </WalletProvider>
    );
    render(withCommands ? <OpenWindowProvider open={open as never}>{inner}</OpenWindowProvider> : inner);
    return () => latest!;
  }
  const watchlist = () => screen.getByRole("region", { name: "Watchlist" });

  it("omits the inline trade box from Markets (trading lives in independent Token windows)", async () => {
    markets();
    const m = mountAll();
    await settle();
    await act(async () => m().select("basestock:NVDA"));
    expect(screen.queryByRole("complementary", { name: "Trade NVDA" })).toBeNull();
  });

  it("marks a premium and a discount to NAV in the Watchlist table and toggles column sort arrows", async () => {
    const dex = copy(MARKETS_FX.dexBase) as { baseToken: { symbol: string }; priceUsd: string; priceChange: Json }[];
    dex.find((p) => p.baseToken.symbol === "NVDAc")!.priceUsd = "240";
    delete dex.find((p) => p.baseToken.symbol === "cbBTC")!.priceChange.h24;
    markets({ get: (u) => (u.startsWith(`${DEXSCREENER}/base/`) ? dex : undefined) });
    mountAll();
    await settle();
    expect(within(watchlist()).getByText(/^\+3\.\d\d%$/)).toBeInTheDocument();
    expect(within(watchlist()).getByText(/^-0\.\d\d%$/)).toBeInTheDocument();
    const price = within(watchlist()).getByRole("button", { name: /^Price/ });
    await userEvent.click(price);
    expect(price).toHaveTextContent("↓");
    await userEvent.click(price);
    expect(price).toHaveTextContent("↑");
    await userEvent.click(price);
    expect(price).toHaveTextContent("↓");
  });

  it("expands the Base directory with Show more and adds a Base stock via + Watch", async () => {
    const big = copy(MARKETS_FX.coinbaseStocks) as { tokens: Json[] };
    const base = big.tokens[0]!;
    for (let i = 0; i < 40; i++) big.tokens.push({ ...base, contract_address: `0xb2000000000000000000${(1000 + i).toString(16).padStart(20, "0")}`, symbol: `ZZ${i}c`, name: `Test Co ${i}` });
    markets({ get: (u) => (u === `${STOCKS_PATH}/base` ? big : undefined) });
    const m = mountAll();
    await settle();
    const directory = screen.getByRole("region", { name: "All Base markets" });
    await userEvent.click(within(directory).getByRole("button", { name: /^Show more/ }));
    const row = within(directory).getAllByRole("row").find((r) => r.textContent?.includes("STOCK") && within(r).queryByRole("button", { name: "+ Watch" }))!;
    await userEvent.click(within(row).getByRole("button", { name: "+ Watch" }));
    expect(m().rows.filter((r) => r.watch.kind === "basestock").length).toBeGreaterThan(2);
    const wlRows = within(watchlist()).getAllByRole("row").slice(1);
    await userEvent.click(wlRows[0]!);
    await userEvent.click(within(wlRows[0]!).getAllByRole("button")[0]!);
    const dirRows = within(directory).getAllByRole("row").slice(1);
    await userEvent.click(dirRows[0]!);
    await userEvent.click(within(directory).getAllByRole("button", { name: "Unwatch" })[0]!);
  });

  it("parses and fetches ranked tokenPools and poolTrades, and exercises CandleChart line/candles/volume/crosshair", async () => {
    const p1 = "0x1111111111111111111111111111111111111111";
    const p2 = "0x2222222222222222222222222222222222222222";
    const p3 = "0x3333333333333333333333333333333333333333";
    const poolsBody = {
      data: [
        null,
        { attributes: { address: "bad" } },
        {
          attributes: { address: p1, name: null, reserve_in_usd: "5000", volume_usd: { h24: "0" }, quote_token_price_usd: "10" },
          relationships: { base_token: { data: { id: "base_0x9999" } }, dex: {} },
        },
        {
          attributes: { address: p2, name: "WETH / USDC", reserve_in_usd: "1000", volume_usd: { h24: "200" }, base_token_price_usd: "2500", price_change_percentage: { h24: "1.5" } },
          relationships: { base_token: { data: { id: `base_${WETH.address.toLowerCase()}` } }, dex: { data: { id: "uniswap_v4" } } },
        },
        {
          attributes: { address: p3, name: "WETH / ETH", reserve_in_usd: "2000", volume_usd: { h24: "100" }, base_token_price_usd: "2500", price_change_percentage: { h24: "-1" } },
          relationships: { base_token: { data: { id: `base_${WETH.address.toLowerCase()}` } }, dex: { data: { id: "aerodrome" } } },
        },
      ],
    };
    const ranked = parseTokenPools(poolsBody, WETH.address);
    expect(ranked.map((r) => r.address)).toEqual([p3, p2, p1]);
    expect(ranked[2]!.name).toBe("0x1111…1111");
    expect(ranked[2]!.isBase).toBe(false);
    expect(parseTokenPools(null, WETH.address)).toEqual([]);

    markets({ get: (u) => (u.startsWith(`${CHARTS_PATH}/pools`) ? poolsBody : u.startsWith(`${CHARTS_PATH}/trades`) ? { data: [] } : undefined) });
    expect((await tokenPools("base", WETH.address)).length).toBe(3);
    expect(await poolTrades("base", p2, WETH.address)).toEqual([]);
    markets({ get: (u) => (u.startsWith(`${CHARTS_PATH}/pools`) || u.startsWith(`${CHARTS_PATH}/trades`) ? json({}, 502) : undefined) });
    await expect(tokenPools("base", WETH.address)).rejects.toThrow("Pools unavailable (HTTP 502).");
    await expect(poolTrades("base", p2, WETH.address)).rejects.toThrow("Trades unavailable (HTTP 502).");

    const flipped = parsePoolTrades(
      {
        data: [
          null,
          { attributes: { kind: "weird", tx_hash: "0x1", block_timestamp: "bad" } },
          {
            attributes: {
              kind: "buy",
              tx_hash: "0xaa",
              block_timestamp: "2026-10-02T07:59:00Z",
              from_token_address: WETH.address,
              to_token_address: p1,
              from_token_amount: "2",
              to_token_amount: "5000",
              volume_in_usd: "5000",
              price_from_in_usd: "2500",
              tx_from_address: p2,
            },
          },
          {
            attributes: {
              kind: "sell",
              tx_hash: "0xbb",
              block_timestamp: "2026-10-02T07:58:00Z",
              from_token_address: p1,
              to_token_address: WETH.address,
              from_token_amount: "1000",
              to_token_amount: "0.4",
              volume_in_usd: "1000",
              price_to_in_usd: "2500",
              tx_from_address: p2,
            },
          },
        ],
      },
      WETH.address,
      false,
    );
    expect(flipped.map((t) => t.side)).toEqual(["sell", "buy"]);

    const { rerender } = render(<CandleChart series={[]} label="empty" format={String} />);
    expect(screen.getByText(/fewer than two candles/)).toBeInTheDocument();
    const multiDay: Candle[] = [
      { t: Date.parse("2026-10-01T00:00:00Z"), o: 100, h: 110, l: 95, c: 105, v: 500 },
      { t: Date.parse("2026-10-02T00:00:00Z"), o: 105, h: 108, l: 90, c: 92, v: 300 },
      { t: Date.parse("2026-10-03T00:00:00Z"), o: 92, h: 100, l: 91, c: 95, v: 0 },
      { t: Date.parse("2026-10-04T00:00:00Z"), o: 95, h: 120, l: 91, c: 115 },
    ];
    rerender(<CandleChart series={multiDay} title="ETH/USD" label="ETH candles" format={(n) => `$${n.toFixed(0)}`} style="candles" />);
    const svg = screen.getByRole("img", { name: "ETH candles" });
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 640, height: 268, right: 640, bottom: 268, x: 0, y: 0, toJSON: () => {} });
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.mouseMove(svg, { clientX: 200, clientY: 100 });
    fireEvent.mouseMove(svg, { clientX: 620, clientY: 100 });
    fireEvent.mouseLeave(svg);

    rerender(<CandleChart series={multiDay} label="ETH line up" format={String} style="line" />);
    const downSeries: Candle[] = [
      { t: Date.parse("2026-10-01T00:00:00Z"), o: 120, h: 125, l: 100, c: 105 },
      { t: Date.parse("2026-10-01T01:00:00Z"), o: 105, h: 106, l: 90, c: 95 },
    ];
    rerender(<CandleChart series={downSeries} label="ETH line down" format={String} style="line" />);
    // flat zero and flat non-zero series cover padSpan & zero-open pct branches
    rerender(<CandleChart series={[{ t: 1, o: 0, h: 0, l: 0, c: 0 }, { t: 2, o: 0, h: 0, l: 0, c: 0 }]} label="flat zero" format={String} style="candles" />);
    rerender(<CandleChart series={[{ t: 1, o: 5, h: 5, l: 5, c: 5 }, { t: 2, o: 5, h: 5, l: 5, c: 5 }]} label="flat five" format={String} style="candles" />);

    // Additional markets.ts parser edge branches
    expect(parseCandles({ data: { attributes: { ohlcv_list: [[1000, 1, 2, 1, 2]] } } })).toEqual([{ t: 1_000_000, o: 1, h: 2, l: 1, c: 2 }]);
    expect(parsePoolTrades(null, WETH.address)).toEqual([]);
    expect(
      parsePoolTrades(
        {
          data: [
            { attributes: { kind: "buy", tx_hash: "0x1", block_timestamp: "2026-10-02T07:59:00Z" } },
            { attributes: { kind: "sell", tx_hash: "0x2", block_timestamp: "2026-10-02T07:58:00Z" } },
          ],
        },
        WETH.address,
      ).map((t) => [t.side, t.tokens]),
    ).toEqual([["buy", 0], ["sell", 0]]);
    const tiePools = parseTokenPools(
      {
        data: [
          { attributes: { address: p1, name: "A", reserve_in_usd: null, volume_usd: { h24: "50" } } },
          { attributes: { address: p2, name: "B", reserve_in_usd: null, volume_usd: { h24: "150" } } },
          { attributes: { address: p3, name: "C", reserve_in_usd: null, volume_usd: {} } },
        ],
      },
      WETH.address,
    );
    expect(tiePools.map((x) => x.address)).toEqual([p2, p1, p3]);
  });
});

describe("StocksLaunchPanel", () => {
  const mkStock = (ticker: string, name: string) => ({
    ticker,
    symbol: `${ticker}c`,
    name,
    address: NVDA_ON_BASE,
    decimals: 8,
    multiplier: 1,
    paused: [],
    nav: 100,
    navAt: null,
    icon: null,
  });

  it("categorizes stocks by exact ticker and name keywords, falling back to consumer", () => {
    expect(categoriesOf(mkStock("NVDA", "NVIDIA Corporation"))).toEqual(["big-tech", "ai-chips"]);
    expect(categoriesOf(mkStock("ZZ1", "Acme Semiconductor Corp"))).toEqual(["ai-chips"]);
    expect(categoriesOf(mkStock("ZZ2", "Global Bitcoin Mining"))).toEqual(["crypto"]);
    expect(categoriesOf(mkStock("ZZ3", "Orbital Rocket Satellite"))).toEqual(["space-defense"]);
    expect(categoriesOf(mkStock("ZZ4", "Acme Cloud Software"))).toEqual(["cloud"]);
    expect(categoriesOf(mkStock("ZZ5", "First National Bank Holdings"))).toEqual(["finance"]);
    expect(categoriesOf(mkStock("ZZ6", "Solar Energy Power"))).toEqual(["energy"]);
    expect(categoriesOf(mkStock("ZZ7", "Bio Therapeutics Health"))).toEqual(["health"]);
    expect(categoriesOf(mkStock("ZZ8", "Auto Mobility Corp"))).toEqual(["mobility"]);
    expect(categoriesOf(mkStock("ZZ9", "Global Media Streaming"))).toEqual(["media"]);
    expect(categoriesOf(mkStock("ZZ10", "Heavy Industrial Logistics"))).toEqual(["industrials"]);
    expect(categoriesOf(mkStock("ZZ11", "Plain Bakery Co"))).toEqual(["consumer"]);
  });

  function Where() {
    const l = useLocation();
    return <output aria-label="stocks-url">{l.search}</output>;
  }

  function mountStocks(path = "/?do=stocks", open = vi.fn()) {
    return {
      open,
      ...render(
        <MemoryRouter initialEntries={[path]}>
          <OpenWindowProvider open={open as never}>
            <StocksLaunchPanel />
            <Where />
          </OpenWindowProvider>
        </MemoryRouter>,
      ),
    };
  }

  it("shows error when Coinbase stocks fail to load", async () => {
    markets({ get: (u) => (u === `${STOCKS_PATH}/base` ? DOWN : undefined), rpc: () => DOWN });
    const v = mountStocks();
    await settle();
    expect(screen.getByText(/Could not read the stocks directory:/)).toBeInTheDocument();
    v.unmount();
  });

  it("filters, sorts, searches, toggles grid/list views, paginates with Show more, and deep-links ?s=NVDA", async () => {
    const big = copy(MARKETS_FX.coinbaseStocks) as { tokens: Json[] };
    const base = big.tokens[0]!;
    for (let i = 0; i < 50; i++) {
      big.tokens.push({
        ...base,
        contract_address: `0xb2000000000000000000${(2000 + i).toString(16).padStart(20, "0")}`,
        symbol: `STK${i}c`,
        name: `Sample Co ${i}`,
        nav_price: i === 0 ? null : 10 + i,
      });
    }
    const dex = copy(MARKETS_FX.dexBase) as (Json & { baseToken: { symbol: string }; priceChange?: Json; volume?: Json })[];
    dex.find((p) => p.baseToken.symbol === "NVDAc")!.volume = { h24: 120_000 };
    dex.find((p) => p.baseToken.symbol === "NVDAc")!.priceChange = { h24: 2.5 };
    markets({
      get: (u) => (u === `${STOCKS_PATH}/base` ? big : u.startsWith(`${DEXSCREENER}/base/`) ? dex : undefined),
      rpc: () => DOWN,
    });
    const { open, unmount } = mountStocks();
    await settle();

    expect(screen.getByRole("list", { name: "Stocks grid" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Show more/ }));

    await userEvent.click(screen.getByRole("button", { name: /AI & chips/ }));
    expect(screen.getByRole("button", { name: "Show all categories" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /AI & chips/ }));
    await userEvent.click(screen.getByRole("button", { name: /Big tech/ }));
    await userEvent.click(screen.getByRole("button", { name: "Show all categories" }));

    await userEvent.click(screen.getByRole("button", { name: /^Launch ready/ }));
    expect(screen.getByText("No stock matches that filter.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Liquidity ≥ \$5K/ }));
    await userEvent.click(screen.getByRole("button", { name: /^All \d+/ }));

    for (const label of ["Vol 24h", "Price", "A–Z", "Liquidity"]) {
      await userEvent.click(screen.getByRole("button", { name: label }));
    }

    await userEvent.type(screen.getByLabelText("Search stocks"), "NVDA");
    await userEvent.click(screen.getByRole("button", { name: "Trade NVDA" }));
    expect(open).toHaveBeenLastCalledWith(`token:${NVDA_ON_BASE.toLowerCase()}`);
    await userEvent.click(screen.getByRole("button", { name: "NVDA" }));
    expect(open).toHaveBeenLastCalledWith(`token:${NVDA_ON_BASE.toLowerCase()}`);

    await userEvent.click(screen.getByRole("button", { name: "List" }));
    const tbl = screen.getByRole("table", { name: "Stocks table" });
    const row = within(tbl).getAllByRole("row")[1]!;
    await userEvent.click(row);
    await userEvent.click(within(row).getByRole("button", { name: "NVDA" }));
    await userEvent.click(within(row).getByRole("button", { name: "Trade NVDA" }));
    expect(open).toHaveBeenLastCalledWith(`token:${NVDA_ON_BASE.toLowerCase()}`);
    unmount();

    const deep = mountStocks("/?do=stocks&s=NVDA");
    await settle();
    expect(deep.open).toHaveBeenCalledWith(`token:${NVDA_ON_BASE.toLowerCase()}`);
    expect(screen.getByLabelText("stocks-url")).not.toHaveTextContent("s=");
    deep.unmount();

    // Unknown ?s= ticker is ignored cleanly, and enabled launchReady stock shows Launch buttons in Grid and List
    const dexNeg = copy(MARKETS_FX.dexBase) as (Json & { baseToken: { symbol: string }; priceChange?: Json })[];
    dexNeg.find((p) => p.baseToken.symbol === "NVDAc")!.priceChange = { h24: -3.25 };
    const enabledQuote = `0x${"0".repeat(63)}1${"0".repeat(64)}`;
    markets({
      get: (u) => (u === `${STOCKS_PATH}/base` ? MARKETS_FX.coinbaseStocks : u.startsWith(`${DEXSCREENER}/base/`) ? dexNeg : undefined),
      rpc: (m) => (m === "eth_call" ? enabledQuote : undefined),
    });
    const ready = mountStocks("/?do=stocks&s=NO_SUCH");
    await settle();
    expect(ready.open).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Launch with NVDA" }));
    expect(ready.open).toHaveBeenLastCalledWith("launch", { pair: NVDA_ON_BASE });
    await userEvent.click(screen.getByRole("button", { name: "List" }));
    const listTbl = screen.getByRole("table", { name: "Stocks table" });
    await userEvent.click(within(listTbl).getAllByRole("button", { name: "Launch" })[0]!);
    expect(ready.open).toHaveBeenLastCalledWith("launch", { pair: expect.stringMatching(/^0x/) });
    ready.unmount();

    // Unmount mid-fetch (!live branches), no factory configured (!factoryAt), and US restricted region (closed banner)
    const { CONTRACTS } = await import("@/config/chain");
    const { forgetRegion } = await import("@/lib/region");
    const prevV3 = CONTRACTS.launchFactoryV3;
    const prevV2 = CONTRACTS.launchFactory;
    (CONTRACTS as { launchFactoryV3: string | null; launchFactory: string | null }).launchFactoryV3 = null;
    (CONTRACTS as { launchFactoryV3: string | null; launchFactory: string | null }).launchFactory = null;
    forgetRegion();
    forgetCatalog();
    markets({
      get: (u) => (u === "/api/region" ? { country: "US" } : u === `${STOCKS_PATH}/base` ? MARKETS_FX.coinbaseStocks : undefined),
      rpc: () => DOWN,
    });
    const closedView = mountStocks();
    await settle();
    expect(screen.getByText(/not offered where you are/)).toBeInTheDocument();
    closedView.unmount();
    (CONTRACTS as { launchFactoryV3: string | null; launchFactory: string | null }).launchFactoryV3 = prevV3;
    (CONTRACTS as { launchFactoryV3: string | null; launchFactory: string | null }).launchFactory = prevV2;
    forgetRegion();

    // Unmount before baseStocks/launchPairs settle
    forgetCatalog();
    markets({ rpc: (m) => (m === "eth_call" ? enabledQuote : undefined) });
    mountStocks().unmount();
    await settle();

    // Markets.ts remaining branch (both pools with null volume24hUsd)
    expect(parsePoolTrades({ data: [{ attributes: { kind: "buy", tx_hash: "0x1" } }] }, WETH.address)).toEqual([]);
    expect(
      parseTokenPools(
        {
          data: [
            { attributes: { address: "0x1111111111111111111111111111111111111111", name: "A", reserve_in_usd: "100", volume_usd: {} } },
            { attributes: { address: "0x2222222222222222222222222222222222222222", name: "B", reserve_in_usd: "200", volume_usd: {} } },
          ],
        },
        WETH.address,
      ),
    ).toHaveLength(2);

    // MarketsPanel remaining branches: thin market + volume24h in Watchlist, openWindow=null click, Vol 24h sort, preloadKey empty
    forgetCatalog();
    const thinDex = dexAt(604.1) as (Json & { volume?: Json })[];
    thinDex[0]!.volume = { h24: 5000 };
    markets({
      get: (u) => {
        if (u === `${STOCKS_PATH}/base`) return { tokens: [] };
        if (u.startsWith(`${DEXSCREENER}/base/`)) {
          const addrs = u.slice(`${DEXSCREENER}/base/`.length).split(",");
          return [
            ...thinDex,
            ...addrs.map((a) => ({
              baseToken: { address: a, symbol: "T", name: "T" },
              pairAddress: "0x3333333333333333333333333333333333333333",
              priceUsd: "1",
              liquidity: { usd: 604.1 },
              volume: { h24: 1000 },
            })),
          ];
        }
        return undefined;
      },
    });
    const vThin = render(
      <WalletProvider>
        <MarketsProvider onOpen={vi.fn()}>
          <MarketsPanel />
        </MarketsProvider>
      </WalletProvider>,
    );
    await settle();
    const wl = screen.getByRole("region", { name: "Watchlist" });
    const firstRow = within(wl).getAllByRole("row")[1]!;
    await userEvent.click(firstRow);
    await userEvent.click(within(wl).getByRole("button", { name: /^Vol 24h/ }));
    vThin.unmount();

    // Empty spots response + unmount mid-preload
    markets({ get: (u) => (u.startsWith(`${DEXSCREENER}/base/`) ? [] : undefined) });
    render(
      <WalletProvider>
        <MarketsProvider onOpen={vi.fn()}>
          <MarketsPanel />
        </MarketsProvider>
      </WalletProvider>,
    ).unmount();
    await settle();
  });
});
