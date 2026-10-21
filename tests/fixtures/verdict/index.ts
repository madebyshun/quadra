/**
 * Real answers behind a Token Verdict, captured 2026-10-01 and trimmed.
 *
 * MEASURED, not written — the same rule as `../base/index.ts`. The commands:
 *
 *   SIM=0x5157000000000000000000000000000000005157   # the keyless simulated buyer
 *   curl -s -X POST https://api.relay.link/quote -H 'content-type: application/json' -d \
 *     '{"user":"'$SIM'","recipient":"'$SIM'","originChainId":8453,"destinationChainId":8453,
 *       "originCurrency":"0x0000000000000000000000000000000000000000",
 *       "destinationCurrency":"0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
 *       "amount":"10000000000000000","tradeType":"EXACT_INPUT","slippageTolerance":"500"}'   # relay-eth-degen
 *   (the same with the currencies swapped and amount = what sim-buy delivered)             # relay-degen-eth
 *   eth_simulateV1 on base.publicnode.com, SIM given 10 ETH by state override, traceTransfers:
 *     [buy]                         → sim-buy
 *     [buy, transfer(half) to 0x5157…0002] → sim-transfer
 *     [buy, approve, sell]          → sim-roundtrip
 *   B=https://base.blockscout.com/api/v2
 *   curl -s "$B/addresses/<token>"                       # address-{degen,chubby,boar,doppler}
 *   curl -s "$B/transactions/<launch tx>"                # creation-*
 *   curl -s "$B/addresses/<launcher>/transactions"       # txs-{degen-deployer,chubby-launcher,clanker-launcher}
 *   curl -s "https://api.dexscreener.com/tokens/v1/base/0x0cbf291ba052174879d90bf781df1a5f2bc5bb07"  # dexscreener-boar
 *   eth_getBlockByNumber("latest") on base.publicnode.com                                  # rpc-latest-block
 *   eth_getLogs on mainnet.base.org: PoolManager, [Initialize, BOAR's pool id], ±30 blocks  # rpc-boar-initialize
 *
 * Trimmed: Relay's quotes to the steps' transactions and `details.currencyOut.amount`; the
 * simulations to each call's status and its Transfer logs; Blockscout records to the fields read.
 *
 * What each capture is worth knowing:
 * - sim-roundtrip: Relay's sell is TWO transactions (an exact approve, then the swap), so the
 *   simulation has three calls. 0.01 ETH became 24,891.45 DEGEN and came back as 0.00994 ETH.
 * - address-boar / address-doppler: a Clanker token and a Doppler token. Blockscout names NO
 *   creator for either — the factory made them inside a call. BOAR's launch is found through its
 *   v4 pool: dexscreener-boar's pool id and creation time, against rpc-latest-block, estimate block
 *   51801067 exactly, and rpc-boar-initialize is that block's Initialize log, in creation-boar's
 *   transaction — a call to "Clanker" (`deployToken`). creation-doppler called the ERC-4337
 *   EntryPoint (`handleOps`), whose sender is a bundler, not the launcher.
 * - txs-chubby-launcher: the whole history of CHUBBY's deployer, nine transactions, newest first —
 *   funded, deploy, add liquidity, buy, then `removeLiquidityETH`, sell, and send the ETH away. A
 *   rug, captured an hour after it launched.
 * - txs-clanker-launcher: BOAR's launcher; its newest 50 transactions are ALL `deployToken`, and
 *   there is a next page. txs-degen-deployer: a developer's busy wallet, also past one page.
 */
import relayEthDegen from "./relay-eth-degen.json";
import relayDegenEth from "./relay-degen-eth.json";
import simBuy from "./sim-buy.json";
import simTransfer from "./sim-transfer.json";
import simRoundtrip from "./sim-roundtrip.json";
import addressDegen from "./address-degen.json";
import addressChubby from "./address-chubby.json";
import addressBoar from "./address-boar.json";
import addressDoppler from "./address-doppler.json";
import creationDegen from "./creation-degen.json";
import creationChubby from "./creation-chubby.json";
import creationBoar from "./creation-boar.json";
import creationDoppler from "./creation-doppler.json";
import txsDegenDeployer from "./txs-degen-deployer.json";
import txsChubbyLauncher from "./txs-chubby-launcher.json";
import txsClankerLauncher from "./txs-clanker-launcher.json";
import dexscreenerBoar from "./dexscreener-boar.json";
import rpcLatestBlock from "./rpc-latest-block.json";
import rpcBoarInitialize from "./rpc-boar-initialize.json";

export const VX = {
  relayEthDegen,
  relayDegenEth,
  simBuy,
  simTransfer,
  simRoundtrip,
  addressDegen,
  addressChubby,
  addressBoar,
  addressDoppler,
  creationDegen,
  creationChubby,
  creationBoar,
  creationDoppler,
  txsDegenDeployer,
  txsChubbyLauncher,
  txsClankerLauncher,
  dexscreenerBoar,
  rpcLatestBlock,
  rpcBoarInitialize,
};

export const TOKENS = {
  degen: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
  chubby: "0xcBa5d18a934F86B264dC566D4f9F0a90988D32b3",
  boar: "0x0cbf291ba052174879d90bf781df1a5f2bc5bb07",
  doppler: "0x13f6d7bf6491e21db7c7b51043843953d7902ba3",
} as const;

export const LAUNCHERS = {
  degen: "0x3C12B77aE8B7DD1FEB63D1D6a2A819AcdA0a41d2",
  chubby: "0x46b979bFC409eF07f7b18Fd05cE02241c26e2cDe",
  clanker: "0xd9aCd656A5f1B519C9E76a2A6092265A74186e58",
} as const;

/** The capture session's moment, for ages: just after sim-* were taken. */
export const CAPTURED_AT = Date.parse("2026-10-01T02:00:00Z");
