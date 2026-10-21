/**
 * The server half of every chart: GeckoTerminal's OHLCV, read here and CACHED.
 *
 * MEASURED 2026-09-30: GeckoTerminal allows 30 requests a minute per IP and, past that, answered
 * this machine 429 for over an hour — with no CORS header, so a browser cannot even see that it
 * was a rate limit. A page that asks it directly spends one visitor's quota per reload; asked
 * through here, every tab and every visitor shares one answer per pool for `FRESH_MS`, and a
 * chart that was read once keeps being served (marked stale) while GeckoTerminal says no.
 *
 * Not an open proxy: one upstream, one path, every parameter checked against a fixed shape
 * before it is put in a URL. Imports nothing from the app — Vite's config pass loads it.
 */

export const CHARTS_PATH = "/api/charts";
const GECKO = "https://api.geckoterminal.com/api/v2";

/** How long a chart is served without asking again. Hourly candles; two minutes is plenty. */
export const FRESH_MS = 120_000;
/** How long a chart is still served, marked stale, when GeckoTerminal will not answer. */
export const STALE_MS = 6 * 60 * 60_000;

const NETWORKS = new Set(["base", "robinhood"]);
const FRAMES: Record<string, readonly number[]> = { hour: [1, 4], day: [1] };
const POOL = /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const TOKEN = /^0x[0-9a-fA-F]{40}$/;
const LIMIT = /^([1-9]|[1-9][0-9]|100)$/;

type Entry = { readonly body: string; readonly at: number };

function problem(status: number, detail: string): Response {
  return new Response(JSON.stringify({ status, detail, origin: "quadra-server" }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

/** The GeckoTerminal URL a request stands for, or why it is refused. */
export function upstreamUrl(search: URLSearchParams): string | { readonly refused: string } {
  const network = search.get("network") ?? "";
  const pool = search.get("pool") ?? "";
  const token = search.get("token") ?? "";
  const frame = search.get("frame") ?? "";
  const aggregate = Number(search.get("aggregate"));
  const limit = search.get("limit") ?? "";
  if (!NETWORKS.has(network)) return { refused: "network must be base or robinhood." };
  if (!POOL.test(pool)) return { refused: "pool must be a 20- or 32-byte hex id." };
  if (!TOKEN.test(token)) return { refused: "token must be an address." };
  if (!Object.hasOwn(FRAMES, frame) || !FRAMES[frame]!.includes(aggregate)) return { refused: "frame/aggregate is not one this server serves." };
  if (!LIMIT.test(limit)) return { refused: "limit must be 1–100." };
  return `${GECKO}/networks/${network}/pools/${pool}/ohlcv/${frame}?aggregate=${aggregate}&limit=${limit}&currency=usd&token=${token}`;
}

export function chartsHandler(fetchImpl: typeof fetch = fetch, now: () => number = Date.now) {
  const cache = new Map<string, Entry>();
  /** one upstream request per URL at a time — ten tabs opening at once ask once */
  const inFlight = new Map<string, Promise<Response>>();

  const serve = (entry: Entry, stale: boolean) =>
    new Response(entry.body, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=60, s-maxage=120, stale-while-revalidate=3600",
        ...(stale ? { "x-quadra-stale": String(Math.round((now() - entry.at) / 1000)) } : {}),
      },
    });

  const ask = async (url: string): Promise<Response> => {
    const cached = cache.get(url);
    let upstream: Response;
    try {
      upstream = await fetchImpl(url, { headers: { accept: "application/json" }, redirect: "manual" });
    } catch {
      return cached && now() - cached.at < STALE_MS ? serve(cached, true) : problem(502, "GeckoTerminal could not be reached.");
    }
    if (!upstream.ok) {
      if (cached && now() - cached.at < STALE_MS) return serve(cached, true);
      return upstream.status === 429
        ? problem(429, "GeckoTerminal is rate-limiting this server right now. The chart is asked for again on the next refresh.")
        : problem(502, `GeckoTerminal answered ${upstream.status}.`);
    }
    const entry = { body: await upstream.text(), at: now() };
    cache.set(url, entry);
    return serve(entry, false);
  };

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.headers.get("x-quadra") !== "1") return problem(403, "Requests to this server need the x-quadra: 1 header.");
    if (url.pathname.slice(CHARTS_PATH.length) !== "/ohlcv") return problem(404, "Only /ohlcv is served here.");
    if (request.method !== "GET") return problem(405, "/ohlcv takes GET.");
    const target = upstreamUrl(url.searchParams);
    if (typeof target !== "string") return problem(400, target.refused);
    const cached = cache.get(target);
    if (cached && now() - cached.at < FRESH_MS) return serve(cached, false);
    let pending = inFlight.get(target);
    if (!pending) {
      pending = ask(target).finally(() => inFlight.delete(target));
      inFlight.set(target, pending);
    }
    return (await pending).clone();
  };
}
