/**
 * The Control Panel's settings (2026-10-21). Each lives under its OWN key — frozen from the day it
 * shipped, like every key some browser already holds — and an unreadable or unrecognised value reads
 * as the default, never as an error: these are display preferences. Sound and the Welcome screen keep
 * the keys they already had (`lib/sound.ts`, `lib/welcome.ts`).
 */

export const WALLPAPER_KEY = "quadra.wallpaper.v1";
export const SAVER_KEY = "quadra.saver.v1";
export const SAVER_MINUTES_KEY = "quadra.saver-minutes.v1";

/**
 * The desktops (Mac OS 8 "Platinum" since 2026-10-22). The first four ids are the XP-era wallpapers'
 * — saved in browsers under `WALLPAPER_KEY` — kept as ids so a saved choice never breaks; each now
 * names a Platinum desktop (`bliss`, the old default, is the calm blue-grey default).
 */
export type WallpaperId = "bliss" | "platinum" | "teal" | "dither" | "dark" | "bricks";

export const WALLPAPERS: readonly { readonly id: WallpaperId; readonly name: string }[] = [
  { id: "bliss", name: "Blue-grey" },
  { id: "platinum", name: "Platinum" },
  { id: "teal", name: "Teal" },
  { id: "dither", name: "Base blue" },
  { id: "dark", name: "Graphite" },
  { id: "bricks", name: "Bricks" },
];

/** The idle minutes the screen saver offers; 2 is what it always waited. */
export const SAVER_MINUTES: readonly number[] = [1, 2, 5, 10, 15];
export const DEFAULT_SAVER_MINUTES = 2;

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

function write(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // forgetting a preference only means the default comes back next time
  }
  listeners.forEach((l) => l());
}

/** Called whenever any setting here changes; returns the unsubscribe. */
export function onSettingsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function wallpaper(): WallpaperId {
  const v = read(WALLPAPER_KEY);
  return WALLPAPERS.find((w) => w.id === v)?.id ?? "bliss";
}

export function setWallpaper(id: WallpaperId): void {
  write(WALLPAPER_KEY, id);
}

/** On unless the visitor turned it off. */
export function saverOn(): boolean {
  return read(SAVER_KEY) !== "off";
}

export function setSaverOn(on: boolean): void {
  write(SAVER_KEY, on ? "on" : "off");
}

export function saverMinutes(): number {
  const n = Number(read(SAVER_MINUTES_KEY));
  return SAVER_MINUTES.includes(n) ? n : DEFAULT_SAVER_MINUTES;
}

export function setSaverMinutes(minutes: number): void {
  write(SAVER_MINUTES_KEY, String(minutes));
}
