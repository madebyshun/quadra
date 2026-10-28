import { decodeAbiParameters, encodeAbiParameters, parseAbiParameters } from "viem";
import { applyLaunches, applySwaps, BLOCK_SECONDS, coinDetail, emptyState, type Clock } from "@/server/indexer";
import { COINS, IX } from "./fixtures/indexer";

/**
 * GET /api/launchpad/coin's answer for the first launch (0xB200…0dF9), built by the server's own
 * `coinDetail` from the REAL captures in tests/fixtures/indexer — never typed.
 */
const HEAD = { number: Number(IX.head.number), timestamp: Number(IX.head.timestamp) };
const clock: Clock = (block) => HEAD.timestamp - (HEAD.number - block) * BLOCK_SECONDS;
const ethSwap = IX.swapsV1.swaps[0]!.result[0]!;
export const AT = Number(ethSwap.blockTimestamp);
const SWAP_DATA = parseAbiParameters("int128, int128, uint160, uint128, int24, uint24");

/** The captures as the server holds them; with `sell`, the captured buy's deltas negated (a variant) and the buy again two hours later. */
export function served(withMore = false): unknown {
  const state = emptyState();
  applyLaunches(state, [...IX.launchedV1.result, ...IX.launchedV2.result], clock);
  const [a0, a1, ...rest] = decodeAbiParameters(SWAP_DATA, ethSwap.data as `0x${string}`);
  const sell = { ...ethSwap, logIndex: "0x18", data: encodeAbiParameters(SWAP_DATA, [-a0, -a1, ...rest] as never) };
  const later = { ...ethSwap, transactionHash: `${ethSwap.transactionHash.slice(0, -1)}0`, blockNumber: `0x${(52_066_748 + 3600).toString(16)}`, blockTimestamp: `0x${(AT + 7200).toString(16)}` };
  applySwaps(state, withMore ? [ethSwap, sell, later] : [ethSwap], clock);
  state.coins.get(IX.launchedV1.result[0]!.topics[3]!)!.detail = { quote: "0x0000000000000000000000000000000000000000", tokenIs0: false, name: "test", symbol: "TEST", quoteSymbol: "ETH", quoteDecimals: 18, fee: 10_000, opening: null, openSqrt: null };
  state.traders.set(ethSwap.transactionHash, COINS.owner);
  return JSON.parse(JSON.stringify({ ...coinDetail(state, COINS.eth, AT + 60)!, syncedTo: 1, head: 1, behind: 0, error: null }));
}
