import { BRAND } from "@/brand";
import { findSkill } from "@/skills";
import type { Skill } from "@/skills/types";
import { isEnabled, resolveDoc, resolveFeature, visibleFeatures, type WindowId } from "@/features/registry";

/**
 * One language for the whole app (2026-10-02, the owner: "link everything together — the Terminal
 * should reach the other features"). A command line either RUNS A SKILL (`verdict 0x…`) or OPENS A
 * WINDOW, with what that window should show (`coin 0x…`, `profile name.base.eth`, `send 0x…`,
 * `swap 0x…`, `open markets`). The Terminal types it; a report's next step IS one; a button in a
 * window runs one. So every way of getting somewhere is the same string, and cannot drift.
 *
 * A window's arguments travel as URL parameters — `t` (a coin's page) and `a` (whose profile) are
 * the window's state and stay; `run-<window>`, `to` and `buy` are one-time instructions the window
 * applies and then clears (`useInbox`). `run` carries the window's id because several windows run
 * skills, and an instruction meant for one must not be taken by another that happens to be open.
 */

export type Opening = { readonly window: WindowId; readonly params: Readonly<Record<string, string>> };

export type Command =
  | { readonly kind: "empty" }
  | { readonly kind: "help" }
  | { readonly kind: "clear" }
  | { readonly kind: "windows" }
  | { readonly kind: "skill"; readonly skill: Skill; readonly args: readonly string[] }
  | { readonly kind: "open"; readonly opening: Opening }
  | { readonly kind: "off"; readonly title: string }
  | { readonly kind: "unknown"; readonly word: string }
  /** a line the machine answers in its own voice — the Terminal's easter eggs */
  | { readonly kind: "say"; readonly text: string };

/** The window a skill lives in — where a button that runs it takes you. */
export const SKILL_HOME: Readonly<Record<string, WindowId>> = {
  verdict: "safety",
  gate: "safety",
  sendcheck: "safety",
  radar: "research",
  forensics: "research",
  launcher: "research",
  launch: "terminal",
};

type Shortcut = { readonly window: WindowId; readonly param?: string; readonly usage: string };

/** Words that open a window, and which of its parameters an argument fills. */
export const SHORTCUTS: Readonly<Record<string, Shortcut>> = {
  coin: { window: "coins", param: "t", usage: "coin [0x…]" },
  coins: { window: "coins", param: "t", usage: "coins" },
  profile: { window: "profile", param: "a", usage: "profile [0x… or name]" },
  me: { window: "profile", usage: "me" },
  send: { window: "send", param: "to", usage: "send [0x… or name]" },
  swap: { window: "swap", param: "buy", usage: "swap [token 0x…]" },
  buy: { window: "swap", param: "buy", usage: "buy <token 0x…>" },
  trade: { window: "trade", usage: "trade" },
  markets: { window: "markets", usage: "markets" },
  wallet: { window: "wallet", usage: "wallet" },
  connect: { window: "wallet", usage: "connect" },
  launch: { window: "launch", usage: "launch" },
  research: { window: "research", usage: "research" },
  safety: { window: "safety", usage: "safety" },
  x402: { window: "x402", usage: "x402" },
  mcp: { window: "mcp", usage: "mcp" },
  terminal: { window: "terminal", usage: "terminal" },
  docs: { window: "docs", usage: "docs" },
  api: { window: "api", usage: "api" },
  verify: { window: "verify", usage: "verify" },
  taskmgr: { window: "taskmgr", usage: "taskmgr" },
  top: { window: "taskmgr", usage: "top" },
  trash: { window: "trash", usage: "trash" },
  rugs: { window: "trash", usage: "rugs" },
  rugsweeper: { window: "rugsweeper", usage: "rugsweeper" },
  sweep: { window: "rugsweeper", usage: "sweep" },
  achievements: { window: "achievements", usage: "achievements" },
  leaderboard: { window: "leaderboard", usage: "leaderboard" },
};

/**
 * What the machine says to the words people type into any terminal to see what happens. Fixed
 * answers, in the era's voice; none of them runs anything.
 */
export const EASTER: Readonly<Record<string, string>> = {
  ver: `${BRAND.name} OS 1.0 for Base 8453 · 2 s blocks · 0 keys held · an on-chain supercomputer`,
  about: `${BRAND.name}: a Base supercomputer named after a 1991 Macintosh. It reads the chain, checks before you sign, and never holds your key.`,
  sudo: "Nice try. There is no root here: nobody holds a key on this computer, not even me.",
  rm: "Deleting is for pools. See the Recycle Bin — type `trash`.",
  hello: "Hello. Type `radar` to see what launched on Base in the last hour.",
  hi: "Hi. Type `help` for everything I can do.",
  gm: "gm. Base made about 43,000 blocks while you slept.",
  whoami: "You are whoever your wallet says — and only your wallet can say it. Type `me` for your profile.",
  date: "It is always block time here. Click the clock on the taskbar for the latest block.",
  exit: "There is no exit. Only Base.",
  fortune: "A token whose sell is simulated is worth two in the honeypot. — run `verdict 0x…` before you buy",
  wen: "Soon. Everything in the Coming Soon folder is waiting on something real.",
  ping: "pong — from Base, every 2 seconds.",
};

/** A window by a shortcut, its id, or its title — `open Markets`, `open coins`. */
function windowNamed(name: string): Shortcut | null {
  const word = name.toLowerCase();
  if (SHORTCUTS[word]) return SHORTCUTS[word];
  const f = resolveFeature(word) ?? [...visibleFeatures()].find((x) => x.title.toLowerCase() === word) ?? null;
  // the doc pages (docs, api, verify) are shortcuts by their own names, so a feature is all that is left
  return f ? { window: f.id, usage: f.id } : null;
}

function opening(s: Shortcut, args: readonly string[]): Command {
  const f = resolveFeature(s.window);
  if (f && !isEnabled(f)) return { kind: "off", title: f.title };
  const params = s.param && args[0] ? { [s.param]: args[0] } : {};
  return { kind: "open", opening: { window: s.window, params } };
}

export function parseCommand(line: string): Command {
  const [first, ...args] = line.trim().split(/\s+/);
  if (!first) return { kind: "empty" };
  const word = first.toLowerCase();
  if (word === "help" || word === "?") return { kind: "help" };
  if (word === "clear" || word === "cls") return { kind: "clear" };
  if (word === "windows" || word === "apps") return { kind: "windows" };
  if (EASTER[word] && !findSkill(word) && !SHORTCUTS[word]) return { kind: "say", text: EASTER[word]! };
  if (word === "open") {
    const s = args[0] ? windowNamed(args[0]) : null;
    return s ? opening(s, args.slice(1)) : { kind: "unknown", word: args[0] ?? "open" };
  }
  const skill = findSkill(word);
  const shortcut = SHORTCUTS[word];
  // a word that is both (launch): bare, it opens the window; with arguments, it runs the skill
  if (shortcut && !(skill && args.length > 0)) return opening(shortcut, args);
  return skill ? { kind: "skill", skill, args } : { kind: "unknown", word: first };
}

/** The URL parameter that tells one window to run a command. */
export const runKey = (window: WindowId) => `run-${window}`;

/** A skill command run from a window: its home window, told to run it. */
export function skillOpening(skill: Skill, args: readonly string[]): Opening {
  const window = SKILL_HOME[skill.id] ?? "terminal";
  return { window, params: { [runKey(window)]: [skill.id, ...args].join(" ") } };
}

/** `windows`, as text: every window a command opens, and how. */
export function windowsText(): string {
  const lines = Object.entries(SHORTCUTS)
    .filter(([word, s]) => word === s.usage.split(" ")[0])
    .filter(([, s]) => {
      const f = resolveFeature(s.window);
      return !f || isEnabled(f);
    })
    .map(([, s]) => {
      const f = resolveFeature(s.window);
      const d = resolveDoc(s.window);
      return `${s.usage.padEnd(40)} ${f ? `${f.title} — ${f.blurb}` : `${d!.title} — ${d!.blurb}`}`;
    });
  return [...lines, "", "open <window>                            any window by its name"].join("\n");
}
