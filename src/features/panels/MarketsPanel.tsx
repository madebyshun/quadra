import { useEffect, useState } from "react";
import { candles, type Candle, type Range } from "@/adapters/http/markets";
import { BASE, FLAGS } from "@/config/chain";
import { ROBINHOOD } from "@/config/routes";
import { assertChecksummedAddress, toChecksumAddress } from "@/lib/address";
import { readToken } from "@/lib/erc20";
import { messageOf } from "@/lib/errors";
import { explorer, price } from "@/skills/format";
import { THIN_MARKET_USD } from "@/config/markets";
import { row, type Report, type Row } from "@/skills/types";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import { ReportView } from "@/features/panels/ReportView";
import { formatChange, PriceChart } from "@/features/markets/Chart";
import { useMarkets, type MarketRow } from "@/features/markets/MarketsProvider";
import { depth, MarketRows, thin } from "@/features/markets/Rows";

/**
 * The Markets window: the watchlist, one asset's chart over a chosen range, and every fact
 * about it with its source — chain, contract, market depth, and for a Robinhood stock its bid,
 * ask, day range, halt status and how old the quote is; for a Coinbase stock on Base its shares
 * per token, paused features and Chainlink NAV. Base comes first, in the list and in the add
 * form: a Base stock from Coinbase's own list, a Base token by its address, then a stock from
 * Robinhood's own list. Never a ticker typed free-form (hard rule 2).
 */

const RANGES: readonly Range[] = ["1D", "7D", "30D"];

/** A stock quote older than this is shown as stale — a price is a claim about a moment. */
export const STALE_MS = 10 * 60_000;

/** Where a missing contract would have come from, per kind — the list that did not name it. */
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
export const B20_FEATURES = [
  "transfers",
  "minting",
  "burning",
  "seizing",
] as const;

export function pausedText(paused: readonly number[]): string {
  return paused.length === 0
    ? "nothing paused"
    : `paused: ${paused.map((f) => B20_FEATURES[f] ?? `feature ${f}`).join(", ")}`;
}

function details(r: MarketRow, now: number): Report {
  const chain =
    r.venue === "base"
      ? `${BASE.name} (${BASE.id})`
      : `${ROBINHOOD.name} (${ROBINHOOD.id})`;
  const link =
    r.address === null
      ? null
      : r.venue === "base"
        ? explorer.token(r.address)
        : `${ROBINHOOD.explorer}/token/${r.address}`;
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
    row(
      "24h change",
      `${formatChange(r.change)} — DexScreener`,
      r.change === null ? {} : { tone: r.change >= 0 ? "ok" : "warn" },
    ),
    row(
      "Market depth",
      r.depth === null
        ? "not read"
        : `${depth(r.depth)} in the deepest pool${r.depth < THIN_MARKET_USD ? " — thin" : ""}`,
      thin(r) ? { tone: "warn" } : {},
    ),
    ...(b
      ? [
          row(
            "Shares per token",
            `${b.multiplier} — one token is not always one share`,
            b.multiplier === 1 ? {} : { tone: "warn" },
          ),
          row(
            "Status",
            pausedText(b.paused),
            b.paused.length ? { tone: "bad" } : { tone: "ok" },
          ),
          row(
            "Reference (NAV)",
            b.nav === null
              ? "not published"
              : `${price(b.nav)} per token — Chainlink, ${b.navAt ? b.navAt.toLocaleString() : "time not reported"}; not a trade price`,
          ),
        ]
      : []),
    row("Chain", chain),
    row(
      "Contract",
      r.address === null ? UNLISTED[kind] : toChecksumAddress(r.address),
      link ? { href: link } : {},
    ),
    ...(q
      ? [
          row("Bid / ask", `${price(q.bid)} / ${price(q.ask)}`),
          row(
            "Day range",
            q.low === null || q.high === null
              ? "not reported"
              : `${price(q.low)} – ${price(q.high)}`,
          ),
          row(
            "Status",
            q.halted ? "trading halted" : "trading",
            q.halted ? { tone: "bad" } : {},
          ),
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
      ...(thin(r)
        ? [
            `Under ${depth(THIN_MARKET_USD)} of liquidity: a small trade can move this price a long way, so read it as a rough figure.`,
          ]
        : []),
      ...(r.staleSeconds !== null
        ? [
            `The chart is this app's remembered copy, ${Math.round(r.staleSeconds / 60)} min old — GeckoTerminal is not answering right now.`,
          ]
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
    sources: [
      SOURCE[kind],
      "DexScreener (price)",
      "GeckoTerminal via this app's server (chart)",
    ].filter((s): s is string => s !== null),
  };
}

export function MarketsPanel() {
  const { rows, symbols, baseSymbols, focus, select, add, remove, reset } =
    useMarkets();
  const selected = rows.find((r) => r.key === focus) ?? rows[0] ?? null;
  const [range, setRange] = useState<Range>("1D");
  const [chart, setChart] = useState<{
    key: string;
    range: Range;
    series: readonly Candle[] | string;
  } | null>(null);
  const [stock, setStock] = useState("");
  const [baseStock, setBaseStock] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  /** 1D is the gadget's own series; a longer range is read for the selected asset alone. */
  const key = selected?.key ?? null;
  const venue = selected?.venue ?? null;
  const pool = selected?.pool ?? null;
  const address = selected?.address ?? null;
  useEffect(() => {
    if (
      key === null ||
      range === "1D" ||
      pool === null ||
      address === null ||
      venue === null
    )
      return;
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

  const addToken = async () => {
    setError(null);
    try {
      const address = toChecksumAddress(
        assertChecksummedAddress(token, "Token address"),
      );
      const t = await readToken(address);
      add({ kind: "token", address, label: t.symbol });
      setToken("");
    } catch (e) {
      setError(messageOf(e));
    }
  };

  return (
    <div className="stack">
      <div className="markets">
        <div className="markets__list" aria-label="Watchlist" role="region">
          <MarketRows
            rows={rows}
            onPick={select}
            selected={selected?.key ?? null}
          />
        </div>

        {selected === null ? (
          <p className="panel__lede">
            The watchlist is empty. Add a Base stock or a Base token below, or
            reset it.
          </p>
        ) : (
          <div className="stack">
            <div
              className="group__row group__row--actions"
              role="group"
              aria-label="Range"
            >
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className="chip chip--mode"
                  aria-pressed={r === range}
                  onClick={() => setRange(r)}
                >
                  {r}
                </button>
              ))}
            </div>
            {typeof series === "string" ? (
              <Crt label="Chart unavailable">
                <span className="crt__amber">{series}</span>
              </Crt>
            ) : series === null ? (
              <p className="dim">Reading the chart…</p>
            ) : (
              <PriceChart
                series={series}
                label={`${selected.label}, ${range}`}
                format={price}
              />
            )}
            <ReportView report={details(selected, Date.now())} />
            <Gel quiet onClick={() => remove(selected.key)}>
              Remove {selected.label} from the watchlist
            </Gel>
          </div>
        )}
      </div>

      <fieldset className="group">
        <legend>Add to the watchlist</legend>
        <label className="group__row">
          <span>Base stock</span>
          <select
            className="field"
            aria-label="Base stock"
            value={baseStock}
            onChange={(e) => setBaseStock(e.target.value)}
          >
            <option value="">
              {baseSymbols.length
                ? "Pick a Coinbase stock on Base…"
                : "Coinbase's list is not loaded"}
            </option>
            {baseSymbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Gel
            onClick={() => (
              add({ kind: "basestock", symbol: baseStock }),
              setBaseStock("")
            )}
            disabled={baseStock === ""}
          >
            Add
          </Gel>
        </label>
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
          <label className="group__row">
            <span>Robinhood stock</span>
            <select
              className="field"
              aria-label="Robinhood stock"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
            >
              <option value="">
                {symbols.length
                  ? "Pick one of Robinhood's stock tokens…"
                  : "Robinhood's list is not loaded"}
              </option>
              {symbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <Gel
              onClick={() => (
                add({ kind: "stock", symbol: stock }),
                setStock("")
              )}
              disabled={stock === ""}
            >
              Add
            </Gel>
          </label>
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
