import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { BRAND } from "@/brand";
import { messageOf } from "@/lib/errors";
import { short } from "@/skills/format";
import { codeLabels, LAUNCHPAD_CODE } from "@/skills/verdict";
import type { Report, Row, Tone } from "@/skills/types";
import { CARD_H, CARD_W, drawCard } from "@/features/panels/BaseCard";
import { usePulse } from "@/ui/usePulse";
import { Gel } from "@/ui/Gel";

/**
 * A Token Verdict as one picture to post (2026-11-04, the owner: "dễ share, dễ viral"). Built for a
 * feed seen at phone size: the verdict as a stamp, three big tiles — does it sell, is the code clean,
 * what else — instead of sentences; the token's own logo; a red card when it is high risk, led by the
 * reason; and the way back (this app's address and a QR code) plus when and at which block it was
 * checked, so a repost still says where and when. Every word is drawn from the report itself, so the
 * picture can never say more than the check found, and "no red flags found" is never "safe" (rule 12).
 */

export type Tile = { readonly tone: Tone; readonly title: string; readonly sub: string };

export type VerdictCard = {
  readonly token: string;
  readonly symbol: string;
  readonly tone: Tone;
  readonly headline: string;
  readonly score: string;
  /** for a high-risk verdict: the first red line, said big */
  readonly reason: string | null;
  readonly tiles: readonly [Tile, Tile, Tile];
  /** the market at a glance — liquidity and 24h volume, as the report read them; absent when it did not */
  readonly figures: readonly { readonly label: string; readonly value: string }[];
};

const HEADLINE: Record<Tone, string> = { bad: "HIGH RISK", warn: "CAUTION", ok: "NO RED FLAGS FOUND" };
const INK: Record<Tone, string> = { bad: "#c62828", warn: "#a85d00", ok: "#1d6e1d" };
const MARK: Record<Tone, string> = { bad: "✕", warn: "!", ok: "✓" };
const RANK: Record<Tone, number> = { bad: 0, warn: 1, ok: 2 };

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** a row's value up to its first " — ", the part that reads as an answer */
const gist = (v: string) => v.split(" — ")[0]!;

function tradeTile(r: Row | undefined): Tile {
  if (!r?.tone || r.tone === "warn") return { tone: "warn", title: "Trade not checked", sub: r ? cut(gist(r.value), 34) : "no simulation" };
  if (r.tone === "bad") return { tone: "bad", title: "Can't sell", sub: cut(gist(r.value), 34) };
  const lost = r.value.match(/([\d.]+)% lost/)?.[1];
  return { tone: "ok", title: "Sells fine", sub: lost ? `−${lost}% round trip` : cut(gist(r.value), 34) };
}

function codeTile(rows: readonly Row[]): Tile {
  const labels = new Set(codeLabels());
  const scan = rows.find((r) => r.label === "Code scan" || r.label === LAUNCHPAD_CODE.label);
  const flags = rows.filter((r) => labels.has(r.label) && r.tone && r.tone !== "ok").sort((a, b) => RANK[a.tone!] - RANK[b.tone!]);
  if (flags.length) {
    const worst = flags[0]!;
    return { tone: worst.tone!, title: worst.tone === "bad" ? "Code trap" : flags.length === 1 ? "1 code flag" : `${flags.length} code flags`, sub: cut(worst.label, 34) };
  }
  if (scan?.tone === "ok") {
    if (scan.label === LAUNCHPAD_CODE.label) return { tone: "ok", title: "Code clean", sub: "no admin, ever" };
    const tax = scan.value.match(/tax ([\d.]+)% buy \/ ([\d.]+)% sell/);
    return { tone: "ok", title: "Code clean", sub: tax ? `${Number(tax[1])}% buy / ${Number(tax[2])}% sell tax` : cut(gist(scan.value), 34) };
  }
  return { tone: "warn", title: "Code not scanned", sub: scan ? cut(gist(scan.value), 34) : "no report" };
}

function otherTile(rows: readonly Row[]): Tile {
  const worst = [...rows].sort((a, b) => RANK[a.tone!] - RANK[b.tone!])[0];
  if (!worst || worst.tone === "ok") return { tone: "ok", title: "No other flags", sub: `${rows.length} more checks` };
  return { tone: worst.tone!, title: cut(worst.label, 17), sub: cut(gist(worst.value), 34) };
}

/** The card's facts, or `null` for any report that is not a finished Token Verdict. */
export function verdictCard(report: Report): VerdictCard | null {
  const verdict = report.rows.find((r) => r.label === "Verdict");
  const token = report.rows.find((r) => r.label === "Token")?.href?.match(/0x[0-9a-fA-F]{40}/)?.[0];
  if (!verdict?.tone || !token) return null;
  const labels = new Set([...codeLabels(), "Code scan", LAUNCHPAD_CODE.label]);
  const trade = report.rows.find((r) => r.label.startsWith("Buy → sell"));
  const rest = report.rows.filter((r) => r.tone && r !== verdict && r !== trade && !labels.has(r.label));
  const red = report.rows.find((r) => r.tone === "bad" && r !== verdict);
  const figures = report.rows
    .filter((r) => (r.label.startsWith("Liquidity") || r.label === "Volume 24h") && r.value.startsWith("$"))
    .map((r) => ({ label: r.label.startsWith("Liquidity") ? "Liquidity" : "Volume 24h", value: r.value.replace(/\.\d+$/, "") }));
  return {
    token,
    symbol: report.title.split(" — ")[0]!,
    tone: verdict.tone,
    headline: HEADLINE[verdict.tone],
    score: verdict.value.match(/\d+\/100/)?.[0] ?? "",
    reason: verdict.tone === "bad" && red ? cut(`${red.label}: ${gist(red.value)}`, 52) : null,
    tiles: [tradeTile(trade), codeTile(report.rows), otherTile(rest)],
    figures,
  };
}

/** The same check, for whoever opens the post or scans the code. */
export const verdictLink = (token: string): string => `${window.location.origin}/?do=safety&run-safety=${encodeURIComponent(`verdict ${token}`)}`;

export function verdictPost(c: VerdictCard): string {
  const text = `$${c.symbol} on Base: ${c.headline.toLowerCase()} — ${c.score} on ${BRAND.name}'s Token Verdict (a buy and a sell simulated on chain). Check any token before you buy: ${verdictLink(c.token)}`;
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

/** When the card was made, in words a reader anywhere reads the same way. */
export const checkedAt = (ms: number): string =>
  `${new Date(ms).toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} UTC`;

/** The QR code's dark cells, as [x, y] in modules, and its size. */
export function qrCells(text: string): { readonly size: number; readonly cells: readonly (readonly [number, number])[] } {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const cells: [number, number][] = [];
  for (let y = 0; y < modules.size; y++) for (let x = 0; x < modules.size; x++) if (modules.get(x, y)) cells.push([x, y]);
  return { size: modules.size, cells };
}

/** The token's logo as a data: URL (so the saved picture is never a tainted canvas), or `null`. */
export async function logoOf(token: string): Promise<string | null> {
  const answer = await fetch(`/api/logo/${token}`, { headers: { "x-quadra": "1" } });
  if (!answer.ok) return null;
  const type = answer.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return null;
  const bytes = new Uint8Array(await answer.arrayBuffer());
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return `data:${type};base64,${btoa(text)}`;
}

const SANS = "Inter, Helvetica, Arial, sans-serif";
const TILE_W = 350;

export function VerdictSvg({ c, logo = null, when, block = null }: { c: VerdictCard; logo?: string | null; when: string; block?: number | null }) {
  const ink = INK[c.tone];
  const red = c.tone === "bad";
  const qr = qrCells(verdictLink(c.token));
  
  const tilesY = red ? 548 : 500;
  const tileH = red ? 184 : 200;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${CARD_W} ${CARD_H}`} width={CARD_W} height={CARD_H} role="img" aria-label={`Token Verdict card for ${c.symbol}`}>
      <rect width={CARD_W} height={CARD_H} fill={red ? "#7a1414" : "#4a6fa5"} />
      <rect x="86" y="86" width={CARD_W - 160} height={CARD_H - 160} fill="#555" />
      <rect x="80" y="80" width={CARD_W - 160} height={CARD_H - 160} fill="#dddddd" stroke="#000" strokeWidth="4" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x="100" y={96 + i * 8} width={CARD_W - 200} height="3" fill="#aaa" />
      ))}
      <rect x={CARD_W / 2 - 230} y="86" width="460" height="52" fill="#dddddd" />
      <text x={CARD_W / 2} y="124" textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="30">
        Token Verdict · {BRAND.name}
      </text>
      <rect x="110" y="160" width={CARD_W - 220} height={CARD_H - 270} fill="#fff" stroke="#555" strokeWidth="2" />

      {/* the token: its logo, else its first letter */}
      <clipPath id="vc-logo">
        <circle cx="210" cy="250" r="56" />
      </clipPath>
      <circle cx="210" cy="250" r="58" fill="#eeeeee" stroke="#000" strokeWidth="3" />
      {logo ? (
        <image href={logo} x="154" y="194" width="112" height="112" clipPath="url(#vc-logo)" />
      ) : (
        <text x="210" y="272" textAnchor="middle" fontFamily={SANS} fontWeight="800" fontSize="60">
          {c.symbol.slice(0, 1).toUpperCase()}
        </text>
      )}
      <text x="290" y="276" fontFamily={SANS} fontWeight="700" fontSize="88">
        ${cut(c.symbol, 10)}
      </text>
      <text x="294" y="330" fontFamily="JetBrains Mono, Menlo, monospace" fontSize="30" fill="#444">
        {short(c.token)} · Base
      </text>

      <g transform="rotate(-4 1180 260)">
        <rect x="900" y="185" width="560" height="150" fill={red ? "#fdecec" : "none"} stroke={ink} strokeWidth="10" rx="14" />
        <text x="1180" y="282" textAnchor="middle" fontFamily={SANS} fontWeight="800" fontSize={c.headline.length > 10 ? 52 : 84} fill={ink}>
          {c.headline}
        </text>
      </g>
      <text x="1180" y="395" textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="44" fill={ink}>
        {c.score}
      </text>

      {c.figures.map((f, i) => (
        <g key={f.label}>
          <text x={164 + i * 330} y="395" fontFamily={SANS} fontSize="26" fill="#555">
            {f.label}
          </text>
          <text x={164 + i * 330} y="440" fontFamily={SANS} fontWeight="700" fontSize="40">
            {f.value}
          </text>
        </g>
      ))}

      {c.reason ? (
        <g>
          <rect x="150" y="466" width="1300" height="64" fill="#c62828" />
          <text x="176" y="510" fontFamily={SANS} fontWeight="800" fontSize="38" fill="#fff">
            ✕ {c.reason}
          </text>
        </g>
      ) : null}

      {c.tiles.map((t, i) => {
        const x = 150 + i * (TILE_W + 20);
        return (
          <g key={t.title}>
            <rect x={x} y={tilesY} width={TILE_W} height={tileH} fill={t.tone === "ok" ? "#eef6ee" : t.tone === "bad" ? "#fdecec" : "#fdf3e6"} stroke={INK[t.tone]} strokeWidth="4" />
            <circle cx={x + 50} cy={tilesY + 56} r="28" fill={INK[t.tone]} />
            <text x={x + 50} y={tilesY + 68} textAnchor="middle" fontFamily={SANS} fontWeight="800" fontSize="34" fill="#fff">
              {MARK[t.tone]}
            </text>
            <text x={x + 28} y={tilesY + tileH - 64} fontFamily={SANS} fontWeight="800" fontSize="40">
              {t.title}
            </text>
            <text x={x + 28} y={tilesY + tileH - 24} fontFamily={SANS} fontSize="26" fill="#333">
              {t.sub}
            </text>
          </g>
        );
      })}

      {/* the way back, and when */}
      <rect x="1290" y={tilesY} width="160" height={tileH} fill="#fff" stroke="#000" strokeWidth="3" />
      <g transform={`translate(${1370 - (tileH - 50) / 2} ${tilesY + 5})`}>
        {qr.cells.map(([x, y]) => (
          <rect key={`${x}-${y}`} x={(x * (tileH - 50)) / qr.size} y={(y * (tileH - 50)) / qr.size} width={(tileH - 50) / qr.size + 0.2} height={(tileH - 50) / qr.size + 0.2} fill="#000" />
        ))}
      </g>
      <text x="1370" y={tilesY + tileH - 12} textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="20">
        scan to check
      </text>
      <text x="150" y="780" fontFamily={SANS} fontSize="24" fill="#555">
        Checked {when}
        {block !== null ? ` · block ${block.toLocaleString("en-US")}` : ""} · a buy and a sell simulated on Base · not advice
      </text>

      <text x="120" y={CARD_H - 30} fontFamily={SANS} fontWeight="700" fontSize="34" fill="#fff">
        Check any token free → {window.location.host}
      </text>
    </svg>
  );
}

export function VerdictShare({ c }: { c: VerdictCard }) {
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
        a.download = `${c.symbol}_verdict_${BRAND.name}.png`;
        a.click();
        setNote("Saved to your computer — attach it to your post.");
      },
      (e: unknown) => setNote(messageOf(e)),
    );
  return (
    <fieldset className="group">
      <legend>Share this verdict</legend>
      <div ref={box} className="coin__card">
        <VerdictSvg c={c} logo={logo} when={checkedAt(made)} block={block} />
      </div>
      <div className="row">
        <a className="gel gel--quiet" href={verdictPost(c)} target="_blank" rel="noopener noreferrer">
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
