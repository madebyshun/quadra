import { radarSkill } from "@/skills/radar";
import { verdictSkill } from "@/skills/verdict";
import { gateSkill } from "@/skills/gate";
import { forensicsSkill } from "@/skills/forensics";
import { launcherSkill } from "@/skills/launcher";
import { sendCheckSkill } from "@/skills/sendcheck";
import { prepareLaunchSkill } from "@/skills/prepare";
import { collateralSkill } from "@/skills/collateral";
import { depthSkill } from "@/skills/depth";
import type { Report, Skill, Tone } from "@/skills/types";

/**
 * Every on-chain skill, and the Terminal's way of reaching them.
 *
 * Order is the order `help` lists them in: what people reach for first.
 *
 * 2026-10-01, the owner's decision: only skills a block explorer does NOT already answer.
 * Wallet, whales, explain-a-transaction, read-a-contract, Basenames and gas were deleted outright —
 * Basescan has every one of them. What they shared (Basename resolution for Send, token balances
 * and the ETH price for the wallet's assets) stays as library code beside the skills.
 */
export const SKILLS: readonly Skill[] = [verdictSkill, gateSkill, radarSkill, forensicsSkill, launcherSkill, sendCheckSkill, collateralSkill, depthSkill, prepareLaunchSkill];

/** Other words people type for the same skill. */
export const ALIASES: Readonly<Record<string, string>> = {
  token: "verdict",
  scan: "verdict",
  safety: "verdict",
  honeypot: "verdict",
  check: "verdict",
  launches: "radar",
  new: "radar",
  snipers: "forensics",
  bundles: "forensics",
  deployer: "launcher",
  creator: "launcher",
  pay: "sendcheck",
  recipient: "sendcheck",
  prepare: "launch",
  liquidation: "collateral",
  loans: "collateral",
  impact: "depth",
  slippage: "depth",
};

export function findSkill(word: string): Skill | null {
  const id = ALIASES[word] ?? word;
  return SKILLS.find((s) => s.id === id) ?? null;
}

export type Parsed =
  | { readonly kind: "empty" }
  | { readonly kind: "help" }
  | { readonly kind: "clear" }
  | { readonly kind: "run"; readonly skill: Skill; readonly args: readonly string[] }
  | { readonly kind: "unknown"; readonly word: string };

/** A Terminal line: a command word, case-insensitive, then space-separated arguments. */
export function parseLine(line: string): Parsed {
  const [first, ...args] = line.trim().split(/\s+/);
  if (!first) return { kind: "empty" };
  const word = first.toLowerCase();
  if (word === "help" || word === "?") return { kind: "help" };
  if (word === "clear" || word === "cls") return { kind: "clear" };
  const skill = findSkill(word);
  return skill ? { kind: "run", skill, args } : { kind: "unknown", word: first };
}

/** `help`, as text: one line per skill with how to call it. */
export function helpText(): string {
  const lines = SKILLS.map((s) => {
    const usage = [s.id, ...s.args.map((a) => (a.optional ? `[${a.name}]` : `<${a.name}>`))].join(" ");
    return `${usage.padEnd(40)} ${s.summary}`;
  });
  return [...lines, "", "clear                                    empty the screen"].join("\n");
}

const MARK: Record<Tone, string> = { ok: "✓", warn: "!", bad: "✗" };

/** A report as plain text — for the Terminal, and for an agent reading an MCP answer. */
export function reportText(report: Report): string {
  const width = Math.min(34, Math.max(...report.rows.map((r) => r.label.length), 8) + 2);
  return [
    `== ${report.title} ==`,
    ...report.rows.map((r) => `${r.tone ? `${MARK[r.tone]} ` : "  "}${r.label.padEnd(width)} ${r.value}`),
    ...(report.notes.length ? ["", ...report.notes.map((n) => `  ${n}`)] : []),
    `  sources: ${report.sources.join(", ")}`,
  ].join("\n");
}
