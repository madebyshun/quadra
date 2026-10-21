import { describe, expect, it, vi } from "vitest";
import { API_PRICE, apiRequirements, priceOf, SKILL_PRICES } from "@/config/api";
import { CONTRACTS, USDC, WETH } from "@/config/chain";
import { checkRequirements } from "@/lib/requirements";
import { jsonFromBase64, PAYMENT_REQUIRED, PAYMENT_RESPONSE, PAYMENT_SIGNATURE, readPaymentRequired, toBase64Utf8 } from "@/lib/x402http";
import { apiHandler, mismatch, NO_FACILITATOR, NO_TREASURY } from "@/server/api";
import { API_PATH } from "@/server/apiPath";
import type { Facilitator, SettleResponse, VerifyResponse } from "@/server/cdp";
import { SKILLS } from "@/skills";
import { quietRadar } from "./fixtures/radar";
import { net, useNet } from "./net";

/**
 * Quadra's own API, sold over x402 (the owner's decision, 2026-09-30). The facilitator is a
 * fake here — CDP's client is `tests/cdp.test.ts` — so these tests are about the ORDER of a
 * paid call: check, verify, run, settle, deliver; and about who is charged when a step fails.
 */

useNet();

const HOST = "quadra.test";
/** Most calls here are to the radar — the cheapest skill to run for real — so its sale is the default. */
const REQ = apiRequirements(undefined, "radar")!;
const VERDICT = apiRequirements(undefined, "verdict")!;
const BUYER = "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9";

function request(path: string, init: { method?: string; payment?: string } = {}): Request {
  return new Request(`http://localhost${API_PATH}${path}`, {
    method: init.method ?? "GET",
    headers: { host: HOST, ...(init.payment === undefined ? {} : { [PAYMENT_SIGNATURE]: init.payment }) },
  });
}

type Draft = { x402Version: unknown; accepted: Record<string, unknown>; payload: Record<string, unknown> };

/** A PaymentPayload for this API, as a buyer following the spec builds it; `edit` makes it wrong one field at a time. */
function payment(edit: (p: Draft) => void = () => {}, REQ = apiRequirements(undefined, "radar")!): string {
  const p = {
    x402Version: 2 as unknown,
    accepted: { ...REQ, extra: { ...REQ.extra } } as Record<string, unknown>,
    payload: {
      signature: `0x${"11".repeat(65)}`,
      authorization: { from: BUYER, to: REQ.payTo, value: REQ.amount, validAfter: "0", validBefore: "9999999999", nonce: `0x${"22".repeat(32)}` },
    } as Record<string, unknown>,
  };
  edit(p);
  return toBase64Utf8(JSON.stringify(p));
}

function facilitator(over: { verify?: () => VerifyResponse | Promise<VerifyResponse>; settle?: () => SettleResponse | Promise<SettleResponse> } = {}) {
  const f: Facilitator & { calls: string[] } = {
    calls: [],
    async verify() {
      f.calls.push("verify");
      return over.verify ? over.verify() : { isValid: true, payer: BUYER };
    },
    async settle() {
      f.calls.push("settle");
      return over.settle ? over.settle() : { success: true, transaction: `0x${"ab".repeat(32)}`, network: "eip155:8453", payer: BUYER };
    },
  };
  return f;
}

/** The radar over a quiet window, from the captures — the cheapest skill to run for real. */
function radarSources() {
  net({ rpc: quietRadar });
}

describe("what the API charges", () => {
  it("asks exactly one way to pay: exact USDC on Base, to Quadra's fee address", () => {
    expect(REQ).toEqual({
      scheme: "exact",
      network: "eip155:8453",
      asset: USDC.address,
      amount: priceOf("radar").toString(),
      payTo: CONTRACTS.treasury,
      maxTimeoutSeconds: 120,
      extra: { name: "USD Coin", version: "2" },
    });
    // no fee address, nothing sold (hard rule 15)
    expect(apiRequirements(null)).toBeNull();
  });

  /** Priced per skill since 2026-10-02, from the market as measured on the Bazaar and x402scan. */
  it("prices each skill on its own, and anything unnamed at the base price", () => {
    expect(SKILL_PRICES).toEqual({ verdict: 50_000n, gate: 10_000n, sendcheck: 5_000n, forensics: 100_000n, launcher: 50_000n, radar: 20_000n, launch: 50_000n });
    expect(priceOf("verdict")).toBe(50_000n);
    expect(priceOf("anything-else")).toBe(API_PRICE);
    expect(apiRequirements()!.amount).toBe(API_PRICE.toString());
    // every skill sold is priced on purpose
    for (const s of SKILLS) expect(SKILL_PRICES[s.id], s.id).toBeDefined();
  });
});

describe("the free list", () => {
  it("lists every skill with its arguments, its URL and the price", async () => {
    const res = await apiHandler({ facilitator: null })(request(""));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await res.json()) as { selling: boolean; price: { usd: string }; skills: { id: string; url: string; args: { optional: boolean }[] }[] };
    expect(body.price).toMatchObject({ amount: "5000", usd: "$0.005", payTo: CONTRACTS.treasury });
    // no facilitator key: listed and priced, but not selling
    expect(body.selling).toBe(false);
    expect(((await (await apiHandler({ facilitator: facilitator() })(request(""))).json()) as { selling: boolean }).selling).toBe(true);
    expect(body.skills.map((s) => s.id)).toEqual(SKILLS.map((s) => s.id));
    expect(body.skills[0]!.url).toBe(`http://${HOST}${API_PATH}/verdict`);
    expect(body.skills.find((s) => s.id === "radar")!.args).toEqual([{ name: "minutes", hint: "60 (max 180)", optional: true }]);
    // a trailing slash is the same list
    expect((await apiHandler({ facilitator: null })(request("/"))).status).toBe(200);
  });

  it("still lists without a fee address, with no price to show", async () => {
    const body = (await (await apiHandler({ facilitator: facilitator(), treasury: null })(request(""))).json()) as { price: unknown; selling: boolean };
    expect(body.price).toBeNull();
    expect(body.selling).toBe(false);
  });
});

describe("routing and refusals", () => {
  it("answers a CORS preflight for the payment header, and takes GET only", async () => {
    const pre = await apiHandler({ facilitator: null })(request("/radar", { method: "OPTIONS" }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-headers")).toBe(`${PAYMENT_SIGNATURE}, content-type`);
    expect(pre.headers.get("access-control-expose-headers")).toBe(`${PAYMENT_REQUIRED}, ${PAYMENT_RESPONSE}`);
    expect((await apiHandler({ facilitator: null })(request("/radar", { method: "POST" }))).status).toBe(405);
  });

  it("names a skill that does not exist, and accepts a skill's other names", async () => {
    const handle = apiHandler({ facilitator: facilitator() });
    const missing = await handle(request("/teleport"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ detail: `There is no skill called "teleport". GET ${API_PATH} lists them.` });
    expect((await handle(request("/radar/extra"))).status).toBe(404);
    // `scan` is the Terminal's other name for the Token Verdict
    expect((await handle(request("/scan?arg=0x1"))).status).toBe(402);
  });

  it("sells nothing without a fee address or a facilitator key, and says which", async () => {
    const noTreasury = await apiHandler({ facilitator: facilitator(), treasury: null })(request("/radar"));
    expect(noTreasury.status).toBe(503);
    expect(await noTreasury.json()).toMatchObject({ detail: NO_TREASURY });
    const noKey = await apiHandler({ facilitator: null })(request("/radar"));
    expect(noKey.status).toBe(503);
    expect(await noKey.json()).toMatchObject({ detail: NO_FACILITATOR, origin: "quadra-server" });
  });
});

describe("the 402", () => {
  it("states the price in the PAYMENT-REQUIRED header, mirrored in the body", async () => {
    const res = await apiHandler({ facilitator: facilitator() })(request("/verdict?arg=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed"));
    expect(res.status).toBe(402);
    const body = await res.json();
    const header = jsonFromBase64(res.headers.get(PAYMENT_REQUIRED)!, PAYMENT_REQUIRED);
    expect(header).toEqual(body);
    expect(body).toEqual({
      x402Version: 2,
      error: "PAYMENT-SIGNATURE header is required",
      resource: { url: `http://${HOST}${API_PATH}/verdict?arg=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed`, description: "Token Verdict — Before you buy: a real buy-and-sell on Base, simulated, plus the code, the holders, the launcher and the market.", mimeType: "application/json" },
      // the verdict's own price, not the radar's: each skill is sold at its own
      accepts: [VERDICT],
    });
  });

  /** The strongest check available offline: this app's own x402 BUYER reads this app's 402. */
  it("is a 402 this app's own x402 client can read and price", async () => {
    const res = await apiHandler({ facilitator: facilitator() })(request("/radar"));
    const read = checkRequirements(`http://${HOST}${API_PATH}/radar`, `http://${HOST}`, readPaymentRequired(res.headers, await res.json()), () => REQ.payTo);
    expect(read.value).toBe(priceOf("radar"));
    expect(read.asset.address).toBe(USDC.address);
    expect(read.payee).toEqual({ kind: "known", address: REQ.payTo });
  });

  it("refuses a payment header that is not base64 JSON", async () => {
    const res = await apiHandler({ facilitator: facilitator() })(request("/radar", { payment: "%%%" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ detail: expect.stringMatching(/PAYMENT-SIGNATURE header is not base64/) });
  });
});

describe("a payment for something else", () => {
  it.each([
    ["another version", (p: Draft) => (p.x402Version = 1), "It is not an x402 version 2 payment."],
    ["nothing accepted", (p: Draft) => ((p as { accepted: unknown }).accepted = null), "It does not say which payment it accepted."],
    ["another scheme", (p: Draft) => (p.accepted.scheme = "upto"), "It is for upto on eip155:8453, not exact on eip155:8453."],
    ["another network", (p: Draft) => (p.accepted.network = "eip155:1"), "It is for exact on eip155:1"],
    ["another token", (p: Draft) => (p.accepted.asset = WETH.address), "It pays in a different token than USDC on Base."],
    ["less money", (p: Draft) => (p.accepted.amount = "1"), "It pays 1, not the 20000 ($0.02) this costs."],
    ["another payee", (p: Draft) => (p.accepted.payTo = BUYER), "It pays someone other than Quadra's fee address."],
    ["another window", (p: Draft) => (p.accepted.maxTimeoutSeconds = 3600), "It names a different settlement window than this API offered."],
    ["another domain", (p: Draft) => (p.accepted.extra = { name: "USDC", version: "2" }), "It names a different USDC signing domain."],
    ["no domain", (p: Draft) => delete p.accepted.extra, "It names a different USDC signing domain."],
    ["no authorization", (p: Draft) => (p.payload = {}), "It carries no EIP-3009 authorization."],
    [
      "a signature for less",
      (p: Draft) => ((p.payload.authorization as Record<string, unknown>).value = "1"),
      "Its signed authorization is not for this amount to this payee.",
    ],
    [
      "a signature to someone else",
      (p: Draft) => ((p.payload.authorization as Record<string, unknown>).to = BUYER),
      "Its signed authorization is not for this amount to this payee.",
    ],
  ])("is refused before anyone is asked: %s", async (_, edit, why) => {
    const f = facilitator();
    const res = await apiHandler({ facilitator: f })(request("/radar", { payment: payment(edit) }));
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: string }).error).toContain(why);
    expect(f.calls).toEqual([]);
  });

  it("checks addresses without regard to case, and only the fields that decide the money", () => {
    const p = JSON.parse(atob(payment((q) => (q.accepted.payTo = REQ.payTo.toLowerCase())))) as unknown;
    expect(mismatch(p, REQ)).toBeNull();
    expect(mismatch(null, REQ)).toBe("It is not an x402 version 2 payment.");
  });
});

describe("a paid call", () => {
  it("verifies, runs, settles — and only then delivers, with the settlement in PAYMENT-RESPONSE", async () => {
    radarSources();
    const f = facilitator();
    const res = await apiHandler({ facilitator: f })(request("/radar", { payment: payment() }));
    expect(res.status).toBe(200);
    expect(f.calls).toEqual(["verify", "settle"]);
    const body = (await res.json()) as { skill: string; report: { title: string }; text: string };
    expect(body.skill).toBe("radar");
    expect(body.report.title).toBe("Launch Radar — last 60 min");
    expect(body.text).toMatch(/^== Launch Radar — last 60 min ==/);
    expect(jsonFromBase64(res.headers.get(PAYMENT_RESPONSE)!, PAYMENT_RESPONSE)).toMatchObject({ success: true, network: "eip155:8453" });
  });

  it("says why the facilitator refused a payment, and charges nothing", async () => {
    for (const [verdict, why] of [
      [{ isValid: false, invalidReason: "insufficient_funds" }, "insufficient_funds"],
      [{ isValid: false, invalidReason: "x", invalidMessage: "The payer has 0 USDC" }, "The payer has 0 USDC"],
      [{ isValid: false }, "no reason given"],
    ] as const) {
      const f = facilitator({ verify: () => verdict });
      const res = await apiHandler({ facilitator: f })(request("/radar", { payment: payment() }));
      expect(res.status).toBe(402);
      expect(((await res.json()) as { error: string }).error).toBe(`The facilitator refused the payment: ${why}.`);
      expect(f.calls).toEqual(["verify"]);
    }
  });

  it("does not collect a payment for a skill that failed", async () => {
    const f = facilitator();
    const res = await apiHandler({ facilitator: f })(request("/verdict?arg=0x12", { payment: payment(() => {}, VERDICT) }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ charged: false, detail: expect.stringMatching(/The payment was not collected\.$/) });
    expect(f.calls).toEqual(["verify"]);
  });

  /** docs.cdp.coinbase.com, "Settlement Pending and Reconciliation": ask once more, never pay twice. */
  it("asks once more when settlement is pending, and delivers while the transaction is on its way", async () => {
    radarSources();
    const pending: SettleResponse = { success: false, errorReason: "settlement_pending", transaction: "0x99", network: "eip155:8453" };
    let settles = 0;
    const once = facilitator({ settle: () => (settles++ === 0 ? pending : { success: true, transaction: "0x99", network: "eip155:8453" }) });
    expect((await apiHandler({ facilitator: once })(request("/radar", { payment: payment() }))).status).toBe(200);
    expect(once.calls).toEqual(["verify", "settle", "settle"]);
    radarSources();
    const still = facilitator({ settle: () => pending });
    const res = await apiHandler({ facilitator: still })(request("/radar", { payment: payment() }));
    expect(res.status).toBe(200);
    expect(still.calls).toEqual(["verify", "settle", "settle"]);
    expect(jsonFromBase64(res.headers.get(PAYMENT_RESPONSE)!, PAYMENT_RESPONSE)).toMatchObject({ errorReason: "settlement_pending", transaction: "0x99" });
    // pending with no transaction to look up is not asked about again
    radarSources();
    const blind = facilitator({ settle: () => ({ ...pending, transaction: "" }) });
    await apiHandler({ facilitator: blind })(request("/radar", { payment: payment() }));
    expect(blind.calls).toEqual(["verify", "settle"]);
  });

  it("delivers nothing when settlement fails — a replayed authorization gets nothing", async () => {
    for (const [result, why] of [
      [{ success: false, errorReason: "invalid_transaction_state", transaction: "", network: "" }, "invalid_transaction_state"],
      [{ success: false, errorReason: "x", errorMessage: "nonce already used", transaction: "", network: "" }, "nonce already used"],
      [{ success: false, transaction: "", network: "" }, "no reason given"],
    ] as const) {
      radarSources();
      const res = await apiHandler({ facilitator: facilitator({ settle: () => result }) })(request("/radar", { payment: payment() }));
      expect(res.status).toBe(402);
      const body = (await res.json()) as { error: string; report?: unknown };
      expect(body.error).toBe(`Settlement failed: ${why}. Nothing was delivered.`);
      expect(body.report).toBeUndefined();
    }
  });

  it("says when the facilitator cannot be reached, at either step", async () => {
    const down = () => Promise.reject(new Error("Coinbase's x402 facilitator could not be reached to verify the payment."));
    const v = await apiHandler({ facilitator: facilitator({ verify: down }) })(request("/radar", { payment: payment() }));
    expect(v.status).toBe(502);
    expect(await v.json()).toMatchObject({ detail: expect.stringMatching(/Nothing was charged\.$/) });
    radarSources();
    const s = await apiHandler({ facilitator: facilitator({ settle: () => Promise.reject(new Error("offline")) }) })(request("/radar", { payment: payment() }));
    expect(s.status).toBe(502);
    expect(await s.json()).toMatchObject({ detail: "offline The report was not delivered." });
    vi.restoreAllMocks();
  });
});
