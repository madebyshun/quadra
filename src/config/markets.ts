import { USDC, WETH } from "@/config/chain";

/**
 * What the Markets gadget, the Markets window and Trade watch by default, and where from.
 *
 * MEASURED 2026-09-30, each before its client was written:
 *
 * • DexScreener (`api.dexscreener.com/tokens/v1/<chain>/<a,b,…>`) prices up to 30 tokens per
 *   request, CORS `*`, 300 requests a minute — prices, 24h change and depth. Robinhood Chain is
 *   `robinhood` there. See `adapters/http/markets.ts`.
 * • GeckoTerminal serves the candles, through this app's server, which caches them
 *   (`server/charts.ts`): asked directly it rate-limited this machine for over an hour.
 * • Coinbase's Tokenized Stocks API (`api.coinbase.com/v1/tokenized-stocks`, docs.base.org "List
 *   Tokenized Stocks") lists the 40 Coinbase stocks on Base, no key, NO CORS — through
 *   `server/stocks.ts`. It replaced o1's `base-stock-quotes.json`, which listed 10.
 * • Robinhood's Stock Token API (`api.robinhood.com/rhj/prices/`) quotes its 195 stock tokens on
 *   Robinhood Chain — through `server/stocks.ts` for the same reason.
 *
 * 🔴 Hard rule 2, measured the hard way: a DexScreener search for "TSLA" on Robinhood Chain
 * returned the real token AND a "TSLA" at $564 claiming $282M of liquidity, AND several
 * memecoins named TSLA. A stock here is identified by the contract its issuer's own API names —
 * never by a ticker found on a DEX.
 */

/** GeckoTerminal's network ids — the two chains this app prices assets on. */
export type Venue = "base" | "robinhood";

/**
 * Coinbase Wrapped BTC on Base. VERIFIED 2026-09-30 on Base's Blockscout: `is_verified: true`,
 * name "Coinbase Wrapped BTC", symbol CBBTC, 8 decimals (hard rule 3 — not 18).
 */
export const CBBTC = { address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", symbol: "cbBTC", decimals: 8 } as const;

/**
 * One watched asset: a token on Base by address; a Coinbase stock on Base by its ticker in
 * Coinbase's own list; or a Robinhood stock token by its symbol in Robinhood's own list. A stock
 * is never identified by a ticker found on a DEX (hard rule 2) — always through its issuer's list.
 */
export type Watch =
  | { readonly kind: "token"; readonly address: string; readonly label: string }
  | { readonly kind: "basestock"; readonly symbol: string }
  | { readonly kind: "stock"; readonly symbol: string };

/**
 * Base first — the owner's rule, 2026-09-30: "every feature is about Base first". ETH is priced
 * by WETH, which trades one-for-one with it. NVDA and AAPL are two Coinbase stocks on Base with
 * real markets (MEASURED on DexScreener: ~$2.2M and ~$1.6M of pool liquidity).
 */
export const DEFAULT_WATCH: readonly Watch[] = [
  { kind: "token", address: WETH.address, label: "ETH" },
  { kind: "token", address: CBBTC.address, label: "cbBTC" },
  { kind: "basestock", symbol: "NVDA" },
  { kind: "basestock", symbol: "AAPL" },
  { kind: "stock", symbol: "TSLA" },
  { kind: "stock", symbol: "SPY" },
];

/** Where a watched asset lives. */
export function venueOf(w: Watch): Venue {
  return w.kind === "stock" ? "robinhood" : "base";
}

/** A stable key for a watched asset — what a click and a selection are about. */
export function watchKey(w: Watch): string {
  return w.kind === "token" ? `token:${w.address.toLowerCase()}` : `${w.kind}:${w.symbol}`;
}

/** Below this much pool liquidity (USD), a price is marked as coming from a thin market. */
export const THIN_MARKET_USD = 10_000;

/** A token Trade offers on its Crypto tab. */
export type Listed = { readonly address: string; readonly symbol: string; readonly name: string; readonly decimals: number };

/**
 * The Crypto tab of Trade: widely held tokens on Base, each VERIFIED 2026-09-30 on Base's
 * Blockscout before it was written here (hard rule 1) — `is_verified: true`, the name, symbol and
 * decimals as listed, and between 113k and 1.2M holders each. ETH is not in the list: Trade offers
 * it on its own row, priced by WETH. Any other token is still tradable by address in Swap.
 */
export const TRADE_CRYPTO: readonly Listed[] = [
  { address: USDC.address, symbol: "USDC", name: "USD Coin", decimals: USDC.decimals },
  { address: CBBTC.address, symbol: CBBTC.symbol, name: "Coinbase Wrapped BTC", decimals: CBBTC.decimals },
  { address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", symbol: "cbETH", name: "Coinbase Wrapped Staked ETH", decimals: 18 },
  { address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", symbol: "AERO", name: "Aerodrome Finance", decimals: 18 },
  { address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", symbol: "VIRTUAL", name: "Virtuals Protocol", decimals: 18 },
  { address: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", symbol: "EURC", name: "EURC", decimals: 6 },
  { address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", symbol: "DEGEN", name: "Degen", decimals: 18 },
  { address: "0x1111111111166b7FE7bd91427724B487980aFc69", symbol: "ZORA", name: "Zora", decimals: 18 },
  { address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", symbol: "BRETT", name: "Brett", decimals: 18 },
];
