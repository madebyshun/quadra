import { useEffect, useRef, useState } from "react";
import { BRAND } from "@/brand";
import { messageOf } from "@/lib/errors";
import { short } from "@/skills/format";
import type { Report, Tone } from "@/skills/types";
import { CARD_H, CARD_W, drawCard } from "@/features/panels/BaseCard";
import { checkedAt, logoOf, qrCells } from "@/features/panels/VerdictShare";
import { usePulse } from "@/ui/usePulse";
import { Gel } from "@/ui/Gel";

/**
 * A Trade Depth report as one picture to post (2026-11-12, the owner: "tạo thành hình ảnh, dễ share
 * hơn"). Six cells — buy and sell at $1k, $10k, $100k — each the impact Relay quoted, coloured as the
 * report coloured it; a size Relay refused as "too high" is red with its number, a size it did not
 * quote says so. Every figure comes from the report's own rows, so the picture cannot claim more
 * than the quotes did, and the way back (a QR code that runs the same check) travels with it.
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
const INK: Record<Tone, string> = { bad: "#c62828", warn: "#a85d00", ok: "#1d6e1d" };
const FILL: Record<Tone, string> = { bad: "#fdecec", warn: "#fdf3e6", ok: "#eef6ee" };
const SANS = "Inter, Helvetica, Arial, sans-serif";

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

function Cells({ cells, y, side }: { cells: readonly DepthCell[]; y: number; side: string }) {
  return (
    <g>
      <text x="170" y={y + 96} fontFamily={SANS} fontWeight="800" fontSize="44">
        {side}
      </text>
      {cells.map((c, i) => {
        const x = 330 + i * 330;
        return (
          <g key={c.label}>
            <rect x={x} y={y} width="310" height="150" fill={FILL[c.tone]} stroke={INK[c.tone]} strokeWidth="5" />
            <text x={x + 155} y={y + 82} textAnchor="middle" fontFamily={SANS} fontWeight="800" fontSize="58" fill={INK[c.tone]}>
              {c.figure}
            </text>
            <text x={x + 155} y={y + 126} textAnchor="middle" fontFamily={SANS} fontSize="24" fill="#333">
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
  const red = c.tone === "bad";
  const qr = qrCells(depthLink(c.token));
  const sizes = c.buys.map((b) => b.label);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${CARD_W} ${CARD_H}`} width={CARD_W} height={CARD_H} role="img" aria-label={`Trade Depth card for ${c.symbol}`}>
      <rect width={CARD_W} height={CARD_H} fill={red ? "#7a1414" : "#4a6fa5"} />
      <rect x="86" y="86" width={CARD_W - 160} height={CARD_H - 160} fill="#555" />
      <rect x="80" y="80" width={CARD_W - 160} height={CARD_H - 160} fill="#dddddd" stroke="#000" strokeWidth="4" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x="100" y={96 + i * 8} width={CARD_W - 200} height="3" fill="#aaa" />
      ))}
      <rect x={CARD_W / 2 - 230} y="86" width="460" height="52" fill="#dddddd" />
      <text x={CARD_W / 2} y="124" textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="30">
        Trade Depth · {BRAND.name}
      </text>
      <rect x="110" y="160" width={CARD_W - 220} height={CARD_H - 270} fill="#fff" stroke="#555" strokeWidth="2" />

      <clipPath id="dc-logo">
        <circle cx="210" cy="240" r="50" />
      </clipPath>
      <circle cx="210" cy="240" r="52" fill="#eeeeee" stroke="#000" strokeWidth="3" />
      {logo ? (
        <image href={logo} x="160" y="190" width="100" height="100" clipPath="url(#dc-logo)" />
      ) : (
        <text x="210" y="260" textAnchor="middle" fontFamily={SANS} fontWeight="800" fontSize="54">
          {c.symbol.slice(0, 1).toUpperCase()}
        </text>
      )}
      <text x="285" y="266" fontFamily={SANS} fontWeight="700" fontSize="80">
        ${c.symbol.slice(0, 10)}
      </text>
      <text x="289" y="312" fontFamily="JetBrains Mono, Menlo, monospace" fontSize="26" fill="#444">
        {short(c.token)} · Base
      </text>
      <g transform="rotate(-4 1260 245)">
        <rect x="1030" y="190" width="400" height="110" fill={red ? "#fdecec" : "none"} stroke={ink} strokeWidth="9" rx="12" />
        <text x="1230" y="266" textAnchor="middle" fontFamily={SANS} fontWeight="800" fontSize={c.headline.length > 6 ? 44 : 72} fill={ink}>
          {c.headline}
        </text>
      </g>

      {sizes.map((s, i) => (
        <text key={s} x={485 + i * 330} y="370" textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="32" fill="#555">
          {s} order
        </text>
      ))}
      <Cells cells={c.buys} y={392} side="Buy" />
      <Cells cells={c.sells} y={562} side="Sell" />

      <rect x="1330" y="392" width="120" height="320" fill="#fff" stroke="#000" strokeWidth="3" />
      <g transform="translate(1340 470)">
        {qr.cells.map(([x, y]) => (
          <rect key={`${x}-${y}`} x={(x * 100) / qr.size} y={(y * 100) / qr.size} width={100 / qr.size + 0.2} height={100 / qr.size + 0.2} fill="#000" />
        ))}
      </g>
      <text x="1390" y="610" textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="20">
        scan to
      </text>
      <text x="1390" y="636" textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="20">
        check
      </text>

      {c.pool ? (
        <text x="150" y="740" fontFamily={SANS} fontWeight="700" fontSize="24" fill="#333">
          {c.pool}
        </text>
      ) : null}
      <text x="150" y="772" fontFamily={SANS} fontSize="22" fill="#555">
        Quoted {when}
        {block !== null ? ` · block ${block.toLocaleString("en-US")}` : ""} · Relay's route, nothing signed · not advice
      </text>
      <text x="120" y={CARD_H - 30} fontFamily={SANS} fontWeight="700" fontSize="34" fill="#fff">
        Check any token's depth free → {window.location.host}
      </text>
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
