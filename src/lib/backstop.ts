import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import { ethCall, rpc } from "@/skills/http";

/**
 * Stage C's Backstop (contracts/src/Backstop.sol, docs/BACKSTOP.md; live since 2026-11-26 at
 * `CONTRACTS.backstop`): ETH kept as one bid just under the coin's price in its own pool, filled by sellers,
 * every coin it buys burnt at the next poke. Read straight from the contract; nothing here signs.
 */
export const BACKSTOP_ABI = parseAbi([
  "function liquidity() view returns (uint128)",
  "function burned() view returns (uint256)",
  "function lastPoke() view returns (uint256)",
]);

type Getter = "liquidity" | "burned" | "lastPoke";

async function get(at: string, name: Getter): Promise<bigint> {
  return decodeFunctionResult({ abi: BACKSTOP_ABI, functionName: name, data: await ethCall(at, encodeFunctionData({ abi: BACKSTOP_ABI, functionName: name })) }) as bigint;
}

export type Backstop = {
  readonly address: string;
  /** whether a bid sits in the pool now */
  readonly placed: boolean;
  /** ETH the contract holds outside the bid (waiting for the next poke) */
  readonly waiting: bigint;
  /** coins it has bought and burnt, ever */
  readonly burned: bigint;
  /** unix seconds of the last poke; 0 = never */
  readonly lastPoke: number;
};

export async function readBackstop(at: string): Promise<Backstop> {
  const [liquidity, burned, lastPoke, balance] = await Promise.all([get(at, "liquidity"), get(at, "burned"), get(at, "lastPoke"), rpc("eth_getBalance", [at, "latest"])]);
  return { address: at, placed: liquidity > 0n, waiting: BigInt(balance as string), burned, lastPoke: Number(lastPoke) };
}
