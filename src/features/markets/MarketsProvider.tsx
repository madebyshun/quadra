import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { baseStocks, candles, stockQuotes, spots, type BaseStock, type Candle, type Spot, type StockQuote } from "@/adapters/http/markets";
import { DEFAULT_WATCH, venueOf, watchKey, type Venue, type Watch } from "@/config/markets";
import { messageOf } from "@/lib/errors";
import { loadWatch, saveWatch } from "@/lib/watchlist";
import { FLAGS } from "@/config/chain";

/**
 * One set of prices for the whole page — the desktop gadget and the Markets window read the
 * same rows, so they cannot disagree and the page asks each source once per refresh.
 *
 * Two passes per refresh, deliberately separate: PRICES first (DexScreener, one request per
 * chain, plus Robinhood's quotes and Coinbase's stock list), then CHARTS one at a time through
 * this app's caching server. A chart that cannot be had no longer takes the price down with
 * it — MEASURED 2026-09-30, when GeckoTerminal rate-limited this machine and every row of the
 * owner's gadget read "—" and "unavailable" at once.
 */

export type MarketRow = {
  readonly key: string;
  readonly watch: Watch;
  readonly label: string;
  readonly venue: Venue;
  /** the contract priced — `null` for a stock its list does not (yet) name */
  readonly address: string | null;
  /** a token: its deepest DEX pair; a Robinhood stock: Robinhood's mid quote for the share */
  readonly price: number | null;
  /** percent over 24 hours, from DexScreener */
  readonly change: number | null;
  readonly series: readonly Candle[] | null;
  /** seconds old, when the server served a remembered chart because GeckoTerminal would not answer */
  readonly staleSeconds: number | null;
  /** USD liquidity of that pair — `null` until read */
  readonly depth: number | null;
  /** the pair's address, where charts are read — `null` until read */
  readonly pool: string | null;
  /** the company, for a stock on either chain; `null` for a plain token */
  readonly name: string | null;
  readonly quote: StockQuote | null;
  /** Coinbase's record for a stock on Base: multiplier, paused features, NAV */
  readonly stock: BaseStock | null;
  /** why the price is missing, in words — never a blank */
  readonly problem: string | null;
  /** why the chart is missing — `null` while it is still being read */
  readonly chartProblem: string | null;
};

export type Markets = {
  readonly rows: readonly MarketRow[];
  /** every stock symbol Robinhood's API currently quotes, for "add a Robinhood stock" */
  readonly symbols: readonly string[];
  /** every stock Coinbase lists on Base, for "add a Base stock" */
  readonly baseSymbols: readonly string[];
  readonly updatedAt: Date | null;
  readonly focus: string | null;
  /** from the desktop: select an asset and open the Markets window on it */
  pick(key: string): void;
  select(key: string): void;
  add(w: Watch): void;
  remove(key: string): void;
  reset(): void;
};

/**
 * How often prices are read again. Prices cost one DexScreener request per chain (300 a minute
 * allowed); charts go through the server's cache, which asks GeckoTerminal at most every two
 * minutes per pool whatever this interval is.
 */
export const REFRESH_MS = 60_000;

const Ctx = createContext<Markets | null>(null);

export function useMarkets(): Markets {
  const m = useContext(Ctx);
  if (m === null) throw new Error("useMarkets() must be called inside <MarketsProvider>");
  return m;
}

type Priced = { readonly address: string | null; readonly spot: Spot | null; readonly problem: string | null };
type Charted = { readonly candles: readonly Candle[]; readonly staleSeconds: number | null } | string;

export function MarketsProvider({ children, onOpen }: { children: ReactNode; onOpen: () => void }) {
  const [saved, setWatch] = useState<Watch[]>(() => loadWatch());
  // Robinhood Chain is hidden (FLAGS.robinhood): its entries stay SAVED, but are neither shown nor fetched
  const watch = useMemo(() => (FLAGS.robinhood ? saved : saved.filter((w) => w.kind !== "stock")), [saved]);
  const [quotes, setQuotes] = useState<Map<string, StockQuote> | null>(null);
  const [stocksOnBase, setStocksOnBase] = useState<Map<string, BaseStock> | null>(null);
  const [priced, setPriced] = useState<Record<string, Priced>>({});
  const [charts, setCharts] = useState<Record<string, Charted>>({});
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  /** the last quotes that arrived, so one failed refresh does not blank every stock */
  const lastQuotes = useRef<Map<string, StockQuote> | null>(null);
  /** bumped per refresh: a chart pass from an older refresh stops instead of writing over a newer one */
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const run = ++generation.current;
    let catalog: Map<string, BaseStock> | null = null;
    let catalogProblem: string | null = null;
    let quotesProblem: string | null = null;
    const [c, q] = await Promise.allSettled([
      watch.some((w) => w.kind === "basestock") ? baseStocks() : Promise.resolve(null),
      watch.some((w) => w.kind === "stock") ? stockQuotes() : Promise.resolve(null),
    ]);
    if (c.status === "fulfilled") {
      catalog = c.value;
      if (catalog) setStocksOnBase(catalog);
    } else catalogProblem = messageOf(c.reason);
    if (q.status === "fulfilled") {
      if (q.value) {
        lastQuotes.current = q.value;
        setQuotes(q.value);
      }
    } else quotesProblem = messageOf(q.reason);

    const addressOf = (w: Watch): Priced => {
      if (w.kind === "token") return { address: w.address, spot: null, problem: null };
      if (w.kind === "basestock") {
        const listed = catalog?.get(w.symbol)?.address;
        return listed
          ? { address: listed, spot: null, problem: null }
          : { address: null, spot: null, problem: catalogProblem ?? `Coinbase's list of stocks on Base does not name ${w.symbol}.` };
      }
      const listed = lastQuotes.current?.get(w.symbol)?.address;
      return listed
        ? { address: listed, spot: null, problem: null }
        : { address: null, spot: null, problem: quotesProblem ?? `Robinhood's stock token list does not name ${w.symbol}.` };
    };
    const resolved = watch.map((w) => [w, addressOf(w)] as const);

    const venues: Venue[] = ["base", "robinhood"];
    const read = await Promise.all(
      venues.map(async (venue): Promise<[Venue, Map<string, Spot> | string]> => {
        const addresses = resolved.filter(([w, p]) => venueOf(w) === venue && p.address !== null).map(([, p]) => p.address!);
        if (addresses.length === 0) return [venue, new Map()];
        try {
          return [venue, await spots(venue, addresses)];
        } catch (e) {
          return [venue, messageOf(e)];
        }
      }),
    );
    if (run !== generation.current) return;
    const byVenue = new Map(read);
    const next: Record<string, Priced> = {};
    for (const [w, p] of resolved) {
      if (p.address === null) {
        next[watchKey(w)] = p;
        continue;
      }
      const found = byVenue.get(venueOf(w))!;
      next[watchKey(w)] =
        typeof found === "string"
          ? { address: p.address, spot: null, problem: found }
          : { address: p.address, spot: found.get(p.address.toLowerCase()) ?? null, problem: found.has(p.address.toLowerCase()) ? null : "No DEX market for it was found on DexScreener." };
    }
    setPriced(next);
    setUpdatedAt(new Date());

    // charts, one at a time, so a page of charts never arrives upstream as one burst
    for (const [w] of resolved) {
      const key = watchKey(w);
      const p = next[key]!;
      if (!p.spot) continue;
      let chart: Charted;
      try {
        chart = await candles(venueOf(w), p.spot.pool, p.address!, "1D");
      } catch (e) {
        chart = messageOf(e);
      }
      if (run !== generation.current) return;
      setCharts((prev) => ({
        ...prev,
        // a failed read keeps the last chart it replaces, rather than blanking it
        [key]: typeof chart === "string" && typeof prev[key] === "object" ? prev[key]! : chart,
      }));
    }
  }, [watch]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      clearInterval(id);
      generation.current++;
    };
  }, [refresh]);

  const update = useCallback((next: Watch[]) => {
    setWatch(next);
    saveWatch(next);
  }, []);

  const rows = useMemo(
    () =>
      watch
        .map((w): MarketRow => {
          const key = watchKey(w);
          const p = priced[key];
          const spot = p?.spot ?? null;
          const chart = charts[key];
          const series = typeof chart === "object" ? chart.candles : null;
          const quote = w.kind === "stock" ? (quotes?.get(w.symbol) ?? null) : null;
          const stock = w.kind === "basestock" ? (stocksOnBase?.get(w.symbol) ?? null) : null;
          return {
            key,
            watch: w,
            label: w.kind === "token" ? w.label : w.symbol,
            venue: venueOf(w),
            address: p?.address ?? (w.kind === "token" ? w.address : (stock?.address ?? quote?.address ?? null)),
            // a Robinhood stock's price is Robinhood's quote for the share, never its DEX trade
            price: w.kind === "stock" ? (quote?.mid ?? null) : (spot?.price ?? null),
            change: spot?.change ?? null,
            series,
            staleSeconds: typeof chart === "object" ? chart.staleSeconds : null,
            depth: spot?.depth ?? null,
            pool: spot?.pool ?? null,
            name: stock?.name ?? null,
            quote,
            stock,
            problem: p?.problem ?? null,
            // a row priced with no market carries its reason, which is also why it has no chart
            chartProblem: typeof chart === "string" ? chart : p && !spot ? p.problem : null,
          };
        })
        // Base first, Robinhood Chain after — each in the order the user added it
        .sort((a, b) => (a.venue === b.venue ? 0 : a.venue === "base" ? -1 : 1)),
    [watch, priced, charts, quotes, stocksOnBase],
  );

  const value = useMemo(
    (): Markets => ({
      rows,
      symbols: quotes ? [...quotes.keys()].sort() : [],
      baseSymbols: stocksOnBase ? [...stocksOnBase.keys()].sort() : [],
      updatedAt,
      focus,
      pick: (key) => {
        setFocus(key);
        onOpen();
      },
      select: setFocus,
      add: (w) => {
        // add and remove work on the SAVED list, so a hidden Robinhood entry is never dropped by an edit
        if (!saved.some((x) => watchKey(x) === watchKey(w))) update([...saved, w]);
        setFocus(watchKey(w));
      },
      remove: (key) => update(saved.filter((w) => watchKey(w) !== key)),
      reset: () => update([...DEFAULT_WATCH]),
    }),
    [rows, quotes, stocksOnBase, updatedAt, focus, onOpen, saved, update],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
