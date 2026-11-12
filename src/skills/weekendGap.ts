import { isObj, listOf, strOf } from "@/skills/json";

/**
 * The worst weekend a stock has had on record (2026-11-13, Stocks Maxxing 3.3: "model overnight price
 * gaps"). Blue Agent grades every weekend: the price feed's jump from Friday's close to Monday's
 * open is `open_gap_pct` (MEASURED 2026-11-13: NVDA's worst was −5.13% on the weekend of Nov 6,
 * AAPL's −1.49%). Collateral Watch applies each stock's worst DOWNWARD gap to the loans it backs —
 * the weekend a lender's oracle can do the most damage in one step.
 *
 * In a browser this goes through this app's own route (Blue Agent sends no CORS header); with no
 * `document` — the MCP server, the paid API — it asks Blue Agent directly. A stock with no history,
 * or a record that could not be read, is `null`: "not checked", never "no gap".
 */

export const SCORECARD = "https://blueagent.dev/api/x402/weekend-scorecard";
export const WEEKENDS = 52;

export type Gap = { readonly pct: number; readonly friday: string; readonly weekends: number };

/** A stock token's symbol as Blue Agent's ticker: Coinbase's trailing "c" off ("NVDAc" → "NVDA"). */
export const tickerOf = (symbol: string): string | null => (/^[A-Z]{1,6}c$/.test(symbol) ? symbol.slice(0, -1) : null);

/** The worst downward `open_gap_pct` for `ticker` in a scorecard answer; `null` with none graded or none downward. */
export function worstGap(body: unknown, ticker: string): Gap | null {
  let worst: Gap | null = null;
  let seen = 0;
  for (const w of listOf(isObj(body) ? body.weekends : null).filter(isObj)) {
    for (const r of listOf(w.rows).filter(isObj)) {
      if (r.ticker !== ticker || typeof r.open_gap_pct !== "number" || !Number.isFinite(r.open_gap_pct)) continue;
      seen += 1;
      if (r.open_gap_pct < 0 && (worst === null || r.open_gap_pct < worst.pct)) worst = { pct: r.open_gap_pct, friday: strOf(w.friday) ?? "?", weekends: 0 };
    }
  }
  return worst ? { ...worst, weekends: seen } : null;
}

async function scorecardFor(ticker: string): Promise<unknown> {
  const res =
    typeof document === "undefined"
      ? await fetch(SCORECARD, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker, weekends: WEEKENDS }) })
      : await fetch(`/api/weekend/scorecard?ticker=${ticker}&weekends=${WEEKENDS}`, { headers: { "x-quadra": "1" } });
  if (!res.ok) throw new Error(`Blue Agent's weekend record for ${ticker} could not be read (${res.status}).`);
  return res.json();
}

/** Each stock symbol's worst weekend gap, one request per ticker; a symbol whose record could not be read maps to `null`. */
export async function worstGaps(symbols: readonly string[]): Promise<Map<string, Gap | null>> {
  const out = new Map<string, Gap | null>();
  for (const s of symbols) {
    const t = tickerOf(s);
    if (t === null || out.has(s)) continue;
    out.set(s, await scorecardFor(t).then((b) => worstGap(b, t), () => null));
  }
  return out;
}
