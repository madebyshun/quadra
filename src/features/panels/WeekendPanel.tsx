import { useEffect, useState } from "react";
import { messageOf } from "@/lib/errors";
import { diaryReport, readWeekend, scorecardReport, WEEKEND_PAGE } from "@/lib/weekend";
import type { Report } from "@/skills/types";
import { ReportView } from "@/features/panels/ReportView";

type Part = { readonly kind: "reading" } | { readonly kind: "ok"; readonly report: Report } | { readonly kind: "failed"; readonly why: string };

function usePart(which: "scorecard" | "diary", build: (body: unknown) => Report): Part {
  const [part, setPart] = useState<Part>({ kind: "reading" });
  useEffect(() => {
    let live = true;
    readWeekend(which).then(
      (body) => live && setPart({ kind: "ok", report: build(body) }),
      (e) => live && setPart({ kind: "failed", why: messageOf(e) }),
    );
    return () => {
      live = false;
    };
  }, [which, build]);
  return part;
}

function Shown({ part, what }: { part: Part; what: string }) {
  if (part.kind === "reading") return <p className="dim">Reading Blue Agent&apos;s {what}…</p>;
  if (part.kind === "failed") return <p className="crt__amber">{part.why} Nothing is shown in its place.</p>;
  return <ReportView report={part.report} />;
}

/** The Weekend window: Blue Agent's scorecard and diary, shown here and credited (server/weekend.ts). */
export function WeekendPanel() {
  const scorecard = usePart("scorecard", scorecardReport);
  const diary = usePart("diary", diaryReport);
  return (
    <div className="panel">
      <p className="panel__lede">
        Stock tokens trade on Base all weekend while their price feed waits for Monday. Blue Agent calls each weekend from Base&apos;s price and grades it at the
        open — every call, right or wrong. Data by{" "}
        <a href={WEEKEND_PAGE} target="_blank" rel="noopener noreferrer">
          Blue Agent
        </a>
        .
      </p>
      <Shown part={scorecard} what="weekend scorecard" />
      <Shown part={diary} what="weekend diary" />
    </div>
  );
}
