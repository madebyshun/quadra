import { useEffect, useMemo, useState } from "react";
import {
  baseStocks,
  candles,
  poolTrades,
  spots,
  tokenPools,
  type BaseStock,
  type Candle,
  type PoolTradeItem,
  type Range,
  type Spot,
  type TokenPoolInfo,
} from "@/adapters/http/markets";
import { launchFactory, launchPairs } from "@/adapters/http/launchpad";
import { BASE, UNISWAP_V4_POOL_MANAGER, WETH } from "@/config/chain";
import { TRADE_CRYPTO } from "@/config/markets";
import { toChecksumAddress } from "@/lib/address";
import { messageOf } from "@/lib/errors";
import { RESTRICTED_TEXT, useStocksClosed } from "@/lib/region";
import { topHolders, type Holding } from "@/skills/blockscout";
import { chainToken } from "@/skills/chaintoken";
import { compact, explorer, price, short, tinyPrice, usd } from "@/skills/format";
import { launchOf } from "@/skills/launchpad";
import { registerTokenLabel } from "@/features/registry";
import { useOpenWindow } from "@/features/openWindow";
import { CandleChart, formatChange, type ChartStyle } from "@/features/markets/Chart";
import { CoinPage } from "@/features/panels/CoinsPanel";
import { ContractAddress } from "@/features/panels/ContractAddress";
import { StockHealth } from "@/features/panels/StockHealth";
import { SwapPanel, type Picked } from "@/features/panels/SwapPanel";
import { choiceFor } from "@/features/panels/TokenPicker";
import { ago } from "@/features/panels/TokenPage";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import { useOptionalWalletSession } from "@/ui/WalletProvider";

type Counter = "USDC" | "ETH";
type DetailTab = "trades" | "holders" | "traders" | "pool";

const COUNTER: Record<Counter, Picked> = {
  USDC: { choice: "USDC", address: "", symbol: "USDC" },
  ETH: { choice: "ETH", address: "", symbol: "ETH" },
};

const RANGES: readonly Range[] = ["1m", "5m", "15m", "1D", "7D", "30D"];

type TokenKind =
  | { readonly kind: "loading" }
  | { readonly kind: "coin" }
  | { readonly kind: "stock"; readonly stock: BaseStock }
  | { readonly kind: "crypto"; readonly symbol: string; readonly name: string; readonly decimals: number };

function knownCrypto(addr: string): { symbol: string; name: string; decimals: number } | null {
  const lower = addr.toLowerCase();
  if (lower === WETH.address.toLowerCase()) return { symbol: "ETH", name: "Ether (WETH)", decimals: 18 };
  const hit = TRADE_CRYPTO.find((c) => c.address.toLowerCase() === lower);
  return hit ? { symbol: hit.symbol, name: hit.name, decimals: hit.decimals } : null;
}

/**
 * Unified per-token window for every asset on Base:
 * - Launched coins (LaunchFactory) -> full CoinPage (PoolTrade + TokenChart + TokenTabs + Token Verdict)
 * - Coinbase tokenized stocks -> Stock Detail & Trade (no Token Verdict, full Blue Agent GeckoTerminal pools + trades + KPIs)
 * - Base crypto tokens -> Crypto Detail & Trade (full GeckoTerminal pools + trades + Relay SwapPanel)
 */
export function TokenWindow({ address, onTitle }: { address: string; onTitle?: (title: string) => void }) {
  const checksummed = useMemo(() => toChecksumAddress(address.toLowerCase()), [address]);
  const openWindow = useOpenWindow();
  const [resolved, setResolved] = useState<TokenKind>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    setResolved({ kind: "loading" });
    (async () => {
      const [record, stockCatalog] = await Promise.all([
        launchOf(checksummed).catch(() => null),
        baseStocks().catch(() => new Map<string, BaseStock>()),
      ]);
      if (!live) return;
      if (record !== null) {
        setResolved({ kind: "coin" });
        chainToken(checksummed)
          .then((t) => {
            if (!live) return;
            registerTokenLabel(checksummed, t.symbol);
            onTitle?.(t.symbol);
          })
          .catch(() => {});
        return;
      }
      const lower = checksummed.toLowerCase();
      const stock = [...stockCatalog.values()].find((s) => s.address.toLowerCase() === lower) ?? null;
      if (stock) {
        registerTokenLabel(checksummed, stock.ticker);
        onTitle?.(stock.ticker);
        setResolved({ kind: "stock", stock });
        return;
      }
      const known = knownCrypto(checksummed);
      if (known) {
        registerTokenLabel(checksummed, known.symbol);
        onTitle?.(known.symbol);
        setResolved({ kind: "crypto", ...known });
        return;
      }
      const onChain = await chainToken(checksummed).catch(() => null);
      if (!live) return;
      const symbol = onChain?.symbol ?? short(checksummed);
      const name = onChain?.name ?? symbol;
      registerTokenLabel(checksummed, symbol);
      onTitle?.(symbol);
      setResolved({ kind: "crypto", symbol, name, decimals: onChain?.decimals ?? 18 });
    })();
    return () => {
      live = false;
    };
  }, [checksummed, onTitle]);

  if (resolved.kind === "loading") {
    return (
      <div className="stack">
        <p className="dim">Loading {short(checksummed)}…</p>
      </div>
    );
  }

  if (resolved.kind === "coin") {
    return (
      <CoinPage
        token={checksummed}
        listed={null}
        onBack={() => openWindow?.("coins")}
      />
    );
  }

  return (
    <MarketTokenDetail
      address={checksummed}
      stock={resolved.kind === "stock" ? resolved.stock : null}
      symbol={resolved.kind === "stock" ? resolved.stock.symbol : resolved.symbol}
      ticker={resolved.kind === "stock" ? resolved.stock.ticker : resolved.symbol}
      name={resolved.kind === "stock" ? resolved.stock.name : resolved.name}
      decimals={resolved.kind === "stock" ? resolved.stock.decimals : resolved.decimals}
    />
  );
}

function MarketTokenDetail({
  address,
  stock,
  symbol,
  ticker,
  name,
  decimals,
}: {
  address: string;
  stock: BaseStock | null;
  symbol: string;
  ticker: string;
  name: string;
  decimals: number;
}) {
  const openWindow = useOpenWindow();
  const walletSession = useOptionalWalletSession();
  const closed = useStocksClosed();
  const pinned = launchFactory();
  const factoryAt = "address" in pinned ? pinned.address : null;

  const [spot, setSpot] = useState<Spot | null>(null);
  const [pools, setPools] = useState<readonly TokenPoolInfo[]>([]);
  const [launchReady, setLaunchReady] = useState(false);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const isWeth = address.toLowerCase() === WETH.address.toLowerCase();
  const [counter, setCounter] = useState<Counter>(isWeth ? "USDC" : "USDC");
  const [chartStyle, setChartStyle] = useState<ChartStyle>("candles");
  const [range, setRange] = useState<Range>("15m");
  const [userPickedRange, setUserPickedRange] = useState(false);
  const [series, setSeries] = useState<readonly Candle[] | "reading" | null>("reading");
  const [tab, setTab] = useState<DetailTab>("trades");
  const [tradeFilter, setTradeFilter] = useState<"all" | "buy" | "sell">("all");
  const [trades, setTrades] = useState<readonly PoolTradeItem[] | "reading">("reading");
  const [holders, setHolders] = useState<readonly Holding[] | "reading" | { readonly problem: string }>("reading");
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    let live = true;
    spots("base", [address])
      .then((m) => {
        const found = m.get(address.toLowerCase()) ?? null;
        if (live && found) setSpot(found);
      })
      .catch(() => {});
    tokenPools("base", address)
      .then((list) => live && setPools(list))
      .catch(() => live && setPools([]));
    return () => {
      live = false;
    };
  }, [address]);

  useEffect(() => {
    if (!stock || !factoryAt) return;
    let live = true;
    launchPairs(factoryAt)
      .then(({ pairs }) => {
        if (!live) return;
        setLaunchReady(pairs.some((p) => p.address.toLowerCase() === address.toLowerCase()));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [stock, factoryAt, address]);

  // Prefer GeckoTerminal's top active-volume pool (same ranking as Blue Agent), fallback to DexScreener deepest pool.
  const bestPool = pools[0] ?? null;
  const activePool = bestPool?.address ?? spot?.pool ?? null;
  const activeIsBase = bestPool ? bestPool.isBase : undefined;

  useEffect(() => {
    if (!activePool) {
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
          const res = await candles("base", activePool, address, r);
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
  }, [activePool, address, range, userPickedRange]);

  useEffect(() => {
    if (!activePool) {
      setTrades([]);
      return;
    }
    let live = true;
    setTrades("reading");
    poolTrades("base", activePool, address, activeIsBase).then(
      (list) => live && setTrades(list),
      () => live && setTrades([]),
    );
    return () => {
      live = false;
    };
  }, [activePool, address, activeIsBase]);

  useEffect(() => {
    if (tab !== "holders") return;
    let live = true;
    setHolders("reading");
    topHolders(address).then(
      (items) => live && setHolders(items),
      (e: unknown) => live && setHolders({ problem: messageOf(e) }),
    );
    return () => {
      live = false;
    };
  }, [tab, address]);

  const livePrice = bestPool?.priceUsd ?? spot?.price ?? stock?.nav ?? null;
  const liveChange = bestPool?.change24hPct ?? spot?.change ?? null;
  const liveVol24h = bestPool?.volume24hUsd ?? spot?.volume24h ?? null;
  const liveLiq = bestPool?.liquidityUsd ?? spot?.depth ?? null;
  const nav = stock?.nav ?? null;
  const drift = livePrice !== null && nav !== null && nav > 0 ? ((livePrice - nav) / nav) * 100 : null;
  const paused = stock ? stock.paused.includes(0) : false;
  const choice = isWeth ? "ETH" : choiceFor(address);
  const picked: Picked = { choice, address: choice === "other" ? address : "", symbol };

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
      .sort((a, b) => b.volUsd - a.volUsd || b.buys + b.sells - (a.buys + a.sells))
      .slice(0, 20);
  }, [tradeList]);

  const counters: readonly Counter[] = isWeth ? ["USDC"] : ["USDC", "ETH"];

  return (
    <div className="stack coin-page">
      <div className="coin__topbar">
        <div className="row">
          {openWindow ? (
            <button type="button" className="chip" onClick={() => openWindow(stock ? "stocks" : "markets")}>
              {stock ? "← Stocks" : "← Markets"}
            </button>
          ) : null}
        </div>
        <div className="coin__topbar-actions">
          <ContractAddress address={address} />
          {stock && launchReady && openWindow ? (
            <Gel className="gel--quiet" disabled={closed} onClick={() => openWindow("launch", { pair: address })}>
              Launch with {ticker}
            </Gel>
          ) : null}
          {walletSession && walletSession.wallet?.kind !== "ready" ? (
            <Gel
              className="gel--quiet"
              disabled={walletSession.busy}
              onClick={() => (openWindow ? openWindow("wallet") : void walletSession.connectInjected())}
            >
              Connect wallet
            </Gel>
          ) : null}
        </div>
      </div>

      <header className="coin__header">
        <p className="coin__head">
          <strong className="coin__hero-name">
            {ticker} ({symbol})
          </strong>
          <span className="coin__hero-meta">
            {" · "}
            {name}
            {livePrice !== null ? ` · ${price(livePrice)}` : ""}
            {liveChange !== null ? ` · 24h ${formatChange(liveChange)}` : ""}
          </span>
        </p>
        <div className="coin__guarantees" aria-label="Token facts">
          <span className="coin__badge">{stock ? "Coinbase Stock · Base 8453" : "Base 8453"}</span>
          {stock ? <span className="coin__badge">multiplier {stock.multiplier}x</span> : null}
          {nav !== null ? <span className="coin__badge">NAV {price(nav)}</span> : null}
          {stock && launchReady ? <span className="coin__badge">v3 quote enabled</span> : null}
          {paused ? <span className="coin__badge coin__badge--warn">transfers paused</span> : null}
        </div>
      </header>

      {stock && closed ? <p className="crt__amber">{RESTRICTED_TEXT}</p> : null}

      <div className="coin__layout">
        <div className="coin__side stack">
          <fieldset className="group coin__panel">
            <legend className="mk__trade-title">Trade {ticker}</legend>
            {paused ? (
              <Crt label="Trading paused">
                <span className="crt__amber">
                  {symbol}&apos;s transfers are paused on its token contract, so nothing can be bought or sold until its issuer unpauses them.
                </span>
              </Crt>
            ) : (
              <>
                <div className="coins__seg" role="group" aria-label="Side">
                  {(["buy", "sell"] as const).map((s) => (
                    <button key={s} type="button" className="coins__seg-btn" aria-pressed={side === s} onClick={() => setSide(s)}>
                      {s === "buy" ? `Buy ${ticker}` : `Sell ${ticker}`}
                    </button>
                  ))}
                </div>
                <div className="row" role="group" aria-label={side === "buy" ? "Pay with" : "Receive"}>
                  <span className="dim">{side === "buy" ? "Pay with" : "Receive"}</span>
                  {counters.map((c) => (
                    <button key={c} type="button" className="chip chip--mode" aria-pressed={counter === c} onClick={() => setCounter(c)}>
                      {c}
                    </button>
                  ))}
                </div>
                {walletSession ? (
                  <SwapPanel
                    key={`${address}:${side}:${counter}`}
                    fixed={side === "buy" ? { sell: COUNTER[counter], buy: picked } : { sell: picked, buy: COUNTER[counter] }}
                  />
                ) : (
                  <p className="dim">Connect a wallet to trade {symbol} on {BASE.name}.</p>
                )}
              </>
            )}
          </fieldset>

          {pools.length > 0 ? (
            <fieldset className="group coin__panel">
              <legend className="mk__trade-title">Pools</legend>
              <div className="stack" aria-label="Top DEX pools">
                {pools.slice(0, 3).map((p) => (
                  <div key={p.address} className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: "8px" }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="mono" style={{ fontSize: "12px", fontWeight: 600 }}>{p.name}</div>
                      <div className="dim mono" style={{ fontSize: "11px" }}>{p.dex}</div>
                    </div>
                    <div className="mono" style={{ textAlign: "right", flexShrink: 0, fontSize: "12px" }}>
                      <div>{p.liquidityUsd != null ? `$${compact(p.liquidityUsd)}` : "—"}</div>
                      {p.volume24hUsd != null && p.volume24hUsd > 0 ? (
                        <div className="dim" style={{ fontSize: "10px" }}>vol ${compact(p.volume24hUsd)}</div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>
          ) : null}

          {stock ? (
            <details className="trade__more">
              <summary>Stock health &amp; oracle details</summary>
              <StockHealth key={address} stock={stock} />
            </details>
          ) : null}
        </div>

        <div className="coin__main stack">
          <div className="token__cards" aria-label="Numbers">
            <div className="token__card">
              <span className="token__label">Price</span>
              <strong>{livePrice !== null ? price(livePrice) : "—"}</strong>
              <span className="dim">{bestPool?.priceUsd != null || spot?.price != null ? "DEX spot" : "Chainlink NAV"}</span>
            </div>
            <div className="token__card">
              <span className="token__label">24h Change</span>
              <strong className={liveChange === null ? "dim" : liveChange >= 0 ? "up" : "down"}>
                {formatChange(liveChange)}
              </strong>
              <span className="dim">{bestPool?.change24hPct != null ? "GeckoTerminal" : "DexScreener"}</span>
            </div>
            <div className="token__card">
              <span className="token__label">Vol 24h</span>
              <strong>{liveVol24h !== null ? `$${compact(liveVol24h)}` : "—"}</strong>
              <span className="dim">Deepest pool</span>
            </div>
            <div className="token__card">
              <span className="token__label">Liquidity</span>
              <strong>{liveLiq !== null ? `$${compact(liveLiq)}` : "—"}</strong>
              <span className="dim">{bestPool?.dex ?? "Base DEX"}</span>
            </div>
            {stock ? (
              <>
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
              </>
            ) : null}
          </div>

          <div className="coin__section">
            <div className="coin__chart-frame stack">
              <div className="coin__chart-bar">
                <div className="row" role="group" aria-label="Chart range">
                  {RANGES.map((r) => (
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
                <p className="dim">Reading {ticker} candles…</p>
              ) : Array.isArray(series) && series.length >= 2 ? (
                <CandleChart
                  series={series}
                  title={`${symbol} / USD · ${bestPool?.dex ?? "Base"}`}
                  style={chartStyle}
                  label={`${symbol} price in USD`}
                  format={price}
                />
              ) : (
                <p className="dim">No chart candles available for {symbol} on this timeframe yet.</p>
              )}
            </div>
          </div>

          <div className="coin__section">
            <div className="row" role="tablist" aria-label="Token details">
              {(
                [
                  ["trades", "Transactions"],
                  ["holders", "Holders"],
                  ["traders", "Top traders"],
                  ["pool", "Pools"],
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
                            <th>{symbol}</th>
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
                      {h.holder.address.toLowerCase() === UNISWAP_V4_POOL_MANAGER.toLowerCase()
                        ? "— Uniswap v4 PoolManager"
                        : h.holder.label
                          ? `— ${h.holder.label}`
                          : ""}
                      <span className="mono"> {compact(Number(h.raw) / 10 ** decimals)}</span>
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
                        <th>Net {symbol}</th>
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
              <div className="stack">
                {pools.length > 0 ? (
                  <div className="token__trades-wrap">
                    <table className="token__trades" aria-label="Token DEX pools">
                      <thead>
                        <tr>
                          <th>Pool</th>
                          <th>DEX</th>
                          <th>Liquidity</th>
                          <th>24h Vol</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pools.slice(0, 6).map((p) => (
                          <tr key={p.address}>
                            <td className="mono">{p.name}</td>
                            <td className="mono dim">{p.dex}</td>
                            <td className="mono">{p.liquidityUsd != null ? `$${compact(p.liquidityUsd)}` : "—"}</td>
                            <td className="mono">{p.volume24hUsd != null ? `$${compact(p.volume24hUsd)}` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                <dl className="token__info" aria-label="Pool details">
                  {stock ? (
                    <>
                      <dt>Issuer</dt>
                      <dd>Coinbase Tokenized Stocks (B20 on {BASE.name})</dd>
                    </>
                  ) : null}
                  <dt>Contract</dt>
                  <dd>
                    <a href={explorer.token(address)} target="_blank" rel="noreferrer" className="mono">
                      {address}
                    </a>
                  </dd>
                  <dt>Deepest Pool</dt>
                  <dd className="mono">{activePool ? short(activePool) : "not read"}</dd>
                  {stock ? (
                    <>
                      <dt>Chainlink NAV</dt>
                      <dd>{nav !== null ? `${price(nav)}${stock.navAt ? ` (${stock.navAt.toLocaleString()})` : ""}` : "not published"}</dd>
                    </>
                  ) : null}
                  <dt>Links</dt>
                  <dd className="row">
                    <a className="chip" href={explorer.token(address)} target="_blank" rel="noreferrer">
                      Basescan ↗
                    </a>
                    <a className="chip" href={`https://dexscreener.com/base/${address}`} target="_blank" rel="noreferrer">
                      DexScreener ↗
                    </a>
                  </dd>
                </dl>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
