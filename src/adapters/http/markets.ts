import { type Venue } from "@/config/markets";
import { toChecksumAddress } from "@/lib/address";
import { isObj, listOf, numOf, objAt, strOf } from "@/skills/json";
import { CHARTS_PATH } from "@/server/charts";
import { COINBASE_STOCKS, STOCKS_PATH } from "@/server/stocks";

/** The header this app's own server routes require — against another site spending them. */
const SERVER_HEADER = "x-quadra";

/**
 * Prices and candles for the Markets gadget, the Markets window and Trade. Every figure names
 * where it came from: a token's price, 24h change and depth are its deepest DEX pair on
 * DexScreener; a Robinhood stock's price is Robinhood's own quote for the share; every chart is
 * on-chain trades as GeckoTerminal indexes them, cached by this app's server. They are different
 * facts and the UI keeps them apart rather than blending one into the other.
 */

export type Candle = { readonly t: number; readonly o: number; readonly h: number; readonly l: number; readonly c: number };

/** How far back a chart looks, as GeckoTerminal is asked for it. */
export type Range = "1D" | "7D" | "30D";

const RANGES: Record<Range, { readonly frame: "hour" | "day"; readonly aggregate: number; readonly limit: number }> = {
  "1D": { frame: "hour", aggregate: 1, limit: 24 },
  "7D": { frame: "hour", aggregate: 4, limit: 42 },
  "30D": { frame: "day", aggregate: 1, limit: 30 },
};

/**
 * Prices, 24h change and depth from DexScreener — every watched token on a chain in ONE request.
 *
 * MEASURED 2026-09-30: `GET /tokens/v1/<chain>/<a,b,c…>` (up to 30 addresses) answers CORS `*`,
 * rate-limited at 300 a minute, with pairs carrying `priceUsd`, `priceChange.h24`,
 * `liquidity.usd` and the pair's address — which is also GeckoTerminal's pool id, so the chart
 * needs no second lookup. Robinhood Chain is `robinhood` there, as on GeckoTerminal. This
 * replaced reading prices off GeckoTerminal candles, which left every row "unavailable" the
 * moment GeckoTerminal rate-limited the visitor — measured on the owner's screen the same day.
 */
export const DEXSCREENER = "https://api.dexscreener.com/tokens/v1";
const BATCH = 30;

/** One token's market, from its deepest pair where it is the BASE token (so `priceUsd` is its price). */
export type Spot = {
  readonly price: number | null;
  /** percent over 24 hours */
  readonly change: number | null;
  /** USD liquidity of that pair */
  readonly depth: number | null;
  /** the pair's address — GeckoTerminal's pool id for the same market */
  readonly pool: string;
  readonly symbol: string | null;
  readonly name: string | null;
};

export function parseSpots(body: unknown): Map<string, Spot> {
  const out = new Map<string, Spot>();
  for (const p of listOf(body)) {
    if (!isObj(p)) continue;
    const base = objAt(p, "baseToken");
    const token = strOf(base.address)?.toLowerCase();
    const pool = strOf(p.pairAddress);
    if (!token || !pool || !POOL_ID.test(pool)) continue;
    const spot: Spot = {
      price: numOf(p.priceUsd),
      change: numOf(objAt(p, "priceChange").h24),
      depth: numOf(objAt(p, "liquidity").usd),
      pool,
      symbol: strOf(base.symbol),
      name: strOf(base.name),
    };
    const held = out.get(token);
    if (!held || (spot.depth ?? -1) > (held.depth ?? -1)) out.set(token, spot);
  }
  return out;
}

const POOL_ID = /^0x[0-9a-fA-F]{40}([0-9a-fA-F]{24})?$/;

/** Every address's market on `venue`, keyed by lowercased address; a token with none is absent. */
export async function spots(venue: Venue, addresses: readonly string[]): Promise<Map<string, Spot>> {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const out = new Map<string, Spot>();
  for (let i = 0; i < unique.length; i += BATCH) {
    let res: Response;
    try {
      res = await fetch(`${DEXSCREENER}/${venue}/${unique.slice(i, i + BATCH).join(",")}`, { headers: { accept: "application/json" } });
    } catch {
      throw new Error("DexScreener could not be reached for prices. They are read again on the next refresh.");
    }
    if (!res.ok) throw new Error(`DexScreener answered ${res.status}. Prices are read again on the next refresh.`);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new Error("DexScreener answered with something that is not JSON.");
    }
    for (const [k, v] of parseSpots(body)) out.set(k, v);
  }
  return out;
}

/** GeckoTerminal's candles, oldest first, prices in USD; rows it cannot read are dropped. */
export function parseCandles(body: unknown): Candle[] {
  const rows = listOf(objAt(objAt(body, "data"), "attributes").ohlcv_list);
  const out: Candle[] = [];
  for (const r of rows) {
    const [t, o, h, l, c] = listOf(r).map((x) => numOf(x));
    if (t != null && o != null && h != null && l != null && c != null) out.push({ t: t * 1000, o, h, l, c });
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * A series with one candle per step from `(count - 1)` steps before `end` to `end`: a step with
 * no trade repeats the last close. GeckoTerminal skips hours with no trades, so a thin pool —
 * NVDA on Base, MEASURED — came back as ONE hourly candle and the sparkline read "no chart". A
 * flat line there is the truth: nothing traded, the price did not move.
 */
export function fillGaps(series: readonly Candle[], stepMs: number, count: number, end: number): Candle[] {
  const first = series[0];
  if (!first) return [];
  const last = Math.max(Math.floor(end / stepMs) * stepMs, series[series.length - 1]!.t);
  const out: Candle[] = [];
  let i = 0;
  /** the latest candle at or before the slot — what the price was, then */
  let prev: Candle | null = null;
  for (let k = count - 1; k >= 0; k--) {
    const t = last - k * stepMs;
    while (i < series.length && series[i]!.t <= t) prev = series[i++]!;
    if (prev !== null && prev.t === t) out.push(prev);
    else {
      const v = prev === null ? first.o : prev.c;
      out.push({ t, o: v, h: v, l: v, c: v });
    }
  }
  return out;
}

/** A chart, and — when this app's server served a remembered copy — how old it is, in seconds. */
export type Chart = { readonly candles: readonly Candle[]; readonly staleSeconds: number | null };

/**
 * `token`'s own price history on `venue`, from `pool`, through this app's server (which caches
 * GeckoTerminal — `server/charts.ts`). `token=<address>` prices it whichever side of the pool it is.
 */
export async function candles(venue: Venue, pool: string, token: string, range: Range, now: number = Date.now()): Promise<Chart> {
  const r = RANGES[range];
  const q = new URLSearchParams({ network: venue, pool, token, frame: r.frame, aggregate: String(r.aggregate), limit: String(r.limit) });
  let res: Response;
  try {
    res = await fetch(`${CHARTS_PATH}/ohlcv?${q}`, { headers: { [SERVER_HEADER]: "1" } });
  } catch {
    throw new Error("This app's server could not be reached for the chart.");
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("Charts need this app's server, which is not running here.");
  }
  if (!res.ok) throw new Error(strOf(isObj(body) ? body.detail : null) ?? `The chart is unavailable right now (HTTP ${res.status}).`);
  const stale = Number(res.headers.get("x-quadra-stale"));
  const step = (r.frame === "hour" ? 3_600_000 : 86_400_000) * r.aggregate;
  return { candles: fillGaps(parseCandles(body), step, r.limit, now), staleSeconds: Number.isFinite(stale) && stale > 0 ? stale : null };
}

/** Percent change across the candles, first open to last close — `null` with fewer than two. */
export function change(series: readonly Candle[]): number | null {
  const first = series[0];
  const last = series[series.length - 1];
  if (!first || !last || series.length < 2 || first.o === 0) return null;
  return ((last.c - first.o) / first.o) * 100;
}

/**
 * A Coinbase-issued tokenized stock on Base, as Coinbase's public API lists it
 * (docs.base.org, "List Tokenized Stocks"; `api.coinbase.com/v1/tokenized-stocks`, no key, NO CORS
 * — so through `server/stocks.ts`). MEASURED 2026-09-30: 40 stocks, all B20 with 8 decimals.
 *
 * 🔴 One token is NOT one share: `multiplier` converts token units to shares and moves with
 * dividends and splits (GOOGLc read 1.00038). And a stock can be PAUSED — DKNGc listed paused
 * features [0, 1, 2] — which a window that offers to buy it must say before anyone signs.
 */
export type BaseStock = {
  /** the ticker, without Coinbase's trailing "c" — how a person names the stock */
  readonly ticker: string;
  /** the token's own symbol, e.g. "NVDAc" */
  readonly symbol: string;
  readonly name: string;
  readonly address: string;
  readonly decimals: number;
  readonly multiplier: number;
  readonly paused: readonly number[];
  /** Chainlink NAV/reference value — not a trade price — and when it was last published */
  readonly nav: number | null;
  readonly navAt: Date | null;
  readonly icon: string | null;
};

export function parseBaseStocks(body: unknown): Map<string, BaseStock> {
  const out = new Map<string, BaseStock>();
  for (const t of listOf(isObj(body) ? body.tokens : null)) {
    if (!isObj(t)) continue;
    const symbol = strOf(t.symbol);
    const address = strOf(t.contract_address);
    const decimals = numOf(t.decimals);
    const multiplier = numOf(t.multiplier);
    if (!symbol || !address || !/^0x[0-9a-fA-F]{40}$/.test(address) || decimals === null || !Number.isInteger(decimals) || multiplier === null) continue;
    const ticker = symbol.replace(/c$/, "");
    /**
     * 🔴 MEASURED 2026-09-30: Coinbase's list sends AMDc as 0xB200…0d8ce462E99ee7A47B and BIRDc as
     * 0xb200…535fE96f…, mixed case that is NOT a valid EIP-55 checksum (nine more come all
     * lowercase). The hex digits match the tokens on chain; the capitalisation asserts nothing, so it
     * is dropped and the real checksum computed — otherwise the address door (`lib/address.ts`)
     * rightly refuses them the moment one is traded.
     */
    const checksummed = toChecksumAddress(address.toLowerCase());
    const navAt = new Date(strOf(t.nav_price_updated_at) ?? NaN);
    out.set(ticker, {
      ticker,
      symbol,
      name: strOf(t.name) ?? ticker,
      address: checksummed,
      decimals,
      multiplier,
      paused: listOf(t.paused_features).filter((n): n is number => typeof n === "number"),
      nav: numOf(t.nav_price),
      navAt: Number.isNaN(navAt.getTime()) ? null : navAt,
      icon: strOf(t.icon_url),
    });
  }
  return out;
}

let catalog: Promise<Map<string, BaseStock>> | null = null;

/**
 * Where the list is asked for: through this app's server in a browser (Coinbase sends no CORS
 * header), and from Coinbase directly anywhere else. MEASURED 2026-10-02: the `launch` skill run by
 * an agent — over MCP, the paid API or `npm run smoke` — has no page and no server behind a relative
 * URL, so "launch … AAPLc" failed there while the same line worked in the Terminal.
 */
export const stocksUrl = (): string => (typeof document === "undefined" ? COINBASE_STOCKS : `${STOCKS_PATH}/base`);

/** The most pages of Coinbase's list read — 218 stocks were 3 pages (MEASURED 2026-10-29); a loop that never ends is a bug. */
export const STOCK_PAGES = 10;

/** Coinbase's token for the next page of its list, or null on the last one. */
export function nextPageOf(body: unknown): string | null {
  if (!isObj(body)) return null;
  const t = strOf(body.next_page_token);
  return t && listOf(body.tokens).length > 0 ? t : null;
}

async function stockPage(token: string | null): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(token === null ? stocksUrl() : `${stocksUrl()}?page_token=${encodeURIComponent(token)}`, { headers: { [SERVER_HEADER]: "1" } });
  } catch {
    throw new Error("This app's server could not be reached for the list of stocks on Base.");
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("The list of stocks on Base needs this app's server, which is not running here.");
  }
  if (!res.ok) throw new Error(`Coinbase's list of stocks on Base is unavailable right now (${strOf(isObj(body) ? body.detail : null) ?? `HTTP ${res.status}`}).`);
  return body;
}

/**
 * Coinbase's tokenized stocks on Base, EVERY page, read once per page load; a failed read is asked again
 * next time. 🔴 MEASURED 2026-10-29: the list is paged (100 a page) and only the first page used to be
 * read — AAPLc, NVDAc and SPCXc were on a later one, so "no NAV" was written about stocks never read.
 * A page that fails fails the whole list: a partial list would read as "not listed".
 */
export function baseStocks(): Promise<Map<string, BaseStock>> {
  if (!catalog) {
    catalog = (async () => {
      const all = new Map<string, BaseStock>();
      let token: string | null = null;
      for (let i = 0; i < STOCK_PAGES; i++) {
        const body = await stockPage(token);
        for (const [k, v] of parseBaseStocks(body)) all.set(k, v);
        token = nextPageOf(body);
        if (token === null) break;
      }
      return all;
    })();
    catalog.catch(() => (catalog = null));
  }
  return catalog;
}

/** Forget the catalog — for tests. */
export function forgetCatalog(): void {
  catalog = null;
}

export type StockQuote = {
  readonly symbol: string;
  /** the token's contract on Robinhood Chain, as Robinhood's own API names it */
  readonly address: string;
  readonly bid: number;
  readonly ask: number;
  readonly mid: number;
  readonly high: number | null;
  readonly low: number | null;
  readonly halted: boolean;
  readonly at: Date;
};

/**
 * Robinhood's quotes, by symbol. Only a quote with a bid, an ask, a time and a deployment on
 * Robinhood Chain (4663) is kept — a quote without its contract cannot be charted or checked.
 */
export function parseQuotes(body: unknown): Map<string, StockQuote> {
  const out = new Map<string, StockQuote>();
  for (const q of listOf(isObj(body) ? body.quotes : null)) {
    if (!isObj(q)) continue;
    const symbol = strOf(q.tokenSymbol);
    const deployment = listOf(q.deployments).find((d) => isObj(d) && d.chainId === 4663);
    const address = isObj(deployment) ? strOf(deployment.contractAddress) : null;
    const bid = numOf(q.bid);
    const ask = numOf(q.ask);
    const at = new Date(strOf(q.generatedAt) ?? NaN);
    if (!symbol || !address || bid === null || ask === null || Number.isNaN(at.getTime())) continue;
    out.set(symbol, { symbol, address, bid, ask, mid: (bid + ask) / 2, high: numOf(q.dailyHigh), low: numOf(q.dailyLow), halted: q.isTradingHalt === true, at });
  }
  return out;
}

/** Every stock token's quote, through this app's server (Robinhood sends no CORS header). */
export async function stockQuotes(): Promise<Map<string, StockQuote>> {
  let res: Response;
  try {
    res = await fetch(`${STOCKS_PATH}/prices`, { headers: { [SERVER_HEADER]: "1" } });
  } catch {
    throw new Error("This app's server could not be reached for stock prices.");
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("Stock prices need this app's server, which is not running here.");
  }
  if (!res.ok) throw new Error(`Stock prices are unavailable right now (${strOf(objAt({ body }, "body").detail) ?? `HTTP ${res.status}`}).`);
  return parseQuotes(body);
}
