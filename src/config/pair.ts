/**
 * The product token pairs against tokenized Apple stock. The product is named
 * after a 1991 Macintosh, so the pair is the joke and the thesis at once.
 * (No brand literal in this file — the ticker comes from brand.ts.)
 *
 * AAPLc is a native B20: a Rust node precompile, NOT a Solidity contract. It has
 * no source on Basescan, so "read the source" is not available as a check — the
 * only way to know what it is, is to assert it on chain. Asserted 2026-09-27
 * against https://mainnet.base.org (`cast`), all four, plus a negative control:
 *
 *   symbol()                        → "AAPLc"      ✓ matches <TICKER>c
 *   name()                          → "Apple Inc."  ✓
 *   decimals()                      → 8            ✓ NOT 18 — see the warning below
 *   B20Factory.isB20(AAPLc)         → true         ✓
 *   B20Factory.isB20(WETH)          → false        ✓ control: the check is real,
 *                                                    not a constant true
 *
 * Re-assert before deploying anything that holds funds. A ticker string never
 * identifies a token: NVDA, META, GOOGL and AAPL all exist on Base 8453 AND on
 * Robinhood Chain 4663 as different contracts in different pools.
 */

import { BRAND } from "@/brand";
import { BASE } from "@/config/chain";

/**
 * ⚠️ 8 decimals, not 18. Every B20 share token is 8. Code that assumes an
 * 18-decimal ERC-20 misprices this by 10^10 — which looks like a 10-billion-x
 * move, not like a bug, so it will not announce itself.
 */
export const AAPL_BASE = {
  address: "0xb200000000000000000000C2e324d24d7eEcd1fb",
  symbol: "AAPLc",
  name: "Apple Inc.",
  decimals: 8,
  chainId: BASE.id,
  explorer: `${BASE.explorer}/address/0xb200000000000000000000C2e324d24d7eEcd1fb`,
  /** native B20 precompile — no Solidity source exists to read */
  isNativeB20: true,
} as const;

/** The factory that answers `isB20(address)`. The token itself has no such method. */
export const B20_FACTORY = "0xB20f000000000000000000000000000000000000" as const;

/**
 * The AAPLc pool that already exists, measured 2026-09-27. Recorded as evidence
 * the venue is liquid enough to pair into — NOT as a pool this project owns.
 * These numbers move; re-read them from `hood-live` rather than quoting these.
 */
export const AAPL_REFERENCE_POOL = {
  address: "0xa3b1e3f9747065e2073722ff4c9027d3ea4994f0",
  measuredAt: "2026-09-27",
  tvlUsd: 1_687_306,
  volume24hUsd: 2_851_367,
  oracleUsd: 341.513,
  dexUsd: 340.93,
} as const;

/**
 * The product token does not exist yet. `null` until it is deployed and
 * verified — see the module note in config/chain.ts for why this is not a zero
 * address.
 */
export const LAUNCH_TOKEN: string | null = null;

/** The pair this project intends to launch. Neither side may be guessed. */
export const LAUNCH_PAIR = {
  base: BRAND.ticker.replace("$", ""),
  quote: AAPL_BASE.symbol,
  /** resolved once both sides exist */
  pool: null as string | null,
} as const;
