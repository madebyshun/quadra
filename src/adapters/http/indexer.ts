import { hasAddressShape, toChecksumAddress } from "@/lib/address";
import { isObj, listOf, numOf, strOf } from "@/skills/json";
import { INDEXER_PATH } from "@/server/indexerPath";

/**
 * The browser's half of the launchpad index (`server/indexer.ts`): every launch on this app's
 * factories with its trades, volume and 24h figures, read from one route on this app's server.
 *
 * 🔴 The dev server's SPA fallback answers a route nobody mounted with `index.html` and HTTP 200
 * (MEASURED — CLAUDE.md, "A dev server's SPA fallback…"), and a static host does the same. So "the
 * route is absent" is recognised by the body not being JSON, not by the status, and is said as
 * such — never as "no coins", which would read as an empty launchpad.
 */

/** The header this app's own server routes require — against another site spending them. */
const SERVER_HEADER = "x-quadra";

export const INDEXER_ABSENT = "The launchpad indexer is not running here — this build has no server for it.";

export type IndexedCoin = {
  readonly token: string;
  readonly factory: string;
  readonly creator: string;
  readonly poolId: string;
  readonly launchBlock: number;
  /** unix seconds */
  readonly launchedAt: number;
  readonly launchTx: string;
  readonly name: string | null;
  readonly symbol: string | null;
  /** `null` while the index has not read the launch's pair yet */
  readonly quote: string | null;
  readonly quoteSymbol: string | null;
  readonly quoteDecimals: number | null;
  /** the coin's fee in basis points (100 = 1%, 300 = 3%) — `null` when the index has not read it */
  readonly feeBps: number | null;
  /** a v3 coin's anti-sniper opening: the fee at its first second, in basis points, and how long it fell — `null` on v1/v2 */
  readonly opening: { readonly fromBps: number; readonly seconds: number } | null;
  /** a v3 coin's approved referrer (its fees split 80 / 5 / ~15) — `null` for none, and on v1/v2 */
  readonly referrer: string | null;
  /** whole quote units per whole token at the last trade — `null` before the first one */
  readonly price: number | null;
  readonly mcapInQuote: number | null;
  readonly trades: number;
  readonly buys: number | null;
  readonly sells: number | null;
  readonly volume: number | null;
  readonly trades24h: number;
  readonly buys24h: number | null;
  readonly sells24h: number | null;
  readonly volume24h: number | null;
  /** a floor while `tradersPending24h` is above 0 */
  readonly traders24h: number;
  readonly tradersPending24h: number;
  readonly firstTradeAt: number | null;
  readonly lastTradeAt: number | null;
};

export type IndexedCreator = { readonly creator: string; readonly launches: number; readonly tokens: readonly string[] };

export type LaunchpadIndex = {
  readonly syncedTo: number;
  /** blocks the index is behind the chain's head — `null` when the head could not be read */
  readonly behind: number | null;
  /** why the last read of the chain stopped, when it did */
  readonly error: string | null;
  readonly coins: readonly IndexedCoin[];
  readonly creators: readonly IndexedCreator[];
};

const addr = (v: unknown): string | null => {
  const s = strOf(v);
  return s !== null && hasAddressShape(s) ? toChecksumAddress(s) : null;
};
const count = (v: unknown): number => Math.max(0, numOf(v) ?? 0);
function openingOf(v: unknown): IndexedCoin["opening"] {
  const fromBps = isObj(v) ? numOf(v.fromBps) : null;
  const seconds = isObj(v) ? numOf(v.seconds) : null;
  return fromBps === null || seconds === null ? null : { fromBps, seconds };
}

function coinOf(v: unknown): IndexedCoin | null {
  if (!isObj(v)) return null;
  const token = addr(v.token);
  const factory = addr(v.factory);
  const creator = addr(v.creator);
  const launchBlock = numOf(v.launchBlock);
  const launchedAt = numOf(v.launchedAt);
  if (!token || !factory || !creator || launchBlock === null || launchedAt === null) return null;
  return {
    token,
    factory,
    creator,
    poolId: strOf(v.poolId) ?? "",
    launchBlock,
    launchedAt,
    launchTx: strOf(v.launchTx) ?? "",
    name: strOf(v.name),
    symbol: strOf(v.symbol),
    quote: addr(v.quote),
    quoteSymbol: strOf(v.quoteSymbol),
    quoteDecimals: numOf(v.quoteDecimals),
    feeBps: numOf(v.feeBps),
    opening: openingOf(v.opening),
    referrer: addr(v.referrer),
    price: numOf(v.price),
    mcapInQuote: numOf(v.mcapInQuote),
    trades: count(v.trades),
    buys: numOf(v.buys),
    sells: numOf(v.sells),
    volume: numOf(v.volume),
    trades24h: count(v.trades24h),
    buys24h: numOf(v.buys24h),
    sells24h: numOf(v.sells24h),
    volume24h: numOf(v.volume24h),
    traders24h: count(v.traders24h),
    tradersPending24h: count(v.tradersPending24h),
    firstTradeAt: numOf(v.firstTradeAt),
    lastTradeAt: numOf(v.lastTradeAt),
  };
}

function creatorOf(v: unknown): IndexedCreator | null {
  const creator = isObj(v) ? addr(v.creator) : null;
  if (!creator) return null;
  const tokens = listOf((v as Record<string, unknown>).tokens).flatMap((t) => addr(t) ?? []);
  return { creator, launches: count((v as Record<string, unknown>).launches), tokens };
}

/** The route's JSON, read without trusting its shape: a row missing its identity is dropped, an absent figure is `null`. */
export function parseIndex(body: unknown): LaunchpadIndex {
  const b = isObj(body) ? body : {};
  return {
    syncedTo: numOf(b.syncedTo) ?? 0,
    behind: numOf(b.behind),
    error: strOf(b.error),
    coins: listOf(b.coins).flatMap((c) => coinOf(c) ?? []),
    creators: listOf(b.creators).flatMap((c) => creatorOf(c) ?? []),
  };
}

/** One request to this app's launchpad index, its JSON or a thrown sentence saying why not. */
async function ask(path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${INDEXER_PATH}${path}`, { headers: { [SERVER_HEADER]: "1" } });
  } catch {
    throw new Error("This app's server could not be reached for the launchpad index.");
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(INDEXER_ABSENT);
  }
  if (!res.ok) {
    const detail = isObj(body) ? strOf(body.detail) : null;
    throw new Error(detail ?? `The launchpad index answered ${res.status}.`);
  }
  return body;
}

/** Every launch on this app's launchpad, from this app's server — or a thrown sentence saying why not. */
export async function launchpadCoins(): Promise<LaunchpadIndex> {
  return parseIndex(await ask("/coins"));
}

export type IndexedTrade = {
  readonly at: number;
  readonly tx: string;
  readonly side: "buy" | "sell";
  readonly price: number;
  readonly tokens: number;
  readonly quote: number;
  readonly fee: number;
  readonly feeIn: "quote" | "token";
  readonly trader: string | null;
};
export type IndexedCandle = { readonly at: number; readonly open: number; readonly high: number; readonly low: number; readonly close: number; readonly trades: number };
export type IndexedCoinPage = {
  readonly coin: IndexedCoin;
  readonly trades: readonly IndexedTrade[];
  readonly candles: readonly IndexedCandle[];
  /** every price, oldest first — the opening price at the launch when the index read it, then each trade's */
  readonly points: readonly { readonly at: number; readonly price: number }[];
  readonly feesQuote: number | null;
  readonly feesToken: number | null;
  readonly feeBps: number | null;
  /** the highest fee any trade paid, in basis points — above `feeBps` when a v3 opening charged more */
  readonly maxPaidBps: number | null;
  readonly behind: number | null;
};

function tradeOf(v: unknown): IndexedTrade | null {
  if (!isObj(v)) return null;
  const at = numOf(v.at);
  const tx = strOf(v.tx);
  const price = numOf(v.price);
  const tokens = numOf(v.tokens);
  const quote = numOf(v.quote);
  const fee = numOf(v.fee);
  if (at === null || !tx || price === null || tokens === null || quote === null || fee === null) return null;
  if ((v.side !== "buy" && v.side !== "sell") || (v.feeIn !== "quote" && v.feeIn !== "token")) return null;
  return { at, tx, side: v.side, price, tokens, quote, fee, feeIn: v.feeIn, trader: addr(v.trader) };
}

function candleOf(v: unknown): IndexedCandle | null {
  if (!isObj(v)) return null;
  const [at, open, high, low, close, trades] = [v.at, v.open, v.high, v.low, v.close, v.trades].map(numOf);
  return at == null || open == null || high == null || low == null || close == null || trades == null ? null : { at, open, high, low, close, trades };
}

/** One coin's page from the index: the row, its trades and candles; a row missing its identity is an error, a missing figure is `null`. */
export function parseCoinPage(body: unknown): IndexedCoinPage {
  const b = isObj(body) ? body : {};
  const coin = coinOf(b.coin);
  if (!coin) throw new Error("The launchpad index answered without the coin.");
  return {
    coin,
    trades: listOf(b.trades).flatMap((t) => tradeOf(t) ?? []),
    candles: listOf(b.candles).flatMap((c) => candleOf(c) ?? []),
    points: listOf(b.points).flatMap((v) => {
      const at = isObj(v) ? numOf(v.at) : null;
      const price = isObj(v) ? numOf(v.price) : null;
      return at === null || price === null ? [] : [{ at, price }];
    }),
    feesQuote: numOf(b.feesQuote),
    feesToken: numOf(b.feesToken),
    feeBps: numOf(b.feeBps),
    maxPaidBps: numOf(b.maxPaidBps),
    behind: numOf(b.behind),
  };
}

export async function launchpadCoin(token: string): Promise<IndexedCoinPage> {
  return parseCoinPage(await ask(`/coin?token=${token}`));
}
