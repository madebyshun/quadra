import { useEffect, useRef, useState } from "react";
import { BRAND } from "@/brand";
import { messageOf } from "@/lib/errors";
import { short } from "@/skills/format";
import type { Report, Tone } from "@/skills/types";
import { CARD_H, CARD_W, drawCard } from "@/features/panels/BaseCard";
import { checkedAt, logoOf, qrCells } from "@/features/panels/VerdictShare";
import { DotsPattern, Footer, HalftoneSky, KIT, Lcd, MONO, Qr, SANS, Selected, Win } from "@/features/panels/cardKit";
import { usePulse } from "@/ui/usePulse";
import { Gel } from "@/ui/Gel";

/**
 * A Trade Depth report as one picture to post (2026-11-12, the owner: "tạo thành hình ảnh, dễ share
 * hơn"; redrawn the same day after his references — small 90s windows over a halftone sky, the lead
 * line selected like text in an editor). Six cells — buy and sell at $1k, $10k, $100k — each the
 * impact Relay quoted, coloured as the report coloured it; a size Relay refused as "too high" is red
 * with its number, a size it did not quote says so. Every figure comes from the report's own rows,
 * so the picture cannot claim more than the quotes did, and the way back (a QR code that runs the
 * same check) travels with it.
 */

export type DepthCell = { readonly label: string; readonly tone: Tone; readonly figure: string; readonly note: string };
export type DepthCard = {
  readonly token: string;
  readonly symbol: string;
  readonly tone: Tone;
  readonly headline: string;
  readonly buys: readonly DepthCell[];
  readonly sells: readonly DepthCell[];
  readonly pool: string | null;
};

const HEADLINE: Record<Tone, string> = { bad: "THIN", warn: "PARTLY QUOTED", ok: "DEEP ENOUGH" };
const INK: Record<Tone, string> = { bad: KIT.red, warn: KIT.amber, ok: KIT.green };
const FILL: Record<Tone, string> = { bad: "#fdecec", warn: "#fdf3e6", ok: "#eef6ee" };

function cellOf(label: string, tone: Tone | undefined, value: string): DepthCell {
  const impact = /^(\d+\.\d+)% impact/.exec(value)?.[1];
  if (impact === undefined) return { label, tone: "warn", figure: "—", note: "not quoted" };
  const refused = value.includes("will not route");
  return { label, tone: tone ?? "warn", figure: `${impact}%`, note: refused ? "refused — too thin" : "price impact" };
}

/** The card for a finished Trade Depth report, or `null` for any other report. */
export function depthCard(report: Report): DepthCard | null {
  if (!report.title.endsWith("— Trade Depth")) return null;
  const tokenRow = report.rows.find((r) => r.label === "Token");
  const token = tokenRow?.href?.split("/").pop() ?? null;
  const head = report.rows[0];
  if (token === null || head === undefined) return null;
  const sizes = (side: "Buy" | "Sell") => report.rows.filter((r) => r.label.startsWith(`${side} `)).map((r) => cellOf(r.label.slice(side.length + 1), r.tone, r.value));
  const pool = report.rows.find((r) => r.label.startsWith("Pool · "));
  return {
    token,
    symbol: report.title.replace(/ — Trade Depth$/, ""),
    tone: head.tone ?? "warn",
    headline: HEADLINE[head.tone ?? "warn"],
    buys: sizes("Buy"),
    sells: sizes("Sell"),
    pool: pool ? `Deepest pool: ${pool.value.replace(" liquidity", "")} on ${pool.label.slice("Pool · ".length)}` : null,
  };
}

export const depthLink = (token: string): string => `${window.location.origin}/?do=research&run-research=${encodeURIComponent(`depth ${token}`)}`;

export function depthPost(c: DepthCard): string {
  const worst = [...c.buys, ...c.sells].find((x) => x.note.startsWith("refused")) ?? null;
  const lead = worst ? `a ${worst.label} order is refused at ${worst.figure} price impact` : `${c.headline.toLowerCase()}`;
  const text = `$${c.symbol} on Base: ${lead} — ${BRAND.name}'s Trade Depth ($1k / $10k / $100k, quoted on chain). Check any token before you size in: ${depthLink(c.token)}`;
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

/** The one line the card leads with, selected: the refused size, else what the largest buy costs. */
export function leadOf(c: DepthCard): string {
  const refused = [...c.buys.map((x) => ["buy", x] as const), ...c.sells.map((x) => ["sell", x] as const)].find(([, x]) => x.note.startsWith("refused"));
  if (refused) return `a ${refused[1].label} ${refused[0]} is refused at ${refused[1].figure}`;
  const big = c.buys.at(-1);
  return big && big.figure !== "—" ? `a ${big.label} buy moves it ${big.figure}` : "every size, quoted on chain";
}

function Cells({ cells, y, side }: { cells: readonly DepthCell[]; y: number; side: string }) {
  return (
    <g>
      <text x="150" y={y + 76} fontFamily={SANS} fontWeight="800" fontSize="40" fill={KIT.ink}>
        {side}
      </text>
      {cells.map((c, i) => {
        const x = 290 + i * 270;
        return (
          <g key={c.label}>
            <rect x={x} y={y} width="250" height="118" fill={FILL[c.tone]} stroke={INK[c.tone]} strokeWidth="4" />
            <text x={x + 125} y={y + 66} textAnchor="middle" fontFamily={SANS} fontWeight="800" fontSize="50" fill={INK[c.tone]}>
              {c.figure}
            </text>
            <text x={x + 125} y={y + 100} textAnchor="middle" fontFamily={SANS} fontSize="20" fill={KIT.dim}>
              {c.note}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function DepthSvg({ c, logo = null, when, block = null }: { c: DepthCard; logo?: string | null; when: string; block?: number | null }) {
  const ink = INK[c.tone];
  const qr = qrCells(depthLink(c.token));
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${CARD_W} ${CARD_H}`} width={CARD_W} height={CARD_H} role="img" aria-label={`Trade Depth card for ${c.symbol}`}>
      <defs>
        <DotsPattern />
        <clipPath id="dc-logo">
          <circle cx="190" cy="196" r="44" />
        </clipPath>
      </defs>
      <HalftoneSky w={CARD_W} h={CARD_H} alarm={c.tone === "bad"} />

      <Win x={90} y={70} w={1060} h={720} title={`Trade Depth — $${c.symbol.slice(0, 12)}`} dotted>
        <circle cx="190" cy="196" r="46" fill="#eee" stroke="#000" strokeWidth="3" />
        {logo ? (
          <image href={logo} x="146" y="152" width="88" height="88" clipPath="url(#dc-logo)" />
        ) : (
          <text x="190" y="214" textAnchor="middle" fontFamily={SANS} fontWeight="800" fontSize="48">
            {c.symbol.slice(0, 1).toUpperCase()}
          </text>
        )}
        <text x="262" y="230" fontFamily={SANS} fontWeight="800" fontSize="104" fill={KIT.blue} letterSpacing="-3">
          ${c.symbol.slice(0, 10)}
        </text>
        <text x="266" y="270" fontFamily={MONO} fontSize="22" fill={KIT.dim}>
          {short(c.token)} · Base
        </text>
        <Selected x={150} y={346} text={leadOf(c)} size={40} />

        {c.buys.map((b, i) => (
          <text key={b.label} x={415 + i * 270} y="430" textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="26" fill={KIT.dim}>
            {b.label} order
          </text>
        ))}
        <Cells cells={c.buys} y={448} side="Buy" />
        <Cells cells={c.sells} y={584} side="Sell" />

        {c.pool ? (
          <text x="150" y="738" fontFamily={SANS} fontWeight="700" fontSize="22" fill={KIT.ink}>
            {c.pool}
          </text>
        ) : null}
        <text x="150" y="768" fontFamily={SANS} fontSize="19" fill={KIT.dim}>
          Quoted {when}
          {block !== null ? ` · block ${block.toLocaleString("en-US")}` : ""} · Relay&apos;s route, nothing signed · not advice
        </text>
      </Win>

      <Win x={1190} y={70} w={330} h={210} title="Verdict">
        <g transform="rotate(-5 1355 190)">
          <rect x="1222" y="132" width="266" height="100" fill="none" stroke={ink} strokeWidth="8" rx="10" />
          <text x="1355" y="203" textAnchor="middle" fontFamily={SANS} fontWeight="900" fontSize={c.headline.length > 6 ? 32 : 66} fill={ink}>
            {c.headline}
          </text>
        </g>
      </Win>
      {block !== null ? (
        <Win x={1190} y={310} w={330} h={150} title="Base">
          <Lcd x={1212} y={356} w={286} label="block" value={block.toLocaleString("en-US")} />
        </Win>
      ) : null}
      <Win x={1190} y={490} w={330} h={300} title="Scan to check">
        <Qr x={1265} y={540} size={180} qr={qr} />
        <text x="1355" y="766" textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="18" fill={KIT.dim}>
          runs this check for you
        </text>
      </Win>

      <Footer x={90} y={CARD_H - 34} text={`Check any token's depth free → ${window.location.host}`} />
    </svg>
  );
}

export function DepthShare({ c }: { c: DepthCard }) {
  const box = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [made] = useState(() => Date.now());
  const pulse = usePulse();
  const block = pulse.kind === "live" ? pulse.pulse.block : null;
  useEffect(() => {
    let live = true;
    logoOf(c.token).then(
      (l) => live && setLogo(l),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [c.token]);
  const download = () =>
    drawCard(box.current!.querySelector("svg")!).then(
      (canvas) => {
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = `${c.symbol}_depth_${BRAND.name}.png`;
        a.click();
        setNote("Saved to your computer — attach it to your post.");
      },
      (e: unknown) => setNote(messageOf(e)),
    );
  return (
    <fieldset className="group">
      <legend>Share this depth check</legend>
      <div ref={box} className="coin__card">
        <DepthSvg c={c} logo={logo} when={checkedAt(made)} block={block} />
      </div>
      <div className="row">
        <a className="gel gel--quiet" href={depthPost(c)} target="_blank" rel="noopener noreferrer">
          Post on X
        </a>
        <Gel quiet onClick={() => void download()}>
          Download picture
        </Gel>
      </div>
      {note ? <p role="status">{note}</p> : null}
    </fieldset>
  );
}
