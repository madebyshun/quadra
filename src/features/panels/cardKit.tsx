import type { ReactNode } from "react";

/**
 * The share cards' visual kit (2026-11-12, the owner's references: a 90s desktop of small windows on a
 * dotted page, display type in electric blue with one italic line SELECTED like text in an editor,
 * and a sky drawn in halftone dots). Every piece is plain SVG — no image, no web font fetched — so a
 * card saved through a canvas is never tainted and looks the same on every machine.
 */

export const KIT = {
  blue: "#1f1fd8",
  sky: "#0b63c4",
  skyLight: "#5aa2ea",
  /** the sky of a high-risk card */
  alarm: "#8a1414",
  alarmLight: "#d14a3a",
  select: "#cfe3f7",
  chrome: "#d6d6d6",
  chromeDark: "#8a8a8a",
  ink: "#111",
  dim: "#555",
  red: "#c62828",
  amber: "#a85d00",
  green: "#1d6e1d",
} as const;

export const SANS = "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif";
export const SERIF = "Georgia, 'Times New Roman', serif";
export const MONO = "'JetBrains Mono', Menlo, Consolas, monospace";

/**
 * Clouds as a field in 0..1: a few soft blobs, fixed so every card has the same sky. A dot's radius
 * follows the field — the halftone in the references.
 */
const BLOBS: readonly (readonly [number, number, number, number])[] = [
  [140, 120, 150, 1],
  [430, 60, 120, 0.8],
  [1180, 40, 170, 1],
  [1560, 300, 130, 0.9],
  [40, 620, 140, 0.9],
  [1560, 640, 160, 1],
  [1000, 900, 150, 0.7],
];

/** Below this the sky stays plain blue — clouds, not fog. */
const CLEAR = 0.32;

export function cloud(x: number, y: number): number {
  let v = 0;
  for (const [cx, cy, r, w] of BLOBS) v += w * Math.exp(-((x - cx) ** 2 + ((y - cy) * 1.6) ** 2) / (2 * r * r));
  return Math.max(0, Math.min(1, (v - CLEAR) / (1 - CLEAR)));
}

/** The halftone sky behind a card: a blue gradient and a grid of white dots sized by `cloud`. */
export function HalftoneSky({ w, h, step = 20, alarm = false }: { w: number; h: number; step?: number; alarm?: boolean }) {
  const dots: ReactNode[] = [];
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2 + ((y / step) % 2) * (step / 2); x < w; x += step) {
      const r = (step / 2) * cloud(x, y);
      if (r > 0.8) dots.push(<circle key={`${x}-${y}`} cx={x} cy={y} r={r.toFixed(1)} />);
    }
  }
  return (
    <g>
      <defs>
        <linearGradient id="kit-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={alarm ? KIT.alarm : KIT.sky} />
          <stop offset="1" stopColor={alarm ? KIT.alarmLight : KIT.skyLight} />
        </linearGradient>
      </defs>
      <rect width={w} height={h} fill="url(#kit-sky)" />
      <g fill="#fff" opacity="0.9">
        {dots}
      </g>
    </g>
  );
}

/** A window: a striped platinum title bar with its close box, and a body — white with a dotted grid, or plain. */
export function Win({ x, y, w, h, title, dotted = false, children }: { x: number; y: number; w: number; h: number; title: string; dotted?: boolean; children?: ReactNode }) {
  const bar = 34;
  return (
    <g>
      <rect x={x + 8} y={y + 8} width={w} height={h} fill="#000" opacity="0.28" />
      <rect x={x} y={y} width={w} height={h} fill={KIT.chrome} stroke="#000" strokeWidth="3" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={x + 8} y={y + 7 + i * 5} width={w - 16} height="2" fill={KIT.chromeDark} />
      ))}
      <rect x={x + 14} y={y + 8} width="22" height="20" fill={KIT.chrome} stroke="#000" strokeWidth="2" />
      <rect x={x + w / 2 - title.length * 7.6 - 14} y={y + 4} width={title.length * 15.2 + 28} height="28" fill={KIT.chrome} />
      <text x={x + w / 2} y={y + 25} textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="20" fill={KIT.ink}>
        {title}
      </text>
      <rect x={x + 6} y={y + bar} width={w - 12} height={h - bar - 6} fill="#fff" stroke="#000" strokeWidth="2" />
      {dotted ? <rect x={x + 7} y={y + bar + 1} width={w - 14} height={h - bar - 8} fill="url(#kit-dots)" /> : null}
      {children}
    </g>
  );
}

/** The dotted page pattern a dotted window fills with. Put once in a card's <defs>. */
export function DotsPattern() {
  return (
    <pattern id="kit-dots" width="26" height="26" patternUnits="userSpaceOnUse">
      <circle cx="13" cy="13" r="1.6" fill="#b9b9c4" />
    </pattern>
  );
}

/**
 * An italic line SELECTED, as in the reference's "i'm …": a light-blue band, and the two blue
 * selection handles at its ends. Its width is estimated from the text (no layout in an SVG string).
 */
export function Selected({ x, y, text, size = 44, color = KIT.blue }: { x: number; y: number; text: string; size?: number; color?: string }) {
  const w = text.length * size * 0.5 + 36;
  const h = size * 1.35;
  return (
    <g>
      <rect x={x} y={y - h * 0.78} width={w} height={h} fill={KIT.select} />
      <rect x={x - 3} y={y - h * 0.78 - 4} width="6" height={h + 8} fill={KIT.blue} />
      <circle cx={x} cy={y - h * 0.78 - 8} r="9" fill={KIT.blue} />
      <rect x={x + w - 3} y={y - h * 0.78 - 4} width="6" height={h + 8} fill={KIT.blue} />
      <circle cx={x + w} cy={y + h * 0.22 + 8} r="9" fill={KIT.blue} />
      <text x={x + 18} y={y} fontFamily={SERIF} fontStyle="italic" fontSize={size} fill={color}>
        {text}
      </text>
    </g>
  );
}

/** A clock-style LCD readout in a sunken box — the block number, a figure. */
export function Lcd({ x, y, w, label, value }: { x: number; y: number; w: number; label: string; value: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height="78" fill="#e9e9e9" stroke="#7a7a7a" strokeWidth="2" />
      <text x={x + w / 2} y={y + 46} textAnchor="middle" fontFamily={MONO} fontSize="34" fill={KIT.ink} letterSpacing="2">
        {value}
      </text>
      <text x={x + w / 2} y={y + 70} textAnchor="middle" fontFamily={SANS} fontSize="16" fill={KIT.dim}>
        {label}
      </text>
    </g>
  );
}

/** A QR code drawn as cells inside a box `size` wide. */
export function Qr({ x, y, size, qr }: { x: number; y: number; size: number; qr: { readonly size: number; readonly cells: readonly (readonly [number, number])[] } }) {
  const u = size / qr.size;
  return (
    <g transform={`translate(${x} ${y})`}>
      {qr.cells.map(([cx, cy]) => (
        <rect key={`${cx}-${cy}`} x={cx * u} y={cy * u} width={u + 0.2} height={u + 0.2} fill="#000" />
      ))}
    </g>
  );
}

/** The way back, on the sky: a solid blue tab so it reads over any cloud. */
export function Footer({ x, y, text }: { x: number; y: number; text: string }) {
  const w = text.length * 19 + 48;
  return (
    <g>
      <rect x={x} y={y - 44} width={w} height="62" fill={KIT.blue} stroke="#000" strokeWidth="3" />
      <text x={x + 24} y={y} fontFamily={SANS} fontWeight="800" fontSize="34" fill="#fff">
        {text}
      </text>
    </g>
  );
}
