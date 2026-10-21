import { useRef, useState } from "react";
import { BRAND } from "@/brand";
import { short } from "@/skills/format";

/**
 * "Make my Base card": a wallet's facts on one picture, for sharing — drawn here as SVG from what the
 * Profile window already READ (nothing new is fetched, nothing is claimed that was not read). Saved
 * as a PNG in the browser; "Share on X" opens a post with the words, the picture is the user's to
 * attach. Nothing leaves the page unless the user sends it.
 */

export type CardFacts = {
  readonly address: string;
  readonly name: string | null;
  readonly launched: number | null;
  readonly feesWaiting: number | null;
  readonly holdings: string | null;
  readonly lures: number | null;
};

const line = (v: number | null, one: string, many: string) => (v === null ? "not read" : `${v} ${v === 1 ? one : many}`);

export function cardLines(f: CardFacts): string[] {
  return [
    `Coins launched here: ${line(f.launched, "coin", "coins")}`,
    `Coins with fees waiting: ${f.feesWaiting === null ? "not read" : f.feesWaiting}`,
    `Holdings: ${f.holdings ?? "not read"}`,
    `Fake look-alike tokens dodged: ${f.lures === null ? "not read" : f.lures}`,
  ];
}

export function shareUrl(f: CardFacts): string {
  const text = `My Base card from ${BRAND.name}, the on-chain supercomputer — ${f.name ?? short(f.address)}: ${line(f.launched, "coin", "coins")} launched. Every number read from Base.`;
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

export function CardSvg({ facts }: { facts: CardFacts }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 315" width="600" height="315" role="img" aria-label={`Base card for ${facts.name ?? facts.address}`}>
      <rect width="600" height="315" fill="#0a3c8c" />
      <rect x="12" y="12" width="576" height="291" fill="#ece9d8" stroke="#000" strokeWidth="2" />
      <rect x="12" y="12" width="576" height="30" fill="#0052ff" />
      <text x="24" y="33" fill="#fff" fontFamily="monospace" fontSize="16" fontWeight="bold">
        {BRAND.name} — Base card
      </text>
      <text x="24" y="80" fill="#000" fontFamily="sans-serif" fontSize="26" fontWeight="bold">
        {facts.name ?? short(facts.address)}
      </text>
      <text x="24" y="102" fill="#444" fontFamily="monospace" fontSize="12">
        {facts.address}
      </text>
      {cardLines(facts).map((l, i) => (
        <text key={l} x="24" y={140 + i * 30} fill="#000" fontFamily="monospace" fontSize="16">
          {l}
        </text>
      ))}
      <text x="24" y="290" fill="#444" fontFamily="sans-serif" fontSize="12">
        An on-chain supercomputer for Base · every number read from the chain
      </text>
    </svg>
  );
}

export function BaseCard({ facts }: { facts: CardFacts }) {
  const box = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const save = () => {
    const svg = box.current!.querySelector("svg")!;
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 630;
      const ctx = canvas.getContext("2d");
      if (!ctx) return setNote("This browser cannot draw the picture — take a screenshot instead.");
      ctx.drawImage(img, 0, 0, 1200, 630);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `base-card-${facts.address.slice(2, 8)}.png`;
      a.click();
      setNote("Saved.");
    };
    img.onerror = () => setNote("The picture could not be drawn — take a screenshot instead.");
    img.src = url;
  };
  return (
    <div className="stack">
      <div ref={box} className="card-box">
        <CardSvg facts={facts} />
      </div>
      <div className="row">
        <button type="button" className="chip" onClick={save}>
          Save as PNG
        </button>
        <a className="chip" href={shareUrl(facts)} target="_blank" rel="noreferrer">
          Share on X
        </a>
      </div>
      {note && <p role="status">{note}</p>}
    </div>
  );
}
