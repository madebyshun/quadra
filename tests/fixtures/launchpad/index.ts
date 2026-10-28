/**
 * Real answers from this app's launchpad on Base (`0xcDb2…B8a5`), captured 2026-10-02, an hour
 * after the first real launch (token `0xB200…0dF9`, by the owner's wallet `0xD5C1…3FAB`).
 *
 *   F=0xcDb2eC1c487fbcB6B4AF25cCD86aFf8120FaB8a5
 *   curl -s "https://base.blockscout.com/api/v2/addresses/$F/logs"                 # blockscout-factory-logs (trimmed fields)
 *   eth_call $F launches(0xB200…0dF9)  on mainnet.base.org                         # rpc-launches-test
 *   eth_call $F launches(DEGEN)                                                     # rpc-launches-degen — all zero: not ours
 *   eth_call $F collect(0xB200…0dF9)  — run as a call, nothing paid                 # rpc-collect-test: 19,994,859,999 wei, 0 tokens
 *   eth_getLogs $F [Launched] from the deploy block 52,066,273                      # rpc-launched-logs
 *   eth_call PoolManager extsload(keccak(abi.encode(poolId, 6))) for 0xB200…0dF9's ETH pool,
 *     at block 52,070,604 (cast keccak / abi-encode, poolId from the launch record's key)       # rpc-slot0-test
 */
import blockscoutFactoryLogs from "./blockscout-factory-logs.json";
import launchesTest from "./rpc-launches-test.json";
import launchesDegen from "./rpc-launches-degen.json";
import collectTest from "./rpc-collect-test.json";
import launchedLogs from "./rpc-launched-logs.json";
import slot0Test from "./rpc-slot0-test.json";

export const LX = { blockscoutFactoryLogs, launchesTest, launchesDegen, collectTest, launchedLogs, slot0Test };
/** The storage slot `slot0Test` was read from — the pool of `LAUNCHPAD.test`. */
export const SLOT0_TEST_SLOT = "0x7f7017f8029f16279cc361e1672f0927f77f5a6bb3609f47a09b66b610b4bb8c";

export const LAUNCHPAD = {
  factory: "0xcDb2eC1c487fbcB6B4AF25cCD86aFf8120FaB8a5",
  /** v2 (ETH or stock pairs), deployed 2026-10-02 at block 52,068,913 — no launch on it when captured */
  factoryV2: "0xef1F427bB57e0ECd7BB8051cE8bC7AAb709a0c03",
  test: "0xB200000000000000000000660433Ed1bB04B0dF9",
  creator: "0xD5C1dFc036F9911348EA8065F73c8123f4013FAB",
  launchTx: "0x587621596330afe68b668d83f7a8625b99bb6a038ebb74747fe46a7b5a587fa9",
} as const;

/** `launches(address)`'s selector, computed with `cast sig "launches(address)"`. */
export const LAUNCHES_SELECTOR = "0x1f2d8550";

/**
 * An `eth_call` router for both factories: who launched what on v1, from the captures; v2 has the
 * records a test gives it (none by default — it had no launch when the captures were made); any
 * other token is not ours, answered with the captured all-zero record.
 */
export function factoryCalls(
  launches: Record<string, unknown> = {},
  v2: Record<string, unknown> = {},
): (method: string, params: readonly unknown[]) => unknown {
  return (method, params) => {
    if (method !== "eth_call") return undefined;
    const call = params[0] as { to: string; data: string; from?: string };
    const to = call.to.toLowerCase();
    const table = to === LAUNCHPAD.factory.toLowerCase() ? launches : to === LAUNCHPAD.factoryV2.toLowerCase() ? v2 : null;
    if (!table || call.from) return undefined;
    const token = `0x${call.data.slice(34, 74)}`.toLowerCase();
    if (call.data.startsWith(LAUNCHES_SELECTOR)) return table[token] ?? LX.launchesDegen;
    return undefined;
  };
}

/** Blockscout's log index for v2: empty, as it was when the captures were made. */
export const V2_LOGS_URL = (blockscout: string) => `${blockscout}/addresses/${LAUNCHPAD.factoryV2}/logs`;
export const NO_LOGS = { items: [], next_page_params: null };
