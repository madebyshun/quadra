import { describe, expect, it } from "vitest";
import { UNISWAP_V4_POOL_MANAGER, USDC, WETH } from "@/config/chain";
import { BLOCKSCOUT } from "@/skills/blockscout";
import { parseMarkets, type Market } from "@/skills/dexscreener";
import {
  DEFAULT_MINUTES,
  INITIALIZE_TOPIC,
  launchRow,
  MAX_MINUTES,
  padName,
  parseHookInfo,
  parseLaunches,
  PRICED,
  radar,
  radarSkill,
  riskScore,
  scoreLaunch,
  SHOWN,
  takesSwapCut,
  type Launch,
} from "@/skills/radar";
import { copy } from "./fixtures/base";
import { RX } from "./fixtures/radar";
import { LAUNCHPAD, LX } from "./fixtures/launchpad";
import { LAUNCHED_TOPIC } from "@/skills/launchpad";
import { DOWN, net, useNet, type Answer } from "./net";
import { PX } from "./fixtures/launchpads";
import { withoutV3 } from "./v2only";

// Its fixtures are real v2/v1 captures, so it runs as the app did before v3 was set.
withoutV3();

useNet();

/**
 * The radar is judged on one real 20-minute window of Base: 61 `Initialize` logs from Uniswap v4's
 * PoolManager, the two DexScreener batches that priced the 43 new tokens, and Blockscout's records
 * of the hooks it named. Variants are built from those, in the test.
 */

const LATEST = Number(BigInt(RX.blockNumber));
const NATIVE = "0x0000000000000000000000000000000000000000";
const HOOKS = RX.blockscoutHooks as Record<string, { hash: string; name: string; is_verified: boolean }>;
const ZORA_HOOK = "0x0469a4bd3724dc86c9542f4694c976da13c450c0";
const TAX_HOOK = "0x9c7155d7216454d9d894f792c8b5c564f2c66acc";

/** The captured window, with any GET overridden; `ours` is what this app's launchpad logged in it. */
function chain(over: Record<string, Answer> = {}, logs: unknown = RX.initializeLogs.result, ours: unknown = [], pads: unknown = []) {
  const table: Record<string, Answer> = {
    [RX.dexscreenerBatch1.url]: RX.dexscreenerBatch1.body,
    [RX.dexscreenerBatch2.url]: RX.dexscreenerBatch2.body,
    ...Object.fromEntries(Object.entries(HOOKS).map(([h, body]) => [`${BLOCKSCOUT}/addresses/${h}`, body])),
    ...over,
  };
  return net({
    rpc: (method, params) => {
      if (method === "eth_blockNumber") return RX.blockNumber;
      if (method !== "eth_getLogs") return undefined;
      const [filter] = params as [{ address: string | string[]; topics: string[]; fromBlock: string; toBlock: string }];
      // the launchpads' Launched logs: every deployed factory in one request
      // basepad's and Doppler's launch logs: both contracts in one request
      if (Array.isArray(filter.address) && filter.address[0] === PX.padLogs.params[0]!.address[0]) return pads;
      if (Array.isArray(filter.address)) return (expect(filter.address).toEqual([LAUNCHPAD.factoryV2, LAUNCHPAD.factory]), ours);
      expect(filter.address).toBe(UNISWAP_V4_POOL_MANAGER);
      expect(filter.topics).toEqual([INITIALIZE_TOPIC]);
      return logs;
    },
    get: (url) => table[url],
  });
}

describe("reading the chain's new pools", () => {
  /** The topic is hashed here from the event's signature; the capture's logs carry the same one. */
  it("asks for v4's Initialize event, and the logs answer with exactly that topic", () => {
    expect(RX.initializeLogs.params[0]!.topics).toEqual([INITIALIZE_TOPIC]);
    expect(RX.initializeLogs.result.every((l) => l.topics[0] === INITIALIZE_TOPIC)).toBe(true);
  });

  it("reads each pool as (id, token, quote, hook, block)", () => {
    const launches = parseLaunches(RX.initializeLogs.result);
    expect(launches).toHaveLength(61);
    expect(launches.every((l) => l.token !== NATIVE && l.token !== WETH.address.toLowerCase() && l.token !== USDC.address.toLowerCase())).toBe(true);
    expect(new Set(launches.map((l) => l.hook)).has(ZORA_HOOK)).toBe(true);
    expect(launches[0]!.block).toBe(Number(BigInt(RX.initializeLogs.result[0]!.blockNumber)));
  });

  it("takes as the quote the side a known asset is on, or else the side more pools share", () => {
    const log = (c0: string, c1: string) => ({
      blockNumber: "0x1",
      topics: [INITIALIZE_TOPIC, "0xid", `0x${c0.slice(2).padStart(64, "0")}`, `0x${c1.slice(2).padStart(64, "0")}`],
      data: `0x${"0".repeat(64 * 5)}`,
    });
    const A = "0x00000000000000000000000000000000000000aa";
    const B = "0x00000000000000000000000000000000000000bb";
    const C = "0x00000000000000000000000000000000000000cc";
    const [weth, eth, shared, other] = parseLaunches([log(A, WETH.address), log(NATIVE, B), log(C, A), log(B, C)]);
    expect([weth!.token, weth!.quote]).toEqual([A, WETH.address.toLowerCase()]);
    expect([eth!.token, eth!.quote]).toEqual([B, NATIVE]);
    // C and A each appear twice: a tie keeps currency1 as the token
    expect(shared!.token).toBe(A);
    expect(other!.token).toBe(C);
  });

  it("skips a log it cannot read", () => {
    expect(parseLaunches(["junk", { topics: [INITIALIZE_TOPIC], data: "0x", blockNumber: "0x1" }, { topics: ["a", "b", "c", "d"], data: "0x00", blockNumber: "0x1" }, { topics: [1, 2, 3, 4] }])).toEqual([]);
    expect(parseLaunches(null)).toEqual([]);
  });
});

describe("hooks", () => {
  it("names a hook from Blockscout, and knows nothing about one it could not read", () => {
    expect(parseHookInfo(HOOKS[ZORA_HOOK])).toEqual({ name: "ZoraV4CoinHook", verified: true });
    expect(parseHookInfo({ is_verified: "yes" })).toEqual({ name: null, verified: false });
    expect(parseHookInfo(null)).toEqual({ name: null, verified: false });
    expect(padName(NATIVE, null)).toBe("no hook");
    expect(padName(TAX_HOOK, { name: "TaxLaunchHook", verified: true })).toBe("TaxLaunchHook");
    expect(padName(TAX_HOOK, null)).toBe("hook 0x9c71…6acc");
  });

  /** Read from the address bits: v4's swap "returns delta" flags are how a hook takes a cut. */
  it("reads from the address whether a hook can take a cut of swaps", () => {
    expect(takesSwapCut(TAX_HOOK)).toBe(true);
    expect(takesSwapCut("0x0000000000000000000000000000000000000080")).toBe(false); // beforeSwap only
    expect(takesSwapCut("0x0000000000000000000000000000000000000008")).toBe(true); // beforeSwapReturnsDelta
  });
});

describe("scoring a launch", () => {
  const launch = (hook: string): Launch => ({ pool: "0xid", token: "0x00000000000000000000000000000000000000aa", quote: NATIVE, hook, block: LATEST - 30 });
  const [base] = parseMarkets(RX.dexscreenerBatch1.body);
  const market = (over: Partial<Market> = {}): Market => ({ ...base!, ...over });
  const verified = { name: "TaxLaunchHook", verified: true };

  it("a verified hook's cut is a disclosed fee; an unverified hook's cut is red", () => {
    expect(scoreLaunch(launch(TAX_HOOK), market(), verified).flags).toEqual([{ text: "hook takes a cut of swaps", tone: "warn" }]);
    expect(scoreLaunch(launch(TAX_HOOK), market(), { ...verified, verified: false }).flags).toEqual([{ text: "UNVERIFIED hook can take a cut of swaps", tone: "bad" }]);
    // a hook whose record could not be READ is not checked, never "unverified" (hard rule 12)
    expect(scoreLaunch(launch(TAX_HOOK), market(), null).flags).toEqual([{ text: "hook can take a cut of swaps; whether it is verified was not checked", tone: "warn" }]);
  });

  it("an unverified hook that takes no cut is still amber; no hook and a verified one say nothing", () => {
    const quiet = "0x0000000000000000000000000000000000000080";
    expect(scoreLaunch(launch(quiet), market(), { ...verified, verified: false }).flags).toEqual([{ text: "unverified hook", tone: "warn" }]);
    expect(scoreLaunch(launch(quiet), market(), null).flags).toEqual([{ text: "hook not checked", tone: "warn" }]);
    expect(scoreLaunch(launch(quiet), market(), verified).flags).toEqual([]);
    expect(scoreLaunch(launch(NATIVE), market(), null).flags).toEqual([]);
  });

  it("flags buys with not one sell, and thin liquidity — but not unknown liquidity twice", () => {
    expect(scoreLaunch(launch(NATIVE), market({ buys24h: 12, sells24h: 0 }), null).flags).toEqual([{ text: "12 buys and not one sell", tone: "bad" }]);
    expect(scoreLaunch(launch(NATIVE), market({ buys24h: 9, sells24h: 0 }), null).flags).toEqual([]);
    expect(scoreLaunch(launch(NATIVE), market({ buys24h: null, sells24h: null }), null).flags).toEqual([]);
    expect(scoreLaunch(launch(NATIVE), market({ liquidityUsd: 900 }), null).flags).toEqual([{ text: "under $1k liquidity", tone: "warn" }]);
    expect(scoreLaunch(launch(NATIVE), market({ liquidityUsd: null }), null).flags).toEqual([]);
    expect(scoreLaunch(launch(NATIVE), null, null).flags).toEqual([]);
  });

  it("writes a row: age, depth, trades, flags — red over amber over clean", () => {
    const s = scoreLaunch(launch(TAX_HOOK), market({ buys24h: 1, sells24h: 1 }), verified);
    expect(launchRow(s, "TaxLaunchHook", LATEST)).toEqual({
      label: "copyfomo · TaxLaunchHook",
      value: "score 90/100 · 1 min ago · liq $10,675.21 · 1 buy / 1 sell · hook takes a cut of swaps",
      tone: "warn",
      href: base!.url,
      next: `verdict ${launch(TAX_HOOK).token}`,
    });
    const bare = scoreLaunch(launch(NATIVE), market({ liquidityUsd: null, symbol: "  ", url: null, buys24h: null, sells24h: null }), null);
    expect(launchRow(bare, "no hook", LATEST)).toEqual({ label: "0x0000…00aa · no hook", value: "score 100/100 · 1 min ago · liquidity not reported · 0 buys / 0 sells", tone: "ok", next: `verdict ${launch(NATIVE).token}` });
    const red = scoreLaunch(launch(TAX_HOOK), market(), { ...verified, verified: false });
    expect(launchRow(red, "x", LATEST).tone).toBe("bad");
    // the score is the verdict's own scale: −35 a red flag, −10 an amber one, never below 0
    expect(riskScore(red)).toBe(65);
    expect(riskScore({ ...red, flags: Array.from({ length: 4 }, () => ({ text: "x", tone: "bad" as const })) })).toBe(0);
  });
});

describe("the radar", () => {
  it("reads the captured 20 minutes: 61 pools, 13 tokens trading, busiest first", async () => {
    chain();
    const report = await radar(20);
    expect(report.title).toBe("Launch Radar — last 20 min");
    expect(report.rows.slice(0, 2)).toEqual([
      { label: "Pools opened", value: "61 on Uniswap v4 in the last 20 min — ZoraV4CoinHook 15, no hook 8, TaxLaunchHook 6, DopplerHookInitializer 5" },
      { label: "Trading", value: "13 of 43 new tokens have trades" },
    ]);
    const listed = report.rows.slice(2);
    expect(listed).toHaveLength(13);
    expect(listed[0]).toMatchObject({ label: "copyfomo · no hook", tone: "ok" });
    expect(listed[0]!.value).toMatch(/^score 100\/100 · 18 min ago · liq \$10,675\.21 · 155 buys \/ 112 sells$/);
    expect(listed.find((r) => r.label === "stockmemes · TaxLaunchHook")).toMatchObject({ tone: "warn" });
    // the leading space of " SOON" is not carried into the label
    expect(listed.map((r) => r.label)).toContain("SOON · ClankerHookStaticFeeV2");
    expect(report.sources).toEqual(["Base (eth_getLogs: v4 pools, and basepad's and Doppler's launch logs)", "Blockscout", "DexScreener"]);
    expect(report.notes.some((n) => n.startsWith("Only the newest"))).toBe(false);
  });

  it("asks for exactly the captured block range for 20 minutes — the pools, and this app's launches", async () => {
    const asked: unknown[] = [];
    net({
      rpc: (method, params) => {
        if (method === "eth_blockNumber") return RX.blockNumber;
        if (method === "eth_getLogs") return asked.push(params[0]), [];
        return undefined;
      },
    });
    await radar(20);
    expect(asked).toEqual([
      RX.initializeLogs.params[0],
      { address: [LAUNCHPAD.factoryV2, LAUNCHPAD.factory], topics: [LAUNCHED_TOPIC], fromBlock: RX.initializeLogs.params[0]!.fromBlock, toBlock: RX.initializeLogs.params[0]!.toBlock },
      { ...PX.padLogs.params[0], fromBlock: RX.initializeLogs.params[0]!.fromBlock, toBlock: RX.initializeLogs.params[0]!.toBlock },
    ]);
  });

  it("names a launch from this app's launchpad as such", async () => {
    // the captured Launched log, re-pointed at the window's busiest token — a variant, built here
    const busiest = parseLaunches(RX.initializeLogs.result).find((l) => l.pool === RX.dexscreenerBatch1.body[0]!.pairAddress.toLowerCase())!;
    const log = copy(LX.launchedLogs.result[0]!);
    log.topics[1] = `0x${busiest.token.slice(2).padStart(64, "0")}`;
    chain({}, RX.initializeLogs.result, [log]);
    expect((await radar(20)).rows[2]!.label).toBe("copyfomo · Quadra launchpad");
  });

  it("names basepad's and Doppler's launches by their factories' logs", async () => {
    // the captured Airlock Create log (2026-10-14), its asset re-pointed at the window's busiest token — a variant, built here
    const busiest = parseLaunches(RX.initializeLogs.result).find((l) => l.pool === RX.dexscreenerBatch1.body[0]!.pairAddress.toLowerCase())!;
    const log = copy(PX.padLogs.result[0]!);
    log.data = `0x${busiest.token.slice(2).padStart(64, "0")}${log.data.slice(66)}`;
    chain({}, RX.initializeLogs.result, [], [log]);
    expect((await radar(20)).rows[2]!.label).toBe("copyfomo · Doppler");
    chain({}, RX.initializeLogs.result, [], DOWN);
    expect((await radar(20)).rows[2]!.label).toBe("copyfomo · no hook");
  });

  it("still lists the window when the launchpad's own logs cannot be read", async () => {
    chain({}, RX.initializeLogs.result, DOWN);
    expect((await radar(20)).rows[2]!.label).toBe("copyfomo · no hook");
  });

  it("paints an unverified hook that can take a cut in red", async () => {
    chain({ [`${BLOCKSCOUT}/addresses/${TAX_HOOK}`]: { ...HOOKS[TAX_HOOK], is_verified: false } });
    const row = (await radar(20)).rows.find((r) => r.label === "stockmemes · TaxLaunchHook");
    expect(row).toMatchObject({ tone: "bad" });
    expect(row!.value).toMatch(/UNVERIFIED hook can take a cut of swaps$/);
  });

  it("lists only pools whose trades are reported, and skips a market with no pool address", async () => {
    const body = copy(RX.dexscreenerBatch1.body) as { txns?: unknown; pairAddress?: unknown }[];
    delete body[0]!.txns; // copyfomo: no trade counts
    delete body[1]!.pairAddress; // HI: cannot be matched to its pool
    chain({ [RX.dexscreenerBatch1.url]: body });
    const report = await radar(20);
    expect(report.rows[1]!.value).toBe("11 of 43 new tokens have trades");
    expect(report.rows.map((r) => r.label)).not.toContain("copyfomo · no hook");
    expect(report.rows.map((r) => r.label)).not.toContain("HI · no hook");
  });

  it("names a hook it could not read by its address", async () => {
    chain({ [`${BLOCKSCOUT}/addresses/${TAX_HOOK}`]: DOWN });
    const rows = (await radar(20)).rows;
    expect(rows[0]!.value).toContain("hook 0x9c71…6acc 6");
  });

  it("says trading was not checked when DexScreener is down, and lists nothing it cannot price", async () => {
    chain({ [RX.dexscreenerBatch1.url]: DOWN });
    const report = await radar(20);
    expect(report.rows).toHaveLength(2);
    expect(report.rows[1]).toEqual({ label: "Trading", value: "not checked — DexScreener could not be read", tone: "warn" });
  });

  it("says so when nothing launched", async () => {
    chain({}, []);
    const report = await radar(5);
    expect(report.rows).toEqual([
      { label: "Pools opened", value: "none on Uniswap v4 in the last 5 min" },
      { label: "Trading", value: "0 of 0 new tokens have trades" },
    ]);
  });

  it("prices only the newest batches, and says how many it left out", async () => {
    const many = Array.from({ length: PRICED + 3 }, (_, i) => {
      const log = copy(RX.initializeLogs.result[0]!);
      log.topics[1] = `0x${String(i).padStart(64, "0")}`;
      log.topics[3] = `0x${String(i + 1).padStart(64, "0")}`;
      log.topics[2] = `0x${"0".repeat(64)}`;
      return log;
    });
    const hook = `0x${many[0]!.data.slice(2 + 128 + 24, 2 + 192)}`;
    net({
      rpc: (method) => (method === "eth_blockNumber" ? RX.blockNumber : method === "eth_getLogs" ? many : undefined),
      get: (url) => (url.startsWith("https://api.dexscreener.com/") ? [] : url === `${BLOCKSCOUT}/addresses/${hook}` ? HOOKS[hook] ?? {} : undefined),
    });
    const report = await radar(20);
    expect(report.notes).toContain(`Only the newest ${PRICED} of ${PRICED + 3} new tokens were priced.`);
  });

  it("lists no more than it shows", () => {
    expect(SHOWN).toBe(15);
  });
});

describe("the skill", () => {
  it("takes minutes, optionally — a whole number from 1 to the cap", async () => {
    expect(radarSkill.args).toEqual([{ name: "minutes", hint: `${DEFAULT_MINUTES} (max ${MAX_MINUTES})`, optional: true }]);
    for (const bad of ["0", "abc", "1.5", String(MAX_MINUTES + 1)]) {
      await expect(radarSkill.run([bad])).rejects.toThrow(`Minutes must be a whole number from 1 to ${MAX_MINUTES}.`);
    }
    chain({}, []);
    expect((await radarSkill.run([])).title).toBe(`Launch Radar — last ${DEFAULT_MINUTES} min`);
    chain({}, []);
    expect((await radarSkill.run([" 7 "])).title).toBe("Launch Radar — last 7 min");
  });
});
