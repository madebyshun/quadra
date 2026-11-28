import { useEffect, useMemo, useState } from "react";
import { baseStocks, spots, type BaseStock, type Spot } from "@/adapters/http/markets";
import { BASE, FLAGS, WETH } from "@/config/chain";
import { ROBINHOOD } from "@/config/routes";
import { assertChecksummedAddress, toChecksumAddress } from "@/lib/address";
import { readToken } from "@/lib/erc20";
import { messageOf } from "@/lib/errors";
import { compact, price } from "@/skills/format";
import { TRADE_CRYPTO } from "@/config/markets";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import { PlatinumSelect } from "@/ui/Select";
import { formatChange, Sparkline } from "@/features/markets/Chart";
import { useMarkets, type MarketRow } from "@/features/markets/MarketsProvider";
import { depth, thin } from "@/features/markets/Rows";
import { useOpenWindow } from "@/features/openWindow";
import { tokenWindowId } from "@/features/registry";

/**
 * The Markets window — live prices, 24h volume, 24h sparklines, pool depth, and Chainlink NAV
 * drift across Base crypto and tokenized stocks. Clicking any asset opens its own independent
 * Token window so users can view and trade multiple tokens simultaneously.
 */

/** A stock quote older than this is shown as stale — a price is a claim about a moment. */
export const STALE_MS = 10 * 60_000;

/** B20's pausable features, by number (docs.base.org, B20 "Pause Transfers"). */
export const B20_FEATURES = ["transfers", "minting", "burning", "seizing"] as const;

export function pausedText(paused: readonly number[]): string {
  return paused.length === 0 ? "nothing paused" : `paused: ${paused.map((f) => B20_FEATURES[f] ?? `feature ${f}`).join(", ")}`;
}

type KindFilter = "all" | "stocks" | "crypto";
type SortKey = "depth" | "volume" | "price" | "change" | "drift";

function driftPct(r: MarketRow): number | null {
  const nav = r.stock?.nav ?? null;
  if (r.price === null || nav === null || nav <= 0) return null;
  return ((r.price - nav) / nav) * 100;
}

const BASE_CRYPTO_DIRECTORY = [
  { address: WETH.address, symbol: "ETH", name: "Ether (WETH)" },
  ...TRADE_CRYPTO.map((t) => ({ address: t.address, symbol: t.symbol, name: t.name })),
] as const;

export function MarketsPanel() {
  const { rows, symbols, baseSymbols, baseCatalog, focus, select, add, remove, reset } = useMarkets();
  const openWindow = useOpenWindow();
  const [kind, setKind] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [dirLimit, setDirLimit] = useState(32);
  const [dirSpots, setDirSpots] = useState<Map<string, Spot>>(new Map());
  const [extraStocks, setExtraStocks] = useState<readonly BaseStock[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "depth", dir: -1 });
  const [stock, setStock] = useState("");
  const [baseStock, setBaseStock] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

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

  const openToken = (address: string | null, label: string) => {
    if (!address || !openWindow) return;
    openWindow(tokenWindowId(address, label));
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const val = (r: MarketRow): number | null => {
      if (sort.key === "depth") return r.depth;
      if (sort.key === "volume") return r.volume24h ?? null;
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
          r.address?.toLowerCase() === q
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

  // Pre-fetch DexScreener spots for crypto + full Base stock catalog so all live DEX stocks populate Price, Vol 24h, Change, and Liquidity.
  const preloadKey = useMemo(
    () => [...BASE_CRYPTO_DIRECTORY.map((c) => c.address.toLowerCase()), ...catalog.map((s) => s.address.toLowerCase())].join(","),
    [catalog],
  );
  useEffect(() => {
    let live = true;
    void spots("base", preloadKey.split(","))
      .then((found) => {
        if (!live) return;
        setDirSpots((prev) => {
          const next = new Map(prev);
          for (const [k, v] of found) next.set(k, v);
          return next;
        });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [preloadKey]);

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
    return all
      .filter(
        (item) =>
          !q ||
          item.ticker.toLowerCase().includes(q) ||
          item.symbol.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q) ||
          item.address.toLowerCase() === q,
      )
      .sort((a, b) => {
        const sa = dirSpots.get(a.address.toLowerCase());
        const sb = dirSpots.get(b.address.toLowerCase());
        const la = sa?.depth ?? -1;
        const lb = sb?.depth ?? -1;
        if (la !== lb) return lb - la;
        const pa = sa?.price ?? a.nav ?? -1;
        const pb = sb?.price ?? b.nav ?? -1;
        if (pa !== pb) return pb - pa;
        return a.symbol.localeCompare(b.symbol);
      });
  }, [catalog, kind, query, dirSpots]);

  const visibleDir = useMemo(() => directory.slice(0, dirLimit), [directory, dirLimit]);
  const missingVisibleKey = useMemo(
    () =>
      visibleDir
        .filter((d) => !dirSpots.has(d.address.toLowerCase()))
        .map((d) => d.address.toLowerCase())
        .join(","),
    [visibleDir, dirSpots],
  );
  useEffect(() => {
    if (!missingVisibleKey) return;
    let live = true;
    void spots("base", missingVisibleKey.split(","))
      .then((found) => {
        if (!live || found.size === 0) return;
        setDirSpots((prev) => {
          const next = new Map(prev);
          for (const [k, v] of found) next.set(k, v);
          return next;
        });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [missingVisibleKey]);

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

  return (
    <div className="stack">
      <header className="mk__hero">
        <div>
          <p className="mk__eyebrow">BASE 8453 / MARKETS</p>
          <h3 className="mk__title">Base Markets</h3>
          <p className="mk__sub">Live prices, 24h volume, sparklines, and liquidity across Base crypto and tokenized stocks. Click any asset to open its own trading window.</p>
        </div>
        <img className="feature-banner__art" src="/brand/banners/quadra-trade-depth.svg" width="160" height="120" alt="" />
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
              aria-pressed={focus === r.key}
              onClick={() => {
                select(r.key);
                openToken(r.address, r.label);
              }}
            >
              <strong>{r.label}</strong>
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
          {rows.length === 0 ? (
            <p className="panel__lede" style={{ padding: "12px" }}>
              The watchlist is empty. Add a Base stock or a Base token below, or reset it.
            </p>
          ) : filtered.length === 0 ? (
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
                    <button type="button" className="mk__sort" onClick={() => toggleSort("volume")}>
                      Vol 24h {arrow("volume")}
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
                      aria-selected={focus === r.key}
                      onClick={() => {
                        select(r.key);
                        openToken(r.address, r.label);
                      }}
                    >
                      <td className="mono dim">{idx + 1}</td>
                      <td>
                        <div className="mk__asset">
                          <span className="mk__asset-head">
                            <button
                              type="button"
                              className="mk__sort"
                              aria-pressed={focus === r.key}
                              onClick={(e) => {
                                e.stopPropagation();
                                select(r.key);
                                openToken(r.address, r.label);
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
                      <td className="num">{r.volume24h === null ? "—" : `$${compact(r.volume24h)}`}</td>
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
                          {r.address && openWindow ? (
                            <button
                              type="button"
                              className="chip"
                              onClick={(e) => {
                                e.stopPropagation();
                                select(r.key);
                                openToken(r.address, r.label);
                              }}
                            >
                              Trade
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="chip"
                            aria-label={`Remove ${r.label} from the watchlist`}
                            onClick={(e) => {
                              e.stopPropagation();
                              remove(r.key);
                            }}
                          >
                            Unwatch
                          </button>
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
                  <th className="num">Vol 24h</th>
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
                      onClick={() => openToken(item.address, item.ticker)}
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
                      <td className="num">{sp?.volume24h != null ? `$${compact(sp.volume24h)}` : <span className="dim">—</span>}</td>
                      <td className="num">{sp?.depth != null ? depth(sp.depth) : <span className="dim">—</span>}</td>
                      <td className="num">
                        <div className="mk__actions">
                          {openWindow ? (
                            <button
                              type="button"
                              className="chip"
                              onClick={(e) => {
                                e.stopPropagation();
                                openToken(item.address, item.ticker);
                              }}
                            >
                              Trade
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={isWatched ? "chip chip--mode" : "chip"}
                            aria-pressed={isWatched}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isWatched) {
                                const key = rows.find((r) => r.address?.toLowerCase() === item.address.toLowerCase())?.key;
                                if (key) remove(key);
                              } else if (item.kind === "stocks") {
                                add({ kind: "basestock", symbol: item.ticker });
                              } else {
                                add({ kind: "token", address: item.address, label: item.symbol });
                              }
                            }}
                          >
                            {isWatched ? "Unwatch" : "+ Watch"}
                          </button>
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
