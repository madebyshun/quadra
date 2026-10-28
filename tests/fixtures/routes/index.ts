/**
 * Real quotes from Relay (swap) and Across (bridge), captured 2026-09-30 and trimmed — same
 * rule as `tests/fixtures/base`: measured, never typed from memory; variants built FROM these,
 * visibly, in the test. The user is 0x2211…7DA9 (jesse.base.eth), a real funded address.
 *
 *   U=0x2211d1D0020DAEA8039E46Cf1367962070d77DA9
 *   curl -s -X POST https://api.relay.link/quote -H 'content-type: application/json' -d \
 *     '{"user":"'$U'","recipient":"'$U'","originChainId":8453,"destinationChainId":8453,
 *       "originCurrency":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
 *       "destinationCurrency":"0x4200000000000000000000000000000000000006",
 *       "amount":"5000000","tradeType":"EXACT_INPUT","slippageTolerance":"50"}'      # relay-usdc-weth
 *   (the same with originCurrency 0x000…000, destinationCurrency USDC, amount 1e15)   # relay-eth-usdc
 *   curl -s 'https://app.across.to/api/swap/approval?tradeType=exactInput&amount=5000000
 *     &inputToken=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 *     &outputToken=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
 *     &originChainId=8453&destinationChainId=4663&depositor='$U'&recipient='$U       # across-usdc-usdg
 *   (the same with inputToken=outputToken=0x000…000 and amount 1e15)                  # across-eth
 *
 * Worth knowing: Relay's USDC swap is two steps (an EXACT approval to the approval proxy, then
 * the swap to it); its ETH swap is one step to RelayRouterV3 carrying the amount as value.
 * Across's USDC quote carries an UNLIMITED approval (…ffff), which the app ignores; its
 * deposit calldata decodes with the verified ABI to the terms asked for.
 *
 * Two real Relay swap RECEIPTS on Base, captured 2026-09-30 from mainnet.base.org, both sent by
 * 0xf70d…dbEF (found through Blockscout's list of transactions to the Relay contracts):
 *
 *   R=https://mainnet.base.org; J='{"jsonrpc":"2.0","id":1,"method":'
 *   curl -s -X POST $R -H 'content-type: application/json' -d "$J"'"eth_getTransactionReceipt","params":["0x9151f135f9c701f51ae62a1daea3594f39432e5b6ec7026cd6bf88abbe0a4807"]}'  # receipt-eth-usdc
 *   curl -s -X POST $R -H 'content-type: application/json' -d "$J"'"eth_getTransactionReceipt","params":["0x0e2c43816bcbb59900f910f87073c86cf9db6e6f79d5f3137ae47698fde8d50c"]}'  # receipt-usdc-eth
 *   curl -s -X POST $R -H 'content-type: application/json' -d "$J"'"eth_getBalance","params":["0xf70da97812cb96acdf810712aa562db8dfa3dbef","0x3195632"]}'   # USDC_ETH.after
 *   (the same at 0x3195631)                                                                                                          # USDC_ETH.before
 *
 * receipt-eth-usdc: ~0.592 ETH in, 1616.193741 USDC to the sender, 11 logs. receipt-usdc-eth:
 * 127.346161 USDC in, ETH out through a WETH withdrawal — no log names the sender as receiving
 * it. Its balance difference plus its fee (gas × price + Base's l1Fee) is 46652970464517340 wei,
 * EXACTLY the WETH withdrawn in the same receipt: the measurement `ethReceived` makes, checked
 * against an independent figure before it was written down.
 *
 * Three Relay quotes for Coinbase's stocks on Base, captured 2026-09-30 for the same user, with
 * the curl at the top of this file and these currencies/amounts:
 *   USDC → NVDAc (0xb200…108C), 5000000            # relay-usdc-nvda: approve USDC, swap via the approval proxy
 *   NVDAc → USDC, 1000000                           # relay-nvda-usdc: approve NVDAc, swap via the approval proxy
 *   ETH (0x000…000) → AAPLc (0xb200…d1fb), 1e15     # relay-eth-aapl:  one step to RelayRouterV3
 * They show Relay routes B20 stock tokens with the same two contracts it uses for anything else.
 */
import relayUsdcWeth from "./relay-usdc-weth.json";
import relayEthUsdc from "./relay-eth-usdc.json";
import acrossUsdc from "./across-usdc-usdg.json";
import acrossEth from "./across-eth.json";
import receiptEthUsdc from "./receipt-eth-usdc.json";
import receiptUsdcEth from "./receipt-usdc-eth.json";
import relayUsdcNvda from "./relay-usdc-nvda.json";
import relayNvdaUsdc from "./relay-nvda-usdc.json";
import relayEthAapl from "./relay-eth-aapl.json";

export const ROUTES_FX = { relayUsdcWeth, relayEthUsdc, acrossUsdc, acrossEth, receiptEthUsdc, receiptUsdcEth, relayUsdcNvda, relayNvdaUsdc, relayEthAapl };

export const USER = "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9";

/** The account both captured receipts were sent by. */
export const SWAPPER = "0xf70da97812cb96acdf810712aa562db8dfa3dbef";

/** receipt-usdc-eth's sender's ETH balance at its block and the one before, and what arrived. */
export const USDC_ETH = {
  block: "0x3195632",
  previous: "0x3195631",
  after: 0x965f78c18fa97d0cbn,
  before: 0x96551ddcddd7d3a30n,
  received: 46652970464517340n,
} as const;
