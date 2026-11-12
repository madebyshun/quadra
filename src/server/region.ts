/**
 * Where a request comes from, as the host says (2026-11-13, for Coinbase's stock tokens: "only for
 * eligible persons outside the U.S."). On Vercel every request carries `x-vercel-ip-country`, an
 * ISO 3166-1 alpha-2 code set at the edge; this route hands it to the page, which keeps stock
 * trading and stock-paired launches away from a U.S. visitor.
 *
 *   GET /api/region → { "country": "VN" } — or { "country": null } where the host says nothing
 *
 * An IP country is a hint, not an identity: a VPN changes it, and the page still says that eligibility
 * is the visitor's own to decide. Same `x-quadra: 1` guard as `stocks.ts`. Imports nothing from the
 * app — Vite's config pass loads it.
 */

export const REGION_PATH = "/api/region";
const CODE = /^[A-Z]{2}$/;

function problem(status: number, detail: string): Response {
  return new Response(JSON.stringify({ status, detail, origin: "quadra-server" }), { status, headers: { "content-type": "application/problem+json" } });
}

export function regionHandler() {
  return async (request: Request): Promise<Response> => {
    if (request.headers.get("x-quadra") !== "1") return problem(403, "Requests to this server need the x-quadra: 1 header.");
    if (request.method !== "GET") return problem(405, "The region takes GET.");
    const said = (request.headers.get("x-vercel-ip-country") ?? "").toUpperCase();
    const country = CODE.test(said) ? said : null;
    return new Response(JSON.stringify({ country }), { status: 200, headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  };
}
