import { apiHandler } from "@/server/api";
import { cdpFacilitator, type CdpCredentials } from "@/server/cdp";
import { chartsHandler } from "@/server/charts";
import { stocksHandler } from "@/server/stocks";
import { logoHandler } from "@/server/logo";
import { weekendHandler } from "@/server/weekend";
import { regionHandler } from "@/server/region";
import { indexerHandler, INDEXER_RPC, type IndexerDeps, type Rpc } from "@/server/indexer";
import { BASE } from "@/config/chain";
import { rpcOn } from "@/skills/http";
import { INDEXER_PATH } from "@/server/indexerPath";
import { blobStore, type BlobCalls } from "@/server/indexStore";

/**
 * The production server (T3, 2026-11-04): the same Fetch-API handlers the dev server mounts in
 * `vite.config.ts`, built for Vercel Functions. `scripts/build-api.mjs` bundles one entry per route
 * into `api/` (Vercel's own folder), because Vercel's compiler does not follow this repo's `@/` alias.
 *
 * The launchpad indexer (`server/indexer.ts`) keeps its index in the project's Vercel Blob store
 * (`BLOB_READ_WRITE_TOKEN`, which Vercel sets when the store is connected; `BLOB_ACCESS` = "public" for a
 * public store, "private" otherwise): each request on a stale index steps it forward and saves it, and a
 * daily cron (`/api/cron/index`, vercel.json) does the same with nobody asking.
 *
 * What is NOT here yet, on purpose:
 *   - the forwarder and the `/upstream` proxy — they serve only the x402 window's halves that are
 *     switched off (`FLAGS.x402Others`).
 *
 * Keys are read from the function's environment only (hard rule 14): never `VITE_`-prefixed, never in
 * a response. The CDP key counts only when BOTH halves are set — one without the other is no key.
 */

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * The indexer's chain: the owner's own RPC first when `BASE_RPC_URL` is set (a server-side secret, hard
 * rule 14 — a provider URL usually carries its key), then the public ones. MEASURED 2026-11-04 on the
 * first Vercel deploy: mainnet.base.org answered 429 to eth_getLogs from Vercel and the index stopped at
 * block 52,096,272, 1.4M blocks behind — Base's docs say the public endpoints are not for production.
 */
export function indexerRpc(env: Env): Rpc | undefined {
  const own = env.BASE_RPC_URL;
  if (!own || !/^https:\/\//.test(own)) return undefined;
  return (method, params) => rpcOn(BASE.name, [own, ...INDEXER_RPC], method, params);
}

export function cdpFrom(env: Env): CdpCredentials | null {
  return env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET ? { keyId: env.CDP_API_KEY_ID, secret: env.CDP_API_KEY_SECRET } : null;
}

/**
 * The request as the visitor sent it. MEASURED 2026-11-04 on the first paid 402 from Vercel: a catch-all
 * function (`api/skills/[...path].js`) is handed the URL with Vercel's own `...path=<segments>` query
 * parameter added, which then showed in the 402's `resource` — the URL an agent is told it is paying for.
 */
export function asSent(request: Request): Request {
  const url = new URL(request.url);
  const routed = [...url.searchParams.keys()].filter((k) => k.startsWith("..."));
  if (routed.length === 0) return request;
  for (const k of routed) url.searchParams.delete(k);
  return new Request(url, request);
}

function problem(status: number, detail: string): Response {
  return new Response(JSON.stringify({ status, detail, origin: "quadra-server" }), { status, headers: { "content-type": "application/problem+json" } });
}

/**
 * The routes a production deploy serves, each a `Request → Response`. `blob` is the Vercel Blob SDK's
 * `get`/`put`; `indexer` overrides the indexer's chain and clock (tests).
 */
export function routes(env: Env, fetchImpl: typeof fetch = fetch, blob: BlobCalls | null = null, indexer: IndexerDeps = {}) {
  const creds = cdpFrom(env);
  const token = env.BLOB_READ_WRITE_TOKEN ?? null;
  // a connected store arrives as a read-write token, or as a store id the SDK reaches with Vercel's OIDC token
  const connected = token !== null || Boolean(env.BLOB_STORE_ID);
  const chain = indexerRpc(env);
  const makeIndex = (readOnly: boolean) => connected && blob
    ? indexerHandler({ ...(chain ? { rpc: chain } : {}), ...indexer, readOnly, store: blobStore(blob, token, env.BLOB_ACCESS === "public" ? "public" : "private") })
    : async () => problem(503, "The launchpad index needs a Vercel Blob store connected to this project (BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID).");
  // Keep request-driven catch-up until a frequent production worker is configured.
  const launchpad = makeIndex(false);
  const syncIndex = makeIndex(false);
  const stocks = stocksHandler(fetchImpl);
  const charts = chartsHandler(fetchImpl);
  const logo = logoHandler(fetchImpl);
  const weekend = weekendHandler(fetchImpl);
  const region = regionHandler();
  const skills = apiHandler({ facilitator: creds ? cdpFacilitator(creds, fetchImpl) : null });
  return {
    stocks: (request: Request) => stocks(asSent(request)),
    charts: (request: Request) => charts(asSent(request)),
    logo: (request: Request) => logo(asSent(request)),
    weekend: (request: Request) => weekend(asSent(request)),
    region: (request: Request) => region(request),
    skills: (request: Request) => skills(asSent(request)),
    launchpad: (request: Request) => launchpad(asSent(request)),
    /** Vercel Cron's daily call: the index stepped forward with nobody asking. Vercel sends `CRON_SECRET` as a bearer. */
    cron: async (request: Request): Promise<Response> => {
      if (env.CRON_SECRET && request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) return problem(401, "Only Vercel Cron may run the index step.");
      return syncIndex(new Request(new URL(`${INDEXER_PATH}/creators`, request.url), { headers: { "x-quadra": "1" } }));
    },
  };
}
