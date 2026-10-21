/**
 * Real answers from Base mainnet for the direct v4 swap engine (`src/lib/v4swap.ts`), captured
 * 2026-10-14 at block 52,578,691 on mainnet.base.org. Each `<name>.json` is the WHOLE JSON-RPC
 * response body to the `eth_call` recorded under the same name in `requests.json` (its `to` and
 * `data`, sent with block 0x3224983). Reproduce one with:
 *
 *   curl -s https://mainnet.base.org -H 'content-type: application/json' \
 *     -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"<to>","data":"<data>"},"0x3224983"]}'
 *
 * The calls (the data was encoded with viem from the ABIs in src/lib/v4swap.ts and config/launchpad.ts):
 *   launches-v1-ethcoin / -v2-ethcoin — `launches(0xB200…0dF9)` on v1 (its record) and v2 (all zero)
 *   launches-v2-stockcoin            — `launches(0xb200…E124)` on v2: the AAPLc-paired launch
 *   quote-eth-buy-0.001              — Quoter.quoteExactInputSingle, ETH pool, zeroForOne, 1e15 wei
 *   quote-eth-sell-100               — the same pool, oneForZero, 100 coins
 *   quote-eth-sell-100k-too-much     — 100,000 coins: REVERTS, UnexpectedRevertBytes(NotEnoughLiquidity(poolId))
 *                                      — the pool holds almost no ETH yet
 *   quote-aapl-buy-0.001             — AAPLc pool (coin is currency0), oneForZero, 100,000 = 0.001 AAPLc
 *   quote-no-pool                    — the ETH pool's currencies at fee 3000 / spacing 60: REVERTS,
 *                                      UnexpectedRevertBytes(PoolNotInitialized())
 *   quoter-poolManager               — Quoter.poolManager(): Uniswap's PoolManager
 *   permit2-allowance-treasury-aapl  — Permit2.allowance(0xD5C1…3FAB, AAPLc, UniversalRouter): none
 *   erc20-allowance-treasury-aapl-permit2 — AAPLc.allowance(0xD5C1…3FAB, Permit2): none
 *
 * `Commands.sol` is the Universal Router's own `Commands` library, from its verified source:
 *   curl -s "https://sourcify.dev/server/v2/contract/8453/0x6ff5693b99212da76ad316178a184ab56d299b43?fields=sources" \
 *     | jq -r '.sources["src/pkgs/universal-router/contracts/libraries/Commands.sol"].content'
 */
import requests from "./requests.json";
import launchesV1EthCoin from "./launches-v1-ethcoin.json";
import launchesV2EthCoin from "./launches-v2-ethcoin.json";
import launchesV2StockCoin from "./launches-v2-stockcoin.json";
import quoteEthBuy from "./quote-eth-buy-0.001.json";
import quoteEthSell from "./quote-eth-sell-100.json";
import quoteEthSellTooMuch from "./quote-eth-sell-100k-too-much.json";
import quoteAaplBuy from "./quote-aapl-buy-0.001.json";
import quoteNoPool from "./quote-no-pool.json";
import quoterPoolManager from "./quoter-poolManager.json";
import permit2AllowanceNone from "./permit2-allowance-treasury-aapl.json";
import erc20AllowanceNone from "./erc20-allowance-treasury-aapl-permit2.json";

export type RpcBody = { result?: string; error?: { code: number; message: string; data?: string } };

export const V4 = {
  "launches-v1-ethcoin": launchesV1EthCoin,
  "launches-v2-ethcoin": launchesV2EthCoin,
  "launches-v2-stockcoin": launchesV2StockCoin,
  "quote-eth-buy-0.001": quoteEthBuy,
  "quote-eth-sell-100": quoteEthSell,
  "quote-eth-sell-100k-too-much": quoteEthSellTooMuch,
  "quote-aapl-buy-0.001": quoteAaplBuy,
  "quote-no-pool": quoteNoPool,
  "quoter-poolManager": quoterPoolManager,
  "permit2-allowance-treasury-aapl": permit2AllowanceNone,
  "erc20-allowance-treasury-aapl-permit2": erc20AllowanceNone,
} as Record<string, RpcBody>;

export const REQUESTS = requests as { block: number; calls: Record<string, { to: string; data: string }> };

export const COINS = {
  /** v1 launch, ETH-paired: ETH is currency0 */
  eth: "0xB200000000000000000000660433Ed1bB04B0dF9",
  /** v2 launch, AAPLc-paired: the coin is currency0 */
  stock: "0xb20000000000000000000036f9a2788834bCE124",
  aapl: "0xb200000000000000000000C2e324d24d7eEcd1fb",
  creator: "0xD5C1dFc036F9911348EA8065F73c8123f4013FAB",
} as const;
