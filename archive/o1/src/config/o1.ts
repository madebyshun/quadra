import { USDC } from "@/config/chain";
import { CBBTC } from "@/config/markets";

/**
 * o1 Exchange's launchpad, as far as this app depends on it.
 *
 * Sources: the OpenAPI 3.1 spec at https://docs.o1.exchange/launchpad-api-openapi.yaml and
 * https://docs.o1.exchange/launchpad/reference/production-contracts, read 2026-09-30.
 *
 * `factory` is the ONE address a launch step may send to. VERIFIED 2026-09-30 on Base's
 * Blockscout (`/api/v2/addresses/0x1176…63dC`: `is_contract: true`, `is_verified: true`,
 * name `RWAB20LaunchpadFactory`) — hard rule 1. The API returns the step's `to` itself; this
 * constant is only ever an ASSERTION against it, never the destination, the same authority
 * split `config/payees.ts` keeps for x402 (a constant used as the destination would keep
 * sending to an old factory after o1 moved).
 *
 * ⚠️ MEASURED 2026-09-30: every route of the live API, `/health` included, answered HTTP 500
 * `FUNCTION_INVOCATION_FAILED`. The client below is written against the spec and has NOT
 * yet exchanged a single request with the real service. Measure it before trusting it.
 */
export const O1 = {
  api: "https://api.launch.o1.exchange/v1",
  factory: "0x1176122eb77AD6a2339322Cda7C4D7ea9BfA63dC",
  /** the zero address, which o1 uses for "the native currency" — ETH on Base */
  nativeQuote: "0x0000000000000000000000000000000000000000",
  docs: "https://docs.o1.exchange/launchpad/api/launches",
} as const;

/**
 * The o1 launch market a pair belongs to: `standard` for a crypto pair, `rwa` for a stock.
 * Both go through the SAME factory on Base (docs.o1.exchange/launchpad/reference/
 * production-contracts: "Standard crypto-paired and stock-paired launch contracts").
 */
export type LaunchMarket = "standard" | "rwa";

export type Pair = {
  readonly market: LaunchMarket;
  readonly symbol: string;
  readonly name: string;
  /** the quote token o1 pairs the launch with — the zero address for ETH */
  readonly address: string;
};

/**
 * The crypto assets a Base launch can be paired with. o1's docs name "ETH, USDC or another
 * registered crypto asset"; which ones are registered is the factory's answer, not the docs'.
 * MEASURED 2026-09-30 at Base block 51,992,427 with `quoteConfig(address)` on the factory:
 * ETH (the zero address) registered, 18 decimals; USDC registered, 6; cbBTC registered, 8;
 * WETH NOT registered. The window reads `quoteConfig` again for whichever pair is picked —
 * this list is what is offered, the chain is what is believed.
 *
 * Addresses come from the two constants already verified for Base (hard rule 1), never retyped.
 */
export const CRYPTO_PAIRS: readonly Pair[] = [
  { market: "standard", symbol: "ETH", name: "Ether", address: O1.nativeQuote },
  { market: "standard", symbol: "USDC", name: "USD Coin", address: USDC.address },
  { market: "standard", symbol: CBBTC.symbol, name: "Coinbase Wrapped BTC", address: CBBTC.address },
];

/**
 * The factory's read functions this app calls, from its VERIFIED source on Base's Blockscout
 * (`/api/v2/smart-contracts/0x1176…63dC`, `RWAB20LaunchpadFactory`, solc 0.8.26), 2026-09-30.
 */
export const FACTORY_ABI = [
  { type: "function", name: "launchCreationEnabled", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "nativeLaunchFee", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  {
    type: "function",
    name: "quoteConfig",
    stateMutability: "view",
    inputs: [{ name: "quoteToken", type: "address" }],
    outputs: [
      { name: "registered", type: "bool" },
      { name: "quoteDecimals", type: "uint8" },
      { name: "startTickToken0Frame", type: "int24" },
    ],
  },
] as const;

/** o1's limits on a launch's extra key/value metadata, from its spec (`MetadataPair`). */
export const EXTRA = { rows: 16, key: 64, value: 512, bytes: 4096 } as const;
