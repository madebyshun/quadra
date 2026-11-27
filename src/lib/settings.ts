/**
 * The Control Panel's settings (2026-10-21). Each lives under its OWN key — frozen from the day it
 * shipped, like every key some browser already holds — and an unreadable or unrecognised value reads
 * as the default, never as an error: these are display preferences. Sound and the Welcome screen keep
 * the keys they already had (`lib/sound.ts`, `lib/welcome.ts`).
 */

export const WALLPAPER_KEY = "quadra.wallpaper.v1";
export const WALLPAPER_SHAPE_KEY = "quadra.wallpaper-shape.v1";
export const WALLPAPER_SCENE_KEY = "quadra.wallpaper-scene.v1";
export const SAVER_KEY = "quadra.saver.v1";
export const SAVER_MINUTES_KEY = "quadra.saver-minutes.v1";

/**
 * The desktops (Mac OS 8 "Platinum" since 2026-10-22). The first four ids are the XP-era wallpapers'
 * — saved in browsers under `WALLPAPER_KEY` — kept as ids so a saved choice never breaks; each now
 * names a Platinum desktop (`bliss`, the old default, is the calm blue-grey default).
 */
export type WallpaperId = "bliss" | "motion" | "platinum" | "teal" | "dither" | "dark" | "bricks";

export const WALLPAPERS: readonly { readonly id: WallpaperId; readonly name: string }[] = [
  { id: "bliss", name: "Blue-grey" },
  { id: "motion", name: "Halftone Motion" },
  { id: "platinum", name: "Platinum" },
  { id: "teal", name: "Teal" },
  { id: "dither", name: "Base blue" },
  { id: "dark", name: "Graphite" },
  { id: "bricks", name: "Bricks" },
];

export type DotShape = "circle" | "square" | "jumbo" | "rain" | "blueprint";

export const DOT_SHAPES: readonly { readonly id: DotShape; readonly name: string }[] = [
  { id: "circle", name: "Circle" },
  { id: "square", name: "Square" },
  { id: "jumbo", name: "Jumbotron" },
  { id: "rain", name: "Rain" },
  { id: "blueprint", name: "Blueprint" },
];

export type WallpaperScene = "q001" | "meadow" | "sky" | "studio";

export const WALLPAPER_SCENES: readonly { readonly id: WallpaperScene; readonly name: string }[] = [
  { id: "q001", name: "Q-001" },
  { id: "meadow", name: "Sunlit Hill" },
  { id: "sky", name: "Computer Sky" },
  { id: "studio", name: "Studio" },
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
  return WALLPAPERS.find((w) => w.id === v)?.id ?? "motion";
}

export function setWallpaper(id: WallpaperId): void {
  write(WALLPAPER_KEY, id);
}

export function wallpaperShape(): DotShape {
  const v = read(WALLPAPER_SHAPE_KEY);
  return DOT_SHAPES.find((s) => s.id === v)?.id ?? "square";
}

export function setWallpaperShape(shape: DotShape): void {
  write(WALLPAPER_SHAPE_KEY, shape);
}

export function wallpaperScene(): WallpaperScene {
  const v = read(WALLPAPER_SCENE_KEY);
  return WALLPAPER_SCENES.find((s) => s.id === v)?.id ?? "q001";
}

export function setWallpaperScene(scene: WallpaperScene): void {
  write(WALLPAPER_SCENE_KEY, scene);
}

let customImage: string | null = null;

export function customWallpaperImage(): string | null {
  return customImage;
}

export function setCustomWallpaperImage(dataUrl: string | null): void {
  customImage = dataUrl;
  listeners.forEach((l) => l());
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
