import { useEffect, useState } from "react";
import { BRAND } from "@/brand";
import { API_PATH } from "@/server/apiPath";
import { Page } from "@/pages/Page";
import { Link } from "react-router-dom";
import { INDEXER_PATH } from "@/server/indexerPath";
import "./About.css";
import "./Docs.css";
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
    : "each call priced, but this deployment is not accepting x402 payments";
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
            <Crt label="Try it">{`curl -fsS "${origin}${API_PATH}"${state.selling ? `\ncurl -i "${origin}${API_PATH}/radar"` : ""}`}</Crt>
            {state.selling && <p className="dim">
              The second command requests a payment challenge. A compatible x402 client reads <code>PAYMENT-REQUIRED</code>,
              signs the exact USDC authorization on Base and retries with <code>PAYMENT-SIGNATURE</code>.
              A successful payment returns a settlement receipt in <code>PAYMENT-RESPONSE</code>.
            </p>}
          </>
        ) : (
          <p className="dim">
            No <code>curl</code> for these while this origin does not answer them: a copyable command for an endpoint that answers
            nothing reads as tested, and the first thing it does is fail in a terminal.
          </p>
        )}
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


export function Developers() {
  const origin = location.origin;
  return (
    <div className="about docs">
      <header className="about__bar">
        <Link className="about__brand" to="/about">{BRAND.name}</Link>
        <nav aria-label="Developer navigation">
          <Link to="/docs">Docs</Link>
          <Link to="/" state={{ fromPage: true }} className="about__button about__button--small">Open Quadra</Link>
        </nav>
      </header>
      <main className="docs__main">
        <header className="docs__intro">
          <h1>Build with <em>Quadra.</em></h1>
          <p>Read launchpad data on Base, discover available skills and connect an agent.</p>
        </header>
        <div className="docs__layout">
          <nav className="docs__toc" aria-label="On this page">
            <a href="#launchpad">Launchpad data</a>
            <a href="#skills">Skills API</a>
            <a href="#agents">Agent integration</a>
            <a href="#errors">Errors and freshness</a>
          </nav>
          <article className="docs__article">
            <section className="docs__section" id="launchpad">
              <h2>Launchpad data</h2>
              <p>Read indexed Quadra launches on Base (chain ID 8453). Send the <code>x-quadra: 1</code> request header.</p>
              <ul className="notes">
                <li><code>GET {INDEXER_PATH}/coins</code> — coin and creator snapshot.</li>
                <li><code>GET {INDEXER_PATH}/creators</code> — creator snapshot.</li>
                <li><code>GET {INDEXER_PATH}/coin?token=0x…</code> — a coin’s indexed trades and candles.</li>
              </ul>
              <Crt label="Read launches">{`curl -fsS -H 'x-quadra: 1' "${origin}${INDEXER_PATH}/coins"`}</Crt>
              <p>To create a coin, trade or collect fees, use the corresponding Quadra app window and review the transaction in your wallet.</p>
            </section>
            <section className="docs__section" id="skills">
              <h2>Skills API</h2>
              <p>Discovery is free. Use the catalog to look up the skill ID, arguments and price. Pass one <code>arg</code> parameter for each positional argument, in order.</p>
              <ApiBody />
            </section>
            <section className="docs__section" id="agents">
              <h2>Agent integration</h2>
              <p>From the Quadra repository, run the bundled stdio MCP server and point your MCP client at the same command.</p>
              <Crt label="Start the MCP server">node tools/quadra-mcp/index.mjs</Crt>
              <p>Start with <code>quadra_list_tools</code> to discover the tools and their input requirements.</p>
            </section>
            <section className="docs__section" id="errors">
              <h2>Errors and freshness</h2>
              <p>Check <code>syncedTo</code>, <code>behind</code> and <code>error</code> before treating indexed activity as complete. A coin lookup can return 404 if the index has yet to reach its launch.</p>
              <p>For skill calls, 402 carries the payment requirements, 422 indicates the skill could not produce a report, and 503 means the service cannot accept payment. If settlement is ambiguous, check the receipt before signing again.</p>
            </section>
          </article>
        </div>
      </main>
      <footer className="about__foot">
        <div className="about__foot-inner docs__footer">
          <span>{BRAND.name} · built on Base</span>
          <nav aria-label="Developer footer"><Link to="/docs">Product docs</Link><Link to="/about">About Quadra</Link></nav>
        </div>
      </footer>
    </div>
  );
}
