import { apiHandler } from "@/server/api";
import { cdpFacilitator, type CdpCredentials } from "@/server/cdp";
import { chartsHandler } from "@/server/charts";
import { stocksHandler } from "@/server/stocks";

/**
 * The production server (T3, 2026-11-04): the same Fetch-API handlers the dev server mounts in
 * `vite.config.ts`, built for Vercel Functions. `scripts/build-api.mjs` bundles one entry per route
 * into `api/` (Vercel's own folder), because Vercel's compiler does not follow this repo's `@/` alias.
 *
 * What is NOT here yet, on purpose:
 *   - the launchpad indexer (`server/indexer.ts`) — it holds its index in memory and re-reads the chain
 *     from launch v1 on a cold start; a function needs a store (Vercel Blob/KV) and a cron first;
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

/** The three routes a production deploy serves, each a `Request → Response`. */
export function routes(env: Env, fetchImpl: typeof fetch = fetch) {
  const creds = cdpFrom(env);
  return {
    stocks: stocksHandler(fetchImpl),
    charts: chartsHandler(fetchImpl),
    skills: apiHandler({ facilitator: creds ? cdpFacilitator(creds, fetchImpl) : null }),
  };
}
