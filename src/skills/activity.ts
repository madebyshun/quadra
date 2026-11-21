import { BRAND } from "@/brand";
import { BASE, UNISWAP_V4_POOL_MANAGER } from "@/config/chain";
import { BLOCKSCOUT } from "@/skills/blockscout";
import { getJson, quantity, rpc, rpcOn } from "@/skills/http";
import { listOf } from "@/skills/json";
import { launchedBetween } from "@/skills/launchpad";
import { BATCH, marketsOf, type Market } from "@/skills/dexscreener";
import { short } from "@/skills/format";
import { blocksAgo } from "@/skills/blocktime";
import { ARCHIVE_RPC } from "@/skills/origin";
import { INITIALIZE_TOPIC, padName, parseHookInfo, parseLaunches, scoreLaunch, type HookInfo } from "@/skills/radar";

/**
 * Task Manager's "Processes" & Rugsweeper's minefield: reads Uniswap v4 `Initialize` logs on Base
 * in <= 900-block chunks across archive-capable endpoints so 200ms Base blocks (5 blocks/s) never
 * trip public RPC `eth_getLogs` range limits.
 */

export type Process = { readonly name: string; readonly launches: number; readonly ours: boolean };
export type Activity = { readonly latest: number; readonly minutes: number; readonly total: number; readonly processes: readonly Process[] };

export const ACTIVITY_MINUTES = 10;
/** Processes listed; the rest are summed into one line. */
export const SHOWN_PROCESSES = 6;
/** Max blocks per `eth_getLogs` request (safe across mainnet.base.org, Tenderly, dRPC and publicnode). */
const LOG_CHUNK = 900;

const NATIVE = "0x0000000000000000000000000000000000000000";
const names = new Map<string, HookInfo | null>();

async function hookInfo(hook: string): Promise<HookInfo | null> {
  if (!names.has(hook)) names.set(hook, await getJson("Blockscout", `${BLOCKSCOUT}/addresses/${hook}`).then(parseHookInfo, () => null));
  return names.get(hook)!;
}

/** For tests: forget the remembered hook names. */
export function forgetHookNames(): void {
  names.clear();
}

/** Read `eth_getLogs` over `[from, to]` in safe chunks, using archive-capable fallbacks. */
async function initLogsBetween(from: number, to: number): Promise<unknown[]> {
  if (to - from + 1 <= LOG_CHUNK) {
    return listOf(
      await rpcOn(BASE.name, [BASE.rpc, ...ARCHIVE_RPC], "eth_getLogs", [
        { address: UNISWAP_V4_POOL_MANAGER, topics: [INITIALIZE_TOPIC], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` },
      ]),
    );
  }
  const out: unknown[] = [];
  for (let a = from; a <= to; a += LOG_CHUNK) {
    const b = Math.min(to, a + LOG_CHUNK - 1);
    const page = await rpcOn(BASE.name, ARCHIVE_RPC, "eth_getLogs", [
      { address: UNISWAP_V4_POOL_MANAGER, topics: [INITIALIZE_TOPIC], fromBlock: `0x${a.toString(16)}`, toBlock: `0x${b.toString(16)}` },
    ]);
    out.push(...listOf(page));
  }
  return out;
}

export async function launchActivity(minutes = ACTIVITY_MINUTES): Promise<Activity> {
  const latest = Number(quantity(await rpc("eth_blockNumber"), "the latest block"));
  const from = blocksAgo(latest, minutes);
  const [logs, ours] = await Promise.all([
    initLogsBetween(from, latest),
    launchedBetween(from, latest).catch(() => new Set<string>()),
  ]);
  const launches = parseLaunches(logs);
  const counts = new Map<string, number>();
  let mine = 0;
  for (const l of launches) {
    if (ours.has(l.token)) mine += 1;
    else counts.set(l.hook, (counts.get(l.hook) ?? 0) + 1);
  }
  const busiest = [...counts].sort((a, b) => b[1] - a[1]);
  const named = await Promise.all(
    busiest.slice(0, SHOWN_PROCESSES).map(async ([hook, n]) => ({ name: padName(hook, hook === NATIVE ? null : await hookInfo(hook)), launches: n, ours: false })),
  );
  const rest = busiest.slice(SHOWN_PROCESSES).reduce((n, [, c]) => n + c, 0);
  const processes: Process[] = [
    ...(mine > 0 ? [{ name: `${BRAND.name} launchpad`, launches: mine, ours: true }] : []),
    ...named,
    ...(rest > 0 ? [{ name: "everything else", launches: rest, ours: false }] : []),
  ];
  return { latest, minutes, total: launches.length, processes };
}

/** A launch on the Rugsweeper board: what it is, and whether the radar's quick checks found a red flag. */
export type Field = { readonly token: string; readonly symbol: string; readonly mine: boolean; readonly why: string | null };

/** How far back the board reaches for launches (15 min = ~4,500 blocks at 5 blocks/s on Base). */
export const FIELD_MINUTES = 15;

/**
 * The newest launches on Base, scored by Launch Radar's own quick checks (`scoreLaunch`): a launch
 * with a red flag is a MINE. The board is made of real launches, so playing it is reading the radar.
 */
export async function minefield(cells: number, minutes = FIELD_MINUTES): Promise<Field[]> {
  const latest = Number(quantity(await rpc("eth_blockNumber"), "the latest block"));
  const from = blocksAgo(latest, minutes);
  const logs = await initLogsBetween(from, latest);
  const newest = [...new Map(parseLaunches(logs).reverse().map((l) => [l.token, l])).values()].slice(0, cells);
  const batches: string[][] = [];
  for (let i = 0; i < newest.length; i += BATCH) batches.push(newest.slice(i, i + BATCH).map((l) => l.token));
  const markets = (await Promise.all(batches.map((b) => marketsOf(b).catch(() => [] as Market[])))).flat();
  const byPool = new Map(markets.flatMap((m) => (m.pair ? [[m.pair.toLowerCase(), m] as const] : [])));
  const hooks = [...new Set(newest.map((l) => l.hook))].filter((h) => h !== NATIVE);
  const infos = new Map(await Promise.all(hooks.map(async (h) => [h, await hookInfo(h)] as const)));
  return newest.map((l) => {
    const market = byPool.get(l.pool) ?? null;
    // a hook whose Blockscout record could not be read is not judged on it — an unread answer is not a red flag
    const unread = l.hook !== NATIVE && infos.get(l.hook) === null;
    const scored = scoreLaunch(unread ? { ...l, hook: NATIVE } : l, market, unread ? null : infos.get(l.hook) ?? null);
    const red = scored.flags.find((f) => f.tone === "bad");
    return { token: l.token, symbol: market?.symbol ?? short(l.token), mine: red !== undefined, why: red?.text ?? null };
  });
}
