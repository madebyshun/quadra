import { useEffect, useState } from "react";
import { BRAND } from "@/brand";
import { BLUEAGENT } from "@/config/upstream";
import { API_PATH } from "@/server/apiPath";
import { Page } from "@/pages/Page";
import { Crt } from "@/ui/Crt";

/**
 * What this origin serves, and what it does not — ASKED, not written down.
 *
 * This page once opened with "two endpoints, both public, both free to read" and a `curl` for
 * each, and neither existed. Then it listed them as "not built", which was true until the API
 * was built (2026-09-30: every skill over HTTP, sold per call over x402). Both versions were a
 * sentence someone had to remember to change. Now the page asks `GET /api/skills` when it opens
 * and badges each endpoint from the answer: served or not, and — for the paid call — selling or
 * not, since a server without the owner's CDP key lists and prices but cannot collect.
 *
 * The rule the tests hold it to is unchanged: a copyable command for this origin appears only
 * when this origin has just answered that command.
 */

export type ApiState =
  | { readonly kind: "reading" }
  | { readonly kind: "absent" }
  | { readonly kind: "live"; readonly skills: number; readonly usd: string | null; readonly selling: boolean };

export type Endpoint = { readonly method: "GET"; readonly path: string; readonly what: string; readonly paid: boolean };

export const ENDPOINTS: readonly Endpoint[] = [
  { method: "GET", path: API_PATH, what: "Every skill, the arguments each takes, and the price. Free.", paid: false },
  {
    method: "GET",
    path: `${API_PATH}/<id>?arg=…`,
    what: "Run one skill and get its report as JSON — the same report the Terminal prints. Paid per call over x402: exact scheme, USDC on Base, settled through Coinbase's facilitator. A call that fails is not charged.",
    paid: true,
  },
];

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Ask this origin for its skill list. Anything but that list — a static host's page, an error — is `absent`. */
export async function probeApi(): Promise<ApiState> {
  try {
    const res = await fetch(API_PATH, { headers: { accept: "application/json" } });
    const body: unknown = await res.json();
    if (!res.ok || !isObj(body) || !Array.isArray(body.skills)) return { kind: "absent" };
    const usd = isObj(body.price) && typeof body.price.usd === "string" ? body.price.usd : null;
    return { kind: "live", skills: body.skills.length, usd, selling: body.selling === true };
  } catch {
    return { kind: "absent" };
  }
}

export function endpointBadge(state: ApiState, paid: boolean): { className: string; label: string } {
  if (state.kind === "reading") return { className: "chip", label: "checking…" };
  if (state.kind === "absent") return { className: "chip chip--warn", label: "not served here" };
  if (paid && !state.selling) return { className: "chip chip--warn", label: "not selling yet" };
  return { className: "chip chip--ok", label: "live" };
}

export function apiLede(state: ApiState, origin: string): string {
  if (state.kind === "reading") return `Asking ${origin} what it serves…`;
  if (state.kind === "absent") {
    return `${origin} answers no API — ${BRAND.name} is being served here without its server. On its own server the endpoints below answer.`;
  }
  const paid = state.selling
    ? `each call ${state.usd ? `from ${state.usd}` : "priced"} over x402`
    : "each call priced, but payments are not switched on yet: this server has no Coinbase CDP key to collect them";
  return `${origin} serves ${state.skills} skills over HTTP — the list free, ${paid}.`;
}

/** The page body alone — see `DocsBody` for why this is split out. */
export function ApiBody() {
  const [state, setState] = useState<ApiState>({ kind: "reading" });
  useEffect(() => {
    let live = true;
    void probeApi().then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, []);
  const origin = location.origin;

  return (
    <>
      <p className="panel__lede">{apiLede(state, origin)}</p>

      <fieldset className="group">
        <legend>Endpoints</legend>
        <ul className="notes" aria-label="Endpoints">
          {ENDPOINTS.map((e) => {
            const badge = endpointBadge(state, e.paid);
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
        {state.kind === "live" ? (
          <>
            <Crt label="Try it">{`curl ${origin}${API_PATH}\ncurl -i ${origin}${API_PATH}/radar`}</Crt>
            <p className="dim">
              The second answers 402 with a <code>PAYMENT-REQUIRED</code> header: base64 JSON naming the price, USDC on Base, and{" "}
              {BRAND.name}&apos;s fee address. Sign an EIP-3009 authorization for exactly that, send it back as{" "}
              <code>PAYMENT-SIGNATURE</code>, and the report comes back with the settlement in <code>PAYMENT-RESPONSE</code>. The x402
              window pays these for you; any x402 client can.
            </p>
          </>
        ) : (
          <p className="dim">
            No <code>curl</code> for these while this origin does not answer them: a copyable command for an endpoint that answers
            nothing reads as tested, and the first thing it does is fail in a terminal.
          </p>
        )}
      </fieldset>

      {/*
        The other directory the x402 window reads. It belongs here because it is the honest
        answer to "what else can I call" — somebody else's origin, named as such.
      */}
      <fieldset className="group">
        <legend>What this app reads</legend>
        <p className="panel__lede">
          The x402 window lists this app&apos;s own tools. External x402 payments and the {BLUEAGENT.name} catalog are disabled
          in this build. The upstream catalog below is a reference, not an enabled payment flow.
        </p>
        <Crt label="Upstream catalog">{`curl ${BLUEAGENT.catalog}`}</Crt>
      </fieldset>
    </>
  );
}

export function ApiPage() {
  return (
    <Page title="API">
      <ApiBody />
    </Page>
  );
}
