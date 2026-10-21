import { decodeAbiParameters, decodeFunctionResult, encodeFunctionData, erc20Abi } from "viem";
import { BASE, UNISWAP_V4_POOL_MANAGER } from "@/config/chain";
import { DYNAMIC_FEE_FLAG, LAUNCH_HOOK_ABI, LAUNCHPAD_ABI, LAUNCHPAD_EXPECTS } from "@/config/launchpad";
import { toChecksumAddress } from "@/lib/address";
import { messageOf } from "@/lib/errors";
import { keccak256, toHex, utf8 } from "@/lib/keccak";
import { factories, isV3, LAUNCHED_TOPIC, poolIdOf, quotePerToken } from "@/skills/launchpad";
import { rpcOn } from "@/skills/http";
import { isObj, listOf, strOf } from "@/skills/json";
import { ARCHIVE_RPC } from "@/skills/origin";
import { INDEXER_PATH } from "@/server/indexerPath";

/**
 * A small indexer for this app's OWN launchpad: every launch on both factories, and every trade on
 * their pools, read from the chain's logs and kept in memory — so the Coins window, a leaderboard
 * and a "fees waiting" page ask one route instead of Blockscout and DexScreener each.
 *
 * Why not DexScreener: MEASURED 2026-10-02, it did not list a fresh launch at all until its first
 * trade, and it gives no trader count. Why not Blockscout's log index for the trades: the PoolManager
 * holds every v4 pool's swaps on Base, far too many to page through for a handful of ours. So the
 * trades come from `eth_getLogs` on the PoolManager filtered by OUR pool ids (topic1, an OR-list).
 *
 * The limits are measured ones (CLAUDE.md): mainnet.base.org caps `eth_getLogs` at 2,000 blocks and
 * answers a burst with the JSON-RPC error "request limit reached"; publicnode refuses old logs. So the
 * walk is in `CHUNK`-block ranges on the archive nodes, at most `MAX_CHUNKS` of them per sync, and a
 * refusal stops the walk where it got to — every chunk is applied whole or read again, never half.
 *
 * Shape: a pure reducer (`applyLaunches`, `applySwaps`, `snapshot`), one bounded step that reads the
 * chain (`syncOnce`), and a Fetch-API handler (`indexerHandler`) — the same shape as charts.ts, so it
 * moves to a Vercel function unchanged (T3). The STATE is memory: a dev server keeps it, a cold
 * serverless function starts it again — where it is kept in production is T3's question.
 */

export { INDEXER_PATH };

/** The v4 PoolManager's `Swap` event, hashed from v4-core's own signature (IPoolManager.sol) — never copied. */
export const SWAP_TOPIC = toHex(keccak256(utf8("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)")));

/** The first block either factory exists at — v1's deploy (v2 came after, at 52,068,913). MEASURED on Blockscout. */
export const FIRST_BLOCK = 52_066_273;
/**
 * Blocks per `eth_getLogs`. mainnet.base.org allows 2,000 but Tenderly's public gateway, the second
 * endpoint, 1,000 (both MEASURED 2026-10-14) — and one range has to suit whichever answers.
 */
export const CHUNK = 1_000;
/** Chunks one sync reads at most, so a request never waits on a whole backfill. */
export const MAX_CHUNKS = 10;
/** Pool ids per `eth_getLogs` topic list. */
export const ID_BATCH = 100;
/** Launches whose details (quote, name, symbol) one sync reads at most. */
export const MAX_DETAILS = 10;
/** Transactions one sync looks up for their sender (a trader) at most. */
export const MAX_TRADERS = 40;
/** Base's block time, MEASURED exact (CLAUDE.md, origin.ts): a block's time is the head's minus 2 s a block. */
export const BLOCK_SECONDS = 2;
const DAY = 86_400;
const ETH = "0x0000000000000000000000000000000000000000";

export type Rpc = (method: string, params: readonly unknown[]) => Promise<unknown>;
/**
 * Unix seconds of a block, for a log that does not carry its own `blockTimestamp` (Tenderly's do,
 * MEASURED; the field is not in the JSON-RPC spec, so it is not relied on).
 */
export type Clock = (block: number) => number;

export type Detail = {
  readonly quote: string;
  readonly tokenIs0: boolean;
  readonly name: string | null;
  readonly symbol: string | null;
  readonly quoteSymbol: string;
  readonly quoteDecimals: number;
  /** the coin's fee in hundredths of a basis point: 10000 on v1/v2; on v3 the chosen one, from its hook */
  readonly fee: number;
  /** v3's anti-sniper opening, read from the hook — `null` on v1/v2, which have none */
  readonly opening: { readonly startFee: number; readonly window: number } | null;
};

export type Coin = {
  readonly token: string;
  readonly factory: string;
  readonly creator: string;
  readonly poolId: string;
  readonly block: number;
  readonly at: number;
  readonly tx: string;
  readonly devBuyIn: bigint;
  readonly devBuyTokens: bigint;
  detail: Detail | null;
};

export type Swap = {
  readonly key: string;
  readonly block: number;
  readonly at: number;
  readonly tx: string;
  /** the SWAPPER's deltas (v4 emits `BalanceDelta`): negative is what the trader paid in */
  readonly amount0: bigint;
  readonly amount1: bigint;
  readonly sqrtPriceX96: bigint;
  readonly tick: number;
  /** the LP fee this swap PAID, from the event itself — on v3 higher than the coin's fee in its opening seconds */
  readonly fee: number;
};

export type IndexState = {
  /** the last block every log of which has been applied */
  syncedTo: number;
  readonly coins: Map<string, Coin>;
  readonly swaps: Map<string, Swap[]>;
  /** transaction hash → its sender, for the swaps whose trader was looked up */
  readonly traders: Map<string, string>;
  readonly quotes: Map<string, { readonly symbol: string; readonly decimals: number }>;
};

export function emptyState(): IndexState {
  return { syncedTo: FIRST_BLOCK - 1, coins: new Map(), swaps: new Map(), traders: new Map(), quotes: new Map() };
}

const address = (topic: string) => toChecksumAddress(`0x${topic.slice(-40)}`);
const hexNum = (v: unknown) => (typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v) ? Number(v) : null);
const topicsOf = (log: Record<string, unknown>) => listOf(log.topics).filter((t): t is string => typeof t === "string");

/** `Launched` logs into coins. A log already applied, or one that is not a launch, changes nothing. */
export function applyLaunches(state: IndexState, logs: unknown, clock: Clock): number {
  let added = 0;
  for (const log of listOf(logs)) {
    if (!isObj(log)) continue;
    const topics = topicsOf(log);
    const block = hexNum(log.blockNumber);
    const data = strOf(log.data);
    if (topics[0] !== LAUNCHED_TOPIC || topics.length !== 4 || block === null || data === null) continue;
    const poolId = topics[3]!.toLowerCase();
    if (state.coins.has(poolId)) continue;
    const [devBuyIn, devBuyTokens] = decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], data as `0x${string}`);
    state.coins.set(poolId, {
      token: address(topics[1]!),
      factory: toChecksumAddress(String(log.address)),
      creator: address(topics[2]!),
      poolId,
      block,
      at: hexNum(log.blockTimestamp) ?? clock(block),
      tx: strOf(log.transactionHash) ?? "",
      devBuyIn,
      devBuyTokens,
      detail: null,
    });
    added++;
  }
  return added;
}

/** PoolManager `Swap` logs of OUR pools into trades; another pool's swap, or one seen before, is skipped. */
export function applySwaps(state: IndexState, logs: unknown, clock: Clock): number {
  let added = 0;
  for (const log of listOf(logs)) {
    if (!isObj(log)) continue;
    const topics = topicsOf(log);
    const block = hexNum(log.blockNumber);
    const data = strOf(log.data);
    const tx = strOf(log.transactionHash);
    if (topics[0] !== SWAP_TOPIC || topics.length !== 3 || block === null || data === null || tx === null) continue;
    const poolId = topics[1]!.toLowerCase();
    if (!state.coins.has(poolId)) continue;
    const key = `${tx}:${String(log.logIndex)}`;
    const list = state.swaps.get(poolId) ?? [];
    if (list.some((s) => s.key === key)) continue;
    const [amount0, amount1, sqrtPriceX96, , tick, fee] = decodeAbiParameters(
      [{ type: "int128" }, { type: "int128" }, { type: "uint160" }, { type: "uint128" }, { type: "int24" }, { type: "uint24" }],
      data as `0x${string}`,
    );
    list.push({ key, block, at: hexNum(log.blockTimestamp) ?? clock(block), tx, amount0, amount1, sqrtPriceX96, tick, fee });
    state.swaps.set(poolId, list);
    added++;
  }
  return added;
}

const abs = (v: bigint) => (v < 0n ? -v : v);
/** Whole units of a base-unit amount, for display and sorting — the exact figure travels beside it as a string. */
const units = (raw: bigint, decimals: number) => Number(raw) / 10 ** decimals;

export type CoinRow = {
  readonly token: string;
  readonly factory: string;
  readonly creator: string;
  readonly poolId: string;
  readonly launchBlock: number;
  readonly launchedAt: number;
  readonly launchTx: string;
  readonly name: string | null;
  readonly symbol: string | null;
  /** null while the launch's details have not been read */
  readonly quote: string | null;
  readonly quoteSymbol: string | null;
  readonly quoteDecimals: number | null;
  /** the coin's fee in basis points (100 = 1%) — `null` while a v3 launch's details have not been read */
  readonly feeBps: number | null;
  /** v3's opening: the fee at the pool's first second in basis points, and how long it took to fall — `null` on v1/v2 */
  readonly opening: { readonly fromBps: number; readonly seconds: number } | null;
  /** whole quote units per whole token, at the LAST trade — null before the first one or the details */
  readonly price: number | null;
  readonly tick: number | null;
  /** the whole supply at `price`, in the quote */
  readonly mcapInQuote: number | null;
  readonly trades: number;
  readonly buys: number | null;
  readonly sells: number | null;
  readonly volume: number | null;
  /** exact, in the quote's base units */
  readonly volumeRaw: string | null;
  readonly trades24h: number;
  readonly buys24h: number | null;
  readonly sells24h: number | null;
  readonly volume24h: number | null;
  /** distinct senders of the last 24h's trades that were looked up */
  readonly traders24h: number;
  /** last 24h trades whose sender has not been looked up yet — `traders24h` is a floor while this is above 0 */
  readonly tradersPending24h: number;
  readonly firstTradeAt: number | null;
  readonly lastTradeAt: number | null;
};

export type CreatorRow = { readonly creator: string; readonly launches: number; readonly tokens: readonly string[]; readonly lastLaunchAt: number };

export type Snapshot = {
  readonly source: string;
  readonly syncedTo: number;
  readonly head: number | null;
  /** blocks between the last applied one and the head — 0 when caught up */
  readonly behind: number | null;
  readonly generatedAt: number;
  readonly error: string | null;
  readonly totals: { readonly coins: number; readonly creators: number; readonly trades: number; readonly trades24h: number };
  /** newest launch first */
  readonly coins: readonly CoinRow[];
  /** most launches first */
  readonly creators: readonly CreatorRow[];
};

function rowOf(state: IndexState, coin: Coin, now: number): CoinRow {
  const swaps = [...(state.swaps.get(coin.poolId) ?? [])].sort((a, b) => a.block - b.block || a.key.localeCompare(b.key));
  const recent = swaps.filter((s) => s.at > now - DAY && s.at <= now);
  const d = coin.detail;
  const side = (s: Swap) => (d!.tokenIs0 ? s.amount0 : s.amount1) > 0n; // the trader RECEIVED the token: a buy
  const quoteOf = (s: Swap) => abs(d!.tokenIs0 ? s.amount1 : s.amount0);
  const volumeOf = (list: Swap[]) => list.reduce((sum, s) => sum + quoteOf(s), 0n);
  const last = swaps.at(-1);
  const price = d && last ? quotePerToken(last.sqrtPriceX96, d.tokenIs0, d.quoteDecimals) : null;
  const known = recent.map((s) => state.traders.get(s.tx));
  return {
    token: coin.token,
    factory: coin.factory,
    creator: coin.creator,
    poolId: coin.poolId,
    launchBlock: coin.block,
    launchedAt: coin.at,
    launchTx: coin.tx,
    name: d?.name ?? null,
    symbol: d?.symbol ?? null,
    quote: d?.quote ?? null,
    quoteSymbol: d?.quoteSymbol ?? null,
    quoteDecimals: d?.quoteDecimals ?? null,
    feeBps: d ? d.fee / 100 : isV3(coin.factory) ? null : LAUNCHPAD_EXPECTS.lpFee / 100,
    opening: d?.opening ? { fromBps: d.opening.startFee / 100, seconds: d.opening.window } : null,
    price,
    tick: last?.tick ?? null,
    mcapInQuote: price === null ? null : price * Number(LAUNCHPAD_EXPECTS.supply / 10n ** 18n),
    trades: swaps.length,
    buys: d ? swaps.filter(side).length : null,
    sells: d ? swaps.filter((s) => !side(s)).length : null,
    volume: d ? units(volumeOf(swaps), d.quoteDecimals) : null,
    volumeRaw: d ? volumeOf(swaps).toString() : null,
    trades24h: recent.length,
    buys24h: d ? recent.filter(side).length : null,
    sells24h: d ? recent.filter((s) => !side(s)).length : null,
    volume24h: d ? units(volumeOf(recent), d.quoteDecimals) : null,
    traders24h: new Set(known.filter((t) => t !== undefined)).size,
    tradersPending24h: known.filter((t) => t === undefined).length,
    firstTradeAt: swaps[0]?.at ?? null,
    lastTradeAt: last?.at ?? null,
  };
}

/** One trade as a coin page lists it. Amounts are whole units; `fee` is in the currency the trader paid in. */
export type TradeRow = {
  readonly at: number;
  readonly tx: string;
  readonly side: "buy" | "sell";
  /** whole quote units per whole token after the trade */
  readonly price: number;
  readonly tokens: number;
  readonly quote: number;
  readonly fee: number;
  readonly feeIn: "quote" | "token";
  /** the transaction's sender, when looked up — the Swap event names only the router */
  readonly trader: string | null;
};

/** One hour of a coin's trading, as a candle. Prices in whole quote units per whole token. */
export type Candle = { readonly at: number; readonly open: number; readonly high: number; readonly low: number; readonly close: number; readonly trades: number };

export type CoinDetail = {
  readonly coin: CoinRow;
  /** newest first, at most `TRADES_SHOWN` */
  readonly trades: readonly TradeRow[];
  /** oldest first, one per hour that had a trade */
  readonly candles: readonly Candle[];
  /** every fee the pool earned, in the quote (buys) and in the token (sells) — split 80/20 by `collect` */
  readonly feesQuote: number | null;
  readonly feesToken: number | null;
  /** the coin's fee in basis points — `null` while a v3 launch's details are unread */
  readonly feeBps: number | null;
  /** the highest fee any of its trades paid, in basis points — above `feeBps` when a v3 opening charged more */
  readonly maxPaidBps: number | null;
};

export const TRADES_SHOWN = 100;
const HOUR = 3600;

/**
 * One coin's page: its row, its latest trades and hourly candles, and what its pool has earned. A
 * v4 swap takes its fee from the INPUT (MEASURED in the captures: a buy's quote in is the amount the
 * trader paid, fee included), so a buy's fee is in the quote and a sell's in the token. Each trade's
 * fee is the one its own Swap event says it paid — on v3 that is the opening's higher fee for the
 * first seconds, never the coin's fee assumed for every trade.
 */
export function coinDetail(state: IndexState, token: string, now: number): CoinDetail | null {
  // coins are keyed by pool id; a page asks by token
  const coin = [...state.coins.values()].find((c) => c.token.toLowerCase() === token.toLowerCase());
  if (!coin) return null;
  const row = rowOf(state, coin, now);
  const d = coin.detail;
  const feeBps = row.feeBps;
  if (!d) return { coin: row, trades: [], candles: [], feesQuote: null, feesToken: null, feeBps, maxPaidBps: null };
  const swaps = [...(state.swaps.get(coin.poolId) ?? [])].sort((a, b) => a.block - b.block || a.key.localeCompare(b.key));
  const tokenDelta = (s: Swap) => (d.tokenIs0 ? s.amount0 : s.amount1);
  const quoteDelta = (s: Swap) => (d.tokenIs0 ? s.amount1 : s.amount0);
  // a v4 LP fee is in hundredths of a basis point; the event's is what this swap paid
  const fee = (paid: bigint, lpFee: number) => (paid * BigInt(lpFee)) / 1_000_000n;
  let feesQuote = 0n;
  let feesToken = 0n;
  const trades: TradeRow[] = swaps.map((s) => {
    const buy = tokenDelta(s) > 0n;
    const paid = abs(buy ? quoteDelta(s) : tokenDelta(s));
    const f = fee(paid, s.fee);
    if (buy) feesQuote += f;
    else feesToken += f;
    return {
      at: s.at,
      tx: s.tx,
      side: buy ? "buy" : "sell",
      price: quotePerToken(s.sqrtPriceX96, d.tokenIs0, d.quoteDecimals),
      tokens: units(abs(tokenDelta(s)), 18),
      quote: units(abs(quoteDelta(s)), d.quoteDecimals),
      fee: buy ? units(f, d.quoteDecimals) : units(f, 18),
      feeIn: buy ? "quote" : "token",
      trader: state.traders.get(s.tx) ?? null,
    };
  });
  const candles: Candle[] = [];
  for (const t of trades) {
    const at = t.at - (t.at % HOUR);
    const c = candles.at(-1);
    if (c && c.at === at) candles[candles.length - 1] = { ...c, high: Math.max(c.high, t.price), low: Math.min(c.low, t.price), close: t.price, trades: c.trades + 1 };
    else candles.push({ at, open: t.price, high: t.price, low: t.price, close: t.price, trades: 1 });
  }
  const maxPaidBps = swaps.length === 0 ? null : Math.max(...swaps.map((s) => s.fee)) / 100;
  return { coin: row, trades: trades.reverse().slice(0, TRADES_SHOWN), candles, feesQuote: units(feesQuote, d.quoteDecimals), feesToken: units(feesToken, 18), feeBps, maxPaidBps };
}

/** The JSON the route serves. `now` is unix seconds. */
export function snapshot(state: IndexState, now: number, head: number | null = null, error: string | null = null): Snapshot {
  const coins = [...state.coins.values()].sort((a, b) => b.block - a.block || a.token.localeCompare(b.token)).map((c) => rowOf(state, c, now));
  const byCreator = new Map<string, CreatorRow>();
  for (const c of coins) {
    const seen = byCreator.get(c.creator);
    byCreator.set(c.creator, {
      creator: c.creator,
      launches: (seen?.launches ?? 0) + 1,
      tokens: [...(seen?.tokens ?? []), c.token],
      lastLaunchAt: Math.max(seen?.lastLaunchAt ?? 0, c.launchedAt),
    });
  }
  const creators = [...byCreator.values()].sort((a, b) => b.launches - a.launches || b.lastLaunchAt - a.lastLaunchAt);
  return {
    source: "Base: the launchpad factories' Launched logs and the v4 PoolManager's Swap logs for their pools",
    syncedTo: state.syncedTo,
    head,
    behind: head === null ? null : Math.max(0, head - state.syncedTo),
    generatedAt: now,
    error,
    totals: {
      coins: coins.length,
      creators: creators.length,
      trades: coins.reduce((n, c) => n + c.trades, 0),
      trades24h: coins.reduce((n, c) => n + c.trades24h, 0),
    },
    coins,
    creators,
  };
}

// ── Reading the chain ──────────────────────────────────────────────────────

/**
 * The archive nodes, in order. publicnode refuses old logs (MEASURED), so mainnet.base.org first —
 * and, because it answers a burst of `eth_getLogs` with HTTP 429 "request limit reached" for minutes
 * at a time (MEASURED 2026-10-14, while other tools on the same machine read it too), Tenderly's
 * public gateway after it: archive logs in 1,000-block ranges, 20 requests per window by its own
 * `x-tdly-limit` header. Both public — production needs a provider (T3, CLAUDE.md).
 */
export const INDEXER_RPC: readonly string[] = [...ARCHIVE_RPC, "https://gateway.tenderly.co/public/base"];
export const archiveRpc: Rpc = (method, params) => rpcOn(BASE.name, INDEXER_RPC, method, params);

export type Head = { readonly number: number; readonly timestamp: number };

/** The latest block's number and time. */
export async function readHead(rpc: Rpc): Promise<Head> {
  const block = await rpc("eth_getBlockByNumber", ["latest", false]);
  const number = isObj(block) ? hexNum(block.number) : null;
  const timestamp = isObj(block) ? hexNum(block.timestamp) : null;
  if (number === null || timestamp === null) throw new Error("The Base RPC sent a latest block without a number or a time.");
  return { number, timestamp };
}

const hex = (n: number) => `0x${n.toString(16)}`;
const call = async (rpc: Rpc, to: string, data: string) => String(await rpc("eth_call", [{ to, data }, "latest"])) as `0x${string}`;

async function readDetail(state: IndexState, rpc: Rpc, coin: Coin): Promise<Detail> {
  const data = encodeFunctionData({ abi: LAUNCHPAD_ABI, functionName: "launches", args: [coin.token as `0x${string}`] });
  const { key } = decodeFunctionResult({ abi: LAUNCHPAD_ABI, functionName: "launches", data: await call(rpc, coin.factory, data) });
  const tokenIs0 = key.currency0.toLowerCase() === coin.token.toLowerCase();
  const quote = toChecksumAddress(tokenIs0 ? key.currency1 : key.currency0);
  const read = async (to: string, functionName: "name" | "symbol" | "decimals") =>
    decodeFunctionResult({ abi: erc20Abi, functionName, data: await call(rpc, to, encodeFunctionData({ abi: erc20Abi, functionName })) });
  const lower = quote.toLowerCase();
  if (!state.quotes.has(lower)) {
    state.quotes.set(
      lower,
      lower === ETH ? { symbol: "ETH", decimals: 18 } : { symbol: String(await read(quote, "symbol")), decimals: Number(await read(quote, "decimals")) },
    );
  }
  const q = state.quotes.get(lower)!;
  const fees = key.fee === DYNAMIC_FEE_FLAG ? await hookFee(rpc, key.hooks, poolIdOf(key)) : { fee: key.fee, opening: null };
  return { quote, tokenIs0, name: String(await read(coin.token, "name")), symbol: String(await read(coin.token, "symbol")), quoteSymbol: q.symbol, quoteDecimals: q.decimals, ...fees };
}

/** A v3 coin's chosen fee and its opening, from the hook its pool key names. A pool the hook never scheduled is an error, not a 0% fee. */
async function hookFee(rpc: Rpc, hook: string, id: `0x${string}`): Promise<Pick<Detail, "fee" | "opening">> {
  const [fee] = decodeFunctionResult({ abi: LAUNCH_HOOK_ABI, functionName: "schedules", data: await call(rpc, hook, encodeFunctionData({ abi: LAUNCH_HOOK_ABI, functionName: "schedules", args: [id] })) });
  if (fee === 0) throw new Error(`The launchpad hook ${hook} has no fee schedule for pool ${id}.`);
  const startFee = decodeFunctionResult({ abi: LAUNCH_HOOK_ABI, functionName: "startFee", data: await call(rpc, hook, encodeFunctionData({ abi: LAUNCH_HOOK_ABI, functionName: "startFee" })) });
  const window = decodeFunctionResult({ abi: LAUNCH_HOOK_ABI, functionName: "window", data: await call(rpc, hook, encodeFunctionData({ abi: LAUNCH_HOOK_ABI, functionName: "window" })) });
  return { fee, opening: { startFee, window } };
}

export type SyncResult = { readonly chunks: number; readonly launches: number; readonly swaps: number; readonly error: string | null };

/**
 * One bounded step forward: up to `maxChunks` chunks of ≤2,000 blocks from the last synced block
 * toward `head` (from the first factory's deploy block on a first run), then up to `MAX_DETAILS`
 * launches' details and `MAX_TRADERS` recent trades' senders. A refusal stops the step and is
 * returned as `error`; what was applied before it stays applied.
 */
export async function syncOnce(state: IndexState, rpc: Rpc, head: Head, maxChunks = MAX_CHUNKS): Promise<SyncResult> {
  const clock: Clock = (block) => head.timestamp - (head.number - block) * BLOCK_SECONDS;
  let chunks = 0;
  let launches = 0;
  let swaps = 0;
  try {
    while (chunks < maxChunks && state.syncedTo < head.number) {
      const from = state.syncedTo + 1;
      const to = Math.min(from + CHUNK - 1, head.number);
      const range = { fromBlock: hex(from), toBlock: hex(to) };
      launches += applyLaunches(state, await rpc("eth_getLogs", [{ address: factories(), topics: [LAUNCHED_TOPIC], ...range }]), clock);
      const ids = [...state.coins.keys()];
      for (let i = 0; i < ids.length; i += ID_BATCH) {
        const logs = await rpc("eth_getLogs", [{ address: UNISWAP_V4_POOL_MANAGER, topics: [SWAP_TOPIC, ids.slice(i, i + ID_BATCH)], ...range }]);
        swaps += applySwaps(state, logs, clock);
      }
      state.syncedTo = to;
      chunks++;
    }
    for (const coin of [...state.coins.values()].filter((c) => c.detail === null).slice(0, MAX_DETAILS)) {
      coin.detail = await readDetail(state, rpc, coin);
    }
    const since = head.timestamp - DAY;
    const pending = new Set([...state.swaps.values()].flat().filter((s) => s.at > since && !state.traders.has(s.tx)).map((s) => s.tx));
    for (const tx of [...pending].slice(0, MAX_TRADERS)) {
      const body = await rpc("eth_getTransactionByHash", [tx]);
      const from = isObj(body) ? strOf(body.from) : null;
      if (from === null) throw new Error(`The Base RPC sent no sender for transaction ${tx}.`);
      state.traders.set(tx, toChecksumAddress(from));
    }
  } catch (e) {
    return { chunks, launches, swaps, error: messageOf(e) };
  }
  return { chunks, launches, swaps, error: null };
}

// ── The route ──────────────────────────────────────────────────────────────

/** How long a snapshot is served before the chain is asked again. */
export const FRESH_MS = 15_000;
/** The pause between background catch-up steps while the index is behind. */
export const CATCH_UP_MS = 1_500;

function problem(status: number, detail: string): Response {
  return new Response(JSON.stringify({ status, detail, origin: "quadra-server" }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

export type IndexerDeps = {
  readonly rpc?: Rpc;
  readonly now?: () => number;
  readonly state?: IndexState;
  readonly maxChunks?: number;
  /** runs a catch-up step later — `setTimeout` on a server; a test collects them */
  readonly later?: (step: () => void, ms: number) => void;
};

/**
 * GET /api/launchpad/coins and /api/launchpad/creators — the same snapshot, the second without the
 * coins. While the index is behind the head, it keeps stepping forward in the background.
 */
export function indexerHandler(deps: IndexerDeps = {}) {
  const rpc = deps.rpc ?? archiveRpc;
  const now = deps.now ?? Date.now;
  const state = deps.state ?? emptyState();
  const maxChunks = deps.maxChunks ?? MAX_CHUNKS;
  const later = deps.later ?? ((step, ms) => void setTimeout(step, ms));
  let last: { at: number; head: number | null; error: string | null } | null = null;
  let inFlight: Promise<void> | null = null;

  const step = async (): Promise<void> => {
    let head: Head;
    try {
      head = await readHead(rpc);
    } catch (e) {
      last = { at: now(), head: last?.head ?? null, error: messageOf(e) };
      return;
    }
    const result = await syncOnce(state, rpc, head, maxChunks);
    last = { at: now(), head: head.number, error: result.error };
    if (result.error === null && state.syncedTo < head.number) later(() => void sync(), CATCH_UP_MS);
  };
  const sync = (): Promise<void> => {
    inFlight ??= step().finally(() => (inFlight = null));
    return inFlight;
  };

  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname.slice(INDEXER_PATH.length);
    if (request.headers.get("x-quadra") !== "1") return problem(403, "Requests to this server need the x-quadra: 1 header.");
    if (path !== "/coins" && path !== "/creators" && path !== "/coin") return problem(404, `${path} is not a route of the launchpad index.`);
    if (request.method !== "GET") return problem(405, `${path} takes GET.`);
    if (last === null || now() - last.at >= FRESH_MS) await sync();
    const { head, error } = last!;
    if (state.syncedTo < FIRST_BLOCK) {
      return problem(502, `The launchpad index has read nothing from Base yet: ${error ?? "the chain is still being read"}`);
    }
    if (path === "/coin") {
      const token = new URL(request.url).searchParams.get("token") ?? "";
      if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return problem(400, "/coin takes ?token=0x… — a 20-byte address.");
      const detail = coinDetail(state, token, Math.floor(now() / 1000));
      if (detail === null) return problem(404, `${token} is not a coin of this launchpad, or the index has not reached its launch yet.`);
      return new Response(JSON.stringify({ ...detail, syncedTo: state.syncedTo, head, behind: head === null ? null : Math.max(0, head - state.syncedTo), error }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "public, max-age=10, s-maxage=15, stale-while-revalidate=60" },
      });
    }
    const snap = snapshot(state, Math.floor(now() / 1000), head, error);
    const body = path === "/coins" ? snap : { ...snap, coins: undefined };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "public, max-age=10, s-maxage=15, stale-while-revalidate=60" },
    });
  };
}
