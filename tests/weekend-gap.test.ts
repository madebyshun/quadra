import { describe, expect, it, vi } from "vitest";
import { SCORECARD, tickerOf, WEEKENDS, worstGap, worstGaps } from "@/skills/weekendGap";
import { weekendHandler, WEEKEND_PATH } from "@/server/weekend";
import SC_NVDA from "./fixtures/weekend/scorecard-NVDA.json";
import SC_AAPL from "./fixtures/weekend/scorecard-AAPL.json";
import { json, net, useNet } from "./net";

useNet();

/** Blue Agent's per-ticker weekend record, as it answered on 2026-11-13 (POST {ticker, weekends: 52}). */

describe("the worst weekend on record", () => {
  it("is the most negative open gap — NVDA's −5.13% on the weekend of Nov 6, over 11 graded weekends", () => {
    expect(worstGap(SC_NVDA, "NVDA")).toEqual({ pct: -5.1313, friday: "2026-11-06", weekends: 11 });
    expect(worstGap(SC_AAPL, "AAPL")).toEqual({ pct: -1.4858, friday: "2026-10-30", weekends: 11 });
  });

  it("is nothing for a ticker never graded, one that only ever went up, or a body that is not a record", () => {
    expect(worstGap(SC_NVDA, "TSLA")).toBeNull();
    expect(worstGap({ weekends: [{ friday: "x", rows: [{ ticker: "UP", open_gap_pct: 2 }, { ticker: "UP", open_gap_pct: null }, "junk"] }] }, "UP")).toBeNull();
    expect(worstGap(null, "NVDA")).toBeNull();
    expect(worstGap({ weekends: [{ rows: [{ ticker: "Z", open_gap_pct: -1 }] }] }, "Z")).toEqual({ pct: -1, friday: "?", weekends: 1 });
  });

  it("names a Coinbase stock by its ticker, and no other symbol", () => {
    expect(tickerOf("NVDAc")).toBe("NVDA");
    expect(tickerOf("USDC")).toBeNull();
    expect(tickerOf("cbBTC")).toBeNull();
  });
});

describe("reading the record", () => {
  it("in a page, asks this app's route once per ticker; a refusal is not checked", async () => {
    const calls = net({ get: (url) => (url === `/api/weekend/scorecard?ticker=NVDA&weekends=${WEEKENDS}` ? SC_NVDA : url.includes("ticker=AAPL") ? json({}, 502) : undefined) });
    const gaps = await worstGaps(["NVDAc", "AAPLc", "NVDAc", "USDC"]);
    expect([...gaps]).toEqual([
      ["NVDAc", { pct: -5.1313, friday: "2026-11-06", weekends: 11 }],
      ["AAPLc", null],
    ]);
    expect(calls).toHaveLength(2);
  });

  it("with no page (MCP, the paid API), asks Blue Agent directly", async () => {
    vi.stubGlobal("document", undefined);
    const asked: unknown[] = [];
    net({ post: (url, body) => (url === SCORECARD ? (asked.push(body), SC_AAPL) : undefined) });
    expect((await worstGaps(["AAPLc"])).get("AAPLc")).toMatchObject({ pct: -1.4858 });
    expect(asked).toEqual([{ ticker: "AAPL", weekends: WEEKENDS }]);
  });
});

describe("the route's parameters", () => {
  const ask = (q: string) => new Request(`https://quadra.test${WEEKEND_PATH}/${q}`, { headers: { "x-quadra": "1" } });

  it("puts a checked ticker and number of weekends in the body, and caches each question on its own", async () => {
    const upstream = vi.fn(async (_url: string, init?: RequestInit) => json({ asked: JSON.parse(String(init!.body)) }));
    const handle = weekendHandler(upstream as unknown as typeof fetch);
    expect(await (await handle(ask("scorecard?ticker=NVDA&weekends=52"))).json()).toEqual({ asked: { ticker: "NVDA", weekends: 52 } });
    expect(await (await handle(ask("scorecard?ticker=AAPL"))).json()).toEqual({ asked: { ticker: "AAPL" } });
    await handle(ask("scorecard?ticker=NVDA&weekends=52"));
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("refuses a ticker or a count of the wrong shape, and either on the diary", async () => {
    const handle = weekendHandler(vi.fn() as unknown as typeof fetch);
    for (const q of ["scorecard?ticker=nvda", "scorecard?ticker=TOOLONGX", "scorecard?weekends=0", "scorecard?weekends=105", "scorecard?weekends=1e3", "diary?ticker=NVDA", "diary?weekends=5"]) {
      expect((await handle(ask(q))).status, q).toBe(400);
    }
  });
});
