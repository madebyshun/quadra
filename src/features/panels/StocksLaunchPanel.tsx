import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  baseStocks,
  candles,
  poolTrades,
  spots,
  type BaseStock,
  type Candle,
  type PoolTradeItem,
  type Range,
  type Spot,
} from "@/adapters/http/markets";
import { launchFactory, launchPairs, type Pair } from "@/adapters/http/launchpad";
import { BASE, UNISWAP_V4_POOL_MANAGER } from "@/config/chain";
import { messageOf } from "@/lib/errors";
import { topHolders, type Holding } from "@/skills/blockscout";
import { compact, explorer, price, short, tinyPrice, usd } from "@/skills/format";
import { tokenVerdict } from "@/skills/verdict";
import type { Report } from "@/skills/types";
import { useOpenWindow } from "@/features/openWindow";
import { CandleChart, formatChange, type ChartStyle } from "@/features/markets/Chart";
import { ContractAddress } from "@/features/panels/ContractAddress";
import { ReportView } from "@/features/panels/ReportView";
import { StockHealth } from "@/features/panels/StockHealth";
import { SwapPanel, type Picked } from "@/features/panels/SwapPanel";
import { choiceFor } from "@/features/panels/TokenPicker";
import { ago } from "@/features/panels/TokenPage";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import { useOptionalWalletSession } from "@/ui/WalletProvider";
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
type SortMode = "liquidity" | "price" | "az";
type ViewMode = "grid" | "list";
type Counter = "USDC" | "ETH";
type StockTab = "trades" | "holders" | "traders" | "pool";

const COUNTER: Record<Counter, Picked> = {
  USDC: { choice: "USDC", address: "", symbol: "USDC" },
  ETH: { choice: "ETH", address: "", symbol: "ETH" },
};

const STOCK_RANGES: readonly Range[] = ["1m", "5m", "15m", "1D", "7D", "30D"];

/** Dedicated Stock Detail & Trade page inside Stocks — mirrors CoinPage layout. */
function StockDetailPage({
  stock,
  initialSpot,
  launchReady,
  onBack,
}: {
  stock: BaseStock;
  initialSpot: Spot | null;
  launchReady: boolean;
  onBack: () => void;
}) {
  const openWindow = useOpenWindow();
  const walletSession = useOptionalWalletSession();
  const closed = useStocksClosed();
  const [spot, setSpot] = useState<Spot | null>(initialSpot);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [counter, setCounter] = useState<Counter>("USDC");
  const [chartStyle, setChartStyle] = useState<ChartStyle>("candles");
  const [range, setRange] = useState<Range>("15m");
  const [userPickedRange, setUserPickedRange] = useState(false);
  const [series, setSeries] = useState<readonly Candle[] | "reading" | null>("reading");
  const [tab, setTab] = useState<StockTab>("trades");
  const [tradeFilter, setTradeFilter] = useState<"all" | "buy" | "sell">("all");
  const [trades, setTrades] = useState<readonly PoolTradeItem[] | "reading">("reading");
  const [holders, setHolders] = useState<readonly Holding[] | "reading" | { readonly problem: string }>("reading");
  const [verdict, setVerdict] = useState<Report | "running" | { readonly problem: string } | null>(null);
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    let live = true;
    spots("base", [stock.address])
      .then((m) => {
        const found = m.get(stock.address.toLowerCase()) ?? null;
        if (live && found) setSpot(found);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [stock.address]);

  const pool = spot?.pool ?? null;

  useEffect(() => {
    if (!pool) {
      setSeries(null);
      return;
    }
    let live = true;
    setSeries("reading");
    const order: readonly Range[] = userPickedRange
      ? [range]
      : [range, ...(["1D", "7D", "30D"] as const).filter((r) => r !== range)];
    (async () => {
      for (const r of order) {
        try {
          const res = await candles("base", pool, stock.address, r);
          if (res.candles.length >= 2) return { list: res.candles, used: r };
        } catch {
          // try wider range
        }
      }
      return { list: [] as readonly Candle[], used: range };
    })().then(({ list, used }) => {
      if (!live) return;
      if (list.length >= 2 && used !== range) setRange(used);
      setSeries(list.length >= 2 ? list : null);
    });
    return () => {
      live = false;
    };
  }, [pool, stock.address, range, userPickedRange]);

  useEffect(() => {
    if (!pool) {
      setTrades([]);
      return;
    }
    let live = true;
    setTrades("reading");
    poolTrades("base", pool, stock.address).then(
      (list) => live && setTrades(list),
      () => live && setTrades([]),
    );
    return () => {
      live = false;
    };
  }, [pool, stock.address]);

  useEffect(() => {
    if (tab !== "holders") return;
    let live = true;
    setHolders("reading");
    topHolders(stock.address).then(
      (items) => live && setHolders(items),
      (e: unknown) => live && setHolders({ problem: messageOf(e) }),
    );
    return () => {
      live = false;
    };
  }, [tab, stock.address]);

  const livePrice = spot?.price ?? stock.nav ?? null;
  const nav = stock.nav;
  const drift = livePrice !== null && nav !== null && nav > 0 ? ((livePrice - nav) / nav) * 100 : null;
  const paused = stock.paused.includes(0);
  const choice = choiceFor(stock.address);
  const picked: Picked = { choice, address: choice === "other" ? stock.address : "", symbol: stock.symbol };

  const tradeList = Array.isArray(trades) ? trades : [];
  const filteredTrades = tradeList.filter((t) => tradeFilter === "all" || t.side === tradeFilter);

  const rankedTraders = useMemo(() => {
    const byWallet = new Map<string, { buys: number; sells: number; volUsd: number; tokens: number }>();
    for (const t of tradeList) {
      if (!t.trader) continue;
      const key = t.trader.toLowerCase();
      const cur = byWallet.get(key) ?? { buys: 0, sells: 0, volUsd: 0, tokens: 0 };
      const v = t.usd ?? 0;
      if (t.side === "buy") {
        cur.buys += 1;
        cur.tokens += t.tokens;
      } else {
        cur.sells += 1;
        cur.tokens -= t.tokens;
      }
      cur.volUsd += v;
      byWallet.set(key, cur);
    }
    return [...byWallet.entries()]
      .map(([wallet, s]) => ({ wallet, ...s }))
      .sort((a, b) => b.volUsd - a.volUsd || (b.buys + b.sells) - (a.buys + a.sells))
      .slice(0, 20);
  }, [tradeList]);

  const onVerdict = () => {
    setVerdict("running");
    tokenVerdict(stock.address, Date.now()).then(setVerdict, (e: unknown) => setVerdict({ problem: messageOf(e) }));
  };

  return (
    <div className="stack coin-page">
      <div className="coin__topbar">
        <div>
          <button type="button" className="chip" onClick={onBack}>
            ← All stocks
          </button>
        </div>
        <div className="coin__topbar-actions">
          <ContractAddress address={stock.address} />
          {launchReady && openWindow ? (
            <Gel className="gel--quiet" disabled={closed} onClick={() => openWindow("launch", { pair: stock.address })}>
              Launch with {stock.ticker}
            </Gel>
          ) : null}
          {walletSession && walletSession.wallet?.kind !== "ready" ? (
            <Gel className="gel--quiet" disabled={walletSession.busy} onClick={() => (openWindow ? openWindow("wallet") : void walletSession.connectInjected())}>
              Connect wallet
            </Gel>
          ) : null}
        </div>
      </div>

      <header className="coin__header">
        <p className="coin__head">
          <strong className="coin__hero-name">
            {stock.ticker} ({stock.symbol})
          </strong>
          <span className="coin__hero-meta">
            {" · "}
            {stock.name}
            {livePrice !== null ? ` · ${price(livePrice)}` : ""}
            {spot?.change != null ? ` · 24h ${formatChange(spot.change)}` : ""}
          </span>
        </p>
        <div className="coin__guarantees" aria-label="Stock facts">
          <span className="coin__badge">Coinbase Stock · Base 8453</span>
          <span className="coin__badge">multiplier {stock.multiplier}x</span>
          {nav !== null ? <span className="coin__badge">NAV {price(nav)}</span> : null}
          {launchReady ? <span className="coin__badge">v3 quote enabled</span> : null}
          {paused ? <span className="coin__badge coin__badge--warn">transfers paused</span> : null}
        </div>
      </header>

      {closed ? <p className="crt__amber">{RESTRICTED_TEXT}</p> : null}

      <div className="coin__layout">
        <div className="coin__side stack">
          <fieldset className="group coin__panel">
            <legend className="mk__trade-title">Trade {stock.ticker}</legend>
            <StockHealth key={stock.address} stock={stock} />
            {paused ? (
              <Crt label="Trading paused">
                <span className="crt__amber">
                  {stock.symbol}&apos;s transfers are paused on its token contract, so nothing can be bought or sold until its issuer unpauses them.
                </span>
              </Crt>
            ) : (
              <>
                <div className="coins__seg" role="group" aria-label="Side">
                  {(["buy", "sell"] as const).map((s) => (
                    <button key={s} type="button" className="coins__seg-btn" aria-pressed={side === s} onClick={() => setSide(s)}>
                      {s === "buy" ? `Buy ${stock.ticker}` : `Sell ${stock.ticker}`}
                    </button>
                  ))}
                </div>
                <div className="row" role="group" aria-label={side === "buy" ? "Pay with" : "Receive"}>
                  <span className="dim">{side === "buy" ? "Pay with" : "Receive"}</span>
                  {(["USDC", "ETH"] as const).map((c) => (
                    <button key={c} type="button" className="chip chip--mode" aria-pressed={counter === c} onClick={() => setCounter(c)}>
                      {c}
                    </button>
                  ))}
                </div>
                {walletSession ? (
                  <SwapPanel
                    key={`${stock.address}:${side}:${counter}`}
                    fixed={side === "buy" ? { sell: COUNTER[counter], buy: picked } : { sell: picked, buy: COUNTER[counter] }}
                  />
                ) : (
                  <p className="dim">Connect a wallet to trade {stock.symbol} on {BASE.name}.</p>
                )}
              </>
            )}
          </fieldset>

          <fieldset className="group coin__panel">
            <legend className="mk__trade-title">Token Verdict</legend>
            {verdict === null ? (
              <Gel className="gel--quiet" onClick={onVerdict}>
                Run a full verdict on {stock.ticker}
              </Gel>
            ) : verdict === "running" ? (
              <p className="dim">Simulating a buy and a sell, reading holders and contract controls…</p>
            ) : "problem" in verdict ? (
              <p className="tx__warn">The verdict could not run: {verdict.problem}</p>
            ) : (
              <ReportView report={verdict} />
            )}
          </fieldset>
        </div>

        <div className="coin__main stack">
          <div className="token__cards" aria-label="Numbers">
            <div className="token__card">
              <span className="token__label">Price</span>
              <strong>{livePrice !== null ? price(livePrice) : "—"}</strong>
              <span className="dim">{spot?.price != null ? "DEX spot" : "Chainlink NAV"}</span>
            </div>
            <div className="token__card">
              <span className="token__label">24h Change</span>
              <strong className={spot?.change == null ? "dim" : spot.change >= 0 ? "up" : "down"}>
                {formatChange(spot?.change ?? null)}
              </strong>
              <span className="dim">DexScreener</span>
            </div>
            <div className="token__card">
              <span className="token__label">Liquidity</span>
              <strong>{spot?.depth != null ? `$${compact(spot.depth)}` : "—"}</strong>
              <span className="dim">Deepest Base pool</span>
            </div>
            <div className="token__card">
              <span className="token__label">Chainlink NAV</span>
              <strong>{nav !== null ? price(nav) : "—"}</strong>
              <span className="dim">{stock.navAt ? stock.navAt.toLocaleDateString() : "reference"}</span>
            </div>
            <div className="token__card">
              <span className="token__label">Oracle Gap</span>
              <strong className={drift === null ? "dim" : drift >= 0 ? "up" : "down"}>
                {drift === null ? "—" : `${drift >= 0 ? "+" : ""}${drift.toFixed(2)}%`}
              </strong>
              <span className="dim">{drift === null ? "not read" : drift >= 0 ? "premium" : "discount"}</span>
            </div>
            <div className="token__card">
              <span className="token__label">Multiplier</span>
              <strong>{stock.multiplier}x</strong>
              <span className="dim">shares per token</span>
            </div>
          </div>

          <div className="coin__section">
            <div className="coin__chart-frame stack">
              <div className="coin__chart-bar">
                <div className="row" role="group" aria-label="Chart range">
                  {STOCK_RANGES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className="chip chip--mode"
                      aria-pressed={range === r}
                      onClick={() => {
                        setUserPickedRange(true);
                        setRange(r);
                      }}
                    >
                      {r}
                    </button>
                  ))}
                  <span className="dim">GeckoTerminal · USD</span>
                </div>
                <div className="coins__seg" role="group" aria-label="Chart style">
                  {([["candles", "Candles"], ["line", "Line"]] as const).map(([id, label]) => (
                    <button key={id} type="button" className="coins__seg-btn" aria-pressed={chartStyle === id} onClick={() => setChartStyle(id)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {series === "reading" ? (
                <p className="dim">Reading {stock.ticker} candles…</p>
              ) : Array.isArray(series) && series.length >= 2 ? (
                <CandleChart
                  series={series}
                  title={`${stock.symbol} / USD · Base`}
                  style={chartStyle}
                  label={`${stock.symbol} price in USD`}
                  format={price}
                />
              ) : (
                <p className="dim">No chart candles available for {stock.symbol} on this timeframe yet.</p>
              )}
            </div>
          </div>

          <div className="coin__section">
            <div className="row" role="tablist" aria-label="Stock details">
              {(
                [
                  ["trades", "Transactions"],
                  ["holders", "Holders"],
                  ["traders", "Top traders"],
                  ["pool", "Pool"],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} className={`chip ${tab === id ? "chip--active" : ""}`} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </div>

            {tab === "trades" ? (
              trades === "reading" ? (
                <p className="dim">Reading recent swaps…</p>
              ) : (
                <div className="stack">
                  <div className="row" role="group" aria-label="Trades shown">
                    {(["all", "buy", "sell"] as const).map((o) => (
                      <button key={o} type="button" className="chip chip--mode" aria-pressed={tradeFilter === o} onClick={() => setTradeFilter(o)}>
                        {o === "all" ? "All" : o === "buy" ? "Buy" : "Sell"}
                      </button>
                    ))}
                  </div>
                  {filteredTrades.length === 0 ? (
                    <p className="dim">No recent DEX swaps indexed for this pool yet.</p>
                  ) : (
                    <div className="token__trades-wrap">
                      <table className="token__trades">
                        <thead>
                          <tr>
                            <th>Age</th>
                            <th>Type</th>
                            <th>{stock.symbol}</th>
                            <th>Value</th>
                            <th>Price</th>
                            <th>Wallet</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredTrades.map((t, i) => (
                            <tr key={`${t.tx}:${t.side}:${i}`}>
                              <td>
                                <a href={explorer.tx(t.tx)} target="_blank" rel="noreferrer">
                                  {ago(t.at, now)}
                                </a>
                              </td>
                              <td className={t.side === "buy" ? "tone-ok" : "tone-bad"}>{t.side === "buy" ? "Buy" : "Sell"}</td>
                              <td className="mono">{compact(t.tokens)}</td>
                              <td className="mono">{t.usd === null ? "—" : usd(t.usd)}</td>
                              <td className="mono">{t.priceUsd === null ? "—" : tinyPrice(t.priceUsd)}</td>
                              <td className="mono">
                                {t.trader ? (
                                  <a href={explorer.address(t.trader)} target="_blank" rel="noreferrer">
                                    {short(t.trader)}
                                  </a>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            ) : tab === "holders" ? (
              holders === "reading" ? (
                <p className="dim">Reading holders…</p>
              ) : "problem" in holders ? (
                <p className="tx__warn">Holders not checked — {holders.problem}</p>
              ) : holders.length === 0 ? (
                <p className="dim">No holders indexed yet.</p>
              ) : (
                <ol className="token__holders" aria-label="Top holders">
                  {holders.slice(0, 20).map((h) => (
                    <li key={h.holder.address}>
                      <a href={explorer.address(h.holder.address)} target="_blank" rel="noreferrer" className="mono">
                        {short(h.holder.address)}
                      </a>{" "}
                      {h.holder.address.toLowerCase() === UNISWAP_V4_POOL_MANAGER.toLowerCase() ? "— Uniswap v4 PoolManager" : h.holder.label ? `— ${h.holder.label}` : ""}
                      <span className="mono"> {compact(Number(h.raw) / 10 ** stock.decimals)}</span>
                    </li>
                  ))}
                </ol>
              )
            ) : tab === "traders" ? (
              rankedTraders.length === 0 ? (
                <p className="dim">No trader wallets indexed yet.</p>
              ) : (
                <div className="token__trades-wrap">
                  <table className="token__trades" aria-label="Top traders">
                    <thead>
                      <tr>
                        <th>Wallet</th>
                        <th>Buys / Sells</th>
                        <th>Volume</th>
                        <th>Net {stock.symbol}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankedTraders.map((r) => (
                        <tr key={r.wallet}>
                          <td className="mono">
                            <a href={explorer.address(r.wallet)} target="_blank" rel="noreferrer">
                              {short(r.wallet)}
                            </a>
                          </td>
                          <td className="mono">
                            <span className="tone-ok">{r.buys}B</span> / <span className="tone-bad">{r.sells}S</span>
                          </td>
                          <td className="mono">{r.volUsd > 0 ? usd(r.volUsd) : "—"}</td>
                          <td className={`mono ${r.tokens >= 0 ? "tone-ok" : "tone-bad"}`}>
                            {r.tokens >= 0 ? "+" : ""}
                            {compact(r.tokens)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <dl className="token__info" aria-label="Pool details">
                <dt>Issuer</dt>
                <dd>Coinbase Tokenized Stocks (B20 on {BASE.name})</dd>
                <dt>Contract</dt>
                <dd>
                  <a href={explorer.token(stock.address)} target="_blank" rel="noreferrer" className="mono">
                    {stock.address}
                  </a>
                </dd>
                <dt>Deepest Pool</dt>
                <dd className="mono">{pool ? short(pool) : "not read"}</dd>
                <dt>Chainlink NAV</dt>
                <dd>{nav !== null ? `${price(nav)}${stock.navAt ? ` (${stock.navAt.toLocaleString()})` : ""}` : "not published"}</dd>
                <dt>Links</dt>
                <dd className="row">
                  <a className="chip" href={explorer.token(stock.address)} target="_blank" rel="noreferrer">
                    Basescan ↗
                  </a>
                  <a className="chip" href={`https://dexscreener.com/base/${stock.address}`} target="_blank" rel="noreferrer">
                    DexScreener ↗
                  </a>
                </dd>
              </dl>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

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

  const openStock = (ticker: string | null) => {
    const next = new URLSearchParams(params);
    if (ticker) next.set("s", ticker.toUpperCase());
    else next.delete("s");
    setParams(next, { replace: true });
  };

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
      const ready = launchReady.has(s.address.toLowerCase());
      const cats = categoriesOf(s);
      return { stock: s, spot: sp, price: priceVal, liquidity, change: sp?.change ?? null, ready, cats };
    });
  }, [stocks, spotMap, launchReady]);

  const activeItem = useMemo(() => {
    if (!selectedTicker) return null;
    return enriched.find((x) => x.stock.ticker.toUpperCase() === selectedTicker || x.stock.symbol.toUpperCase() === selectedTicker) ?? null;
  }, [enriched, selectedTicker]);

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
      if (sort === "price") return (b.price ?? -1) - (a.price ?? -1);
      return a.stock.ticker.localeCompare(b.stock.ticker);
    });
  }, [enriched, category, filter, sort, query]);

  if (activeItem) {
    return (
      <StockDetailPage
        key={activeItem.stock.address}
        stock={activeItem.stock}
        initialSpot={activeItem.spot}
        launchReady={activeItem.ready}
        onBack={() => openStock(null)}
      />
    );
  }

  const visible = filtered.slice(0, limit);

  return (
    <div className="stack stocks-dir">
      <header className="stocks__hero">
        <div className="stocks__hero-copy">
          <span className="mk__eyebrow">BASE TOKENIZED STOCKS · LAUNCHPAD V3</span>
          <h3 className="stocks__hero-title">Stocks, minted as coins.</h3>
          <p className="stocks__hero-sub">
            Pick a tokenized stock on Base to trade it directly with live charts, or launch your own token paired with it.
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
                      <button type="button" className="coins__name-btn" onClick={() => openStock(item.stock.ticker)}>
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
                      <span className="dim">Liquidity</span>
                      <strong className="mono">{item.liquidity > 0 ? `$${compact(item.liquidity)}` : "—"}</strong>
                    </div>
                  </div>
                  <div className="stocks__bar" aria-hidden="true">
                    <span style={{ width: `${liqPct}%` }} />
                  </div>
                  <div className="stocks__card-foot">
                    <button type="button" className="chip" onClick={() => openStock(item.stock.ticker)}>
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
                  <th className="num">Liquidity</th>
                  <th className="num">Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item, idx) => (
                  <tr key={item.stock.address}>
                    <td className="mono dim">#{idx + 1}</td>
                    <td>
                      <button type="button" className="coins__name-btn" onClick={() => openStock(item.stock.ticker)}>
                        {item.stock.ticker}
                      </button>{" "}
                      <span className="dim">{item.stock.name}</span>
                    </td>
                    <td className="num">{item.price !== null ? usd(item.price) : "—"}</td>
                    <td className={`num ${item.change === null ? "dim" : item.change >= 0 ? "up" : "down"}`}>
                      {item.change === null ? "—" : `${item.change >= 0 ? "+" : ""}${item.change.toFixed(2)}%`}
                    </td>
                    <td className="num">{item.liquidity > 0 ? `$${compact(item.liquidity)}` : "—"}</td>
                    <td className="num">
                      <div className="mk__actions">
                        <button type="button" className="chip" onClick={() => openStock(item.stock.ticker)}>
                          Trade {item.stock.ticker}
                        </button>
                        {item.ready && openWindow ? (
                          <button type="button" className="chip chip--mode" disabled={closed} onClick={() => openWindow("launch", { pair: item.stock.address })}>
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
