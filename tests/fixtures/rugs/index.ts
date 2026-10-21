/**
 * Real answers behind the Recycle Bin (`skills/rugs.ts`), captured 2026-10-14 at block 0x3226b08 and
 * trimmed. Nothing was typed: logs are cut to address/blockNumber/topics/data/transactionHash,
 * receipts to from/to/hash/block and each log's address + topics, DexScreener pairs to the fields parsed.
 *
 *   R=https://base.publicnode.com   # mainnet.base.org answered eth_getLogs "request limit reached" that minute
 *   curl -s -X POST $R -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{
 *     "address":"0x498581fF718922c3f8e6A244956aF099B2652b2b",
 *     "topics":["0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec"],
 *     "fromBlock":"0x32268b0","toBlock":"0x3226b08"}]}'
 *       → rpc-modify-liquidity-logs: of 1,397 logs, the 46 with a NEGATIVE liquidity delta (12 pools)
 *         and the first 4 positive ones in those same pools
 *   eth_call PoolManager.extsload(bytes32[]) with each of the 12 pools' liquidity slot, "latest"
 *       → rpc-extsload (the request is kept: its calldata is what recycleBin must send)
 *   eth_call StateView (0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71, Uniswap's own reader)
 *     getLiquidity(bytes32) = 0xfa6793d5 ‖ poolId, for two pools left with liquidity
 *       → stateview-liquidity: an INDEPENDENT oracle for the slot arithmetic (it agreed exactly)
 *   eth_getTransactionReceipt <tx> on https://mainnet.base.org (publicnode answers 403)
 *       → receipt-<tx prefix>: the last removal of pools 0x07fe…, 0x2966…, 0x1a3a…, 0x81e6…
 *   curl -s "https://api.dexscreener.com/tokens/v1/base/0xb2000000000000000000002df28fe1e36391efd5,\
 *     0xb2000000000000000000001e1ac75af2158e8e45,0x07b3d902783c3c12b077508c3b5c00113d1291d0,\
 *     0xfde4c96c8593536e31f229ea8f37b2ada2699bb2" → dexscreener-emptied
 *
 * Worth knowing: the 0x1a3a… and 0x81e6… receipts both hand out XDP (0x07b3…) first — one coin
 * emptied from two pools, the dedupe case, from the chain itself. The 0x1a3a… receipt also moves
 * USDC out of the PoolManager, which is a quote and never the coin.
 */
import logs from "./rpc-modify-liquidity-logs.json";
import extsload from "./rpc-extsload.json";
import stateView from "./stateview-liquidity.json";
import receiptBased from "./receipt-0x1e34335b.json";
import receiptDexsi from "./receipt-0x0c335d6a.json";
import receiptXdpA from "./receipt-0x0ac125c7.json";
import receiptXdpB from "./receipt-0x0b8a592f.json";
import dexscreener from "./dexscreener-emptied.json";

export const RUGS = { logs, extsload, stateView, receiptBased, receiptDexsi, receiptXdpA, receiptXdpB, dexscreener };
export const RUGS_LATEST = 0x3226b08;
