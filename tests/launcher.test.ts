import { describe, expect, it, vi } from "vitest";
import { launcherReport, launcherSkill, reputationRow } from "@/skills/launcher";
import type { Launcher, Origin } from "@/skills/origin";
import { row } from "@/skills/types";

/**
 * Launcher puts together reads tested elsewhere against real captures — the launch transaction and
 * the wallet history (`verdict.test.ts`), this app's launchpad (`launchpad-skills.test.ts`). Here
 * those reads are stood in for, so these tests are about which one is asked, and what is said.
 */

const s = vi.hoisted(() => ({
  ours: null as null | { factory: string; creator: string; creatorRecipient: string },
  pairs: [] as unknown[],
  marketsDown: false,
  isToken: false,
  origin: null as unknown,
  profile: null as unknown,
  launches: null as null | { launches: unknown[]; complete: boolean },
  asked: [] as string[],
  pad: null as unknown,
  padGiven: undefined as unknown,
}));

vi.mock("@/skills/launchpad", () => ({
  launchOf: () => Promise.resolve(s.ours),
  launchpadOrigin: () => (s.asked.push("launchpadOrigin"), Promise.resolve(s.origin)),
  launchesBy: () => (s.launches ? Promise.resolve(s.launches) : Promise.reject(new Error("down"))),
}));
vi.mock("@/skills/dexscreener", () => ({ markets: () => (s.marketsDown ? Promise.reject(new Error("down")) : Promise.resolve(s.pairs)) }));
vi.mock("@/skills/chaintoken", () => ({ chainToken: () => (s.isToken ? Promise.resolve({}) : Promise.reject(new Error("not a token"))) }));
vi.mock("@/skills/launchpads", () => ({ launchpadOf: () => (s.pad ? Promise.resolve(s.pad) : Promise.reject(new Error("records down"))) }));
vi.mock("@/skills/origin", () => ({
  originOf: (_t: string, _p: unknown, pad: unknown) => (s.asked.push("originOf"), (s.padGiven = pad), Promise.resolve(s.origin)),
  launcherProfile: () => (s.asked.push("launcherProfile"), Promise.resolve(s.profile)),
}));

const WALLET = "0xD5C1dFc036F9911348EA8065F73c8123f4013FAB";
const TOKEN = "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed";
const NOW = Date.parse("2026-10-02T12:00:00Z");
const launcher = (over: Partial<Launcher> = {}): Launcher => ({
  address: WALLET,
  complete: true,
  txCount: 40,
  firstSeen: new Date("2026-01-01T00:00:00Z"),
  deployments: 0,
  factoryCalls: 1,
  callsComplete: true,
  funder: null,
  pulledAt: null,
  ...over,
});

function reset(over: Partial<typeof s> = {}) {
  Object.assign(s, { ours: null, pairs: [], marketsDown: false, isToken: false, origin: null, profile: null, launches: { launches: [], complete: true }, asked: [], pad: null, padGiven: undefined }, over);
}

describe("Launcher", () => {
  it("hands a PROVEN launchpad to the origin, and nothing for an unknown one or an unread record", async () => {
    const proven = { kind: "proven", id: "basepad", name: "basepad.si", address: "0xad60Fe9e5601500449c7d0a87908636a0920307F", how: "x", guarantees: [], launcher: WALLET };
    reset({ isToken: true, origin: { via: null, launcher: launcher() }, pad: proven });
    await launcherReport(TOKEN, NOW);
    expect(s.padGiven).toBe(proven);
    reset({ isToken: true, origin: { via: null, launcher: launcher() }, pad: { kind: "unknown" } });
    await launcherReport(TOKEN, NOW);
    expect(s.padGiven).toBeNull();
    reset({ isToken: true, origin: { via: null, launcher: launcher() } });
    await launcherReport(TOKEN, NOW);
    expect(s.padGiven).toBeNull();
  });

  it("is red on a red line, amber on an amber one, and says no red flags otherwise", () => {
    expect(reputationRow([row("a", "b", { tone: "bad" })]).tone).toBe("bad");
    expect(reputationRow([row("a", "b", { tone: "warn" })]).tone).toBe("warn");
    expect(reputationRow([row("a", "b")])).toEqual(row("Reputation", "No red flags found", { tone: "ok" }));
  });

  it("asks this app's launchpad first for one of its coins", async () => {
    const origin: Origin = { via: { address: WALLET, name: "Quadra's launchpad" }, launcher: launcher({ factoryCalls: 2 }) };
    reset({ ours: { factory: WALLET, creator: WALLET, creatorRecipient: WALLET }, origin, launches: { launches: [{}, {}], complete: true } });
    const r = await launcherReport(TOKEN, NOW);
    expect(s.asked).toEqual(["launchpadOrigin"]);
    expect(r.title).toBe(`Launcher — of ${TOKEN}`);
    expect(r.rows.find((x) => x.label === "Token")!.href).toBe(`https://basescan.org/token/${TOKEN}`);
    expect(r.rows.find((x) => x.label === "On Quadra's launchpad")!.value).toBe("2 launches");
  });

  it("finds any other token's launcher from its launch, and says a liquidity pull in red", async () => {
    reset({ pairs: [{}], origin: { via: null, launcher: launcher({ pulledAt: new Date("2026-10-01T00:00:00Z") }) }, launches: { launches: [{}], complete: false } });
    const r = await launcherReport(TOKEN, NOW);
    expect(s.asked).toEqual(["originOf"]);
    expect(r.rows[0]!.tone).toBe("bad");
    expect(r.rows.find((x) => x.label === "On Quadra's launchpad")!.value).toBe("1+ launch");
    // a token DexScreener does not list is still a token when its contract answers
    reset({ marketsDown: true, isToken: true, origin: null });
    expect((await launcherReport(TOKEN, NOW)).rows.find((x) => x.label === "Launched by")!.value).toBe("not checked — no launch transaction on record");
    // a launch through a bundler names no launcher, so there is no record to look up here
    reset({ pairs: [{}], origin: { via: { address: WALLET, name: "Clanker" }, launcher: null } });
    expect((await launcherReport(TOKEN, NOW)).rows.find((x) => x.label === "On Quadra's launchpad")).toBeUndefined();
  });

  it("reads a wallet as its own launcher, and says when its launches here could not be read", async () => {
    reset({ profile: launcher(), launches: null });
    const r = await launcherReport(WALLET, NOW);
    expect(s.asked).toEqual(["launcherProfile"]);
    expect(r.title).toBe(`Launcher — ${WALLET}`);
    expect(r.rows.find((x) => x.label === "Wallet")!.href).toBe(`https://basescan.org/address/${WALLET}`);
    expect(r.rows.find((x) => x.label === "On Quadra's launchpad")).toMatchObject({ tone: "warn", value: "not checked — its launches could not be read" });
    reset({ profile: launcher() });
    expect((await launcherSkill.run([WALLET])).rows.find((x) => x.label === "On Quadra's launchpad")!.value).toBe("0 launches");
  });
});
