import { tokenVerdict } from "@/skills/verdict";
import { row, type Report, type Row, type Skill } from "@/skills/types";

/**
 * Token Gate — Token Verdict reduced to what an agent branches on: `allow`, `caution` or `block`,
 * with reason codes. MEASURED 2026-10-02 on Coinbase's Bazaar and x402scan: the token checks agents
 * call most answer a decision plus codes (cyberwarex's /risk/explain at $0.01), not a page of prose.
 * The same reads as the full verdict; only the answer is shaped for a machine.
 *
 * A code is the failing row's label, lowercased with dashes, then `:block` or `:caution` —
 * `buy-sell-simulated-now:block`. A check that could not run is a caution (hard rule 12): an unread
 * answer never passes as a clean one.
 */

export type Decision = "allow" | "caution" | "block";

/** `Top 10 holders` → `top-10-holders`. */
export function codeOf(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The decision and its reasons, from a verdict's body rows (not its title rows). */
export function gateOf(rows: readonly Row[]): { readonly decision: Decision; readonly reasons: readonly string[] } {
  const body = rows.filter((r) => r.label !== "Token" && r.label !== "Verdict");
  const reasons = body.flatMap((r) => (r.tone === "bad" ? [`${codeOf(r.label)}:block`] : r.tone === "warn" ? [`${codeOf(r.label)}:caution`] : []));
  const decision: Decision = body.some((r) => r.tone === "bad") ? "block" : body.some((r) => r.tone === "warn") ? "caution" : "allow";
  return { decision, reasons };
}

const TONE = { allow: "ok", caution: "warn", block: "bad" } as const;

export async function tokenGate(input: string, now: number): Promise<Report> {
  const verdict = await tokenVerdict(input, now);
  const { decision, reasons } = gateOf(verdict.rows);
  const score = verdict.rows.find((r) => r.label === "Verdict")!.value.match(/(\d+)\/100/)![1]!;
  const flagged = verdict.rows.filter((r) => r.label !== "Verdict" && (r.tone === "bad" || r.tone === "warn"));
  return {
    title: verdict.title.replace("Token Verdict", "Token Gate"),
    rows: [
      row("Decision", decision, { tone: TONE[decision] }),
      row("Score", `${score}/100`),
      row("Reasons", reasons.length ? reasons.join(", ") : "none"),
      verdict.rows[0]!,
      ...flagged.map((r) => row(r.label, r.value, { tone: r.tone! })),
    ],
    notes: [
      "allow = no red or amber line; caution = an amber line, or a check that could not run; block = a red line. A decision for a machine to branch on — not advice.",
      ...verdict.notes.filter((n) => !n.startsWith("Red:")),
    ],
    sources: verdict.sources,
    next: [{ label: "The full verdict", command: `verdict ${input.trim()}` }, ...(verdict.next ?? []).filter((s) => !s.command.startsWith("verdict"))],
  };
}

export const gateSkill: Skill = {
  id: "gate",
  title: "Token Gate",
  summary: "Token Verdict as a decision an agent can branch on: allow, caution or block, with reason codes.",
  args: [{ name: "token address", hint: "0x…" }],
  run: ([input = ""]) => tokenGate(input, Date.now()),
};
