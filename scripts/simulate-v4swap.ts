/**
 * The direct v4 swap engine (`src/lib/v4swap.ts`) against REAL Base mainnet state, without sending
 * anything. Hand-run:
 *
 *   npx vite-node scripts/simulate-v4swap.ts
 *
 * Each scenario is ONE `eth_simulateV1` block from a keyless address (`SIM_ACCOUNT`, given 10 ETH by
 * state override), on the real PoolManager, Universal Router, Permit2 and Quoter, with every step
 * built by `swapSteps` exactly as the app would hand them to the wallet. The Quoter is ALSO called
 * inside the block, immediately before each swap, so its figure and the swap's delivery are measured
 * on the same state; `traceTransfers` turns every token and ETH movement into a log (native ETH as a
 * Transfer from 0xEeee…EEeE — MEASURED, see src/skills/simulate.ts).
 *
 *   1. ETH pool (v1 launch 0xB200…0dF9): buy with 0.001 ETH, then sell ALL of it back through Permit2.
 *   2. AAPLc pool (v2 launch 0xb200…E124): buy AAPLc with ETH through Relay (real route, same block),
 *      then buy the coin with that AAPLc through Permit2 — 8-decimal input (hard rule 3).
 */
import { decodeFunctionResult, encodeFunctionData, erc20Abi, parseAbi } from "viem";
import { RELAY } from "../src/config/routes";
import { UNISWAP_V4 } from "../src/config/uniswap";
import { rpc } from "../src/skills/http";
import { SIM_ACCOUNT as SIM, stepsOf } from "../src/skills/simulate";
import { minOutFor, poolKeyOf, quoteV4, swapSteps, zeroForOneFor, type LaunchPool, type SwapStep } from "../src/lib/v4swap";

const ETH_COIN = "0xB200000000000000000000660433Ed1bB04B0dF9";
const STOCK_COIN = "0xb20000000000000000000036f9a2788834bCE124";
const NATIVE_LOG = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const SLIPPAGE_BPS = 100;
const QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)",
]);

type Call = { from: string; to: string; data: string; value: string; gas: string };
type Result = { status: string; gasUsed: string; returnData: string; logs?: { address: string; topics: string[]; data: string }[]; error?: { message: string } };

const call = (to: string, data: string, value = 0n): Call => ({ from: SIM, to, data, value: `0x${value.toString(16)}`, gas: "0x1c9c380" });
const quoteCall = (pool: LaunchPool, zeroForOne: boolean, amount: bigint) =>
  call(UNISWAP_V4.quoter, encodeFunctionData({ abi: QUOTER_ABI, functionName: "quoteExactInputSingle", args: [{ poolKey: pool.key as never, zeroForOne, exactAmount: amount, hookData: "0x" }] }));
const balanceCall = (token: string) => call(token, encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [SIM] }));
const stepCalls = (steps: SwapStep[]) => steps.map((s) => call(s.to, s.data, s.value));

async function simulate(calls: Call[]): Promise<Result[]> {
  const out = (await rpc("eth_simulateV1", [{ blockStateCalls: [{ stateOverrides: { [SIM]: { balance: `0x${(10n ** 19n).toString(16)}` } }, calls }], traceTransfers: true, validation: false }, "latest"])) as { calls: Result[] }[];
  return out[0]!.calls;
}

/** What reached SIM in one call: a token's Transfer logs, or native ETH's. */
function received(r: Result, token: string): bigint {
  const from = token.toLowerCase() === "0x0000000000000000000000000000000000000000" ? NATIVE_LOG : token.toLowerCase();
  return (r.logs ?? [])
    .filter((l) => l.address.toLowerCase() === from && l.topics[0] === TRANSFER && l.topics[2]?.slice(-40).toLowerCase() === SIM.slice(2).toLowerCase())
    .reduce((sum, l) => sum + BigInt(l.data), 0n);
}

function check(name: string, r: Result): void {
  if (r.status !== "0x1") throw new Error(`${name} failed in the simulation: ${r.error?.message ?? "no reason"}`);
}
const quoted = (r: Result) => decodeFunctionResult({ abi: QUOTER_ABI, functionName: "quoteExactInputSingle", data: r.returnData as `0x${string}` })[0];
const report = (what: string, inAmount: string, quote: bigint, got: bigint, minOut: bigint) =>
  console.log(`${what}\n  in ${inAmount} · quoter ${quote} · delivered ${got} · difference ${got - quote} · minOut ${minOut} (${SLIPPAGE_BPS} bps)`);

const deadline = Math.floor(Date.now() / 1000) + 600;

// ── 1. the ETH pool: buy, then sell it all back ──────────────────────────────
const ethPool = (await poolKeyOf(ETH_COIN))!;
console.log(`ETH pool: ${JSON.stringify(ethPool.key)} (factory ${ethPool.factory})`);
const buyIn = 10n ** 15n;
const buyDir = zeroForOneFor(ethPool, "buy");
const before = await quoteV4(ethPool.key, buyDir, buyIn);
const buyMin = minOutFor(before.amountOut, SLIPPAGE_BPS);
const buy = await swapSteps({ key: ethPool.key, zeroForOne: buyDir, amountIn: buyIn, minOut: buyMin, deadline, from: SIM });
console.log(`buy: ${buy.length} step(s) — ${buy.map((s) => s.what).join(" → ")}; quoteV4 (latest) ${before.amountOut}`);

// a first block learns how much the buy delivers, so the sell can be built for exactly that
const first = await simulate([...stepCalls(buy), balanceCall(ETH_COIN)]);
first.forEach((r, i) => check(`buy call ${i}`, r));
const bought = BigInt(first.at(-1)!.returnData);
const sellDir = zeroForOneFor(ethPool, "sell");
const sell = await swapSteps({ key: ethPool.key, zeroForOne: sellDir, amountIn: bought, minOut: 1n, deadline, from: SIM, asset: { symbol: "coin", decimals: 18 } });
console.log(`sell: ${sell.length} step(s) — ${sell.map((s) => s.what).join(" → ")}`);

// the whole round trip in one block, the quoter asked right before each swap
const sellSwap = sell.at(-1)!;
const block = await simulate([quoteCall(ethPool, buyDir, buyIn), ...stepCalls(buy), ...stepCalls(sell.slice(0, -1)), quoteCall(ethPool, sellDir, bought), call(sellSwap.to, sellSwap.data, sellSwap.value), balanceCall(ETH_COIN)]);
block.forEach((r, i) => check(`round-trip call ${i}`, r));
const buyResult = block[1]!;
const sellQuote = quoted(block[block.length - 3]!);
const sellResult = block[block.length - 2]!;
report("BUY  0.001 ETH → coin", `${buyIn} wei`, quoted(block[0]!), received(buyResult, ETH_COIN), buyMin);
report("SELL coin → ETH (all of it, via Permit2)", `${bought} coin wei`, sellQuote, received(sellResult, "0x0000000000000000000000000000000000000000"), minOutFor(sellQuote, SLIPPAGE_BPS));
console.log(`  coin left after the sell: ${BigInt(block.at(-1)!.returnData)} · gas: buy ${BigInt(buyResult.gasUsed)}, sell ${BigInt(sellResult.gasUsed)}`);

// ── 2. the AAPLc pool: buy the coin WITH AAPLc ──────────────────────────────
const stockPool = (await poolKeyOf(STOCK_COIN))!;
console.log(`\nAAPLc pool: ${JSON.stringify(stockPool.key)} (factory ${stockPool.factory})`);
const relay = await (
  await fetch(`${RELAY.api}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: SIM, recipient: SIM, originChainId: 8453, destinationChainId: 8453, originCurrency: "0x0000000000000000000000000000000000000000", destinationCurrency: stockPool.quote, amount: (2n * 10n ** 15n).toString(), tradeType: "EXACT_INPUT" }),
  })
).json();
const shares = (BigInt(relay.details.currencyOut.amount) * 90n) / 100n; // 8 decimals (hard rule 3)
const stockDir = zeroForOneFor(stockPool, "buy");
const stockLatest = await quoteV4(stockPool.key, stockDir, shares);
const stockMin = minOutFor(stockLatest.amountOut, SLIPPAGE_BPS);
const stockBuy = await swapSteps({ key: stockPool.key, zeroForOne: stockDir, amountIn: shares, minOut: stockMin, deadline, from: SIM, asset: { symbol: "AAPLc", decimals: 8 } });
console.log(`buy with AAPLc: ${stockBuy.length} step(s) — ${stockBuy.map((s) => s.what).join(" → ")}; quoteV4 (latest) ${stockLatest.amountOut}`);
const relaySteps = stepsOf(relay).map((s) => call(s.to, s.data, s.value));
const stockSwap = stockBuy.at(-1)!;
const stockBlock = await simulate([...relaySteps, ...stepCalls(stockBuy.slice(0, -1)), quoteCall(stockPool, stockDir, shares), call(stockSwap.to, stockSwap.data, stockSwap.value), balanceCall(stockPool.quote)]);
stockBlock.forEach((r, i) => check(`AAPLc call ${i}`, r));
const stockResult = stockBlock[stockBlock.length - 2]!;
report(`BUY  ${Number(shares) / 1e8} AAPLc → coin`, `${shares} AAPLc units`, quoted(stockBlock[stockBlock.length - 3]!), received(stockResult, STOCK_COIN), stockMin);
console.log(`  AAPLc left: ${BigInt(stockBlock.at(-1)!.returnData)} · gas ${BigInt(stockResult.gasUsed)}`);
