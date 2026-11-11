import { BRAND } from "@/brand";
import { UNISWAP_V4_POOL_MANAGER } from "@/config/chain";
import { BLOCKSCOUT } from "@/skills/blockscout";
import { getJson, quantity, rpc } from "@/skills/http";
import { launchedBetween } from "@/skills/launchpad";
import { BATCH, marketsOf, type Market } from "@/skills/dexscreener";
import { short } from "@/skills/format";
import { blocksAgo } from "@/skills/blocktime";
import { INITIALIZE_TOPIC, padName, parseHookInfo, parseLaunches, scoreLaunch, type HookInfo } from "@/skills/radar";

/**
 * Task Manager's "Processes": which launchpads are opening pools on Base right now, counted from the
 * chain — the same Uniswap v4 `Initialize` logs Launch Radar reads, grouped by hook and named by the
 * hook's verified Blockscout name. This app's own launches are counted under its own name. A short
 * window, one `eth_getLogs`, and the hooks' names remembered for the page's life (a name never changes).
 */

export type Process = { readonly name: string; readonly launches: number; readonly ours: boolean };
export type Activity = { readonly latest: number; readonly minutes: number; readonly total: number; readonly processes: readonly Process[] };

export const ACTIVITY_MINUTES = 10;
/** Processes listed; the rest are summed into one line. */
export const SHOWN_PROCESSES = 6;

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

export async function launchActivity(minutes = ACTIVITY_MINUTES): Promise<Activity> {
  const latest = Number(quantity(await rpc("eth_blockNumber"), "the latest block"));
  const from = blocksAgo(latest, minutes);
  const [logs, ours] = await Promise.all([
    rpc("eth_getLogs", [{ address: UNISWAP_V4_POOL_MANAGER, topics: [INITIALIZE_TOPIC], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${latest.toString(16)}` }]),
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

/** How far back the board reaches for launches. */
export const FIELD_MINUTES = 30;

/**
 * The newest launches on Base, scored by Launch Radar's own quick checks (`scoreLaunch`): a launch
 * with a red flag is a MINE. The board is made of real launches, so playing it is reading the radar.
 */
export async function minefield(cells: number, minutes = FIELD_MINUTES): Promise<Field[]> {
  const latest = Number(quantity(await rpc("eth_blockNumber"), "the latest block"));
  const from = blocksAgo(latest, minutes);
  const logs = await rpc("eth_getLogs", [
    { address: UNISWAP_V4_POOL_MANAGER, topics: [INITIALIZE_TOPIC], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${latest.toString(16)}` },
  ]);
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
