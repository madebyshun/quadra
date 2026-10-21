/**
 * Real answers behind a Launch Radar, captured 2026-10-01 at block 0x319b15c and trimmed.
 *
 * Recorded by running the radar over 20 minutes (600 blocks) against the live services with
 * `fetch` wrapped to keep every response — so the requests are exactly the ones the radar makes:
 *
 *   eth_blockNumber, then eth_getLogs on base.publicnode.com:
 *     {"address":"0x498581fF718922c3f8e6A244956aF099B2652b2b",
 *      "topics":["<keccak of Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)>"],
 *      "fromBlock":"0x319af04","toBlock":"0x319b15c"}                   → rpc-initialize-logs (61 logs)
 *   curl -s "https://api.dexscreener.com/tokens/v1/base/<up to 30 tokens, comma-joined>"   → dexscreener-batch-*
 *   curl -s "https://base.blockscout.com/api/v2/addresses/<hook>"                          → blockscout-hooks
 *
 * Trimmed: logs to address/blockNumber/topics/data/transactionHash; DexScreener pairs to the
 * fields parsed; Blockscout's hook records to hash/name/is_verified/is_contract. The 43 new tokens
 * went out in two requests (30 + 13); batch-1 is the 13, which the recorder saw finish first.
 *
 * Worth knowing: every hook the radar named in this window was verified — ZoraV4CoinHook,
 * TaxLaunchHook, ClankerHookStaticFeeV2, LaunchHook, DopplerHookInitializer — so the unverified
 * case is built from these in the test. And one token's symbol came back as " SOON", leading space.
 */
import blockNumber from "./rpc-block-number.json";
import initializeLogs from "./rpc-initialize-logs.json";
import dexscreenerBatch1 from "./dexscreener-batch-1.json";
import dexscreenerBatch2 from "./dexscreener-batch-2.json";
import blockscoutHooks from "./blockscout-hooks.json";

export const RX = { blockNumber, initializeLogs, dexscreenerBatch1, dexscreenerBatch2, blockscoutHooks };

/**
 * A quiet radar: the captured latest block and no new pools in the window. The cheapest skill to
 * run for real — two RPC calls and nothing else — for tests about the surfaces a skill reaches
 * (the Terminal, the API, MCP) rather than about the radar itself.
 */
export function quietRadar(method: string): unknown {
  return method === "eth_blockNumber" ? blockNumber : method === "eth_getLogs" ? [] : undefined;
}
