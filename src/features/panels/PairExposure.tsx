import { useEffect, useState } from "react";
import { baseStocks, type BaseStock } from "@/adapters/http/markets";
import type { IndexedCoinPage } from "@/adapters/http/indexer";
import { compact, tinyPrice, usd } from "@/skills/format";
import { deepest, marketsOf, type Market } from "@/skills/dexscreener";
import type { PoolValue } from "@/skills/launchpad";

/**
 * "Paired with …" on a coin's page (2026-11-13, Stocks Maxxing track 1.1, stock-quoted communities:
 * "show both prices, two-sided exposure"). A coin launched here is priced in its quote — ETH or a
 * Coinbase stock — so its dollar value is (the coin's price in the quote) × (the quote's dollar
 * price). Holding it is holding the quote's price, times the coin's own move against it.
 *
 * That is said as a SPLIT, not as one "X% exposure" figure: for a coin priced in AAPLc the exposure to
 * AAPL's price is always all of it, and a single percentage would read as a fraction. The 24 hours
 * are taken apart instead — the quote moved a%, the coin moved b% against the quote, so in dollars it
 * moved (1+a)(1+b)−1 — each part from where it was read, and a part that could not be read is said.
 */

export const DAY_MS = 86_400_000;
/** Every coin launched here has exactly one billion tokens (the factory mints them all at launch). */
const SUPPLY = 1e9;

/** The coin's move against its quote over the last day, from the index's price points; `null` without a price a day back. */
export function coinMove(points: readonly { readonly at: number; readonly price: number }[], now: number): number | null {
  if (points.length === 0) return null;
  const last = points[points.length - 1]!;
  const before = [...points].reverse().find((p) => p.at <= now - DAY_MS) ?? null;
  // a coin younger than a day is measured from its opening price — said in the words below
  const from = before ?? points[0]!;
  return from.price > 0 && last !== from ? last.price / from.price - 1 : null;
}

export type Split = { readonly quote: number | null; readonly coin: number | null; readonly dollars: number | null };

/** The day's move in dollars from its two parts; `null` when either part is missing. */
export function splitMove(quote: number | null, coin: number | null): Split {
  return { quote, coin, dollars: quote === null || coin === null ? null : (1 + quote) * (1 + coin) - 1 };
}

const pct = (x: number | null) => (x === null ? "not read" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2)}%`);

/** The quote's own name for the sentence: the stock's ticker ("AAPL"), else its symbol ("ETH"). */
const nameOf = (symbol: string, stock: BaseStock | null) => stock?.ticker ?? symbol.replace(/^WETH$/, "ETH");

export function PairExposure({ page, value, now = Date.now() }: { page: IndexedCoinPage | null; value: PoolValue | null; now?: number }) {
  const [market, setMarket] = useState<Market | null | "unread">(null);
  const [stock, setStock] = useState<BaseStock | null>(null);
  const quote = value?.quote ?? null;
  useEffect(() => {
    if (quote === null) return;
    let live = true;
    // ETH is the zero address in a pool key; its market is WETH's — DexScreener reads WETH
    const eth = /^0x0{40}$/.test(quote);
    const asked = eth ? "0x4200000000000000000000000000000000000006" : quote;
    marketsOf([asked]).then(
      (all) => live && setMarket(deepest(all.filter((m) => m.base?.toLowerCase() === asked.toLowerCase() && m.priceUsd !== null)) ?? "unread"),
      () => live && setMarket("unread"),
    );
    // an ETH pair is no stock: Coinbase's list is not asked
    if (!eth)
      baseStocks().then(
      (m) => live && setStock([...m.values()].find((s) => s.address.toLowerCase() === quote.toLowerCase()) ?? null),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [quote]);

  if (value === null) return null;
  const qs = value.quoteSymbol;
  const name = nameOf(qs, stock);
  const m = market === "unread" ? null : market;
  // the last trade's price from the index, else the pool's own (the whole 1B supply's value in the quote)
  const price = page?.coin.price ?? value.supplyInQuote / SUPPLY;
  const points = page?.points ?? [];
  const coin = coinMove(points, now);
  const young = points.length > 0 && !points.some((p) => p.at <= now - DAY_MS);
  const split = splitMove(m?.change.h24 == null ? null : m.change.h24 / 100, coin);
  return (
    <section className="group pair" aria-label={`Paired with ${qs}`}>
      <h3 className="pair__title">Paired with {qs}</h3>
      <dl className="pair__facts">
        <dt>{qs} on Base</dt>
        <dd>
          {market === null ? "reading…" : m?.priceUsd == null ? "not read — DexScreener did not answer" : `${usd(m.priceUsd)} · 24h ${pct(split.quote)}`}
          {stock?.nav != null ? ` · Coinbase NAV ${usd(stock.nav)}` : ""}
        </dd>
        <dt>1 coin</dt>
        <dd>
          {compact(price)} {qs}
          {stock ? ` = ${compact(price * stock.multiplier)} ${stock.multiplier === 1 ? "share" : "shares"} of ${stock.ticker}` : ""}
          {value.quoteUsd !== null ? ` = ${tinyPrice(price * value.quoteUsd)}` : ""}
        </dd>
        <dt>Last 24h</dt>
        <dd>
          {split.coin === null
            ? `${name} ${pct(split.quote)} · the coin's own move against ${qs}: not read — its trades have not been indexed yet`
            : `${name} ${pct(split.quote)} · the coin ${pct(split.coin)} against ${qs}${young ? " (since launch)" : ""} → ${pct(split.dollars)} in dollars`}
        </dd>
      </dl>
      <p className="dim">
        Holding this coin is holding {name}&apos;s price, times the coin&apos;s own price in {qs}. If {name} falls 10%, the coin&apos;s dollar value falls 10% with no
        trade at all — and the other way round.
        {stock ? " Coinbase's stock tokens are only for eligible persons outside the U.S." : ""}
      </p>
    </section>
  );
}
