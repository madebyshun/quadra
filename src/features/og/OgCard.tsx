import type { OgPage } from "@/server/og";

/**
 * A page's share card, 1200x630 (the size X and Open Graph draw large), redrawn 2026-11-19 to the
 * visual direction the owner chose (docs/research/2026-11-16-computer-aesthetic-visual-direction.md,
 * "a personal computer in the sky"): a computer-magazine advert page — ivory paper inside a printed
 * frame, a heavy serif masthead in electric blue, the page's folder path and three entries — and ONE
 * piece of hardware as the subject: the CRT over the sea (public/brand/computer-sky.webp). No
 * decorative windows, no live figure (the platforms keep a card for days).
 * scripts/build-og.tsx renders each to public/og/<id>.png.
 */

export const OG_W = 1200;
export const OG_H = 630;
/** the photo, served from public/ — the build script hands Chrome a file URL instead */
export const PHOTO = "/brand/quadra-machine.jpg";
const PAPER = "#f4f0e6";
const BLUE = "#1f1fd8";
const SKY = "#0b63c4";
const INK = "#141414";
const RULE = "#b9b3a6";
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', Menlo, Consolas, monospace";

/** The Quadra pixel mark (public/brand/icon.svg), at `size` px. */
function Mark({ x, y, size }: { x: number; y: number; size: number }) {
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

/** Two lines from one, broken at the space nearest the middle. */
export function splitAt(text: string): [string, string] {
  const mid = text.length / 2;
  let at = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === " " && (at < 0 || Math.abs(i - mid) < Math.abs(at - mid))) at = i;
  return at < 0 ? [text, ""] : [text.slice(0, at), text.slice(at + 1)];
}

export function OgCard({ page, photo = PHOTO }: { page: OgPage; photo?: string }) {
  const home = page.id === "home";
  const headline = home ? "your own on-chain computer." : `${page.path.split(" / ").at(-1)!}.`;
  const left = 64;
  // a headline wider than the column (about 18 characters of 46 px serif) breaks at its middle word
  const heads = headline.length > 18 ? splitAt(headline) : [headline];
  const px = 588;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${OG_W} ${OG_H}`} width={OG_W} height={OG_H} role="img" aria-label={`share card: ${page.path}`}>
      <defs>
        <clipPath id="og-photo">
          <rect x={px} y="28" width={OG_W - px - 28} height={OG_H - 56} />
        </clipPath>
      </defs>
      {/* the page: ivory paper, a printed double frame */}
      <rect width={OG_W} height={OG_H} fill={PAPER} />
      <rect x="14" y="14" width={OG_W - 28} height={OG_H - 28} fill="none" stroke={INK} strokeWidth="3" />
      <rect x="22" y="22" width={OG_W - 44} height={OG_H - 44} fill="none" stroke={INK} strokeWidth="1" />

      {/* the subject: Quadra Platinum window over sunlit sky & meadow */}
      <rect x={px} y="28" width={OG_W - px - 28} height={OG_H - 56} fill={SKY} />
      <image href={photo} x={px} y="28" width={OG_W - px - 28} height={OG_H - 56} preserveAspectRatio="xMidYMid slice" clipPath="url(#og-photo)" opacity="0.25" />
      <rect x={px} y="28" width={OG_W - px - 28} height="360" fill="#3a86e8" opacity="0.72" />
      <rect x={px} y="388" width={OG_W - px - 28} height={OG_H - 28 - 388} fill="#46891a" opacity="0.82" />
      <ellipse cx={px + 120} cy="130" rx="110" ry="34" fill="#ffffff" opacity="0.55" />
      <ellipse cx={px + 420} cy="160" rx="130" ry="38" fill="#ffffff" opacity="0.45" />
      <rect x={px + 72} y="138" width="440" height="310" fill={PAPER} stroke={INK} strokeWidth="3" />
      <rect x={px + 72} y="138" width="440" height="34" fill="#dedbd3" stroke={INK} strokeWidth="2" />
      <rect x={px + 84} y="147" width="14" height="14" fill={PAPER} stroke={INK} strokeWidth="2" />
      <text x={px + 292} y="160" textAnchor="middle" fontFamily={MONO} fontSize="15" fontWeight="700" fill={INK}>
        quadra / base 8453
      </text>
      <Mark x={px + 236} y={208} size={112} />
      <text x={px + 292} y="372" textAnchor="middle" fontFamily={SERIF} fontWeight="700" fontSize="34" fill={BLUE}>
        open. verify. sign.
      </text>
      <text x={px + 292} y="410" textAnchor="middle" fontFamily={MONO} fontSize="15" fill={INK}>
        on-chain supercomputer
      </text>
      <line x1={px} y1="28" x2={px} y2={OG_H - 28} stroke={INK} strokeWidth="2" />

      {/* the masthead */}
      <Mark x={left - 6} y={44} size={74} />
      <text x={left + 76} y="104" fontFamily={SERIF} fontWeight="700" fontSize="78" fill={BLUE} letterSpacing="-2">
        quadra
      </text>
      <line x1={left} y1="130" x2={px - 36} y2="130" stroke={INK} strokeWidth="3" />
      <line x1={left} y1="137" x2={px - 36} y2="137" stroke={INK} strokeWidth="1" />
      <text x={left} y="166" fontFamily={MONO} fontSize="18" fill={INK}>
        {page.path}
      </text>

      {/* the page's own line, and what it does */}
      {heads.map((h, i) => (
        <text key={h} x={left} y={232 + i * 50} fontFamily={SERIF} fontWeight="700" fontSize="46" fill={INK} letterSpacing="-1">
          {h}
        </text>
      ))}
      {page.lines.map((line, i) => (
        <text key={line} x={left} y={(heads.length > 1 ? 340 : 300) + i * 44} fontFamily={SANS} fontSize="24" fill={INK}>
          - {line}
        </text>
      ))}

      {/* the foot of the page */}
      <line x1={left} y1={OG_H - 98} x2={px - 36} y2={OG_H - 98} stroke={RULE} strokeWidth="1" />
      <text x={left} y={OG_H - 62} fontFamily={MONO} fontSize="18" fill={BLUE}>
        look first. sign when ready.
      </text>
      <text x={px - 36} y={OG_H - 62} textAnchor="end" fontFamily={MONO} fontSize="16" fill={INK}>
        base / 8453
      </text>
    </svg>
  );
}
