/**
 * A token's logo for the share card (2026-11-04). DexScreener names it (`info.imageUrl`) but its CDN
 * sends no CORS header (MEASURED), and a picture drawn from another origin taints the canvas the card
 * is saved through — so the browser asks here, and gets the bytes back from this origin.
 *
 *   GET /api/logo/<token address>
 *
 * Not a proxy: the token is the only input, the image URL is DexScreener's own answer, and only an
 * https image on cdn.dexscreener.com is fetched. Same `x-quadra: 1` guard as `stocks.ts`. Imports
 * nothing from the app — Vite's config pass loads it.
 */

export const LOGO_PATH = "/api/logo";
const ADDRESS = /^\/(0x[0-9a-fA-F]{40})$/;
const CDN = "https://cdn.dexscreener.com/";
/** the largest picture sent on: a logo, not a poster */
export const MAX_LOGO_BYTES = 512 * 1024;

function problem(status: number, detail: string): Response {
  return new Response(JSON.stringify({ status, detail, origin: "quadra-server" }), { status, headers: { "content-type": "application/problem+json" } });
}

/** DexScreener's image for the token, from the first pair that names one, at 256 px; `null` when none does. */
export function imageOf(body: unknown): string | null {
  const pairs = typeof body === "object" && body !== null && Array.isArray((body as { pairs?: unknown }).pairs) ? (body as { pairs: unknown[] }).pairs : [];
  for (const p of pairs) {
    const url = typeof p === "object" && p !== null ? (p as { info?: { imageUrl?: unknown } }).info?.imageUrl : undefined;
    if (typeof url === "string" && url.startsWith(CDN)) return `${url.split("?")[0]}?width=256&height=256&format=png`;
  }
  return null;
}

export function logoHandler(fetchImpl: typeof fetch = fetch) {
  return async (request: Request): Promise<Response> => {
    if (request.headers.get("x-quadra") !== "1") return problem(403, "Requests to this server need the x-quadra: 1 header.");
    if (request.method !== "GET") return problem(405, "The logo takes GET.");
    const token = new URL(request.url).pathname.slice(LOGO_PATH.length).match(ADDRESS)?.[1];
    if (!token) return problem(404, "Ask for /api/logo/<token address>.");
    try {
      const pairs = await fetchImpl(`https://api.dexscreener.com/latest/dex/tokens/${token}`, { headers: { accept: "application/json" }, redirect: "manual" });
      const image = pairs.ok ? imageOf(await pairs.json()) : null;
      if (image === null) return problem(404, "DexScreener names no logo for this token.");
      const picture = await fetchImpl(image, { redirect: "manual" });
      const type = picture.headers.get("content-type") ?? "";
      const bytes = await picture.arrayBuffer();
      if (!picture.ok || !type.startsWith("image/") || bytes.byteLength > MAX_LOGO_BYTES) return problem(502, "DexScreener's logo could not be read.");
      return new Response(bytes, { status: 200, headers: { "content-type": type, "cache-control": "max-age=86400" } });
    } catch {
      return problem(502, "DexScreener could not be reached.");
    }
  };
}
