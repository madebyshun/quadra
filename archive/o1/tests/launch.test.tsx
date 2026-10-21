import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { decodeFunctionData, encodeFunctionResult } from "viem";
import { BASE, USDC, WETH } from "@/config/chain";
import { CRYPTO_PAIRS, EXTRA, FACTORY_ABI, O1, type Pair } from "@/config/o1";
import { checkPlan, factoryState, launchPairs, o1Up, prepareLaunch, type Asked, type LaunchInput } from "@/adapters/http/o1";
import { forgetCatalog } from "@/adapters/http/markets";
import { NO_KEY, o1Handler, O1_PATH, O1_REQUEST_HEADER } from "@/server/o1";
import { STOCKS_PATH } from "@/server/stocks";
import { checkExtra, O1Launch, readImage } from "@/features/panels/LaunchPanel";
import { WalletProvider } from "@/ui/WalletProvider";
import type { Eip1193Provider, Eip1193Request } from "@/lib/wallet";
import { MARKETS_FX, NVDA_ON_BASE } from "./fixtures/markets";
import { DOWN, ethCalls, json, net, RpcError, simulated, useNet } from "./net";

useNet();

beforeEach(() => forgetCatalog());

vi.mock("@/lib/connectors", () => ({ walletConnectProvider: vi.fn(), coinbaseProvider: vi.fn() }));

const ME = "0xabcdef0123456789abcdef0123456789abcdef01";
const OTHER = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"ef".repeat(32)}`;
const ZERO = O1.nativeQuote;
const TOKEN = "0x7777777777777777777777777777777777777701";
const FEE = "1000000000000000";

/**
 * ⚠️ SHAPED FROM o1's OpenAPI SPEC (`LaunchPrepareResponse`), NOT CAPTURED. On 2026-09-30 the
 * live API answered 500 to every route, so there is no real response to trim yet — the moment
 * there is, this should be replaced by one (see tests/fixtures/base/index.ts for the rule).
 * The values are illustrative; the FIELD NAMES and nesting are the spec's.
 */
function plan(edit: (d: Record<string, unknown>) => void = () => {}) {
  const data: Record<string, unknown> = {
    chain_id: 8453,
    actor: ME,
    prepared_at: "2026-09-30T10:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
    observed_block: "51980000",
    issues: [{ code: "image_resized", severity: "warning", detail: "The image was resized to 512 px" }],
    steps: [
      {
        id: "launch",
        kind: "transaction",
        label: "Create the launch",
        depends_on: [],
        transaction: { chain_id: 8453, from: ME, to: O1.factory, data: "0xabcdef", value: FEE },
        simulation: { status: "succeeded", block_number: "51980000" },
      },
    ],
    predicted_token_address: TOKEN,
    suite_id: "base-standard",
    metadata_uri: "ipfs://bafymeta",
    image_url: "https://ipfs.example/bafyimage",
    creation_fee: { amount_raw: FEE, currency_address: ZERO, decimals: 18, symbol: "ETH" },
    review: { market: "standard", token: { name: "Quadra Cat", symbol: "QCAT", editable_metadata: false }, quote_address: ZERO },
  };
  edit(data);
  return { data, meta: { request_id: "req_1", generated_at: "2026-09-30T10:00:00.000Z", warnings: ["Anti-snipe tax is active for 20 seconds"] } };
}

const step = (d: Record<string, unknown>) => (d.steps as Record<string, unknown>[])[0]!;
const review = (d: Record<string, unknown>) => d.review as Record<string, unknown>;

/** A plan for a launch paired with NVDA on Base, profile editable — built from `plan()`. */
const stockPlan = () =>
  plan((d) => {
    review(d).market = "rwa";
    review(d).quote_address = NVDA_ON_BASE;
    (review(d).token as Record<string, unknown>).editable_metadata = true;
  });

const NVDA: Pair = { market: "rwa", symbol: "NVDA", name: "NVIDIA Corporation", address: NVDA_ON_BASE };
/** Offered by nobody here — built to ask the factory about a pair it does NOT register. */
const WETH_PAIR: Pair = { market: "standard", symbol: "WETH", name: "Wrapped Ether", address: WETH.address };

/**
 * o1's factory on Base, answering as it did when MEASURED 2026-09-30 at block 51,992,427:
 *
 *   F=0x1176122eb77AD6a2339322Cda7C4D7ea9BfA63dC; R=https://mainnet.base.org
 *   cast call $F "launchCreationEnabled()(bool)" --rpc-url $R                   # true
 *   cast call $F "nativeLaunchFee()(uint256)" --rpc-url $R                       # 1000000000000000
 *   cast call $F "quoteConfig(address)(bool,uint8,int24)" $QUOTE --rpc-url $R
 *     0x000…000 (ETH) → true 18 -203200     USDC → true 6 -400600     cbBTC → true 8 -468000
 *     NVDA 0xb200…108C → true 8 -409000     WETH → false 0 0           0x1111…1111 → false 0 0
 */
const MEASURED_FEE = 10n ** 15n;
const QUOTES: Record<string, readonly [boolean, number, number]> = {
  [ZERO]: [true, 18, -203200],
  [USDC.address.toLowerCase()]: [true, 6, -400600],
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": [true, 8, -468000],
  [NVDA_ON_BASE.toLowerCase()]: [true, 8, -409000],
};

type FactoryAt = { readonly open?: boolean; readonly fee?: bigint; readonly registered?: false; readonly down?: boolean };

function factory(f: FactoryAt) {
  return (data: `0x${string}`) => {
    if (f.down) return new RpcError("execution reverted");
    const call = decodeFunctionData({ abi: FACTORY_ABI, data });
    const result =
      call.functionName === "launchCreationEnabled"
        ? (f.open ?? true)
        : call.functionName === "nativeLaunchFee"
          ? (f.fee ?? MEASURED_FEE)
          : f.registered === false
            ? [false, 0, 0]
            : (QUOTES[String((call.args as readonly unknown[])[0]).toLowerCase()] ?? [false, 0, 0]);
    return encodeFunctionResult({ abi: FACTORY_ABI, functionName: call.functionName, result } as never);
  };
}

type World = { readonly factory?: FactoryAt; readonly code?: string; readonly up?: () => boolean; readonly catalog?: unknown };

/**
 * Base's RPC through the fake network (o1's factory as measured, receipts, code), o1's Base
 * catalog, and this app's `/api/o1` answered by `o1`. Returns the calls that reached `/api/o1`.
 */
function world(o1: (init?: RequestInit) => Response | Promise<Response> = () => json(plan()), w: World = {}) {
  const calls = ethCalls({ [O1.factory]: factory(w.factory ?? {}) });
  net({
    get: (url) => (url === `${STOCKS_PATH}/base` ? (w.catalog ?? MARKETS_FX.coinbaseStocks) : undefined),
    rpc: (m, p) =>
      simulated()(m, p) ??
      (m === "eth_getTransactionReceipt" ? { status: "0x1", blockNumber: "0x5", logs: [] } : m === "eth_getCode" ? (w.code ?? "0x6080") : calls(m, p)),
  });
  const seen: { url: string; init: RequestInit | undefined }[] = [];
  const up = w.up ?? (() => true);
  const rpcFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url === `${O1_PATH}/health`) return Promise.resolve(json({ up: up(), status: up() ? 200 : 500 }));
    if (url.startsWith(O1_PATH)) {
      seen.push({ url, init });
      return Promise.resolve(o1(init));
    }
    return rpcFetch(url, init);
  });
  return seen;
}

describe("the launch server: holding the key", () => {
  const request = (path: string, init: RequestInit & { header?: boolean } = {}) =>
    new Request(`http://localhost${O1_PATH}${path}`, {
      method: init.method ?? "POST",
      body: init.body ?? (init.method === "GET" ? null : "{}"),
      headers: { ...(init.header === false ? {} : { [O1_REQUEST_HEADER]: "1" }), "idempotency-key": "k-1" },
    });

  it("forwards a prepare to o1 with the key, and passes the answer back without it", async () => {
    const seen: { url: string; headers: Headers; body: unknown }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: new Headers(init.headers), body: init.body });
      return json({ data: "ok" }, 200);
    }) as unknown as typeof fetch;
    const answer = await o1Handler("o1_launch_secret", fetchImpl)(request("/launches/prepare", { body: '{"a":1}' }));
    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe('{"data":"ok"}');
    expect(seen[0]!.url).toBe("https://api.launch.o1.exchange/v1/launches/prepare");
    expect(seen[0]!.headers.get("x-api-key")).toBe("o1_launch_secret");
    expect(seen[0]!.headers.get("Idempotency-Key")).toBe("k-1");
    expect(seen[0]!.body).toBe('{"a":1}');
  });

  it("passes o1's refusals through, status and all, with a content type even when o1 sent none", async () => {
    const answer = await o1Handler("k", (async () => new Response(null, { status: 422 })) as unknown as typeof fetch)(
      new Request(`http://localhost${O1_PATH}/launches/prepare`, { method: "POST", body: "{}", headers: { [O1_REQUEST_HEADER]: "1" } }),
    );
    expect(answer.status).toBe(422);
    expect(answer.headers.get("content-type")).toBe("application/json");
  });

  it("refuses without the header, off the one route, with the wrong method, or with no key", async () => {
    const handle = o1Handler("k", (() => Promise.reject(new Error("must not be called"))) as unknown as typeof fetch);
    expect((await handle(request("/launches/prepare", { header: false }))).status).toBe(403);
    expect((await handle(request("/wallets/0xabc"))).status).toBe(404);
    expect((await handle(request("/launches/prepare", { method: "GET" }))).status).toBe(405);
    const noKey = await o1Handler(null)(request("/launches/prepare"));
    expect(noKey.status).toBe(503);
    expect(await noKey.json()).toMatchObject({ code: "no_api_key", detail: NO_KEY });
  });

  /** o1's one unauthenticated route — asked WITHOUT the key, even when the server has one. */
  it("answers o1's health without spending the key, and reads a failure as down", async () => {
    const seen: Headers[] = [];
    const health = (status: number) =>
      o1Handler("k", (async (_url: string, init: RequestInit) => {
        seen.push(new Headers(init.headers));
        return new Response(null, { status });
      }) as unknown as typeof fetch)(new Request(`http://localhost${O1_PATH}/health`, { headers: { [O1_REQUEST_HEADER]: "1" } }));
    expect(await (await health(200)).json()).toEqual({ up: true, status: 200 });
    expect(await (await health(500)).json()).toEqual({ up: false, status: 500 });
    expect(seen.every((h) => h.get("x-api-key") === null)).toBe(true);
    const offline = await o1Handler(null, (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch)(
      new Request(`http://localhost${O1_PATH}/health`, { headers: { [O1_REQUEST_HEADER]: "1" } }),
    );
    expect(await offline.json()).toEqual({ up: false, status: 0 });
    const posted = await o1Handler("k")(
      new Request(`http://localhost${O1_PATH}/health`, { method: "POST", body: "{}", headers: { [O1_REQUEST_HEADER]: "1" } }),
    );
    expect(posted.status).toBe(405);
  });

  it("says o1 could not be reached rather than failing blank", async () => {
    const answer = await o1Handler("k", (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch)(
      request("/launches/prepare"),
    );
    expect(answer.status).toBe(502);
    expect(await answer.json()).toMatchObject({ detail: "o1's launch API could not be reached.", origin: "quadra-server" });
  });
});

describe("checking o1's plan before anything is signed", () => {
  const now = new Date("2026-09-30T10:05:00.000Z");

  it("reads a good plan: its one step, the token, the fee and o1's own warnings", () => {
    const p = checkPlan(plan(), ME, now);
    expect(p.steps).toEqual([{ label: "Create the launch", tx: { to: O1.factory, data: "0xabcdef", value: 10n ** 15n } }]);
    expect(p).toMatchObject({ token: TOKEN, name: "Quadra Cat", symbol: "QCAT", creationFee: 10n ** 15n, metadataUri: "ipfs://bafymeta" });
    expect(p.warnings).toEqual(["The image was resized to 512 px", "Anti-snipe tax is active for 20 seconds"]);
  });

  it.each([
    ["no plan", () => ({ nope: 1 }), /no plan in it/],
    ["another chain", () => plan((d) => (d.chain_id = 1)), /is for chain 1, not Base \(8453\)/],
    ["another wallet", () => plan((d) => (d.actor = OTHER)), /different wallet than the one connected/],
    ["expired", () => plan((d) => (d.expires_at = "2026-09-30T10:00:00.000Z")), /has expired/],
    ["unreadable expiry", () => plan((d) => (d.expires_at = 5)), /has expired/],
    ["a blocking issue", () => plan((d) => (d.issues = [{ code: "insufficient_balance", severity: "blocking", detail: "Not enough ETH" }])), /o1 reports "Not enough ETH"/],
    ["an action it does not take", () => plan((d) => (d.issues = [{ code: "approve_fee", severity: "action_required" }])), /o1 reports "approve_fee"/],
    ["an issue with nothing to say", () => plan((d) => (d.issues = [{ severity: "blocking" }])), /o1 reports "an issue"/],
    ["no steps", () => plan((d) => (d.steps = [])), /has no steps/],
    ["steps that are not a list", () => plan((d) => (d.steps = { launch: 1 })), /has no steps/],
    ["a typed-data step", () => plan((d) => (d.steps = [{ kind: "typed_data", typed_data: {} }])), /typed data \(Permit2\)/],
    ["a step on another chain", () => plan((d) => ((step(d).transaction as Record<string, unknown>).chain_id = 1)), /another chain/],
    ["a step from someone else", () => plan((d) => ((step(d).transaction as Record<string, unknown>).from = OTHER)), /from a different wallet/],
    ["a step to another contract", () => plan((d) => ((step(d).transaction as Record<string, unknown>).to = OTHER)), new RegExp(`sends to ${OTHER}, not to o1's verified factory`)],
    ["calldata that is not hex", () => plan((d) => ((step(d).transaction as Record<string, unknown>).data = "0xz")), /calldata is not hex/],
    ["a value that is not a number", () => plan((d) => ((step(d).transaction as Record<string, unknown>).value = "1.5")), /value is not a whole number/],
    ["more ETH than the fee", () => plan((d) => ((step(d).transaction as Record<string, unknown>).value = "2000000000000000")), /more than the 1000000000000000 wei creation fee/],
    ["no token address", () => plan((d) => (d.predicted_token_address = "0x12")), /names no token address/],
  ])("refuses a plan with %s", (_, body, why) => {
    expect(() => checkPlan(body(), ME, now)).toThrow(why);
    expect(() => checkPlan(body(), ME, now)).toThrow(/^This build will not sign o1's plan: .* Nothing was sent\.$/);
  });

  /** A fee paid in a token is not native value, so a step may carry no ETH at all. */
  it("allows no ETH when the fee is not native, or absent", () => {
    const tokenFee = plan((d) => {
      d.creation_fee = { amount_raw: FEE, currency_address: OTHER };
      (step(d).transaction as Record<string, unknown>).value = "0";
    });
    expect(checkPlan(tokenFee, ME, now).creationFee).toBe(0n);
    const noFee = plan((d) => {
      delete d.creation_fee;
      (step(d).transaction as Record<string, unknown>).value = "1";
    });
    expect(() => checkPlan(noFee, ME, now)).toThrow(/more than the 0 wei creation fee/);
  });

  it("fills what a plan leaves out without inventing it", () => {
    const sparse = plan((d) => {
      delete d.review;
      delete d.issues;
      d.metadata_uri = 7;
      d.image_url = null;
      step(d).label = "";
    });
    const p = checkPlan({ data: sparse.data }, ME, now);
    expect(p).toMatchObject({ name: "?", symbol: "?", metadataUri: "", imageUrl: null, warnings: [] });
    expect(p.steps[0]!.label).toBe("Launch on o1");
  });

  it("passes on a warning by its code when it has no detail, and drops one with neither", () => {
    const p = checkPlan(plan((d) => (d.issues = [{ severity: "warning", code: "slow_indexer" }, { severity: "warning" }])), ME, now);
    expect(p.warnings).toEqual(["slow_indexer", "Anti-snipe tax is active for 20 seconds"]);
  });

  it("checks against the current time when not told one", () => {
    expect(checkPlan(plan(), ME).token).toBe(TOKEN);
  });

  const asked: Asked = { pair: CRYPTO_PAIRS[0]!, editable: false, feeCap: MEASURED_FEE };

  it("accepts a plan for exactly the pair, market and profile setting asked", () => {
    expect(checkPlan(plan(), ME, now, asked).editable).toBe(false);
    const stock = plan((d) => {
      Object.assign(review(d), { market: "rwa", quote_address: NVDA_ON_BASE.toLowerCase(), launch_product: "non-tax" });
      (review(d).token as Record<string, unknown>).editable_metadata = true;
    });
    expect(checkPlan(stock, ME, now, { ...asked, pair: NVDA, editable: true })).toMatchObject({ name: "Quadra Cat", editable: true });
  });

  it.each([
    ["another market", () => plan((d) => (review(d).market = "rwa")), asked, /it is for o1's rwa market, not standard as asked/],
    ["another pair", () => plan((d) => (review(d).quote_address = USDC.address)), asked, new RegExp(`pairs the token with ${USDC.address}, not ETH as asked`)],
    ["no pair named", () => plan((d) => delete review(d).quote_address), asked, /pairs the token with undefined, not ETH as asked/],
    ["no review at all", () => plan((d) => delete d.review), asked, /it is for o1's undefined market/],
    ["a tax launch", () => plan((d) => (review(d).launch_product = "tax")), asked, /a tax launch, which was not asked for/],
    ["profile editing nobody asked for", () => stockPlan(), { ...asked, pair: NVDA }, /it grants profile editing, which is not what was asked/],
    ["no profile editing when it was asked for", () => plan(), { ...asked, editable: true }, /it does not grant profile editing/],
    ["more ETH than the factory charges", () => plan(), { ...asked, feeCap: 1n }, /sends 1000000000000000 wei, more than the 1 wei o1's factory charges on Base/],
  ])("refuses a plan with %s", (_, body, want, why) => {
    expect(() => checkPlan(body(), ME, now, want)).toThrow(why);
  });
});

const INPUT: LaunchInput = {
  creator: ME,
  pair: CRYPTO_PAIRS[0]!,
  editable: false,
  extra: [],
  name: "Quadra Cat",
  symbol: "QCAT",
  description: "",
  website: "",
  x: "",
  telegram: "",
  imageBase64: "iVBORw0KGgo=",
  imageType: "image/png",
};

describe("o1's factory, read from Base", () => {
  it("reads whether creation is open, the fee, and a pair's registration", async () => {
    world();
    expect(await factoryState(ZERO)).toEqual({ open: true, fee: MEASURED_FEE, registered: true });
    expect(await factoryState(NVDA_ON_BASE)).toEqual({ open: true, fee: MEASURED_FEE, registered: true });
    expect((await factoryState(WETH.address)).registered).toBe(false);
    // every crypto pair offered is one the factory registered when it was measured
    for (const p of CRYPTO_PAIRS) expect((await factoryState(p.address)).registered).toBe(true);
  });

  it("offers the crypto pairs first, then Coinbase's stocks on Base", async () => {
    world();
    const { pairs, problem } = await launchPairs();
    expect(problem).toBeNull();
    expect(pairs.map((p) => `${p.market}:${p.symbol}`)).toEqual([
      "standard:ETH",
      "standard:USDC",
      "standard:cbBTC",
      ...["AAPL", "AMD", "DKNG", "GOOGL", "NVDA", "TSLA"].map((s) => `rwa:${s}`),
    ]);
    expect(pairs.find((p) => p.symbol === "NVDA")).toEqual(NVDA);
  });

  it("still offers the crypto pairs when o1's catalog cannot be read, and says why", async () => {
    world(undefined, { catalog: DOWN });
    expect(await launchPairs()).toEqual({ pairs: CRYPTO_PAIRS, problem: "This app's server could not be reached for the list of stocks on Base." });
  });
});

describe("prepareLaunch", () => {
  it("reads the factory, then asks this app's server — never o1 directly — with a fresh idempotency key, and checks the answer", async () => {
    const seen = world();
    const p = await prepareLaunch(INPUT);
    expect(p.token).toBe(TOKEN);
    expect(seen[0]!.url).toBe(`${O1_PATH}/launches/prepare`);
    const headers = seen[0]!.init!.headers as Record<string, string>;
    expect(headers[O1_REQUEST_HEADER]).toBe("1");
    expect(headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers).not.toHaveProperty("x-api-key");
    expect(JSON.parse(String(seen[0]!.init!.body))).toEqual({
      chain_id: BASE.id,
      creator: ME,
      market: "standard",
      launch_product: "non-tax",
      quote_address: ZERO,
      token: {
        name: "Quadra Cat",
        symbol: "QCAT",
        description: "",
        website: "",
        x: "",
        telegram: "",
        image_base64: "iVBORw0KGgo=",
        image_type: "image/png",
        editable_metadata: false,
        extra_metadata: [],
      },
    });
  });

  it("launches paired with a Base stock on o1's rwa market, with profile editing and extra information", async () => {
    const seen = world(() => json(stockPlan()));
    const p = await prepareLaunch({ ...INPUT, pair: NVDA, editable: true, extra: [{ key: "team", value: "quadra" }] });
    expect(p.editable).toBe(true);
    expect(JSON.parse(String(seen[0]!.init!.body))).toMatchObject({
      market: "rwa",
      quote_address: NVDA_ON_BASE,
      token: { editable_metadata: true, extra_metadata: [{ key: "team", value: "quadra" }] },
    });
  });

  it("refuses before asking o1 when the factory is closed, the pair is not registered, or the factory cannot be read", async () => {
    let seen = world(undefined, { factory: { open: false } });
    await expect(prepareLaunch(INPUT)).rejects.toThrow("o1's factory on Base has launch creation switched off right now. Nothing was prepared.");
    expect(seen).toEqual([]);
    seen = world();
    await expect(prepareLaunch({ ...INPUT, pair: WETH_PAIR })).rejects.toThrow("WETH is not registered as a pair on o1's factory on Base. Nothing was prepared.");
    expect(seen).toEqual([]);
    seen = world(undefined, { factory: { down: true } });
    await expect(prepareLaunch(INPUT)).rejects.toThrow(/^o1's factory on Base could not be read \(.+\)\. Nothing was prepared\.$/);
    expect(seen).toEqual([]);
  });

  it("refuses a plan that carries more ETH than the factory charges", async () => {
    world(undefined, { factory: { fee: 10n ** 14n } });
    await expect(prepareLaunch(INPUT)).rejects.toThrow("more than the 100000000000000 wei o1's factory charges on Base");
  });

  it("says when the server cannot be reached, is not running, or o1 refused", async () => {
    world(() => Promise.reject(new TypeError("offline")) as never);
    await expect(prepareLaunch(INPUT)).rejects.toThrow("This app's launch server could not be reached. Nothing was prepared.");
    world(() => new Response("<!doctype html>", { status: 200 }));
    await expect(prepareLaunch(INPUT)).rejects.toThrow(/The launch server is not running here/);
    // this app's own server refusing — never blamed on o1
    world(() => json({ detail: NO_KEY, code: "no_api_key", origin: "quadra-server" }, 503));
    await expect(prepareLaunch(INPUT)).rejects.toThrow(`${NO_KEY} Nothing was prepared.`);
    // o1 refusing the request, in its problem shape
    world(() => json({ title: "Rate limited", code: "rate_limited" }, 429));
    await expect(prepareLaunch(INPUT)).rejects.toThrow("o1: Rate limited (rate_limited). Nothing was prepared.");
    world(() => json({ title: "Bad" }, 400));
    await expect(prepareLaunch(INPUT)).rejects.toThrow("o1: Bad. Nothing was prepared.");
    // o1 failing on its own side — MEASURED 2026-09-30 through this app's server, all day
    world(() => json({ error: { code: "500", message: "A server error has occurred" } }, 500));
    await expect(prepareLaunch(INPUT)).rejects.toThrow(
      "o1's launch service is failing on its own side (HTTP 500: A server error has occurred). Nothing was prepared — this is not your wallet or this app. Try again later.",
    );
    world(() => json({ error: "down" }, 502));
    await expect(prepareLaunch(INPUT)).rejects.toThrow("failing on its own side (HTTP 502: status 502)");
    world(() => json(["?"], 500));
    await expect(prepareLaunch(INPUT)).rejects.toThrow("(HTTP 500: status 500)");
  });
});

describe("extra information", () => {
  it("drops blank rows and trims the rest", () => {
    expect(checkExtra([{ key: " team ", value: " quadra " }, { key: "", value: "  " }])).toEqual({ extra: [{ key: "team", value: "quadra" }] });
    expect(checkExtra([])).toEqual({ extra: [] });
  });

  it.each([
    ["a value with no key", [{ key: "", value: "x" }], "Give every extra row a key"],
    ["the same key twice", [{ key: "a", value: "1" }, { key: "a", value: "2" }], "Extra keys must all be different"],
    ["a long key", [{ key: "k".repeat(EXTRA.key + 1), value: "" }], `An extra key is over ${EXTRA.key} characters`],
    ["a long value", [{ key: "k", value: "v".repeat(EXTRA.value + 1) }], `An extra value is over ${EXTRA.value} characters`],
    ["too many bytes in all", Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, value: "v".repeat(EXTRA.value) })), `Extra information is over ${EXTRA.bytes} bytes`],
  ])("refuses %s, as o1 would", (_, rows, problem) => {
    expect(checkExtra(rows)).toEqual({ problem });
  });

  it("counts bytes, not characters", () => {
    const wide = Array.from({ length: 8 }, (_, i) => ({ key: `k${i}`, value: "é".repeat(260) }));
    expect(checkExtra(wide)).toEqual({ problem: `Extra information is over ${EXTRA.bytes} bytes` });
  });
});

describe("o1Up", () => {
  it("is up only on a clear yes, asked through this app's server", async () => {
    let asked = "";
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      asked = url;
      expect((init.headers as Record<string, string>)[O1_REQUEST_HEADER]).toBe("1");
      return json({ up: true, status: 200 });
    });
    expect(await o1Up()).toBe(true);
    expect(asked).toBe(`${O1_PATH}/health`);
    vi.stubGlobal("fetch", async () => json({ up: false, status: 500 }));
    expect(await o1Up()).toBe(false);
    vi.stubGlobal("fetch", async () => new Response("<html>"));
    expect(await o1Up()).toBe(false);
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
    expect(await o1Up()).toBe(false);
    vi.stubGlobal("fetch", async () => json(["up"]));
    expect(await o1Up()).toBe(false);
  });
});

describe("readImage", () => {
  it("reads a picture as base64 with its type", async () => {
    const image = await readImage(new File([new Uint8Array([137, 80, 78, 71])], "cat.png", { type: "image/png" }));
    expect(image).toEqual({ base64: "iVBORw==", type: "image/png", name: "cat.png" });
  });

  it("says so when the browser cannot read the file", async () => {
    const read = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      this.dispatchEvent(new Event("loadend"));
    });
    try {
      await expect(readImage(new File(["x"], "a.png", { type: "image/png" }))).rejects.toThrow("The image could not be read.");
    } finally {
      read.mockRestore();
    }
  });

  it("refuses what o1 would refuse", async () => {
    await expect(readImage(new File(["x"], "a.svg", { type: "image/svg+xml" }))).rejects.toThrow("The image must be PNG, JPEG, WebP or GIF.");
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    await expect(readImage(big)).rejects.toThrow("The image must be 2 MB or smaller.");
  });
});

describe("o1 launch", () => {
  function wallet(account: string | null) {
    const sent: Record<string, string>[] = [];
    const provider: Eip1193Provider = {
      request(args: Eip1193Request) {
        if (args.method === "eth_accounts") return Promise.resolve(account ? [account] : []);
        if (args.method === "eth_chainId") return Promise.resolve(BASE.idHex);
        if (args.method === "eth_sendTransaction") {
          sent.push(args.params?.[0] as Record<string, string>);
          return Promise.resolve(HASH);
        }
        return Promise.reject(new Error(`unstubbed ${args.method}`));
      },
    };
    vi.stubGlobal("ethereum", provider);
    return sent;
  }

  /** `world` with the order the panel tests read best in: o1's answer, the token's code, o1's health. */
  function network(o1: () => Response, code = "0x6080", up: () => boolean = () => true) {
    return world(o1, { code, up });
  }

  function mount() {
    return render(
      <WalletProvider>
        <O1Launch />
      </WalletProvider>,
    );
  }

  const cta = () => screen.getByRole("button", { name: /Connect|Enter|Pick|Name is|Prepar|Launch|registered pair|creation is off| must |is over|Give every/ });
  const png = () => new File([new Uint8Array([137, 80, 78, 71])], "cat.png", { type: "image/png" });

  async function fillForm() {
    await userEvent.type(screen.getByLabelText("Name"), "Quadra Cat");
    await userEvent.type(screen.getByLabelText("Symbol"), "QCAT");
    await userEvent.upload(screen.getByLabelText("Image"), png());
  }

  /** MEASURED 2026-09-30: o1 answered 500 to its own health check all day. */
  it("says up front when o1 is down, and checks again on request", async () => {
    wallet(ME);
    let up = false;
    network(() => json(plan()), "0x6080", () => up);
    mount();
    expect(await screen.findByLabelText("o1 status")).toHaveTextContent("o1's launch service is not answering right now");
    up = true;
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.queryByLabelText("o1 status")).not.toBeInTheDocument());
  });

  it("says nothing about o1 when it is up", async () => {
    wallet(ME);
    network(() => json(plan()));
    mount();
    await act(async () => {});
    await act(async () => {});
    expect(screen.queryByLabelText("o1 status")).not.toBeInTheDocument();
  });

  it("names what is missing, in order", async () => {
    wallet(null);
    const { unmount } = mount();
    await act(async () => {});
    expect(cta()).toHaveTextContent("Connect a wallet first");
    unmount();

    wallet(ME);
    mount();
    await act(async () => {});
    expect(cta()).toHaveTextContent("Enter a name");
    await userEvent.type(screen.getByLabelText("Name"), "x".repeat(51));
    expect(cta()).toHaveTextContent("Name is over 50 characters");
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Quadra Cat");
    expect(cta()).toHaveTextContent("Enter a symbol (1–11 characters, no spaces)");
    await userEvent.type(screen.getByLabelText("Symbol"), "Q CAT");
    expect(cta()).toHaveTextContent("Enter a symbol");
    await userEvent.clear(screen.getByLabelText("Symbol"));
    await userEvent.type(screen.getByLabelText("Symbol"), "QCAT");
    expect(cta()).toHaveTextContent("Pick an image");
    await userEvent.upload(screen.getByLabelText("Image"), png());
    await waitFor(() => expect(cta()).toHaveTextContent("Prepare with o1"));
  });

  it("prepares through the server, shows what was checked, launches, and says the token is live", async () => {
    const sent = wallet(ME);
    const asked = network(() => json(plan()));
    mount();
    await act(async () => {});
    await fillForm();
    await userEvent.type(screen.getByLabelText("Website"), "https://quadra.example");
    await userEvent.click(screen.getByRole("button", { name: "Add extra information" }));
    await userEvent.type(screen.getByLabelText("Extra key 1"), "team");
    await userEvent.type(screen.getByLabelText("Extra value 1"), "quadra");
    await userEvent.click(await screen.findByRole("button", { name: "Prepare with o1" }));
    const review = await screen.findByRole("region", { name: "Quadra Cat (QCAT) — ready to launch" });
    expect(JSON.parse(String(asked[0]!.init!.body)).token).toMatchObject({ editable_metadata: false, extra_metadata: [{ key: "team", value: "quadra" }] });
    expect(review).toHaveTextContent("Paired withETH on Base — crypto, checked against the plan");
    expect(review).toHaveTextContent("Profile editingoff — the profile is fixed at launch");
    expect(review).toHaveTextContent("Extra information1 entry, public in the token's profile");
    expect(review).not.toHaveTextContent("Stock-paired");
    expect(review).toHaveTextContent("Sources: o1 launch API (through this app's server), o1's factory on Base (read directly)");
    expect(review).toHaveTextContent("0.001 ETH, paid to o1 in the launch transaction");
    expect(review).toHaveTextContent(`o1's factory ${O1.factory} — checked, verified on Blockscout`);
    expect(review).toHaveTextContent("Public: the token, your address as its creator");
    expect(review).toHaveTextContent("o1: Anti-snipe tax is active for 20 seconds");
    await userEvent.click(screen.getByRole("button", { name: "Launch in wallet" }));
    await waitFor(() => expect(screen.getByText(/Your token is live:/)).toBeInTheDocument());
    expect(sent).toEqual([{ from: ME, to: O1.factory, value: "0x38d7ea4c68000", data: "0xabcdef" }]);
    expect(screen.getByRole("link", { name: TOKEN })).toHaveAttribute("href", `${BASE.explorer}/token/${TOKEN}`);
    expect(cta()).toHaveTextContent("Launched — edit a field to start another");
  });

  it("says so when the launch confirmed but nothing is at the predicted address yet", async () => {
    wallet(ME);
    network(() => json(plan((d) => (d.image_url = null))), "0x");
    mount();
    await act(async () => {});
    await fillForm();
    await userEvent.click(await screen.findByRole("button", { name: "Prepare with o1" }));
    await userEvent.click(await screen.findByRole("button", { name: "Launch in wallet" }));
    expect(await screen.findByText(/no contract is at the predicted address yet/)).toBeInTheDocument();
  });

  it("shows why a plan was refused, and never reaches the wallet", async () => {
    const sent = wallet(ME);
    network(() => json(plan((d) => ((step(d).transaction as Record<string, unknown>).to = OTHER))));
    mount();
    await act(async () => {});
    await fillForm();
    await userEvent.click(await screen.findByRole("button", { name: "Prepare with o1" }));
    expect(await screen.findByLabelText("Launch error")).toHaveTextContent("not to o1's verified factory");
    expect(sent).toEqual([]);
  });

  it("refuses an image o1 would refuse, and clears the image when the picker is emptied", async () => {
    wallet(ME);
    mount();
    await act(async () => {});
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(screen.getByLabelText("Image"), new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }));
    expect(await screen.findByLabelText("Launch error")).toHaveTextContent("PNG, JPEG, WebP or GIF");
    await user.upload(screen.getByLabelText("Image"), png());
    await waitFor(() => expect(screen.queryByLabelText("Launch error")).not.toBeInTheDocument());
    await act(async () => {
      const input = screen.getByLabelText("Image") as HTMLInputElement;
      Object.defineProperty(input, "files", { configurable: true, value: [] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await userEvent.type(screen.getByLabelText("Name"), "N");
    await userEvent.type(screen.getByLabelText("Symbol"), "S");
    expect(cta()).toHaveTextContent("Pick an image");
  });

  it("throws the plan away when a field changes, so what was prepared is what gets signed", async () => {
    wallet(ME);
    network(() => json(plan()));
    mount();
    await act(async () => {});
    await fillForm();
    const prepare = async () => {
      await userEvent.click(await screen.findByRole("button", { name: "Prepare with o1" }));
      await screen.findByRole("button", { name: "Launch in wallet" });
    };
    await prepare();
    await userEvent.selectOptions(screen.getByLabelText("Paired with"), "USDC");
    expect(screen.queryByRole("button", { name: "Launch in wallet" })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Paired with"), "ETH");
    await prepare();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(screen.queryByRole("button", { name: "Launch in wallet" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox"));
    await prepare();
    await userEvent.type(screen.getByLabelText("Description"), "a cat");
    expect(screen.queryByRole("button", { name: "Launch in wallet" })).not.toBeInTheDocument();
    expect(cta()).toHaveTextContent("Prepare with o1");
  });
  it("offers crypto pairs first, then Base stock tokens, and reads o1's factory for the one picked", async () => {
    wallet(ME);
    network(() => json(plan()));
    mount();
    const select = screen.getByLabelText("Paired with");
    expect(screen.getByText("Checking ETH on o1's factory on Base…")).toHaveClass("dim");
    expect(await screen.findByText("ETH is a registered pair · creation fee 0.001 ETH — read from Base")).toHaveClass("tx__ok");
    const groups = await waitFor(() => {
      const g = within(select).getAllByRole("group");
      expect(g).toHaveLength(2);
      return g;
    });
    expect(groups.map((g) => g.getAttribute("label"))).toEqual(["Crypto on Base", "Stock tokens on Base"]);
    expect(within(groups[0]!).getAllByRole("option").map((o) => o.textContent)).toEqual(["ETH", "USDC", "cbBTC"]);
    expect(within(groups[1]!).getAllByRole("option")).toHaveLength(6);
    expect(screen.queryByText(/Stock-paired:/)).not.toBeInTheDocument();
    await userEvent.selectOptions(select, NVDA_ON_BASE);
    expect(await screen.findByText("NVDA is a registered pair · creation fee 0.001 ETH — read from Base")).toBeInTheDocument();
    expect(screen.getByText("Stock-paired: your token trades against NVDA, and the trading fees you earn arrive in NVDA.")).toBeInTheDocument();
  });

  it("launches paired with a Base stock, profile editable, and says so in the review", async () => {
    const sent = wallet(ME);
    const asked = network(() => json(stockPlan()));
    mount();
    await act(async () => {});
    await fillForm();
    await waitFor(() => expect(screen.getByRole("option", { name: "NVDA — NVIDIA Corporation" })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Paired with"), NVDA_ON_BASE);
    await userEvent.click(screen.getByRole("checkbox", { name: /Let me edit the token's profile later/ }));
    for (const [i, key] of ["team", "chain"].entries()) {
      await userEvent.click(screen.getByRole("button", { name: "Add extra information" }));
      await userEvent.type(screen.getByLabelText(`Extra key ${i + 1}`), key);
      await userEvent.type(screen.getByLabelText(`Extra value ${i + 1}`), "x");
    }
    await userEvent.click(await screen.findByRole("button", { name: "Prepare with o1" }));
    const review = await screen.findByRole("region", { name: "Quadra Cat (QCAT) — ready to launch" });
    expect(JSON.parse(String(asked[0]!.init!.body))).toMatchObject({ market: "rwa", quote_address: NVDA_ON_BASE, token: { editable_metadata: true } });
    expect(review).toHaveTextContent("Paired withNVDA on Base — a stock token (NVIDIA Corporation), checked against the plan");
    expect(review).toHaveTextContent("Profile editingon — you can change the token's profile later, and nothing else");
    expect(review).toHaveTextContent("Extra information2 entries");
    expect(review).toHaveTextContent("Stock-paired: the token trades against NVDA, and the trading fees you earn as creator arrive in NVDA.");
    await userEvent.click(screen.getByRole("button", { name: "Launch in wallet" }));
    await waitFor(() => expect(sent).toHaveLength(1));
  });

  it("will not prepare a pair the factory does not register, or while it is closed", async () => {
    wallet(ME);
    world(() => json(plan()), { factory: { registered: false } });
    const first = mount();
    await fillForm();
    expect(await screen.findByText("ETH is not registered as a pair on o1's factory — o1 would refuse it.")).toHaveClass("tx__bad");
    expect(cta()).toHaveTextContent("ETH is not a registered pair");
    first.unmount();

    world(() => json(plan()), { factory: { open: false } });
    mount();
    await fillForm();
    expect(await screen.findByText("o1's factory has launch creation switched off right now.")).toHaveClass("tx__bad");
    expect(cta()).toHaveTextContent("Launch creation is off on o1's factory");
  });

  it("says when the factory cannot be read, and leaves that check to Prepare", async () => {
    wallet(ME);
    world(() => json(plan()), { factory: { down: true } });
    mount();
    await fillForm();
    expect(await screen.findByText(/^o1's factory could not be read: /)).toHaveClass("tx__warn");
    expect(cta()).toHaveTextContent("Prepare with o1");
  });

  it("says when stock pairs are not listed, and still offers the crypto ones", async () => {
    wallet(ME);
    world(() => json(plan()), { catalog: DOWN });
    mount();
    expect(await screen.findByText("Stock pairs are not listed right now: This app's server could not be reached for the list of stocks on Base.")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Paired with")).getAllByRole("group")).toHaveLength(1);
  });

  it("checks links, the description and extra information the way o1 would", async () => {
    wallet(ME);
    network(() => json(plan()));
    mount();
    await fillForm();
    await waitFor(() => expect(cta()).toHaveTextContent("Prepare with o1"));
    const retype = async (label: string, text: string) => {
      await userEvent.clear(screen.getByLabelText(label));
      if (text) await userEvent.type(screen.getByLabelText(label), text);
    };
    await retype("Website", "quadra");
    expect(cta()).toHaveTextContent("Website must be a full https:// link");
    await retype("Website", "https://quadra.example/about");
    await retype("X", "https://twitter.com/quadra");
    expect(cta()).toHaveTextContent("X must be an x.com link");
    await retype("X", "https://x.com/quadra");
    await retype("Telegram", "@quadra");
    expect(cta()).toHaveTextContent("Telegram must be a t.me link");
    await retype("Telegram", "https://t.me/quadra");
    expect(cta()).toHaveTextContent("Prepare with o1");
    await userEvent.click(screen.getByLabelText("Description"));
    await userEvent.paste("é".repeat(1001));
    expect(cta()).toHaveTextContent("Description is over 2000 bytes");
    await userEvent.clear(screen.getByLabelText("Description"));
    await userEvent.click(screen.getByRole("button", { name: "Add extra information" }));
    expect(cta()).toHaveTextContent("Prepare with o1");
    await userEvent.type(screen.getByLabelText("Extra value 1"), "orphan");
    expect(cta()).toHaveTextContent("Give every extra row a key");
    await userEvent.click(screen.getByRole("button", { name: "Remove extra 1" }));
    expect(screen.queryByLabelText("Extra value 1")).not.toBeInTheDocument();
    expect(cta()).toHaveTextContent("Prepare with o1");
  });

  it("stops adding extra rows at o1's limit", async () => {
    wallet(ME);
    mount();
    await act(async () => {});
    const add = screen.getByRole("button", { name: "Add extra information" });
    for (let i = 0; i < EXTRA.rows; i++) await userEvent.click(add);
    expect(screen.getByLabelText(`Extra key ${EXTRA.rows}`)).toBeInTheDocument();
    expect(add).toBeDisabled();
  });
});
