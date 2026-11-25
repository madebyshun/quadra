import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { BRAND } from "@/brand";
import { messageOf } from "@/lib/errors";
import { portraitOf, PIXELS } from "@/lib/cardArt";
import { cardWords, compact, ships, type CardWords } from "@/lib/cardWords";
import { dataUrl, lookupWords, parseHandle, pictureData, xProfile, type XUser } from "@/skills/xprofile";
import { useInbox } from "@/features/openWindow";
import { DotsPattern, HalftoneSky, KIT, PixelMark, SERIF } from "@/features/panels/cardKit";
import "./BaseCard.css";

/**
 * "Make my Base card" (owner, 2026-10-21, after Solana 95's card: "the Base card is made from an X
 * handle, not a wallet"): a wizard asks for an X handle, the profile is read through FxTwitter
 * (`skills/xprofile.ts`), and the card is shown in this app's own Paint program. The picture is the
 * profile's own, else a pixel portrait drawn from the handle. The title and the quote are random but
 * only ever riff on what the profile says (`lib/cardWords.ts`).
 *
 * Redesigned 2026-10-22 (owner: the whole app moves to a colour System 7 look): a paint program
 * with a tool palette, a pattern palette and push buttons, around a card drawn as an early-nineties
 * desktop — a dithered pattern, a window with a striped title bar, a Get Info frame for the
 * picture, the title in BITMAP letters (`PIXEL_FONT`, drawn as squares — no font, nothing blurred)
 * with a hard one-bit shadow, and the quote in a help balloon. Every shape is this app's own; no
 * maker's artwork, logo or font.
 *
 * The card is ONE SVG, 1600×900, so Download renders exactly what is shown. The handle goes to
 * api.fxtwitter.com and the picture comes from pbs.twimg.com; nothing is stored. Download and Copy
 * stay on this computer, Post on X opens a post the user writes and attaches the picture to, and a
 * picture picked with "Change picture…" is read in the page and never uploaded.
 */

export const CARD_W = 1600;
export const CARD_H = 900;

/** The page's own origin — where "make yours" points. */
const origin = () => window.location.origin;
const host = () => origin().replace(/^https?:\/\//, "");

/** The paint program's name — this app's own, never a maker's. */
export const PAINT = `${BRAND.name}Paint`;

/** The line under the name: the handle, and the followers when they were read — never a zero for an unread count. */
export function factLine(u: XUser): string {
  return u.followers === null ? `@${u.handle}` : `@${u.handle} · ${compact(u.followers)} ${u.followers === 1 ? "follower" : "followers"}`;
}

/** Words into at most `rows` lines of at most `max` characters, broken at spaces; what does not fit ends in "…". */
export function wrap(text: string, max: number, rows = Infinity): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    const last = lines.at(-1);
    if (last !== undefined && `${last} ${word}`.length <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  if (lines.length <= rows) return lines;
  const kept = lines.slice(0, rows);
  kept[rows - 1] = `${kept[rows - 1]!.replace(/[\s,.:;…”—-]+$/, "")}…`;
  return kept;
}

/** A title on one line, or two broken at the space nearest its middle. */
export function titleLines(title: string): string[] {
  if (title.length <= 13 || !title.includes(" ")) return [title];
  const spaces = [...title].flatMap((c, i) => (c === " " ? [i] : []));
  const cut = spaces.reduce((a, b) => (Math.abs(b - title.length / 2) < Math.abs(a - title.length / 2) ? b : a));
  return [title.slice(0, cut), title.slice(cut + 1)];
}

/** Squeeze a line into `max` pixels when its estimated width would run past it — nothing on the card is clipped. */
const fit = (text: string, size: number, max: number, em = 0.56) => (text.length * size * em > max ? { textLength: max, lengthAdjust: "spacingAndGlyphs" } : {});

/**
 * A 5×7 bitmap alphabet, drawn by hand for this card: each letter is seven rows of five, `#` lit.
 * The title is drawn from it as squares, so it is crisp at any size and needs no font at all.
 * Anything it has no letter for is drawn as "?" — a title is never silently shortened.
 */
export const PIXEL_FONT: Readonly<Record<string, string>> = {
  A: ".###.#...##...#######...##...##...#",
  B: "####.#...##...#####.#...##...#####.",
  C: ".###.#...##....#....#....#...#.###.",
  D: "####.#...##...##...##...##...#####.",
  E: "######....#....####.#....#....#####",
  F: "######....#....####.#....#....#....",
  G: ".###.#...##....#.####...##...#.####",
  H: "#...##...##...#######...##...##...#",
  I: "#####..#....#....#....#....#..#####",
  J: "..###...#....#....#.#..#.#..#..##..",
  K: "#...##..#.#.#..##...#.#..#..#.#...#",
  L: "#....#....#....#....#....#....#####",
  M: "#...###.###.#.##.#.##...##...##...#",
  N: "#...###..##.#.##..###...##...##...#",
  O: ".###.#...##...##...##...##...#.###.",
  P: "####.#...##...#####.#....#....#....",
  Q: ".###.#...##...##...##.#.##..#..##.#",
  R: "####.#...##...#####.#.#..#..#.#...#",
  S: ".#####....#.....###.....#....#####.",
  T: "#####..#....#....#....#....#....#..",
  U: "#...##...##...##...##...##...#.###.",
  V: "#...##...##...##...##...#.#.#...#..",
  W: "#...##...##...##.#.##.#.###.###...#",
  X: "#...##...#.#.#...#...#.#.#...##...#",
  Y: "#...##...#.#.#...#....#....#....#..",
  Z: "#####....#...#...#...#...#....#####",
  "0": ".###.#...##..###.#.###..##...#.###.",
  "1": "..#...##....#....#....#....#..#####",
  "2": ".###.#...#....#...#...#...#...#####",
  "3": "####.....#....#.###.....#....#####.",
  "4": "#...##...##...######....#....#....#",
  "5": "######....####.....#....#....#####.",
  "6": ".###.#....#....####.#...##...#.###.",
  "7": "#####....#...#...#...#....#....#...",
  "8": ".###.#...##...#.###.#...##...#.###.",
  "9": ".###.#...##...#.####....#....#.###.",
  "!": "..#....#....#....#....#.......#....",
  "?": ".###.#...#....#...#...#.......#....",
  ".": "..............................#....",
  ",": "......................##....#...#..",
  "-": "................###................",
  "'": "..#....#...........................",
  " ": "...................................",
};

/** One lit square of a bitmap line: column and row in letter cells. */
export type Pixel = { readonly x: number; readonly y: number; readonly letter: number };

/** A line's lit squares, letters 6 cells apart (5 wide and one gap), upper-cased, unknowns as "?". */
export function pixelsOf(line: string): Pixel[] {
  return [...line.toUpperCase()].flatMap((ch, letter) => {
    const rows = PIXEL_FONT[ch] ?? PIXEL_FONT["?"]!;
    return [...rows].flatMap((c, i) => (c === "#" ? [{ x: letter * 6 + (i % 5), y: Math.floor(i / 5), letter }] : []));
  });
}

/** The size of one bitmap square so the longest line fits `width` — never larger than `most`. */
export function cellFor(lines: readonly string[], width: number, most: number): number {
  const longest = Math.max(...lines.map((l) => l.length * 6 - 1));
  return Math.min(most, Math.floor(width / longest));
}

const INK = "#000";
const UI = "Verdana, Tahoma, 'Segoe UI', sans-serif";
const MONO = "'Courier New', Courier, monospace";

/** The picture frame: picture at 130,180, 400×400. */
const PX = 130;
const PY = 200;
const PS = 400;

function Picture({ handle, picture }: { handle: string; picture: string | null }) {
  if (picture) {
    return <image href={picture} x={PX} y={PY} width={PS} height={PS} preserveAspectRatio="xMidYMid slice" clipPath="url(#card-photo)" />;
  }
  const p = portraitOf(handle);
  const cell = PS / PIXELS;
  return (
    <g aria-label="pixel portrait" shapeRendering="crispEdges">
      <rect x={PX} y={PY} width={PS} height={PS} fill={p.background} />
      {p.cells.map((c, i) =>
        c === 0 ? null : (
          <rect key={i} x={PX + (i % PIXELS) * cell} y={PY + Math.floor(i / PIXELS) * cell} width={cell + 0.5} height={cell + 0.5} fill={c === 1 ? p.ink : c === 2 ? p.accent : p.skin} />
        ),
      )}
    </g>
  );
}

/** The title in bitmap letters: a hard black shadow, a black outline, then each letter in its colour. */
function BitmapTitle({ words }: { words: CardWords }) {
  const lines = titleLines(words.title);
  const cell = cellFor(lines, 860, 16);
  const lineH = cell * 9;
  // one line centred on y 260; two stacked from y 140 (they end above the name at any size)
  const top = lines.length === 1 ? Math.round(260 - (cell * 7) / 2) : 140 + (16 - cell) * 4;
  const shadow = Math.max(4, Math.round(cell / 2.5));
  let first = 0;
  return (
    <g aria-label={words.title} shapeRendering="crispEdges">
      <title>{words.title}</title>
      {lines.map((line, row) => {
        const px = pixelsOf(line);
        const width = (line.length * 6 - 1) * cell;
        const x0 = Math.round(1060 - width / 2);
        const y0 = top + row * lineH;
        const offset = first;
        first += line.length;
        const at = (p: Pixel, grow: number, shift: number) => ({ x: x0 + p.x * cell - grow + shift, y: y0 + p.y * cell - grow + shift, width: cell + grow * 2, height: cell + grow * 2 });
        return (
          <g key={row}>
            <g fill={INK}>
              {px.map((p, i) => (
                <rect key={i} {...at(p, 2, shadow)} />
              ))}
              {px.map((p, i) => (
                <rect key={`o${i}`} {...at(p, 2, 0)} />
              ))}
            </g>
            {px.map((p, i) => (
              <rect key={`c${i}`} {...at(p, 0, 0)} fill={words.colours[(offset + p.letter) % words.colours.length]} />
            ))}
          </g>
        );
      })}
    </g>
  );
}

/** A little computer of this app's own design, smiling — drawn in one-bit squares. */
function Computer() {
  return (
    <g transform="translate(130 712)" aria-label="a happy computer" shapeRendering="crispEdges">
      <rect x="0" y="0" width="60" height="76" fill="#eee" stroke={INK} strokeWidth="4" />
      <rect x="9" y="9" width="42" height="32" fill="#b8e1ff" stroke={INK} strokeWidth="3" />
      <rect x="20" y="17" width="4" height="6" fill={INK} />
      <rect x="36" y="17" width="4" height="6" fill={INK} />
      <path d="M20 30h4v4h12v-4h4v8H20Z" fill={INK} />
      <rect x="9" y="52" width="22" height="4" fill={INK} />
      <rect x="40" y="58" width="12" height="6" fill="#2ab24a" />
    </g>
  );
}

/** The arrow pointer, one-bit. */
function Arrow() {
  return (
    <path
      transform="translate(232 716) scale(4)"
      d="M0 0v16l4-4 3 7 3-1-3-7h6Z"
      fill="#fff"
      stroke={INK}
      strokeWidth="1.2"
      strokeLinejoin="miter"
      aria-label="a pointer"
    />
  );
}

/** The wristwatch "busy" pointer, of this card's own drawing. */
function Watch() {
  return (
    <g transform="translate(330 712)" aria-label="a busy watch" shapeRendering="crispEdges">
      <rect x="14" y="0" width="28" height="14" fill={INK} />
      <rect x="14" y="62" width="28" height="14" fill={INK} />
      <circle cx="28" cy="38" r="26" fill="#fff" stroke={INK} strokeWidth="5" />
      <path d="M28 20v18h12" fill="none" stroke={INK} strokeWidth="5" />
    </g>
  );
}

/** A floppy disk — a "save" doodle. */
function Floppy() {
  return (
    <g transform="translate(424 714)" aria-label="a floppy disk" shapeRendering="crispEdges">
      <path d="M0 0h62l10 10v62H0Z" fill="#2f63d6" stroke={INK} strokeWidth="4" />
      <rect x="14" y="0" width="40" height="24" fill="#d8d8d8" stroke={INK} strokeWidth="3" />
      <rect x="40" y="5" width="8" height="15" fill={INK} />
      <rect x="10" y="38" width="52" height="30" fill="#fff" stroke={INK} strokeWidth="3" />
    </g>
  );
}

function Shipped() {
  const points = Array.from({ length: 24 }, (_, i) => {
    const r = i % 2 === 0 ? 94 : 70;
    const a = (i * Math.PI) / 12;
    return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
  }).join(" ");
  return (
    <g transform="translate(150 214) rotate(-14)" aria-label="shipped!">
      <polygon points={points} transform="translate(8 8)" fill={INK} />
      <polygon points={points} fill="#ff3b30" stroke={INK} strokeWidth="5" strokeLinejoin="miter" />
      <text y="11" textAnchor="middle" fontFamily={UI} fontWeight="bold" fontSize="26" fill="#fff36b">
        shipped!
      </text>
    </g>
  );
}

/** The card's menu bar: each title placed after the one before it. */
const MENU: readonly (readonly [string, number])[] = [BRAND.name, "File", "Edit", "Card", "Special"].reduce<[string, number][]>(
  (all, m) => [...all, [m, all.length === 0 ? 40 : all.at(-1)![1] + all.at(-1)![0].length * 16 + 44]],
  [],
);

/** The striped title bar of a warm-Platinum Macintosh window: grooves either side of the centred title. */
function TitleBar({ x, y, w, title }: { x: number; y: number; w: number; title: string }) {
  const label = Math.min(w - 160, title.length * 17 + 48);
  const mid = x + w / 2;
  return (
    <g shapeRendering="crispEdges">
      <rect x={x} y={y} width={w} height="44" fill={KIT.chrome} />
      {[8, 14, 20, 26, 32].map((dy) => (
        <rect key={dy} x={x + 10} y={y + dy} width={w - 20} height="2" fill={KIT.chromeDark} />
      ))}
      <rect x={mid - label / 2} y={y + 4} width={label} height="36" fill={KIT.chrome} />
      <rect x={x + 22} y={y + 10} width="24" height="24" fill={KIT.paper} stroke={INK} strokeWidth="3" />
      <rect x={x + w - 46} y={y + 10} width="24" height="24" fill={KIT.paper} stroke={INK} strokeWidth="3" />
      <rect x={x + w - 46} y={y + 10} width="14" height="14" fill="none" stroke={INK} strokeWidth="3" />
      <text x={mid} y={y + 30} textAnchor="middle" fontFamily={MONO} fontWeight="bold" fontSize="24" fill={KIT.ink} {...fit(title, 24, label - 24, 0.64)}>
        {title}
      </text>
      <rect x={x} y={y + 44} width={w} height="3" fill={INK} />
    </g>
  );
}

export function CardSvg({ user, words, picture }: { user: XUser; words: CardWords; picture: string | null }) {
  const name = user.name;
  const facts1 = factLine(user);
  const quote = wrap(words.quote, 40, 3);
  // the balloon grows with the quote: 1 to 3 lines
  const top = 582;
  const bottom = top + 36 + quote.length * 48;
  const caption = `@${user.handle}`;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${CARD_W} ${CARD_H}`} width={CARD_W} height={CARD_H} role="img" aria-label={`Base card for ${name}`}>
      <defs>
        <clipPath id="card-photo">
          <rect x={PX} y={PY} width={PS} height={PS} />
        </clipPath>
        <DotsPattern />
      </defs>

      {/* this app's Base cobalt (#0A3DFF) sky with 45° white halftone clouds */}
      <HalftoneSky w={CARD_W} h={CARD_H} />

      {/* Warm-Platinum System 7 menu bar with PixelMark on the left and BASE 8453 badge on the right */}
      <g shapeRendering="crispEdges">
        <rect width={CARD_W} height="50" fill={KIT.chrome} />
        <rect y="50" width={CARD_W} height="3" fill={INK} />
        <PixelMark x={14} y={8} size={34} />
        <text y="34" fontFamily={UI} fontWeight="bold" fontSize="23" fill={KIT.ink}>
          {MENU.map(([m, x]) => (
            <tspan key={m} x={x + 22}>
              {m}
            </tspan>
          ))}
        </text>
        <rect x="1366" y="8" width="204" height="34" fill={KIT.blue} stroke={INK} strokeWidth="3" />
        <text x="1468" y="33" textAnchor="middle" fontFamily={MONO} fontWeight="bold" fontSize="21" fill="#fff">
          BASE 8453
        </text>
      </g>

      {/* Main warm-Platinum window with hard Macintosh drop shadow and ivory dotted paper */}
      <g shapeRendering="crispEdges">
        <rect x="70" y="92" width="1470" height="770" fill="#000" opacity="0.34" />
        <rect x="60" y="82" width="1470" height="770" fill={KIT.paper} stroke={INK} strokeWidth="4" />
        <rect x="62" y="84" width="1466" height="766" fill="url(#kit-dots)" />
      </g>
      <TitleBar x={62} y={84} w={1466} title={`${caption} — Base Card`} />

      {/* Get Info portrait frame: warm-Platinum bevel with Base cobalt caption */}
      <g shapeRendering="crispEdges">
        <rect x="110" y="180" width="452" height="514" fill="#000" opacity="0.16" />
        <rect x="104" y="174" width="452" height="514" fill={KIT.chrome} stroke={INK} strokeWidth="4" />
        <rect x="108" y="178" width="444" height="4" fill="#fff" />
        <rect x="108" y="178" width="4" height="506" fill="#fff" />
        <rect x="122" y="192" width="416" height="416" fill={KIT.chromeDark} />
      </g>
      <Picture handle={user.handle} picture={picture} />
      <rect x={PX} y={PY} width={PS} height={PS} fill="none" stroke={INK} strokeWidth="4" shapeRendering="crispEdges" />
      <text x="330" y="662" textAnchor="middle" fontFamily={MONO} fontWeight="bold" fontSize="34" fill={KIT.blue} {...fit(caption, 34, 400, 0.62)}>
        {caption}
      </text>
      {ships(user.bio) ? <Shipped /> : null}

      <Computer />
      <Arrow />
      <Watch />
      <Floppy />

      <BitmapTitle words={words} />

      {/* Identity block: Georgia serif name + cobalt hairline + monospace handle/followers */}
      <text x="620" y="486" fontFamily={SERIF} fontWeight="bold" fontSize="58" fill={KIT.ink} {...fit(name, 58, 880, 0.62)}>
        {name}
      </text>
      <rect x="620" y="500" width="120" height="4" fill={KIT.blue} shapeRendering="crispEdges" />
      <text x="622" y="538" fontFamily={MONO} fontSize="26" fill={KIT.dim} {...fit(facts1, 26, 880, 0.62)}>
        {facts1}
      </text>

      {/* Quote help balloon: crisp white paper with Base cobalt border and subtle shadow */}
      <g>
        <path d={`M624 ${top + 30}L566 ${top + 70}L624 ${top + 62}Z`} transform="translate(6 6)" fill="#000" opacity="0.22" />
        <rect x="626" y={top + 6} width="872" height={bottom - top} rx="22" fill="#000" opacity="0.22" />
        <rect x="620" y={top} width="872" height={bottom - top} rx="22" fill="#ffffff" stroke={KIT.blue} strokeWidth="4" />
        <path d={`M622 ${top + 28}L566 ${top + 70}L622 ${top + 60}`} fill="#ffffff" stroke={KIT.blue} strokeWidth="4" strokeLinejoin="miter" />
        {quote.map((line, i) => (
          <text key={i} x="652" y={top + 54 + i * 48} fontFamily={SERIF} fontSize="32" fill={KIT.ink} {...fit(line, 32, 808, 0.58)}>
            {line}
          </text>
        ))}
      </g>

      {/* Warm-Platinum status bar with the brand */}
      <g shapeRendering="crispEdges">
        <rect x="64" y="804" width="1462" height="3" fill={INK} />
        <rect x="64" y="807" width="1462" height="43" fill={KIT.chrome} />
        <PixelMark x={80} y={813} size={30} />
      </g>
      <text x="122" y="836" fontFamily={MONO} fontWeight="bold" fontSize="22" fill={KIT.blue}>
        {BRAND.domain}
      </text>
      <text x="1504" y="836" textAnchor="end" fontFamily={MONO} fontSize="20" fill={KIT.dim}>
        {`${host()} · read from X, drawn on Base`}
      </text>
    </svg>
  );
}

/** The card's SVG drawn onto a 1600×900 canvas — what Download saves and Copy copies. */
export function drawCard(svg: SVGSVGElement): Promise<HTMLCanvasElement> {
  return new Promise((done, fail) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = CARD_W;
      canvas.height = CARD_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return fail(new Error("This browser cannot draw the picture — take a screenshot instead."));
      ctx.drawImage(img, 0, 0, CARD_W, CARD_H);
      done(canvas);
    };
    img.onerror = () => fail(new Error("The picture could not be drawn — take a screenshot instead."));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  });
}

/** The post for X: the words; the picture is the user's to attach. */
export function shareUrl(handle: string, words: CardWords): string {
  const text = `My Base card, @${handle}: ${words.title}. Painted in ${PAINT} by ${BRAND.name} — make yours at ${origin()}/?do=card`;
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

/** The tool palette: 16×16 one-bit glyphs of this app's own drawing. */
const TOOLS: readonly { readonly name: string; readonly d: ReactNode }[] = [
  { name: "Selection", d: <rect x="2.5" y="3.5" width="11" height="9" fill="none" stroke="#000" strokeDasharray="2 1" /> },
  { name: "Lasso", d: <path d="M8 3c4 0 6 2 6 4s-3 3-6 3-6-1-6-3 2-4 6-4ZM5 10l-1 4" fill="none" stroke="#000" /> },
  { name: "Hand", d: <path d="M5 14V6h1v4V3h2v7V2h2v8V4h2v6l1-2h1l-2 6Z" fill="#fff" stroke="#000" /> },
  { name: "Text", d: <path d="M3 13l4-10h2l4 10h-2l-1-3H6l-1 3ZM6.5 8.5h3L8 4.5Z" fill="#000" /> },
  { name: "Paint bucket", d: <path d="M3 8l5-5 5 5-5 5ZM13 8v5h1V8" fill="#fff" stroke="#000" /> },
  { name: "Spray can", d: <path d="M8 6h4v8H8ZM9 4h2v2H9ZM3 3h1v1H3ZM5 2h1v1H5ZM3 6h1v1H3ZM5 5h1v1H5ZM2 4.5h1v1H2Z" fill="#000" /> },
  { name: "Brush", d: <path d="M12 2l2 2-6 6-2-2ZM6 9c-2 0-3 1-3 4 2 0 4-1 4-3Z" fill="#000" /> },
  { name: "Pencil", d: <path d="M11 2l3 3-8 8H3v-3ZM3 13l1-3 2 2Z" fill="#fff" stroke="#000" /> },
  { name: "Line", d: <path d="M2 14L14 2" stroke="#000" strokeWidth="1.5" /> },
  { name: "Eraser", d: <path d="M2.5 9.5l6-6 5 5-6 6h-2l-3-3Z" fill="#fff" stroke="#000" /> },
  { name: "Rectangle", d: <rect x="2.5" y="3.5" width="11" height="9" fill="none" stroke="#000" /> },
  { name: "Filled rectangle", d: <rect x="2.5" y="3.5" width="11" height="9" fill="#888" stroke="#000" /> },
  { name: "Rounded rectangle", d: <rect x="2.5" y="3.5" width="11" height="9" rx="3" fill="none" stroke="#000" /> },
  { name: "Filled rounded rectangle", d: <rect x="2.5" y="3.5" width="11" height="9" rx="3" fill="#888" stroke="#000" /> },
  { name: "Oval", d: <ellipse cx="8" cy="8" rx="6" ry="4.5" fill="none" stroke="#000" /> },
  { name: "Polygon", d: <path d="M3 12l2-8 5 2 3-3v9Z" fill="none" stroke="#000" /> },
];

/** The pattern palette: a few one-bit patterns, then the era's colours. */
const PATTERNS: readonly string[] = [
  "#000",
  "#fff",
  "repeating-conic-gradient(#000 0 25%, #fff 0 50%) 0 0/4px 4px",
  "repeating-linear-gradient(45deg, #000 0 1px, #fff 1px 4px)",
  "repeating-linear-gradient(0deg, #000 0 1px, #fff 1px 4px)",
  "repeating-linear-gradient(90deg, #000 0 1px, #fff 1px 4px)",
  "radial-gradient(#000 1px, #fff 1px) 0 0/4px 4px",
  "repeating-conic-gradient(#6b74c9 0 25%, #8f97e0 0 50%) 0 0/4px 4px",
  "#ff3b30",
  "#ff9500",
  "#ffd60a",
  "#2ab24a",
  "#00a2c7",
  "#0052ff",
  "#4b2ec2",
  "#c03cff",
  "#ff2a8a",
  "#8a5a2b",
  "#888",
  "#ccc",
];

function Paint({ title, toolbar, children }: { title: string; toolbar: ReactNode; children: ReactNode }) {
  return (
    <div className="qpaint" aria-label={title}>
      <div className="qpaint__title">
        <i className="qpaint__box" aria-hidden="true" />
        <span>{title}</span>
        <i className="qpaint__box qpaint__box--zoom" aria-hidden="true" />
      </div>
      <div className="qpaint__menu" aria-hidden="true">
        {["File", "Edit", "Goodies", "Font", "FontSize", "Style"].map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
      {toolbar}
      <div className="qpaint__main">
        <div className="qpaint__tools" aria-hidden="true">
          {TOOLS.map((t, i) => (
            <i key={t.name} title={t.name} className={i === 7 ? "is-on" : undefined}>
              <svg viewBox="0 0 16 16" width="16" height="16" shapeRendering="crispEdges">
                {t.d}
              </svg>
            </i>
          ))}
        </div>
        <div className="qpaint__canvas">{children}</div>
      </div>
      <div className="qpaint__foot">
        <span className="qpaint__widths" aria-hidden="true">
          {[1, 2, 3, 5].map((w) => (
            <i key={w} style={{ height: w }} />
          ))}
        </span>
        <span className="qpaint__current" aria-hidden="true" style={{ background: PATTERNS[2] }} />
        <span className="qpaint__patterns" aria-hidden="true">
          {PATTERNS.map((p) => (
            <i key={p} style={{ background: p }} />
          ))}
        </span>
        <span className="qpaint__status">
          Make yours at {host()}
          <br />
          Read from X through FxTwitter; nothing is stored.
        </span>
      </div>
    </div>
  );
}

/** A push button of the era: rounded, one black line; the default one wears a thick ring. */
function Push({ children, primary, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  const button = (
    <button type="button" className={["qbtn", className ?? ""].filter(Boolean).join(" ")} {...rest}>
      {children}
    </button>
  );
  return primary ? <span className="qbtn__ring">{button}</span> : button;
}

type Stage =
  | { readonly kind: "wizard" }
  | { readonly kind: "reading"; readonly who: string }
  | { readonly kind: "card"; readonly user: XUser };

/** The viewer: the paint program around the card, its push buttons above the canvas. */
export function CardViewer({ user, onBack }: { user: XUser; onBack?: (() => void) | undefined }) {
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [roll, setRoll] = useState(0);
  const [picture, setPicture] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const words = cardWords(user, roll);

  // the profile's own picture, as a data: URL so the canvas stays untainted for Download
  useEffect(() => {
    let live = true;
    setPicture(null);
    void pictureData(user.avatar).then((p) => live && setPicture(p));
    return () => {
      live = false;
    };
  }, [user.avatar]);

  const canvas = () => drawCard(box.current!.querySelector("svg")!);
  const download = () =>
    canvas().then(
      (c) => {
        const a = document.createElement("a");
        a.href = c.toDataURL("image/png");
        a.download = `${user.handle}_base_card.png`;
        a.click();
        setNote("Saved to your computer.");
      },
      (e: unknown) => setNote(messageOf(e)),
    );
  const copy = async () => {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return setNote("This browser cannot copy pictures — use Download PNG instead.");
    try {
      const blob = await new Promise<Blob>((done, fail) => canvas().then((c) => c.toBlob((b) => (b ? done(b) : fail(new Error("The picture could not be made.")))), fail));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setNote("Copied — paste it anywhere.");
    } catch (e) {
      setNote(`Could not copy: ${messageOf(e)} Use Download PNG instead.`);
    }
  };
  const choose = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return setNote("That file is not a picture.");
    setPicture(await dataUrl(f));
    setNote("Picture changed — it stays on this computer.");
  };

  const toolbar = (
    <div className="qpaint__bar" role="toolbar" aria-label={PAINT}>
      <Push primary onClick={() => void download()}>
        Download PNG
      </Push>
      <Push onClick={() => void copy()}>Copy image</Push>
      <a className="qbtn" href={shareUrl(user.handle, words)} target="_blank" rel="noreferrer">
        Post on X
      </a>
      <Push onClick={() => (setRoll((r) => r + 1), setNote(null))}>Reroll</Push>
      <a className="qbtn" href={`https://x.com/${user.handle}`} target="_blank" rel="noreferrer">
        @{user.handle} on X
      </a>
      <Push onClick={() => file.current!.click()}>Change picture…</Push>
      <input ref={file} type="file" accept="image/*" hidden aria-label="Picture file" onChange={(e) => void choose(e.target.files?.[0])} />
      {onBack ? <Push onClick={onBack}>Back to wizard</Push> : null}
    </div>
  );

  return (
    <div className="qcard">
      <Paint title={`${user.handle} — Paint`} toolbar={toolbar}>
        <div ref={box} className="qpaint__card">
          <CardSvg user={user} words={words} picture={picture} />
        </div>
      </Paint>
      {note ? (
        <p role="status" className="qcard__note">
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** The program: the Card Wizard, then the viewer. */
export function CardPanel() {
  const [text, setText] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "wizard" });
  const [last, setLast] = useState<XUser | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const create = async (typed: string) => {
    setProblem(null);
    let handle: string;
    try {
      handle = parseHandle(typed);
    } catch (e) {
      return setProblem(messageOf(e));
    }
    setStage({ kind: "reading", who: handle });
    const found = await xProfile(handle);
    if (found.kind === "found") {
      setLast(found.user);
      setStage({ kind: "card", user: found.user });
    } else {
      setProblem(lookupWords(found));
      setStage({ kind: "wizard" });
    }
  };
  useInbox("c", (v) => (setText(v), void create(v)));

  if (stage.kind === "card") return <CardViewer user={stage.user} onBack={() => setStage({ kind: "wizard" })} />;
  if (stage.kind === "reading") return <p className="dim">Reading @{stage.who} from X…</p>;
  return (
    <form
      className="qdialog"
      aria-label="Card Wizard"
      onSubmit={(e) => {
        e.preventDefault();
        void create(text);
      }}
    >
      <div className="qdialog__art" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="64" height="64" shapeRendering="crispEdges">
          <rect x="3" y="5" width="22" height="25" fill="#fff" stroke="#000" strokeWidth="1.5" />
          <rect x="6" y="8" width="16" height="15" fill="#0052ff" />
          <rect x="11" y="12" width="2" height="3" fill="#fff" />
          <rect x="15" y="12" width="2" height="3" fill="#fff" />
          <path d="M10 18h1v1h6v-1h1v2h-8Z" fill="#fff" />
          <path d="M22 2l2 4 4 1-3 3 1 4-4-2-4 2 1-4-3-3 4-1Z" fill="#ffd60a" stroke="#000" />
        </svg>
      </div>
      <div className="qdialog__body">
        <p className="qdialog__head">Create my Base card</p>
        <p>
          Type your X handle. {BRAND.name} grabs your profile picture and bio, then writes something nice(ish) about you in {PAINT}.
        </p>
        <label className="handle">
          <span aria-hidden="true">@</span>
          <input className="field" aria-label="X handle" placeholder="yourhandle" autoComplete="off" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        {problem ? <p className="tx__warn">{problem}</p> : null}
        <div className="qdialog__buttons">
          <Push
            onClick={() => {
              setProblem(null);
              if (last) setStage({ kind: "card", user: last });
              else setText("");
            }}
          >
            Cancel
          </Push>
          <Push primary type="submit" disabled={text.trim() === ""}>
            Create card
          </Push>
        </div>
      </div>
    </form>
  );
}
