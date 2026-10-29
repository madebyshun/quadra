import { useState } from "react";
import { messageOf } from "@/lib/errors";
import { tokenVerdict } from "@/skills/verdict";
import type { Report } from "@/skills/types";

/**
 * Token Verdict as a badge on a list row (2026-10-29): a coin is checked when somebody asks, not on
 * load — a verdict simulates a trade and reads four sources, and a list of 25 would be 25 of those at
 * once. The answer is kept for the page's life, so a badge seen once stays. Its words are the verdict's
 * own three answers, never "safe".
 */

const seen = new Map<string, Promise<Report>>();

/** The verdict's three answers, shortened for a badge: the words before the score, and the score. */
export function badgeOf(report: Report): { readonly text: string; readonly tone: "ok" | "warn" | "bad"; readonly title: string } {
  const v = report.rows.find((r) => r.label === "Verdict")!;
  const [words, rest] = v.value.split(" — ");
  const score = /^(\d+)\/100/.exec(rest ?? "")?.[1];
  return { text: score ? `${words} ${score}` : words!, tone: (v.tone ?? "warn") as "ok" | "warn" | "bad", title: v.value };
}

/** Forget every verdict — for tests. */
export function forgetBadges(): void {
  seen.clear();
}

export function VerdictBadge({ token, now = Date.now }: { token: string; now?: () => number }) {
  const [state, setState] = useState<Report | "running" | { readonly problem: string } | null>(null);
  const check = () => {
    setState("running");
    const key = token.toLowerCase();
    if (!seen.has(key)) seen.set(key, tokenVerdict(token, now()));
    seen.get(key)!.then(setState, (e: unknown) => {
      seen.delete(key);
      setState({ problem: messageOf(e) });
    });
  };
  if (state === null) {
    return (
      <button type="button" className="chip" aria-label={`Check ${token}`} onClick={check}>
        Check
      </button>
    );
  }
  if (state === "running") return <span className="badge dim">checking…</span>;
  if ("problem" in state) {
    return (
      <button type="button" className="chip badge--warn" title={state.problem} aria-label={`Check ${token} again`} onClick={check}>
        not checked
      </button>
    );
  }
  const b = badgeOf(state);
  return (
    <span className={`badge badge--${b.tone}`} title={b.title} aria-label={`Verdict: ${b.title}`}>
      {b.text}
    </span>
  );
}
