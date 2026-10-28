import type { Catalog, Price, Quote, Settlement, Tool, ToolField, ToolRun } from "@/adapters/types";
import { BLUEAGENT, FORWARD } from "@/config/upstream";
import { checkRequirements, whyNotSign } from "@/lib/requirements";
import { jsonFromBase64, readPaymentRequired, settledTransaction } from "@/lib/x402http";

/**
 * The real upstream catalog, read over the network.
 *
 * Browsing and pricing are genuinely live here: both are free, unauthenticated
 * GETs, and both send `access-control-allow-origin: *`, so the browser reads them
 * directly with no proxy and no key. 115 real tools with the prices their payee is
 * actually asking for.
 *
 * ── Why a run needs a forwarder, and why that is not a wallet problem ─────────
 * The obvious blocker is "no wallet", and for paid tools it is real. But it is not
 * the one that bites first:
 *
 *   MEASURED 2026-09-27, from a browser origin (http://localhost:5273):
 *     GET  /api/catalog     → 200, access-control-allow-origin: *
 *     GET  /api/x402/<id>   → 402, access-control-allow-origin: *
 *     OPTIONS /api/x402/<id> → 204, `allow: GET, HEAD, OPTIONS, POST`
 *                              and NO access-control-allow-origin at all
 *     POST /api/x402/<id>   → 200, and NO access-control-allow-origin either
 *
 * Running a tool is POST-only. The preflight carries no CORS headers, so a JSON
 * POST never leaves the browser; and the plain-text POST that skips the preflight
 * comes back without the header too, so the browser refuses to let this code read
 * it. That applies to the six $0.00 ids as much as the paid ones — **free does not
 * mean reachable.**
 *
 * `run` therefore goes through `FORWARD`, a same-origin path this app's own dev
 * server proxies upstream. That removes the cross-origin question instead of
 * answering it. Measured through the proxy the same day:
 *
 *     POST /upstream/api/x402/hood-live   → 200, a real Hood board snapshot
 *     POST /upstream/api/x402/token-price → 402, accepts[0] with payTo + amount
 *
 * So the six free ids genuinely run through the forwarder with no header at all, and
 * the other 109 need a `payment` header built by `lib/payment.ts` from a wallet's
 * signature — `run`'s third parameter, attached as `X-Payment` when the caller has one.
 * That is why `whyNot` takes a price: one flag for the whole adapter had to lie about
 * one half of the catalog. As of the payment header landing, `whyNot` reports only a
 * payee this build does not recognise — whether a *wallet* is ready to sign is a
 * separate, changeable-by-the-second fact that the panel tracks itself (`lib/wallet.ts`),
 * not something baked into a price the way a payee mismatch is.
 *
 * ── What this deliberately does not do ───────────────────────────────────────
 * It does not fall back to the local stub when the network fails. An empty panel
 * that says why is honest; four fabricated tools that look like a catalog are not.
 */

/* ── reading upstream's json without trusting its shape ───────────────────────── */

type Json = Record<string, unknown>;

function obj(value: unknown, what: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Upstream sent ${what} that is not a JSON object.`);
  }
  return value as Json;
}

function str(value: unknown, what: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`Upstream sent no ${what}.`);
  }
  return value;
}

/**
 * Turn a JSON-Schema input block into the fields the panel renders.
 *
 * Order comes from `properties`, which is upstream's own declaration order, so the
 * form reads the way its documentation does.
 */
export function parseFields(input: unknown): ToolField[] {
  const schema = obj(input ?? {}, "an input schema");
  const properties = obj(schema.properties ?? {}, "an input schema");
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((n) => typeof n === "string") : [],
  );
  return Object.keys(properties).map((name) => ({ name, required: required.has(name) }));
}

export function parseTool(value: unknown): Tool {
  const t = obj(value, "a tool");
  return {
    id: str(t.id, "tool id"),
    title: str(t.name, "tool name"),
    summary: str(t.description, "tool description"),
    inputs: parseFields(t.input),
  };
}

/**
 * Whether the list says this one costs nothing. Used to ORDER the select, and for
 * nothing else.
 *
 * `Tool` deliberately drops the price upstream ships with the catalog, because a price
 * on the tool invites the UI to render it instead of the quote — the stale-price bug
 * the panel exists to avoid. Reading `priceUsdcUnits` here does not reopen that: the
 * live quote is still the only price displayed and the only thing that enables the
 * button. A hint that has gone stale can therefore mis-order the list and cannot
 * mis-charge anyone — an id the list calls free and the 402 calls paid sorts to the
 * top and still renders as paid, with the reason underneath and the button disabled.
 *
 * Anything that is not the number zero counts as paid. Free is the claim that needs
 * evidence; without it a tool belongs with the ones that want money.
 */
function looksFree(value: unknown): boolean {
  return value === 0;
}

/**
 * Every tool upstream lists, with the ones that can actually be run first.
 *
 * MEASURED 2026-09-27: upstream's own order opens on `token-price`, and the six $0.00
 * ids sit at indices 2, 3, 4, 83, 87 and 88. Preserving that order meant the x402
 * window opened on a paid tool with a dead button, while the four ids that genuinely
 * run through the forwarder were buried in a list of 115. So the select is not a
 * faithful copy of upstream's ordering, on purpose.
 *
 * The sort is stable, which is the whole reason it is allowed to be this blunt:
 * within each half upstream's declaration order survives untouched, so the list still
 * reads the way its documentation does.
 */
export function parseTools(body: unknown): Tool[] {
  const raw = obj(body, "a catalog").tools;
  if (!Array.isArray(raw)) {
    throw new Error("The catalog answered without a `tools` array.");
  }
  return raw
    .map((entry) => ({ tool: parseTool(entry), free: looksFree(obj(entry, "a tool").priceUsdcUnits) }))
    .sort((a, b) => Number(b.free) - Number(a.free))
    .map((entry) => entry.tool);
}

/**
 * Read a price off a quote response.
 *
 * Three outcomes upstream really produces, and the third is not a price. A 501
 * `TOOL_UNAVAILABLE` throws rather than being squeezed into `Price`, because a caller
 * holding a `Price` is entitled to assume there is something to pay.
 *
 * ── Which ids actually take that path, measured across all 115 ───────────────────
 * This comment used to say `honeypot` answers 501 "while the catalog still lists it",
 * and drew the moral that "listed" and "callable" are different questions. Quoting
 * every id the catalog returns (2026-09-27) says otherwise: 109 paid, 6 free, **0
 * dead**. `honeypot` is not among the 115 at all — the live id is `honeypot-check`,
 * which quotes 402 normally.
 *
 * The branch is still load-bearing, for the inverse reason. Upstream's own 501 hint
 * reads "This tool id exists in the public catalog but is not currently implemented",
 * which the catalog itself contradicts. So the ids reaching here are the ones NOT in
 * the list: a stale name from an older catalog, a cached MCP manifest, or a hard-coded
 * string. Trusting that hint would report a phantom tool as merely unavailable.
 *
 * ── The paid branch is one call, and that is the point ───────────────────────────
 * It used to read four fields out of `accepts[0]` by hand and drop the other three.
 * `checkRequirements` reads all seven and refuses the ones that cannot be signed
 * safely, so the paid branch here is now a delegation rather than a parser. Nothing
 * in this file decides what an acceptable asset, chain, scheme or window is any
 * more — there was a `KNOWN_ASSETS` list and an `assetOf` here doing half of it,
 * which is the same two-copies-of-one-rule hazard `lib/abi.ts` was extracted to
 * end, and worse in the same way: both copies sat on the path whose output gets
 * signed.
 */
export function parsePrice(toolId: string, origin: string, status: number, body: unknown): Price {
  const b = obj(body, "a quote");

  if (status === 501 || b.code === "TOOL_UNAVAILABLE") {
    const why = typeof b.hint === "string" ? b.hint : `upstream answered ${status}`;
    throw new Error(
      `Upstream has no working implementation for ${toolId}: ${why} There is nothing to pay, and retrying will not change that.`,
    );
  }

  if (b.free === true) {
    return {
      kind: "free",
      why: typeof b.hint === "string" ? b.hint : "upstream answers this one without asking for payment",
    };
  }

  return { kind: "paid", requirements: checkRequirements(toolId, origin, b) };
}

/* ── the adapter ─────────────────────────────────────────────────────────────── */

/**
 * Both reads ask for JSON and nothing else. No custom header, deliberately: any
 * header outside the CORS safelist turns a simple GET into a preflighted one, and
 * the preflight is the thing measured above to carry no CORS headers at all.
 */
async function getJson(url: string): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

/**
 * Why a paid run stops here when nothing was attached to pay it. Named once so the
 * panel and the thrown error cannot drift apart.
 *
 * Not CORS — `FORWARD` settles that — and not a missing signing capability either, not
 * any more: `lib/payment.ts` can sign an EIP-3009 authorization once a wallet is
 * connected. This is what happens when `run` is called for a paid tool with no
 * `payment` argument at all — the panel did not attach one, whether because no wallet
 * is connected or because it is not on this code path yet.
 */
export const NO_WALLET =
  "This tool wants payment, and no payment was attached to this request. Connect a wallet " +
  "and sign the USDC authorization it asks for, then try again. Nothing was charged.";

/**
 * What an absent forwarder looks like from in here.
 *
 * A static build has no proxy, so `FORWARD.tool(id)` resolves against this app — and
 * what comes back depends on the host, which is the reason the check is where it is.
 * MEASURED 2026-09-27 against this repo's own `dist/`: a plain static server answers
 * **501 with an HTML error page**, while a host doing SPA rewrites answers 200 with
 * `index.html`. This comment asserted only the second one until it was measured.
 *
 * So the status cannot identify the case and is not asked to. The body is: a tool
 * result is JSON, and anything that does not parse is not one. Printing an HTML page
 * as though a tool had answered is the exact species of fabrication this repo refuses,
 * and it would sail through a status check on either of those two hosts.
 */
export const NO_FORWARDER =
  "The run reached this app's own origin and came back as a page rather than a tool answer: nothing is forwarding /upstream to the catalog. Runs work under `npm run dev`; a static build needs a real forwarder in front of it.";

/** Upstream's answer, verbatim. */
function readJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Upstream's own sentence about why it refused, if it sent one.
 *
 * Two keys, because those are the two measured: a 400 for a missing input answers
 * `{"error":"Provide \`contract\` — 42-char hex address"}`, and a 501 answers with a
 * `hint`. Nothing speculative is added — a key this has never seen upstream use is a
 * key that will never fire, and it would read as evidence that it does.
 *
 * This exists because the status alone is useless to the person who caused it. "answered
 * 400" does not say which field was blank; upstream's sentence names it.
 */
function reasonFrom(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Json;
  for (const key of ["error", "hint"]) {
    const said = b[key];
    if (typeof said === "string" && said !== "") return said;
  }
  return null;
}

export class HttpCatalog implements Catalog {
  /**
   * False, and it stays false while `quote` and free runs are genuinely live.
   * `isLive` is about settlement — whether money moved — not about whether the read
   * was real. A catalog that reported live because its GETs work would render an
   * unpaid run as a paid one.
   */
  readonly isLive = false;

  /**
   * The one thing wrong with THIS PRICE, independent of whether a wallet happens to be
   * connected right now. A payee this build does not recognise is such a fact — it is
   * true about the quote itself, the same way `askedSeconds` or `value` are, and stays
   * true no matter what the panel's wallet state does a second from now.
   *
   * Wallet readiness used to live here too (`NO_WALLET`, unconditionally, for every
   * paid price), back when there was no signing code to wire up. Now that
   * `lib/payment.ts` can build a header, a missing wallet is not a fact about the
   * *price* — it is a fact about *this moment*, which changes the instant someone
   * clicks "Connect". Folding it into `whyNot` would mean re-deriving it on every
   * render just to notice it went stale; the panel already holds a `Wallet` and asks
   * it directly instead.
   */
  whyNot(price: Price): string | null {
    if (price.kind === "free") return null;
    return whyNotSign(price.requirements);
  }

  async tools(): Promise<Tool[]> {
    const { status, body } = await getJson(BLUEAGENT.catalog);
    if (status !== 200) {
      throw new Error(`The catalog answered ${status}. Nothing was read, so nothing is listed.`);
    }
    return parseTools(body);
  }

  async quote(toolId: string): Promise<Quote> {
    const { status, body, headers } = await getJson(BLUEAGENT.tool(toolId));
    /**
     * Header first, body as the fallback — see `lib/x402http.ts`. BlueAgent sends the
     * body only (measured), so for it this is the same read as before; the order is
     * here so this adapter and the any-URL one agree on what a 402 says.
     */
    return { toolId, price: parsePrice(toolId, BLUEAGENT.origin, status, readPaymentRequired(headers, body)) };
  }

  /**
   * POST the inputs through the forwarder, with `payment` attached as `X-Payment`
   * when the caller has one, and report what came back.
   *
   * Every failure throws rather than returning a `ToolRun` with an apology in
   * `output`. Upstream settles only after a handler succeeds, so a throw here means
   * the caller was charged nothing — and a panel that rendered the apology as output
   * would look identical to a tool that answered.
   *
   * The output is upstream's JSON, pretty-printed and otherwise untouched. Nothing
   * here summarises it: a summary of a tool result is a sentence this repo wrote, and
   * the whole point of paying a tool is to read what the tool said.
   *
   * A 402 with `payment` attached means the facilitator refused the header itself
   * (bad signature, expired window, wrong payee) rather than "you didn't pay" — a
   * different failure from the one `NO_WALLET` names, so it gets a different sentence.
   */
  async run(toolId: string, input: Record<string, string>, payment?: string): Promise<ToolRun> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (payment !== undefined) headers["X-Payment"] = payment;

    const res = await fetch(FORWARD.tool(toolId), { method: "POST", headers, body: JSON.stringify(input) });
    const text = await res.text();

    if (res.status === 402) {
      if (payment === undefined) {
        throw new Error(`${toolId} was not run. ${NO_WALLET}`);
      }
      const said = reasonFrom(readJson(text));
      throw new Error(
        said
          ? `${toolId} was not run. Upstream refused the payment: ${said} Nothing was charged.`
          : `${toolId} was not run. Upstream refused the payment and gave no reason. Nothing was charged.`,
      );
    }

    const body = readJson(text);
    if (body === undefined) {
      throw new Error(`${toolId} was not run. ${NO_FORWARDER}`);
    }
    if (res.status !== 200) {
      const said = reasonFrom(body);
      throw new Error(
        said
          ? `${toolId} did not run, and you were not charged. Upstream answered ${res.status}: ${said}`
          : `${toolId} did not run, and you were not charged. Upstream answered ${res.status} and gave no reason.`,
      );
    }

    return {
      toolId,
      output: JSON.stringify(body, null, 2),
      settlement: settlementFor(payment, res.headers),
    };
  }
}

/**
 * Read back what THIS run paid, from the header this build sent — not a second source
 * of truth, the same `accepted` block `paymentHeader` wrote a moment ago.
 *
 * Throws rather than guessing: reaching here with an unreadable `payment` means this
 * adapter sent a header it cannot parse back, which is a bug in this file, not upstream's
 * — fabricating a `payTo` or `amountBaseUnits` to paper over that would put a made-up
 * number on a `settled` result, which is exactly what `Settlement`'s shape exists to rule
 * out (see `adapters/types.ts`).
 */
function decodeSentPayment(payment: string): { payTo: string; amountBaseUnits: bigint } {
  const decoded = jsonFromBase64(payment, "payment") as { accepted?: { payTo?: unknown; amount?: unknown } } | null;
  const payTo = decoded?.accepted?.payTo;
  const amount = decoded?.accepted?.amount;
  if (typeof payTo !== "string" || typeof amount !== "string") {
    throw new Error(
      "Sent a payment header this build cannot read back to report what it paid. That is a " +
        "bug in this adapter, not upstream's.",
    );
  }
  return { payTo, amountBaseUnits: BigInt(amount) };
}

/**
 * What actually happened to the money on a successful (200) response.
 *
 * Three real outcomes, and only one of them may claim `settled`: no `payment` sent at
 * all is `free` (upstream chose to answer without being paid, so there is nothing to
 * settle); `payment` sent and a legible `txHash` came back is `settled`; `payment` sent
 * and no legible `txHash` came back is `unsettled` — the call succeeded and this build
 * still has no proof to show, which is the honest thing to say rather than upgrading a
 * 200 into a receipt it did not earn.
 */
export function settlementFor(payment: string | undefined, headers: Headers): Settlement {
  if (payment === undefined) {
    return { kind: "free", why: "upstream answered this without asking for payment" };
  }
  /**
   * 🔴 MEASURED against the one client of BlueAgent's payee that has demonstrably been
   * paid: its own `packages/x402-client/src/client.ts` reads `X-Payment-Response` inside a
   * try/catch and treats a missing or unparsable header as unknown, never as a failure.
   * So an absent header is not evidence the payment failed — only that this build was not
   * told a hash. `settledTransaction` reads that header and the spec's `PAYMENT-RESPONSE`.
   */
  const txHash = settledTransaction(headers);
  if (txHash === null) {
    return {
      kind: "unsettled",
      why: "upstream accepted the payment but sent back no settlement proof, so nothing here confirms a transaction",
    };
  }
  const { payTo, amountBaseUnits } = decodeSentPayment(payment);
  return { kind: "settled", txHash, payTo, amountBaseUnits };
}
