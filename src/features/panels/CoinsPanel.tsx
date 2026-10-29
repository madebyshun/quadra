import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { collectTx } from "@/adapters/http/launchpad";
import { BASE, CONTRACTS } from "@/config/chain";
import { checkAddress, toChecksumAddress } from "@/lib/address";
import { messageOf } from "@/lib/errors";
import { chainToken } from "@/skills/chaintoken";
import { explorer, short, usd } from "@/skills/format";
import { deepest, marketsOf, type Market } from "@/skills/dexscreener";
import { BRAND } from "@/brand";
import { useOpenWindow } from "@/features/openWindow";
import {
  isV3,
  launchesBy,
  launchOf,
  pendingFees,
  poolValue,
  sharedQuoteUsd,
  v3FeeOf,
  type CoinFee,
  type Launch,
  type LaunchRecord,
  type PoolValue,
} from "@/skills/launchpad";
import { tokenVerdict, poolValueRows } from "@/skills/verdict";
import { row, type Report } from "@/skills/types";
import { Gel } from "@/ui/Gel";
import { useWalletSession } from "@/ui/WalletProvider";
import { ReportView } from "@/features/panels/ReportView";
import { PoolTrade } from "@/features/panels/PoolTrade";
import { CoinRewards } from "@/features/panels/CoinRewards";
import { VerdictBadge } from "@/features/panels/VerdictBadge";
import { CoinShare } from "@/features/panels/CoinShare";
import { TxStepList, useTxSteps } from "@/features/panels/TxSteps";
import { Disclosures, FeeLedger, CoinMoves, CreatorLaunches, NewLaunches, TokenChart, TokenInfo, TokenStats, TokenTabs, TokenWarning, useCoinFee, useCoinPage, useCoinReferrer } from "@/features/panels/TokenPage";
import { feePercent } from "@/config/launchpad";
import { tokenInfo } from "@/skills/blockscout";
import { feesText, valueText } from "@/features/panels/BaseLaunch";
import { ContractAddress, CopyCa } from "@/features/panels/ContractAddress";

/**
 * Coins — this app's launchpad as one window, laid out like a launchpad site (owner, 2026-10-02:
 * "a page like launch.o1.exchange", kept as a desktop window in this app's own style): a head with
 * "Launch a token", the launchpad's numbers, the coins filtered (All / Crypto / Stocks, by pair) and
 * sorted (Trending / Vol 24h / New / Liquidity), and a page for each coin: what it is, what it is worth on its own pool, who launched it, the fees waiting, a buy
 * or sell through the same Swap engine, and a full Token Verdict on demand. `?do=coins&t=0x…` opens
 * one coin's page directly, so a coin has a link that can be shared.
 *
 * Everything is read from the chain (the factories' records, the pools' slot0) and Blockscout's log
 * index; DexScreener supplies only the quote's USD price. Nothing here holds or asks for a key: a buy,
 * a sell or a collection is signed in the user's own wallet, exactly as in Swap and Launch.
 */

/** The newest this many launches are listed — each costs a few reads. */
export const SHOWN_COINS = 20;
/** Reads in flight at once while the list fills in, so a burst does not trip the public RPC's limit. */
const AT_ONCE = 4;

type Facts = { readonly name: string; readonly symbol: string } | null;
/**
 * One listed coin. `undefined` is "not read yet"; `null` is "could not be read". `market` is the coin's
 * deepest market on DexScreener — which lists a stock-paired pool only after its first trade (MEASURED).
 */
export type Listed = Launch & {
  readonly facts?: Facts | undefined;
  readonly value?: PoolValue | null | undefined;
  readonly market?: Market | null | undefined;
  /** a v3 coin's chosen fee, read from its hook; `undefined` once read means unreadable; v1/v2 coins carry `null` */
  readonly fee?: CoinFee | null | undefined;
};

/** A v3 coin's fee in its list row — v1/v2 coins say nothing, the hero already says 1%; nothing while unread. */
export function listFee(c: Listed): string {
  if (!isV3(c.factory) || !("fee" in c)) return "";
  return c.fee ? ` · ${feePercent(c.fee.fee)} fee, anti-sniper opening` : " · fee not checked";
}

export type Tab = "all" | "crypto" | "stocks";
export type Sort = "trending" | "volume" | "new" | "liquidity" | "marketCap" | "gainers";
export const SORTS: readonly { readonly id: Sort; readonly label: string }[] = [
  { id: "trending", label: "🔥 Trending" },
  { id: "volume", label: "⚡ Vol 24h" },
  { id: "new", label: "🌱 New" },
  { id: "liquidity", label: "💧 Liquidity" },
  { id: "marketCap", label: "Mcap" },
  { id: "gainers", label: "Gainers" },
];

const trades = (c: Listed) => (c.market ? (c.market.buys24h ?? 0) + (c.market.sells24h ?? 0) : null);
const time = (c: Listed) => c.at?.getTime() ?? 0;
/** Highest first; a figure nobody could read sorts after every real one, never as a zero among them. */
const desc = (a: number | null, b: number | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : b - a);

/** Trending is the most trades in 24 hours; ties, and coins with none, fall back to the newest. */
export function sortCoins(coins: readonly Listed[], by: Sort): Listed[] {
  const key: Record<Sort, (c: Listed) => number | null> = {
    trending: trades,
    volume: (c) => c.market?.volume24h ?? null,
    new: time,
    liquidity: (c) => c.market?.liquidityUsd ?? null,
    marketCap: (c) => c.value && c.value.quoteUsd !== null ? c.value.supplyInQuote * c.value.quoteUsd : null,
    gainers: (c) => c.market?.change.h24 ?? null,
  };
  return [...coins].sort((a, b) => desc(key[by](a), key[by](b)) || time(b) - time(a));
}

/** Crypto is an ETH pair, Stocks a stock pair; `asset` narrows to one quote. A pair not read yet shows only under All. */
export function filterCoins(coins: readonly Listed[], tab: Tab, asset: string | null): Listed[] {
  return coins.filter((c) => {
    const quote = c.value ? c.value.quoteSymbol : null;
    if (tab === "crypto" && quote !== "ETH") return false;
    if (tab === "stocks" && (quote === null || quote === "ETH")) return false;
    return asset === null || quote === asset;
  });
}

/** Every search term may match the coin name, ticker, or contract address. */
export function searchCoins(coins: readonly Listed[], query: string): Listed[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...coins];
  return coins.filter((c) => {
    const text = `${c.facts?.name ?? ""} ${c.facts?.symbol ?? ""} ${c.token}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

/** The quotes the listed coins are paired with, ETH first. */
export function assetsOf(coins: readonly Listed[]): string[] {
  const seen = [...new Set(coins.flatMap((c) => (c.value ? [c.value.quoteSymbol] : [])))];
  return seen.sort((a, b) => (a === "ETH" ? -1 : b === "ETH" ? 1 : a.localeCompare(b)));
}

export type Stats = {
  readonly launched: string;
  readonly volume: string;
  readonly trades: string;
  readonly top: string;
};

/** The launchpad's numbers, from what was read — a total over nothing readable says so, never "$0". */
export function statsOf(coins: readonly Listed[], total: number, complete: boolean): Stats {
  const listed = coins.filter((c) => c.market);
  const caps = coins.flatMap((c) => (c.value && c.value.quoteUsd !== null ? [{ c, cap: c.value.supplyInQuote * c.value.quoteUsd }] : []));
  const best = caps.reduce<(typeof caps)[number] | null>((m, x) => (m === null || x.cap > m.cap ? x : m), null);
  return {
    launched: `${total}${complete ? "" : "+"}`,
    volume: listed.length ? usd(listed.reduce((s, c) => s + (c.market!.volume24h ?? 0), 0)) : "—",
    trades: listed.length ? listed.reduce((s, c) => s + trades(c)!, 0).toLocaleString("en-US") : "—",
    top: best ? `${usd(best.cap)}${best.c.facts ? ` · ${best.c.facts.symbol}` : ""}` : "—",
  };
}

/** Which launchpad a factory address is, in words. */
export function versionOf(factory: string): string {
  return isV3(factory) ? "version 3" : factory.toLowerCase() === CONTRACTS.launchFactoryV1?.toLowerCase() ? "version 1" : "version 2";
}

/** How long ago, in one word-pair. */
export function ago(at: Date | null, now: number): string {
  if (at === null) return "time not read";
  const minutes = Math.max(0, Math.round((now - at.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/** A coin's page as a report — everything except the trade and the verdict, which are their own sections. */
export function coinReport(
  token: string,
  facts: Facts,
  record: LaunchRecord,
  value: PoolValue | null | undefined,
  fees: Awaited<ReturnType<typeof pendingFees>> | null,
  launch: Launch | null,
): Report {
  const pair = value ? value.quoteSymbol : "not read";
  return {
    title: facts ? `${facts.name} (${facts.symbol})` : `Coin ${token}`,
    rows: [
      row("Token", token, { href: explorer.token(token) }),
      row("Paired with", value ? (value.quoteSymbol === "ETH" ? "ETH" : `${value.quoteSymbol} — a Coinbase stock token on ${BASE.name}`) : "not read — its pool could not be read", {
        ...(value && value.quoteSymbol !== "ETH" ? { href: explorer.token(value.quote) } : {}),
        ...(value ? {} : { tone: "warn" as const }),
      }),
      ...poolValueRows(value),
      row("Launched by", short(record.creator), { href: explorer.address(record.creator), next: `profile ${record.creator}` }),
      row("Launched", launch?.at ? launch.at.toLocaleString() : "time not read", launch?.tx ? { href: explorer.tx(launch.tx) } : {}),
      row("Launchpad", `${versionOf(record.factory)} — fixed supply, no admin, liquidity locked forever`, { href: explorer.address(record.factory), tone: "ok" }),
      row("Fees waiting", feesText(fees, value ? [{ address: value.quote, symbol: value.quoteSymbol, name: value.quoteSymbol, decimals: value.quoteDecimals, startTick: 0 }] : []), fees === null ? { tone: "warn" } : {}),
      row("Chart", `DexScreener — it lists a pool once it has traded (pair: ${pair})`, { href: `https://dexscreener.com/base/${token}` }),
    ],
    notes: [
      "Read from the chain: the launchpad's record of this coin and its pool's current price. The USD figure multiplies that by the quote's price on its deepest market.",
      ...(value && value.quoteSymbol !== "ETH"
        ? ["Coinbase's stock tokens are only for eligible persons outside the U.S.; buying a coin paired with one routes through the stock."]
        : []),
    ],
    sources: [`${BASE.name} (the launchpad and its pool, read directly)`, "DexScreener (the quote's USD price)"],
  };
}

function CoinPage({ token, listed, onBack }: { token: string; listed: Listed | null; onBack: () => void }) {
  const { wallet, signingProvider } = useWalletSession();
  const openWindow = useOpenWindow();
  const ready = wallet?.kind === "ready" ? wallet : null;
  const [record, setRecord] = useState<LaunchRecord | null | "reading" | { readonly problem: string }>("reading");
  const [facts, setFacts] = useState<Facts>(listed?.facts ?? null);
  const [value, setValue] = useState<PoolValue | null>(listed?.value ?? null);
  const [fees, setFees] = useState<Awaited<ReturnType<typeof pendingFees>> | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [verdict, setVerdict] = useState<Report | "running" | { readonly problem: string } | null>(null);
  const [fresh, setFresh] = useState(0);
  const collecting = useTxSteps();
  const page = useCoinPage(token, fresh);
  const fee = useCoinFee(record !== null && typeof record === "object" && "factory" in record ? record.factory : "", token);
  const referrer = useCoinReferrer(record !== null && typeof record === "object" && "factory" in record ? record.factory : "", token);
  const [holders, setHolders] = useState<number | null>(null);
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    tokenInfo(token).then(
      (i) => setHolders(i?.holders ?? null),
      () => setHolders(null),
    );
  }, [token]);

  useEffect(() => {
    let live = true;
    setRecord("reading");
    launchOf(token).then(
      async (r) => {
        // the record and its details land together, so a page read again (after a collection) never mixes two reads
        const details =
          r === null
            ? null
            : await Promise.all([
                chainToken(token).then((t) => ({ name: t.name, symbol: t.symbol }), () => null),
                poolValue(r.factory, token).catch(() => null),
                pendingFees(r.factory, token).catch(() => null),
              ]);
        if (!live) return;
        setRecord(r);
        if (details) {
          setFacts(details[0]);
          setValue(details[1]);
          setFees(details[2]);
        }
      },
      (e: unknown) => live && setRecord({ problem: messageOf(e) }),
    );
    return () => {
      live = false;
    };
  }, [token, fresh]);

  const back = (
    <div>
      <button type="button" className="chip" onClick={onBack}>
        ← All coins
      </button>
    </div>
  );
  if (record === "reading") {
    return (
      <div className="stack">
        {back}
        <p className="dim">Reading {short(token)} from the launchpad…</p>
      </div>
    );
  }
  if (record === null) {
    return (
      <div className="stack">
        {back}
        <p className="tx__warn">{token} was not launched on this app&apos;s launchpad. Token Verdict (Safety) can check any token.</p>
      </div>
    );
  }
  if ("problem" in record) {
    return (
      <div className="stack">
        {back}
        <p className="tx__warn">The launchpad could not be read: {record.problem}</p>
      </div>
    );
  }

  const symbol = facts?.symbol ?? short(token);
  const onVerdict = () => {
    setVerdict("running");
    tokenVerdict(token, Date.now()).then(setVerdict, (e: unknown) => setVerdict({ problem: messageOf(e) }));
  };
  const onCollect = async () => {
    if ((await collecting.run(signingProvider(), ready!.account, [{ label: `Collect the fees of ${symbol}`, build: () => collectTx(record.factory, token) }])) !== null) {
      setFresh((n) => n + 1);
    }
  };
  const nothingWaiting = fees === null || (fees.inQuote === 0n && fees.inToken === 0n);

  const launchedAt = typeof page === "object" && !("problem" in page) ? page.coin.launchedAt : listed?.at ? Math.floor(listed.at.getTime() / 1000) : null;
  return (
    <div className="stack">
      {back}
      <NewLaunches onOpen={(t) => openWindow?.("coins", { t })} />
      <TokenWarning />
      {/* the coin at a glance, then the trade — the page's call to action stays above the fold
          (MEASURED: with the whole report first, the swap's button sat 311px below it) */}
      <p className="coin__head">
        <strong>{facts ? `${facts.name} (${facts.symbol})` : short(token)}</strong>
        {" · "}
        {`vs ${value === null ? "?" : value.quoteSymbol} · ${valueText(value)} · by `}
        {openWindow ? (
          <button
            type="button"
            className="chip"
            aria-label={`Profile of ${record.creator}`}
            onClick={() => openWindow("profile", { a: record.creator })}
          >
            {short(record.creator)}
          </button>
        ) : (
          short(record.creator)
        )}
      </p>
      <ContractAddress address={token} />

      <fieldset className="group">
        <legend>Trade {symbol}</legend>
        <div className="group__row group__row--actions" role="group" aria-label="Side">
          {(["buy", "sell"] as const).map((s) => (
            <button key={s} type="button" className="chip chip--mode" aria-pressed={side === s} onClick={() => setSide(s)}>
              {s === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}
            </button>
          ))}
        </div>
        {/* ONE route (2026-10-29, the owner: "no overlapping features"): the coin's own pool. Relay does not
            route a v3 hook pool at all (MEASURED: "no routes found" on the first referred launch), and this
            pool is the one place a coin launched here is sure to trade. Swap and Trade keep Relay for the rest. */}
        <PoolTrade key={`${token}:${side}`} token={token} symbol={symbol} side={side} />
      </fieldset>
      {/* below the trade: the page's call to action stays above the fold (MEASURED 2026-10-29: with
          market activity above it the trade's button sat 30px below a 659px-wide window's fold, and
          with the number cards above it 59px below a phone's) — the head line already says the cap */}
      <section className="coin__overview" aria-label="Coin overview">
        <TokenStats page={page} value={value} holders={holders} />
      </section>
      <CoinMoves token={token} />
      <FeeLedger page={page} fee={fee} referrer={referrer} />

      <TokenChart page={page} />
      <TokenInfo page={page} creator={record.creator} launchedAt={launchedAt} quoteUsd={value?.quoteUsd ?? null} fee={fee} referrer={referrer} />
      <TokenTabs token={token} page={page} now={now} quoteUsd={value?.quoteUsd ?? null} />
      <CreatorLaunches creator={record.creator} current={token} />
      <Disclosures factory={record.factory} fee={fee} referrer={referrer} />

      <details className="trade__more">
        <summary>Everything about {symbol}, with sources</summary>
        <ReportView report={coinReport(token, facts, record, value, fees, listed)} />
      </details>

      {ready && ready.account.toLowerCase() === record.creatorRecipient.toLowerCase() ? (
        <fieldset className="group">
          <legend>Your fees</legend>
          <Gel className="gel--quiet" onClick={() => void onCollect()} disabled={collecting.running || nothingWaiting}>
            {nothingWaiting ? "No fees waiting" : "Collect"}
          </Gel>
          <p className="dim">80% to you, 20% to this app — the launchpad&apos;s split, in both currencies of the pool.</p>
          <TxStepList states={collecting.states} label="Collect progress" />
        </fieldset>
      ) : null}

      <CoinRewards token={token} symbol={symbol} record={record} />
      {facts && value ? (
        <CoinShare c={{ token, name: facts.name, symbol: facts.symbol, pair: value.quoteSymbol, cap: valueText(value).replace(/^market cap ≈ /, "") }} />
      ) : null}

      <fieldset className="group">
        <legend>Token Verdict</legend>
        {verdict === null ? (
          <Gel className="gel--quiet" onClick={onVerdict}>
            Run a full verdict on {symbol}
          </Gel>
        ) : verdict === "running" ? (
          <p className="dim">Simulating a buy and a sell, reading the holders and the launcher…</p>
        ) : "problem" in verdict ? (
          <p className="tx__warn">The verdict could not run: {verdict.problem}</p>
        ) : (
          <ReportView report={verdict} />
        )}
      </fieldset>
    </div>
  );
}

export function CoinsPanel() {
  const [params, setParams] = useSearchParams();
  const openWindow = useOpenWindow();
  const raw = params.get("t");
  // a link's token goes through the EIP-55 door; a malformed or mistyped one opens the list instead
  const kind = raw ? checkAddress(raw).kind : "malformed";
  const linked = raw && kind !== "malformed" && kind !== "mismatch" ? toChecksumAddress(raw) : null;
  const [list, setList] = useState<{ readonly coins: readonly Listed[]; readonly total: number; readonly complete: boolean } | "reading" | { readonly problem: string }>("reading");
  const [tab, setTab] = useState<Tab>("all");
  const [asset, setAsset] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("trending");
  const [now] = useState(() => Date.now());

  // read once, when the window opens; a state set after it closed is dropped by React, so no guard is kept
  useEffect(() => {
    launchesBy(null).then(
      async ({ launches, complete }) => {
        let coins: Listed[] = launches.slice(0, SHOWN_COINS);
        const total = launches.length;
        setList({ coins, total, complete });
        // one DexScreener request for every listed coin's markets; a failure leaves them "not read"
        const markets = await marketsOf(coins.map((c) => c.token)).catch(() => null);
        // unread stays `undefined` (said as nothing); read-and-none is `null` ("not traded yet")
        const marketOf = (token: string) => (markets === null ? undefined : deepest(markets.filter((m) => m.base?.toLowerCase() === token.toLowerCase())));
        const usdOf = sharedQuoteUsd();
        for (let i = 0; i < coins.length; i += AT_ONCE) {
          const chunk = await Promise.all(
            coins.slice(i, i + AT_ONCE).map(async (c) => ({
              ...c,
              market: marketOf(c.token),
              facts: await chainToken(c.token).then((t) => ({ name: t.name, symbol: t.symbol }), () => null),
              value: await poolValue(c.factory, c.token, usdOf).catch(() => null),
              fee: await v3FeeOf(c, c.token),
            })),
          );
          coins = [...coins.slice(0, i), ...chunk, ...coins.slice(i + AT_ONCE)];
          setList({ coins, total, complete });
        }
      },
      (e: unknown) => setList({ problem: messageOf(e) }),
    );
  }, []);

  const open = (token: string | null) => {
    const next = new URLSearchParams(params);
    if (token) next.set("t", token);
    else next.delete("t");
    setParams(next, { replace: true });
  };

  if (linked) {
    const listed = typeof list === "object" && "coins" in list ? (list.coins.find((c) => c.token.toLowerCase() === linked.toLowerCase()) ?? null) : null;
    return <CoinPage key={linked} token={linked} listed={listed} onBack={() => open(null)} />;
  }

  const ready = typeof list === "object" && "coins" in list ? list : null;
  const stats = ready ? statsOf(ready.coins, ready.total, ready.complete) : null;
  const shown = ready ? sortCoins(searchCoins(filterCoins(ready.coins, tab, asset), query), sort) : [];

  return (
    <div className="stack">
      <div className="coins__hero">
        <p className="coins__title">{BRAND.name} launchpad</p>
        <p className="dim">On Base, paired with ETH or a Coinbase stock: a fixed supply, no admin, liquidity locked forever, 80% of every fee to the launcher.</p>
        {openWindow ? (
          <Gel className="coins__cta" onClick={() => openWindow("launch")}>
            Launch a token
          </Gel>
        ) : null}
      </div>

      <dl className="coins__stats" aria-label="Launchpad numbers">
        {(
          [
            ["Coins launched", stats?.launched],
            ["Volume 24h", stats?.volume],
            ["Trades 24h", stats?.trades],
            ["Highest market cap", stats?.top],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="coins__stat">
            <dt>{label}</dt>
            <dd>{value ?? "…"}</dd>
          </div>
        ))}
      </dl>

      <div className="coins__filters">
        <label className="coins__search-label">
          <span>Find a coin</span>
          <input className="field coins__search" type="search" aria-label="Search coins" placeholder="Name, ticker, or contract address" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="group__row group__row--actions" role="group" aria-label="Coins shown">
          {(["all", "crypto", "stocks"] as const).map((t) => (
            <button key={t} type="button" className="chip chip--mode" aria-pressed={tab === t} onClick={() => (setTab(t), setAsset(null))}>
              {t === "all" ? "All" : t === "crypto" ? "Crypto" : "Stocks"}
            </button>
          ))}
          <select className="field coins__asset" aria-label="Paired with" value={asset ?? ""} onChange={(e) => setAsset(e.target.value || null)}>
            <option value="">All assets</option>
            {(ready ? assetsOf(filterCoins(ready.coins, tab, null)) : []).map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="group__row group__row--actions" role="group" aria-label="Sort">
        {SORTS.map((s) => (
          <button key={s.id} type="button" className="chip chip--mode" aria-pressed={sort === s.id} onClick={() => setSort(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {list === "reading" ? (
        <p className="dim">Reading the launchpad&apos;s launches…</p>
      ) : "problem" in list ? (
        <p className="tx__warn">The launches could not be read: {list.problem}</p>
      ) : list.coins.length === 0 ? (
        <p className="dim">No coin has been launched here yet.</p>
      ) : shown.length === 0 ? (
        <p className="dim">No coin matches — try All.</p>
      ) : (
        <ul className="notes" aria-label="Coins">
          {shown.map((c) => (
            <li key={`${c.token}:${c.tx}`}>
              <span className="notes__row">
                <button type="button" className="chip" aria-label={`Open ${c.token}`} onClick={() => open(c.token)}>
                  {c.facts ? `${c.facts.name} (${c.facts.symbol})` : short(c.token)}
                </button>
                <CopyCa address={c.token} />
                <VerdictBadge token={c.token} />
                <span className="notes__id">{c.value === undefined ? "…" : c.value === null ? "pair not read" : `vs ${c.value.quoteSymbol}`}</span>
              </span>
              <span className="notes__why">
                {c.value === undefined ? "reading…" : valueText(c.value)}
                {listFee(c)}
                {" · "}
                {c.market === undefined ? "" : c.market === null ? "not traded yet · " : `vol ${usd(c.market.volume24h ?? 0)} · ${trades(c)} ${trades(c) === 1 ? "trade" : "trades"} · `}
                {ago(c.at, now)} · by {short(c.creator)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {ready && ready.coins.length > 0 ? (
        <p className="dim">
          The newest {ready.coins.length}
          {ready.complete ? "" : " from the launchpad's newest logs"}. Market caps are read from each coin&apos;s own pool; volume and trades
          from DexScreener, which lists a coin once it has traded. Trending = most trades in 24h.
        </p>
      ) : null}
    </div>
  );
}
