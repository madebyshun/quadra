/**
 * Real answers for the launchpad index (`src/server/indexer.ts`), captured 2026-10-14 at head
 * 52,578,770. Nothing here is typed by hand: each file is a JSON-RPC `result` as the node sent it.
 *
 * Logs come from Tenderly's public gateway (https://gateway.tenderly.co/public/base, 1,000-block
 * ranges) because mainnet.base.org answered every `eth_getLogs` that hour with HTTP 429 "request
 * limit reached"; everything else from mainnet.base.org. Tenderly's logs carry `blockTimestamp`.
 *
 *   V1=0xcDb2eC1c487fbcB6B4AF25cCD86aFf8120FaB8a5  V2=0xef1F427bB57e0ECd7BB8051cE8bC7AAb709a0c03
 *   PM=0x498581fF718922c3f8e6A244956aF099B2652b2b
 *   LAUNCHED=keccak("Launched(address,address,bytes32,uint256,uint256)")
 *   SWAP=keccak("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)")
 *
 *   head.json          eth_getBlockByNumber ["latest", false]  (number + timestamp kept)
 *   launched-v1.json   eth_getLogs {address:[V2,V1], topics:[LAUNCHED], 52,066,247..52,067,246}
 *                      — v1's first launch, 0xB200…0dF9 (ETH pair, no first buy)
 *   launched-v2.json   eth_getLogs {address:[V2,V1], topics:[LAUNCHED], 52,070,397..52,071,396}
 *                      — two v2 launches, among them 0xb200…E124 (AAPLc pair)
 *   swaps-v1.json      eth_getLogs {address:PM, topics:[SWAP,[0xaeef…b2b5]]} in four 1,000-block ranges
 *                      from 52,066,247 — the bot's buy ONE block after the launch (0.000002 ETH)
 *   swaps-v2.json      the same for 0xb200…E124's pool 0xfd17…108d from 52,070,397 — its first
 *                      trade, a KyberSwap buy through the owner's MetaMask (tx 0x50064859…)
 *   launches-v1.json   eth_call V1.launches(0xB200…0dF9)    (latest)
 *   launches-v2.json   eth_call V2.launches(0xb200…E124)    (latest)
 *   launches-v2-second.json  eth_call V2.launches(0xb200…d5c7) — the other v2 launch, AAPLc pair, coin is currency1
 *   txs.json           eth_getTransactionByHash for both swaps (hash/from/to/blockNumber/value kept)
 *   erc20.json         eth_call name()/symbol() of both coins, symbol()/decimals() of AAPLc
 *                      (0xb200…C2e324d24d7eEcd1fb), name()/symbol() of 0xb200…d5c7 ("test")
 *
 *
 *   initialize-v1.json  eth_getLogs {address:PM, topics:[INITIALIZE,0xaeef…b2b5], 52,066,747..52,066,747}
 *                      — the pool of 0xB200…0dF9 opening in its launch block; captured 2026-10-21 from
 *                      Tenderly's gateway (mainnet.base.org answered "request limit reached"), with
 *                      INITIALIZE=keccak("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)")
 *                      = 0xdd466e67…6438. Its sqrtPriceX96 gives 4.973987206075924e-9 ETH per token,
 *                      the opening price the live index served for that coin the same day
 *
 * The capture script was scratchpad-only (capture-indexer.mjs); re-run the calls above to refresh.
 */
import head from "./head.json";
import launchedV1 from "./launched-v1.json";
import launchedV2 from "./launched-v2.json";
import swapsV1 from "./swaps-v1.json";
import swapsV2 from "./swaps-v2.json";
import launchesV1 from "./launches-v1.json";
import launchesV2 from "./launches-v2.json";
import launchesV2Second from "./launches-v2-second.json";
import txs from "./txs.json";
import erc20 from "./erc20.json";
import initializeV1 from "./initialize-v1.json";

export const IX = { head, launchedV1, launchedV2, swapsV1, swapsV2, launchesV1, launchesV2, launchesV2Second, txs, erc20, initializeV1 };

export const COINS = {
  /** v1, ETH pair */
  eth: "0xB200000000000000000000660433Ed1bB04B0dF9",
  /** v2, AAPLc pair — the coin is currency0 */
  stock: "0xb20000000000000000000036f9a2788834bCE124",
  aapl: "0xb200000000000000000000C2e324d24d7eEcd1fb",
  /** the other v2 launch in the same range, also against AAPLc — the coin is currency1 */
  second: "0xb200000000000000000000C2F9e459F8Cc40D5C7",
  owner: "0xD5C1dFc036F9911348EA8065F73c8123f4013FAB",
  v1: "0xcDb2eC1c487fbcB6B4AF25cCD86aFf8120FaB8a5",
  v2: "0xef1F427bB57e0ECd7BB8051cE8bC7AAb709a0c03",
} as const;
