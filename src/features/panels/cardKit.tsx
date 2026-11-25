import type { ReactNode } from "react";

/**
 * The share cards' visual kit: this app's Base cobalt (#0A3DFF) halftone cloud sky, warm Platinum
 * Macintosh windows (#ece8df / #f4f0e6), serif display headlines, monospace readouts, and the
 * pixel Macintosh Q mark. Plain SVG — no external image or web font fetched — so a card saved
 * through a canvas is never tainted and renders identically everywhere.
 */

export const KIT = {
  blue: "#0A3DFF",
  sky: "#0A3DFF",
  skyLight: "#1D4EFF",
  /** the sky of a high-risk card */
  alarm: "#8a1414",
  alarmLight: "#c62828",
  select: "#dbe6ff",
  chrome: "#ece8df",
  chromeDark: "#9c988c",
  paper: "#f4f0e6",
  ink: "#141414",
  dim: "#555",
  red: "#c62828",
  amber: "#a85d00",
  green: "#1d6e1d",
} as const;

export const SANS = "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif";
export const SERIF = "Georgia, 'Times New Roman', serif";
export const MONO = "'JetBrains Mono', Menlo, Consolas, monospace";

/** The pixel Macintosh mark (matching public/brand/icon.svg and OgCard.tsx). */
export function PixelMark({ x, y, size }: { x: number; y: number; size: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 32})`} shapeRendering="crispEdges">
      <path fill="#000000" d="M6 5h20v1h-20zM5 6h1v1h-1zM26 6h1v1h-1zM5 7h1v1h-1zM7 7h18v1h-18zM26 7h1v1h-1zM5 8h1v1h-1zM7 8h1v1h-1zM24 8h1v1h-1zM26 8h1v1h-1zM5 9h1v1h-1zM7 9h1v1h-1zM24 9h1v1h-1zM26 9h1v1h-1zM5 10h1v1h-1zM7 10h1v1h-1zM24 10h1v1h-1zM26 10h1v1h-1zM5 11h1v1h-1zM7 11h1v1h-1zM24 11h1v1h-1zM26 11h1v1h-1zM5 12h1v1h-1zM7 12h1v1h-1zM24 12h1v1h-1zM26 12h1v1h-1zM5 13h1v1h-1zM7 13h1v1h-1zM24 13h1v1h-1zM26 13h1v1h-1zM5 14h1v1h-1zM7 14h1v1h-1zM24 14h1v1h-1zM26 14h1v1h-1zM5 15h1v1h-1zM7 15h1v1h-1zM24 15h1v1h-1zM26 15h1v1h-1zM5 16h1v1h-1zM7 16h1v1h-1zM24 16h1v1h-1zM26 16h1v1h-1zM5 17h1v1h-1zM7 17h1v1h-1zM24 17h1v1h-1zM26 17h1v1h-1zM5 18h1v1h-1zM7 18h1v1h-1zM24 18h1v1h-1zM26 18h1v1h-1zM5 19h1v1h-1zM7 19h18v1h-18zM26 19h1v1h-1zM5 20h1v1h-1zM26 20h1v1h-1zM5 21h1v1h-1zM26 21h1v1h-1zM5 22h1v1h-1zM17 22h6v1h-6zM26 22h1v1h-1zM5 23h1v1h-1zM26 23h1v1h-1zM5 24h1v1h-1zM26 24h1v1h-1zM5 25h1v1h-1zM26 25h1v1h-1zM6 26h20v1h-20zM7 27h1v1h-1zM24 27h1v1h-1zM7 28h18v1h-18z" />
      <path fill="#e3e0d6" d="M6 6h20v1h-20zM6 7h1v1h-1zM25 7h1v1h-1zM6 8h1v1h-1zM25 8h1v1h-1zM6 9h1v1h-1zM25 9h1v1h-1zM6 10h1v1h-1zM25 10h1v1h-1zM6 11h1v1h-1zM25 11h1v1h-1zM6 12h1v1h-1zM25 12h1v1h-1zM6 13h1v1h-1zM25 13h1v1h-1zM6 14h1v1h-1zM25 14h1v1h-1zM6 15h1v1h-1zM25 15h1v1h-1zM6 16h1v1h-1zM25 16h1v1h-1zM6 17h1v1h-1zM25 17h1v1h-1zM6 18h1v1h-1zM25 18h1v1h-1zM6 19h1v1h-1zM25 19h1v1h-1zM6 20h20v1h-20zM6 21h20v1h-20zM6 22h2v1h-2zM10 22h7v1h-7zM23 22h3v1h-3zM6 23h20v1h-20zM6 24h20v1h-20z" />
      <path fill="#0052ff" d="M8 8h16v1h-16zM8 9h5v1h-5zM19 9h5v1h-5zM8 10h4v1h-4zM14 10h4v1h-4zM20 10h4v1h-4zM8 11h3v1h-3zM13 11h6v1h-6zM21 11h3v1h-3zM8 12h3v1h-3zM13 12h6v1h-6zM21 12h3v1h-3zM8 13h3v1h-3zM13 13h6v1h-6zM21 13h3v1h-3zM8 14h3v1h-3zM13 14h3v1h-3zM18 14h1v1h-1zM21 14h3v1h-3zM8 15h3v1h-3zM13 15h4v1h-4zM20 15h4v1h-4zM8 16h4v1h-4zM14 16h4v1h-4zM20 16h4v1h-4zM8 17h5v1h-5zM19 17h1v1h-1zM22 17h2v1h-2zM8 18h16v1h-16zM8 22h2v1h-2z" />
      <path fill="#ffffff" d="M13 9h6v1h-6zM12 10h2v1h-2zM18 10h2v1h-2zM11 11h2v1h-2zM19 11h2v1h-2zM11 12h2v1h-2zM19 12h2v1h-2zM11 13h2v1h-2zM19 13h2v1h-2zM11 14h2v1h-2zM16 14h2v1h-2zM19 14h2v1h-2zM11 15h2v1h-2zM17 15h3v1h-3zM12 16h2v1h-2zM18 16h2v1h-2zM13 17h6v1h-6zM20 17h2v1h-2z" />
      <path fill="#9c988c" d="M6 25h20v1h-20zM8 27h16v1h-16z" />
    </g>
  );
}

/**
 * Clouds as a field in 0..1: cumulus blobs along the horizon and corners, rendered as crisp white
 * halftone dots over this app's Base cobalt sky.
 */
const BLOBS: readonly (readonly [number, number, number, number])[] = [
  [140, 120, 150, 1],
  [430, 60, 120, 0.8],
  [1180, 40, 170, 1],
  [1560, 300, 130, 0.9],
  [40, 620, 160, 1],
  [360, 820, 190, 0.95],
  [1560, 640, 170, 1],
  [1040, 880, 180, 0.9],
];

/** Below this the sky stays pure Base cobalt — clouds, not fog. */
const CLEAR = 0.32;

export function cloud(x: number, y: number): number {
  let v = 0;
  for (const [cx, cy, r, w] of BLOBS) v += w * Math.exp(-((x - cx) ** 2 + ((y - cy) * 1.6) ** 2) / (2 * r * r));
  return Math.max(0, Math.min(1, (v - CLEAR) / (1 - CLEAR)));
}

/** The halftone sky behind a card: Base cobalt gradient and a 45° grid of crisp white halftone dots. */
export function HalftoneSky({ w, h, step = 18, alarm = false }: { w: number; h: number; step?: number; alarm?: boolean }) {
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
      <g fill="#fff" opacity="0.94">
        {dots}
      </g>
    </g>
  );
}

/** A window: a striped warm-Platinum title bar with its close box, and an ivory/white body. */
export function Win({ x, y, w, h, title, dotted = false, children }: { x: number; y: number; w: number; h: number; title: string; dotted?: boolean; children?: ReactNode }) {
  const bar = 36;
  return (
    <g>
      <rect x={x + 8} y={y + 8} width={w} height={h} fill="#000" opacity="0.32" />
      <rect x={x} y={y} width={w} height={h} fill={KIT.chrome} stroke="#000" strokeWidth="3" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={x + 8} y={y + 8 + i * 5} width={w - 16} height="2" fill={KIT.chromeDark} />
      ))}
      <rect x={x + 14} y={y + 9} width="22" height="20" fill={KIT.paper} stroke="#000" strokeWidth="2" />
      <rect x={x + w / 2 - title.length * 7.6 - 16} y={y + 4} width={title.length * 15.2 + 32} height="28" fill={KIT.chrome} />
      <text x={x + w / 2} y={y + 25} textAnchor="middle" fontFamily={MONO} fontWeight="700" fontSize="19" fill={KIT.ink}>
        {title}
      </text>
      <rect x={x + 6} y={y + bar} width={w - 12} height={h - bar - 6} fill={KIT.paper} stroke="#000" strokeWidth="2" />
      {dotted ? <rect x={x + 7} y={y + bar + 1} width={w - 14} height={h - bar - 8} fill="url(#kit-dots)" /> : null}
      {children}
    </g>
  );
}

/** The dotted page pattern a dotted window fills with. Put once in a card's <defs>. */
export function DotsPattern() {
  return (
    <pattern id="kit-dots" width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="12" cy="12" r="1.4" fill="#c6c1b4" />
    </pattern>
  );
}

/**
 * An italic line SELECTED, as in the reference's "i'm …": a light-cobalt band, and the two cobalt
 * selection handles at its ends.
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
      <rect x={x} y={y} width={w} height="78" fill="#ece8df" stroke="#555" strokeWidth="2" />
      <text x={x + w / 2} y={y + 46} textAnchor="middle" fontFamily={MONO} fontSize="34" fill={KIT.ink} letterSpacing="2">
        {value}
      </text>
      <text x={x + w / 2} y={y + 70} textAnchor="middle" fontFamily={MONO} fontSize="15" fill={KIT.dim}>
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

/** The way back, on the sky: a warm-Platinum bar with this app's pixel mark so it reads over any cloud. */
export function Footer({ x, y, text }: { x: number; y: number; text: string }) {
  const w = text.length * 18.5 + 96;
  return (
    <g>
      <rect x={x + 5} y={y - 41} width={w} height="62" fill="#000" opacity="0.28" />
      <rect x={x} y={y - 46} width={w} height="62" fill={KIT.paper} stroke="#000" strokeWidth="3" />
      <PixelMark x={x + 14} y={y - 36} size={42} />
      <text x={x + 68} y={y - 3} fontFamily={MONO} fontWeight="700" fontSize="29" fill={KIT.blue}>
        {text}
      </text>
    </g>
  );
}
