/**
 * The home page's first seconds (2026-11-19, the owner: "không cần tạo mô hình 3D nữa", then "dựng
 * lại intro với góc chính diện giống Zara, sử dụng lại đoạn intro trong màn hình cũ"). A computer
 * seen straight on, floating between the sky and the sea of the /about photograph; only its screen is
 * alive — real HTML laid exactly over the glass. It powers on, shows this app's icon, then the old
 * intro's welcome box (welcome to quadra, a loading bar, the latest Base block read from the chain),
 * then lists the machine's programs like a contents page. Choosing one zooms into the tube and opens
 * that window on the desktop.
 *
 * Everything here is arithmetic, so it is tested without a browser.
 */

/** The drawing (features of intro/Machine.tsx) and where its glass sits, as fractions of it. */
export const MACHINE = {
  width: 1000,
  height: 900,
  screen: { left: 250 / 1000, top: 122 / 900, width: 500 / 1000, height: 384 / 900 },
} as const;

/** The sky and the sea behind the machine: the empty left of the /about photograph. */
export const BACKDROP = "/brand/computer-sky.webp";

/** The contents page on the tube: a numeral, a name, and the window it opens. */
export const MENU: readonly { readonly n: string; readonly label: string; readonly open: string }[] = [
  { n: "i", label: "check a token", open: "safety" },
  { n: "ii", label: "treasury basket", open: "basket" },
  { n: "iii", label: "launch a coin", open: "launch" },
  { n: "iv", label: "coins", open: "coins" },
  { n: "v", label: "wallet", open: "wallet" },
  { n: "vi", label: "read me", open: "readme" },
];

export type Phase = "haze" | "power" | "icon" | "welcome" | "menu" | "zoom";

/** When each phase begins, in ms from the start: starts straight at the logo icon, then a relaxed ~2.2s loading bar (~3s total). */
export const AT = { power: 0, icon: 0, welcome: 850, menu: 3050 } as const;
/** How long the zoom into the tube takes before the desktop shows. */
export const ZOOM_MS = 650;

/** The phase at `ms` before anything is chosen. */
export function phaseAt(ms: number): Exclude<Phase, "zoom"> {
  return ms < AT.welcome ? "icon" : ms < AT.menu ? "welcome" : "menu";
}

/** How full the welcome box's loading bar is at `ms`, 0..1. */
export function loaded(ms: number): number {
  return Math.min(1, Math.max(0, (ms - AT.welcome) / (AT.menu - AT.welcome)));
}

/** The welcome box's measured line: the latest Base block, or that it is still being read. */
export function blockLine(block: number | null): string {
  return block === null ? "base 8453 / reading the latest block" : `base 8453 / block ${block.toLocaleString("en-US")}`;
}

/** Whether the intro plays: never for a `?do=` link, nor where the visitor asked for less motion. */
export function shouldPlayIntro(env: { search: string; matchMedia: ((q: string) => { matches: boolean }) | undefined }): boolean {
  if (new URLSearchParams(env.search).has("do")) return false;
  if (typeof env.matchMedia !== "function") return false;
  return !env.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The menu row a key moves to, wrapping at both ends. */
export function moveTo(at: number, key: string): number {
  if (key === "ArrowDown") return (at + 1) % MENU.length;
  if (key === "ArrowUp") return (at - 1 + MENU.length) % MENU.length;
  return at;
}
