import { decodeFunctionResult, encodeFunctionData } from "viem";
import { CONTRACTS } from "@/config/chain";
import { OWED_V1_ABI, OWED_V2_ABI } from "@/config/owed";
import { ethCall } from "@/skills/http";

/** One payout waiting in a factory for its recipient. `currency` is the zero address for ETH. */
export type Owed = { readonly factory: string; readonly currency: string; readonly amount: bigint; readonly tx: { readonly to: string; readonly data: `0x${string}` } };

const ETH = "0x0000000000000000000000000000000000000000";

/**
 * What both factories owe `account`: v1 in ETH, v2 in ETH and each currency asked about (the quotes
 * of the coins this account launched there). Only non-zero amounts come back, each with the exact
 * `withdraw` call that pays it.
 */
export async function owedTo(account: string, v2Currencies: readonly string[]): Promise<Owed[]> {
  const out: Owed[] = [];
  const v1 = CONTRACTS.launchFactoryV1;
  const v2 = CONTRACTS.launchFactory;
  if (v1) {
    const data = encodeFunctionData({ abi: OWED_V1_ABI, functionName: "owedEth", args: [account as `0x${string}`] });
    const amount = decodeFunctionResult({ abi: OWED_V1_ABI, functionName: "owedEth", data: await ethCall(v1, data) });
    if (amount > 0n) out.push({ factory: v1, currency: ETH, amount, tx: { to: v1, data: encodeFunctionData({ abi: OWED_V1_ABI, functionName: "withdraw" }) } });
  }
  if (v2) {
    const currencies = [...new Set([ETH, ...v2Currencies.map((c) => c.toLowerCase())])];
    for (const currency of currencies) {
      const data = encodeFunctionData({ abi: OWED_V2_ABI, functionName: "owed", args: [account as `0x${string}`, currency as `0x${string}`] });
      const amount = decodeFunctionResult({ abi: OWED_V2_ABI, functionName: "owed", data: await ethCall(v2, data) });
      if (amount > 0n) {
        out.push({ factory: v2, currency, amount, tx: { to: v2, data: encodeFunctionData({ abi: OWED_V2_ABI, functionName: "withdraw", args: [currency as `0x${string}`] }) } });
      }
    }
  }
  return out;
}
