import { describe, expect, it } from "vitest";
import { UNISWAP_V4_POOL_MANAGER } from "@/config/chain";
import { toChecksumAddress } from "@/lib/address";
import { short } from "@/skills/format";
import { analyze, forensicRows, forensics, forensicsSkill, operators, parseLogs, verdictOf, WINDOW, type Findings, type Wallet } from "@/skills/forensics";
import { FX_VAMP, VAMP, VAMP_LAUNCH_BLOCK } from "./fixtures/forensics";
import { DOWN, net, useNet, type Answer } from "./net";

useNet();

/**
 * Launch Forensics against a REAL launch, VAMP, captured an hour after its pool opened. The
 * findings asserted here were measured on it before the code was written (forensics.ts header).
 */

const PM = UNISWAP_V4_POOL_MANAGER.toLowerCase();
const POOLS = new Set([PM]);
const SUPPLY = BigInt(FX_VAMP.reads.token["0x18160ddd" as keyof typeof FX_VAMP.reads.token]);
const logs = parseLogs(FX_VAMP.transfers);
const found = analyze(logs, POOLS, VAMP_LAUNCH_BLOCK);
const CREATED = FX_VAMP.dex[0]!.pairCreatedAt;

describe("reading a launch's transfers", () => {
  it("reads every captured Transfer log, and skips what is not one", () => {
    expect(logs).toHaveLength(FX_VAMP.transfers.length);
    expect(logs[0]).toMatchObject({ block: VAMP_LAUNCH_BLOCK, from: "0x0000000000000000000000000000000000000000" });
    const [real] = FX_VAMP.transfers;
    expect(parseLogs(["junk", { ...real, topics: [real!.topics[0]] }, { ...real, blockNumber: "soon" }, { ...real, blockNumber: undefined }, { ...real, data: "0x" }])).toEqual([
      expect.objectContaining({ value: 0n }),
    ]);
    expect(parseLogs(null)).toEqual([]);
  });

  it("finds the buys by net balance change, the spray, and who holds at the window's end", () => {
    // the capture is the first 60 blocks: 19 buyers by then
    expect(found.buys.length).toBeGreaterThan(10);
    expect(found.buys.every((b) => b.buyer !== PM && b.amount > 0n)).toBe(true);
    // MEASURED: one transaction sent the token to 101 addresses
    expect(found.sprays).toEqual([expect.objectContaining({ recipients: 101 })]);
    // MEASURED: the token's own contract held 96.8% at the hour's end
    expect(found.holders![0]!.address).toBe(VAMP.toLowerCase());
    expect(Number((found.holders![0]!.amount * 10000n) / SUPPLY) / 100).toBeCloseTo(96.79, 2);
    // without the mint in the window, earlier balances are unknown — and said so, not guessed
    expect(analyze(logs.slice(1), POOLS, VAMP_LAUNCH_BLOCK).holders).toBeNull();
  });
});

const A = `0x${"a".repeat(40)}`;
const B = `0x${"b".repeat(40)}`;
const C = `0x${"c".repeat(40)}`;
const D = `0x${"d".repeat(40)}`;
const E = `0x${"e".repeat(40)}`;
const wallet = (address: string, over: Partial<Wallet> = {}): Wallet => ({ address, nonce: 10, delegate: null, codeTag: null, holds: 0n, ...over });

describe("judging what was found", () => {
  it("groups the first buyers by a shared delegate or the same code, and needs two to call it one operator", () => {
    expect(operators([wallet("0x1", { delegate: "0xD" }), wallet("0x2", { delegate: "0xD" }), wallet("0x3")])).toEqual({ by: "delegate 0xD", count: 2 });
    expect(operators([wallet("0x1", { codeTag: "0x6080" }), wallet("0x2", { codeTag: "0x6080" })])).toEqual({ by: "contract code 0x6080", count: 2 });
    expect(operators([wallet("0x1", { delegate: "0xD" }), wallet("0x2")])).toBeNull();
  });

  it("writes every line, with its tone, from the real launch and from variants of it", () => {
    const farm = Array.from({ length: 6 }, (_, i) => wallet(`0x${i}`, { delegate: "0x54c68ba673d5521f8cfc17b73e523e86190e230a", nonce: i, holds: SUPPLY / 100n }));
    const rows = forensicRows(found, farm, SUPPLY, "VAMP", VAMP);
    const by = (l: string) => rows.find((r) => r.label === l)!;
    expect(by("Held outside the pool")).toMatchObject({ tone: "warn", value: expect.stringMatching(/^largest 96\.\d+% — the token's own contract/) });
    expect(by("Sprayed").value).toContain("up to 101");
    expect(by("One operator")).toMatchObject({ tone: "bad", value: "6 of the first 6 buyers share an EIP-7702 delegate, 0x54c6…230a" });
    expect(by("Fresh wallets")).toMatchObject({ tone: "warn", value: "6 of the first 6 buyers have sent 5 transactions or fewer" });
    expect(by("Early buyers hold now")).toMatchObject({ tone: "ok", value: expect.stringMatching(/^6% of the supply/) });
    expect(by("Buyer 1").value).toMatch(/· \+\d+ blocks · /);
    expect(verdictOf(rows).tone).toBe("bad");

    // variants: a snipe, a single big holder that is a wallet, nothing found, nothing read
    const sniped: Findings = { launchBlock: 1, buys: [{ block: 2, tx: "0x1", buyer: A, amount: SUPPLY / 4n }], holders: [{ address: B, amount: SUPPLY / 4n }], sprays: [] };
    const s = forensicRows(sniped, [wallet(A, { nonce: null, delegate: undefined, codeTag: undefined, holds: null })], SUPPLY, "X", VAMP);
    expect(s.find((r) => r.label === "Sniped")).toMatchObject({ tone: "bad", value: "25% of the supply bought within 2 blocks of launch" });
    expect(s.find((r) => r.label === "Held outside the pool")).toMatchObject({ tone: "bad", value: `largest 25% — ${short(toChecksumAddress(B))} — at the hour's end` });
    expect(s.find((r) => r.label === "One operator")).toMatchObject({ tone: "warn", value: "not checked — the buyers' code could not be read" });
    expect(s.find((r) => r.label === "Fresh wallets")).toBeUndefined();
    expect(s.find((r) => r.label === "Early buyers hold now")).toBeUndefined();
    const quiet: Findings = { launchBlock: 1, buys: [], holders: [], sprays: [] };
    const q = forensicRows(quiet, [], SUPPLY, "X", VAMP);
    expect(q.map((r) => [r.label, r.value])).toEqual([
      ["Sniped", "no buy through a pool in the window"],
      ["Held outside the pool", "nothing at the hour's end — the supply is in the pool"],
      ["One operator", "no buyers to compare"],
    ]);
    expect(verdictOf(q)).toMatchObject({ tone: "ok", value: "No red flags found in the first hour" });
    const some: Findings = { ...quiet, buys: [{ block: 50, tx: "0x2", buyer: C, amount: SUPPLY / 1000n }], holders: [{ address: D, amount: SUPPLY / 20n }, { address: E, amount: 1n }] };
    const m = forensicRows(some, [wallet(C)], SUPPLY, "X", VAMP);
    expect(m.find((r) => r.label === "Held outside the pool")!.value).toBe(`largest 5% — ${short(toChecksumAddress(D))}; then <0.01% — at the hour's end`);
    expect(m.find((r) => r.label === "One operator")!.value).toBe("no shared delegate or contract among the first buyers");

    // the amber middles: a 10% snipe, two sprays, a small shared-code cluster, early buyers still holding 15% or 30%
    const middle: Findings = {
      launchBlock: 1,
      buys: [{ block: 1, tx: "0x3", buyer: A, amount: SUPPLY / 10n }],
      holders: [],
      sprays: [{ tx: "0x4", recipients: 30 }, { tx: "0x5", recipients: 40 }],
    };
    const nine = [wallet(A, { codeTag: "0x6080", holds: (SUPPLY * 15n) / 100n }), wallet(B, { codeTag: "0x6080" }), ...[C, D, E].map((x) => wallet(x)), ...[1, 2, 3, 4].map((i) => wallet(`0x${String(i).repeat(40)}`))];
    const mid = forensicRows(middle, nine, SUPPLY, "X", VAMP);
    expect(mid.find((r) => r.label === "Sniped")!.tone).toBe("warn");
    expect(mid.find((r) => r.label === "Sprayed")!.value).toMatch(/^2 transactions sent X to 20\+ addresses at once \(up to 40\)/);
    expect(mid.find((r) => r.label === "One operator")).toMatchObject({ tone: "warn", value: "2 of the first 9 buyers share the same contract code" });
    expect(mid.find((r) => r.label === "Early buyers hold now")!.tone).toBe("warn");
    expect(forensicRows(middle, [wallet(A, { holds: (SUPPLY * 30n) / 100n })], SUPPLY, "X", VAMP).find((r) => r.label === "Early buyers hold now")!.tone).toBe("bad");
    // a supply of nothing measures every share as nothing, not as a division error
    expect(forensicRows(quiet, [], 0n, "X", VAMP)[0]!.value).toBe("no buy through a pool in the window");
  });
});

/** The chain and DexScreener as captured, answering the skill end to end. */
function routes(over: { dex?: Answer; logs?: Answer; token?: Record<string, string> } = {}) {
  const r = FX_VAMP.reads;
  return {
    get: (u: string) => (u === `https://api.dexscreener.com/tokens/v1/base/${VAMP}` ? (over.dex ?? FX_VAMP.dex) : undefined),
    rpc: (m: string, p: readonly unknown[]): Answer | undefined => {
      const call = p[0] as { to?: string; data?: string } | string;
      if (m === "eth_blockNumber") return `0x${r.latestBlock.toString(16)}`;
      if (m === "eth_getLogs") return over.logs ?? FX_VAMP.transfers;
      const w = typeof call === "string" ? r.wallets[call.toLowerCase() as keyof typeof r.wallets] : undefined;
      if (m === "eth_getTransactionCount") return w?.nonce;
      if (m === "eth_getCode") return w?.code;
      if (m !== "eth_call" || typeof call === "string") return undefined;
      if (call.data!.startsWith("0x70a08231")) return r.wallets[`0x${call.data!.slice(34)}` as keyof typeof r.wallets]?.balance ?? `0x${"0".repeat(64)}`;
      return (over.token ?? r.token)[call.data as keyof typeof r.token];
    },
  };
}

describe("the skill", () => {
  it("reads a real launch end to end and finds the operator", async () => {
    net(routes());
    const report = await forensics(VAMP, CREATED + 60 * 60_000);
    expect(report.title).toBe("VAMP — Launch Forensics");
    const by = (l: string) => report.rows.find((r) => r.label === l)!;
    expect(by("Launch").tone).toBe("bad");
    expect(by("Window").value).toMatch(new RegExp(`^${WINDOW} blocks \\(~60 min\\) from block 52,073,\\d{3}, pool on uniswap vs \\w+ — \\d+ buys$`));
    // MEASURED: all but one of the first buyers delegate to the same contract
    expect(by("One operator")).toMatchObject({ tone: "bad", value: expect.stringMatching(/^1[89] of the first 19 buyers share an EIP-7702 delegate, 0x54c6…230A$/) });
    expect(report.sources).toEqual(["Base (Transfer logs on the archive node, wallet code and nonces, balances)", "DexScreener (the pool and its creation time)"]);
  });

  it("refuses a token with no pool, or no readable supply, and says why", async () => {
    net(routes({ dex: [] }));
    await expect(forensics(VAMP, CREATED)).rejects.toThrow(`${VAMP} has no pool on record — there is no launch to read.`);
    net(routes({ token: { ...FX_VAMP.reads.token, "0x18160ddd": `0x${"0".repeat(64)}` } }));
    await expect(forensics(VAMP, CREATED)).rejects.toThrow("supply could not be read");
    net(routes({ dex: DOWN }));
    await expect(forensics(VAMP, CREATED)).rejects.toThrow();
  });

  it("reads a v2/v3 pool's own address as a pool, a wallet whose code did not come as unread, and runs as a skill", async () => {
    const dex = [{ ...FX_VAMP.dex[0]!, pairAddress: "0x1111111111111111111111111111111111111111" }];
    const r = routes({ dex });
    const first = Object.keys(FX_VAMP.reads.wallets)[0]!;
    net({ get: r.get, rpc: (m, p) => (m === "eth_getCode" && p[0] === first ? DOWN : m === "eth_getCode" ? "0x" : r.rpc(m, p)) });
    const report = await forensics(VAMP, CREATED);
    expect(report.rows.find((x) => x.label === "One operator")!.value).toBe("no shared delegate or contract among the first buyers");
    net(routes());
    expect((await forensicsSkill.run([VAMP])).title).toBe("VAMP — Launch Forensics");
  });

  it("starts from the first transfer when nothing has left a pool yet", async () => {
    // the window's mint and hand-outs only: no buys
    const quiet = FX_VAMP.transfers.slice(0, 3);
    net(routes({ logs: quiet }));
    const report = await forensics(VAMP, CREATED);
    expect(report.rows.find((r) => r.label === "Sniped")!.value).toBe("no buy through a pool in the window");
    net(routes({ logs: [] }));
    expect((await forensics(VAMP, CREATED)).rows.find((r) => r.label === "Window")!.value).toContain("— 0 buys");
  });
});
