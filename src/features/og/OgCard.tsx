import { BRAND } from "@/brand";
import type { OgPage } from "@/server/og";

export const OG_W = 1200;
export const OG_H = 630;
export const MACHINE = "/brand/banners/q001-dot-matrix.svg";

const PAPER = "#f4f0e6";
const BLUE = "#2422cf";
const INK = "#24221e";
const SERIF = "Georgia, 'Times New Roman', serif";
const MONO = "'JetBrains Mono', Menlo, monospace";

export function splitAt(text: string): [string, string] {
  const mid = text.length / 2;
  let at = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === " " && (at < 0 || Math.abs(i - mid) < Math.abs(at - mid))) at = i;
  return at < 0 ? [text, ""] : [text.slice(0, at), text.slice(at + 1)];
}

export function OgCard({ page, artwork = MACHINE }: { page: OgPage; artwork?: string }) {
  const home = page.id === "home";
  const about = page.id === "about";
  const headline = home ? "your own on-chain computer." : `${page.path.split(" / ").at(-1)!}.`;
  const heads = about ? ["an on-chain", "supercomputer", "for Base."] : headline.length > 18 ? splitAt(headline) : [headline];
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width={OG_W} height={OG_H} role="img" aria-label={`share card: ${page.path}`}>
      <rect width={OG_W} height={OG_H} fill={PAPER} />
      <text x="58" y="86" fontFamily={SERIF} fontSize="52" letterSpacing="-2" fill={BLUE}>quadra</text>
      <text x="1142" y="82" textAnchor="end" fontFamily={MONO} fontSize="15" fill={INK}>{page.path}</text>
      <image href={artwork} x="652" y="65" width="487" height="499" preserveAspectRatio="xMidYMid meet" />
      {heads.map((head, i) => {
        const accent = i === heads.length - 1;
        return <text key={head} x={about ? 56 : 58} y={about ? 243 + i * 81 : 201 + i * 71} fontFamily={SERIF} fontSize={about ? 81 : head.length > 17 ? 63 : 73} letterSpacing="-3" fill={accent ? BLUE : INK} fontStyle={accent ? "italic" : undefined}>{head}</text>;
      })}
      {about ? <text x="62" y="477" fontFamily="Arial, sans-serif" fontSize="22" fill={INK}>Research. Trade. Launch.</text> : page.lines.map((line, i) => (
        <text key={line} x="62" y={248 + heads.length * 65 + i * 34} fontFamily="Arial, sans-serif" fontSize="22" fill={INK}>- {line}</text>
      ))}
      <text x="58" y="594" fontFamily={MONO} fontSize="16" fill={BLUE}>{about ? "quadracomputer.xyz" : "look first. sign when ready."}</text>
      <text x="1142" y="594" textAnchor="end" fontFamily={MONO} fontSize="16" fill={INK}>{about ? "fig. 1 / q-001" : "base / 8453"}</text>
    </svg>
  );
}

export function XHeader({ artwork }: { artwork: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1500" height="500" viewBox="0 0 1500 500" role="img" aria-label={`${BRAND.name} profile banner`}>
      <rect width="1500" height="500" fill={PAPER} />
      <g fontFamily={SERIF} letterSpacing="-3">
        <text x="240" y="118" fontSize="52" fill={BLUE}>quadra</text>
        <text x="236" y="219" fontSize="76" fill={INK}>an on-chain</text>
        <text x="236" y="298" fontSize="76" fill={INK}>supercomputer</text>
        <text x="236" y="377" fontSize="76" fontStyle="italic" fill={BLUE}>for Base.</text>
      </g>
      <image href={artwork} x="855.84" y="14.8" width="448.04" height="459.08" />
      <text x="1291" y="470" textAnchor="end" fontFamily={MONO} fontSize="15" fill={INK}>quadracomputer.xyz</text>
    </svg>
  );
}

export const X_POSTS = [
  { id: "launch", label: "Launchpad", first: "Launch a coin.", second: "Collect creator fees.", note: "Pair with ETH, Base crypto or a supported tokenized stock." },
  { id: "stocks", label: "Tokenized stocks", first: "Stocks on Base.", second: "In your wallet.", note: `Explore tokenized stocks in ${BRAND.name} Markets.` },
  { id: "pairs", label: "Base pairs", first: "Pick a Base token.", second: "Give it a pair.", note: "Choose a supported quote asset when you launch." },
  { id: "trade", label: "Trade", first: "Find a market.", second: "Make your trade.", note: "Review the quote, then sign in your wallet." },
  { id: "basket", label: "Treasury Basket", first: "Build a basket.", second: "Hold the assets.", note: "Choose your mix of tokenized stocks and Base crypto." },
  { id: "quadra", label: BRAND.ticker, first: "Its own pool.", second: "Its own fee flow.", note: `Follow the on-chain fee flow on ${BRAND.name} About.` },
] as const;

export function XPost({ post }: { post: (typeof X_POSTS)[number] }) {
  const ticker = post.id === "stocks" ? ["AAPLc", "NVDAc"] : ["YOUR COIN", "BASE TOKEN"];
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080" role="img" aria-label={post.label}>
      <defs>
        <pattern id="post-dots" width="11" height="11" patternUnits="userSpaceOnUse">
          <circle cx="5.5" cy="5.5" r="2.4" fill={BLUE} />
        </pattern>
      </defs>
      <rect width="1080" height="1080" fill={PAPER} />
      <text x="64" y="105" fill={BLUE} fontFamily={SERIF} fontSize="59" letterSpacing="-3">quadra</text>
      <text x="1016" y="94" fill={INK} fontFamily={MONO} fontSize="21" textAnchor="end">{post.label}</text>
      <text x="64" y="237" fontFamily={SERIF} fontSize="85" letterSpacing="-4" fill={INK}>{post.first}</text>
      <text x="64" y="330" fontFamily={SERIF} fontSize="85" letterSpacing="-4" fontStyle="italic" fill={BLUE}>{post.second}</text>
      <g transform="translate(120 397)" stroke={BLUE} strokeWidth="6" fill="url(#post-dots)" strokeLinejoin="round">
        {post.id === "launch" && <path d="M217 404h406V241H512v-56h100L420 22 228 185h100v56H217z M420 92v222" />}
        {(post.id === "stocks" || post.id === "pairs") && ticker.map((label, i) => (
          <g key={label} transform={`translate(${i ? 535 : 300} ${i ? 260 : 145}) rotate(-12)`}>
            <ellipse cy="24" rx="178" ry="107" />
            <ellipse rx="178" ry="107" fill={PAPER} />
            <ellipse rx="157" ry="89" fill="none" />
            <text y="12" textAnchor="middle" fontFamily={MONO} fontSize={post.id === "stocks" ? 51 : 31} fill={BLUE} stroke="none">{label}</text>
          </g>
        ))}
        {post.id === "trade" && <>
          <path d="M102 60v335h635M132 334h112v-65h118v-61h118v-68h116V61h128" fill="none" strokeWidth="8" />
          <path d="M132 334h112v-65h118v-61h118v-68h116V61h128v334H132z" stroke="none" />
        </>}
        {post.id === "basket" && <>
          <path d="M108 134h237l48 44h338v218H108z" />
          <path d="M108 134h237l48 44h338v70H108z" fill={PAPER} />
          <path d="M173 310h105m56 0h105m56 0h105" fill="none" strokeWidth="9" />
        </>}
        {post.id === "quadra" && <>
          <path d="M420 90v95M220 300V185h400v115" fill="none" />
          <rect x="283" y="20" width="274" height="70" fill={PAPER} />
          <path d="M94 300h91l30 24h131v93H94zM494 300h91l30 24h131v93H494z" />
          <text x="420" y="66" textAnchor="middle" fill={BLUE} stroke="none" fontFamily={MONO} fontSize="40">{BRAND.ticker}</text>
        </>}
      </g>
      <text x="64" y="964" fill={INK} fontFamily="Arial, sans-serif" fontSize="28">{post.note}</text>
      <text x="64" y="1021" fill={BLUE} fontFamily={MONO} fontSize="20">quadracomputer.xyz</text>
    </svg>
  );
}
