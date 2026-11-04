import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeAbiParameters, encodeAbiParameters, keccak256, parseAbiParameters, toBytes } from "viem";
import { LAUNCHED_TOPIC, REFERRED_TOPIC } from "@/skills/launchpad";
import {
  applyLaunches,
  applySwaps,
  archiveRpc,
  BLOCK_SECONDS,
  CATCH_UP_MS,
  CHUNK,
  coinDetail,
  openingSqrt,
  emptyState,
  FIRST_BLOCK,
  FRESH_MS,
  ID_BATCH,
  INDEXER_PATH,
  INDEXER_RPC,
  indexerHandler,
  MAX_CHUNKS,
  MAX_TRADERS,
  readHead,
  snapshot,
  STORE_BUDGET_MS,
  SWAP_TOPIC,
  syncOnce,
  TRADES_SHOWN,
  type Clock,
  type Detail,
  type IndexState,
  type Rpc,
  type Snapshot,
} from "@/server/indexer";
import { blobStore, decodeState, encodeState, STATE_PATH, STATE_VERSION, type Store } from "@/server/indexStore";
import { INDEXER_ABSENT, launchpadCoin, launchpadCoins, parseCoinPage, parseIndex } from "@/adapters/http/indexer";
import { COINS, IX } from "./fixtures/indexer";
import { json, net, useNet } from "./net";
import { withoutV3 } from "./v2only";

// Its fixtures are real v2/v1 captures, so it runs as the app did before v3 was set.
withoutV3();

useNet();
afterEach(() => vi.useRealTimers());

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PM = "0x498581ff718922c3f8e6a244956af099b2652b2b";
const HEAD = { number: Number(IX.head.number), timestamp: Number(IX.head.timestamp) };
/** The clock syncOnce builds — the head's time minus 2 s a block. */
const clock: Clock = (block) => HEAD.timestamp - (HEAD.number - block) * BLOCK_SECONDS;

type Log = { blockNumber: string; topics: string[]; logIndex: string; transactionHash: string; blockTimestamp?: string; data: string; address: string };
const LAUNCH_LOGS: Log[] = [...IX.launchedV1.result, ...IX.launchedV2.result];
const SWAP_LOGS: Log[] = [...IX.swapsV1.swaps, ...IX.swapsV2.swaps].flatMap((c) => c.result);
const ethLaunch = IX.launchedV1.result[0]!;
const ethSwap = IX.swapsV1.swaps[0]!.result[0]!;
const stockSwap = IX.swapsV2.swaps[0]!.result[0]!;
/** A log as a node that sends no `blockTimestamp` would — the field is not in the spec. */
const withoutTime = ({ blockTimestamp: _, ...log }: Log) => log;

const LAUNCHES: Record<string, string> = {
  [COINS.eth.toLowerCase()]: IX.launchesV1.result,
  [COINS.stock.toLowerCase()]: IX.launchesV2.result,
  [COINS.second.toLowerCase()]: IX.launchesV2Second.result,
};
const SELECTOR = { launches: "0x1f2d8550", name: "0x06fdde03", symbol: "0x95d89b41", decimals: "0x313ce567" } as const;
const ERC20 = IX.erc20 as Record<string, string>;
const TXS = IX.txs as Record<string, { from: string }>;

/**
 * A node that answers from the captures: logs filtered by range, address and topic exactly as
 * eth_getLogs would, calls by selector, transactions by hash. Anything else fails the test.
 */
function fakeNode(over: { fail?: (method: string, params: readonly unknown[]) => unknown } = {}) {
  const calls: { method: string; params: readonly unknown[] }[] = [];
  const rpc: Rpc = async (method, params) => {
    calls.push({ method, params });
    const failed = over.fail?.(method, params);
    if (failed instanceof Error) throw failed;
    if (failed !== undefined) return failed;
    if (method === "eth_getBlockByNumber") return IX.head;
    if (method === "eth_getLogs") {
      const f = params[0] as { address: string | string[]; topics: (string | string[])[]; fromBlock: string; toBlock: string };
      const inRange = (l: Log) => Number(l.blockNumber) >= Number(f.fromBlock) && Number(l.blockNumber) <= Number(f.toBlock);
      if (Array.isArray(f.address)) {
        expect(f.address.map((a) => a.toLowerCase()).sort()).toEqual([COINS.v1, COINS.v2].map((a) => a.toLowerCase()).sort());
        expect(f.topics).toEqual([[LAUNCHED_TOPIC, REFERRED_TOPIC]]);
        return LAUNCH_LOGS.filter(inRange);
      }
      expect(f.address.toLowerCase()).toBe(PM);
      if (f.topics[0] === INIT_TOPIC) return IX.initializeV1.result.filter((l) => inRange(l) && l.topics[1] === f.topics[1]);
      const ids = f.topics[1] as string[];
      expect(ids.length).toBeLessThanOrEqual(ID_BATCH);
      return SWAP_LOGS.filter((l) => inRange(l) && l.topics[0] === f.topics[0] && ids.includes(l.topics[1]!));
    }
    if (method === "eth_call") {
      const { to, data } = params[0] as { to: string; data: string };
      if (data.startsWith(SELECTOR.launches)) return LAUNCHES[`0x${data.slice(34, 74)}`];
      const fn = Object.entries(SELECTOR).find(([, s]) => data === s)![0];
      const key = Object.keys(ERC20).find((k) => k.toLowerCase() === `${to}:${fn}`.toLowerCase());
      if (key) return ERC20[key];
    }
    if (method === "eth_getTransactionByHash") return TXS[params[0] as string];
    throw new Error(`fake node: no answer for ${method} ${JSON.stringify(params)}`);
  };
  return { rpc, calls };
}

const INIT_TOPIC = keccak256(toBytes("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)"));
/** the captured Initialize log's sqrtPriceX96 (data word 3) */
const OPEN_SQRT = BigInt(`0x${IX.initializeV1.result[0]!.data.slice(2 + 64 * 3, 2 + 64 * 4)}`);
const SWAP_DATA = parseAbiParameters("int128, int128, uint160, uint128, int24, uint24");
const STOCK_DETAIL: Detail = { quote: COINS.aapl, tokenIs0: true, name: "x", symbol: "X", quoteSymbol: "AAPLc", quoteDecimals: 8, fee: 10_000, opening: null, openSqrt: null };
const ETH_DETAIL: Detail = { quote: "0x0000000000000000000000000000000000000000", tokenIs0: false, name: "y", symbol: "Y", quoteSymbol: "ETH", quoteDecimals: 18, fee: 10_000, opening: null, openSqrt: null };

describe("the event topics", () => {
  it("hashes Swap from v4-core's own declaration, and it is the topic the chain sent", () => {
    const source = readFileSync(resolve(ROOT, "node_modules/@uniswap/v4-core/src/interfaces/IPoolManager.sol"), "utf8");
    const decl = /event Swap\(([^)]*)\)/.exec(source)![1]!;
    const types = decl.split(",").map((p) => p.trim().split(/\s+/)[0]!.replace(/^PoolId$/, "bytes32"));
    expect(types).toEqual(["bytes32", "address", "int128", "int128", "uint160", "uint128", "int24", "uint24"]);
    expect(SWAP_TOPIC).toBe(keccak256(toBytes(`Swap(${types.join(",")})`)));
    for (const log of SWAP_LOGS) expect(log.topics[0]).toBe(SWAP_TOPIC);
    for (const log of LAUNCH_LOGS) expect(log.topics[0]).toBe(LAUNCHED_TOPIC);
  });

  it("a Launched log's pool id is the hash of the pool key the factory records", () => {
    const key = "0x" + IX.launchesV1.result.slice(2 + 64 * 2);
    const words = key.slice(2).match(/.{64}/g)!;
    const id = keccak256(
      encodeAbiParameters(parseAbiParameters("address, address, uint24, int24, address"), [
        `0x${words[0]!.slice(24)}`,
        `0x${words[1]!.slice(24)}`,
        Number(`0x${words[2]}`),
        Number(`0x${words[3]}`),
        `0x${words[4]!.slice(24)}`,
      ]),
    );
    expect(id).toBe(ethLaunch.topics[3]);
  });

  it("the clock — head time minus 2 s a block — lands on every captured block's own timestamp", () => {
    for (const log of [...LAUNCH_LOGS, ...SWAP_LOGS]) expect(clock(Number(log.blockNumber))).toBe(Number(log.blockTimestamp));
  });
});

describe("applyLaunches", () => {
  it("reads every launch on both factories, once", () => {
    const state = emptyState();
    expect(applyLaunches(state, LAUNCH_LOGS, clock)).toBe(3);
    expect(applyLaunches(state, LAUNCH_LOGS, clock)).toBe(0);
    const eth = state.coins.get(ethLaunch.topics[3]!)!;
    expect(eth).toMatchObject({
      token: COINS.eth,
      factory: COINS.v1,
      creator: COINS.owner,
      block: 52_066_747,
      at: Number(ethLaunch.blockTimestamp),
      tx: ethLaunch.transactionHash,
      devBuyIn: 0n,
      devBuyTokens: 0n,
      detail: null,
    });
    expect([...state.coins.values()].map((c) => c.factory)).toEqual([COINS.v1, COINS.v2, COINS.v2]);
  });

  it("a log without its own time takes the clock's, and junk is skipped", () => {
    const state = emptyState();
    const junk = [null, 7, { ...ethLaunch, topics: ethLaunch.topics.slice(0, 3) }, { ...ethLaunch, blockNumber: "soon" }, { ...ethLaunch, data: "" }, ethSwap];
    expect(applyLaunches(state, [...junk, withoutTime(ethLaunch), { ...IX.launchedV2.result[0]!, transactionHash: undefined }], clock)).toBe(2);
    expect([...state.coins.values()].map((c) => [c.at, c.tx])).toEqual([
      [clock(52_066_747), ethLaunch.transactionHash],
      [clock(Number(IX.launchedV2.result[0]!.blockNumber)), ""],
    ]);
    expect(applyLaunches(state, "not a list", clock)).toBe(0);
  });
});

describe("applySwaps", () => {
  it("keeps only OUR pools' swaps, once each, decoded as the swapper's deltas", () => {
    const state = emptyState();
    expect(applySwaps(state, SWAP_LOGS, clock)).toBe(0); // no launch known yet: not ours
    applyLaunches(state, LAUNCH_LOGS, clock);
    expect(applySwaps(state, SWAP_LOGS, clock)).toBe(2);
    expect(applySwaps(state, SWAP_LOGS, clock)).toBe(0);
    const [buy] = state.swaps.get(ethSwap.topics[1]!)!;
    // MEASURED: the bot's buy one block after the launch paid 0.000002 ETH — exactly the tx's value — for ~398 tokens
    expect(buy!.amount0).toBe(-BigInt(IX.txs[ethSwap.transactionHash as keyof typeof IX.txs].value));
    expect(buy!.amount1 / 10n ** 18n).toBe(397n); // 397.x — "~398"
    expect(buy).toMatchObject({ block: 52_066_748, at: Number(ethSwap.blockTimestamp), tx: ethSwap.transactionHash, key: `${ethSwap.transactionHash}:0x17` });
    const [stock] = state.swaps.get(stockSwap.topics[1]!)!;
    expect(stock!.amount1).toBe(-29_914n); // 0.00029914 AAPLc in, 8 decimals
    expect(stock!.amount0 > 0n).toBe(true);
    expect(stock!.tick).toBeLessThan(0);
  });

  it("skips junk and takes the clock when a log has no time", () => {
    const state = emptyState();
    applyLaunches(state, LAUNCH_LOGS, clock);
    const junk = [null, ethLaunch, { ...ethSwap, transactionHash: null }, { ...ethSwap, topics: ethSwap.topics.slice(0, 2) }, { ...ethSwap, data: null }, { ...ethSwap, blockNumber: 3 }];
    expect(applySwaps(state, [...junk, withoutTime(ethSwap)], clock)).toBe(1);
    expect(state.swaps.get(ethSwap.topics[1]!)![0]!.at).toBe(clock(52_066_748));
    expect(applySwaps(state, {}, clock)).toBe(0);
  });
});

/** The captures applied, with details as syncOnce would read them. */
function filled(): IndexState {
  const state = emptyState();
  applyLaunches(state, LAUNCH_LOGS, clock);
  applySwaps(state, SWAP_LOGS, clock);
  state.coins.get(ethLaunch.topics[3]!)!.detail = ETH_DETAIL;
  state.coins.get(stockSwap.topics[1]!)!.detail = STOCK_DETAIL;
  state.syncedTo = 52_071_396;
  return state;
}

describe("snapshot", () => {
  const ethAt = Number(ethSwap.blockTimestamp);

  it("serves every coin newest first, with its trades read from its own pool", () => {
    const state = filled();
    state.traders.set(ethSwap.transactionHash, "0xE71A69F434A719Cd5AFa411568B69716aaB3B84a");
    const snap = snapshot(state, ethAt + 60, HEAD.number);
    expect(snap.coins.map((c) => c.token)).toEqual([COINS.stock, COINS.second, COINS.eth]);
    expect(snap.behind).toBe(HEAD.number - 52_071_396);
    expect(snap.totals).toEqual({ coins: 3, creators: 1, trades: 2, trades24h: 1 });
    const eth = snap.coins[2]!;
    expect(eth).toMatchObject({
      quoteSymbol: "ETH",
      trades: 1,
      buys: 1,
      sells: 0,
      volume: 0.000001999486,
      volumeRaw: "1999486000000",
      trades24h: 1,
      buys24h: 1,
      sells24h: 0,
      volume24h: 0.000001999486,
      traders24h: 1,
      tradersPending24h: 0,
      firstTradeAt: ethAt,
      lastTradeAt: ethAt,
      launchedAt: ethAt - 2,
    });
    // ~398 tokens for ~0.000002 ETH, after the trade moved the price: about 5e-9 ETH a token
    expect(eth.price!).toBeGreaterThan(4e-9);
    expect(eth.price!).toBeLessThan(6e-9);
    expect(eth.mcapInQuote).toBeCloseTo(eth.price! * 1e9, 6);
    const stock = snap.coins[0]!;
    expect(stock).toMatchObject({ quote: COINS.aapl, quoteDecimals: 8, buys: 1, sells: 0, volume: 0.00029914, volumeRaw: "29914", trades24h: 0, traders24h: 0 });
    // the stock coin is currency0, so its price is the pool's own price: a fraction of an AAPLc
    expect(stock.price!).toBeGreaterThan(0);
    expect(stock.price!).toBeLessThan(1e-6);
    // the second coin's pair is unread and it has no trade: absent, never zero
    expect(snap.coins[1]).toMatchObject({ quote: null, price: null, tick: null, mcapInQuote: null, buys: null, volume: null, volumeRaw: null, buys24h: null, sells24h: null, volume24h: null, trades: 0, firstTradeAt: null });
    expect(snap.creators).toEqual([{ creator: COINS.owner, launches: 3, tokens: [COINS.stock, COINS.second, COINS.eth], lastLaunchAt: snap.coins[0]!.launchedAt }]);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });

  it("a 24h trade whose sender is not looked up yet is PENDING, not a zero", () => {
    const snap = snapshot(filled(), ethAt + 60);
    expect(snap.coins[2]).toMatchObject({ traders24h: 0, tradersPending24h: 1 });
    expect(snap.head).toBeNull();
    expect(snap.behind).toBeNull();
    expect(snapshot(filled(), ethAt + 86_400).coins[2]!.trades24h).toBe(0);
  });

  it("orders trades in one block by log, coins in one block by address, creators by launches then recency", () => {
    const state = emptyState();
    // variants built FROM the captures: a sell after the buy in the same block, and two more creators
    const [a0, a1, ...rest] = decodeAbiParameters(SWAP_DATA, ethSwap.data as `0x${string}`);
    const sell = { ...ethSwap, logIndex: "0x18", data: encodeAbiParameters(SWAP_DATA, [-a0, -a1, ...rest] as never) };
    const otherCreator = (log: Log, creator: string, id: string) => ({ ...log, topics: [log.topics[0]!, log.topics[1]!.replace(/.$/, id), `0x${creator.padStart(64, "0")}`, log.topics[3]!.replace(/.$/, id)] });
    applyLaunches(state, [ethLaunch, otherCreator(ethLaunch, "aa", "1"), otherCreator(ethLaunch, "bb", "2"), otherCreator({ ...ethLaunch, blockNumber: "0x31a79ba" }, "bb", "3")], clock);
    applySwaps(state, [sell, ethSwap], clock);
    state.coins.get(ethLaunch.topics[3]!)!.detail = ETH_DETAIL;
    const snap = snapshot(state, ethAt);
    expect(snap.coins.map((c) => c.token.slice(-1))).toEqual(["1", "2", "9", "3"]);
    const eth = snap.coins.find((c) => c.token === COINS.eth)!;
    expect(eth).toMatchObject({ trades: 2, buys: 1, sells: 1 });
    expect(snap.creators.map((c) => [c.creator.slice(-2).toLowerCase(), c.launches])).toEqual([["bb", 2], ["aa", 1], ["ab", 1]]);
  });
});

describe("syncOnce", () => {
  const near = (): IndexState => ({ ...emptyState(), syncedTo: 52_066_246 });
  const head = { number: 52_071_396 + 50, timestamp: clock(52_071_446) };

  it("walks forward in chunks, reads each launch's pair and name, and who traded in the last 24h", async () => {
    const { rpc, calls } = fakeNode();
    const state = near();
    const result = await syncOnce(state, rpc, head, 100);
    expect(result).toEqual({ chunks: 6, launches: 3, swaps: 2, error: null });
    expect(state.syncedTo).toBe(head.number);
    const ranges = calls.filter((c) => c.method === "eth_getLogs").map((c) => c.params[0] as { fromBlock: string; toBlock: string });
    for (const r of ranges) expect(Number(r.toBlock) - Number(r.fromBlock)).toBeLessThan(CHUNK);
    expect(Number(ranges[0]!.fromBlock)).toBe(52_066_247);
    // each chunk reads its launches BEFORE its swaps, so a pool trading in its launch chunk is found
    expect(calls.slice(0, 3).map((c) => (Array.isArray((c.params[0] as { address: unknown }).address) ? "launched" : "swap"))).toEqual(["launched", "swap", "launched"]);
    expect([...state.coins.values()].map((c) => c.detail)).toEqual([
      { quote: "0x0000000000000000000000000000000000000000", tokenIs0: false, name: "test", symbol: "test", quoteSymbol: "ETH", quoteDecimals: 18, fee: 10_000, opening: null, openSqrt: OPEN_SQRT },
      // no Initialize log was captured for these pools: an absent log is null, never a guess
      { quote: COINS.aapl, tokenIs0: false, name: "test", symbol: "test", quoteSymbol: "AAPLc", quoteDecimals: 8, fee: 10_000, opening: null, openSqrt: null },
      { quote: COINS.aapl, tokenIs0: true, name: "test2", symbol: "test2", quoteSymbol: "AAPLc", quoteDecimals: 8, fee: 10_000, opening: null, openSqrt: null },
    ]);
    // AAPLc's symbol and decimals are read once for both coins paired with it
    expect(calls.filter((c) => c.method === "eth_call" && (c.params[0] as { to: string }).to === COINS.aapl)).toHaveLength(2);
    // both captured trades were within 24h of this head: their senders are read
    expect([...state.traders.values()].sort()).toEqual(["0xD5C1dFc036F9911348EA8065F73c8123f4013FAB", "0xE71A69F434A719Cd5AFa411568B69716aaB3B84a"]);
    const snap = snapshot(state, head.timestamp, head.number);
    expect(snap.coins.find((c) => c.token === COINS.stock)).toMatchObject({ symbol: "test2", buys: 1, traders24h: 1, tradersPending24h: 0 });
    // and a second step has nothing left to do
    const again = fakeNode();
    expect(await syncOnce(state, again.rpc, head)).toEqual({ chunks: 0, launches: 0, swaps: 0, error: null });
    expect(again.calls).toEqual([]);
  });

  it("starts at the first factory's deploy block, and stops after maxChunks", async () => {
    const { rpc, calls } = fakeNode();
    const state = emptyState();
    expect(await syncOnce(state, rpc, HEAD)).toMatchObject({ chunks: MAX_CHUNKS, error: null });
    expect(Number((calls[0]!.params[0] as { fromBlock: string }).fromBlock)).toBe(FIRST_BLOCK);
    expect(state.syncedTo).toBe(FIRST_BLOCK - 1 + MAX_CHUNKS * CHUNK);
  });

  it("times a log without its own blockTimestamp from the head, to the second", async () => {
    const { rpc } = fakeNode({ fail: (m) => (m === "eth_getLogs" ? [withoutTime(ethLaunch)] : m === "eth_call" ? new Error("enough") : undefined) });
    const state = near();
    await syncOnce(state, rpc, { number: 52_067_000, timestamp: clock(52_067_000) }, 1);
    expect(state.coins.get(ethLaunch.topics[3]!)!.at).toBe(Number(ethLaunch.blockTimestamp));
  });

  it("asks for pool ids in batches of ID_BATCH", async () => {
    const state = near();
    // ID_BATCH + 1 launches built from the capture, each its own pool id
    applyLaunches(state, Array.from({ length: ID_BATCH + 1 }, (_, i) => ({ ...ethLaunch, topics: [...ethLaunch.topics.slice(0, 3), `0x${(i + 1).toString(16).padStart(64, "0")}`] })), clock);
    const { rpc, calls } = fakeNode({ fail: (m) => (m === "eth_call" ? new Error("stop after the logs") : undefined) });
    await syncOnce(state, rpc, { number: 52_066_300, timestamp: clock(52_066_300) });
    expect(calls.filter((c) => c.method === "eth_getLogs").map((c) => ((c.params[0] as { topics: unknown[] }).topics[1] as unknown[] | undefined)?.length)).toEqual([undefined, ID_BATCH, 1]);
  });

  it("a refusal stops the walk where it got to and says why; what was applied stays", async () => {
    let logs = 0;
    const { rpc } = fakeNode({ fail: (m) => (m === "eth_getLogs" && ++logs === 4 ? new Error("The Base RPC answered 429 to eth_getLogs.") : undefined) });
    const state = near();
    expect(await syncOnce(state, rpc, head, 100)).toEqual({ chunks: 1, launches: 1, swaps: 1, error: "The Base RPC answered 429 to eth_getLogs." });
    expect(state.syncedTo).toBe(52_067_246);
    // the next step reads the failed chunk again, whole
    expect(await syncOnce(state, fakeNode().rpc, head, 100)).toMatchObject({ chunks: 5, launches: 2, swaps: 1, error: null });
  });

  it("a transaction without a sender is an error, not a trader", async () => {
    const { rpc } = fakeNode({ fail: (m) => (m === "eth_getTransactionByHash" ? null : undefined) });
    const result = await syncOnce(near(), rpc, head, 100);
    expect(result.error).toMatch(/^The Base RPC sent no sender for transaction 0x/);
  });

  it("looks up at most MAX_TRADERS senders a step", async () => {
    const state = near();
    applyLaunches(state, LAUNCH_LOGS, clock);
    applySwaps(state, Array.from({ length: MAX_TRADERS + 5 }, (_, i) => ({ ...ethSwap, transactionHash: `0x${i.toString(16).padStart(64, "0")}` })), clock);
    state.syncedTo = head.number;
    for (const c of state.coins.values()) c.detail = ETH_DETAIL;
    const { rpc, calls } = fakeNode({ fail: (m) => (m === "eth_getTransactionByHash" ? { from: COINS.owner } : undefined) });
    await syncOnce(state, rpc, head);
    expect(calls).toHaveLength(MAX_TRADERS);
  });
});

describe("readHead and the archive endpoints", () => {
  it("reads the head, and refuses a block without a number or time", async () => {
    expect(await readHead(fakeNode().rpc)).toEqual(HEAD);
    await expect(readHead(async () => ({ number: "0x1" }))).rejects.toThrow("without a number or a time");
    await expect(readHead(async () => null)).rejects.toThrow("without a number or a time");
  });

  it("asks mainnet.base.org first and Tenderly's gateway when it is rate-limited", async () => {
    expect(INDEXER_RPC).toEqual(["https://mainnet.base.org", "https://gateway.tenderly.co/public/base", "https://base-rpc.publicnode.com"]);
    const calls = net({ rpc: (_m, _p, endpoint) => (endpoint === INDEXER_RPC[0] ? new Response("{}", { status: 429 }) : "0x1") });
    expect(await archiveRpc("eth_blockNumber", [])).toBe("0x1");
    expect(calls.map((c) => c.url)).toEqual(INDEXER_RPC.slice(0, 2));
  });
});

describe("the route", () => {
  const get = (path: string, init: { method?: string; header?: boolean } = {}) =>
    new Request(`http://localhost${INDEXER_PATH}${path}`, { method: init.method ?? "GET", headers: init.header === false ? {} : { "x-quadra": "1" } });
  const nearState = () => ({ ...emptyState(), syncedTo: 52_066_246 });
  const atHead = (number: number) => ({ number: `0x${number.toString(16)}`, timestamp: `0x${clock(number).toString(16)}` });

  it("refuses without the header, a route it does not have, and anything but GET", async () => {
    const handle = indexerHandler(); // the defaults: no request below reaches the chain
    expect((await handle(get("/coins", { header: false }))).status).toBe(403);
    const missing = await handle(get("/everything"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ detail: "/everything is not a route of the launchpad index." });
    expect((await handle(get("/coins", { method: "POST" }))).status).toBe(405);
  });

  it("serves the snapshot, asks the chain again only after FRESH_MS, and /creators without the coins", async () => {
    let t = clock(52_071_446) * 1000;
    const node = fakeNode({ fail: (m) => (m === "eth_getBlockByNumber" ? atHead(52_071_446) : undefined) });
    const later = vi.fn();
    const handle = indexerHandler({ rpc: node.rpc, now: () => t, state: nearState(), maxChunks: 100, later });
    const res = await handle(get("/coins"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/max-age=10/);
    const snap = (await res.json()) as Snapshot;
    expect(snap).toMatchObject({ syncedTo: 52_071_446, head: 52_071_446, behind: 0, error: null, totals: { coins: 3, trades: 2 } });
    expect(later).not.toHaveBeenCalled();
    const asked = node.calls.length;
    t += FRESH_MS - 1;
    const creators = (await (await handle(get("/creators"))).json()) as Snapshot;
    expect(creators.coins).toBeUndefined();
    expect(creators.creators).toHaveLength(1);
    expect(node.calls).toHaveLength(asked);
    t += 1;
    await handle(get("/coins"));
    expect(node.calls.length).toBeGreaterThan(asked);
  });

  it("keeps catching up in the background while behind, and two requests share one read", async () => {
    let t = 0;
    const node = fakeNode({ fail: (m) => (m === "eth_getBlockByNumber" ? atHead(52_071_446) : undefined) });
    const steps: (() => void)[] = [];
    const state = nearState();
    const handle = indexerHandler({ rpc: node.rpc, now: () => t, state, maxChunks: 2, later: (step, ms) => (expect(ms).toBe(CATCH_UP_MS), steps.push(step)) });
    const [a, b] = await Promise.all([handle(get("/coins")), handle(get("/coins"))]);
    expect(node.calls.filter((c) => c.method === "eth_getBlockByNumber")).toHaveLength(1);
    expect(((await a.json()) as Snapshot).behind).toBe(52_071_446 - 52_068_246);
    expect(b.status).toBe(200);
    expect(steps).toHaveLength(1);
    steps.shift()!();
    await vi.waitFor(() => expect(steps).toHaveLength(1));
    expect(state.syncedTo).toBe(52_070_246);
    steps.shift()!();
    await vi.waitFor(() => expect(state.traders.size).toBe(2));
    expect(state.syncedTo).toBe(52_071_446);
    expect(steps).toHaveLength(0);
    t = FRESH_MS;
    const done = (await (await handle(get("/coins"))).json()) as Snapshot;
    expect(done.behind).toBe(0);
  });

  it("with the defaults, schedules the next step on a timer", async () => {
    vi.useFakeTimers();
    const node = fakeNode({ fail: (m) => (m === "eth_getBlockByNumber" ? atHead(52_068_000) : undefined) });
    const state = nearState();
    const handle = indexerHandler({ rpc: node.rpc, state, maxChunks: 1 });
    expect((await handle(get("/coins"))).status).toBe(200);
    expect(state.syncedTo).toBe(52_067_246);
    await vi.advanceTimersByTimeAsync(CATCH_UP_MS);
    await vi.waitFor(() => expect(state.syncedTo).toBe(52_068_000));
  });

  it("answers a named 502 while nothing has been read, and serves what it has with the reason after", async () => {
    let down = true;
    let t = 0;
    const node = fakeNode({ fail: (m) => (m === "eth_getBlockByNumber" ? (down ? new Error("The Base RPC could not be reached for eth_getBlockByNumber.") : atHead(52_068_000)) : undefined) });
    const handle = indexerHandler({ rpc: node.rpc, now: () => t, state: nearState(), later: () => {} });
    const res = await handle(get("/coins"));
    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await res.json()).toMatchObject({ detail: "The launchpad index has read nothing from Base yet: The Base RPC could not be reached for eth_getBlockByNumber." });
    down = false;
    t = FRESH_MS;
    expect(((await (await handle(get("/coins"))).json()) as Snapshot).head).toBe(52_068_000);
    down = true;
    t = 2 * FRESH_MS;
    const stale = (await (await handle(get("/coins"))).json()) as Snapshot;
    expect(stale).toMatchObject({ head: 52_068_000, error: "The Base RPC could not be reached for eth_getBlockByNumber." });
  });

  it("says the chain is still being read when a step read nothing and nothing failed", async () => {
    const handle = indexerHandler({ rpc: fakeNode().rpc, maxChunks: 0, later: () => {} });
    expect(await (await handle(get("/coins"))).json()).toMatchObject({ status: 502, detail: "The launchpad index has read nothing from Base yet: the chain is still being read" });
  });

  it("serves the snapshot with the reason when a step failed part-way", async () => {
    let logs = 0;
    const node = fakeNode({ fail: (m) => (m === "eth_getBlockByNumber" ? atHead(52_071_446) : m === "eth_getLogs" && ++logs === 4 ? new Error("refused") : undefined) });
    const later = vi.fn();
    const snap = (await (await indexerHandler({ rpc: node.rpc, state: nearState(), later })(get("/coins"))).json()) as Snapshot;
    expect(snap).toMatchObject({ error: "refused", syncedTo: 52_067_246 });
    expect(later).not.toHaveBeenCalled();
  });
});

describe("the browser client", () => {
  const served = (): Snapshot => snapshot(filled(), Number(ethSwap.blockTimestamp) + 60, HEAD.number);

  it("reads the route's JSON with the header", async () => {
    let header: string | null = null;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/launchpad/coins");
      header = new Headers(init.headers).get("x-quadra");
      return json(served());
    });
    const index = await launchpadCoins();
    expect(header).toBe("1");
    expect(index.coins.map((c) => c.token)).toEqual([COINS.stock, COINS.second, COINS.eth]);
    expect(index.coins[2]).toMatchObject({ quoteSymbol: "ETH", volume: 0.000001999486, trades: 1, buys: 1, traders24h: 0, tradersPending24h: 1 });
    expect(index.coins[1]).toMatchObject({ quote: null, price: null, buys: null });
    expect(index.creators).toEqual([{ creator: COINS.owner, launches: 3, tokens: [COINS.stock, COINS.second, COINS.eth] }]);
    expect(index).toMatchObject({ syncedTo: 52_071_396, behind: HEAD.number - 52_071_396, error: null });
  });

  it("says the indexer is not running when the answer is the SPA's HTML", async () => {
    vi.stubGlobal("fetch", async () => new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(launchpadCoins()).rejects.toThrow(INDEXER_ABSENT);
  });

  it("names an unreachable server, a problem's own detail, and a bare status", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(launchpadCoins()).rejects.toThrow("could not be reached for the launchpad index");
    vi.stubGlobal("fetch", async () => json({ status: 502, detail: "The launchpad index has read nothing from Base yet: x" }, 502));
    await expect(launchpadCoins()).rejects.toThrow("The launchpad index has read nothing from Base yet: x");
    vi.stubGlobal("fetch", async () => json([], 500));
    await expect(launchpadCoins()).rejects.toThrow("The launchpad index answered 500.");
  });

  it("drops a row without its identity, and reads an absent figure as absent", () => {
    const row = served().coins[2]!;
    const index = parseIndex({
      coins: [null, { ...row, token: "0x12" }, { ...row, factory: undefined }, { ...row, creator: 5 }, { ...row, launchBlock: "x" }, { ...row, launchedAt: null }, { token: row.token, factory: row.factory, creator: row.creator, launchBlock: 1, launchedAt: 2, trades: -3 }],
      creators: [null, { creator: "nope" }, { creator: COINS.owner.toLowerCase(), tokens: [COINS.eth.toLowerCase(), "0x1"], launches: "2" }],
    });
    expect(index.coins).toEqual([
      expect.objectContaining({ token: COINS.eth, poolId: "", launchTx: "", name: null, quote: null, price: null, trades: 0, trades24h: 0, traders24h: 0, tradersPending24h: 0 }),
    ]);
    expect(index.creators).toEqual([{ creator: COINS.owner, launches: 2, tokens: [COINS.eth] }]);
    expect(parseIndex("nonsense")).toEqual({ syncedTo: 0, behind: null, error: null, coins: [], creators: [] });
  });
});

describe("coinDetail and GET /coin", () => {
  const ethAt = Number(ethSwap.blockTimestamp);
  // variants built FROM the captured buy: a sell in the same block (its deltas negated), and the
  // captured buy again two hours later (a new candle)
  const [a0, a1, ...rest] = decodeAbiParameters(SWAP_DATA, ethSwap.data as `0x${string}`);
  const sell = { ...ethSwap, logIndex: "0x18", data: encodeAbiParameters(SWAP_DATA, [-a0, -a1, ...rest] as never) };
  const later = { ...ethSwap, transactionHash: `${ethSwap.transactionHash.slice(0, -1)}0`, blockNumber: `0x${(52_066_748 + 3600).toString(16)}`, blockTimestamp: `0x${(ethAt + 7200).toString(16)}` };
  const withTrades = () => {
    const state = filled();
    applySwaps(state, [sell, later], clock);
    state.traders.set(ethSwap.transactionHash, "0xE71A69F434A719Cd5AFa411568B69716aaB3B84a");
    return state;
  };

  it("lists trades newest first, takes each fee from the side the trader paid in, and draws hourly candles", () => {
    const d = coinDetail(withTrades(), COINS.eth.toLowerCase(), ethAt + 7300)!;
    expect(d.feeBps).toBe(100);
    expect(d.coin.token).toBe(COINS.eth);
    expect(d.trades.map((t) => t.side)).toEqual(["buy", "sell", "buy"]);
    const [, s, b] = d.trades;
    // a buy pays ETH in: its fee is 1% of the ETH; a sell pays tokens in: its fee is 1% of the tokens
    expect(b).toMatchObject({ feeIn: "quote", quote: 0.000001999486, trader: "0xE71A69F434A719Cd5AFa411568B69716aaB3B84a" });
    expect(b!.fee).toBeCloseTo(0.000001999486 / 100, 15);
    expect(s).toMatchObject({ feeIn: "token" });
    expect(d.trades[0]!.trader).toBeNull(); // the later buy's sender was never looked up
    expect(s!.fee).toBeCloseTo(s!.tokens / 100, 6);
    expect(d.feesQuote).toBeCloseTo(2 * b!.fee, 15);
    expect(d.feesToken).toBeCloseTo(s!.fee, 6);
    expect(d.candles).toHaveLength(2);
    expect(d.candles[0]).toMatchObject({ at: ethAt - (ethAt % 3600), trades: 2 });
    expect(d.candles[1]).toMatchObject({ at: ethAt + 7200 - ((ethAt + 7200) % 3600), trades: 1 });
    expect(d.candles[0]!.high).toBeGreaterThanOrEqual(d.candles[0]!.low);
  });

  it("reads a coin that is currency0 (the AAPLc pair): its buy paid AAPLc in, fee in AAPLc", () => {
    const d = coinDetail(filled(), COINS.stock, ethAt)!;
    expect(d.trades).toEqual([expect.objectContaining({ side: "buy", feeIn: "quote", quote: 0.00029914 })]);
    expect(d.feesQuote).toBe(0.00000299); // 29,914 base units × 1% = 299, truncated — never rounded up
    expect(d.feesToken).toBe(0);
  });

  it("keeps at most TRADES_SHOWN trades", () => {
    const state = filled();
    const many = Array.from({ length: TRADES_SHOWN + 5 }, (_, i) => ({ ...ethSwap, logIndex: `0x${(0x100 + i).toString(16)}` }));
    applySwaps(state, many, clock);
    expect(coinDetail(state, COINS.eth, ethAt)!.trades).toHaveLength(TRADES_SHOWN);
  });

  it("an unknown coin is null; a coin whose pair is unread has no figures, never zeros; one with no trades has none", () => {
    const state = filled();
    expect(coinDetail(state, "0x0000000000000000000000000000000000000001", ethAt)).toBeNull();
    expect(coinDetail(state, COINS.second, ethAt)).toMatchObject({ trades: [], candles: [], points: [], feesQuote: null, feesToken: null, feeBps: 100 });
    const second = [...state.coins.values()].find((c) => c.token === COINS.second)!;
    second.detail = STOCK_DETAIL;
    expect(coinDetail(state, COINS.second, ethAt)).toMatchObject({ trades: [], candles: [], feesQuote: 0, feesToken: 0 });
  });

  it("starts the points at the pool's opening price, read from its real Initialize log — the price the live index served", async () => {
    const state = withTrades();
    const coin = [...state.coins.values()].find((c) => c.token === COINS.eth)!;
    const { rpc, calls } = fakeNode();
    const sqrt = await openingSqrt(rpc, coin);
    expect(sqrt).toBe(OPEN_SQRT);
    expect(calls[0]!.params[0]).toMatchObject({ topics: [INIT_TOPIC, coin.poolId], fromBlock: "0x31a79bb", toBlock: "0x31a79bb" });
    coin.detail = { ...ETH_DETAIL, openSqrt: sqrt };
    const d = coinDetail(state, COINS.eth, ethAt + 7300)!;
    expect(d.points[0]).toEqual({ at: coin.at, price: 4.973987206075924e-9 });
    expect(d.points.slice(1).map((p) => p.at)).toEqual([ethAt, ethAt, ethAt + 7200]);
    expect(d.points).toHaveLength(4);
    // without the opening price, the line starts at the first trade
    coin.detail = ETH_DETAIL;
    expect(coinDetail(state, COINS.eth, ethAt)!.points.map((p) => p.at)).toEqual([ethAt, ethAt, ethAt + 7200]);
  });

  it("openingSqrt: no Initialize log (or a short one) is null; readDetail turns a failed read into null", async () => {
    const coin = [...filled().coins.values()].find((c) => c.token === COINS.eth)!;
    expect(await openingSqrt(fakeNode({ fail: () => [] }).rpc, coin)).toBeNull();
    expect(await openingSqrt(fakeNode({ fail: () => [{ data: "0x00" }, "junk"] }).rpc, coin)).toBeNull();
  });

  const get = (path: string) => new Request(`http://localhost${INDEXER_PATH}${path}`, { headers: { "x-quadra": "1" } });
  const atHead = (number: number) => ({ number: `0x${number.toString(16)}`, timestamp: `0x${clock(number).toString(16)}` });

  it("serves a coin's page, a 400 for a malformed token and a 404 for one it does not know", async () => {
    const node = fakeNode({ fail: (m) => (m === "eth_getBlockByNumber" ? atHead(52_071_446) : undefined) });
    const handle = indexerHandler({ rpc: node.rpc, now: () => clock(52_071_446) * 1000, state: { ...emptyState(), syncedTo: 52_066_246 }, maxChunks: 100, later: () => {} });
    expect((await handle(get("/coin?token=0x12"))).status).toBe(400);
    expect((await handle(get("/coin"))).status).toBe(400);
    const missing = await handle(get("/coin?token=0x0000000000000000000000000000000000000001"));
    expect(missing.status).toBe(404);
    const res = await handle(get(`/coin?token=${COINS.eth}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/max-age=10/);
    const body = await res.json();
    expect(body).toMatchObject({ syncedTo: 52_071_446, head: 52_071_446, behind: 0, error: null, coin: { token: COINS.eth }, feeBps: 100 });
    expect(body.trades).toHaveLength(1);
  });

  it("a coin's page with the head unread says behind: null", async () => {
    let up = true;
    let t = 0;
    const node = fakeNode({ fail: (m) => (m === "eth_getBlockByNumber" ? (up ? atHead(52_071_446) : new Error("down")) : undefined) });
    const state = filled();
    const handle = indexerHandler({ rpc: node.rpc, now: () => t, state, maxChunks: 0, later: () => {} });
    up = false;
    const body = await (await handle(get(`/coin?token=${COINS.eth}`))).json();
    expect(body).toMatchObject({ head: null, behind: null, error: "down" });
  });
});

describe("the browser client: a coin's page", () => {
  const ethAt = Number(ethSwap.blockTimestamp);
  const served = () => ({ ...coinDetail(filled(), COINS.eth, ethAt + 60)!, syncedTo: 1, head: 2, behind: 1, error: null });

  it("asks /coin with the token and reads its trades and candles", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      expect(url).toBe(`/api/launchpad/coin?token=${COINS.eth}`);
      return json(served());
    });
    const page = await launchpadCoin(COINS.eth);
    expect(page.coin.token).toBe(COINS.eth);
    expect(page.trades).toHaveLength(1);
    expect(page.trades[0]).toMatchObject({ side: "buy", feeIn: "quote", trader: null });
    expect(page.candles).toHaveLength(1);
    expect(page.points).toEqual([{ at: ethAt, price: page.trades[0]!.price }]);
    expect(page).toMatchObject({ feeBps: 100, behind: 1 });
  });

  it("drops malformed trades and candles, and throws without a coin", () => {
    const s = served();
    const t = s.trades[0]!;
    const c = s.candles[0]!;
    const page = parseCoinPage({
      ...s,
      trades: [null, { ...t, at: "x" }, { ...t, tx: "" }, { ...t, price: null }, { ...t, tokens: null }, { ...t, quote: null }, { ...t, fee: null }, { ...t, side: "hold" }, { ...t, feeIn: "both" }, { ...t, side: "sell", feeIn: "token", trader: COINS.owner.toLowerCase() }],
      candles: [null, { ...c, at: null }, { ...c, open: null }, { ...c, high: null }, { ...c, low: null }, { ...c, close: null }, { ...c, trades: null }, c],
      feesQuote: "nope",
    });
    expect(page.trades).toEqual([expect.objectContaining({ side: "sell", feeIn: "token", trader: COINS.owner })]);
    expect(page.candles).toEqual([c]);
    expect(page.feesQuote).toBeNull();
    expect(parseCoinPage({ ...s, points: [null, 3, { at: "x", price: 1 }, { at: 1 }, { at: 5, price: 2 }] }).points).toEqual([{ at: 5, price: 2 }]);
    expect(parseCoinPage({ ...s, points: undefined }).points).toEqual([]);
    expect(() => parseCoinPage({ ...s, coin: null })).toThrow("The launchpad index answered without the coin.");
    expect(() => parseCoinPage("nonsense")).toThrow("without the coin");
  });
});

describe("the index kept between function runs (T3, 2026-11-04)", () => {
  const get = (path: string) => new Request(`http://localhost${INDEXER_PATH}${path}`, { headers: { "x-quadra": "1" } });
  const atHead = (number: number) => ({ number: `0x${number.toString(16)}`, timestamp: `0x${clock(number).toString(16)}` });
  const memory = (text: string | null = null) => {
    const box = { text, saves: 0 };
    const store: Store = { load: async () => box.text, save: async (t) => void ((box.text = t), box.saves++) };
    return { box, store };
  };

  it("encodes the state with its bigints and Maps, and reads it back exactly", async () => {
    const state = { ...emptyState(), syncedTo: 52_066_246 };
    await syncOnce(state, fakeNode().rpc, { number: 52_071_446, timestamp: clock(52_071_446) }, 100);
    state.referrers.set(COINS.eth.toLowerCase(), "0x884FBdd5cF193E7F87CBA76419e526D8F4dF7A9B");
    const back = decodeState(encodeState(state))!;
    expect([...back.referrers]).toEqual([...state.referrers]);
    expect([...back.quotes]).toEqual([...state.quotes]);
    expect(back.syncedTo).toBe(state.syncedTo);
    expect([...back.coins]).toEqual([...state.coins]);
    expect([...back.swaps]).toEqual([...state.swaps]);
    expect([...back.traders]).toEqual([...state.traders]);
    expect(typeof [...back.swaps.values()][0]![0]!.amount0).toBe("bigint");
  });

  it("refuses what it cannot use: nothing, junk, another version, no block", () => {
    expect(decodeState(null)).toBeNull();
    expect(decodeState("{nope")).toBeNull();
    expect(decodeState("null")).toBeNull();
    expect(decodeState(JSON.stringify({ v: STATE_VERSION + 1, syncedTo: 1 }))).toBeNull();
    expect(decodeState(JSON.stringify({ v: STATE_VERSION }))).toBeNull();
    // the lists may be absent: an empty index at that block
    expect(decodeState(JSON.stringify({ v: STATE_VERSION, syncedTo: 7 }))).toMatchObject({ syncedTo: 7 });
  });

  it("keeps the index in a Blob at one path, private by default, read past the CDN's cache", async () => {
    const calls: unknown[][] = [];
    const blob = {
      get: async (...a: unknown[]) => (calls.push(["get", ...a]), { stream: new Response("saved").body }),
      put: async (...a: unknown[]) => void calls.push(["put", ...a]),
    };
    const store = blobStore(blob, "tok");
    expect(await store.load()).toBe("saved");
    await store.save("next");
    expect(calls).toEqual([
      ["get", STATE_PATH, { access: "private", useCache: false, token: "tok" }],
      ["put", STATE_PATH, "next", { access: "private", allowOverwrite: true, addRandomSuffix: false, contentType: "application/json", token: "tok" }],
    ]);
    const none = blobStore({ get: async () => null, put: async () => undefined }, "tok", "public");
    expect(await none.load()).toBeNull();
    expect(await blobStore({ get: async () => ({ stream: null }), put: async () => undefined }, "tok").load()).toBeNull();
  });

  it("steps forward for up to its budget, then saves; the next run starts where the last saved", async () => {
    let t = 0;
    const node = fakeNode({ fail: (m) => (m === "eth_getBlockByNumber" ? atHead(52_071_446) : undefined) });
    const { box, store } = memory(encodeState({ ...emptyState(), syncedTo: 52_066_246 }));
    // each chunk step costs a second of the clock; the budget allows two
    const rpc: Rpc = async (m, p) => {
      if (m === "eth_getLogs") t += 1000;
      return node.rpc(m, p);
    };
    const later = vi.fn();
    const handle = indexerHandler({ rpc, now: () => t, store, budgetMs: 2_500, maxChunks: 1, later });
    expect((await handle(get("/coins"))).status).toBe(200);
    expect(later).not.toHaveBeenCalled();
    expect(box.saves).toBe(1);
    const saved = decodeState(box.text)!;
    expect(saved.syncedTo).toBeGreaterThan(52_066_246);
    expect(saved.syncedTo).toBeLessThan(52_071_446);
    // a fresh run (another function instance) reads the saved index and carries on from it
    const next = indexerHandler({ rpc: node.rpc, now: () => t + FRESH_MS, store, maxChunks: 100 });
    expect(((await (await next(get("/coins"))).json()) as Snapshot).behind).toBe(0);
    expect(decodeState(box.text)!.syncedTo).toBe(52_071_446);
    expect(STORE_BUDGET_MS).toBeGreaterThan(0);
  });

  it("saves nothing when nothing moved, starts from memory when the store cannot be read, and says when it cannot save", async () => {
    let t = 0;
    const node = fakeNode({ fail: (m) => (m === "eth_getBlockByNumber" ? atHead(52_071_446) : undefined) });
    const caught = { ...emptyState(), syncedTo: 52_071_446 };
    const quiet = memory(encodeState(caught));
    await indexerHandler({ rpc: node.rpc, now: () => t, store: quiet.store, maxChunks: 100 })(get("/creators"));
    expect(quiet.box.saves).toBe(0);
    const broken: Store = { load: async () => Promise.reject(new Error("blob down")), save: async () => Promise.reject(new Error("blob full")) };
    const res = (await (await indexerHandler({ rpc: node.rpc, now: () => t, state: { ...emptyState(), syncedTo: 52_066_246 }, store: broken, maxChunks: 100 })(get("/coins"))).json()) as Snapshot;
    expect(res.behind).toBe(0);
    expect(res.error).toBe("the index could not be saved: blob full");
    // an OLDER stored index never replaces a newer one in memory
    const older = memory(encodeState({ ...emptyState(), syncedTo: 52_066_246 }));
    const state = { ...emptyState(), syncedTo: 52_071_446 };
    t = 5;
    await indexerHandler({ rpc: node.rpc, now: () => t, state, store: older.store })(get("/coins"));
    expect(state.syncedTo).toBe(52_071_446);
  });

  it("stops stepping at a refusal, and saves what it got before it", async () => {
    // the second chunk's logs are refused: the first chunk is kept, and saved
    const node = fakeNode({
      fail: (m, p) => {
        if (m === "eth_getBlockByNumber") return atHead(52_071_446);
        if (m === "eth_getLogs" && Number((p[0] as { fromBlock: string }).fromBlock) >= 52_067_247) return new Error("logs refused");
        return undefined;
      },
    });
    const { box, store } = memory(null);
    const snap = (await (await indexerHandler({ rpc: node.rpc, state: { ...emptyState(), syncedTo: 52_066_246 }, store, maxChunks: 1 })(get("/coins"))).json()) as Snapshot;
    expect(snap.error).toMatch(/logs refused/);
    expect(box.saves).toBe(1);
  });

  it("keeps the step's own refusal when the save fails too", async () => {
    let first = true;
    const node = fakeNode({
      fail: (m) => {
        if (m === "eth_getBlockByNumber") return atHead(52_071_446);
        if (m === "eth_getTransactionByHash" && first) return ((first = false), new Error("node refused"));
        return undefined;
      },
    });
    const broken: Store = { load: async () => null, save: async () => Promise.reject(new Error("blob full")) };
    const snap = (await (await indexerHandler({ rpc: node.rpc, state: { ...emptyState(), syncedTo: 52_066_246 }, store: broken, maxChunks: 100 })(get("/coins"))).json()) as Snapshot;
    expect(snap.error).toMatch(/node refused/);
  });
});
