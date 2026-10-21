import type { FeatureId } from "@/features/registry";

/**
 * One hand-written 24x24 glyph per menu entry — no icon-library dependency, so a
 * bare clone with no network can still build (see CLAUDE.md's rule about
 * `npm run gate` needing no install). Purely decorative: every call site marks
 * the wrapping `<svg>` `aria-hidden`, because the visible label text is what
 * carries the accessible name.
 *
 * ── Style: 1-bit, the way a Macintosh or Newton drew an icon ──────────────────
 * These were thin single-weight outlines, which is a 2010s style and read as
 * faint line art once the Aqua tile behind them came off. The era this interface
 * is drawn in did it differently: a solid white body with a heavy black outline,
 * black fills for the details, no gradients and no colour. That silhouette is
 * also what makes an icon legible against a photographic desktop, which is why
 * the original ones looked like that in the first place.
 *
 * So each glyph is built from three paint styles rather than one:
 *   BODY — white fill, dark outline: the object itself
 *   LINE — no fill, dark stroke: wires, prongs, rules
 *   INK  — solid dark fill, no stroke: the parts that read as black at 30px
 */
const BODY = {
  fill: "#fff",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const LINE = { ...BODY, fill: "none", strokeWidth: 2 };

const INK = { fill: "currentColor", stroke: "none" };

export type IconId = FeatureId | "docs" | "api" | "verify";

const GLYPHS: Record<IconId, JSX.Element> = {
  taskmgr: (
    <>
      {/* a monitor showing a heartbeat line */}
      <g {...BODY}>
        <rect x="3" y="4" width="18" height="13" rx="1.5" />
      </g>
      <g {...LINE}>
        <path d="M5.5 11.5h3l1.6-3.6 2.4 6.4 1.8-4.2 1.1 1.4h3.1" />
        <path d="M9 20.4h6M12 17v3.4" />
      </g>
    </>
  ),
  trash: (
    <>
      {/* a wire basket with a crumpled coin in it */}
      <g {...BODY}>
        <path d="M5.2 7.5h13.6l-1.5 12.6a1.2 1.2 0 0 1-1.2 1H7.9a1.2 1.2 0 0 1-1.2-1Z" />
      </g>
      <g {...LINE}>
        <path d="M4 7.5h16M9.4 4.4h5.2M9.4 10.5l.6 8M14.6 10.5l-.6 8M12 10.5v8" />
      </g>
    </>
  ),
  soon: (
    <>
      {/* a folder with a clock on it */}
      <g {...BODY}>
        <path d="M2.8 6.2a1.2 1.2 0 0 1 1.2-1.2h5.2l2 2.2H20a1.2 1.2 0 0 1 1.2 1.2v10.4a1.2 1.2 0 0 1-1.2 1.2H4a1.2 1.2 0 0 1-1.2-1.2Z" />
        <circle cx="12" cy="13.6" r="3.6" />
      </g>
      <g {...LINE}>
        <path d="M12 11.8v1.9l1.3.9" />
      </g>
    </>
  ),
  rugsweeper: (
    <>
      {/* the mine: a round body with spikes */}
      <g {...LINE}>
        <path d="M12 2.8v3.4M12 17.8v3.4M2.8 12h3.4M17.8 12h3.4M5.5 5.5l2.4 2.4M16.1 16.1l2.4 2.4M5.5 18.5l2.4-2.4M16.1 7.9l2.4-2.4" />
      </g>
      <g {...BODY}>
        <circle cx="12" cy="12" r="5.6" />
      </g>
      <g {...INK}>
        <circle cx="10.2" cy="10.2" r="1.4" />
      </g>
    </>
  ),
  achievements: (
    <>
      {/* a trophy */}
      <g {...BODY}>
        <path d="M7 3.6h10v4.8a5 5 0 0 1-10 0Z" />
        <path d="M8.6 20.4h6.8l-.8-2.6H9.4Z" />
      </g>
      <g {...LINE}>
        <path d="M7 5.6H4.4a2.8 2.8 0 0 0 3.2 4.1M17 5.6h2.6a2.8 2.8 0 0 1-3.2 4.1M12 13.4v4.4" />
      </g>
    </>
  ),
  leaderboard: (
    <>
      {/* a podium */}
      <g {...BODY}>
        <rect x="8.6" y="8" width="6.8" height="12.4" />
        <rect x="2.8" y="12.2" width="5.8" height="8.2" />
        <rect x="15.4" y="14.4" width="5.8" height="6" />
      </g>
      <g {...INK}>
        <path d="M12 3.2 13 5.2l2.2.3-1.6 1.5.4 2.2L12 8.1l-2 1.1.4-2.2-1.6-1.5 2.2-.3Z" />
      </g>
    </>
  ),
  wallet: (
    <>
      {/* a billfold: body, flap across it, and the stud that reads as black at 30px */}
      <g {...BODY}>
        <rect x="2.5" y="5.5" width="19" height="13" rx="1.4" />
        <path d="M14 9.5h7.5v5H14a2.5 2.5 0 0 1 0-5Z" />
      </g>
      <g {...INK}>
        <circle cx="16.4" cy="12" r="1.5" />
      </g>
    </>
  ),
  swap: (
    <>
      <g {...BODY}>
        <path d="M3.5 6.5h10v-3l7 4.5-7 4.5v-3h-10Z" />
        <path d="M20.5 17.5h-10v3l-7-4.5 7-4.5v3h10Z" />
      </g>
    </>
  ),
  markets: (
    <>
      {/* a chart window: a framed pane with a rising line and two candles */}
      <g {...BODY}>
        <rect x="3" y="4" width="18" height="16" rx="1" />
      </g>
      <g {...LINE}>
        <path d="M5.5 16.5 9.5 12l3 2.5 6-7" />
      </g>
      <g {...INK}>
        <rect x="15.2" y="13" width="2" height="4.5" />
        <rect x="11.2" y="15.5" width="2" height="2" />
      </g>
    </>
  ),
  trade: (
    <>
      {/* two candlesticks, one up one down — a trading screen reduced to its mark */}
      <g {...LINE}>
        <path d="M8 3.5v17M16 3.5v17" />
      </g>
      <g {...BODY}>
        <rect x="5.5" y="7" width="5" height="8" rx="0.5" />
        <rect x="13.5" y="10" width="5" height="6" rx="0.5" />
      </g>
    </>
  ),
  inference: (
    <>
      <g {...LINE}>
        <path d="M9.5 6V3.5M14.5 6V3.5M9.5 20.5V18M14.5 20.5V18M6 9.5H3.5M6 14.5H3.5M20.5 9.5H18M20.5 14.5H18" />
      </g>
      <g {...BODY}>
        <rect x="6" y="6" width="12" height="12" rx="1" />
      </g>
      <g {...INK}>
        <rect x="9" y="9" width="6" height="6" rx="0.5" />
      </g>
    </>
  ),
  terminal: (
    <>
      {/* a screen with a prompt: the one icon that is a command line */}
      <g {...BODY}>
        <rect x="2.5" y="4" width="19" height="15" rx="1.4" />
      </g>
      <g {...LINE}>
        <path d="m6.5 9 3 2.8-3 2.8M11.5 15h5" />
      </g>
    </>
  ),
  research: (
    <>
      {/* a magnifier: lens, handle, and the glint that reads at 30px */}
      <g {...LINE}>
        <path d="m15.2 15.2 5.3 5.3" strokeWidth={3} />
      </g>
      <g {...BODY}>
        <circle cx="10" cy="10" r="6.5" />
      </g>
      <g {...INK}>
        <path d="M7 9.2a3.2 3.2 0 0 1 2.2-2.2l.4 1.2a1.9 1.9 0 0 0-1.4 1.4Z" />
      </g>
    </>
  ),
  safety: (
    <>
      {/* a shield with a warning mark — this window finds the traps */}
      <g {...BODY}>
        <path d="M12 2.6 19 5.4v6.3c0 4.3-2.9 7.4-7 9.1-4.1-1.7-7-4.8-7-9.1V5.4Z" />
      </g>
      <g {...INK}>
        <rect x="11" y="7" width="2" height="6" rx="1" />
        <circle cx="12" cy="15.8" r="1.2" />
      </g>
    </>
  ),
  send: (
    <>
      <g {...INK}>
        <path d="M2.5 11.8 21.5 3.5l-7.4 17-3-6.4-8.6-2.3Z" />
      </g>
      {/* the fold, knocked out in white — a dark line inside a solid body is invisible */}
      <g fill="none" stroke="#fff" strokeWidth={1.6} strokeLinecap="round">
        <path d="m11.1 14.1 9-10.2" />
      </g>
    </>
  ),
  mcp: (
    <>
      <g {...LINE}>
        <path d="M9.5 8.5V3.5M14.5 8.5V3.5M12 17v3.5M9.5 20.5h5" />
      </g>
      <g {...BODY}>
        <path d="M7.5 8.5h9v4a4.5 4.5 0 0 1-9 0Z" />
      </g>
    </>
  ),
  bridge: (
    <>
      {/* a suspension bridge: two towers, a slung cable, a deck across the middle */}
      <g {...LINE}>
        <path d="M7 15.5V5M17 15.5V5" />
        <path d="M2.5 11C4 7.5 5.5 5.5 7 5.5c2.5 0 2.8 6 5 6s2.5-6 5-6c1.5 0 3 2 4.5 5.5" />
      </g>
      <g {...BODY}>
        <rect x="2.5" y="15.2" width="19" height="3" rx="0.6" />
      </g>
    </>
  ),
  launch: (
    <>
      <g {...LINE}>
        <path d="M8.5 15.5 6 18.5M15.5 15.5l2.5 3M10 19.5 9 21.5M14 19.5l1 2" />
      </g>
      <g {...BODY}>
        <path d="M12 2.5c3.2 2.3 4.8 5.9 4.2 10.5L12 16.8l-4.2-3.8C7.2 8.4 8.8 4.8 12 2.5Z" />
      </g>
      <g {...INK}>
        <circle cx="12" cy="9.5" r="1.8" />
      </g>
    </>
  ),
  coins: (
    <>
      {/* a short stack of coins and one standing in front: what was launched here */}
      <g {...BODY}>
        <ellipse cx="9" cy="17" rx="6" ry="2.4" />
        <path d="M3 17v-3.2c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4V17" />
        <ellipse cx="9" cy="13.8" rx="6" ry="2.4" />
        <path d="M3 13.8v-3.2c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4v3.2" />
        <ellipse cx="9" cy="10.6" rx="6" ry="2.4" />
        <circle cx="16.5" cy="8.5" r="5" />
      </g>
      <g {...INK}>
        <circle cx="16.5" cy="8.5" r="1.9" />
      </g>
    </>
  ),
  profile: (
    <>
      {/* a head and shoulders on an ID card: whose wallet this is */}
      <g {...BODY}>
        <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      </g>
      <g {...INK}>
        <circle cx="9" cy="10.5" r="2.4" />
        <path d="M5 17c.4-2.6 2-3.9 4-3.9s3.6 1.3 4 3.9Z" />
      </g>
      <g {...LINE}>
        <path d="M15 10h3.5M15 13h3.5" />
      </g>
    </>
  ),
  audit: (
    <>
      <g {...LINE}>
        <path d="m15.2 15.2 4.8 4.8" />
      </g>
      <g {...BODY}>
        <circle cx="10.2" cy="10.2" r="6.2" />
      </g>
      {/* a tick inside the lens: an empty circle is a magnifier, this one is a check */}
      <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="m7.4 10.3 2.1 2.1 3.6-4" />
      </g>
    </>
  ),
  hooks: (
    <>
      <g {...LINE}>
        <path d="M15 3.5v11a4.5 4.5 0 0 1-9 0v-1.5" />
      </g>
      <g {...BODY}>
        <rect x="12" y="2.5" width="6" height="2.6" rx="1.3" />
        <circle cx="6" cy="11" r="2.4" />
      </g>
    </>
  ),
  x402: (
    <>
      <g {...LINE}>
        <path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7" />
      </g>
      <g {...BODY}>
        <rect x="4.5" y="10.5" width="15" height="10" rx="1.2" />
      </g>
      <g {...INK}>
        <circle cx="12" cy="14.5" r="1.6" />
        <rect x="11.2" y="15" width="1.6" height="3.4" rx="0.7" />
      </g>
    </>
  ),
  docs: (
    <>
      <g {...BODY}>
        <path d="M6 2.8h8l4 4v14.4H6Z" />
        <path d="M14 2.8V7h4" />
      </g>
      <g {...INK}>
        <rect x="8.5" y="11" width="7" height="1.5" rx="0.6" />
        <rect x="8.5" y="14.5" width="7" height="1.5" rx="0.6" />
        <rect x="8.5" y="18" width="4.5" height="1.5" rx="0.6" />
      </g>
    </>
  ),
  api: (
    <>
      <g {...BODY}>
        <rect x="2.5" y="5" width="19" height="14" rx="1.2" />
      </g>
      <g {...LINE}>
        <path d="M8 9.5 5.5 12 8 14.5M16 9.5 18.5 12 16 14.5" />
      </g>
      <g {...INK}>
        <rect x="11" y="9" width="1.6" height="6" rx="0.7" transform="rotate(14 11.8 12)" />
      </g>
    </>
  ),
  verify: (
    <>
      <g {...BODY}>
        <path d="M12 2.6 19 5.4v6.3c0 4.3-2.9 7.4-7 9.1-4.1-1.7-7-4.8-7-9.1V5.4Z" />
      </g>
      <g {...LINE}>
        <path d="m8.4 11.8 2.6 2.6 4.8-5.4" />
      </g>
    </>
  ),
};

export function Icon({ id }: { id: IconId }) {
  return (
    <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
      {GLYPHS[id]}
    </svg>
  );
}
