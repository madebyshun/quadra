import { BRAND } from "@/brand";

/**
 * Where every fee goes, as a Platinum window that moves (2026-11-04, the owner: redraw the flywheel
 * in this app's own style and animate it so it reads at a glance). It replaces the dark poster
 * (public/brand/flywheel.svg, kept for links already shared). Fees travel as dots along the arrows,
 * one stage after another, so the order is the explanation: a trade pays 1% → it splits → the token's
 * own share reaches the furnace → half is burnt. Stage C is dashed and carries nothing: it is planned.
 * Under reduced motion the dots are hidden and the picture still says everything.
 */

type Flow = { readonly id: string; readonly d: string; readonly begin: number; readonly tone?: "burn" | "token" };

/** Every arrow that carries money, with when (seconds into the 4 s cycle) its dot sets off. */
export const FLOWS: readonly Flow[] = [
  { id: "trade", d: "M162 245 L236 245", begin: 0 },
  { id: "creator", d: "M342 245 H356 Q368 245 368 233 V112 Q368 100 380 100 H396", begin: 0.6 },
  { id: "treasury", d: "M342 245 L396 245", begin: 0.6 },
  { id: "referrer", d: "M342 245 H356 Q368 245 368 257 V378 Q368 390 380 390 H396", begin: 0.6 },
  { id: "pool-furnace", d: "M720 132 L720 206", begin: 1.4, tone: "token" },
  { id: "pool-treasury", d: "M640 102 H620 Q608 102 608 114 V218 Q608 230 596 230 H578", begin: 1.4, tone: "token" },
  { id: "furnace-treasury", d: "M640 254 H578", begin: 2.2, tone: "token" },
  { id: "burn", d: "M800 236 L886 236", begin: 2.2, tone: "burn" },
  { id: "buyback", d: "M800 280 L886 280", begin: 2.2, tone: "burn" },
];

/** the pairs a coin can launch against, shown as coins */
/**
 * Each stock's icon is Coinbase's own, read 2026-11-04 from its Tokenized Stocks API (`icon_url`,
 * metadata.coinbase.com) — the same source the app's stock list reads. ETH is drawn.
 */
const ICON = "https://metadata.coinbase.com/equity_icons/";
export const PAIRS: readonly { readonly symbol: string; readonly icon?: string }[] = [
  { symbol: "ETH" },
  { symbol: "AAPLc", icon: `${ICON}873819f4b14efe44b94abecbc8e8864d2998163abd0ca55b449ee6eb07d0d94c.png` },
  { symbol: "NVDAc", icon: `${ICON}1fee9b7a44e800d438dd9d96c3283e05784c925c2c871a48ff735950740b551a.png` },
  { symbol: "TSLAc", icon: `${ICON}a3b67028295d0e9fa3182c867b8a9afed5ebcbd8c012de3a46e160ae5e490980.png` },
  { symbol: "METAc", icon: `${ICON}1cedbfb3caee9498470945ff5041715b8c90921d904b3567a43bc4df82069e66.png` },
  { symbol: "+7" },
];
/** seconds a dot takes along its arrow */
const MOVE = 1.2;

function Box({ x, y, w, h, title, lines, tone }: { x: number; y: number; w: number; h: number; title: string; lines: readonly string[]; tone?: "accent" | "furnace" }) {
  return (
    <g className={`flow__box${tone ? ` flow__box--${tone}` : ""}`}>
      <rect x={x + 3} y={y + 3} width={w} height={h} className="flow__shadow" />
      <rect x={x} y={y} width={w} height={h} className="flow__face" />
      <text x={x + w / 2} y={y + 24} className="flow__title">
        {title}
      </text>
      {lines.map((l, i) => (
        <text key={l} x={x + w / 2} y={y + 44 + i * 16} className="flow__line">
          {l}
        </text>
      ))}
    </g>
  );
}

const label = (x: number, y: number, t: string, anchor: "start" | "middle" | "end" = "middle") => (
  <text x={x} y={y} className="flow__label" textAnchor={anchor}>
    {t}
  </text>
);

export function Flywheel() {
  const t = BRAND.ticker;
  return (
    <figure className="flow">
      <svg viewBox="0 0 1060 500" role="img" aria-labelledby="flow-title flow-desc" className="flow__svg">
        <title id="flow-title">Where every fee goes</title>
        <desc id="flow-desc">
          Every trade of a coin launched here pays 1% (or 3%): 80% to its creator, 5% to an approved referrer if any, the rest to the treasury. {t}'s own pool pays its 80% to the furnace and 20% to the
          treasury; the furnace burns half and sends half to the treasury.
        </desc>
        <defs>
          <pattern id="flow-stripes" width="4" height="2" patternUnits="userSpaceOnUse">
            <rect width="4" height="1" fill="#bbbbbb" />
          </pattern>
          <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="#000" />
          </marker>
        </defs>

        {/* the window */}
        <rect x="1" y="1" width="1058" height="498" className="flow__window" />
        <rect x="6" y="5" width="1048" height="16" fill="url(#flow-stripes)" />
        <rect x="480" y="3" width="100" height="20" fill="#dddddd" />
        <text x="530" y="18" className="flow__wintitle">
          Fee Flow
        </text>
        <rect x="12" y="7" width="12" height="12" className="flow__closebox" />
        <rect x="6" y="28" width="1048" height="466" className="flow__paper" />

        {label(40, 60, "① A TRADE", "start")}
        {label(400, 60, "② THE SPLIT", "start")}
        {label(640, 60, `③ ${t}'S OWN FEES`, "start")}
        {label(892, 200, "④ BURN", "start")}

        {/* the pairs, as plain ticker coins (no issuer's logo is drawn) */}
        {PAIRS.map((c, i) => {
          const x = 60 + (i % 2) * 70;
          const y = 190 + Math.floor(i / 2) * 56;
          return (
            <g key={c.symbol} className="flow__coin">
              <title>{c.symbol}</title>
              <circle cx={x} cy={y} r="24" />
              {c.icon ? (
                <>
                  <clipPath id={`flow-coin-${i}`}>
                    <circle cx={x} cy={y} r="23" />
                  </clipPath>
                  <image href={c.icon} x={x - 23} y={y - 23} width="46" height="46" clipPath={`url(#flow-coin-${i})`} />
                </>
              ) : c.symbol === "ETH" ? (
                <g className="flow__eth">
                  <path d={`M${x} ${y - 16} L${x + 10} ${y + 1} L${x} ${y + 6} L${x - 10} ${y + 1} Z`} />
                  <path d={`M${x} ${y + 9} L${x + 10} ${y + 3} L${x} ${y + 17} L${x - 10} ${y + 3} Z`} />
                </g>
              ) : (
                <text x={x} y={y + 4}>
                  {c.symbol}
                </text>
              )}
            </g>
          );
        })}
        {label(95, 352, "any coin, paired with")}
        {label(95, 366, "ETH or a stock")}

        <circle cx="290" cy="245" r="52" className="flow__fee" />
        <text x="290" y="252" className="flow__big">
          1%
        </text>
        <text x="290" y="272" className="flow__line flow__line--on-fee">
          every trade
        </text>
        {label(290, 332, "or 3%, the launcher's choice")}

        <Box x={400} y={72} w={176} h={64} title="80% creator" lines={["the coin's launcher"]} />
        <Box x={400} y={214} w={176} h={92} title="Treasury" lines={["15–20% of launch fees", "runs the product"]} tone="accent" />
        <Box x={400} y={360} w={176} h={64} title="5% referrer" lines={["approved ones only"]} />

        <Box x={640} y={72} w={160} h={60} title={`${t} pool`} lines={["1%, paired with AAPLc"]} />
        <Box x={640} y={208} w={160} h={96} title="Furnace" lines={["50% burnt", "50% to the treasury", "fixed at deploy"]} tone="furnace" />
        {label(726, 175, "80%", "start")}
        {label(602, 170, "20%", "end")}

        <text x="892" y="240" className="flow__out">
          {t} burnt now
        </text>
        <text x="892" y="256" className="flow__line flow__line--start">
          at once
        </text>
        <text x="892" y="284" className="flow__out">
          AAPLc
        </text>
        <text x="892" y="300" className="flow__line flow__line--start">
          buys {t} → burnt
        </text>

        {FLOWS.map((f) => (
          <path key={f.id} id={`flow-${f.id}`} d={f.d} className="flow__arrow" markerEnd="url(#flow-arrow)" />
        ))}

        {/* stage C: planned, so dashed, and nothing travels on it */}
        <path d="M576 290 L640 290" className="flow__arrow flow__arrow--planned" markerEnd="url(#flow-arrow)" />
        {label(608, 330, "stage C · planned")}
        {label(608, 345, "a share of launch fees")}

        {/* fees never stop: every arrow carries dots all the time, a few per arrow, each on its own phase */}
        {FLOWS.flatMap((f) =>
          [0, 1, 2].map((k) => (
            <circle key={`${f.id}-${k}`} r="5" className={`flow__dot${f.tone ? ` flow__dot--${f.tone}` : ""}`}>
              <animateMotion dur={`${MOVE}s`} repeatCount="indefinite" begin={`${-((k * MOVE) / 3 + f.begin)}s`}>
                <mpath href={`#flow-${f.id}`} />
              </animateMotion>
            </circle>
          )),
        )}

        <rect x="20" y="446" width="1020" height="36" className="flow__ledger" />
        <text x="36" y="469" className="flow__line flow__line--start">
          Read from Base, not promised: no admin · fixed supply · liquidity locked for good · not audited
        </text>
      </svg>
    </figure>
  );
}
