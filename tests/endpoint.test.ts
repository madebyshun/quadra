import { describe, expect, it, vi } from "vitest";
import { noRoute, parseEndpoint, payEndpoint, quoteEndpoint, type EndpointQuote } from "@/adapters/http/endpoint";
import { authorizationFor, type PaymentRequirements } from "@/lib/requirements";
import { paymentSignatureHeader } from "@/lib/payment";
import { PAYMENT_REQUIRED, PAYMENT_RESPONSE, PAYMENT_SIGNATURE, toBase64Utf8 } from "@/lib/x402http";
import { FORWARD_PATH, FORWARD_REQUEST_HEADER, FORWARDED_MARK, FORWARDED_VALUE } from "@/server/forward";

/** Measured 2026-09-29 — see `tests/x402http.test.ts` for where it came from. */
const REQUIRED = {
  x402Version: 2,
  error: "Payment required",
  resource: { url: "https://x402uselessfacts.vercel.app/api/useless-fact", mimeType: "application/json" },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: "1000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: "0xD7d49D6a12Ee3852f29A52A40908069bF4e48914",
      maxTimeoutSeconds: 300,
      extra: { name: "USD Coin", version: "2" },
    },
  ],
};
const URL_ = "https://x402uselessfacts.vercel.app/api/useless-fact";
const ORIGIN = "https://x402uselessfacts.vercel.app";
const PAYEE = REQUIRED.accepts[0]!.payTo;
const pinned = (o: string) => (o === ORIGIN ? PAYEE : null);
const encoded = (v: unknown) => toBase64Utf8(JSON.stringify(v));
const FORWARDED = { [FORWARDED_MARK]: FORWARDED_VALUE };

type Call = { url: string; headers: Headers };

/**
 * A fake network: `direct` answers requests to the real URL (or throws, like a browser
 * refusing a CORS-closed server), `forwarded` answers requests to the forwarder path.
 */
function network(opts: { direct?: Response | "cors"; forwarded?: Response | "down" }) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url.startsWith(FORWARD_PATH)) {
      if (opts.forwarded === undefined || opts.forwarded === "down") throw new TypeError("Failed to fetch");
      return opts.forwarded;
    }
    if (opts.direct === undefined || opts.direct === "cors") throw new TypeError("Failed to fetch");
    return opts.direct;
  });
  return calls;
}

const paid402 = (extra: Record<string, string> = {}) =>
  new Response("{}", { status: 402, headers: { [PAYMENT_REQUIRED]: encoded(REQUIRED), ...extra } });

describe("which URLs it will call", () => {
  it("takes an https URL, trimmed", () => {
    expect(parseEndpoint(`  ${URL_} `).href).toBe(URL_);
  });

  it("refuses what is not a URL, plain http, and credentials, each in its own words", () => {
    expect(() => parseEndpoint("uselessfacts")).toThrow(/is not a URL/);
    expect(() => parseEndpoint("http://a.example/")).toThrow(/Only https endpoints are paid/);
    expect(() => parseEndpoint("https://me:pw@a.example/")).toThrow(/username or password/);
  });
});

describe("quoting", () => {
  it("reads a spec 402 directly when the server answers CORS, and checks it", async () => {
    const calls = network({ direct: paid402() });
    const quote = await quoteEndpoint(URL_, pinned);
    expect(quote.route).toBe("direct");
    expect(quote.origin).toBe(ORIGIN);
    expect(quote.price.kind === "paid" && quote.price.requirements.value).toBe(1000n);
    expect(quote.price.kind === "paid" && quote.price.requirements.payee.kind).toBe("known");
    expect(calls.map((c) => c.url)).toEqual([URL_]);
    expect(calls[0]?.headers.get(FORWARD_REQUEST_HEADER)).toBeNull();
  });

  /** Measured: uselessfacts sends no CORS header, so the browser throws and the forwarder asks. */
  it("goes through the forwarder when the browser refuses the direct read", async () => {
    const calls = network({ direct: "cors", forwarded: paid402(FORWARDED) });
    const quote = await quoteEndpoint(URL_, pinned);
    expect(quote.route).toBe("forwarded");
    expect(calls[1]?.url).toBe(`${FORWARD_PATH}?url=${encodeURIComponent(URL_)}`);
    expect(calls[1]?.headers.get(FORWARD_REQUEST_HEADER)).toBe("1");
  });

  it("reads a BlueAgent-style body when there is no header", async () => {
    network({ direct: new Response(JSON.stringify(REQUIRED), { status: 402 }) });
    const quote = await quoteEndpoint(URL_, pinned);
    expect(quote.price.kind).toBe("paid");
  });

  it("finds no requirements in a 402 whose body is not JSON and that has no header", async () => {
    network({ direct: new Response("Payment Required", { status: 402 }) });
    await expect(quoteEndpoint(URL_, pinned)).rejects.toThrow(/x402 version undefined/);
  });

  it("calls an unpinned payee unpinned — the user confirms it, nothing here does", async () => {
    network({ direct: paid402() });
    const quote = await quoteEndpoint(URL_, () => null);
    expect(quote.price.kind === "paid" && quote.price.requirements.payee.kind).toBe("unpinned");
  });

  it("keeps a free answer, pretty-printed, so it is shown rather than asked for twice", async () => {
    network({ direct: new Response('{"fact":"flamingos"}', { status: 200 }) });
    const quote = await quoteEndpoint(URL_, pinned);
    expect(quote.price.kind).toBe("free");
    expect(quote.answer).toBe('{\n  "fact": "flamingos"\n}');
  });

  it("keeps a free answer that is not JSON exactly as it came", async () => {
    network({ direct: new Response("plain words", { status: 200 }) });
    expect((await quoteEndpoint(URL_, pinned)).answer).toBe("plain words");
  });

  it("repeats the server's own reason for anything else, and says nothing was paid", async () => {
    network({ direct: new Response('{"error":"missing address"}', { status: 400 }) });
    await expect(quoteEndpoint(URL_, pinned)).rejects.toThrow(`${ORIGIN} answered 400: missing address. Nothing was paid.`);
    network({ direct: new Response("", { status: 500 }) });
    await expect(quoteEndpoint(URL_, pinned)).rejects.toThrow("answered 500 and gave no reason. Nothing was paid.");
  });

  it("says there is no route at all when direct is refused and nothing forwards", async () => {
    network({ direct: "cors", forwarded: "down" });
    await expect(quoteEndpoint(URL_, pinned)).rejects.toThrow(noRoute(ORIGIN));
  });

  /** A static host answers the forwarder path with index.html — a 200 that is not a forward. */
  it("does not mistake a static host's page for a forwarder", async () => {
    network({ direct: "cors", forwarded: new Response("<!doctype html>", { status: 200 }) });
    await expect(quoteEndpoint(URL_, pinned)).rejects.toThrow(/no forwarder on this host/);
  });

  it("passes the forwarder's own refusal through with its reason", async () => {
    network({ direct: "cors", forwarded: new Response('{"error":"not on this forwarder\'s list"}', { status: 403, headers: FORWARDED }) });
    await expect(quoteEndpoint(URL_, pinned)).rejects.toThrow(/answered 403: not on this forwarder's list/);
  });
});

describe("paying", () => {
  const FROM = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
  async function quoted(route: "direct" | "forwarded"): Promise<{ quote: EndpointQuote; header: string }> {
    network(route === "direct" ? { direct: paid402() } : { direct: "cors", forwarded: paid402(FORWARDED) });
    const quote = await quoteEndpoint(URL_, pinned);
    const requirements = (quote.price as { requirements: PaymentRequirements }).requirements;
    const { authorization } = authorizationFor(requirements, FROM, 1_800_000_000n, new Uint8Array(32));
    return { quote, header: paymentSignatureHeader(requirements, authorization, `0x${"c".repeat(130)}`) };
  }

  it("sends PAYMENT-SIGNATURE by the route the quote took, and reports the spec settlement", async () => {
    const { quote, header } = await quoted("direct");
    const calls = network({
      direct: new Response('{"fact":"f"}', { status: 200, headers: { [PAYMENT_RESPONSE]: encoded({ success: true, transaction: "0xfeed" }) } }),
    });
    const run = await payEndpoint(quote, header);
    expect(calls[0]?.headers.get(PAYMENT_SIGNATURE)).toBe(header);
    expect(run.output).toBe('{\n  "fact": "f"\n}');
    expect(run.settlement).toEqual({ kind: "settled", txHash: "0xfeed", payTo: PAYEE, amountBaseUnits: 1000n });
  });

  /** A server the quote could not read directly is not tried directly again. */
  it("goes straight to the forwarder when that is how the quote got through", async () => {
    const { quote, header } = await quoted("forwarded");
    const calls = network({ direct: new Response("{}"), forwarded: new Response("{}", { status: 200, headers: FORWARDED }) });
    await payEndpoint(quote, header);
    expect(calls.map((c) => c.url)).toEqual([`${FORWARD_PATH}?url=${encodeURIComponent(URL_)}`]);
    expect(calls[0]?.headers.get(PAYMENT_SIGNATURE)).toBe(header);
  });

  it("says unsettled, not settled, when the answer names no transaction", async () => {
    const { quote, header } = await quoted("direct");
    network({ direct: new Response("{}", { status: 200 }) });
    expect((await payEndpoint(quote, header)).settlement.kind).toBe("unsettled");
  });

  it("reports a refused payment with the spec header's own error, and claims no more than it knows", async () => {
    const { quote, header } = await quoted("direct");
    network({ direct: new Response("{}", { status: 402, headers: { [PAYMENT_REQUIRED]: encoded({ ...REQUIRED, error: "invalid_signature" }) } }) });
    await expect(payEndpoint(quote, header)).rejects.toThrow(
      `${ORIGIN} refused the payment: invalid_signature. It reported no settlement; the authorization you signed expires on its own.`,
    );
  });

  it("falls back to the body's error, then to saying there was none", async () => {
    const { quote, header } = await quoted("direct");
    network({ direct: new Response('{"error":"upstream down"}', { status: 503, headers: { [PAYMENT_REQUIRED]: "%%%" } }) });
    await expect(payEndpoint(quote, header)).rejects.toThrow(/answered 503: upstream down/);
    network({ direct: new Response("[]", { status: 402 }) });
    await expect(payEndpoint(quote, header)).rejects.toThrow(/refused the payment and gave no reason/);
  });
});
