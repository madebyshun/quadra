import { decodeFunctionResult, encodeFunctionData, encodePacked, parseAbi } from "viem";
import { USDC, WETH } from "@/config/chain";
import { sameAddress } from "@/lib/address";
import { allowance, approveData } from "@/lib/erc20";
import type { TxRequest } from "@/lib/transact";
import { ethCall } from "@/skills/http";

/**
 * Single-transaction multi-asset basket execution on Base using canonical, audited DEX routers'
 * native `multicall(bytes[])` — no custom unaudited router contract required.
 *
 * - Aerodrome Slipstream SwapRouter (`0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5`) is Base's
 *   primary liquidity venue for Coinbase tokenized stocks and Base ecosystem tokens.
 * - Uniswap V3 SwapRouter02 (`0x2626664c2603336E57B271c5C0b26F421741e481`) acts as a secondary
 *   on-chain venue when a token has deeper or exclusive liquidity on Uniswap V3.
 *
 * All legs routed on the same canonical router pack into ONE `multicall(bytes[])` transaction,
 * so even standard EOA wallets (MetaMask, Rabby, etc.) buy a 10-stock basket in 1 swap tx
 * (plus 1 exact USDC approval only if current allowance is insufficient).
 */

export const AERO_SLIPSTREAM_QUOTER = "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0" as const;
export const AERO_SLIPSTREAM_ROUTER = "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5" as const;
export const UNISWAP_V3_QUOTER = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a" as const;
export const UNISWAP_V3_ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481" as const;

const AERO_QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, int24 tickSpacing, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);

const AERO_ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, int24 tickSpacing, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
  "function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) external payable returns (uint256 amountOut)",
  "function multicall(bytes[] data) external payable returns (bytes[] results)",
]);

const UNI_QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);

const UNI_ROUTER02_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
  "function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) external payable returns (uint256 amountOut)",
  "function multicall(bytes[] data) external payable returns (bytes[] results)",
]);

export type MulticallDex = "aerodrome" | "uniswapv3";

export type MulticallLegInput = {
  readonly address: string;
  readonly symbol: string;
  readonly amountUsdc: bigint;
};

export type MulticallQuote = {
  readonly dex: MulticallDex;
  readonly router: string;
  readonly tokenOut: string;
  readonly symbol: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly minOut: bigint;
  readonly calldata: `0x${string}`;
};

export type MulticallGroup = {
  readonly dex: MulticallDex;
  readonly router: string;
  readonly totalUsdc: bigint;
  readonly legs: readonly MulticallQuote[];
  readonly tx: TxRequest;
};

export type MulticallPlan = {
  readonly groups: readonly MulticallGroup[];
  readonly approvals: readonly { readonly router: string; readonly dex: MulticallDex; readonly amount: bigint; readonly tx: TxRequest }[];
  readonly totalUsdc: bigint;
  readonly legs: readonly MulticallQuote[];
};

async function tryAeroSingle(tokenOut: `0x${string}`, amountIn: bigint, tickSpacing: number): Promise<bigint | null> {
  try {
    const data = encodeFunctionData({
      abi: AERO_QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn: USDC.address, tokenOut, amountIn, tickSpacing, sqrtPriceLimitX96: 0n }],
    });
    const [amountOut] = decodeFunctionResult({ abi: AERO_QUOTER_ABI, functionName: "quoteExactInputSingle", data: await ethCall(AERO_SLIPSTREAM_QUOTER, data) });
    return amountOut > 0n ? amountOut : null;
  } catch {
    return null;
  }
}

async function tryAeroMulti(tokenOut: `0x${string}`, amountIn: bigint, ts1: number, ts2: number): Promise<{ readonly path: `0x${string}`; readonly amountOut: bigint } | null> {
  try {
    const path = encodePacked(["address", "int24", "address", "int24", "address"], [USDC.address, ts1, WETH.address, ts2, tokenOut]);
    const data = encodeFunctionData({ abi: AERO_QUOTER_ABI, functionName: "quoteExactInput", args: [path, amountIn] });
    const [amountOut] = decodeFunctionResult({ abi: AERO_QUOTER_ABI, functionName: "quoteExactInput", data: await ethCall(AERO_SLIPSTREAM_QUOTER, data) });
    return amountOut > 0n ? { path, amountOut } : null;
  } catch {
    return null;
  }
}

async function tryUniSingle(tokenOut: `0x${string}`, amountIn: bigint, fee: number): Promise<bigint | null> {
  try {
    const data = encodeFunctionData({
      abi: UNI_QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn: USDC.address, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
    });
    const [amountOut] = decodeFunctionResult({ abi: UNI_QUOTER_ABI, functionName: "quoteExactInputSingle", data: await ethCall(UNISWAP_V3_QUOTER, data) });
    return amountOut > 0n ? amountOut : null;
  } catch {
    return null;
  }
}

async function tryUniMulti(tokenOut: `0x${string}`, amountIn: bigint, f1: number, f2: number): Promise<{ readonly path: `0x${string}`; readonly amountOut: bigint } | null> {
  try {
    const path = encodePacked(["address", "uint24", "address", "uint24", "address"], [USDC.address, f1, WETH.address, f2, tokenOut]);
    const data = encodeFunctionData({ abi: UNI_QUOTER_ABI, functionName: "quoteExactInput", args: [path, amountIn] });
    const [amountOut] = decodeFunctionResult({ abi: UNI_QUOTER_ABI, functionName: "quoteExactInput", data: await ethCall(UNISWAP_V3_QUOTER, data) });
    return amountOut > 0n ? { path, amountOut } : null;
  } catch {
    return null;
  }
}

async function quoteOnAero(leg: MulticallLegInput, recipient: `0x${string}`, slippageBps: number, deadline: bigint): Promise<MulticallQuote | null> {
  const tokenOut = leg.address as `0x${string}`;
  const tickSpacings = [1, 10, 50, 100, 200, 2000];
  const hops: readonly [number, number][] = [[100, 100], [100, 50], [50, 100], [100, 200], [200, 100]];
  const [singles, multis] = await Promise.all([
    Promise.all(tickSpacings.map(async (ts) => ({ kind: "single" as const, ts, out: await tryAeroSingle(tokenOut, leg.amountUsdc, ts) }))),
    Promise.all(hops.map(async ([ts1, ts2]) => ({ kind: "multi" as const, res: await tryAeroMulti(tokenOut, leg.amountUsdc, ts1, ts2) }))),
  ]);
  const candidates: (
    | { readonly kind: "single"; readonly ts: number; readonly out: bigint }
    | { readonly kind: "multi"; readonly path: `0x${string}`; readonly out: bigint }
  )[] = [];
  for (const s of singles) if (s.out !== null) candidates.push({ kind: "single", ts: s.ts, out: s.out });
  for (const m of multis) if (m.res !== null) candidates.push({ kind: "multi", path: m.res.path, out: m.res.amountOut });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.out > a.out ? 1 : b.out < a.out ? -1 : 0));
  const best = candidates[0]!;
  const minOut = (best.out * BigInt(10_000 - slippageBps)) / 10_000n;
  const calldata = best.kind === "single"
    ? encodeFunctionData({
        abi: AERO_ROUTER_ABI,
        functionName: "exactInputSingle",
        args: [{ tokenIn: USDC.address, tokenOut, tickSpacing: best.ts, recipient, deadline, amountIn: leg.amountUsdc, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
      })
    : encodeFunctionData({
        abi: AERO_ROUTER_ABI,
        functionName: "exactInput",
        args: [{ path: best.path, recipient, deadline, amountIn: leg.amountUsdc, amountOutMinimum: minOut }],
      });
  return { dex: "aerodrome", router: AERO_SLIPSTREAM_ROUTER, tokenOut: leg.address, symbol: leg.symbol, amountIn: leg.amountUsdc, amountOut: best.out, minOut, calldata };
}

async function quoteOnUni(leg: MulticallLegInput, recipient: `0x${string}`, slippageBps: number): Promise<MulticallQuote | null> {
  const tokenOut = leg.address as `0x${string}`;
  const fees = [100, 500, 3000, 10000];
  const hops: readonly [number, number][] = [[500, 500], [500, 3000], [100, 500], [500, 100]];
  const [singles, multis] = await Promise.all([
    Promise.all(fees.map(async (fee) => ({ kind: "single" as const, fee, out: await tryUniSingle(tokenOut, leg.amountUsdc, fee) }))),
    Promise.all(hops.map(async ([f1, f2]) => ({ kind: "multi" as const, res: await tryUniMulti(tokenOut, leg.amountUsdc, f1, f2) }))),
  ]);
  const candidates: (
    | { readonly kind: "single"; readonly fee: number; readonly out: bigint }
    | { readonly kind: "multi"; readonly path: `0x${string}`; readonly out: bigint }
  )[] = [];
  for (const s of singles) if (s.out !== null) candidates.push({ kind: "single", fee: s.fee, out: s.out });
  for (const m of multis) if (m.res !== null) candidates.push({ kind: "multi", path: m.res.path, out: m.res.amountOut });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.out > a.out ? 1 : b.out < a.out ? -1 : 0));
  const best = candidates[0]!;
  const minOut = (best.out * BigInt(10_000 - slippageBps)) / 10_000n;
  const calldata = best.kind === "single"
    ? encodeFunctionData({
        abi: UNI_ROUTER02_ABI,
        functionName: "exactInputSingle",
        args: [{ tokenIn: USDC.address, tokenOut, fee: best.fee, recipient, amountIn: leg.amountUsdc, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
      })
    : encodeFunctionData({
        abi: UNI_ROUTER02_ABI,
        functionName: "exactInput",
        args: [{ path: best.path, recipient, amountIn: leg.amountUsdc, amountOutMinimum: minOut }],
      });
  return { dex: "uniswapv3", router: UNISWAP_V3_ROUTER, tokenOut: leg.address, symbol: leg.symbol, amountIn: leg.amountUsdc, amountOut: best.out, minOut, calldata };
}

/**
 * Build a 1-transaction multicall plan for all basket legs on Base.
 * Prefers Aerodrome Slipstream so all Coinbase tokenized stocks pack into ONE single `multicall(bytes[])` tx.
 * Throws if any leg has no on-chain route on Aerodrome Slipstream or Uniswap V3 (caller falls back to Relay).
 */
export async function buildBasketMulticallPlan(
  account: string,
  legs: readonly MulticallLegInput[],
  slippageBps = 150,
): Promise<MulticallPlan> {
  if (legs.length === 0) throw new Error("Nothing to buy in this basket.");
  const recipient = account as `0x${string}`;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);

  const quoted: MulticallQuote[] = [];
  for (const leg of legs) {
    if (sameAddress(leg.address, USDC.address)) throw new Error("Cannot swap USDC to USDC in basket.");
    // Prefer Aerodrome Slipstream so all stock legs pack into ONE multicall tx; fall back to Uniswap V3 if absent.
    const aero = await quoteOnAero(leg, recipient, slippageBps, deadline);
    if (aero !== null) {
      quoted.push(aero);
      continue;
    }
    const uni = await quoteOnUni(leg, recipient, slippageBps);
    if (uni !== null) {
      quoted.push(uni);
      continue;
    }
    throw new Error(`No direct Aerodrome or Uniswap V3 route found for ${leg.symbol}. Use the step-by-step Relay option.`);
  }

  const aeroLegs = quoted.filter((q) => q.dex === "aerodrome");
  const uniLegs = quoted.filter((q) => q.dex === "uniswapv3");

  const groups: MulticallGroup[] = [];
  if (aeroLegs.length > 0) {
    const total = aeroLegs.reduce((s, l) => s + l.amountIn, 0n);
    const data = aeroLegs.length > 1
      ? encodeFunctionData({ abi: AERO_ROUTER_ABI, functionName: "multicall", args: [aeroLegs.map((l) => l.calldata)] })
      : aeroLegs[0]!.calldata;
    groups.push({ dex: "aerodrome", router: AERO_SLIPSTREAM_ROUTER, totalUsdc: total, legs: aeroLegs, tx: { to: AERO_SLIPSTREAM_ROUTER, data, value: 0n } });
  }
  if (uniLegs.length > 0) {
    const total = uniLegs.reduce((s, l) => s + l.amountIn, 0n);
    const data = uniLegs.length > 1
      ? encodeFunctionData({ abi: UNI_ROUTER02_ABI, functionName: "multicall", args: [uniLegs.map((l) => l.calldata)] })
      : uniLegs[0]!.calldata;
    groups.push({ dex: "uniswapv3", router: UNISWAP_V3_ROUTER, totalUsdc: total, legs: uniLegs, tx: { to: UNISWAP_V3_ROUTER, data, value: 0n } });
  }

  const approvals: { readonly router: string; readonly dex: MulticallDex; readonly amount: bigint; readonly tx: TxRequest }[] = [];
  for (const g of groups) {
    const current = await allowance(USDC.address, account, g.router).catch(() => 0n);
    if (current < g.totalUsdc) {
      approvals.push({
        router: g.router,
        dex: g.dex,
        amount: g.totalUsdc,
        tx: { to: USDC.address, data: approveData(g.router, g.totalUsdc) },
      });
    }
  }

  return {
    groups,
    approvals,
    totalUsdc: quoted.reduce((s, l) => s + l.amountIn, 0n),
    legs: quoted,
  };
}
