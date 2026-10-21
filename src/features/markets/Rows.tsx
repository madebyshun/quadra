import { THIN_MARKET_USD, type Venue } from "@/config/markets";
import { price } from "@/skills/format";
import { formatChange, Sparkline } from "@/features/markets/Chart";
import type { MarketRow } from "@/features/markets/MarketsProvider";

/**
 * The watched assets as rows, grouped by chain — Base first, Robinhood Chain after (the owner's
 * rule, 2026-09-30). The gadget and the Markets window draw the same rows through this, so the
 * two cannot drift apart.
 */

const GROUPS: readonly (readonly [Venue, string])[] = [
  ["base", "Base"],
  ["robinhood", "Robinhood Chain"],
];

function where(r: MarketRow): string {
  return r.watch.kind === "token" ? "Base" : r.watch.kind === "basestock" ? "Base · stock" : "Robinhood · stock";
}

/** Pool liquidity in whole dollars — cents on a depth figure are noise. */
export function depth(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** A price from a thin market is marked, with its depth in the tooltip. */
export function thin(r: MarketRow): boolean {
  return r.depth !== null && r.depth < THIN_MARKET_USD && r.quote === null;
}

export function MarketRows({ rows, onPick, selected }: { rows: readonly MarketRow[]; onPick: (key: string) => void; selected?: string | null }) {
  return (
    <>
      {GROUPS.map(([venue, title]) => {
        const list = rows.filter((r) => r.venue === venue);
        if (list.length === 0) return null;
        return (
          <div key={venue} className="gadget__section">
            <div className="gadget__group">{title}</div>
            <ul className="gadget__rows" aria-label={title}>
              {list.map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    className="gadget__row"
                    onClick={() => onPick(r.key)}
                    {...(selected === undefined ? {} : { "aria-pressed": r.key === selected })}
                    title={r.problem ?? r.chartProblem ?? (thin(r) ? `Thin market: ${depth(r.depth!)} of liquidity — a small trade can move this price.` : undefined)}
                  >
                    <span className="gadget__sym">
                      {r.label}
                      <small>{where(r)}</small>
                    </span>
                    <span className={`gadget__px${thin(r) ? " gadget__px--thin" : ""}`}>{r.price === null ? "—" : price(r.price)}</span>
                    <span className={`gadget__chg${r.change === null ? "" : r.change >= 0 ? " up" : " down"}`}>{formatChange(r.change)}</span>
                    {r.series ? (
                      <Sparkline series={r.series} label={`${r.label}, last 24 hours`} />
                    ) : (
                      <span className="spark spark--none">{r.chartProblem ? "no chart" : "…"}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}
