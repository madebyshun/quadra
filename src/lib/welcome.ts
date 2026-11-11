import { BRAND } from "@/brand";
import type { Activity } from "@/skills/activity";
import type { Bin } from "@/skills/rugs";

/**
 * The Welcome screen's rules and words (`ui/Welcome.tsx` draws it). Whether it shows is remembered
 * under `WELCOME_KEY` — frozen, like every key some browser already holds. Its tips are a mix of
 * fixed ones that are true of this app and LIVE ones read from the chain; a live tip exists only
 * once its reading came back, so no tip ever carries a number nobody read.
 */

export const WELCOME_KEY = "quadra.welcome.v1";

/** Unreadable storage shows it: a missing answer is not "the visitor turned it off". */
export function welcomeOn(): boolean {
  try {
    return globalThis.localStorage?.getItem(WELCOME_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setWelcomeOn(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(WELCOME_KEY, on ? "on" : "off");
  } catch {
    // forgetting the choice only means the Welcome screen says hello again next time
  }
}

/** Whether a page load opens with the Welcome screen: not for a `?do=` link, nor once it was switched off. */
export function showWelcome(search: string): boolean {
  return !new URLSearchParams(search).get("do") && welcomeOn();
}

/** Fixed tips, true of this app — in the voice of the era's "Did you know…" box. */
export const FIXED_TIPS: readonly string[] = [
  "Before you buy a coin, type verdict 0x… in the Terminal. It reads the trade, the code, the holders and the launcher, and answers in one line.",
  `Coins launched on ${BRAND.name} cannot be minted, paused or pulled: the contract has no function for any of it. Nobody holds a role, not even us.`,
  "Never copy an address from your transaction history. Scammers plant look-alikes there (address poisoning) — Send refuses an address a fake transfer planted.",
  "The Trash holds pools that were emptied today. Please don't restore anything.",
  "Task Manager shows Base as this computer's CPU: every block, its transactions and how full it was, live.",
  "Rugsweeper's mines are real launches the radar flagged red. Clear the board without stepping on one.",
  "Turn the sound on with the speaker in the tray. It is off until you ask.",
  "Press Esc to close the window on top.",
  "Type sudo in the Terminal. You'll see.",
  "Your Base card is under Make my Base card — a picture of your wallet's year on Base, made in your browser.",
  "Agents can use every skill too: over MCP, or paid per call with x402.",
  `${BRAND.name} never holds your key. Every send, swap and launch is checked here and signed in your own wallet.`,
  "Send Check looks at an address before you pay it: a token contract, a look-alike, a name that points somewhere else.",
  "Launch Radar lists every pool opened on Uniswap v4 in the last hour, with the launchpad that opened it.",
];

const n = (v: number) => v.toLocaleString("en-US");

/** Blocks Base made since the page opened, from the first and latest blocks the pulse read. */
export function blocksTip(first: number, latest: number): string {
  const made = latest - first;
  return made > 0
    ? `Base has made ${n(made)} ${made === 1 ? "block" : "blocks"} since you opened this page. The latest is #${n(latest)}.`
    : `The latest Base block is #${n(latest)}, read from the chain a moment ago. A new one comes five times a second.`;
}

/** Pools opened on Uniswap v4 in the last minutes, and the busiest launchpad among them. */
export function activityTip(a: Activity): string {
  if (a.total === 0) return `No pool opened on Uniswap v4 on Base in the last ${a.minutes} minutes. Quiet, for once.`;
  const pads = a.processes.filter((p) => p.name !== "no hook" && p.name !== "everything else");
  const top = pads.reduce<(typeof pads)[number] | null>((best, p) => (best && best.launches >= p.launches ? best : p), null);
  const pools = `${n(a.total)} ${a.total === 1 ? "pool" : "pools"} opened on Uniswap v4 on Base in the last ${a.minutes} minutes.`;
  return top ? `${pools} The busiest launchpad: ${top.name}, with ${n(top.launches)}.` : pools;
}

/** What the Trash read: emptied pools in the last hours, never fewer than were found. */
export function binTip(b: Bin): string {
  const hours = b.minutes / 60;
  const unread = b.unread ? ` (${b.unread} more could not be read)` : "";
  if (b.emptied.length === 0 && b.unread === 0) return `No pool on Uniswap v4 was emptied in the last ${hours} hours. The Trash is empty — for now.`;
  return `${b.emptied.length} ${b.emptied.length === 1 ? "coin's pool was" : "coins' pools were"} emptied in the last ${hours} hours${unread}. They are in the Trash. Don't restore anything.`;
}

export type Live = {
  readonly blocks: { readonly first: number; readonly latest: number } | null;
  readonly activity: Activity | null;
  readonly bin: Bin | null;
};

/** The tips in the order Next Tip walks them: live ones first (when read), the fixed ones, the Trash last (read lazily). */
export function tipsFor(live: Live): string[] {
  return [
    ...(live.activity ? [activityTip(live.activity)] : []),
    ...(live.blocks ? [blocksTip(live.blocks.first, live.blocks.latest)] : []),
    ...FIXED_TIPS,
    ...(live.bin ? [binTip(live.bin)] : []),
  ];
}
