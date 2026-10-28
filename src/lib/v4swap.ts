import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters } from "viem";
import { DYNAMIC_FEE_FLAG, LAUNCHPAD_ABI, LAUNCHPAD_EXPECTS, LAUNCHPAD_SPACING, LAUNCHPAD_V3_ABI } from "@/config/launchpad";
import { UNISWAP_V4 } from "@/config/uniswap";
import { toChecksumAddress } from "@/lib/address";
import { formatAmount } from "@/lib/amount";
import { allowance, approveData } from "@/lib/erc20";
import { ethCall, RpcRefusal } from "@/skills/http";
import { launchOf } from "@/skills/launchpad";

/**
 * A direct Uniswap v4 swap through one of this app's own launchpad pools — no aggregator in between.
 *
 * Why it exists: an aggregator may not route a minutes-old v4 pool. MEASURED 2026-10-02: the first
 * trade of this app's first AAPLc-paired launch had to go through KyberSwap. A launchpad pool is
 * known exactly — the factory records its key: fee 1% and NO hook (v1/v2) or the dynamic-fee flag and
 * the factory's own hook (v3, which only sets each swap's fee), tick spacing 200, the coin against
 * ETH (`address(0)`) or a Coinbase stock (8 decimals, hard rule 3) — so this module quotes it with
 * Uniswap's own Quoter and builds the Universal Router call itself. Nothing here signs (hard rule 5):
 * it returns UNSIGNED steps for the user's wallet, in order, and `lib/transact.ts` simulates each
 * before the wallet sees it (hard rule 17).
 *
 * The router call is ONE command, V4_SWAP, running three actions: SWAP_EXACT_IN_SINGLE (with the
 * minimum out), SETTLE_ALL (pay in at most `amountIn`) and TAKE_ALL (take out at least `minOut`).
 * 🔴 TAKE_ALL pays the router's `msgSender()` — the wallet that signs — and nobody else, so a swap
 * built here can only ever deliver to its own signer; there is no recipient field to get wrong.
 *
 * The command and action numbers are tested against the Solidity they come from: the action
 * constants against the installed `@uniswap/v4-periphery` (`contracts/lib/v4-periphery`), whose
 * `Actions.sol` is byte-identical to the one in the deployed router's verified source (MEASURED via
 * Sourcify 2026-10-14); V4_SWAP against that verified `Commands.sol`, kept in tests/fixtures/v4swap.
 *
 * Amounts are bigints in base units, never decimals (hard rule 7: `parseAmount` at the edge).
 */

export const NATIVE = "0x0000000000000000000000000000000000000000";

/** Universal Router `Commands.V4_SWAP`. */
export const V4_SWAP = 0x10;

/** v4-periphery `Actions` — the three a single-pool exact-input swap needs. */
export const ACTIONS = { SWAP_EXACT_IN_SINGLE: 0x06, SETTLE_ALL: 0x0c, TAKE_ALL: 0x0f } as const;

const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_UINT48 = 2 ** 48 - 1;

export type PoolKey = {
  readonly currency0: string;
  readonly currency1: string;
  readonly fee: number;
  readonly tickSpacing: number;
  readonly hooks: string;
};

/** A launchpad coin's pool, from its factory's own record. */
export type LaunchPool = {
  readonly factory: string;
  readonly key: PoolKey;
  readonly token: string;
  /** what it is paired with: `NATIVE` for ETH, else a stock token's address */
  readonly quote: string;
  readonly tokenIs0: boolean;
};

/**
 * The pool of a coin launched on this app's launchpad — or `null` when no factory launched it. The key
 * is the factory's record, then CHECKED: a key that is not a 1%, spacing-200, hookless pool holding
 * this token is refused, never traded through.
 */
export async function poolKeyOf(token: string): Promise<LaunchPool | null> {
  const record = await launchOf(token);
  if (record === null) return null;
  const data = encodeFunctionData({ abi: LAUNCHPAD_ABI, functionName: "launches", args: [token as `0x${string}`] });
  const { key } = decodeFunctionResult({ abi: LAUNCHPAD_ABI, functionName: "launches", data: await ethCall(record.factory, data) });
  const t = token.toLowerCase();
  const tokenIs0 = key.currency0.toLowerCase() === t;
  // v1/v2: a 1%, hookless pool. v3: the dynamic-fee flag, and the hook THIS factory deployed (read from it, never assumed)
  const hook = key.fee === DYNAMIC_FEE_FLAG ? await factoryHook(record.factory) : NATIVE;
  const feeOk = key.fee === LAUNCHPAD_EXPECTS.lpFee || key.fee === DYNAMIC_FEE_FLAG;
  if (!feeOk || key.tickSpacing !== LAUNCHPAD_SPACING || key.hooks.toLowerCase() !== hook.toLowerCase() || (!tokenIs0 && key.currency1.toLowerCase() !== t)) {
    throw new Error(
      `This build will not trade through ${token}'s pool: the launchpad recorded fee ${key.fee}, tick spacing ${key.tickSpacing}, hook ${key.hooks} for it, not a spacing-${LAUNCHPAD_SPACING} pool of this token that is 1% and hookless or dynamic-fee through the launchpad's own hook. Nothing was sent.`,
    );
  }
  const c0 = toChecksumAddress(key.currency0);
  const c1 = toChecksumAddress(key.currency1);
  return {
    factory: record.factory,
    key: { currency0: c0, currency1: c1, fee: key.fee, tickSpacing: key.tickSpacing, hooks: toChecksumAddress(hook) },
    token: tokenIs0 ? c0 : c1,
    quote: tokenIs0 ? c1 : c0,
    tokenIs0,
  };
}

/** A v3 factory's hook — the one every pool it opens uses. A v1/v2 factory has none and is never asked. */
async function factoryHook(factory: string): Promise<string> {
  const data = encodeFunctionData({ abi: LAUNCHPAD_V3_ABI, functionName: "hook" });
  return decodeFunctionResult({ abi: LAUNCHPAD_V3_ABI, functionName: "hook", data: await ethCall(factory, data) });
}

/** The swap direction for buying the coin (pay the quote) or selling it (receive the quote). */
export function zeroForOneFor(pool: LaunchPool, side: "buy" | "sell"): boolean {
  // currency0 → currency1 is "zero for one": buying pays the quote, so it is zeroForOne when the quote is currency0
  return side === "buy" ? !pool.tokenIs0 : pool.tokenIs0;
}

function uint128(value: bigint, what: string): bigint {
  if (value < 1n || value > MAX_UINT128) throw new Error(`${what} must be more than zero and fit in 128 bits; it was ${value}.`);
  return value;
}

const QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)",
]);

const keyArg = (key: PoolKey) => ({
  currency0: key.currency0 as `0x${string}`,
  currency1: key.currency1 as `0x${string}`,
  fee: key.fee,
  tickSpacing: key.tickSpacing,
  hooks: key.hooks as `0x${string}`,
});

export type V4Quote = { readonly amountOut: bigint; readonly gasEstimate: bigint };

/**
 * What `amountIn` buys from the pool right now, from Uniswap's Quoter run as an `eth_call`. Base's
 * Quoter RETURNS the figures (it catches its own internal revert — MEASURED); a swap it cannot fill
 * reverts, and that refusal is said in words, never read as an amount of zero.
 */
export async function quoteV4(key: PoolKey, zeroForOne: boolean, amountIn: bigint): Promise<V4Quote> {
  const { to, data } = quoteCall(key, zeroForOne, amountIn);
  let answer: `0x${string}`;
  try {
    answer = await ethCall(to, data);
  } catch (err) {
    if (!(err instanceof RpcRefusal)) throw err;
    // MEASURED: the revert's data says NotEnoughLiquidity or PoolNotInitialized, but the RPC client keeps only the message
    throw new Error(`Uniswap's quoter could not fill this swap from the pool (the chain said: ${err.said}). Usually the pool does not yet hold enough of the other side — try a smaller amount.`);
  }
  return quoteFrom(answer);
}

/** The Quoter call `quoteV4` makes — exported so a simulation can run the very same call inside a block. */
export function quoteCall(key: PoolKey, zeroForOne: boolean, amountIn: bigint): { readonly to: string; readonly data: `0x${string}` } {
  return {
    to: UNISWAP_V4.quoter,
    data: encodeFunctionData({
      abi: QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [{ poolKey: keyArg(key), zeroForOne, exactAmount: uint128(amountIn, "The amount in"), hookData: "0x" }],
    }),
  };
}

/** The Quoter's answer, read. */
export function quoteFrom(answer: `0x${string}`): V4Quote {
  const [amountOut, gasEstimate] = decodeFunctionResult({ abi: QUOTER_ABI, functionName: "quoteExactInputSingle", data: answer });
  return { amountOut, gasEstimate };
}

/** The least a swap may deliver: `quote` less `slippageBps` hundredths of a percent, truncated. */
export function minOutFor(quote: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) {
    throw new Error(`Slippage must be a whole number of basis points from 0 to 9999; it was ${slippageBps}.`);
  }
  if (quote < 0n) throw new Error("A quote cannot be negative.");
  return (quote * BigInt(10_000 - slippageBps)) / 10_000n;
}

export type SwapParams = {
  readonly key: PoolKey;
  readonly zeroForOne: boolean;
  /** exact, in the input currency's base units */
  readonly amountIn: bigint;
  /** the least to receive, in the output currency's base units — never zero */
  readonly minOut: bigint;
  /** unix seconds; the router refuses the swap after it, and a Permit2 allowance expires with it */
  readonly deadline: number;
};

export type SwapTx = { readonly to: string; readonly data: `0x${string}`; readonly value: bigint };

const ROUTER_ABI = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
const PERMIT2_ABI = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
]);
const EXACT_IN_SINGLE = parseAbiParameters(
  "((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)",
);
const CURRENCY_AMOUNT = parseAbiParameters("address, uint256");

function checkDeadline(deadline: number): number {
  if (!Number.isInteger(deadline) || deadline <= 0 || deadline > MAX_UINT48) throw new Error(`The deadline must be a time in unix seconds; it was ${deadline}.`);
  return deadline;
}

const sides = (p: SwapParams) => (p.zeroForOne ? [p.key.currency0, p.key.currency1] : [p.key.currency1, p.key.currency0]) as [string, string];

/** The Universal Router transaction for one exact-input swap through `key`. ETH in rides as its value. */
export function buildSwap(p: SwapParams): SwapTx {
  const amountIn = uint128(p.amountIn, "The amount in");
  const minOut = uint128(p.minOut, "The minimum out");
  const deadline = checkDeadline(p.deadline);
  const [currencyIn, currencyOut] = sides(p);
  const actions = `0x${[ACTIONS.SWAP_EXACT_IN_SINGLE, ACTIONS.SETTLE_ALL, ACTIONS.TAKE_ALL].map((a) => a.toString(16).padStart(2, "0")).join("")}` as const;
  const params = [
    encodeAbiParameters(EXACT_IN_SINGLE, [{ poolKey: keyArg(p.key), zeroForOne: p.zeroForOne, amountIn, amountOutMinimum: minOut, hookData: "0x" }]),
    encodeAbiParameters(CURRENCY_AMOUNT, [currencyIn as `0x${string}`, amountIn]),
    encodeAbiParameters(CURRENCY_AMOUNT, [currencyOut as `0x${string}`, minOut]),
  ];
  const input = encodeAbiParameters(parseAbiParameters("bytes, bytes[]"), [actions, params]);
  const commands = `0x${V4_SWAP.toString(16).padStart(2, "0")}` as const;
  return {
    to: UNISWAP_V4.universalRouter,
    data: encodeFunctionData({ abi: ROUTER_ABI, functionName: "execute", args: [commands, [input], BigInt(deadline)] }),
    value: currencyIn.toLowerCase() === NATIVE ? amountIn : 0n,
  };
}

/** Permit2's `approve`: let `spender` pull exactly `amount` of `token` until `expiration`. */
export function permit2ApproveData(token: string, spender: string, amount: bigint, expiration: number): `0x${string}` {
  return encodeFunctionData({ abi: PERMIT2_ABI, functionName: "approve", args: [token as `0x${string}`, spender as `0x${string}`, amount, checkDeadline(expiration)] });
}

/** What Permit2 lets `spender` pull of `owner`'s `token`, and until when. */
export async function permit2Allowance(owner: string, token: string, spender: string): Promise<{ readonly amount: bigint; readonly expiration: number }> {
  const data = encodeFunctionData({ abi: PERMIT2_ABI, functionName: "allowance", args: [owner as `0x${string}`, token as `0x${string}`, spender as `0x${string}`] });
  const [amount, expiration] = decodeFunctionResult({ abi: PERMIT2_ABI, functionName: "allowance", data: await ethCall(UNISWAP_V4.permit2, data) });
  return { amount, expiration };
}

export type SwapStep = SwapTx & { readonly what: string };

/**
 * Every signature the swap needs from `from`, in order. ETH in: the swap alone. A token in (selling a
 * coin, buying with a stock): an EXACT approval to Permit2 if its allowance is short, then a Permit2
 * approval of EXACTLY `amountIn` to the router, expiring at the deadline, if Permit2's is short or
 * runs out sooner — then the swap. Never an unlimited approval (CLAUDE.md).
 * `asset` names the input currency in the steps' words; without it amounts are in base units.
 */
export async function swapSteps(p: SwapParams & { readonly from: string; readonly asset?: { readonly symbol: string; readonly decimals: number } }): Promise<SwapStep[]> {
  const swap = buildSwap(p);
  const [currencyIn] = sides(p);
  const out: SwapStep[] = [];
  if (currencyIn.toLowerCase() !== NATIVE) {
    const amount = p.asset ? `${formatAmount(p.amountIn, p.asset.decimals)} ${p.asset.symbol}` : `${p.amountIn} base units of ${currencyIn}`;
    const [erc20, viaPermit2] = await Promise.all([
      allowance(currencyIn, p.from, UNISWAP_V4.permit2),
      permit2Allowance(p.from, currencyIn, UNISWAP_V4.universalRouter),
    ]);
    if (erc20 < p.amountIn) {
      out.push({ to: currencyIn, data: approveData(UNISWAP_V4.permit2, p.amountIn), value: 0n, what: `approve exactly ${amount} for Permit2` });
    }
    if (viaPermit2.amount < p.amountIn || viaPermit2.expiration < p.deadline) {
      out.push({
        to: UNISWAP_V4.permit2,
        data: permit2ApproveData(currencyIn, UNISWAP_V4.universalRouter, p.amountIn, p.deadline),
        value: 0n,
        what: `let Uniswap's router take exactly ${amount} through Permit2, until the swap's deadline`,
      });
    }
  }
  out.push({ ...swap, what: "swap through the launchpad pool on Uniswap v4" });
  return out;
}
