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

describe("the launchpad index and its cron, in production", () => {
  const never = (() => Promise.reject(new Error("must not be called"))) as unknown as typeof fetch;
  const blob = { get: async () => null, put: async () => undefined };

  it("is a named 503 without a Blob store", async () => {
    const res = await routes({}, never, blob).launchpad(new Request("https://x/api/launchpad/coins", { headers: { "x-quadra": "1" } }));
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/BLOB_READ_WRITE_TOKEN/);
    expect((await routes({ BLOB_READ_WRITE_TOKEN: "t" }, never, null).launchpad(new Request("https://x/api/launchpad/coins"))).status).toBe(503);
  });

  it("takes a store connected through Vercel's OIDC (a store id, no token), and passes no token then", async () => {
    const seen: unknown[] = [];
    const watching = { get: async (_: string, o: unknown) => (seen.push(o), null), put: async () => undefined };
    const rpc = async () => Promise.reject(new Error("node down"));
    const res = await routes({ BLOB_STORE_ID: "store_1" }, never, watching, { rpc }).launchpad(new Request("https://x/api/launchpad/coins", { headers: { "x-quadra": "1" } }));
    expect(res.status).toBe(502);
    expect(seen).toEqual([{ access: "private", useCache: false }]);
  });

  it("reads the stored index with the store's token, public when the owner says so", async () => {
    const seen: unknown[] = [];
    const watching = { get: async (_: string, o: unknown) => (seen.push(o), null), put: async () => undefined };
    const rpc = async () => Promise.reject(new Error("node down"));
    const r = routes({ BLOB_READ_WRITE_TOKEN: "tok", BLOB_ACCESS: "public" }, never, watching, { rpc });
    const res = await r.launchpad(new Request("https://x/api/launchpad/coins", { headers: { "x-quadra": "1" } }));
    expect(res.status).toBe(502);
    expect(seen).toEqual([{ access: "public", useCache: false, token: "tok" }]);
  });

  it("runs the cron's step only for Vercel Cron when a secret is set, and as the index's own request", async () => {
    const rpc = async () => Promise.reject(new Error("node down"));
    const r = routes({ BLOB_READ_WRITE_TOKEN: "tok", CRON_SECRET: "s" }, never, blob, { rpc });
    expect((await r.cron(new Request("https://x/api/cron/index"))).status).toBe(401);
    expect((await r.cron(new Request("https://x/api/cron/index", { headers: { authorization: "Bearer s" } }))).status).toBe(502);
    // without a secret set, the cron route runs for anyone (Vercel sends it only when CRON_SECRET exists)
    expect((await routes({}, never, blob).cron(new Request("https://x/api/cron/index"))).status).toBe(503);
  });
});
