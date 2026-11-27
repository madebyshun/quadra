import { IndexNotice } from "@/ui/IndexNotice";
import { useEffect, useState, type ReactNode } from "react";
import { BRAND } from "@/brand";
import { CONTRACTS, UNISWAP_V4_POOL_MANAGER } from "@/config/chain";
import { launchpadCoin, launchpadCoins, type IndexedCoin, type IndexedCoinPage, type IndexedTrade } from "@/adapters/http/indexer";
import { candles, spots, type Candle, type Range } from "@/adapters/http/markets";
import { balanceOf } from "@/lib/erc20";
import { messageOf } from "@/lib/errors";
import { topHolders, type Holding } from "@/skills/blockscout";
import { compact, explorer, quoteAmountText, quoteWithUsd, short, tinyPrice, usd } from "@/skills/format";
import { coinFeeOf, isV3, launchesBy, referrerOf, type CoinFee, type PoolValue } from "@/skills/launchpad";
import { deepest, marketsOf, type Market } from "@/skills/dexscreener";
import { feePercent, LAUNCHPAD_DECIMALS, LAUNCHPAD_EXPECTS } from "@/config/launchpad";
import { PriceChart } from "@/features/markets/Chart";

/**
 * A coin's page, the parts a launchpad site shows (owner, 2026-10-14, after reading launch.o1.exchange's
 * token page): the newest launches as a strip, a plain warning, the numbers as cards, a price chart,
 * the coin's facts, its trades / holders / fees in tabs, and what the CONTRACT guarantees in words.
 * Every number comes from this app's own launchpad index (`server/indexer.ts`, the pool's own Swap
 * logs) or the chain; when the index is not running here the page says so and shows what the chain
 * alone can tell — never a made-up zero.
 */

type Read<T> = T | "reading" | { readonly problem: string };
const isDone = <T extends object>(r: Read<T>): r is T => r !== "reading" && !("problem" in r);

export function useCoinPage(token: string, fresh = 0): Read<IndexedCoinPage> {
  const [page, setPage] = useState<Read<IndexedCoinPage>>("reading");
  useEffect(() => {
    let live = true;
    setPage("reading");
    launchpadCoin(token).then(
      (p) => live && setPage(p),
      (e: unknown) => live && setPage({ problem: messageOf(e) }),
    );
    return () => {
      live = false;
    };
  }, [token, fresh]);
  return page;
}

/** v1 and v2: one 1% fee, no opening — known from the version, nothing to read. */
export const FLAT_FEE: CoinFee = { fee: LAUNCHPAD_EXPECTS.lpFee, opening: null };

/** A coin's fee: v1/v2's flat 1% at once; a v3 coin's chosen fee and opening READ from its hook. */
export function useCoinFee(factory: string, token: string): Read<CoinFee> {
  const v3 = isV3(factory);
  const [fee, setFee] = useState<Read<CoinFee>>(v3 ? "reading" : FLAT_FEE);
  useEffect(() => {
    if (!v3) return setFee(FLAT_FEE);
    let live = true;
    setFee("reading");
    coinFeeOf(factory, token).then(
      (f) => live && setFee(f),
      (e: unknown) => live && setFee({ problem: messageOf(e) }),
    );
    return () => {
      live = false;
    };
  }, [factory, token, v3]);
  return fee;
}

/** A coin's referrer: `null` for none — every v1/v2 coin, known without asking. */
export type CoinReferrer = { readonly referrer: string | null };
export const NO_REFERRER: CoinReferrer = { referrer: null };

/** A v3 coin's referrer, READ from the factory (`referrerOf`) — the chain, not the index, which may lag. */
export function useCoinReferrer(factory: string, token: string): Read<CoinReferrer> {
  const v3 = isV3(factory);
  const [ref, setRef] = useState<Read<CoinReferrer>>(v3 ? "reading" : NO_REFERRER);
  useEffect(() => {
    if (!v3) return setRef(NO_REFERRER);
    let live = true;
    setRef("reading");
    referrerOf(factory, token).then(
      (referrer) => live && setRef({ referrer }),
      (e: unknown) => live && setRef({ problem: messageOf(e) }),
    );
    return () => {
      live = false;
    };
  }, [factory, token, v3]);
  return ref;
}

/** "for the first 15 seconds the fee fell from 50% to 1%" — a v3 coin's opening, in the hook's own numbers. */
export function openingWords(fee: CoinFee): string | null {
  return fee.opening ? `for the first ${fee.opening.window} seconds the fee fell from ${feePercent(fee.opening.startFee)} to ${feePercent(fee.fee)}` : null;
}

/** The "Trading fee" line: the coin's fee, its opening, and — when the index saw one — the most any trade paid. */
export function feeLine(fee: Read<CoinFee>, maxPaidBps: number | null): string {
  if (fee === "reading") return "reading its fee…";
  if ("problem" in fee) return `not checked — its fee could not be read: ${fee.problem}`;
  const opening = openingWords(fee);
  const paid = maxPaidBps !== null && maxPaidBps * 100 > fee.fee ? `; the most a trade paid was ${feePercent(maxPaidBps * 100)}` : "";
  return `${feePercent(fee.fee)} of every trade, paid to the pool${opening ? ` — ${opening}${paid}` : ""}`;
}

/**
 * A number in the quote with its dollar value beside it, when the quote's price was read — the dollar
 * half dropped under a cent, and dust in subscript zeros (`quoteWithUsd`, skills/format.ts).
 */
export function inBoth(amount: number | null, quoteSymbol: string, quoteUsd: number | null): string {
  return quoteWithUsd(amount, quoteSymbol, quoteUsd);
}

export function ago(at: number, now: number): string {
  const s = Math.max(0, now - at);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** The newest launches, as the strip across the top of a launchpad site. Absent index: nothing shown. */
export function NewLaunches({ onOpen }: { onOpen: (token: string) => void }) {
  const [coins, setCoins] = useState<readonly IndexedCoin[]>([]);
  useEffect(() => {
    launchpadCoins().then(
      (i) => setCoins(i.coins.slice(0, 10)),
      () => setCoins([]),
    );
  }, []);
  if (coins.length === 0) return null;
  return (
    <div className="mk__strip coin__new-strip" role="group" aria-label="Newest launches">
      <span className="coin__new-label">New</span>
      {coins.map((c) => (
        <button key={c.token} type="button" className="mk__pill" onClick={() => onOpen(c.token)}>
          {c.symbol ?? short(c.token)}
        </button>
      ))}
    </div>
  );
}

/** On-chain contract guarantees + live v3 anti-sniper countdown, rendered directly under the coin title. */
export function TokenGuarantees({
  factory,
  fee,
  launchedAt,
  now,
}: {
  factory: string;
  fee: Read<CoinFee>;
  launchedAt: number | null;
  now: number;
}) {
  const v3 = isV3(factory);
  const version = v3 ? "v3" : factory.toLowerCase() === CONTRACTS.launchFactoryV1?.toLowerCase() ? "v1" : "v2";
  const feeTag = fee === "reading" ? "fee reading…" : "problem" in fee ? "fee not checked" : `${feePercent(fee.fee)} fee`;
  const remaining =
    v3 && isDone(fee) && fee.opening && launchedAt !== null
      ? fee.opening.window - (now - launchedAt)
      : 0;
  return (
    <div className="coin__guarantees" aria-label="Contract guarantees">
      <span className="coin__badge">{version}</span>
      <span className="coin__badge">{feeTag}</span>
      <span className="coin__badge">fixed 1B · no admin · LP locked</span>
      {remaining > 0 && isDone(fee) && fee.opening ? (
        <span className="coin__badge coin__badge--warn">
          anti-sniper active · {remaining}s left ({feePercent(fee.opening.startFee)} → {feePercent(fee.fee)})
        </span>
      ) : null}
    </div>
  );
}

/** The connected wallet's on-chain position in this coin, with one-click Sell shortcut. */
export function TokenPosition({
  token,
  symbol,
  account,
  page,
  value,
  onSell,
  fresh = 0,
}: {
  token: string;
  symbol: string;
  account: string;
  page: Read<IndexedCoinPage>;
  value: PoolValue | null;
  onSell?: () => void;
  fresh?: number;
}) {
  const [bal, setBal] = useState<Read<{ readonly raw: bigint }>>("reading");
  useEffect(() => {
    let live = true;
    setBal("reading");
    balanceOf({ kind: "erc20", address: token, symbol, decimals: LAUNCHPAD_DECIMALS }, account).then(
      (raw) => live && setBal({ raw }),
      (e: unknown) => live && setBal({ problem: messageOf(e) }),
    );
    return () => {
      live = false;
    };
  }, [token, symbol, account, fresh]);

  if (bal === "reading") return <p className="dim coin__position">Reading your {symbol} balance…</p>;
  if ("problem" in bal) return <p className="tx__warn coin__position">Position not checked — {bal.problem}</p>;
  const tokens = Number(bal.raw) / 10 ** LAUNCHPAD_DECIMALS;
  const pct = (tokens / 1e9) * 100;
  const priceInQuote = isDone(page) && page.coin.price !== null ? page.coin.price : value ? value.supplyInQuote / 1e9 : null;
  const qs = (isDone(page) ? page.coin.quoteSymbol : null) ?? value?.quoteSymbol ?? "";
  const qUsd = value?.quoteUsd ?? null;
  const estQuote = priceInQuote !== null ? tokens * priceInQuote : null;
  return (
    <div className="coin__position" aria-label="Your position">
      <div className="coin__position-head">
        <strong>Your position</strong>
        {bal.raw > 0n && onSell ? (
          <button type="button" className="chip chip--mode" onClick={onSell}>
            Sell {symbol}
          </button>
        ) : null}
      </div>
      <div className="coin__position-nums">
        <span className="mono">
          {bal.raw === 0n ? `0 ${symbol}` : `${compact(tokens)} ${symbol}`}
        </span>
        <span className="dim">
          {bal.raw === 0n ? "no balance" : `${pct < 0.01 ? "<0.01" : pct.toFixed(2)}% of supply`}
        </span>
      </div>
      {bal.raw > 0n && estQuote !== null ? (
        <span className="dim mono">Est. value: {inBoth(estQuote, qs, qUsd)}</span>
      ) : null}
    </div>
  );
}

/** The warning a person reads first — what the contract rules out, and what it cannot. */
export function TokenWarning() {
  return (
    <p className="token__warn" role="note">
      <strong>Before you buy:</strong> a coin launched here cannot mint more, cannot be paused or frozen, and its liquidity cannot be pulled — the contract has no way to.
      None of that makes it worth anything. Copycats with the same name exist; check the full address, the holders and Token Verdict.
    </p>
  );
}

const trades = (n: number) => `${n} ${n === 1 ? "trade" : "trades"}`;

function Card({ label, value, sub }: { label: string; value: string; sub?: string | undefined }) {
  return (
    <div className="token__card">
      <span className="token__label">{label}</span>
      <strong>{value}</strong>
      {sub ? <span className="dim">{sub}</span> : null}
    </div>
  );
}

/** The six numbers: market cap, price, 24 h volume, the quote in the pool, supply, holders. */
export function TokenStats({ page, value, holders }: { page: Read<IndexedCoinPage>; value: PoolValue | null; holders: number | null }) {
  const p = isDone(page) ? page.coin : null;
  const qs = p?.quoteSymbol ?? value?.quoteSymbol ?? "";
  const qUsd = value?.quoteUsd ?? null;
  const mcap = p?.mcapInQuote ?? value?.supplyInQuote ?? null;
  return (
    <div className="token__cards" aria-label="Numbers">
      <Card label="Market cap" value={mcap === null ? "not read" : qUsd === null ? quoteAmountText(mcap, qs) : usd(mcap * qUsd)} sub={mcap !== null && qUsd !== null ? quoteAmountText(mcap, qs) : undefined} />
      <Card label="Price" value={p?.price != null && qUsd !== null ? tinyPrice(p.price * qUsd) : p?.price != null ? quoteAmountText(p.price, qs) : "no trade yet"} sub={p?.price != null && qUsd !== null ? quoteAmountText(p.price, qs) : undefined} />
      <Card label="Volume 24h" value={p ? inBoth(p.volume24h, qs, qUsd) : "not read"} sub={p ? trades(p.trades24h) : undefined} />
      <Card label="Lifetime volume" value={p ? inBoth(p.volume, qs, qUsd) : "not read"} sub={p ? trades(p.trades) : undefined} />
      <Card label="Total supply" value="1B" sub="fixed — nobody can mint" />
      <Card label="Holders" value={holders === null ? "not read" : holders.toLocaleString("en-US")} />
    </div>
  );
}

export type Frame = "trades" | "5m" | "1h" | "1d";
export const FRAMES: readonly { readonly id: Frame; readonly label: string; readonly seconds: number }[] = [
  { id: "trades", label: "Each trade", seconds: 0 },
  { id: "5m", label: "5m", seconds: 300 },
  { id: "1h", label: "1h", seconds: 3600 },
  { id: "1d", label: "1d", seconds: 86_400 },
];

type Point = { readonly at: number; readonly price: number };
type Bar = { readonly t: number; readonly o: number; readonly h: number; readonly l: number; readonly c: number };

/** Prices into candles of `seconds` (0: one per point), oldest first. */
export function bucket(points: readonly Point[], seconds: number): Bar[] {
  const out: Bar[] = [];
  for (const p of points) {
    const t = seconds === 0 ? p.at : p.at - (p.at % seconds);
    const last = out.at(-1);
    if (seconds !== 0 && last && last.t === t * 1000) out[out.length - 1] = { ...last, h: Math.max(last.h, p.price), l: Math.min(last.l, p.price), c: p.price };
    else out.push({ t: t * 1000, o: p.price, h: p.price, l: p.price, c: p.price });
  }
  return out;
}

/** The coarsest frame that still draws a line (two candles or more) — a coin minutes old falls to 5m or each trade. */
export function autoFrame(points: readonly Point[]): Frame {
  for (const f of ["1h", "5m"] as const) if (bucket(points, FRAMES.find((x) => x.id === f)!.seconds).length >= 2) return f;
  return "trades";
}

/** Market activity from DexScreener: its own pool may be absent until the first trade. */
export function CoinMoves({ token }: { token: string }) {
  const [market, setMarket] = useState<Market | null | "reading">("reading");
  useEffect(() => {
    marketsOf([token]).then((all) => setMarket(deepest(all.filter((m) => m.base?.toLowerCase() === token.toLowerCase()))), () => setMarket(null));
  }, [token]);
  if (market === "reading") return <p className="dim">Reading market activity…</p>;
  if (market === null) return <p className="tx__warn">Market activity not checked — DexScreener has no pair for this coin yet.</p>;
  const moves = (["m5", "h1", "h6", "h24"] as const).map((id) => [id, market.change[id]] as const);
  const total = (market.buys24h ?? 0) + (market.sells24h ?? 0);
  const buys = market.buys24h;
  const buyWidth = buys === null || total === 0 ? null : (buys / total) * 100;
  return (
    <section className="coin__moves" aria-label="Market activity">
      <div className="coin__moves-head"><strong>Market activity</strong><span>{buys === null || market.sells24h === null ? "Buy / sell 24h: not read" : `${buys} ${buys === 1 ? "buy" : "buys"} · ${market.sells24h} ${market.sells24h === 1 ? "sell" : "sells"} · 24h`}</span></div>
      {buyWidth === null ? <p className="dim">Buy/sell split not reported.</p> : <div className="coin__flow" aria-label={`${buyWidth.toFixed(0)}% buys`}><span style={{ width: `${buyWidth}%` }} /><span style={{ width: `${100 - buyWidth}%` }} /></div>}
      <div className="coin__moves-grid">
        {moves.map(([id, n]) => <div key={id}><span className="dim">{id}</span><strong className={n === null ? "dim" : n >= 0 ? "tone-ok" : "tone-bad"}>{n === null ? "not read" : `${n >= 0 ? "+" : ""}${n}%`}</strong></div>)}
      </div>
    </section>
  );
}

/** Where every trade's fee goes, and what has been collected so far. */
export function FeeLedger({ page, fee, referrer }: { page: Read<IndexedCoinPage>; fee: Read<CoinFee>; referrer: Read<CoinReferrer> }) {
  if (page === "reading") return <p className="dim">Reading the fee ledger…</p>;
  if ("problem" in page) return <p className="tx__warn">Fee ledger not checked — {page.problem}</p>;
  const referred = isDone(referrer) && referrer.referrer !== null;
  const protocol = referred ? 15 : 20;
  return <div className="coin__ledger" aria-label="Fee ledger"><strong>Fee route</strong><span>{fee === "reading" ? "reading…" : "problem" in fee ? `not checked — ${fee.problem}` : `${feePercent(fee.fee)} per trade`}</span><span>Creator 80% · {referred ? "Referrer 5% · " : ""}Protocol ~{protocol}%</span><span>Collected quote: {page.feesQuote === null ? "not read" : page.feesQuote}</span><span>Collected coin: {page.feesToken === null ? "not read" : page.feesToken}</span></div>;
}

/** Other launches by the same creator, linking the coin page's identity to a profile-like history. */
export function CreatorLaunches({ creator, current }: { creator: string; current: string }) {
  const [result, setResult] = useState<Read<{ readonly launches: readonly { readonly token: string; readonly symbol?: string | null; readonly block: number }[] }>>("reading");
  useEffect(() => {
    launchesBy(creator).then((r) => setResult(r), (e: unknown) => setResult({ problem: messageOf(e) }));
  }, [creator]);
  if (result === "reading") return <p className="dim">Reading this creator&apos;s launches…</p>;
  if ("problem" in result) return <p className="tx__warn">Creator history not checked — {result.problem}</p>;
  const others = result.launches.filter((l) => l.token.toLowerCase() !== current.toLowerCase());
  return <div className="coin__creator" aria-label="Creator launches"><strong>{short(creator)} launched {result.launches.length} coin{result.launches.length === 1 ? "" : "s"}</strong>{others.length === 0 ? <span className="dim">No other launch indexed yet.</span> : others.slice(0, 5).map((l) => <a key={l.token} href={`?do=coins&t=${l.token}`}>{l.symbol ?? short(l.token)}</a>)}</div>;
}

export type ChartMode = "price" | "mcap";
const FIXED_SUPPLY = 1e9;
const GECKO_RANGES: readonly Range[] = ["1D", "7D", "30D"];

function ChartCanvasPlaceholder({
  priceLabel,
  status,
  tone = "dim",
}: {
  priceLabel: string | null;
  status: string;
  tone?: "dim" | "warn";
}) {
  return (
    <figure className="chart coin__chart-empty">
      <svg viewBox="0 0 520 180" className="chart__svg" role="img" aria-label={status}>
        {[36, 72, 108, 144].map((y) => (
          <line key={y} x1="8" y1={y} x2="512" y2={y} stroke="var(--line)" strokeWidth="1" strokeDasharray="3 4" />
        ))}
        {priceLabel ? (
          <g>
            <line x1="8" y1="90" x2="416" y2="90" stroke="#0a3dff" strokeWidth="1.5" strokeDasharray="4 4" />
            <rect x="420" y="79" width="92" height="22" rx="2" fill="#0a3dff" />
            <text x="466" y="94" textAnchor="middle" fill="#ffffff" fontSize="10" fontFamily="monospace">
              {priceLabel}
            </text>
          </g>
        ) : null}
      </svg>
      <figcaption className="chart__axis">
        <span className={tone === "warn" ? "tx__warn" : "dim"}>{status}</span>
        {priceLabel ? <span className="dim">Live pool reference · Uniswap v4</span> : null}
      </figcaption>
    </figure>
  );
}

/** The price or market cap over time: launchpad index first, GeckoTerminal OHLCV fallback, or live slot0 reference frame. */
export function TokenChart({
  page,
  token,
  symbol,
  value = null,
  quoteUsd = null,
}: {
  page: Read<IndexedCoinPage>;
  token?: string;
  symbol?: string | null;
  value?: PoolValue | null;
  quoteUsd?: number | null;
}) {
  const [picked, setPicked] = useState<Frame | null>(null);
  const [mode, setMode] = useState<ChartMode>("price");
  const [geckoRange, setGeckoRange] = useState<Range>("7D");
  const [gecko, setGecko] = useState<readonly Candle[] | "reading" | null>(null);

  const hasIndex = isDone(page) && page.points.length >= 2;
  const needGecko = Boolean(token) && page !== "reading" && !hasIndex;

  useEffect(() => {
    if (!needGecko || !token) {
      setGecko(null);
      return;
    }
    let live = true;
    setGecko("reading");
    spots("base", [token])
      .then((m) => {
        const pool = m.get(token.toLowerCase())?.pool;
        return pool ? candles("base", pool, token, geckoRange).then((r) => r.candles) : [];
      })
      .then(
        (list) => live && setGecko(list.length >= 2 ? list : null),
        () => live && setGecko(null),
      );
    return () => {
      live = false;
    };
  }, [needGecko, token, geckoRange]);

  const metricToggle = (
    <div className="coins__seg" role="group" aria-label="Chart metric">
      {([["price", "Price"], ["mcap", "Market cap"]] as const).map(([id, label]) => (
        <button key={id} type="button" className="coins__seg-btn" aria-pressed={mode === id} onClick={() => setMode(id)}>
          {label}
        </button>
      ))}
    </div>
  );

  // Tier 1: Launchpad index chart
  if (hasIndex) {
    const frame = picked ?? autoFrame(page.points);
    const qs = page.coin.quoteSymbol ?? "";
    const scale = mode === "mcap" ? FIXED_SUPPLY * (quoteUsd ?? 1) : 1;
    const scaled = scale === 1 ? page.points : page.points.map((p) => ({ at: p.at, price: p.price * scale }));
    const bars = bucket(scaled, FRAMES.find((f) => f.id === frame)!.seconds);
    const fmt = mode === "mcap" && quoteUsd !== null ? (n: number) => usd(n) : (n: number) => quoteAmountText(n, qs);
    const unitLabel = mode === "mcap" ? (quoteUsd !== null ? "market cap in USD" : `market cap in ${qs}`) : `price in ${qs}`;
    return (
      <div className="coin__chart-frame stack">
        <div className="coin__chart-bar">
          <div className="row" role="group" aria-label="Chart frame">
            {FRAMES.map((f) => (
              <button key={f.id} type="button" className="chip chip--mode" aria-pressed={frame === f.id} onClick={() => setPicked(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          {metricToggle}
        </div>
        {bars.length < 2 ? (
          <ChartCanvasPlaceholder
            priceLabel={fmt(bars[bars.length - 1]!.c)}
            status={`Every trade so far falls in one ${frame} candle — pick a finer frame.`}
          />
        ) : (
          <PriceChart series={bars} label={`${page.coin.symbol ?? "Coin"} ${unitLabel}, from its pool's opening price and trades`} format={fmt} />
        )}
      </div>
    );
  }

  // Tier 2: GeckoTerminal OHLCV fallback when launchpad index is lagging or absent
  if (Array.isArray(gecko) && gecko.length >= 2) {
    const scale = mode === "mcap" ? FIXED_SUPPLY : 1;
    const bars = scale === 1 ? gecko : gecko.map((c) => ({ ...c, o: c.o * scale, h: c.h * scale, l: c.l * scale, c: c.c * scale }));
    const fmt = mode === "mcap" ? (n: number) => usd(n) : (n: number) => tinyPrice(n);
    const coinLabel = symbol ?? "Coin";
    const unitLabel = mode === "mcap" ? "market cap in USD" : "price in USD";
    return (
      <div className="coin__chart-frame stack">
        <div className="coin__chart-bar">
          <div className="row" role="group" aria-label="Chart range">
            {GECKO_RANGES.map((r) => (
              <button key={r} type="button" className="chip chip--mode" aria-pressed={geckoRange === r} onClick={() => setGeckoRange(r)}>
                {r}
              </button>
            ))}
            <span className="dim">GeckoTerminal · USD</span>
          </div>
          {metricToggle}
        </div>
        <PriceChart series={bars} label={`${coinLabel} ${unitLabel}, from GeckoTerminal`} format={fmt} />
      </div>
    );
  }

  // Tier 3: Always-on chart frame with live Uniswap v4 slot0 reference line when available
  const qs = (isDone(page) ? page.coin.quoteSymbol : null) ?? value?.quoteSymbol ?? "";
  const coinName = symbol ?? "Coin";
  const mcapInQuote = value?.supplyInQuote ?? null;
  const priceLabel =
    mcapInQuote === null
      ? null
      : mode === "mcap"
        ? quoteUsd !== null
          ? usd(mcapInQuote * quoteUsd)
          : quoteAmountText(mcapInQuote, qs)
        : quoteUsd !== null
          ? tinyPrice((mcapInQuote / FIXED_SUPPLY) * quoteUsd)
          : quoteAmountText(mcapInQuote / FIXED_SUPPLY, qs);

  const status =
    page === "reading" || gecko === "reading"
      ? "Reading the trades…"
      : "problem" in page
        ? `No chart: ${page.problem}`
        : "No chart yet — it starts at the launch price and needs one trade after it.";

  return (
    <div className="coin__chart-frame stack">
      <div className="coin__chart-bar">
        <span className="dim">
          {coinName} / {qs || "USD"} · Uniswap v4
        </span>
        {metricToggle}
      </div>
      <ChartCanvasPlaceholder priceLabel={priceLabel} status={status} tone={!isDone(page) && page !== "reading" && gecko !== "reading" ? "warn" : "dim"} />
    </div>
  );
}

/** Who, when, what fee, and what it has earned — split the way `collect` splits it. */
export function TokenInfo({
  page,
  creator,
  launchedAt,
  quoteUsd,
  fee = FLAT_FEE,
  referrer = NO_REFERRER,
}: {
  page: Read<IndexedCoinPage>;
  creator: string;
  launchedAt: number | null;
  quoteUsd: number | null;
  fee?: Read<CoinFee>;
  referrer?: Read<CoinReferrer>;
}) {
  const p = isDone(page) ? page : null;
  const qs = p?.coin.quoteSymbol ?? "";
  const earned = p?.feesQuote ?? null;
  const ref = isDone(referrer) ? referrer.referrer : null;
  // a referred coin: 80 / 5 / the remainder (~15) — the protocol's share is what is left after both
  const ours = ref ? 0.15 : 0.2;
  return (
    <dl className="token__info" aria-label="Info">
      <dt>Creator</dt>
      <dd>
        <a href={explorer.address(creator)} target="_blank" rel="noreferrer">
          {short(creator)}
        </a>
      </dd>
      <dt>Created</dt>
      <dd>{launchedAt === null ? "not read" : new Date(launchedAt * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</dd>
      <dt>Trading fee</dt>
      <dd>{feeLine(fee, p?.maxPaidBps ?? null)}</dd>
      <dt>Fees earned (in {qs || "the quote"})</dt>
      <dd>{earned === null ? "not read" : inBoth(earned, qs, quoteUsd)}</dd>
      <dt>Creator's share</dt>
      <dd>{earned === null ? "not read" : `80% — ${inBoth(earned * 0.8, qs, quoteUsd)}`}</dd>
      {referrer === "reading" ? (
        <>
          <dt>Referrer</dt>
          <dd>reading…</dd>
        </>
      ) : !isDone(referrer) ? (
        <>
          <dt>Referrer</dt>
          <dd className="caution">not checked — {referrer.problem}</dd>
        </>
      ) : ref ? (
        <>
          <dt>Referrer</dt>
          <dd>
            <a href={explorer.address(ref)} target="_blank" rel="noreferrer">
              {short(ref)}
            </a>{" "}
            — approved by the launchpad when the coin launched
          </dd>
          <dt>Referrer's share</dt>
          <dd>{earned === null ? "not read" : `5% — ${inBoth(earned * 0.05, qs, quoteUsd)}`}</dd>
        </>
      ) : null}
      <dt>{BRAND.name}'s share</dt>
      <dd>{earned === null ? "not read" : `${ref ? "~15% (the rest)" : "20%"} — ${inBoth(earned * ours, qs, quoteUsd)}`}</dd>
      {p && p.feesToken ? (
        <>
          <dt>Fees earned (in the coin)</dt>
          <dd>{compact(p.feesToken)} — from sells, split the same way</dd>
        </>
      ) : null}
    </dl>
  );
}

type TabId = "trades" | "holders" | "fees" | "disclosures";

function Trades({ page, now, quoteUsd }: { page: IndexedCoinPage; now: number; quoteUsd: number | null }) {
  const [only, setOnly] = useState<"all" | "buy" | "sell">("all");
  const qs = page.coin.quoteSymbol ?? "";
  const sym = page.coin.symbol ?? "coin";
  const rows = page.trades.filter((t) => only === "all" || t.side === only);
  return (
    <div className="stack">
      <IndexNotice behind={page.behind} error={null} />
      <div className="row" role="group" aria-label="Trades shown">
        {(["all", "buy", "sell"] as const).map((o) => (
          <button key={o} type="button" className="chip chip--mode" aria-pressed={only === o} onClick={() => setOnly(o)}>
            {o === "all" ? "All" : o === "buy" ? "Buys" : "Sells"}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="dim">{page.trades.length === 0 ? "No trades yet — the first buy sets the price moving." : "None of these."}</p>
      ) : (
        <div className="token__trades-wrap">
          <table className="token__trades">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>{sym}</th>
                <th>{qs}</th>
                <th>Fee</th>
                <th>USD</th>
                <th>Wallet</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t: IndexedTrade, i) => (
                // a buy and a sell of the same size in one transaction are two rows: the index keeps them apart
                <tr key={`${t.tx}:${t.side}:${i}`}>
                  <td>
                    <a href={explorer.tx(t.tx)} target="_blank" rel="noreferrer">
                      {ago(t.at, now)}
                    </a>
                  </td>
                  <td className={t.side === "buy" ? "tone-ok" : "tone-bad"}>{t.side === "buy" ? "Buy" : "Sell"}</td>
                  <td className="mono">{compact(t.tokens)}</td>
                  <td className="mono">{compact(t.quote)}</td>
                  <td className="mono">
                    {compact(t.fee, 3)} {t.feeIn === "quote" ? qs : sym}
                  </td>
                  <td className="mono">{quoteUsd === null ? "—" : usd(t.quote * quoteUsd)}</td>
                  <td className="mono">{t.trader ? short(t.trader) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Holders({ token }: { token: string }) {
  const [list, setList] = useState<Read<{ readonly items: readonly Holding[] }>>("reading");
  useEffect(() => {
    topHolders(token).then(
      (items) => setList({ items }),
      (e: unknown) => setList({ problem: messageOf(e) }),
    );
  }, [token]);
  if (list === "reading") return <p className="dim">Reading the holders…</p>;
  if ("problem" in list) return <p className="tx__warn">Not checked — the holders could not be read: {list.problem}</p>;
  if (list.items.length === 0) return <p className="dim">No holders indexed yet — Blockscout lags a brand-new coin.</p>;
  const manager = UNISWAP_V4_POOL_MANAGER.toLowerCase();
  const total = list.items.reduce((sum, h) => sum + h.raw, 0n);
  const share = (count: number) => total === 0n ? null : Number(list.items.slice(0, count).reduce((sum, h) => sum + h.raw, 0n) * 10_000n / total) / 100;
  return (
    <div className="stack">
      <div className="coin__concentration" aria-label="Holder concentration">
        {[1, 5, 10].map((n) => <div key={n}><span>Top {n}</span><strong>{share(n) === null ? "not read" : `${share(n)}%`}</strong></div>)}
      </div>
      <ol className="token__holders" aria-label="Top holders">
      {list.items.slice(0, 20).map((h) => (
        <li key={h.holder.address}>
          <a href={explorer.address(h.holder.address)} target="_blank" rel="noreferrer" className="mono">
            {short(h.holder.address)}
          </a>{" "}
          {h.holder.address.toLowerCase() === manager ? "— the pool (Uniswap v4)" : h.holder.label ? `— ${h.holder.label}` : ""}
          <span className="mono"> {(Number(h.raw / 10n ** 14n) / 1e4).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
          <span className="dim"> ({((Number(h.raw / 10n ** 14n) / 1e4 / 1e9) * 100).toFixed(2)}%)</span>
        </li>
      ))}
      </ol>
    </div>
  );
}

/** Trades, holders, and optional Fees & Info / Disclosures panels, as tabs. `now` is unix seconds. */
export function TokenTabs({
  token,
  page,
  now,
  quoteUsd = null,
  feesTab,
  disclosuresTab,
}: {
  token: string;
  page: Read<IndexedCoinPage>;
  now: number;
  quoteUsd?: number | null;
  feesTab?: ReactNode;
  disclosuresTab?: ReactNode;
}) {
  const [tab, setTab] = useState<TabId>("trades");
  const tabs: readonly { readonly id: TabId; readonly label: string }[] = [
    { id: "trades", label: "Transactions" },
    { id: "holders", label: "Holders" },
    ...(feesTab ? [{ id: "fees" as const, label: "Fees & Info" }] : []),
    ...(disclosuresTab ? [{ id: "disclosures" as const, label: "Disclosures" }] : []),
  ];
  return (
    <div className="stack">
      <div className="row" role="tablist" aria-label="Coin details">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`chip ${tab === t.id ? "chip--active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "holders" ? (
        <Holders token={token} />
      ) : tab === "fees" ? (
        feesTab
      ) : tab === "disclosures" ? (
        disclosuresTab
      ) : page === "reading" ? (
        <p className="dim">Reading the trades…</p>
      ) : "problem" in page ? (
        <p className="tx__warn">Not checked — the trades could not be read: {page.problem}</p>
      ) : (
        <Trades page={page} now={now} quoteUsd={quoteUsd} />
      )}
    </div>
  );
}

/**
 * What the contract guarantees, said once in plain words — from the launchpad's own code, not a
 * promise: v1 and v2 have no opening protection, so none is claimed; v3's is said in the numbers its
 * hook holds for this coin, read — never the deploy script's defaults assumed.
 */
export function Disclosures({ factory, fee = FLAT_FEE, referrer = NO_REFERRER }: { factory: string; fee?: Read<CoinFee>; referrer?: Read<CoinReferrer> }) {
  const ref = isDone(referrer) ? referrer.referrer : null;
  const v1 = factory.toLowerCase() === CONTRACTS.launchFactoryV1?.toLowerCase();
  const v3 = isV3(factory);
  const known = isDone(fee) ? fee : null;
  const pct = known ? feePercent(known.fee) : "its";
  return (
    <details className="trade__more" open>
      <summary>Disclosures — what the contract guarantees</summary>
      <ul className="notes">
        <li className="notes__why">
          <strong>Locked liquidity, no control.</strong> The whole supply sits in one pool position the launchpad owns, and the launchpad has no function that removes it. Nobody —
          not the creator, not {BRAND.name} — can mint more, pause, freeze, rename or pull liquidity.
        </li>
        <li className="notes__why">
          <strong>No reserved supply.</strong> All 1,000,000,000 coins went into the pool at launch. The creator holds only what they bought, like anyone else.
        </li>
        {v3 ? (
          <li className="notes__why">
            <strong>Anti-sniping opening (v3).</strong>{" "}
            {known
              ? `${openingWords(known) ?? "no opening was recorded"} — a bot buying in the first seconds paid most of that; the creator's own first buy, inside the launch, paid only ${pct}. Nobody else could add liquidity during it.`
              : fee === "reading"
                ? "Reading the opening from the launchpad's hook…"
                : `Not checked — the hook could not be read: ${(fee as { problem: string }).problem}`}
          </li>
        ) : (
          <li className="notes__why">
            <strong>No anti-sniping on this launchpad version.</strong> {v1 ? "v1" : "v2"} opens trading at the normal 1% fee from the first block; a bot can buy in the
            launch's next block (MEASURED on the first launch).
          </li>
        )}
        <li className="notes__why">
          <strong>Fee split.</strong> {known ? `${pct} of every trade` : "The coin's fee on every trade"}
          {v3 ? ` (the creator chose 1% or 3%)` : ""}, in whatever was paid in;{" "}
          {ref
            ? `collecting pays 80% to the creator, 5% to its referrer ${short(ref)} (an app the launchpad approved, recorded at launch and paid for good) and the rest, about 15%, to ${BRAND.name}.`
            : isDone(referrer)
              ? `collecting pays 80% to the creator and 20% to ${BRAND.name}.`
              : `collecting pays 80% to the creator and the rest to ${BRAND.name} — and 5% of it to a referrer if one was recorded, which was not checked.`}{" "}
          Anyone may call it.
        </li>
        <li className="notes__why">
          <strong>Not audited.</strong> The launchpad contract is verified on Blockscout and tested, but no audit has been done.
        </li>
      </ul>
    </details>
  );
}
