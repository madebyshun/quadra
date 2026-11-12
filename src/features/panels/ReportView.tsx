import { useEffect, useState } from "react";
import type { Report } from "@/skills/types";
import { useRunCommand } from "@/features/openWindow";
import { say } from "@/lib/assistant";
import { count } from "@/lib/achievements";
import { depthCard, DepthShare } from "@/features/panels/DepthShare";
import { collateralCard, CollateralShare } from "@/features/panels/CollateralShare";
import { VerdictShare, verdictCard } from "@/features/panels/VerdictShare";

/**
 * What Q says about a report, if anything: a red Verdict or Decision row is worth a word before
 * anybody buys or pays. Nothing else — Q does not narrate reports.
 */
export function tipFor(report: Report): Parameters<typeof say>[0] | null {
  const red = report.rows.find((r) => (r.label === "Verdict" || r.label === "Decision") && r.tone === "bad");
  if (!red) return null;
  return { id: `red:${report.title}`, tone: "bad", text: `It looks like you're about to touch something that came back red: "${red.value}". Read the red lines first — I'll wait.` };
}

/**
 * A skill's report as a table: label, value, and a colour only where there is a verdict.
 *
 * Links open in a new tab and are the value itself, so "see it for yourself" is one click
 * on the thing being claimed rather than a separate row that could drift from it.
 *
 * Next steps (2026-10-02, "link everything together"): a row's `next` is a small button beside it,
 * and the report's own `next` a row of buttons under it. Each runs its command line exactly as the
 * Terminal would — opening the window it names, or the skill's own window, told to run it. Outside
 * the desktop, where no window can open, they are not shown.
 */
export function ReportView({ report }: { report: Report }) {
  const run = useRunCommand();
  const [refused, setRefused] = useState<string | null>(null);
  const go = (command: string) => setRefused(run!(command));
  useEffect(() => {
    const tip = tipFor(report);
    if (tip) say(tip);
    // every Token Verdict read counts toward "checked before buying"
    if (report.rows.some((r) => r.label === "Verdict")) count("verdicts");
  }, [report]);
  return (
    <section className="report" aria-label={report.title}>
      <h3 className="report__title">{report.title}</h3>
      <dl className="report__rows">
        {report.rows.map((r, i) => (
          <div className={`report__row${r.tone ? ` report__row--${r.tone}` : ""}`} key={`${r.label}-${i}`}>
            <dt>{r.label}</dt>
            <dd>
              {r.href ? (
                <a href={r.href} target="_blank" rel="noreferrer noopener">
                  {r.value}
                </a>
              ) : (
                r.value
              )}
              {run && r.next ? (
                <button type="button" className="report__go" title={r.next} aria-label={r.next} onClick={() => go(r.next!)}>
                  ↗
                </button>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {report.notes.map((n) => (
        <p className="dim" key={n}>
          {n}
        </p>
      ))}
      <p className="report__sources">Sources: {report.sources.join(", ")}</p>
      {run && report.next?.length ? (
        <div className="report__next" role="group" aria-label="Next">
          {report.next.map((s) => (
            <button key={s.command} type="button" className="chip" title={s.command} onClick={() => go(s.command)}>
              {s.label}
            </button>
          ))}
        </div>
      ) : null}
      {refused ? <p className="tx__warn">{refused}</p> : null}
      <Shareable report={report} />
    </section>
  );
}

/** A finished Token Verdict can be posted as a picture; opened on demand, so the report stays first. */
function Shareable({ report }: { report: Report }) {
  const card = verdictCard(report);
  const depth = card ? null : depthCard(report);
  const loans = card || depth ? null : collateralCard(report);
  return card || depth || loans ? (
    <details className="report__share">
      <summary>Share as a picture</summary>
      {card ? <VerdictShare c={card} /> : depth ? <DepthShare c={depth} /> : <CollateralShare c={loans!} />}
    </details>
  ) : null;
}
