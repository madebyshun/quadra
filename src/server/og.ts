/**
 * Share cards per page (2026-11-18, the owner through the Blue Agent session: "add OG / share images
 * for the app's pages"). The app is one page, and the bots that draw link cards (X, Telegram, Discord,
 * iMessage) read the HTML only — they run no script — so every link used to show the same card.
 * `metaFor` names the card for a URL (a route, or a window by `?do=`), and `injectMeta` writes it
 * into index.html's tags; `middleware.ts` at the repo root does that at the edge on Vercel.
 *
 * The pictures are static files in public/og/, drawn by scripts/build-og.tsx from
 * features/og/OgCard.tsx. No live figure is ever baked into one: the platforms cache a card for days.
 * Copy is lowercase English with plain ASCII punctuation (the owner's brand voice, 2026-11-16).
 * Imports nothing from the app — the edge bundle stays small.
 */

export type OgPage = {
  readonly id: string;
  /** the folder-like path on the card and in the title, e.g. "check / token verdict" */
  readonly path: string;
  readonly title: string;
  readonly description: string;
  /** three short entries for the card */
  readonly lines: readonly [string, string, string];
};

export const OG_PAGES: readonly OgPage[] = [
  {
    id: "home",
    path: "quadra / desktop",
    title: "quadra",
    description: "an on-chain computer for base. check any token before you buy, then trade, swap or launch from your own wallet.",
    lines: ["check any token before you buy", "build a basket. launch a coin.", "review it. sign in your wallet."],
  },
  {
    id: "about",
    path: "quadra / about",
    title: "about quadra",
    description: "what quadra is, how its launchpad fees flow and where every number comes from.",
    lines: ["an on-chain computer for base", "every figure read from the chain", "launch fees and token burns, explained"],
  },
  {
    id: "safety",
    path: "check / token verdict",
    title: "token verdict - quadra",
    description: "a real buy and sell simulated on base, a code scan, holders and the launcher. high risk, caution or no red flags found.",
    lines: ["a buy and a sell, simulated on base", "code, holders and who launched it", "no red flags is never called safe"],
  },
  {
    id: "research",
    path: "research / radar",
    title: "research - quadra",
    description: "new launches on base, stock loans near liquidation and what an order really costs.",
    lines: ["every new uniswap v4 pool on base", "collateral watch for stock loans", "trade depth at 1k, 10k and 100k"],
  },
  {
    id: "coins",
    path: "launchpad / coins",
    title: "coins - quadra",
    description: "every coin launched on quadra's own base launchpad, paired with eth or a coinbase stock.",
    lines: ["coins paired with eth or a stock", "liquidity locked in the pool for good", "trade each coin in its own pool"],
  },
  {
    id: "launch",
    path: "launchpad / launch a coin",
    title: "launch a coin - quadra",
    description: "launch a coin on base in one transaction: fixed supply, no admin, liquidity locked, paired with eth or a coinbase stock.",
    lines: ["fixed supply, nobody can mint", "liquidity locked, no admin keys", "80% of trading fees to the creator"],
  },
  {
    id: "trade",
    path: "money / trade",
    title: "trade - quadra",
    description: "buy or sell tokens and coinbase stocks on base for usdc or eth, every transaction simulated before your wallet sees it.",
    lines: ["tokens and coinbase stocks on base", "exact approvals, never unlimited", "simulated before you sign"],
  },
  {
    id: "swap",
    path: "money / swap",
    title: "swap - quadra",
    description: "swap any token on base, the quote checked before your wallet sees it.",
    lines: ["any token on base", "the route checked before you sign", "exact approvals, never unlimited"],
  },
  {
    id: "send",
    path: "money / send",
    title: "send - quadra",
    description: "send eth, usdc or any token on base to an address or a basename, checked for look-alike addresses first.",
    lines: ["to an address or a basename", "look-alike addresses caught first", "one signature, in your wallet"],
  },
  {
    id: "basket",
    path: "money / treasury basket",
    title: "treasury basket - quadra",
    description: "buy a basket of tokenized stocks and crypto on base with usdc, every asset in your own wallet. no index token, no manager.",
    lines: ["stocks and crypto, your weights", "every asset in your own wallet", "each leg checked for depth"],
  },
  {
    id: "markets",
    path: "research / markets",
    title: "markets - quadra",
    description: "tokens and coinbase stocks on base: price, 24h change, chart and pool depth.",
    lines: ["tokens and coinbase stocks on base", "price, change and pool depth", "charts from on-chain trades"],
  },
  {
    id: "weekend",
    path: "research / weekend",
    title: "weekend - quadra",
    description: "does base's weekend price call monday's open? blue agent's graded record, shown in quadra.",
    lines: ["stocks trade on base all weekend", "every call graded at the open", "data by blue agent"],
  },
  {
    id: "wallet",
    path: "money / wallet",
    title: "wallet - quadra",
    description: "connect a wallet to base. quadra never creates or holds a key.",
    lines: ["any browser wallet or walletconnect", "your fees from coins you launched", "quadra never holds a key"],
  },
  {
    id: "profile",
    path: "research / profile",
    title: "profile - quadra",
    description: "any wallet on base as a person reads it: holdings, coins launched and activity, with fake transfers named.",
    lines: ["holdings and coins launched", "activity, with lures named", "basenames verified both ways"],
  },
  {
    id: "terminal",
    path: "quadra / terminal",
    title: "terminal - quadra",
    description: "every quadra skill as a line: verdict, radar, collateral, depth and more.",
    lines: ["every skill is a command", "verdict, radar, collateral, depth", "a window opens what it finds"],
  },
  {
    id: "agents",
    path: "agents / tools",
    title: "agent tools - quadra",
    description: "quadra's checks as mcp tools and a paid api over x402, read-only, no keys held.",
    lines: ["every check as an mcp tool", "pay per call over x402", "read-only, no keys held"],
  },
];

/** Which windows share a card: a `?do=` id and every page route, to an `OG_PAGES` id. */
const ALIAS: Readonly<Record<string, string>> = {
  safety: "safety",
  research: "research",
  "folder-research": "research",
  collateral: "research",
  coins: "coins",
  "folder-launchpad": "coins",
  leaderboard: "coins",
  launch: "launch",
  trade: "trade",
  swap: "swap",
  send: "send",
  basket: "basket",
  "folder-money": "basket",
  markets: "markets",
  weekend: "weekend",
  wallet: "wallet",
  profile: "profile",
  terminal: "terminal",
  x402: "agents",
  mcp: "agents",
  "folder-agents": "agents",
  api: "agents",
  docs: "agents",
  about: "about",
};

const BY_ID = new Map(OG_PAGES.map((p) => [p.id, p]));

/** The card for a URL: its `?do=` window, else its route, else the desktop's. */
export function metaFor(url: URL): OgPage {
  const win = url.searchParams.get("do");
  const route = url.pathname.replace(/^\/+|\/+$/g, "");
  const id = (win !== null && ALIAS[win]) || ALIAS[route] || "home";
  return BY_ID.get(id)!;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** index.html with its title and share tags set for `page`; image and URL absolute against `origin`. */
export function injectMeta(html: string, page: OgPage, url: URL): string {
  const image = `${url.origin}/og/${page.id}.png`;
  const set = (attr: "property" | "name", key: string, value: string) => {
    const tag = `<meta ${attr}="${key}" content="${esc(value)}" />`;
    const found = new RegExp(`<meta\\s+${attr}="${key.replace(/[:]/g, "\\:")}"[^>]*>`, "s");
    html = found.test(html) ? html.replace(found, tag) : html.replace("</head>", `    ${tag}\n  </head>`);
  };
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(page.title)}</title>`);
  set("name", "description", page.description);
  set("property", "og:title", page.title);
  set("property", "og:description", page.description);
  set("property", "og:url", url.href);
  set("property", "og:image", image);
  set("property", "og:image:width", "1200");
  set("property", "og:image:height", "630");
  set("property", "og:image:alt", `${page.path} - ${page.lines[0]}`);
  set("name", "twitter:card", "summary_large_image");
  set("name", "twitter:title", page.title);
  set("name", "twitter:description", page.description);
  set("name", "twitter:image", image);
  return html;
}
