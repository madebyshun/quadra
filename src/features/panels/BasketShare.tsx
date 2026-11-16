import { useRef, useState } from "react";
import { BRAND } from "@/brand";
import { messageOf } from "@/lib/errors";
import { CARD_H, CARD_W, drawCard } from "@/features/panels/BaseCard";
import { checkedAt, qrCells } from "@/features/panels/VerdictShare";
import { DotsPattern, Footer, HalftoneSky, KIT, Qr, SANS, Selected, Win } from "@/features/panels/cardKit";
import { Gel } from "@/ui/Gel";

/**
 * A quoted Treasury Basket as one picture (2026-11-13, Stocks Maxxing 3.1, for the demo): each asset
 * with its weight as a bar and the price impact its leg was quoted at, and the total — every figure
 * from the review the window just made, so the card cannot claim a cheaper basket than was quoted.
 */

export type BasketLine = { readonly symbol: string; readonly weight: number; readonly impact: number | null; readonly skipped?: boolean };
export type BasketCard = { readonly lines: readonly BasketLine[]; readonly total: string; readonly name?: string; readonly link?: string | undefined; readonly state?: "quoted" | "bought" | "partial"; readonly topUp?: boolean; readonly at?: number };

/** The cards' link back: the Basket window. */
export const basketLink = (): string => `${window.location.origin}/?do=basket`;

export function basketPost(c: BasketCard): string {
  const text = `${c.state === "bought" ? "Bought my basket on Base" : "My target basket on Base"}: ${c.lines.map((l) => `${l.symbol} ${l.weight}%`).join(", ")} — target weights, no index token, quoted by ${BRAND.name}'s Treasury Basket. Build yours: ${(c.link ?? basketLink())}`;
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

const SHOWN = 10;

export function BasketSvg({ c, when }: { c: BasketCard; when: string }) {
  const qr = qrCells(c.link ?? basketLink());
  const state = c.state ?? "quoted";
  const lines = c.lines.slice(0, SHOWN);
  const impacts = c.lines.flatMap((l) => l.impact === null ? [] : [l.impact]);
  const worst = impacts.length === 0 ? null : Math.max(...impacts);
  const missing = c.lines.some((l) => !l.skipped && l.impact === null);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${CARD_W} ${CARD_H}`} width={CARD_W} height={CARD_H} role="img" aria-label="Treasury Basket card">
      <defs>
        <DotsPattern />
      </defs>
      <HalftoneSky w={CARD_W} h={CARD_H} />
      <Win x={90} y={70} w={1060} h={720} title={c.name ?? "Treasury Basket"} dotted>
        <text x="150" y="220" fontFamily={SANS} fontWeight="800" fontSize="84" fill={KIT.blue} letterSpacing="-3">
          {c.lines.length} {c.lines.length === 1 ? "asset" : "assets"}, 1 {state === "bought" ? "wallet" : "basket"}
        </text>
        <Selected x={150} y={300} text="Target weights · no index token" size={38} />
        {lines.map((l, i) => {
          const y = 350 + i * 35;
          return (
            <g key={l.symbol}>
              <text x="150" y={y + 30} fontFamily={SANS} fontWeight="800" fontSize="24" fill={KIT.ink}>
                {l.symbol}
              </text>
              <rect x="410" y={y + 10} width={(l.weight / 100) * 300} height="22" fill={KIT.blue} />
              <text x={420 + (l.weight / 100) * 300} y={y + 31} fontFamily={SANS} fontWeight="700" fontSize="24" fill={KIT.ink}>
                {l.weight}%
              </text>
              <text x="1110" y={y + 31} textAnchor="end" fontFamily={SANS} fontSize="22" fill={l.impact !== null && l.impact > 2 ? KIT.red : KIT.dim}>
                {l.skipped ? "not bought this time" : l.impact === null ? "impact —" : `${l.impact.toFixed(2)}% impact`}
              </text>
            </g>
          );
        })}
        {c.lines.length > SHOWN ? (
          <text x="150" y="710" fontFamily={SANS} fontSize="22" fill={KIT.dim}>
            and {c.lines.length - SHOWN} more
          </text>
        ) : null}
        <text x="150" y="730" fontFamily={SANS} fontSize="21" fill={KIT.dim}>
          {state === "bought" ? "Purchase confirmed on Base" : state === "partial" ? "Some purchases confirmed · basket incomplete" : "Quote preview · not a purchase receipt"}
        </text>
        <text x="150" y="768" fontFamily={SANS} fontSize="19" fill={KIT.dim}>
          {when} · {c.total} USDC {c.topUp ? "top-up" : "buy"} · {worst === null ? "impact not reported" : `max reported impact ${worst.toFixed(2)}%`} · not advice
        </text>
      </Win>
      <Win x={1190} y={70} w={330} h={300} title="Purchase status">
        <text x="1355" y="200" textAnchor="middle" fontFamily={SANS} fontWeight="900" fontSize="42" fill={state === "bought" ? KIT.green : state === "partial" ? KIT.amber : KIT.blue}>
          {state === "bought" ? "BOUGHT" : state === "partial" ? "PARTIAL" : "QUOTED"}
        </text>
        <text x="1355" y="250" textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="20" fill={KIT.dim}>
          no manager · no basket fee
        </text>
        {missing ? <text x="1355" y="300" textAnchor="middle" fontFamily={SANS} fontSize="17" fill={KIT.dim}>Some quote impacts unknown</text> : null}
      </Win>
      <Win x={1190} y={400} w={330} h={390} title="Build yours">
        <Qr x={1265} y={470} size={180} qr={qr} />
        <text x="1355" y="700" textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="18" fill={KIT.dim}>
          stocks + crypto on Base
        </text>
      </Win>
      <Footer x={90} y={CARD_H - 34} text={`Build your basket → ${window.location.host}`} />
    </svg>
  );
}

export function BasketShare({ c }: { c: BasketCard }) {
  const box = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const [made] = useState(() => Date.now());
  const download = () =>
    drawCard(box.current!.querySelector("svg")!).then(
      (canvas) => {
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = `basket_${BRAND.name}.png`;
        a.click();
        setNote("Saved to your computer — attach it to your post.");
      },
      (e: unknown) => setNote(messageOf(e)),
    );
  return (
    <details className="report__share">
      <summary>Share this basket as a picture</summary>
      <fieldset className="group">
        <legend>Share this basket</legend>
        <div ref={box} className="coin__card">
          <BasketSvg c={c} when={checkedAt(c.at ?? made)} />
        </div>
        <div className="row">
          <a className="gel gel--quiet" href={basketPost(c)} target="_blank" rel="noopener noreferrer">
            Post on X
          </a>
          <Gel quiet onClick={() => void download()}>
            Download picture
          </Gel>
        </div>
        {note ? <p role="status">{note}</p> : null}
      </fieldset>
    </details>
  );
}
