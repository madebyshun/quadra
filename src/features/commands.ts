import { BRAND } from "@/brand";
import { findSkill } from "@/skills";
import type { Skill } from "@/skills/types";
import { DESKTOP, FOLDER_IDS, entryOf, folderItems, isEnabled, isFolder, resolveFeature, visibleFeatures, type WindowId } from "@/features/registry";

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
  forensics: "safety",
  launcher: "safety",
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
  card: { window: "card", param: "c", usage: "card [@handle]" },
  // the desktop's folders and furniture (2026-10-21)
  computer: { window: "computer", usage: "computer" },
  money: { window: "folder-money", usage: "money" },
  launchpad: { window: "folder-launchpad", usage: "launchpad" },
  games: { window: "folder-games", usage: "games" },
  agents: { window: "folder-agents", usage: "agents" },
  control: { window: "control", usage: "control" },
  readme: { window: "readme", usage: "readme" },
};

/**
 * `open <folder>` opens the FOLDER: `open research` is the Research folder, while a bare `research`
 * stays the Research window it always was — a command somebody learnt keeps doing what it did.
 */
export const FOLDER_WORDS: Readonly<Record<string, WindowId>> = {
  research: "folder-research",
  money: "folder-money",
  launchpad: "folder-launchpad",
  games: "folder-games",
  agents: "folder-agents",
  computer: "computer",
};

/**
 * What the machine says to the words people type into any terminal to see what happens. Fixed
 * answers, in the era's voice; none of them runs anything.
 */
export const EASTER: Readonly<Record<string, string>> = {
  ver: `${BRAND.name} OS 1.0 for Base 8453 · 2 s blocks · 0 keys held · an on-chain supercomputer`,
  about: `${BRAND.name}: a Base supercomputer named after a 1991 Macintosh. It reads the chain, checks before you sign, and never holds your key.`,
  sudo: "Nice try. There is no root here: nobody holds a key on this computer, not even me.",
  rm: "Deleting is for pools. See the Trash — type `trash`.",
  hello: "Hello. Type `radar` to see what launched on Base in the last hour.",
  hi: "Hi. Type `help` for everything I can do.",
  gm: "gm. Base made about 43,000 blocks while you slept.",
  whoami: "You are whoever your wallet says — and only your wallet can say it. Type `me` for your profile.",
  date: "It is always block time here. Click the clock in the menu bar for the latest block.",
  exit: "There is no exit. Only Base.",
  fortune: "A token whose sell is simulated is worth two in the honeypot. — run `verdict 0x…` before you buy",
  wen: "Soon. Everything in the Coming Soon folder is waiting on something real.",
  ping: "pong — from Base, every 2 seconds.",
};

/** A window by a shortcut, its id, or its title — `open Markets`, `open coins`. */
function windowNamed(name: string): Shortcut | null {
  const word = name.toLowerCase();
  const folder = FOLDER_WORDS[word];
  if (folder) return { window: folder, usage: `open ${word}` };
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

/** How a window is opened by name: its own shortcut word (with its argument), else `open <id>`. */
function usageOf(id: WindowId): string {
  const own = Object.entries(SHORTCUTS).find(([word, sc]) => sc.window === id && word === sc.usage.split(" ")[0]);
  const folder = Object.entries(FOLDER_WORDS).find(([, w]) => w === id);
  return folder ? `open ${folder[0]}` : own ? own[1].usage : `open ${id}`;
}

function line(id: WindowId): string {
  const e = entryOf(id);
  return `  ${usageOf(id).padEnd(38)} ${e.title} — ${e.blurb}`;
}

/** `windows`, as text: the desktop, then each folder and what is in it — the same tree the screen shows. */
export function windowsText(): string {
  const desk = DESKTOP.filter((id) => !isFolder(id)).map(line);
  const folders = FOLDER_IDS.flatMap((f) => ["", line(f), ...folderItems(f).map((e) => `  ${line(e.id)}`)]);
  return ["On the desktop:", ...desk, line("trash"), "", "Folders:", ...folders.slice(1), "", "open <window>                            any window by its name"].join("\n");
}
