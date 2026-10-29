import { WETH } from "@/config/chain";
import { getJson } from "@/skills/http";
import { isObj, listOf, numOf, objAt, strOf } from "@/skills/json";

/**
 * DexScreener: a token's markets on Base, for price, liquidity and volume.
 *
 * MEASURED 2026-09-30: `GET /tokens/v1/base/<address>` answers CORS (`*`) with an ARRAY of
 * pairs — `[]` for a token with none — each carrying `priceUsd` (a string), `liquidity.usd`,
 * `volume.h24`, `pairCreatedAt` (ms) and the pair's `url`. The price is the pair's last
 * trade: a market fact, not a valuation, and the deepest pool is the one worth quoting.
 */

const SERVICE = "DexScreener";

export type Market = {
  readonly dex: string;
  /** the pool's address — or, for a Uniswap v4 pool, its 32-byte id (the tokens sit in the PoolManager) */
  readonly pair: string | null;
  readonly priceUsd: number | null;
  readonly liquidityUsd: number | null;
  readonly volume24h: number | null;
  /** ms since epoch */
  readonly createdAt: number | null;
  readonly quote: string;
  readonly url: string | null;
  readonly buys24h: number | null;
  readonly sells24h: number | null;
  /** percent price change per window — `null` when DexScreener did not publish it */
  readonly change: { readonly m5: number | null; readonly h1: number | null; readonly h6: number | null; readonly h24: number | null };
  /** the token this market prices, and what it calls itself here */
  readonly base: string | null;
  readonly symbol: string | null;
  readonly marketCap: number | null;
};

export function parseMarkets(body: unknown): Market[] {
  return listOf(body)
    .filter(isObj)
    .map((p) => ({
      dex: strOf(p.dexId) ?? "?",
      pair: strOf(p.pairAddress),
      priceUsd: numOf(p.priceUsd),
      liquidityUsd: numOf(objAt(p, "liquidity").usd),
      volume24h: numOf(objAt(p, "volume").h24),
      createdAt: numOf(p.pairCreatedAt),
      quote: strOf(objAt(p, "quoteToken").symbol) ?? "?",
      url: strOf(p.url),
      buys24h: numOf(objAt(objAt(p, "txns"), "h24").buys),
      sells24h: numOf(objAt(objAt(p, "txns"), "h24").sells),
      change: {
        m5: numOf(objAt(p, "priceChange").m5),
        h1: numOf(objAt(p, "priceChange").h1),
        h6: numOf(objAt(p, "priceChange").h6),
        h24: numOf(objAt(p, "priceChange").h24),
      },
      base: strOf(objAt(p, "baseToken").address),
      symbol: strOf(objAt(p, "baseToken").symbol),
      marketCap: numOf(p.marketCap),
    }));
}

/**
 * The deepest market by USD liquidity, or `null` when there is none.
 *
 * A market whose depth DexScreener does not report still counts as a market: it was a
 * `reduce` from `null` that compared -1 with -1 and so returned "no market" for a token
 * whose only pool had no liquidity figure — a missing answer read as a negative one.
 */
export function deepest(markets: readonly Market[]): Market | null {
  let best: Market | null = null;
  for (const m of markets) {
    if (best === null || (m.liquidityUsd ?? -1) > (best.liquidityUsd ?? -1)) best = m;
  }
  return best;
}

export async function markets(token: string): Promise<Market[]> {
  return parseMarkets(await getJson(SERVICE, `${PAIRS}/${token}`));
}

/** Up to this many tokens in one request (MEASURED 2026-09-30: DexScreener's own limit). */
export const BATCH = 30;
const PAIRS = "https://api.dexscreener.com/tokens/v1/base";

/** Every market of up to `BATCH` tokens, in one request. */
export async function marketsOf(tokens: readonly string[]): Promise<Market[]> {
  return tokens.length === 0 ? [] : parseMarkets(await getJson(SERVICE, `${PAIRS}/${tokens.slice(0, BATCH).join(",")}`));
}

/** USD per ETH from the deepest WETH market, or `null` when it could not be read. */
export async function ethUsd(): Promise<number | null> {
  try {
    return deepest(await markets(WETH.address))?.priceUsd ?? null;
  } catch {
    return null;
  }
}
