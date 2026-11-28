import { BRAND } from "@/brand";
import { FLAGS, type FlagName } from "@/config/chain";

/**
 * The whole app is one page. `?do=<id>` picks which window is open; no id means
 * the desktop. Ids are permanent — a link someone saved has to keep working.
 */
export type FeatureId =
  | "wallet"
  | "terminal"
  | "research"
  | "safety"
  | "markets"
  | "trade"
  | "send"
  | "swap"
  | "bridge"
  | "launch"
  | "coins"
  | "stocks"
  | "profile"
  | "taskmgr"
  | "trash"
  | "soon"
  | "rugsweeper"
  | "achievements"
  | "leaderboard"
  | "card"
  | "explore"
  | "weekend"
  | "basket"
  | "x402"
  | "mcp"
  | "inference"
  | "audit"
  | "hooks"
  // the desktop's folders and their programs (2026-10-21)
  | "computer"
  | "control"
  | "readme"
  | "folder-research"
  | "folder-money"
  | "folder-launchpad"
  | "folder-games"
  | "folder-agents";

/** A program that is a folder: its window lists other programs, Explorer-style. */
export type FolderId = "computer" | "folder-research" | "folder-money" | "folder-launchpad" | "folder-games" | "folder-agents";

/**
 * The three prose pages. They are not features — no flag switches them on, they
 * call no adapter — but they open the same way a feature does, as a window on
 * the desktop. They were plain routes until 2026-09-28, and navigating to one
 * threw away the header, the badges and every other open window; a window keeps
 * all of it and a saved `/docs` link still works, because the routes stay.
 */
export type DocId = "docs" | "api" | "verify";

export type DocPage = {
  id: DocId;
  /** the word on the icon */
  title: string;
  blurb: string;
  /** title bar text when the window is open */
  window: string;
  /** the standalone route, still served for anyone who saved the link */
  path: string;
};

/** A dynamic per-token window (`token:0x...`), so multiple tokens can be opened and traded simultaneously. */
export type TokenWindowId = `token:${string}`;

/** Every id a desktop window can hold: a feature, a doc page, or a per-token window. */
export type WindowId = FeatureId | DocId | TokenWindowId;

const TOKEN_LABELS = new Map<string, string>();

export function isTokenWindow(id: string | null | undefined): id is TokenWindowId {
  return typeof id === "string" && id.startsWith("token:") && /^token:0x[0-9a-fA-F]{40}$/.test(id);
}

export function tokenAddressOf(id: TokenWindowId): string {
  return id.slice(6);
}

export function registerTokenLabel(address: string, label: string): void {
  if (!label.trim()) return;
  TOKEN_LABELS.set(address.toLowerCase(), label.trim());
}

export function tokenWindowId(address: string, label?: string): TokenWindowId {
  const lower = address.toLowerCase();
  if (label) registerTokenLabel(lower, label);
  return `token:${lower}`;
}

export type Feature = {
  id: FeatureId;
  /** the word on the card */
  title: string;
  /** one line, second person, no jargon — this is the voice of the product */
  blurb: string;
  /** title bar text when the window is open */
  window: string;
  /** which flag switches it on — absent for the desktop's own furniture (folders, Control Panel, README), always on */
  flag?: FlagName;
  /** a feature that only works on Robinhood Chain — hidden while `FLAGS.robinhood` is off */
  robinhood?: true;
};

export const FEATURES: readonly Feature[] = [
  /*
    Order is the order of the desktop, since 2026-09-30 when the product became an
    "on-chain supercomputer": connect, then the two ways in to every skill (the Terminal
    and the windows), then the money actions, then the agent surfaces. The privacy
    features that used to lead the list were archived — see archive/privacy/.
  */
  {
    id: "wallet",
    title: "Wallet",
    blurb: "connect one you control",
    window: "Connect wallet",
    flag: "wallet",
  },
  {
    id: "terminal",
    title: "Terminal",
    blurb: "every skill, typed",
    window: "Terminal",
    flag: "terminal",
  },
  {
    id: "research",
    title: "Radar",
    blurb: "new launches, stock loans, trade depth",
    window: "Radar · Collateral · Depth",
    flag: "research",
  },
  {
    id: "safety",
    title: "Check",
    blurb: "any token or address, before you act",
    window: "Check",
    flag: "safety",
  },
  {
    id: "markets",
    title: "Markets",
    blurb: "prices, charts and trade — crypto & stocks",
    window: "Markets",
    flag: "markets",
  },
  {
    id: "trade",
    title: "Trade",
    blurb: "crypto and stocks on Base",
    window: "Trade",
    flag: "trade",
  },
  {
    id: "send",
    title: "Send",
    blurb: "pay any address or Basename",
    window: "Send",
    flag: "send",
  },
  {
    id: "swap",
    title: "Swap",
    blurb: "trade any token on Base",
    window: "Swap",
    flag: "swap",
  },
  {
    id: "bridge",
    title: "Bridge",
    blurb: "to Robinhood Chain",
    window: "Bridge",
    flag: "bridge",
    robinhood: true,
  },
  {
    id: "launch",
    title: "Launch",
    blurb: "a coin on base, paired with eth or a stock",
    window: "Launch",
    flag: "launch",
  },
  {
    id: "coins",
    title: "Coins",
    blurb: "every coin launched here",
    window: "Coins",
    flag: "coins",
  },
  {
    id: "stocks",
    title: "Stocks",
    blurb: "Base tokenized stocks — launch paired with any stock",
    window: "Stocks",
    flag: "coins",
  },
  {
    id: "profile",
    title: "Profile",
    blurb: "any wallet: holdings, coins, history",
    window: "Profile",
    flag: "profile",
  },
  {
    id: "taskmgr",
    title: "Task Manager",
    blurb: "the CPU is Base: blocks, gas, launches",
    window: "Task Manager — Base 8453",
    flag: "taskmgr",
  },
  {
    id: "rugsweeper",
    title: "Rugsweeper",
    blurb: "minesweeper, where the mines are real",
    window: "Rugsweeper",
    flag: "rugsweeper",
  },
  {
    id: "achievements",
    title: "Achievements",
    blurb: "what your wallet has earned",
    window: "Achievements",
    flag: "achievements",
  },
  {
    id: "leaderboard",
    title: "Leaderboard",
    blurb: "top launchers and coins here",
    window: "Leaderboard",
    flag: "leaderboard",
  },
  {
    id: "card",
    title: "Base card",
    blurb: "your X profile, painted as a card",
    window: "Make my Base card",
    flag: "card",
  },
  // a directory of projects on Base, from base.org's own list (2026-10-22) — no flag: it reads nothing live
  { id: "explore", title: "Explore Base", blurb: "projects on Base, folder by folder", window: "Explore Base" },
  { id: "basket", title: "Treasury Basket", blurb: "a basket of stocks, held in your wallet", window: "Treasury Basket", flag: "basket" },
  { id: "weekend", title: "Weekend", blurb: "does Base's weekend price call Monday?", window: "Weekend — by Blue Agent", flag: "weekend" },
  {
    id: "x402",
    title: "x402",
    blurb: "these tools, paid per call",
    window: "x402",
    flag: "x402",
  },
  {
    id: "mcp",
    title: "MCP",
    blurb: "hand all of it to an agent",
    window: "MCP tools",
    flag: "mcp",
  },
  {
    id: "inference",
    title: "Inference",
    blurb: "rent a private GPU",
    window: "Private inference",
    flag: "inference",
  },
  {
    id: "audit",
    title: "Audit",
    blurb: "score any GitHub repo",
    window: "Audit",
    flag: "audit",
  },
  {
    id: "hooks",
    title: "Hooks",
    blurb: "what runs on your swap",
    window: "Hooks",
    flag: "hooks",
  },
  {
    id: "soon",
    title: "Coming Soon",
    blurb: "programs still in the box",
    window: "Coming Soon",
    flag: "soon",
  },
  {
    id: "trash",
    title: "Trash",
    blurb: "pools emptied today",
    window: "Trash",
    flag: "trash",
  },
  /*
    The desktop's furniture (2026-10-21, the owner: "sắp xếp lại thư mục" — put things in folders).
    Folders hold THIS app's programs only; no flag, because a folder is never the thing that is off.
  */
  { id: "computer", title: "My Computer", blurb: "everything else: tools, games, settings", window: "My Computer" },
  { id: "folder-research", title: "Research", blurb: "radar, markets, profiles, Base apps", window: "Research" },
  { id: "folder-money", title: "Money", blurb: "treasury basket, bridge", window: "Money" },
  { id: "folder-launchpad", title: "Launchpad", blurb: "the leaderboard, your Base card", window: "Launchpad" },
  { id: "folder-games", title: "Games", blurb: "real mines, and trophies", window: "Games" },
  { id: "folder-agents", title: "Agents", blurb: "tools your AI agent can use", window: "Agents" },
  { id: "control", title: "Control Panel", blurb: "desktop pattern, sound, screen saver", window: "Control Panel" },
  { id: "readme", title: "Read Me", blurb: "start here", window: "Read Me" },
] as const;

export const DOC_PAGES: readonly DocPage[] = [
  {
    id: "docs",
    title: "Docs",
    blurb: "how it works, and what it holds",
    window: `Docs — ${BRAND.name}`,
    path: "/docs",
  },
  {
    id: "api",
    title: "API",
    blurb: "every skill, paid per call",
    window: "API",
    path: "/api",
  },
  {
    id: "verify",
    title: "Verify",
    blurb: "check any link",
    window: "Verify",
    path: "/verify",
  },
] as const;

const BY_ID = new Map<string, Feature>(FEATURES.map((f) => [f.id, f]));
const DOCS_BY_ID = new Map<string, DocPage>(DOC_PAGES.map((d) => [d.id, d]));

/** Resolve `?do=` to a feature, or null for the desktop. Unknown ids are null. */
export function resolveFeature(raw: string | null): Feature | null {
  if (!raw) return null;
  return BY_ID.get(raw) ?? null;
}

/** Resolve an id to a doc page, or null if it is not one. */
export function resolveDoc(raw: string | null): DocPage | null {
  if (!raw) return null;
  return DOCS_BY_ID.get(raw) ?? null;
}

/**
 * The title bar text for any open window. One function so `App.tsx` and the
 * taskbar cannot disagree about what a window is called.
 */
export function windowTitle(id: WindowId): string {
  if (isTokenWindow(id)) {
    const addr = tokenAddressOf(id);
    const label = TOKEN_LABELS.get(addr.toLowerCase());
    return label ?? `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }
  const doc = resolveDoc(id);
  return doc ? doc.window : resolveFeature(id)!.window;
}

/** Whether a Robinhood Chain feature may show at all — read at call time, so a test can flip the flag. */
export function hiddenChain(f: Feature): boolean {
  return f.robinhood === true && !FLAGS.robinhood;
}

export function isEnabled(f: Feature): boolean {
  return (f.flag === undefined || FLAGS[f.flag]) && !hiddenChain(f);
}

/**
 * Cards shown on the desktop: off ones still visible but marked — except a feature whose chain is
 * hidden (Robinhood Chain, 2026-10-02), which is not shown at all. Its `?do=` id still resolves,
 * to a window saying it is off: ids are permanent.
 */
export function visibleFeatures(): readonly Feature[] {
  return FEATURES.filter((f) => !hiddenChain(f));
}

/** Programs that live in a fixed spot on the desktop rather than in the icon grid. */
export const CORNER: ReadonlySet<FeatureId> = new Set<FeatureId>(["trash"]);

/** Visible programs that are switched off: they wait in the Coming Soon folder, not on the desktop. */
export function comingSoon(): readonly Feature[] {
  return visibleFeatures().filter((f) => !isEnabled(f));
}

/**
 * What a folder holds, in the order it shows them. Ids only — a link to any of them still opens it directly.
 * Since 2026-10-29 (the owner: "extremely simple, no overlapping features") the desktop carries the four
 * things people come for and Agents; My Computer holds everything else, the other folders among it.
 */
/** Features merged into another window: their `?do=` id stays valid, without a duplicate desktop/folder icon. */
export const ALIAS_FEATURES: ReadonlySet<FeatureId> = new Set<FeatureId>(["trade"]);

export const FOLDERS: Readonly<Record<FolderId, readonly WindowId[]>> = {
  computer: ["folder-research", "folder-money", "folder-launchpad", "folder-games", "terminal", "taskmgr", "control", "readme", "soon"],
  "folder-research": ["research", "profile", "explore"],
  "folder-money": ["basket", "bridge"],
  "folder-launchpad": ["stocks", "leaderboard", "card"],
  "folder-games": ["rugsweeper", "achievements"],
  "folder-agents": ["mcp", "x402", "api", "docs", "verify"],
};

/** The folders in desktop order. */
export const FOLDER_IDS: readonly FolderId[] = Object.keys(FOLDERS) as FolderId[];

export function isFolder(id: string): id is FolderId {
  return Object.prototype.hasOwnProperty.call(FOLDERS, id);
}

/** One icon anywhere — a desktop, a folder, the Start menu: a feature or a doc page, by its id. */
export type Entry = { readonly id: WindowId; readonly title: string; readonly blurb: string; readonly doc: DocPage | null };

export function entryOf(id: WindowId): Entry {
  const doc = resolveDoc(id);
  const f = doc ? null : resolveFeature(id)!;
  return doc ? { id, title: doc.title, blurb: doc.blurb, doc } : { id, title: f!.title, blurb: f!.blurb, doc: null };
}

/** Whether an id is worth an icon: a doc page always; a feature when it is on — Coming Soon only while it holds something. */
function shown(id: WindowId): boolean {
  const f = resolveFeature(id);
  if (!f) return true;
  if (id === "soon") return comingSoon().length > 0;
  return isEnabled(f);
}

/** A folder's icons: its switched-on programs (off ones wait in Coming Soon; a hidden chain's not at all). */
export function folderItems(id: FolderId): readonly Entry[] {
  return FOLDERS[id].filter(shown).map(entryOf);
}

/** Which folder a window lives in, or null for one that sits on the desktop itself. */
export function folderOf(id: WindowId): FolderId | null {
  return FOLDER_IDS.find((f) => FOLDERS[f].includes(id)) ?? null;
}

/**
 * The desktop's icons since 2026-10-29: Check, Coins, Launch and Wallet — one door for each thing the app
 * does — then Agents and My Computer, which holds the rest. The Trash keeps its corner (`CORNER`).
 */
export const DESKTOP: readonly WindowId[] = ["markets", "stocks", "send", "swap", "safety", "weekend", "coins", "launch", "profile", "wallet", "folder-agents", "computer"];

export function desktopItems(): readonly Entry[] {
  return DESKTOP.filter(shown).map(entryOf);
}
