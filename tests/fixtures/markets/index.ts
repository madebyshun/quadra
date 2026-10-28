/**
 * Real answers from DexScreener, GeckoTerminal, Coinbase's Tokenized Stocks API and Robinhood's
 * Stock Token API, captured 2026-09-30 and trimmed (same rule as tests/fixtures/base: measured,
 * never typed; variants built from these).
 *
 *   D=https://api.dexscreener.com/tokens/v1
 *   curl -s "$D/base/0x4200000000000000000000000000000000000006,0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf,0xb20000000000000000000078ee7ce2fE4908108C,0xb200000000000000000000C2e324d24d7eEcd1fb,0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b"  # dexscreener-base (WETH cbBTC NVDAc AAPLc VIRTUAL)
 *   curl -s "$D/robinhood/0x322F0929c4625eD5bAd873c95208D54E1c003b2d,0x117cc2133c37B721F49dE2A7a74833232B3B4C0C"  # dexscreener-robinhood (TSLA SPY)
 *   G=https://api.geckoterminal.com/api/v2
 *   curl -s "$G/networks/base/pools/0x6c561b446416e1a00e8e93e221854d6ea4171372/ohlcv/hour?aggregate=1&limit=24&currency=usd&token=0x4200…0006"  # gecko-weth-ohlcv
 *   curl -s "$G/networks/robinhood/pools/0x8517…d32e/ohlcv/hour?aggregate=1&limit=48&currency=usd&token=base"  # gecko-tsla-ohlcv (24 of 48)
 *   curl -s https://api.coinbase.com/v1/tokenized-stocks   # coinbase-stocks (6 of 40: AAPLc AMDc DKNGc GOOGLc NVDAc TSLAc)
 *   curl -s https://api.robinhood.com/rhj/prices/          # robinhood-prices (5 of 195: TSLA NVDA AAPL SPY CRM)
 *
 * Worth knowing: DexScreener's batch endpoint returned ONE pair per token here, with `priceUsd`
 * and `liquidity.usd` as a string and a number respectively. Candles come NEWEST FIRST, as
 * `[unix seconds, open, high, low, close, volume]`. Coinbase's list keeps the "c" on each symbol
 * ("NVDAc"), gives `multiplier` as a plain number (GOOGLc 1.00038…), `nav_price` null for a stock
 * with no Chainlink feed yet (AMDc), and `paused_features: [0, 1, 2]` on DKNGc. Robinhood's quotes
 * carry bid/ask as strings and the contract on 4663 under `deployments`.
 */
import dexBase from "./dexscreener-base.json";
import dexRobinhood from "./dexscreener-robinhood.json";
import wethOhlcv from "./gecko-weth-ohlcv.json";
import tslaOhlcv from "./gecko-tsla-ohlcv.json";
import coinbaseStocks from "./coinbase-stocks.json";
import prices from "./robinhood-prices.json";

export const MARKETS_FX = { dexBase, dexRobinhood, wethOhlcv, tslaOhlcv, coinbaseStocks, prices };

/** The newest candle in both GeckoTerminal captures, plus half an hour — "now" for chart tests. */
export const CAPTURED_AT = (1790769600 + 1800) * 1000;

export const TSLA = "0x322F0929c4625eD5bAd873c95208D54E1c003b2d";
export const SPY = "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C";
/** NVIDIA's stock token on Base, as Coinbase's list names it. */
export const NVDA_ON_BASE = "0xb20000000000000000000078ee7ce2fE4908108C";
export const AAPL_ON_BASE = "0xb200000000000000000000C2e324d24d7eEcd1fb";
/** The pairs DexScreener named as deepest — also GeckoTerminal's pool ids. */
export const WETH_PAIR = "0x72AB388E2E2F6FaceF59E3C3FA2C4E29011c2D38";
export const TSLA_PAIR = "0xa821b3724b451b22476c5347471b2a96d185b86af8760f226273e34ab4b2b8a0";
