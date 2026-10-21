/**
 * Real answers from the services the skills read, captured 2026-09-30 and trimmed.
 *
 * MEASURED, not written: every file here is a response body the live service returned, with
 * fields the parsers do not read deleted and long lists cut short. Nothing was added or
 * edited by hand — a fixture typed from memory tests the parser against what somebody
 * thought the service says, which is how `lib/requirements.ts` came to refuse every real
 * 402 (CLAUDE.md, "a protocol rule measured against one server is a sample of one").
 * Tests that need a shape the capture did not contain build it FROM these, visibly, in
 * the test.
 *
 * To re-measure, the commands were:
 *
 *   B=https://base.blockscout.com/api/v2
 *   curl -s "$B/tokens/0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed"                  # token-degen
 *   curl -s "$B/tokens/0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed/holders"          # holders-degen (first 12 of 50)
 *   curl -s "$B/addresses/0x2211d1D0020DAEA8039E46Cf1367962070d77DA9/token-balances"  # token-balances-jesse
 *   curl -s "https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=<token>"      # goplus-*
 *   curl -s "$B/addresses/0x2211d1D0020DAEA8039E46Cf1367962070d77DA9"  # its exchange_rate, 2660.28, is the ETH price used below
 *   curl -s "https://api.dexscreener.com/tokens/v1/base/0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed" # dexscreener-degen
 *
 * What each capture is worth knowing:
 * - token-balances-jesse: the full answer had 12,737 entries — 11,748 ERC-20 (144 with no
 *   decimals, 262 priced), 453 ERC-721, 473 ERC-1155 and 63 with `token: null`. Kept: the 12
 *   largest priced, two unpriced airdrops, one with no decimals, one null, one of each NFT.
 * - goplus-brtc: a B20 token. Fourteen fields and NO honeypot flags — the case that makes
 *   every flag three-valued. goplus-unknown is `{"result": {}}` for an address it has no
 *   report on.
 */
import holdersDegen from "./holders-degen.json";
import tokenDegen from "./token-degen.json";
import tokenBalancesJesse from "./token-balances-jesse.json";
import goplusDegen from "./goplus-degen.json";
import goplusBrtc from "./goplus-brtc.json";
import goplusUnknown from "./goplus-unknown.json";
import dexscreenerDegen from "./dexscreener-degen.json";

export const FX = {
  holdersDegen,
  tokenDegen,
  tokenBalancesJesse,
  goplusDegen,
  goplusBrtc,
  goplusUnknown,
  dexscreenerDegen,
};

/** Addresses the captures are about. Each is the real one the capture was taken from. */
export const ADDR = {
  degen: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
  brtc: "0xB200000000000000000000856A95738C92fEed01",
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  jesse: "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9",
  /** what the Basenames registry answered as jesse.base.eth's resolver (MEASURED with cast) */
  l2Resolver: "0xC6d566A56A1aFf6508b41f6c90ff131615583BCD",
} as const;

/**
 * ETH in USD as Blockscout reported it (`exchange_rate` on the jesse address record) in the
 * same capture session — the price a WETH market is built with where a test needs one.
 */
export const ETH_USD = 2660.28;

/** jesse's ETH balance in wei, from the same address record (`coin_balance`). */
export const JESSE_WEI = 7626904801941975387n;

/** A deep copy, so a test that edits a capture to build a variant cannot leak into the next. */
export function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A WETH market on DexScreener: the DEGEN capture's pair, re-priced at `ETH_USD` from the same session. */
export function wethMarket(): unknown {
  const pairs = copy(FX.dexscreenerDegen);
  pairs[0]!.priceUsd = String(ETH_USD);
  return pairs;
}

/**
 * What the wallet's asset list reads, as a GET router: the account's tokens from Blockscout
 * (jesse's captured balances unless given others) and ETH's price from a WETH market.
 */
export function walletReads(tokens: unknown = FX.tokenBalancesJesse): (url: string) => unknown {
  return (url) =>
    url.startsWith("https://base.blockscout.com/api/v2/addresses/") && url.endsWith("/token-balances")
      ? tokens
      : url === "https://api.dexscreener.com/tokens/v1/base/0x4200000000000000000000000000000000000006"
        ? wethMarket()
        : undefined;
}
