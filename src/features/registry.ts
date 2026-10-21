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
  | "profile"
  | "taskmgr"
  | "trash"
  | "soon"
  | "rugsweeper"
  | "achievements"
  | "leaderboard"
  | "x402"
  | "mcp"
  | "inference"
  | "audit"
  | "hooks";

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

/** Every id `?do=` accepts: a feature or a doc page. */
export type WindowId = FeatureId | DocId;

export type Feature = {
  id: FeatureId;
  /** the word on the card */
  title: string;
  /** one line, second person, no jargon — this is the voice of the product */
  blurb: string;
  /** title bar text when the window is open */
  window: string;
  /** which flag switches it on */
  flag: FlagName;
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
    title: "Research",
    blurb: "new launches, read from the chain",
    window: "Research",
    flag: "research",
  },
  {
    id: "safety",
    title: "Safety",
    blurb: "a simulated buy and sell, before you buy",
    window: "Safety",
    flag: "safety",
  },
  {
    id: "markets",
    title: "Markets",
    blurb: "prices and charts, tokens and stocks",
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
    blurb: "a coin on Base, nothing to rug",
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
    title: "Recycle Bin",
    blurb: "pools emptied today",
    window: "Recycle Bin",
    flag: "trash",
  },
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
  const doc = resolveDoc(id);
  return doc ? doc.window : resolveFeature(id)!.window;
}

/** Whether a Robinhood Chain feature may show at all — read at call time, so a test can flip the flag. */
export function hiddenChain(f: Feature): boolean {
  return f.robinhood === true && !FLAGS.robinhood;
}

export function isEnabled(f: Feature): boolean {
  return FLAGS[f.flag] && !hiddenChain(f);
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
 * The desktop's icon grid (2026-10-14): the switched-on programs only — three dimmed "not switched on
 * yet" icons made the desktop read like a settings page — plus the Coming Soon folder while anything
 * is waiting in it. The Recycle Bin sits in its own corner.
 */
export function desktopFeatures(): readonly Feature[] {
  const waiting = comingSoon().length > 0;
  return visibleFeatures().filter((f) => isEnabled(f) && !CORNER.has(f.id) && (f.id !== "soon" || waiting));
}
