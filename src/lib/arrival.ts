import { decodeFunctionResult, encodeFunctionData, erc20Abi } from "viem";
import { NATIVE, ROBINHOOD } from "@/config/routes";
import { quantity, rpcOn } from "@/skills/http";

/**
 * Did the money arrive? Measured on the chain it went to, not taken from anybody's status.
 *
 * A bridge's "filled" flag and a swap's "success" are the service's word. The recipient's
 * balance, read from the destination chain's own RPC before and after, is the measurement —
 * the same distinction `lib/wallet.ts` draws between an event and a fresh read. The balance
 * can also move for unrelated reasons (another transfer landing at the same moment), which
 * is why the panels word the result as "your balance rose by", never "you received exactly".
 */

/** An address's balance of `token` (NATIVE for ETH) on Robinhood Chain, read from its RPC. */
export async function robinhoodBalance(token: string, owner: string): Promise<bigint> {
  const call = (method: string, params: readonly unknown[]) => rpcOn(ROBINHOOD.name, [ROBINHOOD.rpc], method, params);
  if (token === NATIVE) return quantity(await call("eth_getBalance", [owner, "latest"]), "the ETH balance");
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner as `0x${string}`] });
  const out = await call("eth_call", [{ to: token, data }, "latest"]);
  return decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", data: out as `0x${string}` });
}

export type ArrivalOptions = {
  readonly every?: number;
  readonly within?: number;
  readonly sleep?: (ms: number) => Promise<void>;
};

const nap = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll `read` until the balance has risen by at least `min` over `before`. Resolves with the
 * rise, or `null` when `within` ran out — which means NOT SEEN YET, never "lost".
 */
export async function waitForArrival(
  read: () => Promise<bigint>,
  before: bigint,
  min: bigint,
  options: ArrivalOptions = {},
): Promise<bigint | null> {
  const { every = 3_000, within = 120_000, sleep = nap } = options;
  for (let waited = 0; waited <= within; waited += every) {
    const rise = (await read()) - before;
    if (rise >= min) return rise;
    await sleep(every);
  }
  return null;
}
