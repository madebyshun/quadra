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

export type BasketLine = { readonly symbol: string; readonly weight: number; readonly impact: number | null };
export type BasketCard = { readonly lines: readonly BasketLine[]; readonly total: string };

/** The cards' link back: the Basket window. */
export const basketLink = (): string => `${window.location.origin}/?do=basket`;

export function basketPost(c: BasketCard): string {
  const text = `My basket on Base: ${c.lines.map((l) => `${l.symbol} ${l.weight}%`).join(", ")} — every asset in my own wallet, no index token, each leg checked for depth by ${BRAND.name}'s Treasury Basket. Build yours: ${basketLink()}`;
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

const SHOWN = 8;

export function BasketSvg({ c, when }: { c: BasketCard; when: string }) {
  const qr = qrCells(basketLink());
  const lines = c.lines.slice(0, SHOWN);
  const worst = Math.max(...c.lines.map((l) => l.impact ?? 0));
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${CARD_W} ${CARD_H}`} width={CARD_W} height={CARD_H} role="img" aria-label="Treasury Basket card">
      <defs>
        <DotsPattern />
      </defs>
      <HalftoneSky w={CARD_W} h={CARD_H} />
      <Win x={90} y={70} w={1060} h={720} title="Treasury Basket" dotted>
        <text x="150" y="220" fontFamily={SANS} fontWeight="800" fontSize="96" fill={KIT.blue} letterSpacing="-3">
          {c.lines.length} assets, 1 wallet
        </text>
        <Selected x={150} y={300} text="no index token — I hold every one" size={38} />
        {lines.map((l, i) => {
          const y = 350 + i * 46;
          return (
            <g key={l.symbol}>
              <text x="150" y={y + 30} fontFamily={SANS} fontWeight="800" fontSize="28" fill={KIT.ink}>
                {l.symbol}
              </text>
              <rect x="330" y={y + 8} width={(l.weight / 100) * 560} height="28" fill={KIT.blue} />
              <text x={340 + (l.weight / 100) * 560} y={y + 31} fontFamily={SANS} fontWeight="700" fontSize="24" fill={KIT.ink}>
                {l.weight}%
              </text>
              <text x="1110" y={y + 31} textAnchor="end" fontFamily={SANS} fontSize="22" fill={l.impact !== null && l.impact > 2 ? KIT.red : KIT.dim}>
                {l.impact === null ? "impact —" : `${l.impact.toFixed(2)}% impact`}
              </text>
            </g>
          );
        })}
        {c.lines.length > SHOWN ? (
          <text x="150" y={350 + SHOWN * 46 + 30} fontFamily={SANS} fontSize="22" fill={KIT.dim}>
            and {c.lines.length - SHOWN} more
          </text>
        ) : null}
        <text x="150" y="768" fontFamily={SANS} fontSize="19" fill={KIT.dim}>
          Quoted {when} · {c.total} USDC · worst leg {worst.toFixed(2)}% · each leg signed in my own wallet · not advice
        </text>
      </Win>
      <Win x={1190} y={70} w={330} h={300} title="Held by">
        <text x="1355" y="200" textAnchor="middle" fontFamily={SANS} fontWeight="900" fontSize="58" fill={KIT.green}>
          ME
        </text>
        <text x="1355" y="250" textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="20" fill={KIT.dim}>
          no manager · no basket fee
        </text>
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
          <BasketSvg c={c} when={checkedAt(made)} />
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
