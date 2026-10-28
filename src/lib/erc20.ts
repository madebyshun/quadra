import { decodeFunctionResult, encodeFunctionData, erc20Abi } from "viem";
import { toChecksumAddress } from "@/lib/address";
import { ethCall, hexData, quantity, rpc } from "@/skills/http";

/**
 * What a money form needs to know about a token, read from the chain — never assumed.
 *
 * Hard rule 3 is why `decimals` is always read: an 8-decimal token treated as 18 is off by
 * 10^10, which reads as a price move rather than as a bug. And hard rule 2 is why an asset
 * is its ADDRESS on Base: the symbol shown next to it is whatever the contract says about
 * itself, which is exactly what an impersonator controls.
 */

export type Asset =
  | { readonly kind: "native"; readonly symbol: "ETH"; readonly decimals: 18 }
  | { readonly kind: "erc20"; readonly address: string; readonly symbol: string; readonly decimals: number };

export const ETH: Asset = { kind: "native", symbol: "ETH", decimals: 18 };

/**
 * ETH held back when "Max" is pressed on ETH, so the transaction can still pay its own gas:
 * 0.00005 ETH, generous for Base's L2 fee plus its L1 data fee on a swap-sized transaction.
 */
export const ETH_GAS_RESERVE = 5n * 10n ** 13n;

/** The token at `address`, as its own contract describes it. Throws when it is not an ERC-20. */
export async function readToken(address: string): Promise<Asset> {
  const call = (functionName: "decimals" | "symbol") =>
    ethCall(address, encodeFunctionData({ abi: erc20Abi, functionName }));
  let decimals: number;
  try {
    decimals = decodeFunctionResult({ abi: erc20Abi, functionName: "decimals", data: await call("decimals") });
  } catch {
    throw new Error(`${address} does not answer decimals() like a token on Base. Check the address.`);
  }
  let symbol: string;
  try {
    symbol = decodeFunctionResult({ abi: erc20Abi, functionName: "symbol", data: await call("symbol") });
  } catch {
    // a few old tokens return bytes32 here; the address is what identifies it anyway
    symbol = `${address.slice(0, 6)}…`;
  }
  return { kind: "erc20", address, symbol, decimals };
}

/** What `owner` holds of `asset`, in base units. */
export async function balanceOf(asset: Asset, owner: string): Promise<bigint> {
  if (asset.kind === "native") return quantity(await rpc("eth_getBalance", [owner, "latest"]), "the ETH balance");
  const data = await ethCall(asset.address, encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner as `0x${string}`] }));
  return decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", data });
}

/** How much of `token` `spender` may move for `owner`. */
export async function allowance(token: string, owner: string, spender: string): Promise<bigint> {
  const data = await ethCall(
    token,
    encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [owner as `0x${string}`, spender as `0x${string}`] }),
  );
  return decodeFunctionResult({ abi: erc20Abi, functionName: "allowance", data });
}

export function transferData(to: string, amount: bigint): `0x${string}` {
  return encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to as `0x${string}`, amount] });
}

/**
 * An approval for EXACTLY `amount`. Never "unlimited": a standing allowance is a standing
 * permission for the spender's contract to take the whole balance later, which is the thing
 * the revoke skill (T15) exists to clean up after other apps.
 */
export function approveData(spender: string, amount: bigint): `0x${string}` {
  return encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender as `0x${string}`, amount] });
}

/**
 * What kind of account an address is, from its code — three answers, not two.
 *
 * 🔴 "Has code" is NOT "is a contract" since EIP-7702. An ordinary wallet (EOA) can delegate to
 * a smart-account contract, and then its code is exactly `0xef0100 ‖ <delegate address>` — 23
 * bytes. MEASURED 2026-09-30 on the owner's own fee address `0xD5C1…3FAB`: code
 * `0xef0100 63c0c1…e32b`, the delegate being MetaMask's `EIP7702StatelessDeleGator` (verified on
 * Blockscout), on Base AND on Robinhood Chain. Such an account is still controlled by one private
 * key on every chain, so it must not be treated like a contract — the first version of Bridge
 * refused it as "a smart-contract wallet", which would have blocked every MetaMask user who
 * turned Smart Account on.
 */
export type AccountKind =
  | { readonly kind: "wallet" }
  | { readonly kind: "delegated"; readonly to: string }
  | { readonly kind: "contract" };

const DELEGATION = /^0xef0100([0-9a-fA-F]{40})$/;

export function kindOfCode(code: `0x${string}`): AccountKind {
  if (code === "0x") return { kind: "wallet" };
  const delegated = DELEGATION.exec(code);
  return delegated ? { kind: "delegated", to: toChecksumAddress(`0x${delegated[1]}`) } : { kind: "contract" };
}

export async function accountKind(address: string): Promise<AccountKind> {
  return kindOfCode(hexData(await rpc("eth_getCode", [address, "latest"]), "the account's code"));
}
