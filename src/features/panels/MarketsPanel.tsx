import { useEffect, useMemo, useRef, useState } from "react";
import { baseStocks, candles, spots, type BaseStock, type Candle, type Range, type Spot } from "@/adapters/http/markets";
import { BASE, FLAGS, USDC, WETH } from "@/config/chain";
import { ROBINHOOD } from "@/config/routes";
import { assertChecksummedAddress, sameAddress, toChecksumAddress } from "@/lib/address";
import { readToken } from "@/lib/erc20";
import { messageOf } from "@/lib/errors";
import { explorer, price } from "@/skills/format";
import { THIN_MARKET_USD, TRADE_CRYPTO } from "@/config/markets";
import { row, type Report, type Row } from "@/skills/types";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import { PlatinumSelect } from "@/ui/Select";
import { useOptionalWalletSession } from "@/ui/WalletProvider";
import { ReportView } from "@/features/panels/ReportView";
import { StockHealth } from "@/features/panels/StockHealth";
import { SwapPanel, type Picked } from "@/features/panels/SwapPanel";
import { choiceFor } from "@/features/panels/TokenPicker";
import { formatChange, PriceChart, Sparkline } from "@/features/markets/Chart";
import { useMarkets, type MarketRow } from "@/features/markets/MarketsProvider";
import { depth, thin } from "@/features/markets/Rows";
import { useRunCommand } from "@/features/openWindow";

/**
 * The Markets window — rebuilt along Blue Agent's `/markets` structure (KPI strip, 24h trending
 * ticker, category filters, search, sortable dense market table with inline 24h sparklines,
 * DEX-vs-Chainlink NAV drift readout, and 1-click Trade/Check actions) in this app's Platinum +
 * Base cobalt visual identity.
 */

const RANGES: readonly Range[] = ["1D", "7D", "30D"];

/** A stock quote older than this is shown as stale — a price is a claim about a moment. */
export const STALE_MS = 10 * 60_000;

const UNLISTED = {
  token: "",
  basestock: "not named by Coinbase's list of stocks on Base",
  stock: "not named by Robinhood's list",
} as const;

const SOURCE = {
  token: null,
  basestock: "Coinbase Tokenized Stocks API",
  stock: "Robinhood Stock Token API",
} as const;

/** B20's pausable features, by number (docs.base.org, B20 "Pause Transfers"). */
export const B20_FEATURES = ["transfers", "minting", "burning", "seizing"] as const;

export function pausedText(paused: readonly number[]): string {
  return paused.length === 0 ? "nothing paused" : `paused: ${paused.map((f) => B20_FEATURES[f] ?? `feature ${f}`).join(", ")}`;
}

type KindFilter = "all" | "stocks" | "crypto";
type SortKey = "depth" | "price" | "change" | "drift";
type Side = "buy" | "sell";
type Counter = "USDC" | "ETH";

const COUNTER: Record<Counter, Picked> = {
  USDC: { choice: "USDC", address: "", symbol: "USDC" },
  ETH: { choice: "ETH", address: "", symbol: "ETH" },
};

function pickedOfRow(r: MarketRow): Picked | null {
  if (r.venue !== "base" || !r.address) return null;
  if (sameAddress(r.address, WETH.address)) return { choice: "ETH", address: "", symbol: "ETH" };
  const choice = choiceFor(r.address);
  return { choice, address: choice === "other" ? r.address : "", symbol: r.stock?.symbol ?? r.label };
}

function driftPct(r: MarketRow): number | null {
  const nav = r.stock?.nav ?? null;
  if (r.price === null || nav === null || nav <= 0) return null;
  return ((r.price - nav) / nav) * 100;
}

function details(r: MarketRow, now: number): Report {
  const chain = r.venue === "base" ? `${BASE.name} (${BASE.id})` : `${ROBINHOOD.name} (${ROBINHOOD.id})`;
  const link =
    r.address === null ? null : r.venue === "base" ? explorer.token(r.address) : `${ROBINHOOD.explorer}/token/${r.address}`;
  const q = r.quote;
  const kind = r.watch.kind;
  const b = r.stock;
  const rows: Row[] = [
    ...(r.name ? [row("Name", r.name)] : []),
    row(
      "Price",
      r.price === null
        ? "not available"
        : `${price(r.price)} — ${q ? "Robinhood's quote for the share (bid/ask mid)" : "its deepest DEX pair (DexScreener)"}`,
    ),
    row("24h change", `${formatChange(r.change)} — DexScreener`, r.change === null ? {} : { tone: r.change >= 0 ? "ok" : "warn" }),
    row(
      "Market depth",
      r.depth === null ? "not read" : `${depth(r.depth)} in the deepest pool${r.depth < THIN_MARKET_USD ? " — thin" : ""}`,
      thin(r) ? { tone: "warn" } : {},
    ),
    ...(b
      ? [
          row("Shares per token", `${b.multiplier} — one token is not always one share`, b.multiplier === 1 ? {} : { tone: "warn" }),
          row("Status", pausedText(b.paused), b.paused.length ? { tone: "bad" } : { tone: "ok" }),
          row(
            "Reference (NAV)",
            b.nav === null
              ? "not published"
              : `${price(b.nav)} per token — Chainlink, ${b.navAt ? b.navAt.toLocaleString() : "time not reported"}; not a trade price`,
          ),
        ]
      : []),
    row("Chain", chain),
    row("Contract", r.address === null ? UNLISTED[kind] : toChecksumAddress(r.address), link ? { href: link } : {}),
    ...(q
      ? [
          row("Bid / ask", `${price(q.bid)} / ${price(q.ask)}`),
          row("Day range", q.low === null || q.high === null ? "not reported" : `${price(q.low)} – ${price(q.high)}`),
          row("Status", q.halted ? "trading halted" : "trading", q.halted ? { tone: "bad" } : {}),
          row(
            "Quoted",
            `${q.at.toLocaleTimeString()}${now - q.at.getTime() > STALE_MS ? " — stale" : ""}`,
            now - q.at.getTime() > STALE_MS ? { tone: "warn" } : {},
          ),
        ]
      : []),
  ];
  return {
    title: r.label,
    rows,
    notes: [
      ...(r.problem ? [r.problem] : []),
      ...(thin(r) ? [`Under ${depth(THIN_MARKET_USD)} of liquidity: a small trade can move this price a long way, so read it as a rough figure.`] : []),
      ...(r.staleSeconds !== null
        ? [`The chart is this app's remembered copy, ${Math.round(r.staleSeconds / 60)} min old — GeckoTerminal is not answering right now.`]
        : []),
      ...(kind === "basestock"
        ? [
            "A Coinbase tokenized stock on Base (B20), identified by Coinbase's own list — never by a ticker on a DEX. Its price is its DEX market on Base, which can drift from the NAV. Coinbase tokenized stocks are only for persons in eligible jurisdictions outside the U.S.",
          ]
        : []),
      ...(q
        ? [
            "A stock's price is Robinhood's quote for the underlying share, not multiplied by the token's corporate-action multiplier. Its chart is trades of the token on Robinhood Chain, which can drift from the quote.",
          ]
        : []),
    ],
    sources: [SOURCE[kind], "DexScreener (price)", "GeckoTerminal via this app's server (chart)"].filter((s): s is string => s !== null),
  };
}

const BASE_CRYPTO_DIRECTORY = [
  { address: WETH.address, symbol: "ETH", name: "Ether (WETH)" },
  ...TRADE_CRYPTO.map((t) => ({ address: t.address, symbol: t.symbol, name: t.name })),
] as const;

export function MarketsPanel() {
  const { rows, symbols, baseSymbols, baseCatalog, focus, select, add, remove, reset } = useMarkets();
  const runCommand = useRunCommand();
  const walletSession = useOptionalWalletSession();
  const detailRef = useRef<HTMLElement | null>(null);
  const selected = rows.find((r) => r.key === focus) ?? rows[0] ?? null;
  const [side, setSide] = useState<Side>("buy");
  const [counter, setCounter] = useState<Counter>("USDC");
  const [range, setRange] = useState<Range>("1D");
  const [chart, setChart] = useState<{ key: string; range: Range; series: readonly Candle[] | string } | null>(null);
  const [kind, setKind] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [dirLimit, setDirLimit] = useState(24);
  const [dirSpots, setDirSpots] = useState<Map<string, Spot>>(new Map());
  const [extraStocks, setExtraStocks] = useState<readonly BaseStock[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "depth", dir: -1 });

  useEffect(() => {
    if (baseCatalog.length > 0) return;
    let live = true;
    void baseStocks()
      .then((m) => {
        if (live) setExtraStocks([...m.values()].sort((a, b) => a.ticker.localeCompare(b.ticker)));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [baseCatalog.length]);
  const [stock, setStock] = useState("");
  const [baseStock, setBaseStock] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const key = selected?.key ?? null;
  const venue = selected?.venue ?? null;
  const pool = selected?.pool ?? null;
  const address = selected?.address ?? null;
  useEffect(() => {
    if (key === null || range === "1D" || pool === null || address === null || venue === null) return;
    let live = true;
    candles(venue, pool, address, range).then(
      (c) => live && setChart({ key, range, series: c.candles }),
      (e: unknown) => live && setChart({ key, range, series: messageOf(e) }),
    );
    return () => {
      live = false;
    };
  }, [key, venue, pool, address, range]);

  const series: readonly Candle[] | string | null =
    selected === null
      ? null
      : range === "1D"
        ? (selected.series ?? selected.chartProblem)
        : chart?.key === selected.key && chart.range === range
          ? chart.series
          : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const val = (r: MarketRow): number | null => {
      if (sort.key === "depth") return r.depth;
      if (sort.key === "price") return r.price;
      if (sort.key === "change") return r.change;
      return driftPct(r);
    };
    return rows
      .filter((r) => {
        if (kind === "stocks") return r.watch.kind === "basestock" || r.watch.kind === "stock";
        if (kind === "crypto") return r.watch.kind === "token";
        return true;
      })
      .filter((r) => {
        if (!q) return true;
        return (
          r.label.toLowerCase().includes(q) ||
          (r.name?.toLowerCase().includes(q) ?? false) ||
          (r.address?.toLowerCase() === q)
        );
      })
      .sort((a, b) => {
        const x = val(a);
        const y = val(b);
        if (x === null && y === null) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        return (x - y) * sort.dir;
      });
  }, [rows, kind, query, sort]);

  const trending = useMemo(
    () =>
      [...rows]
        .filter((r) => r.price !== null)
        .sort((a, b) => (b.depth ?? -1) - (a.depth ?? -1))
        .slice(0, 8),
    [rows],
  );

  const catalog = baseCatalog.length > 0 ? baseCatalog : extraStocks;
  const allBaseSymbols = useMemo(
    () => (baseSymbols.length > 0 ? baseSymbols : catalog.map((s) => s.ticker).sort()),
    [baseSymbols, catalog],
  );
  const totalDepth = useMemo(() => rows.reduce((sum, r) => sum + (r.depth ?? 0), 0), [rows]);
  const stockCount = allBaseSymbols.length || rows.filter((r) => r.watch.kind === "basestock").length;

  const watchedAddrs = useMemo(() => new Set(rows.map((r) => r.address?.toLowerCase()).filter(Boolean)), [rows]);
  const directory = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cryptoItems = BASE_CRYPTO_DIRECTORY.map((c) => ({
      key: `dir:crypto:${c.address.toLowerCase()}`,
      kind: "crypto" as const,
      ticker: c.symbol,
      symbol: c.symbol,
      name: c.name,
      address: c.address,
      nav: null as number | null,
    }));
    const stockItems = catalog.map((s) => ({
      key: `dir:stock:${s.symbol}`,
      kind: "stocks" as const,
      ticker: s.ticker,
      symbol: s.symbol,
      name: s.name,
      address: s.address,
      nav: s.nav,
    }));
    const all = kind === "crypto" ? cryptoItems : kind === "stocks" ? stockItems : [...cryptoItems, ...stockItems];
    return all.filter(
      (item) =>
        !q ||
        item.ticker.toLowerCase().includes(q) ||
        item.symbol.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.address.toLowerCase() === q,
    );
  }, [catalog, kind, query]);

  const visibleDir = useMemo(() => directory.slice(0, dirLimit), [directory, dirLimit]);
  const visibleDirKey = useMemo(() => visibleDir.map((d) => d.address.toLowerCase()).join(","), [visibleDir]);
  useEffect(() => {
    if (!visibleDirKey) return;
    // prices are keyed by address, so a late answer for rows no longer shown is still right where it lands
    void spots("base", visibleDirKey.split(","))
      .then((found) =>
        setDirSpots((prev) => {
          const next = new Map(prev);
          for (const [k, v] of found) next.set(k, v);
          return next;
        }),
      )
      .catch(() => {});
  }, [visibleDirKey]);

  const toggleSort = (next: SortKey) =>
    setSort((cur) => ({ key: next, dir: cur.key === next ? (cur.dir === -1 ? 1 : -1) : -1 }));
  const arrow = (k: SortKey) => (sort.key === k ? (sort.dir === -1 ? "↓" : "↑") : "↕");

  const addToken = async () => {
    setError(null);
    try {
      const addr = toChecksumAddress(assertChecksummedAddress(token, "Token address"));
      const t = await readToken(addr);
      add({ kind: "token", address: addr, label: t.symbol });
      setToken("");
    } catch (e) {
      setError(messageOf(e));
    }
  };

  const selectedDrift = selected ? driftPct(selected) : null;

  return (
    <div className="stack">
      <header className="mk__hero">
        <div>
          <p className="mk__eyebrow">BASE 8453 / MARKETS</p>
          <h3 className="mk__title">The market never closes.</h3>
          <p className="mk__sub">Tokenized stocks and crypto on Base — live DEX pools, 24h sparklines, and Chainlink NAV drift.</p>
        </div>
        <dl className="mk__kpis">
          <div className="mk__kpi">
            <dt>Watchlist</dt>
            <dd>{rows.length}</dd>
          </div>
          <div className="mk__kpi">
            <dt>Base stocks</dt>
            <dd>{stockCount}</dd>
          </div>
          <div className="mk__kpi">
            <dt>Pool depth</dt>
            <dd>{totalDepth > 0 ? depth(totalDepth) : "—"}</dd>
          </div>
        </dl>
      </header>

      {trending.length > 0 ? (
        <div className="mk__strip" aria-label="24h active markets">
          <span className="mk__strip-tag">ACTIVE</span>
          {trending.map((r) => (
            <button
              key={`tr:${r.key}`}
              type="button"
              className="mk__pill"
              aria-pressed={selected?.key === r.key}
              onClick={() => select(r.key)}
            >
              <strong>{r.label}</strong>
              {/* the strip lists priced rows only */}
              <span>{price(r.price!)}</span>
              {r.change !== null ? <span className={r.change >= 0 ? "up" : "down"}>{formatChange(r.change)}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mk__toolbar">
        {(
          [
            ["all", "All"],
            ["stocks", "Stock tokens"],
            ["crypto", "Crypto"],
          ] as const
        ).map(([id, text]) => (
          <button key={id} type="button" className="chip chip--mode" aria-pressed={kind === id} onClick={() => setKind(id)}>
            {text}
          </button>
        ))}
        <input
          className="field mk__search"
          aria-label="Search markets"
          placeholder="Search ticker, name or 0x…"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="markets">
        <div className="mk__table-wrap" aria-label="Watchlist" role="region">
          {rows.length === 0 ? null : filtered.length === 0 ? (
            <p className="panel__lede" style={{ padding: "12px" }}>
              No markets match that filter.
            </p>
          ) : (
            <table className="mk__table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Market</th>
                  <th className="num">
                    <button type="button" className="mk__sort" onClick={() => toggleSort("price")}>
                      Price {arrow("price")}
                    </button>
                  </th>
                  <th className="num">
                    <button type="button" className="mk__sort" onClick={() => toggleSort("change")}>
                      24h Change {arrow("change")}
                    </button>
                  </th>
                  <th className="num">
                    <button type="button" className="mk__sort" onClick={() => toggleSort("depth")}>
                      Liquidity {arrow("depth")}
                    </button>
                  </th>
                  <th className="num">
                    <button type="button" className="mk__sort" onClick={() => toggleSort("drift")}>
                      Oracle Gap {arrow("drift")}
                    </button>
                  </th>
                  <th className="num">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, idx) => {
                  const isStock = r.watch.kind === "basestock" || r.watch.kind === "stock";
                  const gap = driftPct(r);
                  return (
                    <tr
                      key={r.key}
                      aria-selected={selected?.key === r.key}
                      onClick={() => select(r.key)}
                    >
                      <td className="mono dim">{idx + 1}</td>
                      <td>
                        <div className="mk__asset">
                          <span className="mk__asset-head">
                            <button
                              type="button"
                              className="mk__sort"
                              aria-pressed={selected?.key === r.key}
                              onClick={(e) => {
                                e.stopPropagation();
                                select(r.key);
                              }}
                            >
                              <strong>{r.label}</strong>
                            </button>
                            <span className="mk__tag">{isStock ? "STOCK" : "CRYPTO"}</span>
                          </span>
                          <small className="dim">{r.name ?? (r.venue === "base" ? BASE.name : ROBINHOOD.name)}</small>
                        </div>
                      </td>
                      <td
                        className={`num${thin(r) ? " gadget__px--thin" : ""}`}
                        title={r.depth !== null ? `Pool liquidity: ${depth(r.depth)}` : undefined}
                      >
                        {r.price === null ? "—" : price(r.price)}
                      </td>
                      <td className="num">
                        <div className="mk__chg-cell">
                          <span className={r.change === null ? "dim" : r.change >= 0 ? "up" : "down"}>{formatChange(r.change)}</span>
                          {r.series ? <Sparkline series={r.series} label={`${r.label}, last 24 hours`} /> : <span className="spark--none">—</span>}
                        </div>
                      </td>
                      <td className="num">{r.depth === null ? "—" : depth(r.depth)}</td>
                      <td className="num">
                        {gap === null ? (
                          <span className="dim">—</span>
                        ) : (
                          <span className={gap >= 0 ? "up" : "down"}>
                            {gap >= 0 ? "+" : ""}
                            {gap.toFixed(2)}%
                          </span>
                        )}
                      </td>
                      <td className="num">
                        <div className="mk__actions">
                          {runCommand && r.address ? (
                            <>
                              <button
                                type="button"
                                className="chip chip--mode"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  select(r.key);
                                  detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                                }}
                              >
                                Trade
                              </button>
                              <button
                                type="button"
                                className="chip"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  runCommand(`verdict ${r.address}`);
                                }}
                              >
                                Check
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="chip"
                              aria-pressed={selected?.key === r.key}
                              onClick={(e) => {
                                e.stopPropagation();
                                select(r.key);
                              }}
                            >
                              Inspect
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <section className="stack" aria-label="All Base markets">
          <div className="mk__dir-head">
            <h3>Base Directory ({directory.length})</h3>
            <span className="mono dim">
              {BASE_CRYPTO_DIRECTORY.length} crypto · {catalog.length} stocks
            </span>
          </div>
          <div className="mk__table-wrap">
            <table className="mk__table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th className="num">Price</th>
                  <th className="num">24h Change</th>
                  <th className="num">Liquidity</th>
                  <th className="num">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleDir.map((item) => {
                  const isWatched = watchedAddrs.has(item.address.toLowerCase());
                  const sp = dirSpots.get(item.address.toLowerCase()) ?? null;
                  const livePrice = sp?.price ?? item.nav;
                  return (
                    <tr
                      key={item.key}
                      onClick={() => {
                        if (item.kind === "stocks") add({ kind: "basestock", symbol: item.ticker });
                        else add({ kind: "token", address: item.address, label: item.symbol });
                      }}
                    >
                      <td>
                        <div className="mk__asset">
                          <span className="mk__asset-head">
                            <strong>{item.symbol}</strong>
                            <span className="mk__tag">{item.kind === "stocks" ? "STOCK" : "CRYPTO"}</span>
                          </span>
                          <small className="dim">{item.name}</small>
                        </div>
                      </td>
                      <td className="num">{livePrice !== null ? price(livePrice) : <span className="dim">—</span>}</td>
                      <td className="num">
                        {sp?.change != null ? (
                          <span className={sp.change >= 0 ? "up" : "down"}>{formatChange(sp.change)}</span>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                      <td className="num">{sp?.depth != null ? depth(sp.depth) : <span className="dim">—</span>}</td>
                      <td className="num">
                        <div className="mk__actions">
                          <button
                            type="button"
                            className="chip"
                            disabled={isWatched}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (item.kind === "stocks") add({ kind: "basestock", symbol: item.ticker });
                              else add({ kind: "token", address: item.address, label: item.symbol });
                            }}
                          >
                            {isWatched ? "Watching" : "+ Watch"}
                          </button>
                          {runCommand ? (
                            <>
                              <button
                                type="button"
                                className="chip chip--mode"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (item.kind === "stocks") add({ kind: "basestock", symbol: item.ticker });
                                  else add({ kind: "token", address: item.address, label: item.symbol });
                                  setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
                                }}
                              >
                                Trade
                              </button>
                              <button
                                type="button"
                                className="chip"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  runCommand(`verdict ${item.address}`);
                                }}
                              >
                                Check
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {directory.length > dirLimit ? (
              <div className="mk__more">
                <Gel quiet onClick={() => setDirLimit((n) => n + 40)}>
                  Show more ({Math.min(dirLimit, directory.length)} / {directory.length})
                </Gel>
              </div>
            ) : null}
          </div>
        </section>

        {selected === null ? (
          <p className="panel__lede">The watchlist is empty. Add a Base stock or a Base token below, or reset it.</p>
        ) : (() => {
          const picked = pickedOfRow(selected);
          const counters = (["USDC", "ETH"] as const).filter(
            (c) => !(picked && (c === "ETH" ? picked.choice === "ETH" : picked.choice === "USDC" || (selected.address !== null && sameAddress(selected.address, USDC.address)))),
          );
          const using: Counter = counters.includes(counter) ? counter : counters[0]!;
          const paused = selected.stock !== null && selected.stock.paused.includes(0);
          const canTrade = walletSession !== null && picked !== null;
          return (
          <section ref={detailRef} className="mk__detail" aria-label={`Selected market ${selected.label}`}>
            <div className="mk__detail-head">
              <div>
                <h3 className="mk__detail-title">
                  {selected.label}
                  {selected.name ? ` — ${selected.name}` : ""}
                </h3>
                <span className="mono dim">
                  {selected.price !== null ? price(selected.price) : "—"} · 24h {formatChange(selected.change)}
                  {selected.depth !== null ? ` · depth ${depth(selected.depth)}` : ""}
                </span>
              </div>
              <div className="group__row group__row--actions" role="group" aria-label="Range" style={{ margin: 0 }}>
                {RANGES.map((r) => (
                  <button key={r} type="button" className="chip chip--mode" aria-pressed={r === range} onClick={() => setRange(r)}>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {selectedDrift !== null && selected.stock?.nav != null ? (
              <div className="mk__drift">
                <span>
                  DEX vs Chainlink NAV ({price(selected.stock.nav)}):{" "}
                  <strong className={selectedDrift >= 0 ? "up" : "down"}>
                    {selectedDrift >= 0 ? "+" : ""}
                    {selectedDrift.toFixed(2)}% ({selectedDrift >= 0 ? "premium" : "discount"})
                  </strong>
                </span>
                {runCommand && selected.address ? (
                  <div className="mk__actions">
                    <button type="button" className="chip" onClick={() => runCommand(`depth ${selected.address}`)}>
                      Price impact
                    </button>
                    <button type="button" className="chip" onClick={() => runCommand(`verdict ${selected.address}`)}>
                      Token Verdict
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className={canTrade ? "mk__detail-grid" : "stack"}>
              <div className="stack">
                {typeof series === "string" ? (
                  <Crt label="Chart unavailable">
                    <span className="crt__amber">{series}</span>
                  </Crt>
                ) : series === null ? (
                  <p className="dim">Reading the chart…</p>
                ) : (
                  <PriceChart series={series} label={`${selected.label}, ${range}`} format={price} />
                )}

                <ReportView report={details(selected, Date.now())} />
                <Gel quiet onClick={() => remove(selected.key)}>
                  Remove {selected.label} from the watchlist
                </Gel>
              </div>

              {canTrade ? (
                <aside className="mk__trade-box" aria-label={`Trade ${selected.label}`}>
                  <h4 className="mk__trade-title">Trade {selected.label} on {BASE.name}</h4>
                  {selected.stock ? <StockHealth key={selected.stock.address} stock={selected.stock} /> : null}
                  {paused ? (
                    <Crt label="Trading paused">
                      <span className="crt__amber">
                        {selected.label}&apos;s transfers are paused on its token contract, so nothing can be bought or sold until its issuer unpauses them.
                      </span>
                    </Crt>
                  ) : (
                    <>
                      <div className="group__row group__row--actions" role="group" aria-label="Side" style={{ marginBottom: 0 }}>
                        {(["buy", "sell"] as const).map((s) => (
                          <button key={s} type="button" className="chip chip--mode" aria-pressed={side === s} onClick={() => setSide(s)}>
                            {s === "buy" ? `Buy ${selected.label}` : `Sell ${selected.label}`}
                          </button>
                        ))}
                        <span className="trade__sep">{side === "buy" ? "pay with" : "receive"}</span>
                        <span role="group" aria-label={side === "buy" ? "Pay with" : "Receive"} className="trade__counters">
                          {counters.map((c) => (
                            <button key={c} type="button" className="chip chip--mode" aria-pressed={using === c} onClick={() => setCounter(c)}>
                              {c}
                            </button>
                          ))}
                        </span>
                      </div>
                      <SwapPanel
                        key={`${selected.key}:${side}:${using}`}
                        fixed={side === "buy" ? { sell: COUNTER[using], buy: picked } : { sell: picked, buy: COUNTER[using] }}
                      />
                    </>
                  )}
                </aside>
              ) : null}
            </div>
          </section>
          );
        })()}
      </div>

      <fieldset className="group">
        <legend>Add to the watchlist</legend>
        <div className="group__row">
          <span>Base stock</span>
          <PlatinumSelect
            ariaLabel="Base stock"
            value={baseStock}
            onChange={setBaseStock}
            options={[
              { value: "", label: allBaseSymbols.length ? "Pick a Coinbase stock on Base…" : "Coinbase's list is not loaded" },
              ...allBaseSymbols.map((s) => ({ value: s, label: s })),
            ]}
          />
          <Gel onClick={() => (add({ kind: "basestock", symbol: baseStock }), setBaseStock(""))} disabled={baseStock === ""}>
            Add
          </Gel>
        </div>
        <label className="group__row">
          <span>Base token</span>
          <input
            className="field"
            aria-label="Base token address"
            placeholder="0x…"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <Gel onClick={() => void addToken()} disabled={token.trim() === ""}>
            Add
          </Gel>
        </label>
        {FLAGS.robinhood ? (
          <div className="group__row">
            <span>Robinhood stock</span>
            <PlatinumSelect
              ariaLabel="Robinhood stock"
              value={stock}
              onChange={setStock}
              options={[
                { value: "", label: symbols.length ? "Pick one of Robinhood's stock tokens…" : "Robinhood's list is not loaded" },
                ...symbols.map((s) => ({ value: s, label: s })),
              ]}
            />
            <Gel onClick={() => (add({ kind: "stock", symbol: stock }), setStock(""))} disabled={stock === ""}>
              Add
            </Gel>
          </div>
        ) : null}
        <Gel quiet onClick={reset}>
          Reset to the default list
        </Gel>
      </fieldset>
      {error ? (
        <Crt label="Markets error">
          <span className="crt__amber">{error}</span>
        </Crt>
      ) : null}
    </div>
  );
}
