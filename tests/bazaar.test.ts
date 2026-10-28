import { describe, expect, it, vi } from "vitest";
import { BAZAAR, BAZAAR_PAGE, bazaarPage, parseBazaar } from "@/adapters/http/bazaar";
import { FORWARD_PATH, FORWARDED_MARK, FORWARDED_VALUE } from "@/server/forward";

/** The shape measured 2026-09-29 from the discovery API, one item per case under test. */
const EXACT = {
  scheme: "exact",
  network: "eip155:8453",
  amount: "1000",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0xD7d49D6a12Ee3852f29A52A40908069bF4e48914",
  maxTimeoutSeconds: 300,
  extra: { name: "USD Coin", version: "2" },
};
const item = (patch: Record<string, unknown> = {}, input: Record<string, unknown> = { type: "http", method: "GET" }) => ({
  type: "http",
  x402Version: 2,
  resource: "https://x402uselessfacts.vercel.app/api/useless-fact",
  description: "  One useless fact.  ",
  accepts: [EXACT],
  extensions: { bazaar: { info: { input } } },
  ...patch,
});

describe("reading a page of the directory", () => {
  it("lists a payable GET with the server's description, and no price", () => {
    const page = parseBazaar({ items: [item()], pagination: { total: 19106 } });
    expect(page).toEqual({
      listings: [{ url: "https://x402uselessfacts.vercel.app/api/useless-fact", description: "One useless fact." }],
      seen: 1,
      total: 19106,
    });
  });

  it("fills in the server's own example query, without overriding one already in the URL", () => {
    const page = parseBazaar({
      items: [
        item(
          { resource: "https://api.onesource.io/api/chain/erc20-balance?network=base" },
          { type: "http", method: "GET", queryParams: { address: "0xd8da", network: "ethereum", n: 3 } },
        ),
      ],
    });
    expect(page.listings[0]?.url).toBe("https://api.onesource.io/api/chain/erc20-balance?network=base&address=0xd8da");
    expect(page.total).toBeNull();
  });

  it("falls back to the URL when there is no description", () => {
    expect(parseBazaar({ items: [item({ description: 7 })] }).listings[0]?.description).toBe(
      "https://x402uselessfacts.vercel.app/api/useless-fact",
    );
  });

  /** Everything below is left out — each for the reason named. */
  it("leaves out what this build could not call or pay", () => {
    const left = [
      null,
      item({ type: "mcp" }),
      item({ x402Version: 1 }),
      item({}, { type: "http", method: "POST" }),
      item({ extensions: {} }),
      item({ extensions: [] }),
      item({ extensions: { bazaar: { info: {} } } }),
      item({ resource: 7 }),
      item({ resource: "http://plain.example/x" }),
      item({ resource: "https://api.onesource.io/api/chain/tx/:hash" }),
      item({ accepts: [{ ...EXACT, maxTimeoutSeconds: 3600 }] }),
      item({ accepts: [{ ...EXACT, network: "solana:5eykt4" }] }),
    ];
    const page = parseBazaar({ items: left });
    expect(page.listings).toEqual([]);
    expect(page.seen).toBe(left.length);
  });

  it("refuses a body with no item list", () => {
    expect(() => parseBazaar({ items: {} })).toThrow(/without an `items` list/);
    expect(() => parseBazaar(null)).toThrow(/without an `items` list/);
  });
});

describe("fetching it", () => {
  /** Measured: no CORS header, so in a browser the forwarder is the way in. */
  it("asks for one page, through the forwarder when the direct read is refused", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      if (!url.startsWith(FORWARD_PATH)) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ items: [item()] }), { headers: { [FORWARDED_MARK]: FORWARDED_VALUE } });
    });
    const page = await bazaarPage();
    expect(page.listings).toHaveLength(1);
    expect(urls[0]).toBe(`${BAZAAR.resources}?limit=${BAZAAR_PAGE}`);
  });

  it("says what it got when the directory refuses or answers in something else", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    await expect(bazaarPage()).rejects.toThrow("The Bazaar answered 503. Nothing was read, so nothing is listed.");
    vi.stubGlobal("fetch", async () => new Response("<html>", { status: 200 }));
    await expect(bazaarPage()).rejects.toThrow(/not JSON/);
  });
});
