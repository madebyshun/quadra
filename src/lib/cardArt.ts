import { seeded } from "@/lib/cardWords";

/**
 * A 12×12 pixel portrait drawn from 160 bits — the card's picture when the X profile has no picture
 * (or it could not be drawn). A little face, mirrored left to right like the era's
 * identicons: the address picks the hair, glasses or a hat, the smile, the skin tone and the
 * colours. The same seed always gets the same face, and nobody else's picture is ever shown.
 */

export const PIXELS = 12;

/** 0 background · 1 ink (hair, eyes, mouth) · 2 accent (shirt, hat, glasses) · 3 skin */
export type Cell = 0 | 1 | 2 | 3;

export type Portrait = {
  /** PIXELS × PIXELS cells, row by row */
  readonly cells: readonly Cell[];
  readonly background: string;
  readonly ink: string;
  readonly accent: string;
  readonly skin: string;
};

const SKINS = ["#ffdbac", "#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffe0bd", "#d9a066", "#b5774b"] as const;

/** The address's 160 bits, most significant first; anything that is not hex reads as zero bits. */
function bitsOf(address: string): number[] {
  const hex = address.toLowerCase().replace(/^0x/, "").padEnd(40, "0");
  return [...hex].flatMap((c) => {
    const n = parseInt(c, 16) || 0;
    return [(n >> 3) & 1, (n >> 2) & 1, (n >> 1) & 1, n & 1];
  });
}

export function portrait(address: string): Portrait {
  const bits = bitsOf(address);
  const bit = (i: number) => bits[i] === 1;
  const num = (from: number, count: number) => bits.slice(from, from + count).reduce((a, b) => a * 2 + b, 0);
  const hat = bit(0) && bit(1);
  const glasses = bit(2);
  const grin = bit(3);
  // the left half, columns 0..5 — column 5 meets its mirror in the middle
  const left: Cell[][] = Array.from({ length: PIXELS }, () => Array<Cell>(6).fill(0));
  const set = (row: number, col: number, c: Cell) => (left[row]![col] = c);
  for (let row = 2; row <= 9; row++) for (let col = row === 9 ? 3 : row >= 8 ? 2 : 1; col <= 5; col++) set(row, col, 3);
  // hair: a fringe on rows 1-3, its outline from the address
  for (let col = 2; col <= 5; col++) set(1, col, bit(4 + col) ? 1 : 0);
  for (let col = 1; col <= 5; col++) set(2, col, 1);
  for (let col = 1; col <= 5; col++) set(3, col, bit(10 + col) ? 1 : 3);
  set(4, 1, bit(16) ? 1 : 3);
  if (hat) {
    for (let col = 1; col <= 5; col++) set(0, col, col >= 2 ? 2 : 0), set(1, col, 2), set(2, col, 2);
    set(2, 0, 2);
  }
  // eyes, glasses, mouth
  set(5, 3, 1);
  if (glasses) set(5, 2, 2), set(5, 4, 2), set(5, 5, 2), set(4, 3, 2);
  if (grin) set(7, 3, 1), set(8, 4, 1), set(8, 5, 1);
  else set(8, 4, 1), set(8, 5, 1);
  // shirt
  for (let col = 1; col <= 5; col++) set(10, col, 2);
  for (let col = 0; col <= 5; col++) set(11, col, 2);
  set(10, 5, 3);
  const cells = left.flatMap((row) => [...row, ...[...row].reverse()]);
  const hue = num(20, 9) % 360;
  return {
    cells,
    background: `hsl(${(hue + 180) % 360} 70% 86%)`,
    ink: `hsl(${num(30, 9) % 360} 55% 22%)`,
    accent: `hsl(${hue} 85% 50%)`,
    skin: SKINS[num(40, 3)]!,
  };
}

/** A handle's face: 160 bits drawn from the handle (case-insensitive, as X treats it). */
export function portraitOf(handle: string): Portrait {
  const rand = seeded(`portrait:${handle.toLowerCase()}`);
  return portrait(Array.from({ length: 40 }, () => Math.floor(rand() * 16).toString(16)).join(""));
}
