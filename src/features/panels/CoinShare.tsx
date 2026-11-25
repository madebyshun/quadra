import { useRef, useState } from "react";
import { BRAND } from "@/brand";
import { messageOf } from "@/lib/errors";
import { short } from "@/skills/format";
import { CARD_H, CARD_W, drawCard } from "@/features/panels/BaseCard";
import { HalftoneSky, KIT, MONO, SANS, SERIF, Win } from "@/features/panels/cardKit";
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
      <HalftoneSky w={CARD_W} h={CARD_H} />
      <Win x={80} y={80} w={CARD_W - 160} h={CARD_H - 160} title={`${BRAND.name} launchpad / base`}>
        <text x="140" y="300" fontFamily={SERIF} fontSize="104" fill={KIT.blue}>
          ${c.symbol}
        </text>
        <text x="144" y="370" fontFamily={SANS} fontSize="44" fill={KIT.ink}>
          {c.name} · paired with {c.pair}
        </text>
        <text x="144" y="500" fontFamily={SANS} fontSize="40" fill={KIT.dim}>
          Market cap
        </text>
        <text x="144" y="580" fontFamily={SANS} fontWeight="700" fontSize="72">
          {c.cap}
        </text>
        <text x="144" y="690" fontFamily={MONO} fontSize="34" fill={KIT.ink}>
          CA {short(c.token)}
        </text>
        <text x="144" y="760" fontFamily={SANS} fontSize="32" fill={KIT.dim}>
          No admin · fixed supply · liquidity locked for good
        </text>
      </Win>
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
