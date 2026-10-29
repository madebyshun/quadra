import { useRef, useState } from "react";
import { BRAND } from "@/brand";
import { messageOf } from "@/lib/errors";
import { short } from "@/skills/format";
import { CARD_H, CARD_W, drawCard } from "@/features/panels/BaseCard";
import { Gel } from "@/ui/Gel";

/**
 * A coin's share card (2026-10-29): one picture to post, drawn here from what the page already read —
 * the coin, its pair, its market cap, its contract and what the launchpad guarantees — and a post for X
 * that links back to the coin's own page. Download saves exactly the picture shown (`drawCard`, the
 * Base card's own path). A link preview that shows it without the download needs a server (T3).
 */

export type CoinCard = { readonly token: string; readonly name: string; readonly symbol: string; readonly pair: string; readonly cap: string };

/** The coin page's address, from wherever the page is served. */
export const coinLink = (token: string): string => `${window.location.origin}/?do=coins&t=${token}`;

/** The post for X: the coin, its pair and its page — the picture is the poster's to attach. */
export function postUrl(c: CoinCard): string {
  const text = `${c.name} ($${c.symbol}) on Base, paired with ${c.pair} — launched on ${BRAND.name}: no admin, liquidity locked for good. ${coinLink(c.token)}`;
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

export function CardSvg({ c }: { c: CoinCard }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${CARD_W} ${CARD_H}`} width={CARD_W} height={CARD_H} role="img" aria-label={`Share card for ${c.symbol}`}>
      <rect width={CARD_W} height={CARD_H} fill="#4a6fa5" />
      <rect x="80" y="80" width={CARD_W - 160} height={CARD_H - 160} fill="#dddddd" stroke="#000" strokeWidth="4" />
      <rect x="80" y="80" width={CARD_W - 160} height="64" fill="#eeeeee" stroke="#000" strokeWidth="4" />
      <text x={CARD_W / 2} y="124" textAnchor="middle" fontFamily="Inter, Helvetica, Arial, sans-serif" fontWeight="700" fontSize="30">
        {BRAND.name} launchpad · Base
      </text>
      <text x="140" y="300" fontFamily="Inter, Helvetica, Arial, sans-serif" fontWeight="700" fontSize="104">
        ${c.symbol}
      </text>
      <text x="144" y="370" fontFamily="Inter, Helvetica, Arial, sans-serif" fontSize="44" fill="#333">
        {c.name} · paired with {c.pair}
      </text>
      <text x="144" y="500" fontFamily="Inter, Helvetica, Arial, sans-serif" fontSize="40" fill="#555">
        Market cap
      </text>
      <text x="144" y="580" fontFamily="Inter, Helvetica, Arial, sans-serif" fontWeight="700" fontSize="72">
        {c.cap}
      </text>
      <text x="144" y="690" fontFamily="JetBrains Mono, Menlo, monospace" fontSize="34" fill="#333">
        CA {short(c.token)}
      </text>
      <text x="144" y="760" fontFamily="Inter, Helvetica, Arial, sans-serif" fontSize="32" fill="#1d5e1a">
        No admin · fixed supply · liquidity locked for good
      </text>
    </svg>
  );
}

export function CoinShare({ c }: { c: CoinCard }) {
  const box = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const download = () =>
    drawCard(box.current!.querySelector("svg")!).then(
      (canvas) => {
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = `${c.symbol}_${BRAND.name}.png`;
        a.click();
        setNote("Saved to your computer — attach it to your post.");
      },
      (e: unknown) => setNote(messageOf(e)),
    );
  return (
    <fieldset className="group">
      <legend>Share {c.symbol}</legend>
      <div ref={box} className="coin__card">
        <CardSvg c={c} />
      </div>
      <div className="row">
        <a className="gel gel--quiet" href={postUrl(c)} target="_blank" rel="noopener noreferrer">
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
