/**
 * The forwarder: one same-origin path that asks an x402 server on the browser's behalf.
 *
 * ── Why it exists ──────────────────────────────────────────────────────────────
 * MEASURED 2026-09-29 against servers listed on Coinbase's Bazaar: x402.ottoai.services
 * answers CORS for everything (`access-control-allow-headers: *` and the PAYMENT-*
 * headers exposed), so a browser pays it directly. x402uselessfacts.vercel.app answers
 * with no CORS header at all, and so does the Bazaar's own discovery API — a browser can
 * send to them and is forbidden to read the answer. For those, the only honest options
 * are "cannot" or "ask from a server", and this is the server.
 *
 * ── Why it is written against Request/Response and nothing else ───────────────
 * `forward(request) → Response` is the Fetch API, which Cloudflare Workers, Vercel and
 * Netlify functions, Deno and Node 18+ all speak natively. So choosing where production
 * runs it (TASKS.md T3) is a hosting decision and not a rewrite: the dev server wraps this
 * function in `vite.config.ts`, and a Worker would export it as its `fetch` handler. It
 * imports nothing from the app — no `@/` alias exists where Vite's config pass loads it.
 *
 * ── 🔴 What stops it being an open proxy ──────────────────────────────────────
 * A path that fetches any URL it is handed is a gift to anyone who finds it. Four limits,
 * each for a named abuse:
 *
 *   1. A POLICY decides every target. Development allows any public https origin; the
 *      production policy is an allowlist (`allowOrigins`) and choosing its contents is
 *      part of T3. The handler cannot run without one.
 *   2. The caller must send `x-forward: 1`. A custom header makes any cross-site call a
 *      preflighted one, and this handler never answers a preflight — so another website
 *      open in the same browser cannot drive a developer's local forwarder.
 *   3. Only the headers x402 needs travel, in both directions. Cookies, authorization and
 *      everything else stay behind, so a forwarded call carries no ambient credential.
 *   4. Redirects are not followed. A 3xx comes back as a 3xx; following it would let a
 *      permitted host bounce the forwarder to a host the policy never saw.
 */

/** The same-origin path the app calls. */
export const FORWARD_PATH = "/forward";

/** Request header the app must send. See limit 2 above. */
export const FORWARD_REQUEST_HEADER = "x-forward";

/**
 * Stamped on every answer this handler produces, success or refusal. The app reads it to
 * tell "the forwarder answered" from "a static host answered with index.html" — which a
 * status code cannot do (see `NO_FORWARDER` in `adapters/http/catalog.ts`).
 */
export const FORWARDED_MARK = "x-forwarded-by";
export const FORWARDED_VALUE = "forwarder";

/** Headers that travel from the app to the target. Everything else is dropped. */
const REQUEST_HEADERS = ["accept", "content-type", "payment-signature", "x-payment"] as const;

/** Headers that travel back. The x402 ones, and the content type. */
const RESPONSE_HEADERS = [
  "content-type",
  "payment-required",
  "payment-response",
  "x-payment-response",
] as const;

/** A reason to refuse this target, or `null` to allow it. */
export type ForwardPolicy = (target: URL) => string | null;

/**
 * Hostnames that are not "somewhere on the internet": loopback, link-local, the private
 * ranges, IPv6 literals, and the conventional internal suffixes. Checked by NAME, which
 * is the limit of what a handler without a resolver can do — a public name that resolves
 * to a private address is not caught here, and that is why production is an allowlist.
 */
const PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|\[.*\])$/i;

/**
 * Development: any public https origin. Not for production — see limit 1 and the
 * DNS caveat on `PRIVATE_HOST`.
 */
export const anyPublicHttps: ForwardPolicy = (target) => {
  if (target.protocol !== "https:") return "Only https targets are forwarded.";
  if (target.username !== "" || target.password !== "") {
    return "A target with credentials in it is not forwarded.";
  }
  if (PRIVATE_HOST.test(target.hostname)) {
    return `${target.hostname} is not a public host, so it is not forwarded.`;
  }
  return null;
};

/** Production's shape: these exact origins and nothing else, on top of the public-https rule. */
export function allowOrigins(origins: readonly string[]): ForwardPolicy {
  const allowed = new Set(origins);
  return (target) =>
    anyPublicHttps(target) ??
    (allowed.has(target.origin) ? null : `${target.origin} is not on this forwarder's list.`);
}

function refusal(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json", [FORWARDED_MARK]: FORWARDED_VALUE },
  });
}

/**
 * Forward one request to the URL in its `?url=` parameter, if the policy allows it.
 *
 * `fetchImpl` is a parameter so the tests can hand in a fake and nothing here reaches
 * the network under test.
 */
export async function forward(
  request: Request,
  policy: ForwardPolicy,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (request.headers.get(FORWARD_REQUEST_HEADER) !== "1") {
    return refusal(403, `Send ${FORWARD_REQUEST_HEADER}: 1. Requests without it are not forwarded.`);
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return refusal(405, `Only GET and POST are forwarded, not ${request.method}.`);
  }

  const raw = new URL(request.url).searchParams.get("url");
  if (raw === null) return refusal(400, "Name the target as ?url=…");
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return refusal(400, `${raw} is not a URL.`);
  }
  const refused = policy(target);
  if (refused !== null) return refusal(403, refused);

  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  let answer: Response;
  try {
    answer = await fetchImpl(target.href, {
      method: request.method,
      headers,
      body: request.method === "POST" ? await request.text() : null,
      redirect: "manual",
    });
  } catch (e) {
    return refusal(502, `Could not reach ${target.origin}: ${e instanceof Error ? e.message : String(e)}`);
  }

  const back = new Headers({ [FORWARDED_MARK]: FORWARDED_VALUE });
  for (const name of RESPONSE_HEADERS) {
    const value = answer.headers.get(name);
    if (value !== null) back.set(name, value);
  }
  /**
   * A 204 or 304 must be rebuilt with NO body — `new Response("", { status: 204 })` throws,
   * even for an empty string. Read the text anyway so the upstream connection is drained.
   */
  const text = await answer.text();
  const body = NULL_BODY.has(answer.status) ? null : text;
  return new Response(body, { status: answer.status, headers: back });
}

/** Statuses a Response may not carry a body with. */
const NULL_BODY = new Set([204, 205, 304]);
