import { describe, expect, it } from "vitest";
import {
  jsonFromBase64,
  LEGACY_PAYMENT_RESPONSE,
  PAYMENT_REQUIRED,
  PAYMENT_RESPONSE,
  readPaymentRequired,
  settledTransaction,
  toBase64Utf8,
} from "@/lib/x402http";
import { checkRequirements, authorizationFor } from "@/lib/requirements";
import { paymentHeader, paymentSignatureHeader } from "@/lib/payment";

/**
 * MEASURED 2026-09-29: `GET https://x402uselessfacts.vercel.app/api/useless-fact`, the
 * `payment-required` header decoded, with only its `extensions` block dropped (a
 * builder-code and a Bazaar schema, neither of which this build reads). The body of that
 * 402 was `{}` — every protocol field lives in this header, as the v2 transport spec says.
 */
const USELESS_FACT = {
  x402Version: 2,
  error: "Payment required",
  resource: {
    url: "https://x402uselessfacts.vercel.app/api/useless-fact",
    description: "Pay a tiny amount of USDC and receive one delightfully useless fact.",
    mimeType: "application/json",
    serviceName: "Useless Fact",
    tags: ["facts", "trivia", "fun", "useless"],
  },
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
} as const;

const ORIGIN = "https://x402uselessfacts.vercel.app";
const PINNED = () => USELESS_FACT.accepts[0].payTo;
const FROM = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const SIGNATURE = `0x${"b".repeat(130)}`;

const encoded = (value: unknown) => toBase64Utf8(JSON.stringify(value));

describe("base64 of UTF-8", () => {
  /** `btoa` alone throws on this; a server's description is allowed to say it. */
  it("round-trips text btoa cannot encode on its own", () => {
    const text = JSON.stringify({ description: "Café — ☕ and 日本" });
    expect(() => btoa(text)).toThrow();
    expect(jsonFromBase64(toBase64Utf8(text), "X")).toEqual(JSON.parse(text));
  });

  it("names the header when it is not base64 at all", () => {
    expect(() => jsonFromBase64("%%%", PAYMENT_REQUIRED)).toThrow(/PAYMENT-REQUIRED header is not base64-encoded UTF-8/);
  });

  it("names the header when the bytes are not valid UTF-8", () => {
    expect(() => jsonFromBase64(btoa("\xff\xfe"), PAYMENT_REQUIRED)).toThrow(/not base64-encoded UTF-8/);
  });

  it("names the header when it decodes to something that is not JSON", () => {
    expect(() => jsonFromBase64(btoa("not json"), PAYMENT_REQUIRED)).toThrow(/decoded to something that is not JSON/);
  });
});

describe("reading a 402", () => {
  /** The measured spec server: header carries everything, body is `{}`. */
  it("reads the PAYMENT-REQUIRED header, where the spec puts it", () => {
    const headers = new Headers({ "payment-required": encoded(USELESS_FACT) });
    expect(readPaymentRequired(headers, {})).toEqual(USELESS_FACT);
  });

  /** BlueAgent: no header, requirements in the body. Unchanged by the header support. */
  it("falls back to the body when there is no header", () => {
    expect(readPaymentRequired(new Headers(), USELESS_FACT)).toBe(USELESS_FACT);
  });

  it("prefers the header when a server sends both, because the header is the contract", () => {
    const headers = new Headers({ "payment-required": encoded(USELESS_FACT) });
    expect(readPaymentRequired(headers, { accepts: [] })).toEqual(USELESS_FACT);
  });

  it("feeds a measured spec 402 straight into the checker", () => {
    const body = readPaymentRequired(new Headers({ [PAYMENT_REQUIRED]: encoded(USELESS_FACT) }), {});
    const r = checkRequirements(USELESS_FACT.resource.url, ORIGIN, body, PINNED);
    expect(r.value).toBe(1000n);
    expect(r.payee.kind).toBe("known");
    expect(r.resource).toEqual(USELESS_FACT.resource);
  });
});

describe("the settlement a server reports", () => {
  it("reads the spec's PAYMENT-RESPONSE transaction", () => {
    const headers = new Headers({ [PAYMENT_RESPONSE]: encoded({ success: true, transaction: "0xabc", network: "eip155:8453" }) });
    expect(settledTransaction(headers)).toBe("0xabc");
  });

  /** A response that says it failed names no settlement, whatever else it carries. */
  it("does not report a transaction the server itself called unsuccessful", () => {
    const headers = new Headers({ [PAYMENT_RESPONSE]: encoded({ success: false, transaction: "0xabc" }) });
    expect(settledTransaction(headers)).toBeNull();
  });

  it("reads BlueAgent's X-Payment-Response txHash when there is no spec header", () => {
    expect(settledTransaction(new Headers({ [LEGACY_PAYMENT_RESPONSE]: encoded({ txHash: "0xdef" }) }))).toBe("0xdef");
  });

  it("is null — never an error — for anything absent, unreadable or incomplete", () => {
    for (const headers of [
      new Headers(),
      new Headers({ [PAYMENT_RESPONSE]: "%%%" }),
      new Headers({ [PAYMENT_RESPONSE]: encoded("a string") }),
      new Headers({ [PAYMENT_RESPONSE]: encoded(null) }),
      new Headers({ [PAYMENT_RESPONSE]: encoded({ success: true }) }),
      new Headers({ [PAYMENT_RESPONSE]: encoded({ transaction: "" }) }),
      new Headers({ [LEGACY_PAYMENT_RESPONSE]: "%%%" }),
      new Headers({ [LEGACY_PAYMENT_RESPONSE]: encoded(7) }),
      new Headers({ [LEGACY_PAYMENT_RESPONSE]: encoded({ txHash: 7 }) }),
    ]) {
      expect(settledTransaction(headers)).toBeNull();
    }
  });
});

describe("the standard PAYMENT-SIGNATURE header", () => {
  const requirements = () => checkRequirements(USELESS_FACT.resource.url, ORIGIN, USELESS_FACT, PINNED);
  const signed = () => {
    const r = requirements();
    const { authorization } = authorizationFor(r, FROM, 1_800_000_000n, new Uint8Array(32).fill(7));
    return { r, authorization, header: paymentSignatureHeader(r, authorization, SIGNATURE) };
  };

  it("is a v2 PaymentPayload echoing the server's own accepts entry and resource", () => {
    const { authorization, header } = signed();
    const payload = jsonFromBase64(header, "PAYMENT-SIGNATURE") as Record<string, unknown>;
    expect(payload.x402Version).toBe(2);
    expect(payload.accepted).toEqual(USELESS_FACT.accepts[0]);
    expect(payload.resource).toEqual(USELESS_FACT.resource);
    expect(payload.payload).toEqual({
      signature: SIGNATURE,
      authorization: {
        from: FROM,
        to: USELESS_FACT.accepts[0].payTo,
        value: "1000",
        validAfter: "0",
        validBefore: `${authorization.validBefore}`,
        nonce: `0x${"07".repeat(32)}`,
      },
    });
  });

  it("leaves resource out when the 402 had none, rather than sending null", () => {
    const { resource: _dropped, ...bare } = USELESS_FACT;
    const r = checkRequirements("t", ORIGIN, bare, PINNED);
    const { authorization } = authorizationFor(r, FROM, 1_800_000_000n, new Uint8Array(32));
    const payload = jsonFromBase64(paymentSignatureHeader(r, authorization, SIGNATURE), "X") as Record<string, unknown>;
    expect("resource" in payload).toBe(false);
  });

  /** Unicode in the server's own description must not stop a payment `btoa` would refuse. */
  it("carries a Unicode description without throwing", () => {
    const withAccents = { ...USELESS_FACT, resource: { ...USELESS_FACT.resource, description: "Un fait inutile — ☕" } };
    const r = checkRequirements("t", ORIGIN, withAccents, PINNED);
    const { authorization } = authorizationFor(r, FROM, 1_800_000_000n, new Uint8Array(32));
    const payload = jsonFromBase64(paymentSignatureHeader(r, authorization, SIGNATURE), "X") as { resource: { description: string } };
    expect(payload.resource.description).toBe("Un fait inutile — ☕");
  });

  it("refuses to build one for a payee nobody pinned, like the legacy header does", () => {
    const r = checkRequirements("t", ORIGIN, USELESS_FACT, () => null);
    const auth = { from: FROM, to: r.payee.address, value: 1000n, validAfter: 0n, validBefore: 1n, nonce: new Uint8Array(32) };
    expect(() => paymentSignatureHeader(r, auth, SIGNATURE)).toThrow(/Nothing was paid. .*no record of who/);
    expect(() => paymentHeader(r, auth, SIGNATURE)).toThrow(/Nothing was paid/);
  });
});
