import type { Price, ToolRun } from "@/adapters/types";
import { settlementFor } from "@/adapters/http/catalog";
import { checkRequirements, type PinLookup } from "@/lib/requirements";
import { PAYMENT_SIGNATURE, jsonFromBase64, PAYMENT_REQUIRED, readPaymentRequired } from "@/lib/x402http";
import { FORWARD_PATH, FORWARD_REQUEST_HEADER, FORWARDED_MARK, FORWARDED_VALUE } from "@/server/forward";

/**
 * Pay any x402 URL — not a directory's tool id, a URL somebody pasted or picked.
 *
 * This is the half of "BlueAgent is one directory, not the platform" that is code rather
 * than copy. It speaks the x402 v2 transport as the spec writes it (`lib/x402http.ts`),
 * checks every 402 with the same `checkRequirements` the directory path uses, and pins
 * payees per origin — so a server this build has never heard of is refused until the
 * user confirms who it is paid to.
 *
 * ── Two routes, tried in order ────────────────────────────────────────────────
 * DIRECT first: a server that answers CORS (x402.ottoai.services does, measured) is paid
 * from the browser with no middleman — the one route that works on a static host too.
 * FORWARDED when direct is refused: the browser throws on a CORS-closed server
 * (x402uselessfacts.vercel.app, measured) and the same request goes through
 * `server/forward.ts`. The route the quote took is remembered and tried first for the
 * paid call, since a server that could not be read directly will not be paid directly.
 *
 * Only GET. Every x402 resource measured on the Bazaar that this build could pay was a
 * GET with its inputs in the query string; a POST body is a form this window does not
 * have yet, and guessing one would send the server something nobody typed.
 */

export type Route = "direct" | "forwarded";

export type EndpointQuote = {
  readonly url: string;
  readonly origin: string;
  readonly route: Route;
  readonly price: Price;
  /** What the endpoint said when it answered without asking to be paid. */
  readonly answer: string | null;
};

/** Why nothing could reach `origin`. Named once so the panel and the error cannot drift. */
export function noRoute(origin: string): string {
  return (
    `The browser is not allowed to read ${origin}'s answer — it sends no CORS headers — and ` +
    "there is no forwarder on this host to ask on the browser's behalf. It works under " +
    "`npm run dev`; a static build needs the forwarder deployed (TASKS.md T3). Nothing was paid."
  );
}

/** A URL this window will call: https, no credentials. Or a thrown sentence. */
export function parseEndpoint(text: string): URL {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    throw new Error(`"${text.trim()}" is not a URL. Paste the whole address, starting with https://.`);
  }
  // this app's own API is paid over the same connection the page itself came in on
  const own = typeof location !== "undefined" && url.origin === location.origin;
  if (url.protocol !== "https:" && !own) {
    throw new Error(`Only https endpoints are paid. ${url.protocol}// would send the payment in the clear.`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("That URL has a username or password in it. Remove it — nothing here sends credentials.");
  }
  return url;
}

/** Direct if the server allows it, else through the forwarder, else a thrown `noRoute`. */
export async function reach(
  url: URL,
  headers: Record<string, string>,
  prefer: Route,
): Promise<{ res: Response; route: Route }> {
  if (prefer === "direct") {
    try {
      return { res: await fetch(url.href, { headers }), route: "direct" };
    } catch {
      /* CORS-closed or unreachable — the forwarder is the other way in. */
    }
  }
  let res: Response;
  try {
    res = await fetch(`${FORWARD_PATH}?url=${encodeURIComponent(url.href)}`, {
      headers: { ...headers, [FORWARD_REQUEST_HEADER]: "1" },
    });
  } catch {
    throw new Error(noRoute(url.origin));
  }
  /** Without the mark this is a static host's 404 page or its index.html — not a forwarder. */
  if (res.headers.get(FORWARDED_MARK) !== FORWARDED_VALUE) throw new Error(noRoute(url.origin));
  return { res, route: "forwarded" };
}

function readJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The server's own sentence for a refusal: the spec puts it in the PAYMENT-REQUIRED
 * header's `error`, the forwarder and most servers in a JSON body's `error`.
 */
function reasonFrom(headers: Headers, text: string): string | null {
  const header = headers.get(PAYMENT_REQUIRED);
  const candidates: unknown[] = [readJson(text)];
  if (header !== null) {
    try {
      candidates.unshift(jsonFromBase64(header, PAYMENT_REQUIRED));
    } catch {
      /* an unreadable header has no sentence to offer */
    }
  }
  for (const c of candidates) {
    if (typeof c === "object" && c !== null) {
      // x402's `error`, or a problem+json `detail` (this app's own API answers refusals that way)
      const { error, detail } = c as Record<string, unknown>;
      // a sentence's own full stop is dropped: the caller adds its own after it
      if (typeof error === "string" && error !== "") return error.replace(/\.$/, "");
      if (typeof detail === "string" && detail !== "") return detail.replace(/\.$/, "");
    }
  }
  return null;
}

/** JSON pretty-printed, anything else as it came. What the endpoint said, untouched otherwise. */
function shown(text: string): string {
  const json = readJson(text);
  return json === undefined ? text : JSON.stringify(json, null, 2);
}

/**
 * Ask the URL what it costs. A 402 becomes checked requirements; a 2xx means it answered
 * for free, and what it said is kept so the panel shows it rather than asking twice.
 */
export async function quoteEndpoint(text: string, lookup: PinLookup): Promise<EndpointQuote> {
  const url = parseEndpoint(text);
  const { res, route } = await reach(url, { accept: "application/json" }, "direct");
  const body = await res.text();
  const base = { url: url.href, origin: url.origin, route };
  if (res.status === 402) {
    const required = readPaymentRequired(res.headers, readJson(body) ?? {});
    return { ...base, price: { kind: "paid", requirements: checkRequirements(url.href, url.origin, required, lookup) }, answer: null };
  }
  if (res.ok) {
    return { ...base, price: { kind: "free", why: "it answered without asking to be paid" }, answer: shown(body) };
  }
  const said = reasonFrom(res.headers, body);
  throw new Error(`${url.origin} answered ${res.status}${said ? `: ${said}` : " and gave no reason"}. Nothing was paid.`);
}

/**
 * Send the signed `PAYMENT-SIGNATURE` and read the answer.
 *
 * ⚠️ On a refusal the wording is "not settled", not "not charged". x402 servers settle
 * after they answer, so a refused or failed call should not have moved money — but the
 * signed authorization is a bearer instrument that stays valid until it expires, and
 * claiming certainty about what a remote server did with it would be a sentence this
 * build cannot check.
 */
export async function payEndpoint(quote: EndpointQuote, payment: string): Promise<ToolRun> {
  const url = new URL(quote.url);
  const { res } = await reach(url, { accept: "application/json", [PAYMENT_SIGNATURE]: payment }, quote.route);
  const body = await res.text();
  if (!res.ok) {
    const said = reasonFrom(res.headers, body);
    const what = res.status === 402 ? "refused the payment" : `answered ${res.status}`;
    throw new Error(
      `${url.origin} ${what}${said ? `: ${said}` : " and gave no reason"}. It reported no settlement; ` +
        "the authorization you signed expires on its own.",
    );
  }
  return { toolId: url.href, output: shown(body), settlement: settlementFor(payment, res.headers) };
}
