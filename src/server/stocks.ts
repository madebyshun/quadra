/**
 * The server half of the two stock lists, neither of which sends a CORS header (MEASURED
 * 2026-09-30), so the browser reads them here:
 *
 *   GET /api/stocks/prices → `https://api.robinhood.com/rhj/prices/` — Robinhood's stock tokens
 *       on Robinhood Chain, all 195 quotes in one call.
 *   GET /api/stocks/base   → `https://api.coinbase.com/v1/tokenized-stocks` — Coinbase's
 *       tokenized stocks on Base (docs.base.org, "List Tokenized Stocks"): 40 of them, each with
 *       its contract, decimals, multiplier, paused features and Chainlink NAV. No key either.
 *
 * Same shape and same guard as `charts.ts`: a Fetch-API handler, one route, GET only, and the
 * `x-quadra: 1` header so another site cannot spend this server's requests from a visitor's
 * browser. Imports nothing from the app — Vite's config pass loads it.
 */

export const STOCKS_PATH = "/api/stocks";
/** Coinbase's own list — fetched directly wherever there is no browser to refuse it (MCP, the paid API). */
export const COINBASE_STOCKS = "https://api.coinbase.com/v1/tokenized-stocks";
const UPSTREAM: Record<string, { readonly url: string; readonly name: string; readonly maxAge: number }> = {
  "/prices": { url: "https://api.robinhood.com/rhj/prices/", name: "Robinhood's stock price API", maxAge: 15 },
  "/base": { url: COINBASE_STOCKS, name: "Coinbase's tokenized stocks API", maxAge: 300 },
};

function problem(status: number, detail: string): Response {
  return new Response(JSON.stringify({ status, detail, origin: "quadra-server" }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

export function stocksHandler(fetchImpl: typeof fetch = fetch) {
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname.slice(STOCKS_PATH.length);
    if (request.headers.get("x-quadra") !== "1") return problem(403, "Requests to this server need the x-quadra: 1 header.");
    const route = Object.hasOwn(UPSTREAM, path) ? UPSTREAM[path]! : null;
    if (route === null) return problem(404, `${path} is not a route this server forwards.`);
    if (request.method !== "GET") return problem(405, `${path} takes GET.`);
    let upstream: Response;
    try {
      upstream = await fetchImpl(route.url, { headers: { accept: "application/json" }, redirect: "manual" });
    } catch {
      return problem(502, `${route.name} could not be reached.`);
    }
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": "application/json", "cache-control": `max-age=${route.maxAge}` },
    });
  };
}
