import { beforeEach, describe, expect, it, vi } from "vitest";
import { BRAND } from "@/brand";
import { UNISWAP_V4_POOL_MANAGER } from "@/config/chain";
import { BLOCKSCOUT } from "@/skills/blockscout";
import { BATCH } from "@/skills/dexscreener";
import { short } from "@/skills/format";
import { LAUNCHED_TOPIC } from "@/skills/launchpad";
import { INITIALIZE_TOPIC, parseLaunches } from "@/skills/radar";
import { ACTIVITY_MINUTES, FIELD_MINUTES, SHOWN_PROCESSES, forgetHookNames, launchActivity, minefield } from "@/skills/activity";
import { RX } from "./fixtures/radar";
import { DOWN, net, useNet, type Answer } from "./net";

useNet();

/**
 * Judged on Launch Radar's real 20-minute window (tests/fixtures/radar): 61 `Initialize` logs, the
 * DexScreener batches that priced them and Blockscout's records of five hooks. A hook Blockscout was
 * never asked about in the capture answers here as DOWN — the case of a record that could not be read.
 */

const LATEST = Number(BigInt(RX.blockNumber));
const HOOKS = RX.blockscoutHooks as Record<string, unknown>;
const ZORA = "0x0469a4bd3724dc86c9542f4694c976da13c450c0";
const TAX = "0x9c7155d7216454d9d894f792c8b5c564f2c66acc";
const UNREAD = "0xbb7784a4d481184283ed89619a3e3ed143e1adc0";
const LAUNCHES = parseLaunches(RX.initializeLogs.result);
const pad = (a: string) => `0x${a.slice(2).padStart(64, "0")}`;
const MARKETS = [...(RX.dexscreenerBatch1.body as unknown[]), ...(RX.dexscreenerBatch2.body as unknown[])];

beforeEach(() => forgetHookNames());

function chain(o: { ours?: string[]; ourLogs?: Answer; hooks?: Record<string, Answer>; dex?: Answer } = {}) {
  const asked = { blockscout: [] as string[], ranges: [] as [number, number][] };
  const calls = net({
    rpc: (method, params) => {
      if (method === "eth_blockNumber") return RX.blockNumber;
      if (method !== "eth_getLogs") return undefined;
      const [f] = params as [{ address: string | string[]; topics: string[]; fromBlock: string; toBlock: string }];
      if (Array.isArray(f.address)) {
        expect(f.topics).toEqual([LAUNCHED_TOPIC]);
        return o.ourLogs ?? (o.ours ?? []).map((t) => ({ topics: [LAUNCHED_TOPIC, pad(t)] }));
      }
      expect(f.address).toBe(UNISWAP_V4_POOL_MANAGER);
      expect(f.topics).toEqual([INITIALIZE_TOPIC]);
      asked.ranges.push([Number(f.fromBlock), Number(f.toBlock)]);
      return RX.initializeLogs.result;
    },
    get: (url) => {
      if (url.startsWith("https://api.dexscreener.com/")) return o.dex ?? MARKETS;
      const hook = url.replace(`${BLOCKSCOUT}/addresses/`, "");
      if (hook === url) return undefined;
      asked.blockscout.push(hook);
      return o.hooks?.[hook] ?? HOOKS[hook] ?? DOWN;
    },
  });
  return { asked, calls };
}

describe("launchActivity", () => {
  it("reads a window wider than one request in consecutive chunks, end to end", async () => {
    const { asked } = chain();
    // the chain's logs, once: every chunk after the first answers nothing
    const original = globalThis.fetch;
    let first = true;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as { method?: string }) : null;
      if (body?.method === "eth_getLogs" && !first) {
        const res = await original(url, init);
        const j = (await res.json()) as { result: unknown };
        const f = (JSON.parse(String(init!.body)) as { params: [{ address: unknown }] }).params[0];
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: Array.isArray(f.address) ? j.result : [] }));
      }
      if (body?.method === "eth_getLogs" && !Array.isArray((JSON.parse(String(init!.body)) as { params: [{ address: unknown }] }).params[0].address)) first = false;
      return original(url, init);
    });
    const a = await launchActivity(60);
    const span = asked.ranges.at(-1)![1] - asked.ranges[0]![0] + 1;
    expect(asked.ranges.length).toBeGreaterThan(1);
    expect(asked.ranges.every(([f, t]) => t - f + 1 <= 900)).toBe(true);
    asked.ranges.slice(1).forEach(([f], i) => expect(f).toBe(asked.ranges[i]![1] + 1));
    expect(asked.ranges.at(-1)![1]).toBe(LATEST);
    expect(span).toBe(LATEST - asked.ranges[0]![0] + 1);
    expect(a.total).toBe(61);
  });

  it("groups the window's launches by launchpad, busiest first, the rest on one line", async () => {
    const { asked } = chain();
    const a = await launchActivity();
    expect(a.latest).toBe(LATEST);
    expect(a.minutes).toBe(ACTIVITY_MINUTES);
    expect(asked.ranges).toEqual([[LATEST - ACTIVITY_MINUTES * 30, LATEST]]);
    expect(a.total).toBe(61);
    expect(a.processes).toEqual([
      { name: "ZoraV4CoinHook", launches: 15, ours: false },
      { name: "no hook", launches: 8, ours: false },
      { name: "TaxLaunchHook", launches: 6, ours: false },
      { name: expect.any(String), launches: 5, ours: false },
      // never captured from Blockscout: unread, so named by its address — not called unverified
      { name: `hook ${short(UNREAD)}`, launches: 4, ours: false },
      { name: expect.any(String), launches: 2, ours: false },
      { name: "everything else", launches: 61 - 15 - 8 - 6 - 5 - 4 - 2, ours: false },
    ]);
    expect(a.processes.filter((p) => !p.ours && p.name !== "everything else")).toHaveLength(SHOWN_PROCESSES);
    // the zero address is "no hook" and never asked about
    expect(asked.blockscout).not.toContain("0x0000000000000000000000000000000000000000");
  });

  it("counts this app's own launches under its own name, first", async () => {
    const last = LAUNCHES[LAUNCHES.length - 1]!;
    chain({ ours: [last.token] });
    const a = await launchActivity();
    expect(a.processes[0]).toEqual({ name: `${BRAND.name} launchpad`, launches: 1, ours: true });
    expect(a.processes.reduce((n, p) => n + p.launches, 0)).toBe(61);
  });

  it("remembers a hook's name — and a failed read — for the page's life", async () => {
    const first = chain();
    await launchActivity();
    expect(first.asked.blockscout.length).toBeGreaterThan(0);
    const second = chain();
    await launchActivity();
    expect(second.asked.blockscout).toEqual([]);
  });

  it("still lists the window when the launchpads' own logs cannot be read", async () => {
    chain({ ourLogs: DOWN });
    expect((await launchActivity()).processes[0]!.ours).toBe(false);
  });

  it("has no 'everything else' line when every launchpad fits, and starts at block 0 on a young chain", async () => {
    net({
      rpc: (m, p) =>
        m === "eth_blockNumber" ? "0x5" : m === "eth_getLogs" ? (Array.isArray((p[0] as { address: unknown }).address) ? [] : (expect((p[0] as { fromBlock: string }).fromBlock).toBe("0x0"), RX.initializeLogs.result.slice(0, 1))) : undefined,
      get: (url) => HOOKS[url.replace(`${BLOCKSCOUT}/addresses/`, "")] ?? DOWN,
    });
    const a = await launchActivity(1);
    expect(a.processes).toHaveLength(1);
    expect(a.processes.some((p) => p.name === "everything else")).toBe(false);
  });
});

describe("minefield", () => {
  it("lays out the newest launches, one square per coin, priced in batches of BATCH", async () => {
    const { calls, asked } = chain();
    const field = await minefield(40);
    expect(asked.ranges).toEqual([[LATEST - FIELD_MINUTES * 30, LATEST]]);
    expect(field).toHaveLength(40);
    expect(new Set(field.map((f) => f.token)).size).toBe(40);
    // newest first
    expect(field[0]!.token).toBe(LAUNCHES[LAUNCHES.length - 1]!.token);
    expect(calls.filter((c) => c.url.startsWith("https://api.dexscreener.com/"))).toHaveLength(Math.ceil(40 / BATCH));
    for (const f of field) expect(f.mine).toBe(f.why !== null);
  });

  it("a hook whose Blockscout record could not be read is NOT a mine", async () => {
    chain({ dex: [] });
    const field = await minefield(43);
    const unread = LAUNCHES.filter((l) => l.hook === UNREAD).map((l) => l.token);
    expect(unread.length).toBeGreaterThan(0);
    for (const f of field.filter((x) => unread.includes(x.token))) expect(f).toMatchObject({ mine: false, why: null });
  });

  it("an UNVERIFIED hook that can take a cut of swaps is a mine, and says so", async () => {
    chain({ hooks: { [TAX]: { ...(HOOKS[TAX] as object), is_verified: false } }, dex: [] });
    const field = await minefield(43);
    const taxed = new Set(LAUNCHES.filter((l) => l.hook === TAX).map((l) => l.token));
    const mines = field.filter((f) => taxed.has(f.token));
    expect(mines.length).toBeGreaterThan(0);
    for (const m of mines) expect(m).toMatchObject({ mine: true, why: "UNVERIFIED hook can take a cut of swaps" });
  });

  it("names a square by DexScreener's symbol, or by its address when DexScreener is down", async () => {
    chain();
    const named = await minefield(5);
    expect(named.some((f) => f.symbol !== short(f.token))).toBe(true);
    forgetHookNames();
    chain({ dex: DOWN });
    const bare = await minefield(5);
    for (const f of bare) expect(f.symbol).toBe(short(f.token));
  });

  it("ignores a market with no pool id", async () => {
    chain({ dex: MARKETS.map((m) => ({ ...(m as object), pairAddress: undefined })) });
    for (const f of await minefield(5)) expect(f.symbol).toBe(short(f.token));
  });

  it("starts at block 0 on a young chain, and a launch with no hook is judged on its market alone", async () => {
    const zoraOnly = RX.initializeLogs.result.filter((l) => parseLaunches([l])[0]!.hook === ZORA).slice(0, 1);
    const noHook = RX.initializeLogs.result.filter((l) => parseLaunches([l])[0]!.hook === "0x0000000000000000000000000000000000000000").slice(0, 1);
    net({
      rpc: (m, p) => (m === "eth_blockNumber" ? "0x5" : m === "eth_getLogs" ? (expect((p[0] as { fromBlock: string }).fromBlock).toBe("0x0"), [...zoraOnly, ...noHook]) : undefined),
      get: (url) => (url.startsWith("https://api.dexscreener.com/") ? [] : HOOKS[url.replace(`${BLOCKSCOUT}/addresses/`, "")]),
    });
    const field = await minefield(10);
    expect(field).toHaveLength(2);
    expect(field.every((f) => !f.mine)).toBe(true);
  });
});
