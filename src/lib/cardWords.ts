/**
 * The Base card's words: a WordArt title and a quote, picked at random FROM AN X PROFILE (owner,
 * 2026-10-21: "the Base card is made from an X handle", after Solana 95's card). The title comes
 * from keyword FAMILIES found in the bio (builder, AI, art, music, trader…), else from the follower
 * count or the account's age, else from a plain list true of anybody. The quote riffs on a QUOTED
 * fragment of the bio itself — so it can only repeat what the person wrote, never invent a fact.
 *
 * Every pick has a `when`; a fact that could not be read is `null` and satisfies none. Playful,
 * never insulting, never about what to buy: nothing here is financial advice. A bio fragment with a
 * swear word, or that is only links, is not quoted (the title still reads the bio).
 *
 * Seeded by (handle, roll), so a card is the same every time and Reroll is the next roll —
 * deterministic, and testable without mocking `Math.random`.
 */

export type WordFacts = {
  readonly handle: string;
  readonly bio: string | null;
  readonly followers: number | null;
  readonly joined: Date | null;
};

type Pick<T> = { readonly when: (f: WordFacts, now: Date) => boolean; readonly say: T };
type Riff = (fragment: string) => string;

/** A keyword family: what in a bio names it, the titles it earns, and riffs on the fragment that matched. */
export type Family = { readonly id: string; readonly re: RegExp; readonly titles: readonly string[]; readonly riffs: readonly Riff[] };

export const FAMILIES: readonly Family[] = [
  {
    id: "builder",
    re: /\b(build(ing|er|s)?|ship(ping|ped|s)?|dev|developer|engineer(ing)?|coder|coding|hacker|solidity|rust|typescript)\b/i,
    titles: ["CHIEF SHIP OFFICER", "COMMIT MACHINE", "BUG WHISPERER", "PRODUCTION PUSHER"],
    riffs: [(q) => `“${q}” — and the commit history backs it up, presumably at 3 a.m.`, (q) => `“${q}.” Ships first, writes the docs eventually.`],
  },
  {
    id: "ai",
    re: /\b(ai|a\.i\.|agents?|agentic|llms?|gpt|machine learning|ml|neural|prompts?)\b/i,
    titles: ["AI ECOSYSTEM FARMER", "AGENT WRANGLER", "PROMPT WHISPERER", "ROBOT BABYSITTER"],
    riffs: [
      (q) => `“${q}” — which sounds like a cottage industry run entirely out of one very busy GPU.`,
      (q) => `“${q}.” The agents have a manager now, and it is this person.`,
    ],
  },
  {
    id: "art",
    re: /\b(art|artist|design(er|ing)?|illustrat(or|ion)|creative|pixels?|painter|3d|animation)\b/i,
    titles: ["PIXEL PICASSO", "VIBE DESIGNER", "MS PAINT MAESTRO"],
    riffs: [(q) => `“${q}” — finally, somebody who would appreciate this card's brushwork.`, (q) => `“${q}.” Kerning opinions: strong.`],
  },
  {
    id: "music",
    re: /\b(music|musician|producer|dj|beats?|songs?|singer|rapper|band)\b/i,
    titles: ["BEAT MERCHANT", "CERTIFIED BANGER MAKER"],
    riffs: [(q) => `“${q}” — this card comes with a soundtrack you can't hear.`],
  },
  {
    id: "trader",
    re: /\b(trad(er|ing)|degen|charts?|perps|scalp(er|ing)?)\b/i,
    titles: ["CANDLE READER", "CHART ASTROLOGER", "PROFESSIONAL DEGEN"],
    riffs: [(q) => `“${q}” — reads candles the way other people read horoscopes.`],
  },
  {
    id: "founder",
    re: /\b(founder|co-?founder|ceo|cto|building a company|startup)\b/i,
    titles: ["FOUNDER MODE", "CHIEF EVERYTHING OFFICER"],
    riffs: [(q) => `“${q}” — also head of sales, support and making the coffee.`],
  },
  {
    id: "investor",
    re: /\b(investor|vc|venture|angel|fund|partner at)\b/i,
    titles: ["THESIS WRITER", "DECK READER"],
    riffs: [(q) => `“${q}” — has seen ten thousand pitch decks and remembers the fonts.`],
  },
  {
    id: "memes",
    re: /\b(memes?|shitpost(er|ing)?|poster|posting|lol|lmao|gm)\b/i,
    titles: ["MEME LORD", "TIMELINE COMEDIAN"],
    riffs: [(q) => `“${q}” — the timeline is a stage and this is the headliner.`],
  },
  {
    id: "nft",
    re: /\b(nfts?|jpegs?|pfp|collector|mint(ing)?)\b/i,
    titles: ["JPEG CURATOR", "PFP CONNOISSEUR"],
    riffs: [(q) => `“${q}” — owns more pictures than most museums, on a smaller wall.`],
  },
  {
    id: "base",
    re: /(\bbase\b|\bonchain\b|on-chain|\bweb3\b|\bcrypto\b|\bethereum\b|\beth\b|\.base\.eth|\bl2\b)/i,
    titles: ["BASED CITIZEN", "ONCHAIN RESIDENT", "BLOCK ENJOYER"],
    riffs: [(q) => `“${q}” — five blocks a second, zero regrets.`, (q) => `“${q}.” Lives on Base, one block at a time.`],
  },
  {
    id: "gaming",
    re: /\b(gam(er|ing|es?)|esports|speedrun(ner)?|twitch|streamer)\b/i,
    titles: ["HIGH SCORE HOLDER", "PLAYER ONE"],
    riffs: [(q) => `“${q}” — would beat you at Rugsweeper, and be nice about it.`],
  },
  {
    id: "writer",
    re: /\b(writ(er|ing|es)|author|newsletter|blog(ger)?|content|creator|podcast(er)?|journalist)\b/i,
    titles: ["THREAD ARCHITECT", "WORD SMITH"],
    riffs: [(q) => `“${q}” — a 🧵 is coming, and it will be long.`],
  },
  {
    id: "community",
    re: /\b(community|communities|dao|mod(erator)?|ambassador|host|events?|spaces)\b/i,
    titles: ["COMMUNITY GLUE", "GROUP CHAT MAYOR"],
    riffs: [(q) => `“${q}” — knows everybody, and everybody's Basename.`],
  },
  {
    id: "security",
    re: /\b(security|audit(or|s|ing)?|whitehat|white hat|bug bount(y|ies)|pentest(er|ing)?|infosec)\b/i,
    titles: ["BUG BOUNTY HUNTER", "AUDIT GOBLIN"],
    riffs: [(q) => `“${q}” — reads the contract before the tweet.`],
  },
  {
    id: "research",
    re: /\b(research(er)?|analyst|data|phd|scien(ce|tist)|academic)\b/i,
    titles: ["DATA DETECTIVE", "FOOTNOTE ENJOYER"],
    riffs: [(q) => `“${q}” — has a spreadsheet about this card already.`],
  },
];

const DAY = 86_400_000;
const years = (f: WordFacts, now: Date) => (f.joined === null ? null : (now.getTime() - f.joined.getTime()) / (365.25 * DAY));
const at = (v: number | null, min: number, max = Infinity) => v !== null && v >= min && v < max;

/** "2.2K", "357K", "1.7M" — one decimal below ten, none above. */
export function compact(n: number): string {
  const unit = (v: number, s: string) => `${v < 10 ? Math.floor(v * 10) / 10 : Math.floor(v)}${s}`;
  if (n >= 1_000_000) return unit(n / 1_000_000, "M");
  if (n >= 1_000) return unit(n / 1_000, "K");
  return String(n);
}

/** Titles from the follower count and the account's age — used when the bio names no family. */
export const TIER_TITLES: readonly Pick<string>[] = [
  { when: (f) => at(f.followers, 100_000), say: "MAIN CHARACTER" },
  { when: (f) => at(f.followers, 10_000, 100_000), say: "TIMELINE LANDLORD" },
  { when: (f) => at(f.followers, 1_000, 10_000), say: "RISING POSTER" },
  { when: (f) => at(f.followers, 0, 1_000), say: "HIDDEN GEM" },
  { when: (f, now) => at(years(f, now), 10), say: "X VETERAN" },
  { when: (f, now) => at(years(f, now), 0, 1), say: "FRESH ACCOUNT ENERGY" },
];

export const PLAIN_TITLES: readonly string[] = ["BASED CITIZEN", "BLOCK ENJOYER", "CARD CARRYING POSTER", "PROFESSIONAL VIBER"];

/** Quotes from the profile's numbers — true of the facts they are picked for. */
export const TIER_QUOTES: readonly Pick<(f: WordFacts, now: Date) => string>[] = [
  { when: (f) => at(f.followers, 100_000), say: (f) => `${compact(f.followers!)} followers, and somehow still answers the replies.` },
  { when: (f) => at(f.followers, 1_000, 100_000), say: (f) => `${compact(f.followers!)} followers, every one of them owed a gm.` },
  { when: (f) => at(f.followers, 0, 1_000), say: (f) => `${compact(f.followers!)} followers — a small, hand-picked fan club.` },
  { when: (f, now) => at(years(f, now), 10), say: (f) => `On X since ${f.joined!.getUTCFullYear()}. Remembers when it was a bird.` },
  { when: (f, now) => at(years(f, now), 0, 1), say: () => "New on X and already has a card. Fast learner." },
];

export const PLAIN_QUOTES: readonly ((f: WordFacts) => string)[] = [
  (f) => `@${f.handle} lets the work do the talking. The bio is on a coffee break.`,
  () => "Reads the chain before signing. Five blocks a second, zero regrets.",
  () => "Lives on Base, one block at a time.",
  () => "Mysterious bio, excellent card.",
];

/** Words a quoted fragment may not carry — the card is shared, so it is not quoted at all then. */
const SALTY = /\b(shit\w*|fuck\w*|bitch\w*|cunt\w*|dick\w*|ass|asshole\w*|bastard\w*|porn\w*|nsfw|cock\w*|piss\w*)\b/i;

/** The bio in pieces: lines and sentences, links dropped, whitespace tidied; empty and salty pieces gone. */
export function fragments(bio: string | null): string[] {
  if (bio === null) return [];
  return bio
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b[\w-]+(\.[\w-]+)*\.(com|xyz|io|space|org|app|eth|me|co|net)\b(\/\S*)?/gi, (m) => (/\.base\.eth$/i.test(m) ? m : " "))
    .replace(/\(\s*(@\w+[\s,]*)*\)/g, " ")
    .split(/[\n|•·;]+|(?<=[.!?])\s+/)
    .map((p) => p.replace(/[\u0000-\u001f​-‏⁠]/g, "").replace(/\s+/g, " ").replace(/ ,/g, ",").replace(/^[\s,.:\-–—]+|[\s,:\-–—]+$/g, ""))
    .filter((p) => /[a-z]/i.test(p) && !SALTY.test(p));
}

/** A fragment cut to at most `max` characters at a word, with "…" when it was cut. */
export function clip(text: string, max = 60): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : max).replace(/[\s,.:;\-–—]+$/, "")}…`;
}

/** The families a bio names. */
export const familiesOf = (bio: string | null): Family[] => (bio === null ? [] : FAMILIES.filter((f) => f.re.test(bio)));

/** Whether the bio says this person builds or ships — the "shipped!" sticker is only for them. */
export const ships = (bio: string | null) => bio !== null && /\b(build(ing|er|s)?|ship(ping|ped|s)?)\b/i.test(bio);

/** FNV-1a over the text, then mulberry32: a small, well-mixed, seeded generator. */
export function seeded(text: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const one = <T>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;

/** WordArt colours, from the era's sixteen-colour palette. */
export const WORDART_COLOURS = ["#ff2a2a", "#ffd400", "#22c33a", "#1f6bff", "#c03cff", "#ff8a00", "#00c2d1"] as const;

export type CardWords = {
  readonly title: string;
  readonly quote: string;
  /** one colour per letter of the title */
  readonly colours: readonly string[];
  /** the title's tilt, in degrees */
  readonly tilt: number;
};

export function cardWords(f: WordFacts, roll: number, now: Date = new Date()): CardWords {
  const rand = seeded(`${f.handle.toLowerCase()}:${roll}`);
  const families = familiesOf(f.bio);
  const tiers = TIER_TITLES.filter((t) => t.when(f, now)).map((t) => t.say);
  const title = one(rand, families.length > 0 ? families.flatMap((x) => x.titles) : tiers.length > 0 ? tiers : PLAIN_TITLES);

  // a riff on a fragment of the bio that names one of its families, else a plain riff on any fragment
  const pieces = fragments(f.bio);
  const riffs = families.flatMap((x) => {
    const piece = pieces.find((p) => x.re.test(p));
    return piece === undefined ? [] : x.riffs.map((r) => () => r(clip(piece)));
  });
  const loose = pieces.length > 0 ? [() => `“${clip(pieces[0]!)}” — said with the confidence of a fresh block.`] : [];
  const numbers = TIER_QUOTES.filter((q) => q.when(f, now)).map((q) => () => q.say(f, now));
  const pool = riffs.length > 0 ? riffs : loose.length > 0 ? [...loose, ...numbers] : numbers.length > 0 ? numbers : PLAIN_QUOTES.map((q) => () => q(f));
  const quote = one(rand, pool)();

  const start = Math.floor(rand() * WORDART_COLOURS.length);
  const colours = [...title].map((_, i) => WORDART_COLOURS[(start + i) % WORDART_COLOURS.length]!);
  const tilt = -2 - Math.round(rand() * 5);
  return { title, quote, colours, tilt };
}
