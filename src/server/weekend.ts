/**
 * Blue Agent's weekend record, read from this origin (2026-11-12). Blue Agent publishes two free
 * endpoints — the Weekend scorecard and the paper-trading diary — for this app to show, credited
 * to it; they send no CORS header (MEASURED 2026-11-12: neither the POST nor its preflight carries
 * one), so the browser asks here.
 *
 *   GET /api/weekend/scorecard
 *   GET /api/weekend/diary
 *
 * Not a proxy: two fixed upstream URLs, an empty body, no parameter passed through. Answers are
 * cached `FRESH_MS` — the record changes once a weekend. Same `x-quadra: 1` guard as `stocks.ts`.
 * Imports nothing from the app — Vite's config pass loads it.
 */

export const WEEKEND_PATH = "/api/weekend";
export const UPSTREAM: Readonly<Record<string, string>> = {
  scorecard: "https://blueagent.dev/api/x402/weekend-scorecard",
  diary: "https://blueagent.dev/api/x402/weekend-diary",
};
export const FRESH_MS = 10 * 60 * 1000;

function problem(status: number, detail: string): Response {
  return new Response(JSON.stringify({ status, detail, origin: "quadra-server" }), { status, headers: { "content-type": "application/problem+json" } });
}

export function weekendHandler(fetchImpl: typeof fetch = fetch, now: () => number = Date.now) {
  const cache = new Map<string, { readonly at: number; readonly body: string }>();
  return async (request: Request): Promise<Response> => {
    if (request.headers.get("x-quadra") !== "1") return problem(403, "Requests to this server need the x-quadra: 1 header.");
    if (request.method !== "GET") return problem(405, "The weekend record takes GET.");
    const which = new URL(request.url).pathname.slice(WEEKEND_PATH.length + 1);
    const url = UPSTREAM[which];
    if (url === undefined || !Object.hasOwn(UPSTREAM, which)) return problem(404, "Ask for /api/weekend/scorecard or /api/weekend/diary.");
    const kept = cache.get(which);
    if (kept && now() - kept.at < FRESH_MS) return ok(kept.body);
    try {
      const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: "{}", redirect: "manual" });
      // Blue Agent answers an unreadable record with a 503 — said as such, never as an empty record
      if (!res.ok) return problem(502, `Blue Agent answered ${res.status}.`);
      const body = JSON.stringify(await res.json());
      cache.set(which, { at: now(), body });
      return ok(body);
    } catch {
      return problem(502, "Blue Agent could not be reached.");
    }
  };
}

const ok = (body: string) => new Response(body, { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=300" } });
