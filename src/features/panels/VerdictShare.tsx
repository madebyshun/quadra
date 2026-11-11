import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { BRAND } from "@/brand";
import { messageOf } from "@/lib/errors";
import { short } from "@/skills/format";
import { codeLabels, LAUNCHPAD_CODE } from "@/skills/verdict";
import type { Report, Row, Tone } from "@/skills/types";
import { CARD_H, CARD_W, drawCard } from "@/features/panels/BaseCard";
import { DotsPattern, Footer, HalftoneSky, KIT, Lcd, MONO, Qr, SANS, Selected, Win } from "@/features/panels/cardKit";
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
/** like `cut`, but at a word, so a tile never ends mid-word ("cannot be fill") */
export function words(s: string, n: number): string {
  if (s.length <= n) return s;
  let out = "";
  for (const w of s.split(" ")) {
    if ((out ? out.length + 1 : 0) + w.length > n - 1) break;
    out = out ? `${out} ${w}` : w;
  }
  return `${out || s.slice(0, n - 1)}…`;
}
/** what fits in a tile: its title at 36 px, its line at 24 px */
const TITLE = 16;
const SUB = 28;
/** a row's value up to its first " — ", the part that reads as an answer */
const gist = (v: string) => v.split(" — ")[0]!;

function tradeTile(r: Row | undefined): Tile {
  if (!r?.tone || r.tone === "warn") return { tone: "warn", title: "Trade not checked", sub: r ? words(gist(r.value), SUB) : "no simulation" };
  if (r.tone === "bad") return { tone: "bad", title: "Can't sell", sub: words(gist(r.value), SUB) };
  const lost = r.value.match(/([\d.]+)% lost/)?.[1];
  return { tone: "ok", title: "Sells fine", sub: lost ? `−${lost}% round trip` : words(gist(r.value), SUB) };
}

function codeTile(rows: readonly Row[]): Tile {
  const labels = new Set(codeLabels());
  const scan = rows.find((r) => r.label === "Code scan" || r.label === LAUNCHPAD_CODE.label);
  const flags = rows.filter((r) => labels.has(r.label) && r.tone && r.tone !== "ok").sort((a, b) => RANK[a.tone!] - RANK[b.tone!]);
  if (flags.length) {
    const worst = flags[0]!;
    return { tone: worst.tone!, title: worst.tone === "bad" ? "Code trap" : flags.length === 1 ? "1 code flag" : `${flags.length} code flags`, sub: words(worst.label, SUB) };
  }
  if (scan?.tone === "ok") {
    if (scan.label === LAUNCHPAD_CODE.label) return { tone: "ok", title: "Code clean", sub: "no admin, ever" };
    const tax = scan.value.match(/tax ([\d.]+)% buy \/ ([\d.]+)% sell/);
    return { tone: "ok", title: "Code clean", sub: tax ? `${Number(tax[1])}% buy / ${Number(tax[2])}% sell tax` : words(gist(scan.value), SUB) };
  }
  return { tone: "warn", title: "Code not scanned", sub: scan ? words(gist(scan.value), SUB) : "no report" };
}

function otherTile(rows: readonly Row[]): Tile {
  const worst = [...rows].sort((a, b) => RANK[a.tone!] - RANK[b.tone!])[0];
  if (!worst || worst.tone === "ok") return { tone: "ok", title: "No other flags", sub: `${rows.length} more checks` };
  return { tone: worst.tone!, title: words(worst.label, TITLE), sub: words(gist(worst.value), SUB) };
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
    reason: verdict.tone === "bad" && red ? words(`${red.label}: ${gist(red.value)}`, 56) : null,
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

const FILL: Record<Tone, string> = { bad: "#fdecec", warn: "#fdf3e6", ok: "#eef6ee" };

export function VerdictSvg({ c, logo = null, when, block = null }: { c: VerdictCard; logo?: string | null; when: string; block?: number | null }) {
  const ink = INK[c.tone];
  const red = c.tone === "bad";
  const qr = qrCells(verdictLink(c.token));
  const lead = c.reason ? `✕ ${c.reason}` : c.score ? `${c.headline.toLowerCase()} — ${c.score}` : c.headline.toLowerCase();
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${CARD_W} ${CARD_H}`} width={CARD_W} height={CARD_H} role="img" aria-label={`Token Verdict card for ${c.symbol}`}>
      <defs>
        <DotsPattern />
        <clipPath id="vc-logo">
          <circle cx="190" cy="196" r="44" />
        </clipPath>
      </defs>
      <HalftoneSky w={CARD_W} h={CARD_H} alarm={red} />

      <Win x={90} y={70} w={1060} h={720} title={`Token Verdict — $${cut(c.symbol, 12)}`} dotted>
        <circle cx="190" cy="196" r="46" fill="#eee" stroke="#000" strokeWidth="3" />
        {logo ? (
          <image href={logo} x="146" y="152" width="88" height="88" clipPath="url(#vc-logo)" />
        ) : (
          <text x="190" y="214" textAnchor="middle" fontFamily={SANS} fontWeight="800" fontSize="48">
            {c.symbol.slice(0, 1).toUpperCase()}
          </text>
        )}
        <text x="262" y="230" fontFamily={SANS} fontWeight="800" fontSize="104" fill={KIT.blue} letterSpacing="-3">
          ${cut(c.symbol, 10)}
        </text>
        <text x="266" y="270" fontFamily={MONO} fontSize="22" fill={KIT.dim}>
          {short(c.token)} · Base
        </text>
        <Selected x={150} y={346} text={lead} size={c.reason ? 30 : 40} color={red ? KIT.red : KIT.blue} />

        {c.figures.map((f, i) => (
          <g key={f.label}>
            <text x={150 + i * 300} y="420" fontFamily={SANS} fontSize="22" fill={KIT.dim}>
              {f.label}
            </text>
            <text x={150 + i * 300} y="458" fontFamily={SANS} fontWeight="800" fontSize="36" fill={KIT.ink}>
              {f.value}
            </text>
          </g>
        ))}

        {c.tiles.map((t, i) => {
          const x = 130 + i * 335;
          return (
            <g key={t.title}>
              <rect x={x} y={490} width="315" height="210" fill={FILL[t.tone]} stroke={INK[t.tone]} strokeWidth="4" />
              <circle cx={x + 46} cy={540} r="26" fill={INK[t.tone]} />
              <text x={x + 46} y={552} textAnchor="middle" fontFamily={SANS} fontWeight="800" fontSize="32" fill="#fff">
                {MARK[t.tone]}
              </text>
              <text x={x + 24} y={630} fontFamily={SANS} fontWeight="800" fontSize="34" fill={KIT.ink}>
                {t.title}
              </text>
              <text x={x + 24} y={670} fontFamily={SANS} fontSize="21" fill="#333">
                {t.sub}
              </text>
            </g>
          );
        })}

        <text x="150" y="760" fontFamily={SANS} fontSize="20" fill={KIT.dim}>
          Checked {when}
          {block !== null ? ` · block ${block.toLocaleString("en-US")}` : ""} · a buy and a sell simulated on Base · not advice
        </text>
      </Win>

      <Win x={1190} y={70} w={330} h={240} title="Verdict">
        <g transform="rotate(-5 1355 180)">
          <rect x="1214" y="128" width="282" height="96" fill="none" stroke={ink} strokeWidth="8" rx="10" />
          <text x="1355" y="194" textAnchor="middle" fontFamily={SANS} fontWeight="900" fontSize={c.headline.length > 10 ? 26 : 50} fill={ink}>
            {c.headline}
          </text>
        </g>
        <text x="1355" y="282" textAnchor="middle" fontFamily={SANS} fontWeight="800" fontSize="40" fill={ink}>
          {c.score}
        </text>
      </Win>
      {block !== null ? (
        <Win x={1190} y={340} w={330} h={150} title="Base">
          <Lcd x={1212} y={386} w={286} label="block" value={block.toLocaleString("en-US")} />
        </Win>
      ) : null}
      <Win x={1190} y={520} w={330} h={270} title="Scan to check">
        <Qr x={1275} y={566} size={160} qr={qr} />
        <text x="1355" y="766" textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="18" fill={KIT.dim}>
          runs this check for you
        </text>
      </Win>

      <Footer x={90} y={CARD_H - 34} text={`Check any token free → ${window.location.host}`} />
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
