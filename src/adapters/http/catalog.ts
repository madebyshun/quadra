import type { Catalog, Price, Quote, Tool, ToolField, ToolRun } from "@/adapters/types";
import { BLUEAGENT, FORWARD } from "@/config/upstream";
import { checkRequirements, whyNotSign } from "@/lib/requirements";

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
 * So the six free ids genuinely run, and the other 109 return a 402 this build
 * cannot answer — it has no signing code, by design. That is why `whyNot` takes a
 * price: one flag for the whole adapter had to lie about one half of the catalog.
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
export function parsePrice(toolId: string, status: number, body: unknown): Price {
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

  return { kind: "paid", requirements: checkRequirements(toolId, b) };
}

/* ── the adapter ─────────────────────────────────────────────────────────────── */

/**
 * Both reads ask for JSON and nothing else. No custom header, deliberately: any
 * header outside the CORS safelist turns a simple GET into a preflighted one, and
 * the preflight is the thing measured above to carry no CORS headers at all.
 */
async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  return { status: res.status, body: await res.json() };
}

/**
 * Why a paid run stops here. Named once so the panel and the thrown error cannot
 * drift apart.
 *
 * Not CORS — `FORWARD` settles that — and not a missing API key either. Answering a
 * 402 means signing an EIP-3009 authorization over the caller's own USDC, and this
 * build has no signing code at all. Saying that plainly matters: "payment failed"
 * invites a retry, and there is nothing here to retry.
 */
export const NO_WALLET =
  "This tool wants payment, and this window cannot pay it: answering upstream's 402 means signing a USDC authorization from your own wallet, and no signing code is wired up yet. Nothing was charged.";

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
   * ⚠️ Two independent reasons, and the order outlives the current one.
   *
   * `NO_WALLET` is why nothing runs today and it goes first. An unrecognised payee is
   * reported after it because it is the reason that will **still** be true once a
   * wallet lands — so both get said rather than the temporary one hiding the
   * permanent one. Suppressing the payee note while there is no wallet would mean the
   * day signing is wired up is the day the warning first appears, which is the worst
   * possible day to learn that upstream's payee moved.
   */
  whyNot(price: Price): string | null {
    if (price.kind === "free") return null;
    const payee = whyNotSign(price.requirements);
    return payee === null ? NO_WALLET : `${NO_WALLET} There is also a second problem: ${payee}`;
  }

  async tools(): Promise<Tool[]> {
    const { status, body } = await getJson(BLUEAGENT.catalog);
    if (status !== 200) {
      throw new Error(`The catalog answered ${status}. Nothing was read, so nothing is listed.`);
    }
    return parseTools(body);
  }

  async quote(toolId: string): Promise<Quote> {
    const { status, body } = await getJson(BLUEAGENT.tool(toolId));
    return { toolId, price: parsePrice(toolId, status, body) };
  }

  /**
   * POST the inputs through the forwarder and report what came back.
   *
   * Every failure throws rather than returning a `ToolRun` with an apology in
   * `output`. Upstream settles only after a handler succeeds, so a throw here means
   * the caller was charged nothing — and a panel that rendered the apology as output
   * would look identical to a tool that answered.
   *
   * The output is upstream's JSON, pretty-printed and otherwise untouched. Nothing
   * here summarises it: a summary of a tool result is a sentence this repo wrote, and
   * the whole point of paying a tool is to read what the tool said.
   */
  async run(toolId: string, input: Record<string, string>): Promise<ToolRun> {
    const res = await fetch(FORWARD.tool(toolId), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(input),
    });
    const text = await res.text();

    if (res.status === 402) {
      throw new Error(`${toolId} was not run. ${NO_WALLET}`);
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
      /**
       * `free`, not `settled`, and the reason is the evidence: a 200 with no
       * `X-PAYMENT` sent means upstream chose to answer without being paid. No
       * transaction exists, so there is no hash to carry, which is why `Settlement`
       * has no field for one here.
       */
      settlement: { kind: "free", why: "upstream answered this without asking for payment" },
    };
  }
}
