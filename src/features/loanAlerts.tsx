import { useEffect, useState } from "react";
import { say, type Tip } from "@/lib/assistant";
import { DEFAULT_THRESHOLD, isWatched, loadLoanWatch, MAX_WATCHED, unwatchLoan, watchLoan, type Watched } from "@/lib/loanWatch";
import { collateralReport, STRESS } from "@/skills/collateral";
import { short } from "@/skills/format";
import type { Report } from "@/skills/types";
import { collateralCard } from "@/features/panels/CollateralShare";

/**
 * Liquidation alerts (2026-11-13): Q speaks up when a watched wallet's nearest stock loan is closer
 * to liquidation than the threshold its watcher chose — or when, with the US market shut, Base's DEX
 * price already puts a loan below a health of 1. Every alert is a real read of the chain, made when
 * the app opens and every `EVERY_MS` while it stays open; a wallet that could not be read raises
 * nothing and clears nothing (a missing answer is not an all-clear).
 */

export const EVERY_MS = 10 * 60 * 1000;
const WEEKEND = /at Base's \$[\d,.]+: health (\d+\.\d\d)/;
const WORST = /worst weekend gap \([^)]*\): health (\d+\.\d\d)/;

/** The tips a report earns for its watcher, or none. */
export function tipsFor(report: Report, w: Watched): Tip[] {
  const card = collateralCard(report);
  if (card === null) return [];
  const near = card.loans[0]!;
  const open = { label: "Open Collateral Watch", command: `collateral ${w.wallet}` };
  const who = short(w.wallet);
  if (near.distance !== null && near.distance < w.threshold) {
    const text =
      near.distance === 0
        ? `${who}: ${near.symbol} on ${near.venue} can be liquidated now.`
        : `${who}: ${near.symbol} on ${near.venue} is ${near.distance}% from liquidation — you asked to hear under ${w.threshold}%.`;
    return [{ id: `loan:${w.wallet}:${near.venue}:${near.symbol}:${Math.floor(near.distance)}`, tone: "bad", text, action: open }];
  }
  // the worst weekend on record would liquidate: Aave's stress row, or a Morpho loan's "worst weekend gap (…): health H" below 1
  const stressAave = report.rows.find((r) => r.label === STRESS && r.value.includes("would be liquidated"));
  const stressMorpho = report.rows.find((r) => r.label.startsWith("Morpho · ") && Number(WORST.exec(r.value)?.[1] ?? 2) < 1);
  if (stressAave || stressMorpho) {
    const where = stressMorpho ? `${stressMorpho.label.slice("Morpho · ".length)} on Morpho` : "its Aave loan";
    return [{ id: `loan-worst:${w.wallet}`, tone: "bad", text: `${who}: a repeat of the worst weekend gap on record would liquidate ${where}.`, action: open }];
  }
  // the weekend: Aave's scenario row, or a Morpho loan's "at Base's $X: health H" below 1
  const aave = report.rows.find((r) => r.label === "If the market reopened at Base's prices" && r.tone === "bad");
  const morpho = report.rows.find((r) => r.label.startsWith("Morpho · ") && Number(WEEKEND.exec(r.value)?.[1] ?? 2) < 1);
  if (aave || morpho) {
    const where = morpho ? `${morpho.label.slice("Morpho · ".length)} on Morpho` : "its Aave loan";
    return [{ id: `loan-weekend:${w.wallet}`, tone: "bad", text: `${who}: at Base's weekend price, ${where} would already be below a health of 1 when the market reopens.`, action: open }];
  }
  return [];
}

/** Read every watched wallet, one after another, and raise what they earn. */
export async function checkLoans(list: readonly Watched[] = loadLoanWatch(), now = Date.now()): Promise<Tip[]> {
  const tips: Tip[] = [];
  for (const w of list) {
    const report = await collateralReport(w.wallet, now).catch(() => null);
    if (report) tips.push(...tipsFor(report, w));
  }
  tips.forEach(say);
  return tips;
}

/** Runs the check when the app opens and every `EVERY_MS` after, while anything is watched. */
export function useLoanAlerts(): void {
  useEffect(() => {
    if (loadLoanWatch().length === 0) return;
    void checkLoans();
    const id = setInterval(() => void checkLoans(), EVERY_MS);
    return () => clearInterval(id);
  }, []);
}

/** "Watch this wallet": under a Collateral Watch report, a threshold and a toggle. */
export function LoanWatch({ wallet }: { wallet: string }) {
  const [list, setList] = useState<readonly Watched[]>(() => loadLoanWatch());
  const [threshold, setThreshold] = useState(String(list.find((w) => w.wallet.toLowerCase() === wallet.toLowerCase())?.threshold ?? DEFAULT_THRESHOLD));
  const watching = isWatched(wallet, list);
  const full = !watching && list.length >= MAX_WATCHED;
  const n = Number(threshold);
  const valid = Number.isFinite(n) && n > 0 && n < 100;
  return (
    <fieldset className="group">
      <legend>Liquidation alert</legend>
      <label className="group__row">
        <span>Alert me when the nearest loan is within</span>
        <input className="field field--short" aria-label="Alert threshold" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        <span className="unit">% of liquidation</span>
      </label>
      <div className="row">
        <button
          type="button"
          className="gel gel--quiet"
          disabled={!valid || full}
          onClick={() => {
            const next = watchLoan(wallet, n);
            setList(next);
            void checkLoans(next.filter((w) => w.wallet.toLowerCase() === wallet.toLowerCase()));
          }}
        >
          {full ? `Watching ${MAX_WATCHED} wallets already` : watching ? "Update the alert" : "Watch this wallet"}
        </button>
        {watching ? (
          <button type="button" className="gel gel--quiet" onClick={() => setList(unwatchLoan(wallet))}>
            Stop watching
          </button>
        ) : null}
      </div>
      <p className="dim">
        {watching
          ? "Watching — Q checks this wallet when you open the app and every 10 minutes while it is open. Kept in this browser only."
          : "Q checks the wallet when you open the app and every 10 minutes while it is open, and says when a loan gets close. Kept in this browser only."}
      </p>
    </fieldset>
  );
}
