import { reach, parseEndpoint } from "@/adapters/http/endpoint";
import { checkRequirements } from "@/lib/requirements";

/**
 * Coinbase's x402 Bazaar: a public directory of x402 resources. The second directory this
 * app reads, and the one that makes "BlueAgent is one directory" true in practice.
 *
 * MEASURED 2026-09-29: `GET …/discovery/resources` answers 200 with `{ x402Version, items,
 * pagination: { limit, offset, total } }`, `total` 19106. Every item on the first page was
 * `type: "http"`, x402 version 2, and priced in USDC on eip155:8453. It sends NO CORS
 * header, so a browser cannot read it directly — this goes through the forwarder, and on
 * a static host without one the list says so instead of appearing empty.
 *
 * ── What the list shows, and what it deliberately does not ───────────────────
 * A URL and the server's own one-line description. NOT a price: the listing carries
 * `accepts`, but a price read from a directory is a price that can be stale, and the
 * x402 window's one rule is that the number on the button came from the endpoint itself
 * a moment ago. The listing's `accepts` are used for one thing only — to leave out what
 * this build could not pay anyway — and they go through the real `checkRequirements` to
 * decide that, not a second, looser copy of its rules.
 */

export const BAZAAR = {
  name: "x402 Bazaar",
  resources: "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources",
} as const;

/** One page. The directory holds tens of thousands; the first hundred is a list, not a dump. */
export const BAZAAR_PAGE = 100;

export type Listing = { readonly url: string; readonly description: string };

export type BazaarPage = {
  readonly listings: readonly Listing[];
  /** how many items the page held before anything was left out */
  readonly seen: number;
  /** the directory's own count, when it gave one */
  readonly total: number | null;
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** The item's declared input, if it declared one: `extensions.bazaar.info.input`. */
function inputOf(item: Json): Json | null {
  const ext = item.extensions;
  const bazaar = isObj(ext) ? ext.bazaar : undefined;
  const info = isObj(bazaar) ? bazaar.info : undefined;
  const input = isObj(info) ? info.input : undefined;
  return isObj(input) ? input : null;
}

/**
 * One item as a listing, or `null` when this build could not call and pay it.
 *
 * Left out: anything not an http GET (there is no form for a body yet — see
 * `endpoint.ts`); a URL with a `:param` path placeholder (it would be called with the
 * placeholder in it); a non-https URL; and anything `checkRequirements` refuses. The pin
 * lookup here answers `null` for everyone, so an unpinned payee is NOT a reason to leave
 * an item out — it is a `Payee` value, and the user confirms it when they get there.
 *
 * The server's own example query parameters are filled in, so a listed URL is one that
 * answers rather than one that 400s for a missing `address=`.
 */
function listing(item: unknown): Listing | null {
  if (!isObj(item) || item.type !== "http" || item.x402Version !== 2) return null;
  const input = inputOf(item);
  if (input === null || input.method !== "GET" || typeof item.resource !== "string") return null;

  let url: URL;
  try {
    url = parseEndpoint(item.resource);
  } catch {
    return null;
  }
  if (url.pathname.includes(":")) return null;

  try {
    checkRequirements(url.href, url.origin, { x402Version: 2, accepts: item.accepts }, () => null);
  } catch {
    return null;
  }

  const params = input.queryParams;
  if (isObj(params)) {
    for (const [name, value] of Object.entries(params)) {
      if (typeof value === "string" && !url.searchParams.has(name)) url.searchParams.set(name, value);
    }
  }
  const description = typeof item.description === "string" ? item.description.trim() : "";
  return { url: url.href, description: description || url.href };
}

export function parseBazaar(body: unknown): BazaarPage {
  if (!isObj(body) || !Array.isArray(body.items)) {
    throw new Error("The Bazaar answered without an `items` list, so nothing is listed.");
  }
  const total = isObj(body.pagination) && typeof body.pagination.total === "number" ? body.pagination.total : null;
  const listings = body.items.map(listing).filter((l): l is Listing => l !== null);
  return { listings, seen: body.items.length, total };
}

/** The first page of the directory, through whichever route reaches it. */
export async function bazaarPage(): Promise<BazaarPage> {
  const url = new URL(BAZAAR.resources);
  url.searchParams.set("limit", `${BAZAAR_PAGE}`);
  const { res } = await reach(url, { accept: "application/json" }, "direct");
  if (!res.ok) {
    throw new Error(`The Bazaar answered ${res.status}. Nothing was read, so nothing is listed.`);
  }
  let body: unknown;
  try {
    body = JSON.parse(await res.text());
  } catch {
    throw new Error("The Bazaar answered with something that is not JSON, so nothing is listed.");
  }
  return parseBazaar(body);
}
