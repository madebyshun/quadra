import type { OgPage } from "@/server/og";
import { cloud } from "@/features/panels/cardKit";

/**
 * A page's share card, 1200x630 (the size X and Open Graph draw large), in the app's own look of
 * 2026-11-17: cobalt over a halftone sky, one window on warm paper with a striped title bar, the
 * single-stroke q mark, the page's folder path and three lowercase entries. Nothing live — the
 * platforms keep a card for days. scripts/build-og.tsx renders each to public/og/<id>.png.
 */

export const OG_W = 1200;
export const OG_H = 630;
const COBALT = "#2422cf";
const PAPER = "#fffdf6";
const FACE = "#dedbd3";
const INK = "#17182b";
const SANS = "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', Menlo, Consolas, monospace";

function Sky() {
  const step = 18;
  const dots = [];
  for (let y = step / 2; y < OG_H; y += step) {
    for (let x = step / 2 + ((y / step) % 2) * (step / 2); x < OG_W; x += step) {
      // the same clouds as the share cards, laid over this card's smaller canvas
      const r = (step / 2) * cloud((x / OG_W) * 1600, (y / OG_H) * 900);
      if (r > 0.8) dots.push(<circle key={`${x}-${y}`} cx={x} cy={y} r={r.toFixed(1)} />);
    }
  }
  return (
    <g>
      <defs>
        <linearGradient id="og-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={COBALT} />
          <stop offset="1" stopColor="#5d78e6" />
        </linearGradient>
        <pattern id="og-dots" width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="11" cy="11" r="1.4" fill="#c9c5bb" />
        </pattern>
      </defs>
      <rect width={OG_W} height={OG_H} fill="url(#og-sky)" />
      <g fill="#fff" opacity="0.85">
        {dots}
      </g>
    </g>
  );
}

/** The single-stroke q mark (public/brand/icon.svg), at `size` px. */
function Mark({ x, y, size, color }: { x: number; y: number; size: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 64})`}>
      <path d="M44 44H16V16H44V44L55 55" fill="none" stroke={color} strokeWidth="8" strokeLinejoin="round" />
    </g>
  );
}

export function OgCard({ page }: { page: OgPage }) {
  const x = 70;
  const y = 70;
  const w = 1060;
  const h = 450;
  const title = page.id === "home" ? "quadra" : page.path.split(" / ").at(-1)!;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${OG_W} ${OG_H}`} width={OG_W} height={OG_H} role="img" aria-label={`share card: ${page.path}`}>
      <Sky />
      <rect x={x + 8} y={y + 8} width={w} height={h} fill="#0b0b3a" opacity="0.35" />
      <rect x={x} y={y} width={w} height={h} fill={FACE} stroke={INK} strokeWidth="3" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={x + 8} y={y + 7 + i * 5} width={w - 16} height="2" fill="#a8a59d" />
      ))}
      <rect x={x + 14} y={y + 8} width="20" height="20" fill={FACE} stroke={INK} strokeWidth="2" />
      <rect x={x + w / 2 - page.path.length * 6.2 - 16} y={y + 3} width={page.path.length * 12.4 + 32} height="30" fill={FACE} />
      <text x={x + w / 2} y={y + 25} textAnchor="middle" fontFamily={MONO} fontSize="19" fill={INK}>
        {page.path}
      </text>
      <rect x={x + 6} y={y + 36} width={w - 12} height={h - 42} fill={PAPER} stroke={INK} strokeWidth="2" />
      <text x={x + w - 40} y={y + 195} textAnchor="end" fontFamily={MONO} fontSize="16" fill={COBALT}>base / 8453</text>

      <Mark x={x + 50} y={y + 78} size={96} color={COBALT} />
      <text x={x + 170} y={y + 158} fontFamily="Georgia, serif" fontWeight="700" fontSize="84" fill={COBALT} letterSpacing="-3">
        {title}
      </text>
      {page.lines.map((line, i) => (
        <text key={line} x={x + 60} y={y + 250 + i * 54} fontFamily={SANS} fontSize="30" fill={INK}>
          - {line}
        </text>
      ))}

      <text x={1130} y={OG_H - 48} textAnchor="end" fontFamily={MONO} fontSize="19" fill="#fff">coins / stocks / your wallet</text>
      <rect x={x} y={OG_H - 82} width="400" height="50" fill={PAPER} stroke={INK} strokeWidth="3" />
      <Mark x={x + 12} y={OG_H - 75} size={36} color={COBALT} />
      <text x={x + 60} y={OG_H - 48} fontFamily={MONO} fontSize="22" fill={INK}>
        quadra / on base
      </text>
    </svg>
  );
}
