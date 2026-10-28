import { useCallback, useEffect, useMemo, useState } from "react";
import { baseStocks, spots, type BaseStock, type Spot } from "@/adapters/http/markets";
import { BASE, USDC, WETH } from "@/config/chain";
import { TRADE_CRYPTO } from "@/config/markets";
import { sameAddress } from "@/lib/address";
import { messageOf } from "@/lib/errors";
import { explorer, price } from "@/skills/format";
import { row, type Report, type Row } from "@/skills/types";
import { Crt } from "@/ui/Crt";
import { formatChange } from "@/features/markets/Chart";
import { depth } from "@/features/markets/Rows";
import { pausedText } from "@/features/panels/MarketsPanel";
import { ReportView } from "@/features/panels/ReportView";
import { SwapPanel, type Picked } from "@/features/panels/SwapPanel";
import { choiceFor } from "@/features/panels/TokenPicker";

/**
 * Trade: buy or sell a token on Base — crypto, or one of Coinbase's tokenized stocks — for USDC
 * or ETH, at a live Relay quote, signed in the user's wallet. The owner's ask of 2026-09-30.
 *
 * It is a front for Swap, not a second trading engine: the list picks the asset, Buy/Sell and
 * USDC/ETH pick the other side, and `SwapPanel` does the rest — the same quote, the same
 * `checkSwap`, the same exact approval, the same simulation before signing and the same
 * measurement of what arrived. MEASURED before this was built: Relay quotes Coinbase's stocks on
 * Base both ways (USDC → NVDAc, NVDAc → USDC, ETH → AAPLc) through the two Relay contracts
 * `config/routes.ts` already pins.
 *
 * 🔴 A stock is not an ordinary token (docs.base.org, "List Tokenized Stocks"): one token is not
 * always one share (`multiplier`), its issuer can PAUSE transfers — DKNGc was, MEASURED — and it is
 * only for persons in eligible jurisdictions outside the U.S. The window says all three before
 * anything is quoted, and refuses to quote a stock whose transfers are paused.
 */

type Tab = "crypto" | "stocks";
type Side = "buy" | "sell";
type Counter = "USDC" | "ETH";

export type TradeRow = {
  readonly key: string;
  /** what a person calls it — "NVDA", not "NVDAc" */
  readonly label: string;
  /** the token's own symbol */
  readonly symbol: string;
  readonly name: string;
  /** `null` for ETH itself */
  readonly address: string | null;
  readonly spot: Spot | null;
  readonly stock: BaseStock | null;
};

/** A stock whose TRANSFER feature (0) is paused cannot be bought or sold — B20 reverts it. */
export function transfersPaused(stock: BaseStock | null): boolean {
  return stock !== null && stock.paused.includes(0);
}

const REFRESH_MS = 60_000;

function useTradeList(tab: Tab) {
  const [rows, setRows] = useState<readonly TradeRow[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async (): Promise<[readonly TradeRow[], string | null]> => {
    let base: TradeRow[];
    if (tab === "crypto") {
      base = [
        { key: "eth", label: "ETH", symbol: "ETH", name: "Ether", address: null, spot: null, stock: null },
        ...TRADE_CRYPTO.map((t) => ({ key: t.address.toLowerCase(), label: t.symbol, symbol: t.symbol, name: t.name, address: t.address, spot: null, stock: null })),
      ];
    } else {
      const stocks = await baseStocks();
      base = [...stocks.values()].map((s) => ({ key: s.address.toLowerCase(), label: s.ticker, symbol: s.symbol, name: s.name, address: s.address, spot: null, stock: s }));
    }
    const addresses = base.map((r) => r.address ?? WETH.address);
    try {
      const found = await spots("base", addresses);
      const priced = base.map((r) => ({ ...r, spot: found.get((r.address ?? WETH.address).toLowerCase()) ?? null }));
      // stocks: the deepest markets first, and those with none last; crypto keeps its own order
      return [tab === "stocks" ? [...priced].sort((a, b) => (b.spot?.depth ?? -1) - (a.spot?.depth ?? -1)) : priced, null];
    } catch (e) {
      return [base, messageOf(e)];
    }
  }, [tab]);

  useEffect(() => {
    let live = true;
    setRows(null);
    setProblem(null);
    const run = () =>
      load().then(
        ([r, p]) => live && (setRows(r), setProblem(p)),
        (e: unknown) => live && (setRows([]), setProblem(messageOf(e))),
      );
    void run();
    const id = setInterval(() => void run(), REFRESH_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [load]);

  return { rows, problem };
}

function facts(r: TradeRow): Report {
  const s = r.stock;
  const rows: Row[] = [
    row("Price", r.spot?.price == null ? "no DEX market found" : `${price(r.spot.price)} — its deepest DEX pair on ${BASE.name}`),
    row("24h change", formatChange(r.spot?.change ?? null), r.spot?.change == null ? {} : { tone: r.spot.change >= 0 ? "ok" : "warn" }),
    row("Market depth", r.spot?.depth == null ? "not read" : `${depth(r.spot.depth)} in the deepest pool`),
    ...(s
      ? [
          row("Shares per token", `${s.multiplier} — one token is not always one share`, s.multiplier === 1 ? {} : { tone: "warn" }),
          row("Status", pausedText(s.paused), s.paused.length ? { tone: "bad" } : { tone: "ok" }),
          row("Reference (NAV)", s.nav === null ? "not published" : `${price(s.nav)} per token — Chainlink; not a trade price`),
        ]
      : []),
    ...(r.address ? [row("Contract", r.address, { href: explorer.token(r.address) })] : []),
  ];
  return {
    title: `${r.label} — ${r.name}`,
    rows,
    notes: s
      ? [
          "A Coinbase tokenized stock (B20). Coinbase tokenized stocks are only for persons in eligible jurisdictions outside the U.S. — trading one here is your own decision about your own eligibility.",
        ]
      : [],
    sources: [s ? "Coinbase Tokenized Stocks API" : null, "DexScreener (price)"].filter((x): x is string => x !== null),
  };
}

/** The side of the pair that is the chosen asset, as `SwapPanel` takes it. */
function pickedOf(r: TradeRow): Picked {
  const choice = choiceFor(r.address);
  return { choice, address: choice === "other" ? r.address! : "", symbol: r.symbol };
}

const COUNTER: Record<Counter, Picked> = {
  USDC: { choice: "USDC", address: "", symbol: "USDC" },
  ETH: { choice: "ETH", address: "", symbol: "ETH" },
};

export function TradePanel() {
  const [tab, setTab] = useState<Tab>("crypto");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [side, setSide] = useState<Side>("buy");
  const [counter, setCounter] = useState<Counter>("USDC");
  const { rows, problem } = useTradeList(tab);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => q === "" || r.label.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  }, [rows, query]);

  const selected = (rows ?? []).find((r) => r.key === selectedKey) ?? null;
  /** ETH is not traded for ETH, nor USDC for USDC */
  const counters = (["USDC", "ETH"] as const).filter(
    (c) => !(selected && (c === "ETH" ? selected.address === null : selected.address !== null && sameAddress(selected.address, USDC.address))),
  );
  const using: Counter = counters.includes(counter) ? counter : counters[0]!;

  const switchTab = (t: Tab) => {
    setTab(t);
    setSelectedKey(null);
    setQuery("");
  };

  return (
    <div className="stack">
      <div className="group__row group__row--actions" role="tablist" aria-label="Market">
        {(["crypto", "stocks"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className="chip chip--mode" onClick={() => switchTab(t)}>
            {t === "crypto" ? "Crypto" : "Stocks"}
          </button>
        ))}
        <input className="field" aria-label="Search" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {rows === null ? (
        <p className="dim">Reading {tab === "crypto" ? "prices" : "Coinbase's stocks on Base"}…</p>
      ) : (
        <ul className="trade__list" aria-label={tab === "crypto" ? "Crypto on Base" : "Stocks on Base"}>
          {shown.map((r) => (
            <li key={r.key}>
              <button type="button" className="trade__row" aria-pressed={r.key === selectedKey} onClick={() => setSelectedKey(r.key)}>
                <span className="gadget__sym">
                  {r.label}
                  <small>{r.name}</small>
                </span>
                <span className="gadget__px">{r.spot?.price == null ? "—" : price(r.spot.price)}</span>
                <span className={`gadget__chg${r.spot?.change == null ? "" : r.spot.change >= 0 ? " up" : " down"}`}>
                  {transfersPaused(r.stock) ? "paused" : formatChange(r.spot?.change ?? null)}
                </span>
              </button>
            </li>
          ))}
          {shown.length === 0 ? <li className="dim">Nothing matches “{query.trim()}”.</li> : null}
        </ul>
      )}
      {problem ? (
        <Crt label="Trade prices">
          <span className="crt__amber">{problem}</span>
        </Crt>
      ) : null}

      {selected === null ? (
        <p className="panel__lede">Pick {tab === "crypto" ? "a token" : "a stock"} to buy or sell it on {BASE.name}.</p>
      ) : (
        <>
          <div className="trade__pick" role="region" aria-label={`${selected.label} at a glance`}>
            <strong>
              {selected.label} — {selected.name}
            </strong>
            <span>
              {selected.spot?.price == null ? "no DEX market found" : price(selected.spot.price)} · {formatChange(selected.spot?.change ?? null)} 24h
              {selected.stock ? ` · 1 token = ${selected.stock.multiplier} share${selected.stock.multiplier === 1 ? "" : "s"} · ${pausedText(selected.stock.paused)}` : ""}
            </span>
            {selected.stock ? <small>Coinbase tokenized stocks are only for persons in eligible jurisdictions outside the U.S.</small> : null}
          </div>
          {transfersPaused(selected.stock) ? (
            <Crt label="Trading paused">
              <span className="crt__amber">
                {selected.label}&apos;s transfers are paused on its token contract, so nothing can be bought or sold until its issuer
                unpauses them. No quote is asked for.
              </span>
            </Crt>
          ) : (
            <>
              <div className="group__row group__row--actions" role="group" aria-label="Side">
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
                fixed={side === "buy" ? { sell: COUNTER[using], buy: pickedOf(selected) } : { sell: pickedOf(selected), buy: COUNTER[using] }}
              />
            </>
          )}
          <details className="trade__more">
            <summary>Everything about {selected.label}, with sources</summary>
            <ReportView report={facts(selected)} />
          </details>
        </>
      )}
    </div>
  );
}
