import { encodeFunctionData, decodeFunctionResult, encodeAbiParameters, keccak256 as hash, parseAbi, parseAbiParameters } from "viem";
import { UNISWAP_V4_POOL_MANAGER, USDC, WETH } from "@/config/chain";
import { toChecksumAddress } from "@/lib/address";
import { keccak256, toHex, utf8 } from "@/lib/keccak";
import { TRANSFER_TOPIC } from "@/lib/transact";
import { chainToken } from "@/skills/chaintoken";
import { marketsOf, type Market } from "@/skills/dexscreener";
import { ethCall, quantity, rpc } from "@/skills/http";
import { isObj, listOf, strOf } from "@/skills/json";
import { blocksAgo, minutesBetween } from "@/skills/blocktime";

/**
 * The Recycle Bin's contents: Uniswap v4 pools EMPTIED in the last three hours — at least 90% of
 * their liquidity taken out. Read from the chain, never guessed: the PoolManager's `ModifyLiquidity`
 * logs with a negative delta say how much was taken from each pool; one `extsload` reads every
 * candidate's liquidity NOW; a pool is in the bin when what was taken is at least nine times what is
 * left. MEASURED 2026-10-14 over three hours: 226 pools had something removed, 76 sat at exactly
 * zero and 95 had lost 90% or more — the rest of an "emptied" pool is usually a few wei of dust, so
 * "exactly zero" missed a fifth of them. (One hour held none at zero: the window matters.) The coin is whatever left
 * the PoolManager in the emptying transaction that is not ETH, WETH or USDC (its receipt), and who
 * emptied it is that transaction's sender.
 *
 * "Emptied" is a fact, not a verdict: a creator closing a test pool empties it too. The bin says
 * what happened and links each coin to Token Verdict for the why.
 */

/** v4-core's `ModifyLiquidity`, from node_modules/@uniswap/v4-core/src/interfaces/IPoolManager.sol, hashed here. */
export const MODIFY_LIQUIDITY_TOPIC = toHex(keccak256(utf8("ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)")));
/** v4-core's StateLibrary: `pools` is mapping slot 6, liquidity is word 3 of a pool's state. */
const POOLS_SLOT = 6n;
const LIQUIDITY_OFFSET = 3n;
export const BIN_MINUTES = 180;
/**
 * Blocks per `eth_getLogs`: an hour of 0.2 s blocks. MEASURED 2026-11-11: base.publicnode.com
 * answers 18,000 blocks of ModifyLiquidity (3,264 logs) in one call; mainnet.base.org caps a range
 * at 2,000, so at the old 1,800 three hours became 30 parallel calls — a rate limit by itself.
 */
export const LOG_CHUNK = 18_000;
/** Emptied pools whose coin is looked up — the bin is a list for a person, not an index. */
export const BIN_MAX = 12;

const EXTSLOAD = parseAbi(["function extsload(bytes32[] slots) view returns (bytes32[])"]);
const QUOTES = new Set(["0x0000000000000000000000000000000000000000", "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", WETH.address.toLowerCase(), USDC.address.toLowerCase()]);

export type Removal = { readonly pool: string; readonly tx: string; readonly block: number; readonly removed: bigint };

const signed256 = (hex: string) => {
  const n = BigInt(`0x${hex}`);
  return n >= 1n << 255n ? n - (1n << 256n) : n;
};

/** The removals in a window of `ModifyLiquidity` logs, per pool: everything taken, and the LAST removal (the one that emptied it). */
export function parseRemovals(logs: unknown): Removal[] {
  const last = new Map<string, Removal>();
  for (const l of listOf(logs)) {
    if (!isObj(l)) continue;
    const topics = listOf(l.topics).filter((t): t is string => typeof t === "string");
    const data = strOf(l.data);
    const tx = strOf(l.transactionHash);
    const block = strOf(l.blockNumber);
    if (topics.length < 2 || !data || data.length < 2 + 64 * 4 || !tx || !block) continue;
    const delta = signed256(data.slice(2 + 64 * 2, 2 + 64 * 3));
    if (delta >= 0n) continue;
    const pool = topics[1]!.toLowerCase();
    const before = last.get(pool)?.removed ?? 0n;
    last.set(pool, { pool, tx, block: Number(BigInt(block)), removed: before - delta });
  }
  return [...last.values()];
}

/** Emptied: what was taken is at least nine times what is left — 90% or more gone. */
export function emptied(removed: bigint, left: bigint): boolean {
  return removed > 0n && removed >= 9n * left;
}

/** The storage slot holding a pool's liquidity. */
export function liquiditySlot(pool: string): `0x${string}` {
  const state = BigInt(hash(encodeAbiParameters(parseAbiParameters("bytes32, uint256"), [pool as `0x${string}`, POOLS_SLOT])));
  return `0x${(state + LIQUIDITY_OFFSET).toString(16).padStart(64, "0")}`;
}

/** Every pool's liquidity now, in one call. */
export async function liquidities(pools: readonly string[]): Promise<bigint[]> {
  const data = encodeFunctionData({ abi: EXTSLOAD, functionName: "extsload", args: [pools.map(liquiditySlot)] });
  const words = decodeFunctionResult({ abi: EXTSLOAD, functionName: "extsload", data: await ethCall(UNISWAP_V4_POOL_MANAGER, data) });
  // liquidity is a uint128 in the low half of the word
  return words.map((w) => BigInt(w) & ((1n << 128n) - 1n));
}

/** From the emptying transaction's receipt: who sent it and the coin that left the PoolManager. */
export function parseEmptying(receipt: unknown): { readonly by: string; readonly token: string } | null {
  if (!isObj(receipt)) return null;
  const by = strOf(receipt.from);
  const manager = `0x${UNISWAP_V4_POOL_MANAGER.slice(2).toLowerCase().padStart(64, "0")}`;
  for (const l of listOf(receipt.logs)) {
    if (!isObj(l)) continue;
    const topics = listOf(l.topics).filter((t): t is string => typeof t === "string");
    const token = strOf(l.address)?.toLowerCase();
    if (topics[0]?.toLowerCase() === TRANSFER_TOPIC && topics[1]?.toLowerCase() === manager && token && !QUOTES.has(token)) {
      return by ? { by: toChecksumAddress(by), token: toChecksumAddress(token) } : null;
    }
  }
  return null;
}

export type Emptied = {
  readonly pool: string;
  readonly token: string;
  readonly symbol: string;
  readonly by: string;
  readonly tx: string;
  readonly minutesAgo: number;
  readonly market: Market | null;
};

/** `unread`: emptied pools whose emptying transaction could not be read — said, never dropped (a missing answer is not "none"). */
export type Bin = { readonly latest: number; readonly minutes: number; readonly removals: number; readonly emptied: readonly Emptied[]; readonly unread: number };

export async function recycleBin(minutes = BIN_MINUTES): Promise<Bin> {
  const latest = Number(quantity(await rpc("eth_blockNumber"), "the latest block"));
  const from = blocksAgo(latest, minutes);
  const chunks: [number, number][] = [];
  for (let start = from; start <= latest; start += LOG_CHUNK) chunks.push([start, Math.min(latest, start + LOG_CHUNK - 1)]);
  const pages = await Promise.all(
    chunks.map(([a, b]) =>
      rpc("eth_getLogs", [{ address: UNISWAP_V4_POOL_MANAGER, topics: [MODIFY_LIQUIDITY_TOPIC], fromBlock: `0x${a.toString(16)}`, toBlock: `0x${b.toString(16)}` }]),
    ),
  );
  // oldest chunk first, so a pool's last removal is the newest one
  const removals = parseRemovals(pages.flatMap((p) => listOf(p)));
  if (removals.length === 0) return { latest, minutes, removals: 0, emptied: [], unread: 0 };
  const now = await liquidities(removals.map((r) => r.pool));
  const empty = removals.filter((r, i) => emptied(r.removed, now[i]!)).sort((a, b) => b.block - a.block).slice(0, BIN_MAX);

  // one receipt at a time — a burst of them is what public RPCs rate-limit first (MEASURED: 403s)
  const found: (Removal & { by: string; token: string })[] = [];
  let unread = 0;
  for (const r of empty) {
    const receipt = await rpc("eth_getTransactionReceipt", [r.tx]).catch(() => undefined);
    if (receipt === undefined) {
      unread += 1;
      continue;
    }
    const what = parseEmptying(receipt);
    if (what) found.push({ ...r, ...what });
  }

  const markets = await marketsOf(found.map((f) => f.token)).catch(() => [] as Market[]);
  const byPool = new Map(markets.flatMap((m) => (m.pair ? [[m.pair.toLowerCase(), m] as const] : [])));
  const bySymbol = new Map(markets.flatMap((m) => (m.base && m.symbol ? [[m.base.toLowerCase(), m.symbol] as const] : [])));

  const list = await Promise.all(
    found.map(async (f) => ({
      pool: f.pool,
      token: f.token,
      symbol: bySymbol.get(f.token.toLowerCase()) ?? (await chainToken(f.token).then((t) => t.symbol, () => "unnamed")),
      by: f.by,
      tx: f.tx,
      minutesAgo: minutesBetween(f.block, latest),
      market: byPool.get(f.pool) ?? null,
    })),
  );
  // the busiest market first: an emptied pool people were trading is the one worth reading about
  list.sort((a, b) => (b.market?.volume24h ?? 0) - (a.market?.volume24h ?? 0));
  // one file per coin: a coin emptied from two pools is one disappearance
  const seen = new Set<string>();
  const unique = list.filter((e) => !seen.has(e.token.toLowerCase()) && seen.add(e.token.toLowerCase()));
  return { latest, minutes, removals: removals.length, emptied: unique, unread };
}
