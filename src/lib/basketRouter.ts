import { encodeFunctionData, parseAbi, parseSignature, type Hex } from "viem";
import { USDC } from "@/config/chain";
import { quoteSwap, type SwapQuote } from "@/adapters/http/relay";
import type { Asset } from "@/lib/erc20";
import { USDC_DOMAIN } from "@/lib/eip712";
import type { Eip1193Provider } from "@/lib/wallet";
import { ethCall } from "@/skills/http";

/**
 * Treasury Basket through `BasketRouter` (contracts/src/BasketRouter.sol): one transaction for any
 * wallet. Each leg is a Relay quote asked with the ROUTER as the sender and the BUYER as the recipient
 * — Relay delivers straight to the buyer, the router never holds what was bought — checked by the same
 * `checkSwap` as every swap here (pinned contracts, exact amount, a minimum). MEASURED 2026-11-25 on
 * mainnet state (scripts/simulate-basket-router.ts): NVDAc and AAPLc delivered to within a unit of
 * their quotes, 0 USDC left in the router.
 *
 * The USDC comes in one of two ways: an allowance the buyer already gave the router for at least the
 * total (one transaction), or one EIP-2612 `permit` signature for exactly the total, used inside that
 * same transaction (`buyWithPermit`) — a signature, then a transaction, and no standing approval.
 */

export const ROUTER_ABI = parseAbi([
  "struct Leg { address target; uint256 amountIn; address tokenOut; uint256 minOut; bytes data; }",
  "function buy(Leg[] legs, uint256 deadline) returns (uint256)",
  "function buyWithPermit(Leg[] legs, uint256 deadline, uint8 v, bytes32 r, bytes32 s) returns (uint256)",
]);
const NONCES_ABI = parseAbi(["function nonces(address owner) view returns (uint256)"]);

export type RouterLeg = { readonly target: Hex; readonly amountIn: bigint; readonly tokenOut: Hex; readonly minOut: bigint; readonly data: Hex };

/** How long a signed basket stays good: long enough to sign, short enough that the quotes still hold. */
export const ROUTER_DEADLINE_SECONDS = 300;

export const USDC_ASSET: Asset = { kind: "erc20", address: USDC.address, symbol: USDC.symbol, decimals: USDC.decimals };

/** One leg: a Relay quote for `amount` of USDC into `buy`, sent by the router and delivered to `buyer`. */
export async function routerLeg(router: string, buyer: string, buy: Asset, amount: bigint, slippageBps: number): Promise<{ readonly leg: RouterLeg; readonly quote: SwapQuote }> {
  if (buy.kind !== "erc20") throw new Error("A basket leg buys a token, not ETH.");
  const quote = await quoteSwap({ user: router, recipient: buyer, sell: USDC_ASSET, buy, amount, slippageBps });
  const swap = quote.steps[quote.steps.length - 1]!;
  return { leg: { target: swap.tx.to as Hex, amountIn: amount, tokenOut: buy.address as Hex, minOut: quote.min, data: swap.tx.data as Hex }, quote };
}

export const totalOf = (legs: readonly RouterLeg[]): bigint => legs.reduce((s, l) => s + l.amountIn, 0n);

export function deadlineFrom(nowMs: number): bigint {
  return BigInt(Math.floor(nowMs / 1000) + ROUTER_DEADLINE_SECONDS);
}

/** `buy(legs, deadline)` — for a buyer whose allowance to the router already covers the total. */
export function buyData(legs: readonly RouterLeg[], deadline: bigint): Hex {
  return encodeFunctionData({ abi: ROUTER_ABI, functionName: "buy", args: [legs, deadline] });
}

/** `buyWithPermit(legs, deadline, v, r, s)` — the permit signed for exactly the total, to the router. */
export function buyWithPermitData(legs: readonly RouterLeg[], deadline: bigint, signature: Hex): Hex {
  const { v, r, s, yParity } = parseSignature(signature);
  return encodeFunctionData({ abi: ROUTER_ABI, functionName: "buyWithPermit", args: [legs, deadline, Number(v ?? BigInt(yParity + 27)), r, s] });
}

/** USDC's EIP-2612 nonce for `owner`, read from the token. */
export async function permitNonce(owner: string): Promise<bigint> {
  return BigInt(await ethCall(USDC.address, encodeFunctionData({ abi: NONCES_ABI, functionName: "nonces", args: [owner as Hex] })));
}

/** The EIP-2612 Permit, in the shape `eth_signTypedData_v4` takes — USDC's own domain (lib/eip712.ts). */
export function permitTypedData(owner: string, spender: string, value: bigint, nonce: bigint, deadline: bigint) {
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    domain: USDC_DOMAIN,
    message: { owner, spender, value: value.toString(), nonce: nonce.toString(), deadline: deadline.toString() },
  } as const;
}

/** Ask the wallet for the permit. A refusal is said as one; anything else names the wallet's words. */
export async function signPermit(provider: Eip1193Provider, owner: string, spender: string, value: bigint, deadline: bigint): Promise<Hex> {
  const data = permitTypedData(owner, spender, value, await permitNonce(owner), deadline);
  let answer: unknown;
  try {
    answer = await provider.request({ method: "eth_signTypedData_v4", params: [owner, JSON.stringify(data)] });
  } catch (e) {
    const code = String((e as { code?: unknown } | null)?.code);
    throw new Error(code === "4001" ? "You declined the USDC signature. Nothing was sent." : `Your wallet did not sign the USDC permit (${e instanceof Error ? e.message : String(e)}). Nothing was sent.`);
  }
  if (typeof answer !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(answer)) throw new Error("Your wallet answered the USDC permit with something that is not a signature. Nothing was sent.");
  return answer as Hex;
}
