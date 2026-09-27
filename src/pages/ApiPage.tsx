import { BRAND } from "@/brand";
import { BLUEAGENT } from "@/config/upstream";
import { Page } from "@/pages/Page";
import { Crt } from "@/ui/Crt";

/**
 * What this origin serves, and what it does not.
 *
 * This page used to open with "two endpoints, both public, both free to read"
 * and print a `curl` for each. Neither existed. It was harmless while the site
 * was unpublished and would have been a live falsehood the day it shipped —
 * the exact overstated-capability failure the MCP panel warns about, on the one
 * page a developer trusts most.
 *
 * So the shape below is deliberate: a `live` flag per endpoint, rendered as a
 * badge, with a test asserting every entry that is not live says so. Honesty
 * here is a structural property rather than a sentence someone remembered to
 * write, because the sentence is what goes stale the day an endpoint ships.
 */

export type Endpoint = {
  method: "GET";
  path: string;
  /** what it would answer — present tense only when `live` */
  what: string;
  /** true once this origin really serves it */
  live: boolean;
};

/**
 * Planned, not served. This is a static single-page build: there is no server
 * on this origin to answer either of these, which is the same reason a run
 * cannot reach upstream without a forwarder. See `FORWARD` in config/upstream.
 */
export const ENDPOINTS: readonly Endpoint[] = [
  {
    method: "GET",
    path: "/api/services",
    what: "Everything this router can pay, with what each one costs.",
    live: false,
  },
  {
    method: "GET",
    path: "/api/pool",
    what:
      "The pool right now: how much is in it, and how many notes it is holding. Never who owns them, because the pool does not know either.",
    live: false,
  },
] as const;

/**
 * Takes the list rather than reading `ENDPOINTS`, for the same reason
 * `installLine` in McpPanel takes `published` and `assertDeployed` in
 * config/chain takes an address: every entry is `live: false` today, so a
 * function that closed over the real list could never reach its own shipped
 * wording. The sentence a user reads on the day the first endpoint goes up
 * should not make its debut untested.
 */
export function apiLede(endpoints: readonly Endpoint[]): string {
  return endpoints.some((e) => e.live)
    ? `What ${BRAND.domain} serves, and what it does not yet.`
    : `${BRAND.name} is a single page with no server behind it, so ${BRAND.domain} serves no API today. The endpoints below are the intended shape, not a surface you can call.`;
}

/** Same reasoning, one endpoint at a time. */
export function endpointBadge(live: boolean): { className: string; label: string } {
  return live
    ? { className: "chip chip--ok", label: "live" }
    : { className: "chip chip--warn", label: "not built" };
}

export function ApiPage() {
  return (
    <Page title="API">
      <p className="panel__lede">{apiLede(ENDPOINTS)}</p>

      <fieldset className="group">
        <legend>Planned on this origin</legend>
        <ul className="notes" aria-label="Endpoints">
          {ENDPOINTS.map((e) => {
            const badge = endpointBadge(e.live);
            return (
              <li key={e.path}>
                <span className="notes__row">
                  <code className="notes__id">
                    {e.method} {e.path}
                  </code>
                  <span className={badge.className}>{badge.label}</span>
                </span>
                <span className="notes__why">{e.what}</span>
              </li>
            );
          })}
        </ul>
        <p className="dim">
          No <code>curl</code> for these on purpose. A copyable command for an endpoint that answers
          nothing is worse than no example: it reads as tested, and the first thing it does is fail
          in a terminal.
        </p>
      </fieldset>

      {/*
        The one API this product really does talk to. It belongs on this page
        because it is the honest answer to "what can I call" — it is just
        somebody else's origin, and saying so is the difference between a
        dependency and a claim.
      */}
      <fieldset className="group">
        <legend>What this app reads</legend>
        <p className="panel__lede">
          The tools come from BlueAgent, live, every time the x402 window opens. Nothing about them
          is cached in this repo — a price written down here would go stale silently, and the
          failure mode is agreeing to the wrong amount.
        </p>
        <Crt label="Upstream catalog">{`curl ${BLUEAGENT.catalog}`}</Crt>
        <p className="dim">
          Public and free to read, measured 2026-09-27. Reads are open to any origin; a run is a
          POST and is not, which is why runs go through a same-origin forwarder.
        </p>
      </fieldset>
    </Page>
  );
}
