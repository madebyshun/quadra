/**
 * The server half of Launch: holds the o1 API key and forwards exactly one call to o1.
 *
 * 🔴 Hard rule 14: the key lives here and nowhere else. The browser calls this app's own
 * `/api/o1/...`; this handler adds `x-api-key` and calls o1. The key is never in a response,
 * never in the bundle, never `VITE_`-prefixed. In development it comes from `.env.local`
 * (read by `vite.config.ts`); in production from the Vercel project's environment.
 *
 * Written as a Fetch-API `Request → Response`, like `forward.ts`, so it runs unchanged on
 * the dev server and on Vercel. Imports nothing from the app: Vite's config pass loads it.
 *
 * ── Not a proxy to o1 ─────────────────────────────────────────────────────────────
 * Two routes with their methods: `POST /launches/prepare` (with the key) — what a launch
 * needs — and `GET /health` (o1's only unauthenticated route, sent WITHOUT the key), so the
 * Launch window can say o1 is down before anybody fills in a form. Anything else is refused here, so the key cannot be spent on o1's other
 * endpoints by whoever finds this URL. A custom header is required too, as `forward.ts`
 * does: a cross-site page cannot send one without a CORS preflight this server never
 * answers, so another site cannot spend the key's rate limit from a visitor's browser.
 */

export const O1_PATH = "/api/o1";
export const O1_REQUEST_HEADER = "x-quadra";
const O1_API = "https://api.launch.o1.exchange/v1";

/** The o1 routes this server forwards. */
const PREPARE = "/launches/prepare";
const HEALTH = "/health";

/**
 * A refusal in o1's own problem shape, marked as THIS server's (`origin`), so the browser never
 * blames o1 for a missing key or a header this app forgot — and never blames this app for o1.
 */
export const SERVER_ORIGIN = "quadra-server";

function problem(status: number, code: string, detail: string): Response {
  return new Response(JSON.stringify({ status, code, title: code, detail, origin: SERVER_ORIGIN }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

export const NO_KEY =
  "O1_API_KEY is not set on this server. In development put it in .env.local at the repo root " +
  "and restart the dev server; in production set it in the Vercel project's environment.";

/** o1's health, asked without the key — it is the one route o1 serves unauthenticated. */
async function health(request: Request, fetchImpl: typeof fetch): Promise<Response> {
  if (request.method !== "GET") return problem(405, "wrong_method", `${HEALTH} takes GET.`);
  try {
    const answer = await fetchImpl(`${O1_API}${HEALTH}`, { redirect: "manual" });
    return new Response(JSON.stringify({ up: answer.ok, status: answer.status }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ up: false, status: 0 }), { status: 200, headers: { "content-type": "application/json" } });
  }
}

export function o1Handler(key: string | null, fetchImpl: typeof fetch = fetch) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname.slice(O1_PATH.length);
    if (request.headers.get(O1_REQUEST_HEADER) !== "1") {
      return problem(403, "missing_header", `Requests to this server need the ${O1_REQUEST_HEADER}: 1 header.`);
    }
    if (path === HEALTH) return health(request, fetchImpl);
    if (path !== PREPARE) return problem(404, "not_forwarded", `${path} is not a launch route this server forwards.`);
    if (request.method !== "POST") return problem(405, "wrong_method", `${path} takes POST.`);
    if (key === null) return problem(503, "no_api_key", NO_KEY);

    const headers = new Headers({ "x-api-key": key, accept: "application/json", "content-type": "application/json" });
    const idempotency = request.headers.get("idempotency-key");
    if (idempotency) headers.set("Idempotency-Key", idempotency);
    let upstream: Response;
    try {
      upstream = await fetchImpl(`${O1_API}${PREPARE}`, { method: "POST", headers, body: await request.text(), redirect: "manual" });
    } catch {
      return problem(502, "unreachable", "o1's launch API could not be reached.");
    }
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  };
}
