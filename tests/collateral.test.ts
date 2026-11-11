import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { AAVE_V4, FEED_ABI, ORACLE_ABI } from "@/config/collateral";
import {
  AGREE,
  collateralReport,
  collateralRows,
  collateralSkill,
  liquidationPrice,
  marketShut,
  mathAt,
  snapshot,
  type Position,
  type Snapshot,
} from "@/skills/collateral";
import { findSkill } from "@/skills/index";
import TWO from "./fixtures/collateral/two-stocks.json";
import EMPTY from "./fixtures/collateral/empty.json";
import { basenames, DOWN, net, RpcError, useNet, type Answer } from "./net";

useNet();

/**
 * Collateral Watch against two REAL wallets, captured 2026-11-11 from Base (every eth_call the
 * skill made, keyed by destination and calldata, and DexScreener's answer):
 *   - 0x9A30…A646 borrows USDC on Aave V4's MAG7 spoke against GOOGLc and NVDAc;
 *   - 0x92c0…0000 has nothing there.
 * The numbers asserted were read off the chain first (`getUserAccountData`'s health 1.479…).
 */

type Fixture = { wallet: string; calls: Record<string, string | { error: string }>; gets: Record<string, unknown> };

function chain(fx: Fixture, change: { rpc?: (to: string, data: `0x${string}`) => Answer | undefined; get?: (url: string) => Answer | undefined } = {}) {
  return net({
    rpc: (method, params) => {
      if (method !== "eth_call") return undefined;
      const { to, data } = params[0] as { to: string; data: `0x${string}` };
      const changed = change.rpc?.(to.toLowerCase(), data);
      if (changed !== undefined) return changed;
      // the chain's own refusals were captured too (USDC's capped feed reverts latestRoundData)
      const real = fx.calls[`${to.toLowerCase()} ${data}`];
      return typeof real === "object" ? new RpcError(real.error) : real;
    },
    get: (url) => change.get?.(url) ?? fx.gets[url],
  });
}

// a Thursday 18:00 UTC (open) and a Sunday 22:00 UTC (shut)
const OPEN = Date.UTC(2026, 10, 12, 18, 0);
const SUNDAY = Date.UTC(2026, 10, 15, 22, 0);
const fn = (data: `0x${string}`, abi: typeof ORACLE_ABI | typeof FEED_ABI) => {
  try {
    return decodeFunctionData({ abi, data }).functionName;
  } catch {
    return null;
  }
};

describe("reading a wallet's positions", () => {
  it("reads GOOGLc and NVDAc against a USDC borrow, with the spoke's own health factor", async () => {
    chain(TWO);
    const s = await snapshot(TWO.wallet);
    expect(s.positions.map((p) => [p.symbol, p.collateral, p.factor])).toEqual([
      ["GOOGLc", true, 7600],
      ["NVDAc", true, 7000],
      ["USDC", false, 0],
    ]);
    expect(Number(s.health) / 1e18).toBeCloseTo(1.48, 2);
    expect(s.positions[0]!.feed).toMatchObject({ name: "Coinbase GOOGL", updatedAt: expect.any(Number) });
    expect(s.dex?.size).toBe(2);
    // the recomputed factor agrees with the spoke's — the inputs are the spoke's
    expect(Math.abs(mathAt(s.positions).health - Number(s.health) / 1e18)).toBeLessThan(AGREE);
  });

  it("reads a wallet with nothing there without asking the oracle anything", async () => {
    const calls = chain(EMPTY);
    const s = await snapshot(EMPTY.wallet);
    expect(s).toMatchObject({ health: null, positions: [] });
    expect(calls.some((c) => c.url.includes("dexscreener"))).toBe(false);
    expect((await collateralReport(EMPTY.wallet, OPEN)).rows.map((r) => r.value)).toContain("no stock supplied and nothing borrowed");
  });

  it("keeps going when a token's symbol, a feed or DexScreener cannot be read — each said, none dropped", async () => {
    const oracle = AAVE_V4.oracle.toLowerCase();
    chain(TWO, {
      rpc: (to, data) => {
        if (to === "0xb2000000000000000000002d0ba3164cc74f58b7") return new RpcError("execution reverted");
        if (to === oracle && fn(data, ORACLE_ABI) === "getReserveSource" && data.endsWith("5")) return new RpcError("execution reverted");
        if (fn(data, FEED_ABI) === "description" || fn(data, FEED_ABI) === "latestRoundData") return new RpcError("execution reverted");
        return undefined;
      },
      get: () => DOWN,
    });
    const s = await snapshot(TWO.wallet);
    expect(s.positions[0]!.symbol).toBe("0xb200…58B7");
    expect(s.positions[1]!.feed).toBeNull();
    expect(s.positions[0]!.feed).toMatchObject({ name: null, updatedAt: null });
    expect(s.dex).toBeNull();
    const rows = collateralRows(s, OPEN).rows;
    expect(rows.filter((r) => r.label.startsWith("Price feed")).map((r) => r.value)).toEqual([
      "not checked — the feed behind Aave's price could not be read",
      "not checked — the feed behind Aave's price could not be read",
    ]);
    expect(rows.find((r) => r.label === "At Base DEX prices")).toMatchObject({ tone: "warn", value: "not checked — DexScreener could not be reached" });
  });
});

describe("the report", () => {
  it("names each stock's liquidation price, its feed, and the DEX scenario", async () => {
    chain(TWO);
    const r = await collateralReport(TWO.wallet, OPEN);
    const by = (label: string) => r.rows.find((x) => x.label === label)!;
    expect(r.title).toBe("0x9A30…A646 — Collateral Watch");
    expect(by("Health factor")).toMatchObject({ tone: "ok", value: "1.48 — liquidated below 1.00" });
    expect(by("Borrowed · USDC").value).toMatch(/^74,513\.\d\d USDC \(\$74,4\d\d\.\d\d\)$/);
    expect(by("Supplied · NVDAc").value).toMatch(/^564\.9\d NVDAc · \$99,\d{3}\.\d\d at Aave's price · counts 70% as collateral$/);
    expect(by("Liquidation · NVDAc")).toMatchObject({ tone: "ok", value: expect.stringMatching(/^\$86\.\d\d — 51\.\d% below Aave's \$176\.80 \(other holdings unchanged\)$/) });
    expect(by("Price feed · NVDAc")).toMatchObject({ value: expect.stringMatching(/^Coinbase NVDA, last set 2026-11-11 17:01 UTC \(\d+ h ago\)$/) });
    expect(by("Price feed · NVDAc").tone).toBeUndefined();
    expect(by("At Base's DEX prices")).toMatchObject({ tone: "ok", value: expect.stringMatching(/^health 1\.48 \(now 1\.48\) — GOOGLc \$294\.\d\d \([+-]\d\.\d% vs Aave\), NVDAc \$176\.\d\d \(-0\.1% vs Aave\)$/) });
    expect(by("Morpho").tone).toBe("warn");
    expect(r.notes).toHaveLength(2);
  });

  it("on a Sunday says the feed is frozen and asks what a reopening at Base's prices would do", async () => {
    chain(TWO);
    const r = await collateralReport(TWO.wallet, SUNDAY);
    expect(r.rows.find((x) => x.label === "Price feed · NVDAc")).toMatchObject({ tone: "warn", value: expect.stringMatching(/the US market is shut, so this price stays until it reopens$/) });
    expect(r.rows.some((x) => x.label === "If the market reopened at Base's prices")).toBe(true);
    expect(r.notes).toHaveLength(3);
  });

  it("is reached as `collateral`, `liquidation` and `loans`", () => {
    expect(findSkill("collateral")).toBe(collateralSkill);
    expect(findSkill("liquidation")).toBe(collateralSkill);
    expect(findSkill("loans")).toBe(collateralSkill);
  });

  it("reads a Basename's wallet and names it in the title", async () => {
    const resolver = "0x0000000000000000000000000000000000000abc";
    const names = basenames({ resolver, forward: { "nobody.base.eth": EMPTY.wallet } });
    const book = new Map(Object.entries(names).map(([a, h]) => [a.toLowerCase(), h]));
    chain(EMPTY, { rpc: (to, data) => book.get(to)?.(data) });
    const r = await collateralReport("nobody.base.eth", OPEN);
    expect(r.title).toBe("nobody.base.eth — Collateral Watch");
    expect(r.rows[0]!.value).toBe("nobody.base.eth (0x92C0000000000000000000000000000000000000)");
  });

  it("leaves out a DEX market with no token named, and says a stock DexScreener does not list", async () => {
    const url = Object.keys(TWO.gets)[0]!;
    const only = ((TWO.gets as Record<string, unknown>)[url] as { baseToken: { address: string } }[]).filter((m) => m.baseToken.address.toLowerCase().endsWith("f58b7"));
    chain(TWO, { get: (u) => (u === url ? [...only, { ...only[0], baseToken: {} }] : undefined) });
    const r = await collateralReport(TWO.wallet, OPEN);
    expect(r.rows.find((x) => x.label === "At Base's DEX prices")!.value).toMatch(/NVDAc has no DEX price$/);
  });

  it("runs from its arguments, and refuses an empty one", async () => {
    chain(EMPTY);
    expect((await collateralSkill.run([EMPTY.wallet])).title).toMatch(/Collateral Watch$/);
    await expect(collateralSkill.run([])).rejects.toThrow(/Wallet/);
  });
});

// ── the arithmetic, on positions written out so each branch can be reached ──

const stock = (symbol: string, supplied: bigint, price: number, factor: number, extra: Partial<Position> = {}): Position => ({
  reserve: 0,
  token: `0x${symbol.padEnd(40, "0")}`.slice(0, 42),
  symbol,
  decimals: 8,
  supplied,
  debt: 0n,
  collateral: true,
  price: BigInt(Math.round(price * 1e8)),
  factor,
  feed: { address: "0x0000000000000000000000000000000000000001", name: null, updatedAt: 1_793_000_000 },
  ...extra,
});
const usdcDebt = (amount: number): Position => ({ ...stock("usdc", 0n, 1, 0), symbol: "USDC", decimals: 6, debt: BigInt(amount * 1e6), collateral: false });
const snap = (positions: Position[], health: number | null, dex: Snapshot["dex"] = new Map()): Snapshot => ({
  user: "0x0000000000000000000000000000000000000002",
  via: null,
  health: health === null ? null : BigInt(Math.round(health * 1e6)) * 10n ** 12n,
  positions,
  dex,
});

describe("the arithmetic", () => {
  it("finds the price that takes the health factor to 1, the others held", () => {
    const a = stock("aaa", 100n * 10n ** 8n, 100, 7000);
    const b = stock("bbb", 10n * 10n ** 8n, 50, 5000);
    const all = [a, b, usdcDebt(5000)];
    // 100×100×0.7 + 10×50×0.5 = 7,250 against 5,000
    expect(mathAt(all).health).toBeCloseTo(1.45, 10);
    expect(liquidationPrice(all, a)).toBeCloseTo((5000 - 250) / 70, 10);
    // b alone cannot cover the debt: at 0 the position is still sound
    expect(liquidationPrice(all, b)).toBe(0);
    expect(liquidationPrice([a], a)).toBeNull();
    expect(mathAt([a]).health).toBe(Infinity);
  });

  it("knows when the US market is shut, by UTC", () => {
    expect(marketShut(Date.UTC(2026, 10, 14, 15))).toBe(true); // Saturday
    expect(marketShut(Date.UTC(2026, 10, 16, 13, 29))).toBe(true); // Monday before the open
    expect(marketShut(Date.UTC(2026, 10, 16, 13, 30))).toBe(false);
    expect(marketShut(Date.UTC(2026, 10, 16, 20, 0))).toBe(true);
  });

  it("colours a thin position, one that can be liquidated, and one with no debt", () => {
    const a = stock("aaa", 100n * 10n ** 8n, 100, 7000);
    const thin = collateralRows(snap([a, usdcDebt(6800)], 6800 / 7000 > 0 ? 7000 / 6800 : 0), OPEN).rows;
    expect(thin.find((r) => r.label === "Health factor")!.tone).toBe("bad");
    expect(thin.find((r) => r.label === "Liquidation · aaa")!.tone).toBe("bad");
    const warn = collateralRows(snap([a, usdcDebt(6000)], 7000 / 6000), OPEN).rows;
    expect(warn.find((r) => r.label === "Health factor")!.tone).toBe("warn");
    expect(warn.find((r) => r.label === "Liquidation · aaa")!.tone).toBe("warn");
    const under = collateralRows(snap([a, usdcDebt(8000)], 7000 / 8000), OPEN).rows;
    expect(under.find((r) => r.label === "Liquidation · aaa")!.value).toBe("at or above Aave's $100.00 — the position can be liquidated now");
    const none = collateralRows(snap([a], null), OPEN).rows;
    expect(none.find((r) => r.label === "Health factor")).toMatchObject({ tone: "ok", value: "no debt — nothing can be liquidated" });
    expect(none.some((r) => r.label.startsWith("Liquidation"))).toBe(false);
  });

  it("prints no liquidation price when its own health factor disagrees with the spoke's", () => {
    const a = stock("aaa", 100n * 10n ** 8n, 100, 7000);
    const rows = collateralRows(snap([a, usdcDebt(5000)], 2), OPEN).rows;
    expect(rows.at(-1)).toMatchObject({ label: "Liquidation prices", tone: "warn", value: expect.stringMatching(/^not worked out — this build's health factor \(1\.40\) does not match the spoke's \(2\.00\)/) });
  });

  it("says which stock has no DEX price, and moves the scenario only for those that do", () => {
    const a = stock("aaa", 100n * 10n ** 8n, 100, 7000);
    const b = stock("bbb", 100n * 10n ** 8n, 100, 7000);
    const market = (price: number | null) => ({ priceUsd: price }) as never;
    const none = collateralRows(snap([a, usdcDebt(7000)], 1, new Map([[b.token, market(null)]])), OPEN).rows;
    expect(none.at(-1)).toMatchObject({ label: "At Base DEX prices", tone: "warn", value: "not checked — aaa has no DEX price" });
    const some = collateralRows(snap([a, b, usdcDebt(7000)], 2, new Map([[a.token, market(110)]])), SUNDAY).rows;
    expect(some.at(-1)).toMatchObject({ label: "If the market reopened at Base's prices", tone: "ok", value: "health 2.10 (now 2.00) — aaa $110.00 (+10.0% vs Aave), bbb has no DEX price" });
  });

  it("says a supplied stock that is not collateral, and words a feed set long ago or just now", () => {
    const now = OPEN;
    const off = stock("aaa", 10n ** 8n, 100, 7000, { collateral: false });
    const fresh = stock("bbb", 100n * 10n ** 8n, 100, 7000, { feed: { address: "0x0000000000000000000000000000000000000001", name: "Coinbase BBB", updatedAt: now / 1000 - 600 } });
    const old = stock("ccc", 100n * 10n ** 8n, 100, 7000, { feed: { address: "0x0000000000000000000000000000000000000001", name: null, updatedAt: now / 1000 - 5 * 86400 } });
    const rows = collateralRows(snap([off, fresh, old, usdcDebt(7000)], 2), now).rows;
    expect(rows.find((r) => r.label === "Supplied · aaa")!.value).toMatch(/supplied, NOT used as collateral$/);
    expect(rows.find((r) => r.label === "Price feed · bbb")!.value).toMatch(/\(10 min ago\)$/);
    expect(rows.find((r) => r.label === "Price feed · ccc")!.value).toMatch(/^0x0000…0001, last set .* \(5 days ago\)$/);
  });
});
