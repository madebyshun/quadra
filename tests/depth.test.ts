import { describe, expect, it } from "vitest";
import { depthReport, depthSkill, LOUD, parseQuote, SIZES, TOKEN_PAIRS } from "@/skills/depth";
import { findSkill } from "@/skills/index";
import NVDAC from "./fixtures/depth/nvdac.json";
import PDDC from "./fixtures/depth/pddc.json";
import { DOWN, json, net, useNet, type Answer } from "./net";

useNet();

/**
 * Trade Depth against REAL answers captured 2026-11-12: Relay's six quotes for NVDAc ($1k/$10k/$100k
 * each way), DexScreener's pools for it, and the token's own reads. PDDc's capture is the same
 * request answered by Relay's rate limit ("Could not process request") — kept as it came.
 */

type Fixture = { token: string; calls: Record<string, string>; gets: Record<string, unknown>; relay: { request: { originCurrency: string; amount: string }; status: number; body: unknown }[] };

function chain(fx: Fixture, change: { relay?: (i: number, body: unknown) => Answer; get?: Answer } = {}) {
  let i = 0;
  return net({
    rpc: (method, params) => {
      if (method !== "eth_call") return undefined;
      const { to, data } = params[0] as { to: string; data: string };
      return fx.calls[`${to.toLowerCase()} ${data}`];
    },
    get: (url) => (change.get !== undefined && url.startsWith(TOKEN_PAIRS) ? change.get : fx.gets[url]),
    post: (url) => {
      if (!url.endsWith("/quote")) return undefined;
      const k = i++;
      const real = fx.relay[k]!;
      const body = change.relay ? change.relay(k, real.body) : real.body;
      return real.status === 200 ? body : json(body, real.status);
    },
  });
}

const fx = NVDAC as unknown as Fixture;

describe("Trade Depth", () => {
  it("prices three sizes each way for NVDAc, every one under 2%, and lists its pools", async () => {
    chain(fx);
    const r = await depthReport(fx.token);
    expect(r.title).toBe("NVDAc — Trade Depth");
    expect(r.rows[0]).toMatchObject({ label: "Depth", tone: "ok", value: `No size here moves the price more than ${LOUD}%` });
    expect(r.rows.filter((x) => /^(Buy|Sell) /.test(x.label)).map((x) => x.label)).toEqual(["Buy $1,000", "Buy $10,000", "Buy $100,000", "Sell $1,000", "Sell $10,000", "Sell $100,000"]);
    expect(r.rows.find((x) => x.label === "Buy $100,000")).toMatchObject({ tone: "ok", value: "0.13% impact (0.28% with fees) · 564.1514 NVDAc" });
    expect(r.rows.find((x) => x.label === "Sell $100,000")!.value).toBe("0.33% impact (0.48% with fees) · $99,566.84 in USDC");
    expect(r.rows.find((x) => x.label === "Pool · Aerodrome Slipstream vs USDC")!.value).toBe("$1,791,445.19 liquidity");
    expect(r.rows.filter((x) => x.label.startsWith("Pool ·"))).toHaveLength(4);
  });

  it("asks for exactly the sizes it names: $1k/$10k/$100k of USDC in, and the token's worth of each out", () => {
    expect(fx.relay.slice(0, 3).map((q) => q.request.amount)).toEqual(SIZES.map((s) => String(s * 1e6)));
    expect(fx.relay.slice(3).every((q) => q.request.originCurrency === fx.token)).toBe(true);
  });

  it("paints a size past 2% red and names it at the top — a capture with its impact raised, visibly", async () => {
    chain(fx, { relay: (i, body) => (i === 2 ? { ...(body as object), details: { ...(body as { details: object }).details, swapImpact: { percent: "-7.5" } } } : body) });
    const r = await depthReport(fx.token);
    expect(r.rows[0]).toMatchObject({ tone: "bad", value: "Thin — buy $100,000 moves the price more than 2%" });
    expect(r.rows.find((x) => x.label === "Buy $100,000")).toMatchObject({ tone: "bad", value: expect.stringMatching(/^7\.50% impact/) });
  });

  it("colours a middling impact amber, and an impact Relay did not give as not given", async () => {
    chain(fx, {
      relay: (i, body) => {
        const d = (body as { details: Record<string, unknown> }).details;
        if (i === 0) return { ...(body as object), details: { ...d, swapImpact: { percent: "1.1" } } };
        if (i === 1) return { ...(body as object), details: { ...d, swapImpact: null, totalImpact: { percent: "x" } } };
        return body;
      },
    });
    const r = await depthReport(fx.token);
    expect(r.rows.find((x) => x.label === "Buy $1,000")!.tone).toBe("warn");
    expect(r.rows.find((x) => x.label === "Buy $10,000")).toMatchObject({ tone: "warn", value: expect.stringMatching(/^not given impact \(not given with fees\)/) });
    expect(r.rows[0]!.tone).toBe("warn");
  });

  it("says each size Relay refused, in Relay's words, and that nothing was checked", async () => {
    chain(PDDC as unknown as Fixture);
    const r = await depthReport(PDDC.token);
    expect(r.rows[0]).toMatchObject({ tone: "warn", value: "not checked — no size could be quoted" });
    expect(r.rows.find((x) => x.label === "Sell $10,000")!.value).toBe("not quoted — Relay: Could not process request. Please try again later..");
  });

  it("reads Relay's 'impact is too high' as the worst measurement, red — never as not quoted (MEASURED on PDDc)", async () => {
    chain(fx, { relay: (i, body) => (i === 2 ? json({ message: "Swap impact is too high: -74.28%" }, 400) : body) });
    const r = await depthReport(fx.token);
    expect(r.rows.find((x) => x.label === "Buy $100,000")).toMatchObject({ tone: "bad", value: "74.28% impact — too much for the pools; Relay will not route it" });
    expect(r.rows[0]).toMatchObject({ tone: "bad", value: "Thin — buy $100,000 moves the price more than 2%" });
  });

  it("never says no size moves the price while a size went unquoted", async () => {
    chain(fx, { relay: (i, body) => (i === 5 ? json({ message: "Could not process request. Please try again later." }, 500) : body) });
    const r = await depthReport(fx.token);
    expect(r.rows[0]).toMatchObject({ tone: "warn", value: "No quoted size moves the price more than 2% — sell $100,000 not quoted" });
  });

  it("cannot size a sell without a market price, and says when DexScreener is down or lists nothing", async () => {
    chain(fx, { get: DOWN });
    const down = await depthReport(fx.token);
    expect(down.rows.find((x) => x.label === "Sell $1,000")!.value).toBe("not quoted — no market price to size the sell from");
    expect(down.rows.find((x) => x.label === "Pools")!.value).toBe("not checked — DexScreener could not be reached");
    chain(fx, { get: [] });
    expect((await depthReport(fx.token)).rows.find((x) => x.label === "Pools")!.value).toBe("none listed on Base");
  });

  it("names a pool with no liquidity figure, an unknown DEX by its id, and a pool with no page", async () => {
    const [first] = (fx.gets[`${TOKEN_PAIRS}/${fx.token}`] as Record<string, unknown>[])!;
    chain(fx, { get: [{ ...first, dexId: "equalizer", liquidity: undefined, url: undefined }, { ...first, baseToken: { address: "0x0000000000000000000000000000000000000001" } }] });
    const r = await depthReport(fx.token);
    expect(r.rows.find((x) => x.label === "Pool · equalizer vs USDC")).toEqual({ label: "Pool · equalizer vs USDC", value: "liquidity not reported" });
    expect(r.rows.filter((x) => x.label.startsWith("Pool ·"))).toHaveLength(1);
  });

  it("reads Relay's quote for its amount out, and refuses one without", () => {
    expect(parseQuote({ details: { currencyOut: { amount: "12" }, swapImpact: { percent: "-0.5" } } })).toEqual({ out: 12n, swapImpact: -0.5, totalImpact: null });
    expect(() => parseQuote({ details: { currencyOut: { amount: "1.5" } } })).toThrow(/no amount out/);
    expect(() => parseQuote(null)).toThrow(/no amount out/);
  });

  it("is reached as `depth`, `impact` and `slippage`, and refuses a token that is not an address", async () => {
    expect(findSkill("impact")).toBe(depthSkill);
    expect(findSkill("slippage")).toBe(depthSkill);
    await expect(depthSkill.run([])).rejects.toThrow(/Token/);
  });
});
