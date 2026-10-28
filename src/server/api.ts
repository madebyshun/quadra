import { BRAND } from "@/brand";
import { apiRequirements, priceOf, type ApiRequirements } from "@/config/api";
import { BASE, USDC } from "@/config/chain";
import { messageOf } from "@/lib/errors";
import { jsonFromBase64, PAYMENT_REQUIRED, PAYMENT_RESPONSE, PAYMENT_SIGNATURE, toBase64Utf8 } from "@/lib/x402http";
import { findSkill, reportText, SKILLS } from "@/skills";
import type { Facilitator, SettleResponse } from "@/server/cdp";
import { API_PATH } from "@/server/apiPath";

/**
 * This app's own API: every skill over HTTP, sold per call over x402 — the owner's decision of
 * 2026-09-30. It turns this app from only a BUYER of x402 into a seller too, and it sells the
 * same skills the windows, the Terminal and the MCP server run, so an agent paying here gets
 * exactly what a person sees.
 *
 *   GET /api/skills                  free — every skill, its arguments and its price
 *   GET /api/skills/<id>?arg=…       402 with the price; paid, the skill's report as JSON
 *
 * ── The order of a paid call, and why ─────────────────────────────────────────
 *  1. The PAYMENT-SIGNATURE must be for exactly what this API asks — scheme, network, asset,
 *     amount, payee, window — checked HERE before anyone else is asked. The facilitator checks
 *     the signature and the balance; this checks that the thing signed is this sale.
 *  2. The facilitator VERIFIES it (Coinbase CDP — `server/cdp.ts`).
 *  3. The skill runs. If it fails — a bad argument, a source that is down — nothing is settled
 *     and the buyer is not charged: a 422 with the reason and `charged: false`.
 *  4. The facilitator SETTLES, and only a settled payment gets the report. A second use of the
 *     same authorization fails here (its nonce is spent), so a replay gets nothing.
 *     CDP's `settlement_pending` is not a failure (docs.cdp.coinbase.com, "Settlement Pending"):
 *     the same request is sent once more, and if it is still pending the report is delivered
 *     with that status in PAYMENT-RESPONSE — the transaction is on its way and the buyer paid.
 *
 * ── What it refuses to do ─────────────────────────────────────────────────────
 * Without a facilitator key (`CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`) or a fee address it sells
 * nothing and says so with a 503 — it never answers 402 for a payment it cannot collect, which
 * would have a buyer sign an authorization for nothing. The list stays free either way.
 *
 * CORS is open (`*`) and the x402 headers are exposed: an agent in a browser is a buyer too.
 */

export type ApiOptions = {
  /** `null` until the owner's CDP key is present — then every paid call is a named 503 */
  readonly facilitator: Facilitator | null;
  /** the fee address; `undefined` means the configured `CONTRACTS.treasury` */
  readonly treasury?: string | null;
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": `${PAYMENT_REQUIRED}, ${PAYMENT_RESPONSE}`,
};

function answer(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS, ...headers } });
}

function problem(status: number, detail: string, extra: Record<string, unknown> = {}): Response {
  return answer(status, { status, detail, origin: "quadra-server", ...extra });
}

export const NO_FACILITATOR = `${BRAND.name}'s paid API needs a Coinbase CDP key (CDP_API_KEY_ID and CDP_API_KEY_SECRET) to collect x402 payments, and this server has none. Nothing was charged.`;
export const NO_TREASURY = `${BRAND.name}'s paid API has no fee address set, so there is nobody to pay. Nothing was charged.`;

/** The price as people read it — "$0.005". */
function dollars(amount: string): string {
  return `$${(Number(amount) / 10 ** USDC.decimals).toString()}`;
}

/** The 402: the PaymentRequired message in the header (the x402 v2 contract) and mirrored in the body. */
function paymentRequired(resource: string, description: string, requirements: ApiRequirements, error: string): Response {
  const message = {
    x402Version: 2,
    error,
    resource: { url: resource, description, mimeType: "application/json" },
    accepts: [requirements],
  };
  return answer(402, message, { [PAYMENT_REQUIRED]: toBase64Utf8(JSON.stringify(message)) });
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/**
 * Why a PaymentPayload is not for this sale, or `null` when it is. Every field that decides
 * the money, checked against what this API asked — never against what the buyer claims.
 */
export function mismatch(payload: unknown, req: ApiRequirements): string | null {
  if (!isObj(payload) || payload.x402Version !== 2) return "It is not an x402 version 2 payment.";
  const a = payload.accepted;
  if (!isObj(a)) return "It does not say which payment it accepted.";
  if (a.scheme !== req.scheme || a.network !== req.network) return `It is for ${String(a.scheme)} on ${String(a.network)}, not exact on ${req.network}.`;
  if (!same(a.asset, req.asset)) return "It pays in a different token than USDC on Base.";
  if (a.amount !== req.amount) return `It pays ${String(a.amount)}, not the ${req.amount} (${dollars(req.amount)}) this costs.`;
  if (!same(a.payTo, req.payTo)) return `It pays someone other than ${BRAND.name}'s fee address.`;
  if (a.maxTimeoutSeconds !== req.maxTimeoutSeconds) return "It names a different settlement window than this API offered.";
  const extra = isObj(a.extra) ? a.extra : {};
  if (extra.name !== req.extra.name || extra.version !== req.extra.version) return "It names a different USDC signing domain.";
  const auth = isObj(payload.payload) && isObj(payload.payload.authorization) ? payload.payload.authorization : null;
  if (!auth) return "It carries no EIP-3009 authorization.";
  if (!same(auth.to, req.payTo) || auth.value !== req.amount) return "Its signed authorization is not for this amount to this payee.";
  return null;
}

/** The cheapest skill's price, as the list's headline figure. */
const cheapest = () => SKILLS.map((s) => priceOf(s.id)).reduce((a, b) => (b < a ? b : a)).toString();

/** Every skill, free to read — what an agent asks first. `selling` says whether a paid call can be collected here. */
function list(origin: string, req: ApiRequirements | null, selling: boolean): Response {
  return answer(200, {
    x402Version: 2,
    network: `eip155:${BASE.id}`,
    selling,
    // the cheapest call — each skill states its own price below (priced per skill since 2026-10-02)
    price: req ? { amount: cheapest(), asset: req.asset, payTo: req.payTo, usd: dollars(cheapest()), from: true } : null,
    skills: SKILLS.map((s) => ({
      id: s.id,
      title: s.title,
      summary: s.summary,
      args: s.args.map((a) => ({ name: a.name, hint: a.hint, optional: a.optional === true })),
      url: `${origin}${API_PATH}/${s.id}`,
      price: { amount: priceOf(s.id).toString(), usd: dollars(priceOf(s.id).toString()) },
    })),
  });
}

export function apiHandler(options: ApiOptions) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...CORS, "access-control-allow-methods": "GET", "access-control-allow-headers": `${PAYMENT_SIGNATURE}, content-type` },
      });
    }
    if (request.method !== "GET") return problem(405, `${BRAND.name}'s API takes GET.`);
    const url = new URL(request.url);
    const origin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
    const rest = url.pathname.slice(API_PATH.length).replace(/^\/|\/$/g, "");
    const req = apiRequirements(options.treasury === undefined ? undefined : options.treasury);
    if (rest === "") return list(origin, req, req !== null && options.facilitator !== null);
    const skill = rest.includes("/") ? null : findSkill(rest.toLowerCase());
    if (!skill) return problem(404, `There is no skill called "${rest}". GET ${API_PATH} lists them.`);
    if (!req) return problem(503, NO_TREASURY);
    if (!options.facilitator) return problem(503, NO_FACILITATOR);
    // the 402 and every check after it are for THIS skill's price
    const sale = apiRequirements(req.payTo, skill.id)!;

    const args = url.searchParams.getAll("arg");
    const resource = `${origin}${url.pathname}${url.search}`;
    const header = request.headers.get(PAYMENT_SIGNATURE);
    if (header === null) return paymentRequired(resource, `${skill.title} — ${skill.summary}`, sale, `${PAYMENT_SIGNATURE} header is required`);

    let payload: unknown;
    try {
      payload = jsonFromBase64(header, PAYMENT_SIGNATURE);
    } catch (e) {
      return problem(400, messageOf(e));
    }
    const wrong = mismatch(payload, sale);
    if (wrong) return paymentRequired(resource, skill.title, sale, `This payment is not for this call: ${wrong}`);

    const f = options.facilitator;
    try {
      const verified = await f.verify(payload, sale);
      if (!verified.isValid) {
        return paymentRequired(resource, skill.title, sale, `The facilitator refused the payment: ${verified.invalidMessage ?? verified.invalidReason ?? "no reason given"}.`);
      }
    } catch (e) {
      return problem(502, `${messageOf(e)} Nothing was charged.`);
    }

    let report;
    try {
      report = await skill.run(args);
    } catch (e) {
      return problem(422, `${messageOf(e)} The payment was not collected.`, { charged: false });
    }

    let settled: SettleResponse;
    try {
      settled = await f.settle(payload, sale);
      if (!settled.success && settled.errorReason === "settlement_pending" && settled.transaction) settled = await f.settle(payload, sale);
    } catch (e) {
      return problem(502, `${messageOf(e)} The report was not delivered.`);
    }
    if (!settled.success && settled.errorReason !== "settlement_pending") {
      return paymentRequired(resource, skill.title, sale, `Settlement failed: ${settled.errorMessage ?? settled.errorReason ?? "no reason given"}. Nothing was delivered.`);
    }
    return answer(200, { skill: skill.id, report, text: reportText(report) }, { [PAYMENT_RESPONSE]: toBase64Utf8(JSON.stringify(settled)) });
  };
}
