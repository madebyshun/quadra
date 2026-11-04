import { apiHandler } from "@/server/api";
import { cdpFacilitator, type CdpCredentials } from "@/server/cdp";
import { chartsHandler } from "@/server/charts";
import { stocksHandler } from "@/server/stocks";
import { indexerHandler, type IndexerDeps } from "@/server/indexer";
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

export function cdpFrom(env: Env): CdpCredentials | null {
  return env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET ? { keyId: env.CDP_API_KEY_ID, secret: env.CDP_API_KEY_SECRET } : null;
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
  const token = env.BLOB_READ_WRITE_TOKEN;
  const launchpad =
    token && blob
      ? indexerHandler({ ...indexer, store: blobStore(blob, token, env.BLOB_ACCESS === "public" ? "public" : "private") })
      : async () => problem(503, "The launchpad index needs a Vercel Blob store connected to this project (BLOB_READ_WRITE_TOKEN).");
  return {
    stocks: stocksHandler(fetchImpl),
    charts: chartsHandler(fetchImpl),
    skills: apiHandler({ facilitator: creds ? cdpFacilitator(creds, fetchImpl) : null }),
    launchpad,
    /** Vercel Cron's daily call: the index stepped forward with nobody asking. Vercel sends `CRON_SECRET` as a bearer. */
    cron: async (request: Request): Promise<Response> => {
      if (env.CRON_SECRET && request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) return problem(401, "Only Vercel Cron may run the index step.");
      return launchpad(new Request(new URL(`${INDEXER_PATH}/creators`, request.url), { headers: { "x-quadra": "1" } }));
    },
  };
}
