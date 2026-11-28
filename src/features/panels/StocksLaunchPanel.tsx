import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { baseStocks, spots, type BaseStock, type Spot } from "@/adapters/http/markets";
import { launchFactory, launchPairs, type Pair } from "@/adapters/http/launchpad";
import { messageOf } from "@/lib/errors";
import { compact, usd } from "@/skills/format";
import { useOpenWindow } from "@/features/openWindow";
import { tokenWindowId } from "@/features/registry";
import { Gel } from "@/ui/Gel";
import { RESTRICTED_TEXT, useStocksClosed } from "@/lib/region";

type CategoryId =
  | "all"
  | "big-tech"
  | "ai-chips"
  | "crypto"
  | "space-defense"
  | "finance"
  | "consumer"
  | "media"
  | "energy"
  | "cloud"
  | "health"
  | "mobility"
  | "industrials";

type CategoryDef = {
  readonly id: Exclude<CategoryId, "all">;
  readonly label: string;
  readonly tickers: readonly string[];
};

const CATEGORIES: readonly CategoryDef[] = [
  { id: "big-tech", label: "Big tech", tickers: ["AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "NVDA", "TSLA"] },
  { id: "ai-chips", label: "AI & chips", tickers: ["NVDA", "AMD", "AVGO", "INTC", "MU", "TSM", "ARM", "ASML", "QCOM", "SMCI", "PLTR", "AI", "SNDK", "MRVL", "KLAC", "LRCX", "AMAT", "TXN", "ON", "ANET", "ANT"] },
  { id: "crypto", label: "Crypto economy", tickers: ["COIN", "MSTR", "HOOD", "CRCL", "MARA", "RIOT", "CLSK", "IREN", "CORZ", "HUT", "BITF", "WULF", "GLXY", "SQ", "XYZ", "PYPL"] },
  { id: "space-defense", label: "Space & defense", tickers: ["SPCX", "RKLB", "ASTS", "PLTR", "LMT", "RTX", "NOC", "GD", "BA", "LUNR", "KTOS", "AVAV", "AXON"] },
  { id: "cloud", label: "Cloud & software", tickers: ["MSFT", "ORCL", "CRM", "NOW", "SNOW", "DDOG", "NET", "CRWD", "PANW", "ZS", "FTNT", "SHOP", "ADBE", "INTU", "WDAY", "MDB", "TEAM", "APP", "U", "FIG"] },
  { id: "finance", label: "Finance & fintech", tickers: ["JPM", "BAC", "GS", "MS", "V", "MA", "AXP", "BLK", "SCHW", "SOFI", "NU", "AFRM", "UPST", "IBKR", "C", "WFC", "BRK", "SPGI", "ICE", "CME"] },
  { id: "consumer", label: "Consumer & retail", tickers: ["AMZN", "WMT", "COST", "TGT", "HD", "LOW", "NKE", "MCD", "SBUX", "KO", "PEP", "PG", "CMG", "CAVA", "LULU", "DECK", "ONON", "CELH", "ELF", "UBER", "ABNB", "DASH"] },
  { id: "media", label: "Media & gaming", tickers: ["NFLX", "DIS", "SPOT", "TTWO", "EA", "RBLX", "DKNG", "RDDT", "PINS", "SNAP", "SONY", "WBD", "ROKU", "TKO", "LYV"] },
  { id: "energy", label: "Energy & power", tickers: ["XOM", "CVX", "COP", "OXY", "SLB", "VST", "CEG", "NEE", "GEV", "OKLO", "SMR", "CCJ", "UEC", "FSLR", "ENPH", "ET", "KMI"] },
  { id: "mobility", label: "Future mobility", tickers: ["TSLA", "UBER", "LYFT", "RIVN", "LCID", "F", "GM", "TM", "JOBY", "ACHR", "AUR", "QS", "XPEV", "NIO", "LI", "BYD"] },
  { id: "health", label: "Health & biotech", tickers: ["LLY", "NVO", "UNH", "JNJ", "ABBV", "MRK", "PFE", "TMO", "ABT", "ISRG", "AMGN", "GILD", "VRTX", "REGN", "HIMS", "CRSP", "TEM", "DXCM", "PODD", "OSCR"] },
  { id: "industrials", label: "Industrials", tickers: ["CAT", "DE", "GE", "HON", "UNP", "UPS", "FDX", "ETN", "PH", "EMR", "PWR", "VRT", "WM", "RSG", "MMM", "URI"] },
];

const TICKER_TO_CATS = (() => {
  const map = new Map<string, Set<Exclude<CategoryId, "all">>>();
  for (const cat of CATEGORIES) {
    for (const t of cat.tickers) {
      const set = map.get(t) ?? new Set<Exclude<CategoryId, "all">>();
      set.add(cat.id);
      map.set(t, set);
    }
  }
  return map;
})();

export function categoriesOf(stock: BaseStock): readonly Exclude<CategoryId, "all">[] {
  const exact = TICKER_TO_CATS.get(stock.ticker.toUpperCase());
  if (exact) return [...exact];
  const n = stock.name.toLowerCase();
  const out: Exclude<CategoryId, "all">[] = [];
  if (/\b(semiconductor|chip|ai |artificial|nvidia|micro|memory)\b/.test(n)) out.push("ai-chips");
  if (/\b(crypto|bitcoin|blockchain|mining)\b/.test(n)) out.push("crypto");
  if (/\b(aerospace|defense|space|rocket|satellite)\b/.test(n)) out.push("space-defense");
  if (/\b(cloud|software|cyber|data|systems|technologies)\b/.test(n)) out.push("cloud");
  if (/\b(bank|financial|capital|insurance|payments|holdings)\b/.test(n)) out.push("finance");
  if (/\b(energy|oil|gas|power|nuclear|solar|electric|utilities)\b/.test(n)) out.push("energy");
  if (/\b(pharma|bio|health|medical|therapeutics|sciences|care)\b/.test(n)) out.push("health");
  if (/\b(auto|motor|vehicle|aviation|airlines|mobility)\b/.test(n)) out.push("mobility");
  if (/\b(media|entertainment|gaming|music|streaming|communications)\b/.test(n)) out.push("media");
  if (/\b(industrial|manufacturing|machinery|logistics|rail|construction)\b/.test(n)) out.push("industrials");
  if (out.length === 0) out.push("consumer");
  return out;
}

type FilterMode = "all" | "launch-ready" | "liq-5k";
type SortMode = "liquidity" | "volume" | "price" | "az";
type ViewMode = "grid" | "list";

export function StocksLaunchPanel() {
  const [params, setParams] = useSearchParams();
  const openWindow = useOpenWindow();
  const closed = useStocksClosed();
  const pinned = launchFactory();
  const factoryAt = "address" in pinned ? pinned.address : null;

  const [stocks, setStocks] = useState<readonly BaseStock[] | "reading" | { readonly problem: string }>("reading");
  const [spotMap, setSpotMap] = useState<Map<string, Spot>>(new Map());
  const [launchReady, setLaunchReady] = useState<ReadonlyMap<string, Pair>>(new Map());

  const [category, setCategory] = useState<CategoryId>("all");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("liquidity");
  const [view, setView] = useState<ViewMode>("grid");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(48);

  const selectedTicker = params.get("s")?.trim().toUpperCase() || null;

  useEffect(() => {
    let live = true;
    setStocks("reading");
    baseStocks().then(
      async (catalog) => {
        const list = [...catalog.values()];
        if (!live) return;
        setStocks(list);
        const addrs = list.slice(0, 120).map((s) => s.address);
        spots("base", addrs)
          .then((m) => live && setSpotMap(m))
          .catch(() => {});
      },
      (e: unknown) => live && setStocks({ problem: messageOf(e) }),
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!factoryAt) return;
    let live = true;
    launchPairs(factoryAt)
      .then(({ pairs }) => {
        if (!live) return;
        const m = new Map<string, Pair>();
        for (const p of pairs) m.set(p.address.toLowerCase(), p);
        setLaunchReady(m);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [factoryAt]);

  const enriched = useMemo(() => {
    if (!Array.isArray(stocks)) return [];
    return stocks.map((s) => {
      const sp = spotMap.get(s.address.toLowerCase()) ?? null;
      const priceVal = sp?.price ?? s.nav ?? null;
      const liquidity = sp?.depth ?? 0;
      const volume24h = sp?.volume24h ?? 0;
      const ready = launchReady.has(s.address.toLowerCase());
      const cats = categoriesOf(s);
      return { stock: s, spot: sp, price: priceVal, liquidity, volume24h, change: sp?.change ?? null, ready, cats };
    });
  }, [stocks, spotMap, launchReady]);

  // If opened with a saved `?do=stocks&s=NVDA` link, open that stock's independent Token window and clear `s`.
  useEffect(() => {
    if (!selectedTicker || !openWindow || enriched.length === 0) return;
    const hit = enriched.find((x) => x.stock.ticker.toUpperCase() === selectedTicker || x.stock.symbol.toUpperCase() === selectedTicker);
    if (!hit) return;
    const next = new URLSearchParams(params);
    next.delete("s");
    setParams(next, { replace: true });
    openWindow(tokenWindowId(hit.stock.address, hit.stock.ticker));
  }, [selectedTicker, openWindow, enriched, params, setParams]);

  const openStockToken = (stock: BaseStock) => {
    openWindow?.(tokenWindowId(stock.address, stock.ticker));
  };

  const categoryCounts = useMemo(() => {
    const counts = new Map<Exclude<CategoryId, "all">, number>();
    for (const item of enriched) {
      for (const c of item.cats) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return counts;
  }, [enriched]);

  const totalLiquidity = useMemo(() => enriched.reduce((sum, x) => sum + x.liquidity, 0), [enriched]);
  const launchReadyCount = useMemo(() => enriched.filter((x) => x.ready).length, [enriched]);
  const liq5kCount = useMemo(() => enriched.filter((x) => x.liquidity >= 5_000).length, [enriched]);
  const maxLiq = useMemo(() => Math.max(1, ...enriched.map((x) => x.liquidity)), [enriched]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = enriched.filter((x) => {
      if (category !== "all" && !x.cats.includes(category)) return false;
      if (filter === "launch-ready" && !x.ready) return false;
      if (filter === "liq-5k" && x.liquidity < 5_000) return false;
      if (q) {
        const hay = `${x.stock.ticker} ${x.stock.symbol} ${x.stock.name} ${x.stock.address}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return out.sort((a, b) => {
      if (sort === "liquidity") return b.liquidity - a.liquidity || Number(b.ready) - Number(a.ready) || a.stock.ticker.localeCompare(b.stock.ticker);
      if (sort === "volume") return b.volume24h - a.volume24h || b.liquidity - a.liquidity || a.stock.ticker.localeCompare(b.stock.ticker);
      if (sort === "price") return (b.price ?? -1) - (a.price ?? -1);
      return a.stock.ticker.localeCompare(b.stock.ticker);
    });
  }, [enriched, category, filter, sort, query]);

  const visible = filtered.slice(0, limit);

  return (
    <div className="stack stocks-dir">
      <header className="stocks__hero">
        <div className="stocks__hero-copy">
          <span className="mk__eyebrow">BASE TOKENIZED STOCKS · LAUNCHPAD V3</span>
          <h3 className="stocks__hero-title">Stocks, minted as coins.</h3>
          <p className="stocks__hero-sub">
            Pick any tokenized stock on Base to trade in its own window, or launch a coin paired with it.
          </p>
        </div>
        <dl className="stocks__kpis" aria-label="Stocks launchpad summary">
          <div className="stocks__kpi">
            <dt>Listed stocks</dt>
            <dd>{Array.isArray(stocks) ? stocks.length.toLocaleString("en-US") : "…"}</dd>
          </div>
          <div className="stocks__kpi">
            <dt>On-chain liquidity</dt>
            <dd>{totalLiquidity > 0 ? `$${compact(totalLiquidity)}` : "…"}</dd>
          </div>
          <div className="stocks__kpi">
            <dt>Launch ready</dt>
            <dd>{launchReadyCount > 0 ? launchReadyCount : "…"}</dd>
          </div>
          <div className="stocks__kpi">
            <dt>Liquidity ≥ $5K</dt>
            <dd>{liq5kCount > 0 ? liq5kCount : "…"}</dd>
          </div>
        </dl>
      </header>

      {closed ? <p className="crt__amber">{RESTRICTED_TEXT}</p> : null}

      <section className="stack" aria-label="Categories">
        <div className="stocks__section-head">
          <h3>Categories</h3>
          {category !== "all" ? (
            <button type="button" className="chip" onClick={() => setCategory("all")}>
              Show all categories
            </button>
          ) : null}
        </div>
        <div className="stocks__cats">
          {CATEGORIES.map((c) => {
            const count = categoryCounts.get(c.id) ?? 0;
            return (
              <button
                key={c.id}
                type="button"
                className="stocks__cat"
                aria-pressed={category === c.id}
                onClick={() => {
                  setCategory(category === c.id ? "all" : c.id);
                  setLimit(48);
                }}
              >
                <strong>{c.label}</strong>
                <span className="dim mono">{count} stocks</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="stack" aria-label="All stocks">
        <div className="stocks__section-head">
          <h3>All stocks</h3>
          <span className="dim mono">{filtered.length} shown</span>
        </div>

        <div className="mk__toolbar stocks__toolbar">
          <div className="coins__seg" role="group" aria-label="Filter stocks">
            {(
              [
                ["all", `All ${enriched.length}`],
                ["launch-ready", `Launch ready ${launchReadyCount}`],
                ["liq-5k", `Liquidity ≥ $5K ${liq5kCount}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className="coins__seg-btn"
                aria-pressed={filter === id}
                onClick={() => {
                  setFilter(id);
                  setLimit(48);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="coins__seg" role="group" aria-label="Sort stocks">
            {(
              [
                ["liquidity", "Liquidity"],
                ["volume", "Vol 24h"],
                ["price", "Price"],
                ["az", "A–Z"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" className="coins__seg-btn" aria-pressed={sort === id} onClick={() => setSort(id)}>
                {label}
              </button>
            ))}
          </div>

          <input
            className="field mk__search"
            type="search"
            aria-label="Search stocks"
            placeholder="Search ticker, company, or 0x…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(48);
            }}
          />

          <div className="coins__seg" role="group" aria-label="View mode">
            {(
              [
                ["grid", "Grid"],
                ["list", "List"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" className="coins__seg-btn" aria-pressed={view === id} onClick={() => setView(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {stocks === "reading" ? (
          <p className="dim">Reading Coinbase&apos;s tokenized stocks on Base…</p>
        ) : "problem" in stocks ? (
          <p className="tx__warn">Could not read the stocks directory: {stocks.problem}</p>
        ) : visible.length === 0 ? (
          <p className="dim">No stock matches that filter.</p>
        ) : view === "grid" ? (
          <div className="stocks__grid" role="list" aria-label="Stocks grid">
            {visible.map((item, idx) => {
              const liqPct = item.liquidity > 0 ? Math.max(4, Math.min(100, Math.round((Math.log10(item.liquidity + 1) / Math.log10(maxLiq + 1)) * 100))) : 0;
              return (
                <article key={item.stock.address} className="stocks__card" role="listitem">
                  <div className="stocks__card-top">
                    <div className="stocks__card-id">
                      <button type="button" className="coins__name-btn" onClick={() => openStockToken(item.stock)}>
                        {item.stock.ticker}
                      </button>
                      <span className="dim">{item.stock.name}</span>
                    </div>
                    <span className="dim mono">#{idx + 1}</span>
                  </div>
                  <div className="stocks__card-nums">
                    <div>
                      <strong className="mono stocks__price">{item.price !== null ? usd(item.price) : "—"}</strong>
                      {item.change !== null ? (
                        <span className={`mono ${item.change >= 0 ? "up" : "down"}`}>
                          {" "}
                          {item.change >= 0 ? `+${item.change.toFixed(2)}%` : `${item.change.toFixed(2)}%`}
                        </span>
                      ) : null}
                    </div>
                    <div className="stocks__liq">
                      <span className="dim">Liq · Vol 24h</span>
                      <strong className="mono">
                        {item.liquidity > 0 ? `$${compact(item.liquidity)}` : "—"}
                        {item.volume24h > 0 ? ` · $${compact(item.volume24h)}` : ""}
                      </strong>
                    </div>
                  </div>
                  <div className="stocks__bar" aria-hidden="true">
                    <span style={{ width: `${liqPct}%` }} />
                  </div>
                  <div className="stocks__card-foot">
                    <button type="button" className="chip" onClick={() => openStockToken(item.stock)}>
                      Trade {item.stock.ticker}
                    </button>
                    {item.ready && openWindow ? (
                      <Gel disabled={closed} onClick={() => openWindow("launch", { pair: item.stock.address })}>
                        Launch with {item.stock.ticker}
                      </Gel>
                    ) : (
                      <span className="mono dim">{item.stock.symbol}</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="mk__table-wrap">
            <table className="mk__table" aria-label="Stocks table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Stock</th>
                  <th className="num">Price</th>
                  <th className="num">24h</th>
                  <th className="num">Vol 24h</th>
                  <th className="num">Liquidity</th>
                  <th className="num">Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item, idx) => (
                  <tr key={item.stock.address} onClick={() => openStockToken(item.stock)}>
                    <td className="mono dim">#{idx + 1}</td>
                    <td>
                      <button
                        type="button"
                        className="coins__name-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          openStockToken(item.stock);
                        }}
                      >
                        {item.stock.ticker}
                      </button>{" "}
                      <span className="dim">{item.stock.name}</span>
                    </td>
                    <td className="num">{item.price !== null ? usd(item.price) : "—"}</td>
                    <td className={`num ${item.change === null ? "dim" : item.change >= 0 ? "up" : "down"}`}>
                      {item.change === null ? "—" : `${item.change >= 0 ? "+" : ""}${item.change.toFixed(2)}%`}
                    </td>
                    <td className="num">{item.volume24h > 0 ? `$${compact(item.volume24h)}` : "—"}</td>
                    <td className="num">{item.liquidity > 0 ? `$${compact(item.liquidity)}` : "—"}</td>
                    <td className="num">
                      <div className="mk__actions">
                        <button
                          type="button"
                          className="chip"
                          onClick={(e) => {
                            e.stopPropagation();
                            openStockToken(item.stock);
                          }}
                        >
                          Trade {item.stock.ticker}
                        </button>
                        {item.ready && openWindow ? (
                          <button
                            type="button"
                            className="chip chip--mode"
                            disabled={closed}
                            onClick={(e) => {
                              e.stopPropagation();
                              openWindow("launch", { pair: item.stock.address });
                            }}
                          >
                            Launch
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length > visible.length ? (
          <div className="mk__more">
            <Gel className="gel--quiet" onClick={() => setLimit((n) => n + 48)}>
              Show more ({filtered.length - visible.length} remaining)
            </Gel>
          </div>
        ) : null}
      </section>
    </div>
  );
}
