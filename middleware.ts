/**
 * Vercel Routing Middleware (runs at the edge for every framework, Vite included): a page request
 * gets index.html with its share tags set for that page or `?do=` window (src/server/og.ts), so a
 * link pasted on X, Telegram or Discord shows that page's card. Assets and /api are not touched.
 * Any failure serves the page unchanged — a share card is never worth a broken page.
 */
import { injectMeta, metaFor } from "./src/server/og";

export const config = { matcher: ["/((?!api/|og/|brand/|assets/|.*\\..*).*)"] };

export default async function middleware(request: Request): Promise<Response | undefined> {
  if (request.method !== "GET") return undefined;
  const url = new URL(request.url);
  try {
    const page = await fetch(new URL("/index.html", url), { headers: { accept: "text/html" } });
    if (!page.ok) return undefined;
    const html = injectMeta(await page.text(), metaFor(url), url);
    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=0, must-revalidate",
      },
    });
  } catch {
    return undefined;
  }
}
