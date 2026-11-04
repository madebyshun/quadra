import { describe, expect, it } from "vitest";
import { cdpFrom, routes } from "@/server/vercel";

/** The production server's wiring: the CDP key from the function's environment, both halves or none. */
describe("the production routes", () => {
  it("takes the CDP key only when both halves are set", () => {
    expect(cdpFrom({})).toBeNull();
    expect(cdpFrom({ CDP_API_KEY_ID: "id" })).toBeNull();
    expect(cdpFrom({ CDP_API_KEY_SECRET: "s" })).toBeNull();
    expect(cdpFrom({ CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "s" })).toEqual({ keyId: "id", secret: "s" });
  });

  it("serves stocks, charts and the paid API — the paid one a named 503 without a key", async () => {
    const never = (() => Promise.reject(new Error("must not be called"))) as unknown as typeof fetch;
    const r = routes({}, never);
    expect((await r.stocks(new Request("https://x/api/stocks/base"))).status).toBe(403);
    expect((await r.charts(new Request("https://x/api/charts/ohlcv"))).status).toBe(403);
    const paid = await r.skills(new Request("https://x/api/skills/verdict?arg=0x1"));
    expect(paid.status).toBe(503);
    expect(await paid.text()).toMatch(/CDP_API_KEY_ID/);
    // with a key, the paid API answers 402 (asks to be paid), never 503
    const keyed = routes({ CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "s" }, never);
    expect((await keyed.skills(new Request("https://x/api/skills/verdict?arg=0xb200000000000000000000d096efba9896ab0816"))).status).toBe(402);
  });
});
