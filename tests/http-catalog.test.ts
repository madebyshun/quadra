import { describe, expect, it, vi } from "vitest";
import {
  HttpCatalog,
  NO_FORWARDER,
  NO_WALLET,
  parseFields,
  parsePrice,
  parseTool,
  parseTools,
} from "@/adapters/http/catalog";
import type { Catalog } from "@/adapters/types";
import { BLUEAGENT } from "@/config/upstream";
import { USDC, WETH } from "@/config/chain";
import { USDC_DOMAIN } from "@/lib/eip712";

/**
 * The real catalog, against the bodies production actually sends.
 *
 * Every fixture below is a trimmed copy of a response measured on 2026-09-27, not
 * an invented shape — including the awkward ones: the 501 an unlisted id answers, the
 * six ids that answer 200 `free: true`, and the 402 that names its asset by address
 * and never says how many decimals it has.
 *
 * `fetch` is stubbed rather than reached. A test that hit the network would pass or
 * fail on upstream's uptime, and the point here is the parsing.
 */

/** As `GET /api/catalog` sends it, with three of the 115 tools kept. */
const CATALOG = {
  count: 115,
  network: "eip155:8453",
  payTo: "0x02950ad38ada1d599375bd447e080cd404809205",
  tools: [
    {
      id: "token-price",
      name: "Token Price",
      description: "Live price, mcap, volume and liquidity for any Base token (DexScreener).",
      price: "$0.01",
      priceUsdcUnits: 10000,
      input: {
        type: "object",
        properties: { token: { type: "string", description: "Token address or ticker" } },
        required: ["token"],
      },
    },
    {
      id: "pool-scan",
      name: "Pool Scan",
      description: "Trending + newly-active Base pools with the chain TVL snapshot.",
      price: "$0.02",
      priceUsdcUnits: 20000,
      input: { type: "object", properties: { limit: { type: "number" } }, required: [] },
    },
    {
      id: "gas-tracker",
      name: "Gas Tracker",
      description: "Base gas price now, and what a swap costs at it.",
      price: "$0.005",
      priceUsdcUnits: 5000,
      input: { type: "object", properties: {}, required: [] },
    },
  ],
};

/** `GET /api/x402/token-price` → 402. */
const PAID = {
  x402Version: 2,
  error: "Payment Required",
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      asset: USDC.address,
      amount: "10000",
      payTo: BLUEAGENT.knownPayTo,
      maxTimeoutSeconds: 120,
      extra: { name: "USD Coin", version: "2" },
    },
  ],
  tool: { id: "token-price", price: "$0.01" },
};

/** `GET /api/x402/hood-live` → 200. Six ids answer this way. */
const FREE = {
  x402Version: 2,
  free: true,
  price: "$0.00",
  hint: "Free — no payment, no wallet, no X-PAYMENT header. POST JSON to this URL to run it.",
  tool: { id: "hood-live" },
};

/**
 * `GET /api/x402/honeypot` → 501. Note the hint contradicts the catalog: `honeypot`
 * is absent from all 115 ids it returns (the live id is `honeypot-check`, which quotes
 * 402). An unlisted id is exactly what reaches this path.
 */
const GONE = {
  error: "Tool temporarily unavailable — you were not charged.",
  code: "TOOL_UNAVAILABLE",
  tool: "honeypot",
  hint: "This tool id exists in the public catalog but is not currently implemented. Do not retry; the catalog listing will be removed shortly.",
};

type Answer = { status?: number; body: unknown };

/** Stub `fetch` to answer everything the same way, and record where it was asked. */
function answering(answer: Answer): { urls: string[] } {
  const urls: string[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    urls.push(String(url));
    expect(init?.headers).toEqual({ accept: "application/json" });
    return Promise.resolve({
      status: answer.status ?? 200,
      json: () => Promise.resolve(answer.body),
    });
  });
  return { urls };
}

describe("reading the catalog", () => {
  it("asks the published catalog url, and nothing else", async () => {
    const seen = answering({ body: CATALOG });
    await new HttpCatalog().tools();
    expect(seen.urls).toEqual([BLUEAGENT.catalog]);
  });

  it("returns every tool upstream lists", async () => {
    answering({ body: CATALOG });
    const tools = await new HttpCatalog().tools();
    expect(tools.map((t) => t.id)).toEqual(["token-price", "pool-scan", "gas-tracker"]);
  });

  it("takes upstream's own wording for the title and the summary", async () => {
    answering({ body: CATALOG });
    const [first] = await new HttpCatalog().tools();
    expect(first?.title).toBe("Token Price");
    expect(first?.summary).toMatch(/DexScreener/);
  });

  /**
   * The reason `Tool` carries no price. Upstream sends `priceUsdcUnits` right there
   * in the catalog, and it would be the easy thing to display — but the panel must
   * show the number off the live 402, which is the document a payer signs against.
   * A price that arrived with the list is a price that can go stale between the
   * list and the click.
   */
  it("drops the price upstream ships with the list, so the quote is the only price", async () => {
    answering({ body: CATALOG });
    const [first] = await new HttpCatalog().tools();
    expect(first).not.toHaveProperty("price");
    expect(first).not.toHaveProperty("priceUsdcUnits");
  });

  /**
   * The fix for a measured defect, not a preference. Upstream lists `token-price`
   * first and its six $0.00 ids at 2, 3, 4, 83, 87 and 88, so a faithful copy of its
   * ordering opened the x402 window on a paid tool whose button can never be clicked,
   * with the four runnable ids buried in a list of 115.
   */
  it("puts the tools that cost nothing first, so the panel opens on a runnable one", async () => {
    answering({
      body: {
        tools: [
          ...CATALOG.tools,
          { id: "hood-live", name: "Hood Live", description: "Board snapshot.", priceUsdcUnits: 0 },
          { id: "blue-doctor", name: "Doctor", description: "Diagnostics.", priceUsdcUnits: 0 },
        ],
      },
    });
    const tools = await new HttpCatalog().tools();
    expect(tools.map((t) => t.id)).toEqual([
      "hood-live",
      "blue-doctor",
      "token-price",
      "pool-scan",
      "gas-tracker",
    ]);
  });

  /**
   * Stable, which is what makes reordering acceptable at all: upstream's declaration
   * order is the order its docs read in, and it survives inside each half.
   */
  it("keeps upstream's order within the free half and within the paid half", async () => {
    answering({
      body: {
        tools: [
          { id: "b-free", name: "B", description: "y", priceUsdcUnits: 0 },
          { id: "a-paid", name: "A", description: "y", priceUsdcUnits: 10000 },
          { id: "a-free", name: "A", description: "y", priceUsdcUnits: 0 },
          { id: "b-paid", name: "B", description: "y", priceUsdcUnits: 20000 },
        ],
      },
    });
    const tools = await new HttpCatalog().tools();
    expect(tools.map((t) => t.id)).toEqual(["b-free", "a-free", "a-paid", "b-paid"]);
  });

  /**
   * Sorting reads `priceUsdcUnits`, so it is worth pinning that a tool which forgot to
   * send one is not promoted. Free is the claim that needs evidence — an absent or
   * malformed price sorts with the ids that want money, where a wrong guess costs the
   * user a disabled button rather than a surprise.
   */
  it("treats a price it cannot read as paid, not as free", async () => {
    answering({
      body: {
        tools: [
          { id: "no-price", name: "N", description: "y" },
          { id: "text-price", name: "T", description: "y", priceUsdcUnits: "0" },
          { id: "really-free", name: "R", description: "y", priceUsdcUnits: 0 },
        ],
      },
    });
    const tools = await new HttpCatalog().tools();
    expect(tools.map((t) => t.id)).toEqual(["really-free", "no-price", "text-price"]);
  });

  it("says so when the catalog does not answer 200", async () => {
    answering({ status: 503, body: {} });
    await expect(new HttpCatalog().tools()).rejects.toThrow(/answered 503/);
  });

  it("refuses a body with no tools array rather than showing an empty catalog", async () => {
    answering({ body: { count: 115 } });
    await expect(new HttpCatalog().tools()).rejects.toThrow("without a `tools` array");
  });

  it("propagates a network failure instead of falling back to the stub", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    await expect(new HttpCatalog().tools()).rejects.toThrow("offline");
  });
});

describe("input fields", () => {
  it("keeps upstream's declaration order, so the form reads like its docs", () => {
    const fields = parseFields({
      properties: { chain: {}, address: {}, depth: {} },
      required: ["address"],
    });
    expect(fields.map((f) => f.name)).toEqual(["chain", "address", "depth"]);
  });

  /**
   * 66 of the 115 tools have at least one optional field. Marking them all required
   * would make the majority of the catalog unrunnable — see the `ToolField` note.
   */
  it("marks only the fields upstream requires", () => {
    const fields = parseFields({ properties: { token: {}, limit: {} }, required: ["token"] });
    expect(fields).toEqual([
      { name: "token", required: true },
      { name: "limit", required: false },
    ]);
  });

  it("handles the ten tools that take no input at all", () => {
    expect(parseFields({ type: "object", properties: {}, required: [] })).toEqual([]);
  });

  it("treats a missing schema as no fields, not as an error", () => {
    expect(parseFields(undefined)).toEqual([]);
    expect(parseFields({})).toEqual([]);
  });

  it("ignores a required entry that is not a field name", () => {
    const fields = parseFields({ properties: { token: {} }, required: [7, "token"] });
    expect(fields).toEqual([{ name: "token", required: true }]);
  });

  it("refuses a schema that is not an object", () => {
    expect(() => parseFields("token")).toThrow("not a JSON object");
    expect(() => parseFields({ properties: [] })).toThrow("not a JSON object");
  });
});

describe("a malformed tool", () => {
  it("names which field was missing", () => {
    expect(() => parseTool({ name: "X", description: "y" })).toThrow("no tool id");
    expect(() => parseTool({ id: "x", description: "y" })).toThrow("no tool name");
    expect(() => parseTool({ id: "x", name: "X" })).toThrow("no tool description");
  });

  it("rejects an empty string as hard as a missing one", () => {
    expect(() => parseTool({ id: "", name: "X", description: "y" })).toThrow("no tool id");
  });

  it("rejects a tool that is not an object", () => {
    expect(() => parseTools({ tools: ["token-price"] })).toThrow("not a JSON object");
  });
});

describe("quoting against a live 402", () => {
  it("asks the tool's own url", async () => {
    const seen = answering({ status: 402, body: PAID });
    await new HttpCatalog().quote("token-price");
    expect(seen.urls).toEqual([BLUEAGENT.tool("token-price")]);
  });

  it("escapes the id, so a tool name cannot reach another path", async () => {
    const seen = answering({ status: 402, body: PAID });
    await new HttpCatalog().quote("token-price");
    expect(seen.urls[0]).toBe("https://blueagent.dev/api/x402/token-price");
  });

  it("reads the price and the payee off the response", async () => {
    answering({ status: 402, body: PAID });
    const quote = await new HttpCatalog().quote("token-price");
    if (quote.price.kind !== "paid") throw new Error("expected a paid quote");
    expect(quote.price.requirements.value).toBe(10_000n);
    expect(quote.price.requirements.payee.address).toBe(BLUEAGENT.knownPayTo);
    expect(quote.price.requirements.payee.kind).toBe("known");
  });

  /**
   * The three fields this parser used to throw away, now on the struct it returns.
   *
   * Worth its own test because the old shape made them unreachable rather than wrong:
   * `scheme`, `extra` and `maxTimeoutSeconds` were read off the wire and dropped, so no
   * downstream check could have looked at them however careful it was. `lifetimeSeconds`
   * is the one with a number attached — 120 from upstream, where this build's own
   * fallback said 600.
   */
  it("keeps the settlement window and the domain upstream named, instead of dropping them", async () => {
    answering({ status: 402, body: PAID });
    const quote = await new HttpCatalog().quote("token-price");
    if (quote.price.kind !== "paid") throw new Error("expected a paid quote");
    expect(quote.price.requirements.lifetimeSeconds).toBe(120n);
    expect(quote.price.requirements.domain).toBe(USDC_DOMAIN);
  });

  it("keeps the amount in base units, never a float", async () => {
    answering({ status: 402, body: PAID });
    const quote = await new HttpCatalog().quote("token-price");
    if (quote.price.kind !== "paid") throw new Error("expected a paid quote");
    expect(typeof quote.price.requirements.value).toBe("bigint");
  });

  it("calls a free tool free rather than pricing it at zero", async () => {
    answering({ body: FREE });
    const quote = await new HttpCatalog().quote("hood-live");
    expect(quote.price.kind).toBe("free");
    expect(quote.price).not.toHaveProperty("requirements");
    if (quote.price.kind !== "free") throw new Error("expected a free quote");
    expect(quote.price.why).toMatch(/no payment, no wallet/);
  });

  it("falls back to its own wording when a free answer carries no hint", () => {
    const price = parsePrice("hood-live", 200, { free: true });
    if (price.kind !== "free") throw new Error("expected a free quote");
    expect(price.why).toMatch(/without asking for payment/);
  });

  /**
   * Throws rather than widening `Price`, because a caller holding a `Price` is entitled
   * to assume there is something to pay. It repeats upstream's hint verbatim but does
   * not adopt its claim: the hint insists the id "exists in the public catalog" while
   * the catalog omits it, so the error says only that nothing implements it.
   */
  it("refuses a tool upstream cannot run, and repeats upstream's own reason", async () => {
    answering({ status: 501, body: GONE });
    await expect(new HttpCatalog().quote("honeypot")).rejects.toThrow(
      /Upstream has no working implementation for honeypot: This tool id exists/,
    );
  });

  it("does not claim the id is in the catalog, because that is upstream's stale hint", async () => {
    answering({ status: 501, body: GONE });
    const err = await new HttpCatalog().quote("honeypot").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/honeypot is in the catalog/);
  });

  it("says retrying will not help, because it will not", async () => {
    answering({ status: 501, body: GONE });
    await expect(new HttpCatalog().quote("honeypot")).rejects.toThrow(/retrying will not change/);
  });

  it("catches the unavailable code even if the status is not 501", () => {
    expect(() => parsePrice("honeypot", 200, { code: "TOOL_UNAVAILABLE" })).toThrow(
      /upstream answered 200/,
    );
  });

  it("refuses a 402 that names no way to pay", () => {
    expect(() => parsePrice("token-price", 402, { x402Version: 2 })).toThrow(/named no way to pay/);
    expect(() => parsePrice("token-price", 402, { x402Version: 2, accepts: [] })).toThrow(
      /named no way to pay/,
    );
  });

  /**
   * `parsePrice`'s own refusal, before delegation: the body itself is not an object, so
   * there is no `code`, no `free` and no `accepts` to branch on.
   */
  it("refuses a body that is not an object", () => {
    expect(() => parsePrice("t", 402, "Payment Required")).toThrow("not a JSON object");
  });
});

/**
 * ⚠️ This block used to be sixty lines of field-by-field refusals — a missing payee, a
 * fractional amount, an unverified asset — and every one of them has moved to
 * `tests/requirements.test.ts`, which checks all seven fields instead of the four this
 * file's parser used to read.
 *
 * They are not merely relocated: they were **weaker here**. A refusal asserted through
 * `parsePrice` passes whether the check lives in this module or three modules down, so
 * the old tests could not distinguish "this file checks the asset" from "something
 * eventually does" — which is exactly how a second copy of the rule survived in
 * `KNOWN_ASSETS` next to the real one. What is left below is the one statement only
 * this file can make: that it delegates at all, and that upstream's refusal reaches a
 * caller intact rather than being caught and turned into a price.
 */
describe("what a paid quote delegates", () => {
  const withAccept = (patch: Record<string, unknown>) => ({
    ...PAID,
    accepts: [{ ...PAID.accepts[0], ...patch }],
  });

  it("hands the body to the requirements checker instead of reading fields itself", () => {
    expect(() => parsePrice("token-price", 402, withAccept({ asset: WETH.address }))).toThrow(
      /verified the decimals of exactly one asset/,
    );
  });

  /**
   * The refusal reaches the caller through `quote`, not only through `parsePrice`.
   * A checker whose throw were swallowed by the fetch path would be a checker that
   * runs and has no effect.
   */
  it("lets the refusal out through quote, so a bad 402 cannot become a price", async () => {
    answering({ status: 402, body: withAccept({ network: "eip155:1" }) });
    await expect(new HttpCatalog().quote("token-price")).rejects.toThrow(
      /signs only for Base \(8453\)/,
    );
  });

  /** Names the tool, because the error surfaces in a window that shows several. */
  it("names the tool in the refusal", () => {
    expect(() => parsePrice("blue-audit", 402, withAccept({ scheme: "upto" }))).toThrow(
      /^blue-audit wants to be paid under/,
    );
  });
});

describe("running a tool", () => {
  /**
   * Called through `Catalog` rather than the class, because the panel only ever holds
   * the interface. Going through it is also a check that the class still satisfies it.
   */
  const asCatalog = (): Catalog => new HttpCatalog();

  type Posted = { url: string; init: RequestInit };

  /**
   * A separate stub from `answering`, because a run is a different request in every
   * respect: POST not GET, a JSON body, and a `text()` response rather than `json()`.
   * `run` reads text on purpose — a missing forwarder answers 200 with HTML, and
   * `res.json()` would throw a parse error instead of letting that case be named.
   */
  function posting(answer: { status?: number; text: string }): Posted[] {
    const sent: Posted[] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      sent.push({ url: String(url), init });
      return Promise.resolve({
        status: answer.status ?? 200,
        text: () => Promise.resolve(answer.text),
      });
    });
    return sent;
  }

  /** As `POST /api/x402/hood-live` really answers, trimmed. */
  const RAN = { tool: "hood-live", rows: [{ ticker: "NVDAc", oracle: 181.42 }] };

  /**
   * The request goes to this origin, not to upstream's. That is the whole fix: POST
   * cross-origin is blocked (measured 2026-09-27 — no `access-control-allow-origin` on
   * either the POST or its preflight), and a same-origin path forwarded by the dev
   * server removes the question rather than answering it.
   */
  it("posts to the forwarder on this origin, never to upstream directly", async () => {
    const sent = posting({ text: JSON.stringify(RAN) });
    await asCatalog().run("hood-live", {});
    expect(sent[0]?.url).toBe("/upstream/api/x402/hood-live");
    expect(sent[0]?.url).not.toContain(BLUEAGENT.base);
    expect(sent[0]?.init.method).toBe("POST");
  });

  it("sends the filled-in inputs as the body", async () => {
    const sent = posting({ text: JSON.stringify(RAN) });
    await asCatalog().run("token-price", { token: "0xabc" });
    expect(sent[0]?.init.body).toBe('{"token":"0xabc"}');
  });

  it("returns upstream's own answer, not a summary of it", async () => {
    posting({ text: JSON.stringify(RAN) });
    const run = await asCatalog().run("hood-live", {});
    expect(run.output).toBe(JSON.stringify(RAN, null, 2));
    expect(run.toolId).toBe("hood-live");
  });

  /**
   * `free`, and never `settled`. A 200 with no `X-PAYMENT` sent is the evidence that
   * upstream answered without being paid; no transaction exists, so `Settlement` has
   * no hash field on this variant to fill in wrongly.
   */
  it("reports a free run as free, because nothing settled", async () => {
    posting({ text: JSON.stringify(RAN) });
    const run = await asCatalog().run("hood-live", {});
    expect(run.settlement).toEqual({
      kind: "free",
      why: "upstream answered this without asking for payment",
    });
  });

  /**
   * The reason a paid run stops is now genuinely the wallet — CORS was the reason
   * until the forwarder landed, and keeping that wording would have sent the next
   * reader looking for a header problem that no longer exists.
   */
  it("names the signature it cannot produce, not a header problem", () => {
    expect(NO_WALLET).toMatch(/signing a USDC authorization/);
    expect(NO_WALLET).toMatch(/Nothing was charged/);
    expect(NO_WALLET).not.toMatch(/CORS/);
  });

  it("refuses a 402, and says nothing was charged", async () => {
    posting({ status: 402, text: JSON.stringify(PAID) });
    await expect(asCatalog().run("token-price", {})).rejects.toThrow(
      `token-price was not run. ${NO_WALLET}`,
    );
  });

  /**
   * The case a static build hits, and the reason the check is on the body rather than
   * the status. MEASURED 2026-09-27 against this repo's own `dist/`: a plain static
   * host answers 501 with an HTML error page, a host doing SPA rewrites answers 200
   * with `index.html`. Both are asserted here because a status check would pass one of
   * them straight through and print a web page as though a tool had answered.
   */
  it("names the absent forwarder when the body is not json, whatever the status", async () => {
    posting({ text: "<!doctype html><title>Quadra</title>" });
    await expect(asCatalog().run("hood-live", {})).rejects.toThrow(NO_FORWARDER);

    posting({ status: 501, text: "<html><body><h1>Error response</h1></body></html>" });
    await expect(asCatalog().run("hood-live", {})).rejects.toThrow(NO_FORWARDER);
  });

  /**
   * MEASURED 2026-09-27, and found by the measure script rather than reasoned about: a
   * free id with a required field answers `{"error":"Provide \`contract\` — 42-char hex
   * address"}`. That sentence names the blank field and the status number does not, so
   * repeating it is the difference between a usable error and a shrug.
   */
  it("repeats upstream's own reason for refusing, because the status does not name the field", async () => {
    posting({ status: 400, text: JSON.stringify({ error: "Provide `contract` — 42-char hex address" }) });
    await expect(asCatalog().run("rh-token-scan", {})).rejects.toThrow(
      "rh-token-scan did not run, and you were not charged. Upstream answered 400: Provide `contract` — 42-char hex address",
    );
  });

  /** A `hint` is the other key upstream has been seen to use, on a 501. */
  it("takes the reason from a hint when there is no error field", async () => {
    posting({ status: 501, text: JSON.stringify({ hint: "not currently implemented" }) });
    await expect(asCatalog().run("honeypot", {})).rejects.toThrow(
      "Upstream answered 501: not currently implemented",
    );
  });

  it("says so plainly when upstream refuses without giving a reason", async () => {
    posting({ status: 500, text: JSON.stringify({ ok: false }) });
    await expect(asCatalog().run("hood-live", {})).rejects.toThrow(
      "hood-live did not run, and you were not charged. Upstream answered 500 and gave no reason.",
    );
  });

  /**
   * Every JSON shape that is valid and still carries nothing to quote. The body is
   * untrusted — it is whatever a failing host sent — so looking for `error` on it must
   * not depend on it being an object with keys. An empty `error` counts as nothing
   * rather than being repeated as a blank reason.
   */
  it.each([
    ["null", "null"],
    ["an array", "[]"],
    ["a bare number", "42"],
    ["an empty error string", JSON.stringify({ error: "" })],
  ])("finds no reason in %s, and does not pretend to", async (_what, text) => {
    posting({ status: 500, text });
    await expect(asCatalog().run("hood-live", {})).rejects.toThrow("gave no reason");
  });

  /**
   * Per price, not per adapter. With the forwarder in place the six $0.00 ids really
   * do run while the other 109 cannot, so a single flag for the whole catalog would
   * have to be wrong about one half of it — either refusing free tools over a wallet
   * they never wanted, or offering paid ones a run that can only throw.
   */
  it("blocks the button for a paid price and allows it for a free one", () => {
    const catalog = new HttpCatalog();
    expect(catalog.whyNot({ kind: "free", why: "no payment" })).toBeNull();
    expect(catalog.whyNot(parsePrice("token-price", 402, PAID))).toBe(NO_WALLET);
  });

  /**
   * ⚠️ Two independent reasons, and the missing wallet is named first because it is the
   * one that goes away.
   *
   * Signing lands and `NO_WALLET` disappears; a payee upstream rotated does not. If the
   * payee note were first it would read as the headline today and as a leftover
   * afterwards, so this asserts the ORDER and not merely that both strings appear. Both
   * do have to appear: reporting only the wallet would hide the durable problem behind
   * the temporary one, and reporting only the payee would tell a user to fix upstream
   * when this window cannot pay anybody yet.
   */
  it("reports an unrecognised payee as well as the missing wallet, in that order", () => {
    const rotated = parsePrice("token-price", 402, {
      ...PAID,
      accepts: [{ ...PAID.accepts[0], payTo: WETH.address }],
    });
    const why = new HttpCatalog().whyNot(rotated);
    expect(why).toContain(NO_WALLET);
    expect(why).toMatch(/second problem/);
    expect(why?.indexOf(NO_WALLET)).toBe(0);
  });

  /**
   * `isLive` is about settlement, not about whether the read was real. Quoting here
   * is genuinely live; no money has ever moved. A catalog that reported live because
   * its GETs work would let an unpaid run render as paid.
   */
  it("is not live, even though its reads are", () => {
    expect(new HttpCatalog().isLive).toBe(false);
  });
});
