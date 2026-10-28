import { UNISWAP_V4_POOL_MANAGER, USDC, WETH } from "@/config/chain";
import { readHookAddress } from "@/lib/hooks";
import { keccak256, toHex, utf8 } from "@/lib/keccak";
import { BLOCKSCOUT } from "@/skills/blockscout";
import { launchedBetween } from "@/skills/launchpad";
import { padsBetween } from "@/skills/launchpads";
import { BRAND } from "@/brand";
import { BATCH, marketsOf, type Market } from "@/skills/dexscreener";
import { short, usd } from "@/skills/format";
import { getJson, quantity, rpc } from "@/skills/http";
import { isObj, listOf, strOf } from "@/skills/json";
import { row, type Report, type Row, type Skill, type Tone } from "@/skills/types";

/**
 * Launch Radar: what launched on Base in the last hour, read from the chain itself, scored.
 *
 * MEASURED 2026-10-01: Uniswap v4's PoolManager logged 154 `Initialize` events in 1,800 blocks
 * (one hour), and both public RPCs answered that range in one `eth_getLogs`. Grouped by hook,
 * the hook NAMES the launchpad — Blockscout had a verified contract for each of the busiest:
 * DopplerHookInitializer (26), ZoraV4CoinHook (24), DecayMulticurveInitializerHook,
 * TaxLaunchHook, ClankerHookStaticFeeV2 — and 36 pools had no hook at all. GeckoTerminal's
 * `new_pools` feed answered 429 to this machine the same morning; the chain does not.
 *
 * A v4 hook's powers are written into its address (`lib/hooks.ts`). The two that matter to a
 * buyer are the swap "returns delta" bits: a hook holding one can take a cut of every swap,
 * which is how a v4 token charges a tax. From a verified hook that is a disclosed fee; from an
 * unverified one it is an unknown cut, and the radar says so in red.
 *
 * Then one DexScreener request prices up to 30 of the new tokens. A launch nobody has traded
 * yet is counted, not listed. The radar is a first look — `verdict <token>` is the full check.
 */

/** Base makes a block every 2 seconds, so 1,800 blocks is an hour. */
export const BLOCK_SECONDS = 2;
export const DEFAULT_MINUTES = 60;
export const MAX_MINUTES = 180;
/** How many launches the report lists. */
export const SHOWN = 15;
/** How many of the newest tokens are priced — four DexScreener requests. */
export const PRICED = 4 * BATCH;

/** v4-core's `Initialize` event, hashed here rather than copied (the same rule as every other topic). */
export const INITIALIZE_TOPIC = toHex(keccak256(utf8("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)")));
const NATIVE = "0x0000000000000000000000000000000000000000";
const KNOWN_QUOTES = new Set([NATIVE, WETH.address.toLowerCase(), USDC.address.toLowerCase()]);
const SWAP_CUT = new Set(["beforeSwapReturnsDelta", "afterSwapReturnsDelta"]);

export type Launch = {
  readonly pool: string;
  readonly token: string;
  readonly quote: string;
  readonly hook: string;
  readonly block: number;
};

const word = (data: string, i: number) => data.slice(2 + 64 * i, 2 + 64 * (i + 1));
const addressIn = (hex32: string) => `0x${hex32.slice(-40)}`.toLowerCase();

/**
 * Every pool opened, as (pool id, token, quote, hook). Which side is the new token: the one that is
 * not ETH, WETH or USDC; and when neither is — a Zora content coin paired with a creator coin, say —
 * the side that turns up in fewer of this window's pools, because a quote is what many launches share.
 */
export function parseLaunches(logs: unknown): Launch[] {
  const raw = listOf(logs).flatMap((l) => {
    if (!isObj(l)) return [];
    const topics = listOf(l.topics).filter((t): t is string => typeof t === "string");
    const data = strOf(l.data);
    const block = strOf(l.blockNumber);
    if (topics.length < 4 || !data || data.length < 2 + 64 * 3 || !block) return [];
    return [{ pool: topics[1]!.toLowerCase(), c0: addressIn(topics[2]!), c1: addressIn(topics[3]!), hook: addressIn(word(data, 2)), block: Number(BigInt(block)) }];
  });
  const seen = new Map<string, number>();
  for (const r of raw) for (const c of [r.c0, r.c1]) seen.set(c, (seen.get(c) ?? 0) + 1);
  return raw.map((r) => {
    const tokenIs0 = KNOWN_QUOTES.has(r.c1) || (!KNOWN_QUOTES.has(r.c0) && seen.get(r.c0)! < seen.get(r.c1)!);
    return { pool: r.pool, token: tokenIs0 ? r.c0 : r.c1, quote: tokenIs0 ? r.c1 : r.c0, hook: r.hook, block: r.block };
  });
}

export type HookInfo = { readonly name: string | null; readonly verified: boolean };

export function parseHookInfo(body: unknown): HookInfo {
  return isObj(body) ? { name: strOf(body.name), verified: body.is_verified === true } : { name: null, verified: false };
}

/** Whether the hook's own address lets it take a cut of a swap. */
export function takesSwapCut(hook: string): boolean {
  return readHookAddress(hook).granted.some((p) => SWAP_CUT.has(p.name));
}

export type Scored = { readonly launch: Launch; readonly market: Market | null; readonly flags: readonly { text: string; tone: Tone }[] };

/** The quick checks a radar can afford for every launch. */
export function scoreLaunch(launch: Launch, market: Market | null, hook: HookInfo | null): Scored {
  const flags: { text: string; tone: Tone }[] = [];
  // a hook whose record could not be read is NOT an unverified one (hard rule 12) — MEASURED 2026-10-14, Blockscout
  // answering this machine 403 painted every hook of the hour red
  if (launch.hook !== NATIVE && hook === null) {
    flags.push({ text: takesSwapCut(launch.hook) ? "hook can take a cut of swaps; whether it is verified was not checked" : "hook not checked", tone: "warn" });
  } else if (launch.hook !== NATIVE && takesSwapCut(launch.hook)) {
    flags.push(hook?.verified ? { text: "hook takes a cut of swaps", tone: "warn" } : { text: "UNVERIFIED hook can take a cut of swaps", tone: "bad" });
  } else if (launch.hook !== NATIVE && !hook?.verified) flags.push({ text: "unverified hook", tone: "warn" });
  if (market) {
    const buys = market.buys24h ?? 0;
    const sells = market.sells24h ?? 0;
    if (buys >= 10 && sells === 0) flags.push({ text: `${buys} buys and not one sell`, tone: "bad" });
    if (market.liquidityUsd !== null && market.liquidityUsd < 1_000) flags.push({ text: "under $1k liquidity", tone: "warn" });
  }
  return { launch, market, flags };
}

/**
 * A launch's score out of 100, on the verdict's own scale (−35 a red flag, −10 an amber one), so a
 * trading bot reading the feed can sort and cut by one number (2026-10-02: the radar as a paid feed).
 * The radar's quick checks only — a high score is "nothing found in a glance", never a verdict.
 */
export function riskScore(s: Scored): number {
  const bad = s.flags.filter((f) => f.tone === "bad").length;
  const warn = s.flags.length - bad;
  return Math.max(0, 100 - 35 * bad - 10 * warn);
}

/** The launchpad, by the hook's verified name — or what is known about the hook when it has none. */
export function padName(hook: string, info: HookInfo | null): string {
  if (hook === NATIVE) return "no hook";
  if (info?.name) return info.name;
  return `hook ${short(hook)}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const activity = (m: Market | null) => (m ? (m.buys24h ?? 0) + (m.sells24h ?? 0) : 0);

export function launchRow(s: Scored, pad: string, latest: number): Row {
  const m = s.market!;
  const ago = Math.max(1, Math.round(((latest - s.launch.block) * BLOCK_SECONDS) / 60));
  const tone: Tone = s.flags.some((f) => f.tone === "bad") ? "bad" : s.flags.length ? "warn" : "ok";
  const parts = [
    `score ${riskScore(s)}/100`,
    `${ago} min ago`,
    m.liquidityUsd === null ? "liquidity not reported" : `liq ${usd(m.liquidityUsd)}`,
    `${plural(m.buys24h ?? 0, "buy", "buys")} / ${plural(m.sells24h ?? 0, "sell", "sells")}`,
    ...s.flags.map((f) => f.text),
  ];
  // MEASURED: one launch's symbol was " SOON", with a leading space — a lookalike of somebody else's ticker
  return row(`${m.symbol?.trim() || short(s.launch.token)} · ${pad}`, parts.join(" · "), { tone, ...(m.url ? { href: m.url } : {}), next: `verdict ${s.launch.token}` });
}

/** The radar over the last `minutes`, as of the chain's latest block. */
export async function radar(minutes: number): Promise<Report> {
  const latest = Number(quantity(await rpc("eth_blockNumber"), "the latest block"));
  const blocks = Math.round((minutes * 60) / BLOCK_SECONDS);
  const logs = await rpc("eth_getLogs", [
    { address: UNISWAP_V4_POOL_MANAGER, topics: [INITIALIZE_TOPIC], fromBlock: `0x${Math.max(0, latest - blocks).toString(16)}`, toBlock: `0x${latest.toString(16)}` },
  ]);
  const launches = parseLaunches(logs).reverse(); // newest first
  const newest = [...new Map(launches.map((l) => [l.token, l])).values()];

  // DexScreener takes 30 tokens a request; the newest PRICED are read in a few at once
  const batches: string[][] = [];
  for (let i = 0; i < Math.min(newest.length, PRICED); i += BATCH) batches.push(newest.slice(i, i + BATCH).map((l) => l.token));
  let priced: Market[] | null = null;
  try {
    priced = (await Promise.all(batches.map(marketsOf))).flat();
  } catch {
    priced = null;
  }
  const byPool = new Map((priced ?? []).flatMap((m) => (m.pair ? [[m.pair.toLowerCase(), m] as const] : [])));
  const marketOf = (l: Launch) => byPool.get(l.pool) ?? null;

  // Hook names are read for the hooks this report will show and the busiest four, not all ~30 of them
  const counts = new Map<string, number>();
  for (const l of launches) counts.set(l.hook, (counts.get(l.hook) ?? 0) + 1);
  const shown = newest.filter((l) => activity(marketOf(l)) > 0).sort((a, b) => activity(marketOf(b)) - activity(marketOf(a))).slice(0, SHOWN);
  const busy = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([h]) => h);
  const hooks = [...new Set([...busy, ...shown.map((l) => l.hook)])].filter((h) => h !== NATIVE);
  const infos = new Map(
    await Promise.all(
      hooks.map(async (h) => [h, await getJson("Blockscout", `${BLOCKSCOUT}/addresses/${h}`).then(parseHookInfo, () => null)] as const),
    ),
  );

  // this app's own launches are named as such — the factory's events for the same window
  // and basepad's and Doppler's launches by their factories' logs — one eth_getLogs for both
  const [ours, pads] = await Promise.all([
    launchedBetween(Math.max(0, latest - blocks), latest).catch(() => new Set<string>()),
    padsBetween(Math.max(0, latest - blocks), latest).catch(() => new Map<string, string>()),
  ]);
  const pad = (l: Launch) => (ours.has(l.token) ? `${BRAND.name} launchpad` : (pads.get(l.token) ?? padName(l.hook, infos.get(l.hook) ?? null)));

  const traded = newest.filter((l) => activity(marketOf(l)) > 0).length;
  const busiest = busy.map((h) => `${padName(h, infos.get(h) ?? null)} ${counts.get(h)}`).join(", ");

  const rows: Row[] = [
    row("Pools opened", launches.length ? `${launches.length} on Uniswap v4 in the last ${minutes} min — ${busiest}` : `none on Uniswap v4 in the last ${minutes} min`),
    ...(priced === null
      ? [row("Trading", "not checked — DexScreener could not be read", { tone: "warn" })]
      : [row("Trading", `${traded} of ${newest.length} new tokens have trades`)]),
    ...shown.map((l) => launchRow(scoreLaunch(l, marketOf(l), infos.get(l.hook) ?? null), pad(l), latest)),
  ];
  return {
    title: `Launch Radar — last ${minutes} min`,
    rows,
    notes: [
      "Read from the chain: every Uniswap v4 pool initialized in the window. Pools on Uniswap v3 and Aerodrome are not in this list yet.",
      "Busiest first. A hook that can take a cut of swaps is how a v4 token charges a tax — from a verified launchpad that is its disclosed fee, from an unverified hook it is an unknown cut.",
      ...(newest.length > PRICED ? [`Only the newest ${PRICED} of ${newest.length} new tokens were priced.`] : []),
      "Each launch has a score out of 100 from the quick checks above (−35 a red flag, −10 an amber one) — a first look, not a verdict: run `verdict <token>` for a simulated buy-and-sell, the holders and the launcher.",
    ],
    sources: ["Base (eth_getLogs: v4 pools, and basepad's and Doppler's launch logs)", "Blockscout", "DexScreener"],
  };
}

export const radarSkill: Skill = {
  id: "radar",
  title: "Launch Radar",
  summary: "What launched on Base in the last hour — read from the chain, busiest first, each flagged.",
  args: [{ name: "minutes", hint: `${DEFAULT_MINUTES} (max ${MAX_MINUTES})`, optional: true }],
  run([input = ""]) {
    const text = input.trim();
    const minutes = text === "" ? DEFAULT_MINUTES : Number(text);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
      return Promise.reject(new Error(`Minutes must be a whole number from 1 to ${MAX_MINUTES}.`));
    }
    return radar(minutes);
  },
};
