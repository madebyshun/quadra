import { useRef, useState } from "react";
import { BRAND } from "@/brand";
import { messageOf } from "@/lib/errors";
import { short } from "@/skills/format";
import type { Report, Tone } from "@/skills/types";
import { CARD_H, CARD_W, drawCard } from "@/features/panels/BaseCard";
import { checkedAt, qrCells } from "@/features/panels/VerdictShare";
import { DotsPattern, Footer, HalftoneSky, KIT, Lcd, MONO, Qr, SANS, Selected, Win } from "@/features/panels/cardKit";
import { usePulse } from "@/ui/usePulse";
import { Gel } from "@/ui/Gel";

/**
 * A Collateral Watch report as one picture (2026-11-12, the owner: "làm thêm card cho Collateral
 * Watch"), in the share cards' kit. The figure that matters is how far the nearest position is from
 * liquidation; each loan gets a row — where, which stock, its value, its health, its distance — and
 * every number is read off the report's own rows, so the card says nothing the report did not.
 * A wallet with nothing borrowed has no card: there is nothing to watch.
 */

export type Loan = { readonly venue: string; readonly symbol: string; readonly value: string; readonly health: string; readonly distance: number | null; readonly tone: Tone };
export type CollateralCard = { readonly wallet: string; readonly name: string; readonly tone: Tone; readonly headline: string; readonly loans: readonly Loan[] };

const HEADLINE: Record<Tone, string> = { bad: "AT RISK", warn: "WATCH", ok: "HEALTHY" };
const INK: Record<Tone, string> = { bad: KIT.red, warn: KIT.amber, ok: KIT.green };
const FILL: Record<Tone, string> = { bad: "#fdecec", warn: "#fdf3e6", ok: "#eef6ee" };
const RANK: Record<Tone, number> = { bad: 0, warn: 1, ok: 2 };
/** rows that fit the card */
export const LOANS_SHOWN = 4;

const distanceOf = (v: string): number | null => (/can be liquidated now|at or above/.test(v) ? 0 : Number(/(\d+(?:\.\d+)?)% below/.exec(v)?.[1] ?? NaN) || null);

/** The card for a Collateral Watch report with at least one loan, else `null`. */
export function collateralCard(report: Report): CollateralCard | null {
  if (!report.title.endsWith("— Collateral Watch")) return null;
  const wallet = report.rows.find((r) => r.label === "Wallet")?.href?.split("/").pop() ?? null;
  if (wallet === null) return null;
  const health = report.rows.find((r) => r.label === "Health factor");
  const aaveHealth = /^(\d+\.\d\d)/.exec(health?.value ?? "")?.[1] ?? null;
  const loans: Loan[] = [];
  for (const r of report.rows) {
    if (r.label.startsWith("Liquidation · ") && aaveHealth !== null) {
      const symbol = r.label.slice("Liquidation · ".length);
      const supplied = report.rows.find((x) => x.label === `Supplied · ${symbol}`);
      loans.push({ venue: "Aave V4", symbol, value: /(\$[\d,]+)\.\d\d at Aave/.exec(supplied?.value ?? "")?.[1] ?? "—", health: aaveHealth, distance: distanceOf(r.value), tone: r.tone ?? "warn" });
    }
    if (r.label.startsWith("Morpho · ") && /backing/.test(r.value)) {
      loans.push({
        venue: "Morpho",
        symbol: r.label.slice("Morpho · ".length),
        value: /\((\$[\d,]+)\.\d\d\)/.exec(r.value)?.[1] ?? "—",
        health: /health (\d+\.\d\d)/.exec(r.value)?.[1] ?? "—",
        distance: distanceOf(r.value),
        tone: r.tone ?? "warn",
      });
    }
  }
  if (loans.length === 0) return null;
  loans.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  const tone = [...loans].sort((a, b) => RANK[a.tone] - RANK[b.tone])[0]!.tone;
  return { wallet, name: report.title.replace(/ — Collateral Watch$/, ""), tone, headline: HEADLINE[tone], loans };
}

export const collateralLink = (wallet: string): string => `${window.location.origin}/?do=research&run-research=${encodeURIComponent(`collateral ${wallet}`)}`;

/** The selected lead line: the nearest loan's distance. */
export function leadOf(c: CollateralCard): string {
  const near = c.loans[0]!;
  if (near.distance === 0) return `${near.symbol} on ${near.venue} can be liquidated now`;
  return near.distance === null ? `${near.symbol} on ${near.venue}: distance not worked out` : `if ${near.symbol} falls ${near.distance}%, its ${near.venue} loan is liquidated`;
}

export function collateralPost(c: CollateralCard): string {
  const text = `${leadOf(c)} — a wallet's stock loans on Base, read live by ${BRAND.name}'s Collateral Watch (Aave V4 + Morpho, and the weekend gap). Check any wallet: ${collateralLink(c.wallet)}`;
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

export function CollateralSvg({ c, when, block = null }: { c: CollateralCard; when: string; block?: number | null }) {
  const ink = INK[c.tone];
  const near = c.loans[0]!;
  const qr = qrCells(collateralLink(c.wallet));
  const cols = [150, 330, 520, 720, 880] as const;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${CARD_W} ${CARD_H}`} width={CARD_W} height={CARD_H} role="img" aria-label={`Collateral Watch card for ${c.name}`}>
      <defs>
        <DotsPattern />
      </defs>
      <HalftoneSky w={CARD_W} h={CARD_H} alarm={c.tone === "bad"} />

      <Win x={90} y={70} w={1060} h={720} title={`Collateral Watch — ${c.name}`} dotted>
        <text x="150" y="232" fontFamily={SANS} fontWeight="800" fontSize="128" fill={near.distance === 0 ? KIT.red : KIT.blue} letterSpacing="-4">
          {near.distance === null ? "—" : `${near.distance}%`}
        </text>
        <text x="156" y="272" fontFamily={SANS} fontWeight="700" fontSize="26" fill={KIT.dim}>
          from liquidation — the nearest of {c.loans.length} {c.loans.length === 1 ? "loan" : "loans"} · {short(c.wallet)}
        </text>
        <Selected x={150} y={352} text={leadOf(c)} size={38} />

        {["Where", "Stock", "Collateral", "Health", "Liquidation"].map((h, i) => (
          <text key={h} x={cols[i]} y="430" fontFamily={SANS} fontWeight="700" fontSize="24" fill={KIT.dim}>
            {h}
          </text>
        ))}
        {c.loans.slice(0, LOANS_SHOWN).map((l, i) => {
          const y = 448 + i * 70;
          return (
            <g key={`${l.venue}-${l.symbol}`}>
              <rect x="130" y={y} width="900" height="60" fill={FILL[l.tone]} stroke={INK[l.tone]} strokeWidth="3" />
              <text x={cols[0]} y={y + 40} fontFamily={SANS} fontSize="24" fill={KIT.ink}>
                {l.venue}
              </text>
              <text x={cols[1]} y={y + 41} fontFamily={SANS} fontWeight="800" fontSize="30" fill={KIT.blue}>
                {l.symbol}
              </text>
              <text x={cols[2]} y={y + 40} fontFamily={MONO} fontSize="26" fill={KIT.ink}>
                {l.value}
              </text>
              <text x={cols[3]} y={y + 41} fontFamily={SANS} fontWeight="800" fontSize="30" fill={INK[l.tone]}>
                {l.health}
              </text>
              <text x={cols[4]} y={y + 41} fontFamily={SANS} fontWeight="800" fontSize="28" fill={INK[l.tone]}>
                {l.distance === null ? "—" : l.distance === 0 ? "now" : `−${l.distance}%`}
              </text>
            </g>
          );
        })}
        {c.loans.length > LOANS_SHOWN ? (
          <text x="150" y="740" fontFamily={SANS} fontSize="22" fill={KIT.dim}>
            and {c.loans.length - LOANS_SHOWN} more
          </text>
        ) : null}
        <text x="150" y="768" fontFamily={SANS} fontSize="19" fill={KIT.dim}>
          Read {when}
          {block !== null ? ` · block ${block.toLocaleString("en-US")}` : ""} · liquidation at the lender&apos;s oracle · not advice
        </text>
      </Win>

      <Win x={1190} y={70} w={330} h={210} title="Status">
        <g transform="rotate(-5 1355 190)">
          <rect x="1222" y="132" width="266" height="100" fill="none" stroke={ink} strokeWidth="8" rx="10" />
          <text x="1355" y="203" textAnchor="middle" fontFamily={SANS} fontWeight="900" fontSize="54" fill={ink}>
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
          watch this wallet yourself
        </text>
      </Win>

      <Footer x={90} y={CARD_H - 34} text={`Watch any wallet's stock loans → ${window.location.host}`} />
    </svg>
  );
}

export function CollateralShare({ c }: { c: CollateralCard }) {
  const box = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const [made] = useState(() => Date.now());
  const pulse = usePulse();
  const block = pulse.kind === "live" ? pulse.pulse.block : null;
  const download = () =>
    drawCard(box.current!.querySelector("svg")!).then(
      (canvas) => {
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = `collateral_${short(c.wallet)}_${BRAND.name}.png`;
        a.click();
        setNote("Saved to your computer — attach it to your post.");
      },
      (e: unknown) => setNote(messageOf(e)),
    );
  return (
    <fieldset className="group">
      <legend>Share this collateral check</legend>
      <div ref={box} className="coin__card">
        <CollateralSvg c={c} when={checkedAt(made)} block={block} />
      </div>
      <div className="row">
        <a className="gel gel--quiet" href={collateralPost(c)} target="_blank" rel="noopener noreferrer">
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
