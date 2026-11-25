import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import { toChecksumAddress } from "@/lib/address";
import { ethCall, rpc, RpcRefusal } from "@/skills/http";
import type { LaunchRecord } from "@/skills/launchpad";

/**
 * A coin whose creator share goes to a furnace (the furnace contract in contracts/src/, 2026-10-29):
 * `burnBps` of every arrival burnt — the coin side at once, the quote side set aside and bought back by
 * the treasury — the rest to the treasury. The app's own token has one, `0x5194…5102` (since 2026-11-25; the abandoned AAPLc-paired token's was `0x7838…a44c`). A recipient is a furnace for
 * THIS coin only when it says so itself: its `token()` and `launchpad()` (the shape check `shareOf`
 * uses for a RevenueShare), and it answers `burnBps()`, which a RevenueShare does not have.
 */

export const FURNACE_ABI = parseAbi([
  "function token() view returns (address)",
  "function launchpad() view returns (address)",
  "function treasury() view returns (address)",
  "function burnBps() view returns (uint256)",
  "function toBuy() view returns (uint256)",
  "function burnedFromFees() view returns (uint256)",
  "function burnedFromBuybacks() view returns (uint256)",
  "function quoteSpent() view returns (uint256)",
  "function harvest()",
  "function buyAndBurn(uint256 amountIn, uint256 minOut) returns (uint256 got)",
]);

type Getter = "token" | "launchpad" | "treasury" | "burnBps" | "toBuy" | "burnedFromFees" | "burnedFromBuybacks" | "quoteSpent";

async function get(at: string, name: Getter): Promise<unknown> {
  return decodeFunctionResult({ abi: FURNACE_ABI, functionName: name, data: await ethCall(at, encodeFunctionData({ abi: FURNACE_ABI, functionName: name })) });
}

export type Furnace = {
  readonly address: string;
  readonly treasury: string;
  readonly burnBps: number;
  /** quote set aside for buybacks, not yet spent */
  readonly toBuy: bigint;
  readonly burnedFromFees: bigint;
  readonly burnedFromBuybacks: bigint;
  readonly quoteSpent: bigint;
};

/** The coin's furnace, when its creator recipient is one — `null` for a wallet or any other contract. */
export async function furnaceOf(record: LaunchRecord, token: string): Promise<Furnace | null> {
  const code = (await rpc("eth_getCode", [record.creatorRecipient, "latest"])) as string;
  if (code === "0x" || code.toLowerCase().startsWith("0xef0100")) return null;
  const at = record.creatorRecipient;
  let shape: readonly [string, string, bigint];
  try {
    shape = [(await get(at, "token")) as string, (await get(at, "launchpad")) as string, (await get(at, "burnBps")) as bigint];
  } catch (e) {
    if (e instanceof RpcRefusal) return null;
    throw e;
  }
  if (shape[0].toLowerCase() !== token.toLowerCase() || shape[1].toLowerCase() !== record.factory.toLowerCase()) return null;
  const [treasury, toBuy, fees, buybacks, spent] = await Promise.all([
    get(at, "treasury"),
    get(at, "toBuy"),
    get(at, "burnedFromFees"),
    get(at, "burnedFromBuybacks"),
    get(at, "quoteSpent"),
  ]);
  return {
    address: at,
    treasury: toChecksumAddress(treasury as string),
    burnBps: Number(shape[2]),
    toBuy: toBuy as bigint,
    burnedFromFees: fees as bigint,
    burnedFromBuybacks: buybacks as bigint,
    quoteSpent: spent as bigint,
  };
}

export const harvestData = () => encodeFunctionData({ abi: FURNACE_ABI, functionName: "harvest" });
export const buyAndBurnData = (amountIn: bigint, minOut: bigint) => encodeFunctionData({ abi: FURNACE_ABI, functionName: "buyAndBurn", args: [amountIn, minOut] });
