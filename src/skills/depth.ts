import { askQuote } from "@/adapters/http/quotes";
import { baseStocks } from "@/adapters/http/markets";
import { assertChecksummedAddress, toChecksumAddress } from "@/lib/address";
import { BASE, USDC } from "@/config/chain";
import { RELAY } from "@/config/routes";
import { chainToken } from "@/skills/chaintoken";
import { deepest, parseMarkets, type Market } from "@/skills/dexscreener";
import { getJson } from "@/skills/http";
import { explorer, tokenAmount, usd } from "@/skills/format";
import { isObj, strOf } from "@/skills/json";
import { row, type Report, type Row, type Skill, type Tone } from "@/skills/types";

/**
 * Trade Depth — what a buy or a sell of a token (a Coinbase stock above all) costs at $1k, $10k and
 * $100k on Base, before anybody clicks Swap. base.org prints one size ($10k) and links out; this
 * prices three, both ways, from the route a swap here would actually take.
 *
 * The quotes are Relay's (the engine Swap and Trade already use), which routes across Base's DEXes
 * — the stocks' deep pools are Aerodrome's (Slipstream, MEASURED 2026-11-12: NVDAc/USDC and
 * GOOGLc/USDC at ~$1.8M each, from a CL factory `0x9CB2…7a76` that none of Aerodrome's published
 * quoters serves), the thinner ones Uniswap v4's. Each pool is listed beside the quotes with its
 * liquidity, so where the depth sits is visible even though one route is quoted.
 *
 * Impact is Relay's `swapImpact` — what the pools' prices move, fees apart — and `totalImpact` is
 * shown beside it. Above `LOUD` the row is red: past 2% a market order is paying the book, not the
 * price. A size Relay will not quote is a row that says so, never a blank.
 */

/** Order sizes, in USDC. */
export const SIZES: readonly number[] = [1_000, 10_000, 100_000];
/** Impact above this is red. */
export const LOUD = 2;
/** Impact above this is amber. */
export const QUIET = 0.5;
/** A keyless address to quote for — Relay prices a route, nothing is signed. */
export const QUOTE_ACCOUNT = "0x000000000000000000000000000000000000dEaD";
/**
 * Every pool of a token. 🔴 MEASURED 2026-11-12: DexScreener's `/tokens/v1` (what `markets` reads)
 * answers ONE pair per token — TSLAc's $34k Uniswap v4 pool — while `/token-pairs/v1` lists all 13,
 * the deepest an Aerodrome Slipstream pool at $476k.
 */
export const TOKEN_PAIRS = "https://api.dexscreener.com/token-pairs/v1/base";
/** Pools listed under the quotes. */
export const POOLS_SHOWN = 4;

export type Quote = { readonly out: bigint; readonly swapImpact: number | null; readonly totalImpact: number | null };

/** Relay's answer for one exact-input swap, read for its amount out and impacts. */
export function parseQuote(body: unknown): Quote {
  const details = isObj(body) && isObj(body.details) ? body.details : {};
  const out = isObj(details.currencyOut) ? strOf(details.currencyOut.amount) : null;
  if (out === null || !/^\d+$/.test(out)) throw new Error("Relay: its quote has no amount out.");
  const percent = (k: string) => {
    const v = isObj(details[k]) ? Number(strOf((details[k] as Record<string, unknown>).percent)) : NaN;
    return Number.isFinite(v) ? v : null;
  };
  return { out: BigInt(out), swapImpact: percent("swapImpact"), totalImpact: percent("totalImpact") };
}

async function quote(sell: string, buy: string, amount: bigint): Promise<Quote> {
  return parseQuote(
    await askQuote("Relay", `${RELAY.api}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        user: QUOTE_ACCOUNT,
        recipient: QUOTE_ACCOUNT,
        originChainId: BASE.id,
        destinationChainId: BASE.id,
        originCurrency: sell,
        destinationCurrency: buy,
        amount: amount.toString(),
        tradeType: "EXACT_INPUT",
      }),
    }),
  );
}

/**
 * 🔴 MEASURED 2026-11-12 on PDDc: for a size the pools cannot carry Relay REFUSES with
 * "Swap impact is too high: -74.28%." — that refusal IS the measurement, the worst one, and must be
 * red. Read as a plain "not quoted" it left the headline saying no size moved the price past 2%.
 */
export const TOO_HIGH = /impact is too high:\s*-?(\d+(?:\.\d+)?)%/i;

/** A size Relay would not quote: red with the impact it named, else amber "not quoted". */
function refusal(label: string, e: unknown): Row {
  const said = (e as Error).message;
  const high = TOO_HIGH.exec(said);
  if (high) return row(label, `${Number(high[1]).toFixed(2)}% impact — too much for the pools; Relay will not route it`, { tone: "bad" });
  return row(label, `not quoted — ${said}`, { tone: "warn" });
}

const loud = (impact: number | null): Tone => (impact === null ? "warn" : Math.abs(impact) > LOUD ? "bad" : Math.abs(impact) > QUIET ? "warn" : "ok");
const pct = (n: number | null) => (n === null ? "not given" : `${Math.abs(n).toFixed(2)}%`);
const DEX_NAMES: Readonly<Record<string, string>> = { aero: "Aerodrome Slipstream", aerodrome: "Aerodrome", uniswap: "Uniswap" };
const venue = (m: Market) => `${DEX_NAMES[m.dex] ?? m.dex} vs ${m.quote}`;

/**
 * A token from what was typed: an address, or a COINBASE STOCK's ticker ("NVDA" or "NVDAc").
 * Hard rule 2 still holds — a ticker never identifies a token by itself; here it is looked up in
 * Coinbase's own list of its tokenized stocks on Base (the issuer's registry, `baseStocks`), and the
 * address it names is shown in the report. Any other ticker is refused, by name.
 */
export async function tokenFrom(input: string): Promise<{ readonly token: string; readonly via: string | null }> {
  const text = input.trim();
  if (text.startsWith("0x") || text === "") return { token: toChecksumAddress(assertChecksummedAddress(text, "Token")), via: null };
  const word = text.toUpperCase();
  const stocks = await baseStocks().catch(() => {
    throw new Error(`Token: "${text}" is not an address, and Coinbase's list of stocks on Base could not be read to look it up.`);
  });
  const hit = stocks.get(word) ?? stocks.get(word.replace(/C$/, "")) ?? null;
  if (hit === null) throw new Error(`Token: "${text}" is not a Coinbase stock on Base. Paste the token's address instead — a ticker alone never identifies a token.`);
  return { token: toChecksumAddress(hit.address), via: hit.symbol };
}

export async function depthReport(input: string): Promise<Report> {
  const { token, via } = await tokenFrom(input);
  const [info, pairs] = await Promise.all([chainToken(token), getJson("DexScreener", `${TOKEN_PAIRS}/${token}`).then(
      // only pools that price THIS token (a pool pricing another coin in it is that coin's market)
      (body) => parseMarkets(body).filter((m) => m.base?.toLowerCase() === token.toLowerCase()),
      () => null,
    )]);
  const best = pairs === null ? null : deepest(pairs.filter((m) => m.priceUsd !== null));
  const rows: Row[] = [row("Token", `${info.name} (${info.symbol}) — ${via ? `from Coinbase's list: ` : ""}${token}`, { href: explorer.token(token) })];

  // one at a time: Relay rate-limits a burst (MEASURED while building this)
  for (const size of SIZES) {
    const label = `Buy ${usd(size).replace(".00", "")}`;
    try {
      const q = await quote(USDC.address, token, BigInt(size) * 10n ** 6n);
      rows.push(row(label, `${pct(q.swapImpact)} impact (${pct(q.totalImpact)} with fees) · ${tokenAmount(q.out, info.decimals, 4)} ${info.symbol}`, { tone: loud(q.swapImpact) }));
    } catch (e) {
      rows.push(refusal(label, e));
    }
  }
  for (const size of SIZES) {
    const label = `Sell ${usd(size).replace(".00", "")}`;
    if (best === null) {
      rows.push(row(label, "not quoted — no market price to size the sell from", { tone: "warn" }));
      continue;
    }
    const amount = BigInt(Math.floor((size / best.priceUsd!) * 10 ** info.decimals));
    try {
      const q = await quote(token, USDC.address, amount);
      rows.push(row(label, `${pct(q.swapImpact)} impact (${pct(q.totalImpact)} with fees) · ${usd(Number(q.out / 10_000n) / 100)} in USDC` /* whole cents, truncated — never rounded up */, { tone: loud(q.swapImpact) }));
    } catch (e) {
      rows.push(refusal(label, e));
    }
  }
  if (pairs === null) rows.push(row("Pools", "not checked — DexScreener could not be reached", { tone: "warn" }));
  else if (pairs.length === 0) rows.push(row("Pools", "none listed on Base", { tone: "warn" }));
  else {
    const top = [...pairs].sort((a, b) => (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1)).slice(0, POOLS_SHOWN);
    for (const m of top) rows.push(row(`Pool · ${venue(m)}`, m.liquidityUsd === null ? "liquidity not reported" : `${usd(m.liquidityUsd)} liquidity`, m.url ? { href: m.url } : {}));
  }
  const worst = rows.filter((r) => r.tone === "bad");
  const sizes = rows.filter((r) => /^(Buy|Sell) /.test(r.label));
  const unquoted = sizes.filter((r) => r.value.startsWith("not quoted"));
  const quoted = unquoted.length < sizes.length;
  return {
    title: `${info.symbol} — Trade Depth`,
    rows: [
      !quoted
        ? row("Depth", "not checked — no size could be quoted", { tone: "warn" })
        : worst.length > 0
        ? row("Depth", `Thin — ${worst.map((r) => r.label.toLowerCase()).join(", ")} ${worst.length === 1 ? "moves" : "move"} the price more than ${LOUD}%`, { tone: "bad" })
        : unquoted.length > 0
          ? row("Depth", `No quoted size moves the price more than ${LOUD}% — ${unquoted.map((r) => r.label.toLowerCase()).join(", ")} not quoted`, { tone: "warn" })
          : row("Depth", `No size here moves the price more than ${LOUD}%`, { tone: rows.some((r) => r.tone === "warn") ? "warn" : "ok" }),
      ...rows,
    ],
    notes: [
      "Quoted by Relay for an address nobody holds — the route a swap in this app would take at this moment, across Base's DEXes. Nothing was signed. A quote moves with every trade.",
      "Relay may fill a size from a market maker rather than a pool (MEASURED: PDDc's $10k buy came from one, not from its $50k pool), so a size can be cheaper than the pools listed suggest — the quote is what the route pays now.",
      "Impact is how far the pools' prices move for that size; 'with fees' adds the pools' and the route's fees. Past 2% a market order is paying through the book — split it or use a limit.",
    ],
    sources: ["Relay (quotes)", "DexScreener (pools and the price a sell is sized from)", "Base (the token's name and decimals)"],
  };
}

export const depthSkill: Skill = {
  id: "depth",
  title: "Trade Depth",
  summary: "What a $1k / $10k / $100k buy or sell of a token costs on Base — price impact per size, red past 2%, and the pools behind it.",
  args: [{ name: "token", hint: "0x… or a Coinbase stock: NVDA, TSLAc" }],
  run: ([input = ""]) => depthReport(input),
};
