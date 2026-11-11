import { isObj, listOf, strOf } from "@/skills/json";
import { row, type Report, type Row, type Tone } from "@/skills/types";

/**
 * Blue Agent's weekend record, as two reports for the Weekend window (2026-11-12, the owner's split:
 * Blue Agent is the data layer, this app shows it to people, credited). Read through this origin's
 * `/api/weekend/<scorecard|diary>` (server/weekend.ts) — Blue Agent sends no CORS header.
 *
 * The question it answers: on a Sunday the tokens trade on Base while Coinbase's price feed sits at
 * Friday's close — does the Base price call Monday's open? Blue Agent grades every call once the
 * market reopens. This app only words what it publishes; it does not grade, predict or re-derive.
 * A field Blue Agent did not send is "not published", never 0.
 */

export const WEEKEND_PAGE = "https://blueagent.dev/markets/weekend";
export const SOURCE = "Blue Agent (blueagent.dev — weekend scorecard and diary)";
/** A p-value at or above this is not evidence of skill. */
export const SIGNIFICANT = 0.05;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pct = (v: number | null, digits = 1) => (v === null ? "not published" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`);
const share = (v: number | null) => (v === null ? "not published" : `${Math.round(v * 100)}%`);

export async function readWeekend(which: "scorecard" | "diary"): Promise<unknown> {
  const res = await fetch(`/api/weekend/${which}`, { headers: { "x-quadra": "1" } });
  if (!res.ok) throw new Error(`Blue Agent's weekend ${which} could not be read (${res.status}).`);
  return res.json();
}

function callRow(r: Record<string, unknown>): Row {
  const ticker = strOf(r.ticker) ?? "?";
  const call = strOf(r.call) ?? "not published";
  const move = pct(num(r.weekend_move_pct), 2);
  const gap = num(r.open_gap_pct);
  const hit = r.hit === true ? "right" : r.hit === false ? "wrong" : "not graded";
  const tone: Tone | undefined = r.hit === true ? "ok" : r.hit === false ? "bad" : undefined;
  const value = `${call} — Base ${move} vs Friday's close · Monday's open ${pct(gap, 2)} · ${hit}`;
  const href = strOf(r.explorer);
  return row(ticker, value, { ...(tone ? { tone } : {}), ...(href ? { href } : {}) });
}

export function scorecardReport(body: unknown): Report {
  const s = isObj(body) && isObj(body.summary) ? body.summary : {};
  const calls = num(s.calls);
  const hits = num(s.hits);
  const rate = num(s.hit_rate);
  const p = num(s.p_value_two_sided);
  const ci = isObj(s.ci95) ? s.ci95 : {};
  const rows: Row[] = [];
  if (s.ready === true && rate !== null) {
    const skill = p !== null && p < SIGNIFICANT;
    rows.push(
      row(
        "Record",
        `${hits ?? "?"} of ${calls ?? "?"} calls right — ${share(rate)} (95% range ${share(num(ci.lo))}–${share(num(ci.hi))}), p = ${p === null ? "not published" : p.toFixed(2)}${skill ? "" : " — not yet better than a coin flip"}`,
        { tone: skill ? "ok" : "warn", href: WEEKEND_PAGE },
      ),
    );
  } else {
    rows.push(row("Record", `${hits ?? 0} of ${calls ?? 0} calls right — a rate is published from ${num(s.needed) ?? 30} graded calls`, { tone: "warn", href: WEEKEND_PAGE }));
  }
  const dex = num(s.dex_nearer);
  const flat = num(s.flat_nearer);
  if (dex !== null && flat !== null) rows.push(row("Nearer Monday's open", `Base's Sunday price ${dex} times, Friday's close ${flat} times`));
  for (const b of listOf(s.by_size).filter(isObj)) rows.push(row(`Moves of ${strOf(b.bucket) ?? "?"}`, `${num(b.hits) ?? "?"} of ${num(b.calls) ?? "?"} right`));

  const live = isObj(body) ? body.live : null;
  const pending = isObj(body) ? body.pending : null;
  if (isObj(pending)) rows.push(row("This weekend", "the call is taken (Sunday 22:00 UTC) — graded at Monday's open", { tone: "warn" }));
  else if (isObj(live)) rows.push(row("This weekend", "live — provisional until Sunday 22:00 UTC", { tone: "warn" }));

  const latest = isObj(body) ? listOf(body.weekends).filter(isObj)[0] : undefined;
  if (latest) {
    const crypto = isObj(latest.crypto) ? latest.crypto : {};
    rows.push(row(`Weekend of ${strOf(latest.friday) ?? "?"}`, `BTC ${pct(num(crypto.btc_pct))}, ETH ${pct(num(crypto.eth_pct))} over the same hours`));
    for (const r of listOf(latest.rows).filter(isObj)) rows.push(callRow(r));
  }
  return {
    title: "Does Base's weekend price call Monday's open?",
    rows,
    notes: [
      "On a weekend the stock tokens keep trading on Base while Coinbase's price feed stays at Friday's close. At Sunday 22:00 UTC Blue Agent calls UP or DOWN wherever the two differ by 0.5% or more, and grades the call at the next regular open.",
      "Blue Agent's record, shown as published. Not a signal and not advice — a measurement of whether a weekend price means anything.",
    ],
    sources: [SOURCE],
  };
}

export function diaryReport(body: unknown): Report {
  const d = isObj(body) ? body : {};
  const back = isObj(d.backtest) ? d.backtest : {};
  const fwd = isObj(d.forward) ? d.forward : {};
  const usdOf = (v: number | null) => (v === null ? "not published" : v === 0 ? "$0" : `${v < 0 ? "−" : "+"}$${Math.abs(v).toLocaleString("en-US")}`);
  const pnlTone = (v: number | null): Tone | undefined => (v === null || v === 0 ? undefined : v > 0 ? "ok" : "bad");
  const rows: Row[] = [row("Rule", strOf(d.rule) ?? "not published")];
  const backPnl = num(back.pnl_usd);
  rows.push(row("Backtest", `${num(back.trades) ?? "?"} trades over ${num(back.weekends) ?? "?"} weekends, ${num(back.wins) ?? "?"} won, ${usdOf(backPnl)} — in-sample, before the rule went live`, pnlTone(backPnl) ? { tone: pnlTone(backPnl)! } : {}));
  const fwdTrades = num(fwd.trades) ?? 0;
  const fwdPnl = num(fwd.pnl_usd);
  rows.push(
    row(
      "Since it went live",
      fwdTrades === 0 ? "no weekend closed yet — the first entry is taken Sunday 22:00 UTC" : `${fwdTrades} trades, ${num(fwd.wins) ?? "?"} won, ${usdOf(fwdPnl)}`,
      pnlTone(fwdTrades === 0 ? null : fwdPnl) ? { tone: pnlTone(fwdPnl)! } : {},
    ),
  );
  for (const e of listOf(d.entries).filter(isObj)) {
    const pnl = num(e.pnl_usd);
    const note = strOf(e.note_close) ?? strOf(e.note_open);
    rows.push(row(`Weekend of ${strOf(e.friday) ?? "?"}`, `${listOf(e.positions).length} positions, ${pnl === null ? "open" : usdOf(pnl)}${note ? ` — “${note}”` : ""}`, pnlTone(pnl) ? { tone: pnlTone(pnl)! } : {}));
  }
  return {
    title: "Blue Agent's weekend diary — $1,000 paper positions",
    rows,
    notes: [
      "Paper money: nothing is traded. Positions, prices and P&L are computed in code; each diary note is written by a model from those numbers.",
      // Blue Agent's own words on its backtest — e.g. why a right call can still lose (2026-11-12)
      ...(strOf(back.note) ? [`Blue Agent on the backtest: ${strOf(back.note)}`] : []),
    ],
    sources: [SOURCE],
  };
}
