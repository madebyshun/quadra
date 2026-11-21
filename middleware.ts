/**
 * Vercel Routing Middleware (runs at the edge for every framework, Vite included): a page request
 * gets index.html with its share tags set for that page or `?do=` window (src/server/og.ts), so a
 * link pasted on X, Telegram or Discord shows that page's card. Assets and /api are not touched.
 * Any failure serves the page unchanged via `x-middleware-next: 1` (never `undefined`, which
 * throws MIDDLEWARE_INVOCATION_FAILED on Vercel Edge).
 */
import { injectMeta, metaFor } from "./src/server/og";

export const config = { matcher: ["/((?!api/|og/|brand/|assets/|.*\\..*).*)"] };

const passThrough = () => new Response(null, { headers: { "x-middleware-next": "1" } });

export default async function middleware(request: Request): Promise<Response> {
  if (request.method !== "GET" || request.headers.get("x-og-fetch") === "1") return passThrough();
  const url = new URL(request.url);
  // index.html already ships the home OG card; pass bare `/` through directly with zero extra fetch.
  if (url.pathname === "/" && !url.searchParams.has("do")) return passThrough();
  try {
    const page = await fetch(new URL("/index.html", url), {
      headers: { accept: "text/html", "x-og-fetch": "1" },
    });
    if (!page.ok) return passThrough();
    const html = injectMeta(await page.text(), metaFor(url), url);
    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=0, must-revalidate",
      },
    });
  } catch {
    return passThrough();
  }
}
