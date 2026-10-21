import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256 as hash, parseAbi, parseAbiParameters } from "viem";
import { CONTRACTS, UNISWAP_V4_POOL_MANAGER } from "@/config/chain";
import { DYNAMIC_FEE_FLAG, LAUNCH_HOOK_ABI, LAUNCHPAD_ABI, LAUNCHPAD_EXPECTS } from "@/config/launchpad";
import { toChecksumAddress } from "@/lib/address";
import { keccak256, toHex, utf8 } from "@/lib/keccak";
import { BLOCKSCOUT } from "@/skills/blockscout";
import { launcherProfile, type Origin } from "@/skills/origin";
import { BRAND } from "@/brand";
import { ethCall, getJson, rpc } from "@/skills/http";
import { isObj, listOf, strOf } from "@/skills/json";
import { deepest, ethUsd, markets } from "@/skills/dexscreener";

/**
 * Reading this app's own launchpad: whether a token was launched there and by whom, which launches
 * fall in a block range, who launched what, and what fees are waiting to be collected.
 *
 * There are two factories. v1 (`CONTRACTS.launchFactoryV1`, ETH pairs only) is deployed and holds
 * the first real launches; v2 (`CONTRACTS.launchFactory`, ETH or stock pairs) takes every new launch
 * once the owner deploys it. Both are READ here, with the same calls: v2 keeps v1's `launches`,
 * `collect` and `Launched` signatures on purpose, so one reader serves both.
 *
 * A launchpad token's guarantees are the contract's, so they can be STATED rather than guessed: a
 * fixed supply with no admin, and liquidity no function can remove.
 *
 * MEASURED 2026-10-02 against v1: `launches(token)` answers the creator for one of its tokens and an
 * all-zero record for any other; `collect(token)` run as an `eth_call` returns exactly the fees
 * `collect` would pay, without paying; and mainnet.base.org limits `eth_getLogs` to 2,000 blocks while
 * a factory gains ~43,200 a day — so "who launched what" comes from Blockscout's log index, and only
 * a short window (the radar's) comes from the chain.
 */

/** The `Launched` event's topic, hashed from its signature here rather than copied. */
export const LAUNCHED_TOPIC = toHex(keccak256(utf8("Launched(address,address,bytes32,uint256,uint256)")));

const ZERO = "0x0000000000000000000000000000000000000000";
const topicAddress = (t: string | undefined) => (t ? toChecksumAddress(`0x${t.slice(-40)}`) : null);

/** Every factory there is, newest first — v3, v2, v1, each only once set; none, and then nothing is asked. */
export function factories(): string[] {
  return [CONTRACTS.launchFactoryV3, CONTRACTS.launchFactory, CONTRACTS.launchFactoryV1].filter((f): f is string => f !== null);
}

/** Whether `factory` is launchpad v3 (a chosen fee and the anti-sniper opening) — never true while it is not deployed. */
export function isV3(factory: string): boolean {
  return factory.toLowerCase() === CONTRACTS.launchFactoryV3?.toLowerCase();
}

export type LaunchRecord = { readonly factory: string; readonly creator: string; readonly creatorRecipient: string };

/** Who launched `token` on a launchpad, and on which factory — or `null` when it was not launched there. */
export async function launchOf(token: string): Promise<LaunchRecord | null> {
  for (const factory of factories()) {
    const data = encodeFunctionData({ abi: LAUNCHPAD_ABI, functionName: "launches", args: [token as `0x${string}`] });
    const record = decodeFunctionResult({ abi: LAUNCHPAD_ABI, functionName: "launches", data: await ethCall(factory, data) });
    if (record.creator !== ZERO) {
      return { factory, creator: toChecksumAddress(record.creator), creatorRecipient: toChecksumAddress(record.creatorRecipient) };
    }
  }
  return null;
}

/** Every token the launchpads launched in [from, to] — for a window short enough for one `eth_getLogs`. */
export async function launchedBetween(from: number, to: number): Promise<Set<string>> {
  const all = factories();
  if (all.length === 0) return new Set();
  const logs = await rpc("eth_getLogs", [{ address: all, topics: [LAUNCHED_TOPIC], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }]);
  const tokens = new Set<string>();
  for (const log of listOf(logs)) {
    const token = isObj(log) ? topicAddress(strOf(listOf(log.topics)[1]) ?? undefined) : null;
    if (token) tokens.add(token.toLowerCase());
  }
  return tokens;
}

export type Launch = { readonly factory: string; readonly token: string; readonly creator: string; readonly block: number; readonly at: Date | null; readonly tx: string };

/** One page of Blockscout's log index for a factory, read into launches. */
export function parseLaunchLogs(body: unknown, factory: string): { readonly launches: Launch[]; readonly more: boolean } {
  const items = listOf(isObj(body) ? body.items : null);
  const launches = items.flatMap((i) => {
    if (!isObj(i)) return [];
    const topics = listOf(i.topics).filter((t): t is string => typeof t === "string");
    if (topics[0] !== LAUNCHED_TOPIC) return [];
    const token = topicAddress(topics[1]);
    const creator = topicAddress(topics[2]);
    const block = Number(i.block_number);
    const at = Date.parse(strOf(i.block_timestamp) ?? "");
    if (!token || !creator || !Number.isFinite(block)) return [];
    return [{ factory, token, creator, block, at: Number.isNaN(at) ? null : new Date(at), tx: strOf(i.transaction_hash) ?? "" }];
  });
  return { launches, more: isObj(body) && isObj(body.next_page_params) };
}

/** Pages of a factory's log index read at most — 50 logs each. */
export const LOG_PAGES = 4;

/** A factory's launches from its log index — every one, or only `creator`'s. */
async function launchesOn(factory: string, creator: string | null): Promise<{ launches: Launch[]; complete: boolean }> {
  const mine: Launch[] = [];
  let url = `${BLOCKSCOUT}/addresses/${factory}/logs`;
  for (let page = 0; page < LOG_PAGES; page++) {
    const body = await getJson("Blockscout", url);
    const { launches, more } = parseLaunchLogs(body, factory);
    mine.push(...launches.filter((l) => creator === null || l.creator.toLowerCase() === creator.toLowerCase()));
    if (!more) return { launches: mine, complete: true };
    const next = (body as { next_page_params: Record<string, unknown> }).next_page_params;
    url = `${BLOCKSCOUT}/addresses/${factory}/logs?${new URLSearchParams(Object.entries(next).map(([k, v]) => [k, String(v)]))}`;
  }
  return { launches: mine, complete: false };
}

/**
 * The launches `creator` made on every factory — or, with `null`, everybody's — newest first, from
 * Blockscout's index of their logs.
 */
export async function launchesBy(creator: string | null): Promise<{ readonly launches: Launch[]; readonly complete: boolean }> {
  const each = await Promise.all(factories().map((f) => launchesOn(f, creator)));
  return { launches: each.flatMap((e) => e.launches).sort((a, b) => b.block - a.block), complete: each.every((e) => e.complete) };
}

/**
 * The fees `collect(token)` would pay right now on its factory — the call run as an `eth_call`,
 * nothing sent — split into the quote's share and the token's, with the quote named by address.
 */
export async function pendingFees(factory: string, token: string): Promise<{ readonly quote: string; readonly inQuote: bigint; readonly inToken: bigint }> {
  const launches = encodeFunctionData({ abi: LAUNCHPAD_ABI, functionName: "launches", args: [token as `0x${string}`] });
  const collect = encodeFunctionData({ abi: LAUNCHPAD_ABI, functionName: "collect", args: [token as `0x${string}`] });
  const [record, fees] = await Promise.all([ethCall(factory, launches), ethCall(factory, collect)]);
  const { key } = decodeFunctionResult({ abi: LAUNCHPAD_ABI, functionName: "launches", data: record });
  const [amount0, amount1] = decodeFunctionResult({ abi: LAUNCHPAD_ABI, functionName: "collect", data: fees });
  const tokenIs1 = key.currency1.toLowerCase() === token.toLowerCase();
  return { quote: tokenIs1 ? key.currency0 : key.currency1, inQuote: tokenIs1 ? amount0 : amount1, inToken: tokenIs1 ? amount1 : amount0 };
}

/**
 * A launchpad token's origin, from the factory instead of from guesswork: the creator the factory
 * recorded, that wallet's history, and how many launches it has made on the launchpad. MEASURED on
 * the first real launch: a MetaMask Smart Account (EIP-7702) sends the launch TO MetaMask's
 * DelegationManager, so the generic path named "DelegationManager" as the launchpad.
 */
export async function launchpadOrigin(record: LaunchRecord): Promise<Origin> {
  const [launcher, made] = await Promise.all([launcherProfile(record.creator, null), launchesBy(record.creator)]);
  return {
    via: { address: record.factory, name: `${BRAND.name}'s launchpad` },
    // the count comes from the factories' own log index, complete or not on its own terms
    launcher: { ...launcher, factoryCalls: made.launches.length, callsComplete: made.complete },
  };
}

// ── What a launch is worth, read from its own pool ─────────────────────────

/**
 * v4 keeps every pool's state in the PoolManager's storage: `pools` is mapping slot 6 (v4-core's
 * `StateLibrary.POOLS_SLOT`), and the first word of a pool is its slot0 — sqrtPriceX96 in the low 160
 * bits, the tick above it. MEASURED 2026-10-02 on the first AAPLc launch: tick −400400, exactly the
 * negated quote tick the factory opens a token-is-currency0 pool at.
 */
export const POOLS_SLOT = 6n;
const EXTSLOAD = parseAbi(["function extsload(bytes32 slot) view returns (bytes32)"]);
const ETH_QUOTE = "0x0000000000000000000000000000000000000000";

export type PoolValue = {
  readonly quote: string;
  readonly quoteSymbol: string;
  /** read from the quote's contract — 8 for a stock token (hard rule 3), 18 for ETH */
  readonly quoteDecimals: number;
  /** the whole supply, in whole units of the quote, at the pool's current price */
  readonly supplyInQuote: number;
  /** USD per whole unit of the quote — `null` when it could not be read */
  readonly quoteUsd: number | null;
};

type Key = { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string };

/** A v4 pool's id: the hash of its whole key — a v3 key's dynamic-fee flag and hook included, as v4-core hashes it. */
export function poolIdOf(key: Key): `0x${string}` {
  return hash(
    encodeAbiParameters(parseAbiParameters("address, address, uint24, int24, address"), [
      key.currency0 as `0x${string}`,
      key.currency1 as `0x${string}`,
      key.fee,
      key.tickSpacing,
      key.hooks as `0x${string}`,
    ]),
  );
}

/** The storage slot of a v4 pool's slot0, from its key. */
export function slot0Of(key: Key): `0x${string}` {
  return hash(encodeAbiParameters(parseAbiParameters("bytes32, uint256"), [poolIdOf(key), POOLS_SLOT]));
}

/**
 * A coin's fee, READ: v1/v2 pools carry it in the key (1%); a v3 pool's key carries the dynamic-fee
 * flag, and the coin's chosen fee and its opening are the hook's — `schedules(poolId)`, `startFee`,
 * `window`. Fees in hundredths of a basis point; `openedAt` unix seconds.
 */
export type CoinFee = {
  readonly fee: number;
  readonly opening: { readonly startFee: number; readonly window: number; readonly openedAt: number } | null;
};

export async function coinFeeOf(factory: string, token: string): Promise<CoinFee> {
  const data = encodeFunctionData({ abi: LAUNCHPAD_ABI, functionName: "launches", args: [token as `0x${string}`] });
  const { key } = decodeFunctionResult({ abi: LAUNCHPAD_ABI, functionName: "launches", data: await ethCall(factory, data) });
  if (key.fee !== DYNAMIC_FEE_FLAG) return { fee: key.fee, opening: null };
  const id = poolIdOf(key);
  const at = (functionName: "startFee" | "window") => ethCall(key.hooks, encodeFunctionData({ abi: LAUNCH_HOOK_ABI, functionName }));
  const [schedule, start, span] = await Promise.all([
    ethCall(key.hooks, encodeFunctionData({ abi: LAUNCH_HOOK_ABI, functionName: "schedules", args: [id] })),
    at("startFee"),
    at("window"),
  ]);
  const [fee, openedAt] = decodeFunctionResult({ abi: LAUNCH_HOOK_ABI, functionName: "schedules", data: schedule });
  const startFee = decodeFunctionResult({ abi: LAUNCH_HOOK_ABI, functionName: "startFee", data: start });
  const window = decodeFunctionResult({ abi: LAUNCH_HOOK_ABI, functionName: "window", data: span });
  if (fee === 0) throw new Error(`the hook ${key.hooks} has no fee schedule for ${token}'s pool`);
  return { fee, opening: { startFee, window, openedAt } };
}

/**
 * A coin's v3 fee for a list or a report: `null` when there is no launch record or it is not a v3
 * coin (v1/v2 are all 1%, nothing to read), `undefined` when its hook could not be read — said as
 * "not checked", never as a fee (hard rule 12).
 */
export async function v3FeeOf(record: { readonly factory: string } | null | undefined, token: string): Promise<CoinFee | null | undefined> {
  if (!record || !isV3(record.factory)) return null;
  return coinFeeOf(record.factory, token).catch(() => undefined);
}

/** Whole quote units per whole token, from slot0's sqrtPriceX96 — the pool's price, not a quote. */
export function quotePerToken(sqrtPriceX96: bigint, tokenIs0: boolean, quoteDecimals: number, tokenDecimals = 18): number {
  const p = (Number(sqrtPriceX96) / 2 ** 96) ** 2; // raw currency1 per raw currency0
  const raw = tokenIs0 ? p : 1 / p;
  return raw * 10 ** (tokenDecimals - quoteDecimals);
}

/**
 * The whole supply's value on its own launchpad pool, in the quote and in USD. MEASURED 2026-10-02:
 * DexScreener did not list a fresh AAPLc-paired launch at all until its first trade (then priced it in
 * USD), and lists two TSLAc-paired pools with no USD price — so for a stock pair this is often the
 * only market cap there is. Read here: the pool's price from the chain, times the quote's USD price
 * (ETH from the deepest WETH market; a stock from its deepest market, priced in USDC).
 */
export async function poolValue(factory: string, token: string, usdOf: (quote: string) => Promise<number | null> = quoteUsd): Promise<PoolValue> {
  const data = encodeFunctionData({ abi: LAUNCHPAD_ABI, functionName: "launches", args: [token as `0x${string}`] });
  const { key } = decodeFunctionResult({ abi: LAUNCHPAD_ABI, functionName: "launches", data: await ethCall(factory, data) });
  const tokenIs0 = key.currency0.toLowerCase() === token.toLowerCase();
  const quote = tokenIs0 ? key.currency1 : key.currency0;
  const eth = quote.toLowerCase() === ETH_QUOTE;
  const word = await ethCall(UNISWAP_V4_POOL_MANAGER, encodeFunctionData({ abi: EXTSLOAD, functionName: "extsload", args: [slot0Of(key)] }));
  const sqrtPriceX96 = BigInt(word) & ((1n << 160n) - 1n);
  if (sqrtPriceX96 === 0n) throw new Error("its pool is not initialized");
  const read = async <T,>(functionName: "decimals" | "symbol"): Promise<T> =>
    decodeFunctionResult({ abi: erc20Abi, functionName, data: await ethCall(quote, encodeFunctionData({ abi: erc20Abi, functionName })) }) as T;
  const [decimals, symbol] = eth ? [18, "ETH"] : await Promise.all([read<number>("decimals"), read<string>("symbol")]);
  return {
    quote: toChecksumAddress(quote),
    quoteSymbol: symbol,
    quoteDecimals: decimals,
    supplyInQuote: quotePerToken(sqrtPriceX96, tokenIs0, decimals) * Number(LAUNCHPAD_EXPECTS.supply / 10n ** 18n),
    quoteUsd: await usdOf(quote),
  };
}

/** USD per whole unit of a launchpad quote: ETH from the deepest WETH market, a stock from its own deepest market. */
export async function quoteUsd(quote: string): Promise<number | null> {
  return quote.toLowerCase() === ETH_QUOTE ? ethUsd() : markets(quote).then((m) => deepest(m)?.priceUsd ?? null, () => null);
}

/** `quoteUsd`, asked once per quote — for a list of launches that share a handful of quotes. */
export function sharedQuoteUsd(): (quote: string) => Promise<number | null> {
  const seen = new Map<string, Promise<number | null>>();
  return (quote) => {
    const key = quote.toLowerCase();
    if (!seen.has(key)) seen.set(key, quoteUsd(quote));
    return seen.get(key)!;
  };
}
