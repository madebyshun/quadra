/**
 * The x402 v2 HTTP transport: which header carries what, and how it is encoded.
 *
 * ── MEASURED 2026-09-29, and why it had to be ─────────────────────────────────
 * The x402 v2 transport spec puts every protocol message in a header, base64-encoded
 * JSON: `PAYMENT-REQUIRED` on the 402, `PAYMENT-SIGNATURE` on the paid retry,
 * `PAYMENT-RESPONSE` on the answer. The one upstream this app was built against,
 * BlueAgent, does not: it sends the requirements as the 402's JSON BODY, takes the
 * payment as `X-Payment` and answers with `X-Payment-Response`. Both are real:
 *
 *   x402uselessfacts.vercel.app   402, `payment-required` header, body `{}`
 *   x402.ottoai.services          402, header AND the same accepts mirrored in the body
 *   api.onesource.io              402, header AND body
 *   blueagent.dev                 402, body only
 *
 * So the header is read first — it is the protocol contract — and the body is the
 * fallback, which is what keeps BlueAgent working unchanged. A client reading only the
 * body would see `{}` from a spec-compliant server and call it "named no way to pay".
 *
 * ── Why base64 here is UTF-8, when `lib/payment.ts` insists on ASCII ──────────
 * `payment.ts`'s own header carries only fields this build checked, so a non-ASCII byte
 * there means a check was skipped, and `btoa` throwing is the alarm. These headers carry
 * the SERVER's own text back and forth — a `resource.description`, a service name — and
 * those are legitimately Unicode. The fields that decide the money are still checked in
 * `lib/requirements.ts`; this is only the envelope.
 */

/** Names as the spec writes them. `Headers.get` is case-insensitive, so reading is safe either way. */
export const PAYMENT_REQUIRED = "PAYMENT-REQUIRED";
export const PAYMENT_SIGNATURE = "PAYMENT-SIGNATURE";
export const PAYMENT_RESPONSE = "PAYMENT-RESPONSE";
/** BlueAgent's pre-spec names. Read, never written by the standard path. */
export const LEGACY_PAYMENT_RESPONSE = "X-Payment-Response";

/** base64 of the UTF-8 bytes of `text`. `btoa` alone throws on anything above U+00FF. */
export function toBase64Utf8(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The inverse, or a thrown sentence naming the header when it is not base64 of UTF-8 JSON. */
export function jsonFromBase64(value: string, header: string): unknown {
  let text: string;
  try {
    const binary = atob(value);
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (c) => c.charCodeAt(0)),
    );
  } catch {
    throw new Error(`The ${header} header is not base64-encoded UTF-8, so it could not be read.`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`The ${header} header decoded to something that is not JSON, so it could not be read.`);
  }
}

/**
 * The PaymentRequired message on a 402: the header when there is one, else the body.
 *
 * The header wins even when both are present, because it is the contract and the body
 * is, in ottoai's own words, a mirror. A mirror that disagreed with the header would be
 * the server's bug, and the header is the thing its payment check runs against.
 */
export function readPaymentRequired(headers: Headers, body: unknown): unknown {
  const header = headers.get(PAYMENT_REQUIRED);
  return header === null ? body : jsonFromBase64(header, PAYMENT_REQUIRED);
}

/**
 * The settlement transaction a server reported, or `null` when it reported none legibly.
 *
 * Two shapes, both measured or specified: the spec's `PAYMENT-RESPONSE` carries a
 * SettlementResponse whose hash is `transaction` (and `success`), BlueAgent's
 * `X-Payment-Response` carries `txHash`. A missing or unreadable header is `null`, never
 * an error — a paid call that settles is not required to send it back (see
 * `adapters/http/catalog.ts`), and rule 10 forbids inventing a hash either way.
 *
 * A spec response that says `success: false` is also `null`: it names no settlement, and
 * reporting its `transaction` as one would upgrade a failure into a receipt.
 */
export function settledTransaction(headers: Headers): string | null {
  const spec = headers.get(PAYMENT_RESPONSE);
  if (spec !== null) {
    const decoded = safely(() => jsonFromBase64(spec, PAYMENT_RESPONSE));
    if (typeof decoded !== "object" || decoded === null) return null;
    const { success, transaction } = decoded as Record<string, unknown>;
    return success !== false && typeof transaction === "string" && transaction !== "" ? transaction : null;
  }
  const legacy = headers.get(LEGACY_PAYMENT_RESPONSE);
  if (legacy === null) return null;
  const decoded = safely(() => jsonFromBase64(legacy, LEGACY_PAYMENT_RESPONSE));
  if (typeof decoded !== "object" || decoded === null) return null;
  const { txHash } = decoded as Record<string, unknown>;
  return typeof txHash === "string" ? txHash : null;
}

function safely(read: () => unknown): unknown {
  try {
    return read();
  } catch {
    return null;
  }
}
