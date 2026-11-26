import { useEffect, useState } from "react";
import { EXPLAIN_PATH } from "@/server/explainPath";
import type { Report } from "@/skills/types";
import { Gel } from "@/ui/Gel";

const ADDRESS_RE = /(0x[0-9a-fA-F]{40})$/;

export type ExplainTarget = { readonly skill: "verdict" | "sendcheck"; readonly args: readonly string[] };

/**
 * Only Token Verdict and Send Check reports offer a plain-English explanation via Venice.
 * Extracts `{ skill, args }` so the server rebuilds the report itself — never sending raw text,
 * amounts, or wallet history from the browser.
 */
export function explainTarget(report: Report): ExplainTarget | null {
  if (report.title.endsWith("— Token Verdict") || report.title.startsWith("Token Verdict —")) {
    const tokenRow = report.rows.find((r) => r.label === "Token");
    const address = tokenRow?.href?.match(ADDRESS_RE)?.[1] ?? report.title.match(ADDRESS_RE)?.[1];
    return address ? { skill: "verdict", args: [address] } : null;
  }
  if (report.title.startsWith("Send Check —")) {
    const target = report.title.slice("Send Check —".length).trim();
    return target ? { skill: "sendcheck", args: [target] } : null;
  }
  return null;
}

export function isExplainable(report: Report): boolean {
  return explainTarget(report) !== null;
}

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly explanation: string; readonly model: string }
  | { readonly kind: "error"; readonly message: string };

export function ExplainReport({ report, rowsId }: { report: Report; rowsId: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    setState({ kind: "idle" });
  }, [report]);

  const target = explainTarget(report);
  if (!target) return null;

  const explain = async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(EXPLAIN_PATH, {
        method: "POST",
        headers: { "content-type": "application/json", "x-quadra": "1" },
        body: JSON.stringify(target),
      });
      const body = (await res.json()) as { explanation?: unknown; model?: unknown; error?: unknown };
      if (!res.ok || typeof body.explanation !== "string" || typeof body.model !== "string") {
        setState({
          kind: "error",
          message: typeof body.error === "string" ? body.error : `Explanation could not be read (HTTP ${res.status}).`,
        });
        return;
      }
      setState({ kind: "ready", explanation: body.explanation, model: body.model });
    } catch {
      setState({ kind: "error", message: "Could not reach the explanation service." });
    }
  };

  return (
    <div className="report__explain-wrap">
      {state.kind === "ready" ? (
        <div className="report__explain" role="region" aria-label="Plain-English explanation">
          <p>{state.explanation}</p>
          <p className="dim">
            Explanation by Venice ({state.model}), from this report only —{" "}
            <a href={`#${rowsId}`}>see the report rows</a>.
          </p>
        </div>
      ) : (
        <Gel quiet disabled={state.kind === "loading"} onClick={() => void explain()}>
          {state.kind === "loading" ? "Asking Venice…" : "Explain in plain words"}
        </Gel>
      )}
      {state.kind === "error" ? <p className="tx__warn">{state.message}</p> : null}
    </div>
  );
}
