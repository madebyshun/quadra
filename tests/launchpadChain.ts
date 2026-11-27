import { vi } from "vitest";
import { encodeFunctionResult, parseAbi } from "viem";
import { BASE, UNISWAP_V4_POOL_MANAGER, WETH } from "@/config/chain";
import { BLOCKSCOUT } from "@/skills/blockscout";
import type { Eip1193Provider, Eip1193Request } from "@/lib/wallet";
import { factoryCalls, LAUNCHPAD, LX, NO_LOGS, SLOT0_TEST_SLOT, V2_LOGS_URL } from "./fixtures/launchpad";
import { MARKETS_FX } from "./fixtures/markets";
import { DOWN, simulated, type Answer } from "./net";

/**
 * The first real launch's chain and indexers, for the windows that read it (Coins, Profile): v1's
 * captured log page, its launch record and `collect`, its pool's captured slot0, the token's own
 * getters (MEASURED with cast), Blockscout with v2's empty index, and DexScreener's captured WETH
 * market for the ETH price. Every answer is a capture or a variant built from one, visibly.
 */

export const T = LAUNCHPAD.test;
export const ME = LAUNCHPAD.creator;
export const HASH = `0x${"ef".repeat(32)}`;
export const V1_LOGS = `${BLOCKSCOUT}/addresses/${LAUNCHPAD.factory}/logs`;
export const ETH_MARKET = `https://api.dexscreener.com/tokens/v1/base/${WETH.address}`;
/** One token's markets out of the captured Base page — a variant, built here. */
export const marketsOf = (symbol: string) => (MARKETS_FX.dexBase as { baseToken: { symbol: string } }[]).filter((p) => p.baseToken.symbol === symbol);

/** MEASURED from the test token with cast: "test", "test", 18, 1e27. */
const ERC20 = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)"]);
export const TOKEN_READS: Record<string, `0x${string}`> = {
  "0x06fdde03": encodeFunctionResult({ abi: ERC20, functionName: "name", result: "test" }),
  "0x95d89b41": encodeFunctionResult({ abi: ERC20, functionName: "symbol", result: "test" }),
  "0x313ce567": encodeFunctionResult({ abi: ERC20, functionName: "decimals", result: 18 }),
  "0x18160ddd": encodeFunctionResult({ abi: ERC20, functionName: "totalSupply", result: 10n ** 27n }),
};

/** The first launch's chain: the factory's record and `collect`, its pool, its own getters. */
export function chainRoutes(
  over: {
    pool?: Answer;
    launches?: Record<string, unknown>;
    /** anyone's balance of the coin, read on chain (default none) */
    holding?: bigint;
    /** the ETH balance asked about (default 0.001 ETH) */
    wei?: bigint;
    /** what `eth_getCode` answers (default: no code, a plain wallet) */
    code?: string;
    /** extra contracts — the Basenames registry and resolver, for one */
    calls?: (m: string, p: readonly unknown[]) => Answer | undefined;
  } = {},
) {
  const ours = over.launches ?? { [T.toLowerCase()]: LX.launchesTest };
  return (m: string, p: readonly unknown[]): Answer | undefined => {
    const call = p[0] as { to?: string; data?: string; from?: string } | undefined;
    if (simulated()(m, p) !== undefined) return simulated()(m, p);
    if (m === "eth_getTransactionReceipt") return { status: "0x1", blockNumber: "0x5", logs: [] };
    if (m === "eth_getBalance") return `0x${(over.wei ?? 10n ** 15n).toString(16)}`;
    if (m === "eth_getCode") return over.code ?? "0x";
    const extra = over.calls?.(m, p);
    if (extra !== undefined) return extra;
    if (m !== "eth_call" || !call?.to) return undefined;
    if (call.to.toLowerCase() === UNISWAP_V4_POOL_MANAGER.toLowerCase()) return over.pool ?? (call.data!.endsWith(SLOT0_TEST_SLOT.slice(2)) ? LX.slot0Test : undefined);
    if (call.to.toLowerCase() === T.toLowerCase() && call.data!.startsWith("0x70a08231")) {
      return encodeFunctionResult({ abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", result: over.holding ?? 0n });
    }
    if (call.to.toLowerCase() === T.toLowerCase()) return TOKEN_READS[call.data!];
    // `collect(address)` run as a call: the captured fees
    if (call.data!.startsWith("0x06ec16f8") && call.to.toLowerCase() === LAUNCHPAD.factory.toLowerCase()) return LX.collectTest;
    return factoryCalls(ours)(m, p) as Answer | undefined;
  };
}

/** Blockscout's index (v1 captured, v2 empty), DexScreener (the coin unlisted, WETH captured). */
/**
 * The SPA's answer to a route nobody mounted — what the dev server sends for the launchpad index when
 * it is not running (MEASURED, CLAUDE.md "A dev server's SPA fallback…"). A fresh Response each time.
 */
export const spa = () => new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } });

export function getRoutes(
  over: {
    v1?: Answer;
    coinMarkets?: Answer;
    /** this app's launchpad index (`/api/launchpad/…`) — by default not running here */
    index?: (u: string) => Answer | undefined;
    /** Blockscout's token record and holders for the coin — by default unreachable, never an invented body */
    blockscout?: (u: string) => Answer | undefined;
  } = {},
) {
  return (u: string): Answer | undefined =>
    u === V1_LOGS
      ? (over.v1 ?? LX.blockscoutFactoryLogs)
      : u === V2_LOGS_URL(BLOCKSCOUT)
        ? NO_LOGS
        : u === ETH_MARKET
          ? marketsOf("WETH")
          : // the coins' markets, one request for every listed coin — all the same coin in these captures
            u.toLowerCase().startsWith(`https://api.dexscreener.com/tokens/v1/base/${T.toLowerCase()}`)
            ? (over.coinMarkets ?? [])
            : u.startsWith("/api/launchpad/")
              ? (over.index?.(u) ?? spa())
              : u.startsWith("/api/charts/")
                ? spa()
                : u.startsWith(`${BLOCKSCOUT}/tokens/${T}`)
                  ? (over.blockscout?.(u) ?? DOWN)
                  : undefined;
}

export function wallet(account: string | null) {
  const sent: Record<string, string>[] = [];
  const provider: Eip1193Provider = {
    request(args: Eip1193Request) {
      if (args.method === "eth_accounts") return Promise.resolve(account ? [account] : []);
      if (args.method === "eth_chainId") return Promise.resolve(BASE.idHex);
      if (args.method === "eth_sendTransaction") {
        sent.push(args.params?.[0] as Record<string, string>);
        return Promise.resolve(HASH);
      }
      return Promise.reject(new Error(`unstubbed ${args.method}`));
    },
  };
  vi.stubGlobal("ethereum", provider);
  return sent;
}

