import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import type { TokenInfo } from "@/skills/blockscout";
import { ethCall } from "@/skills/http";

/**
 * A token's name, symbol, decimals and supply read from the token itself — for when the indexer
 * has not caught up. MEASURED 2026-10-02: Blockscout answered a minutes-old B20 with `decimals`,
 * `name` and `symbol` all null (an older B20 had them), so a verdict titled itself with the bare
 * address. The chain always knows.
 */
const GETTERS = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);

async function read(token: string, functionName: (typeof GETTERS)[number]["name"]): Promise<unknown> {
  return decodeFunctionResult({ abi: GETTERS, functionName, data: await ethCall(token, encodeFunctionData({ abi: GETTERS, functionName })) });
}

export async function chainToken(address: string): Promise<TokenInfo> {
  const [name, symbol, decimals, totalSupply] = await Promise.all([read(address, "name"), read(address, "symbol"), read(address, "decimals"), read(address, "totalSupply")]);
  return { address, name: String(name), symbol: String(symbol), decimals: Number(decimals), totalSupply: totalSupply as bigint, holders: null, price: null, type: "ERC-20" };
}
