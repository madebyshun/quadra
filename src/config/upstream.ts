/**
 * The paid-tool directories this app can read. There is one today, BlueAgent,
 * and it is a DIRECTORY this app reads and pays — not a platform the product is
 * built on. That distinction was decided by the owner on 2026-09-29: this product
 * is private money for agents, and a catalog of tools to spend it on is an input,
 * the same way any x402 endpoint is. Nothing about who gets paid is decided here —
 * see `config/payees.ts`. (Deliberately no brand name in this file — see brand.ts.)
 *
 * Measured against production on 2026-09-27 — re-measure, do not trust a number
 * written here:
 *   GET /api/catalog      → 200, every tool with price + input schema, free
 *   GET /api/mcp          → 200, free discovery
 *   GET /api/x402/<id>    → 402 quote + input schema, free (payment is POST-only)
 *   POST /api/x402/<id>   → 402 until an X-PAYMENT header settles
 */

/**
 * The same-origin path a run goes through, and why a run needs one at all.
 *
 * Reads are cross-origin and fine: `GET /api/catalog` and `GET /api/x402/<id>` both
 * send `access-control-allow-origin: *`. A run is POST-only, and POST is the one verb
 * upstream does not open up — measured 2026-09-27, its `OPTIONS` preflight answers 204
 * with no CORS header at all, and the plain-text POST that skips the preflight answers
 * 200 without one either. So the browser refuses every run, free ones included.
 *
 * Forwarding through this origin removes the cross-origin question rather than
 * answering it: the browser is talking to its own host, and the host talks to upstream.
 * `vite.config.ts` proxies it in development. There is no such forwarder in a static
 * production build, which is why `HttpCatalog.run` checks what came back instead of
 * assuming: measured against this repo's own `dist/`, an absent forwarder answers 501
 * with an HTML error page on a plain static host and 200 with `index.html` on one doing
 * SPA rewrites. Neither status says "no forwarder", so the body is what gets checked.
 */
export const FORWARD = {
  prefix: "/upstream",
  tool: (id: string) => `/upstream/api/x402/${id}`,
} as const;

export const BLUEAGENT = {
  /** Directory name, as a person reads it. */
  name: "BlueAgent",
  /**
   * The origin its 402s come from — what `config/payees.ts` pins a payee against.
   * `tests/upstream.test.ts` asserts it is `new URL(base).origin`, so the two cannot
   * drift into a pin keyed by a host that never answers.
   */
  origin: "https://blueagent.dev",
  base: "https://blueagent.dev",
  catalog: "https://blueagent.dev/api/catalog",
  tool: (id: string) => `https://blueagent.dev/api/x402/${id}`,
  mcp: "https://blueagent.dev/api/mcp",
  /**
   * BlueAgent's own payee. We never send here directly — the router
   * reads `payTo` out of the live 402 response instead, so a change upstream
   * cannot silently misroute a payment. Kept only to assert against.
   */
  knownPayTo: "0x02950ad38ada1d599375bd447e080cd404809205",
} as const;

/** Coinbase CDP facilitator — verifies and settles the EIP-3009 authorization. */
export const CDP = {
  facilitator: "https://api.cdp.coinbase.com/platform/v2/x402",
  verify: "https://api.cdp.coinbase.com/platform/v2/x402/verify",
  settle: "https://api.cdp.coinbase.com/platform/v2/x402/settle",
} as const;
