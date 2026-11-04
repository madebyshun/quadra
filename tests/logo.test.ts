import { describe, expect, it, vi } from "vitest";
import { imageOf, logoHandler, LOGO_PATH, MAX_LOGO_BYTES } from "@/server/logo";

/** A token's logo, read from this origin for the share card: DexScreener names it, its CDN serves it. */
const TOKEN = "0x6F18277E5566090Ad8Ab35e401ce9155739BFb07";
const IMG = "https://cdn.dexscreener.com/cms/images/cjuJIwCpXI4T__g0?width=800&height=800&quality=95&format=auto";
const ask = (path = `/${TOKEN}`, init: RequestInit = { headers: { "x-quadra": "1" } }) => new Request(`http://localhost${LOGO_PATH}${path}`, init);
const pairs = (url: unknown = IMG) => new Response(JSON.stringify({ pairs: [{ info: {} }, { info: { imageUrl: url } }] }), { status: 200 });
const png = (bytes = 3, type = "image/png") => new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": type } });

describe("the logo route", () => {
  it("names DexScreener's CDN image at 256 px, and nothing from anywhere else", () => {
    expect(imageOf({ pairs: [{ info: { imageUrl: IMG } }] })).toBe("https://cdn.dexscreener.com/cms/images/cjuJIwCpXI4T__g0?width=256&height=256&format=png");
    expect(imageOf({ pairs: [{ info: { imageUrl: "https://evil.example/x.png" } }, null, 3] })).toBeNull();
    expect(imageOf({})).toBeNull();
    expect(imageOf(null)).toBeNull();
  });

  it("answers the picture's bytes, cached for a day", async () => {
    const f = vi.fn().mockResolvedValueOnce(pairs()).mockResolvedValueOnce(png());
    const r = await logoHandler(f)(ask());
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("cache-control")).toBe("max-age=86400");
    expect((await r.arrayBuffer()).byteLength).toBe(3);
    expect(f.mock.calls[0]![0]).toBe(`https://api.dexscreener.com/latest/dex/tokens/${TOKEN}`);
  });

  it("refuses anything but a GET for one address with the header, and says why it has no picture", async () => {
    const f = vi.fn();
    expect((await logoHandler(f)(ask(`/${TOKEN}`, {}))).status).toBe(403);
    expect((await logoHandler(f)(ask(`/${TOKEN}`, { method: "POST", headers: { "x-quadra": "1" } }))).status).toBe(405);
    expect((await logoHandler(f)(ask("/../../etc"))).status).toBe(404);
    expect(f).not.toHaveBeenCalled();
    expect((await logoHandler(vi.fn().mockResolvedValue(pairs(null)))(ask())).status).toBe(404);
    expect((await logoHandler(vi.fn().mockResolvedValue(new Response("", { status: 429 })))(ask())).status).toBe(404);
    expect((await logoHandler(vi.fn().mockResolvedValueOnce(pairs()).mockResolvedValueOnce(png(3, "text/html")))(ask())).status).toBe(502);
    expect((await logoHandler(vi.fn().mockResolvedValueOnce(pairs()).mockResolvedValueOnce(new Response(new Uint8Array(3), { status: 200 })))(ask())).status).toBe(502);
    expect((await logoHandler(vi.fn().mockResolvedValueOnce(pairs()).mockResolvedValueOnce(png(MAX_LOGO_BYTES + 1)))(ask())).status).toBe(502);
    expect((await logoHandler(vi.fn().mockRejectedValue(new Error("down")))(ask())).status).toBe(502);
  });
});
