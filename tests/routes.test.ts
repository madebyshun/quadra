import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionData, erc20Abi } from "viem";
import { BASE, CONTRACTS, USDC, WETH } from "@/config/chain";
import { ACROSS, ACROSS_ABI, NATIVE, RELAY, ROBINHOOD } from "@/config/routes";
import { checkSwap, isRelayNoRoute, quoteSwap, type SwapRequest } from "@/adapters/http/relay";
import { checkBridge, exactApproval, quoteBridge, type BridgeRequest } from "@/adapters/http/across";
import { askQuote, rawAmount } from "@/adapters/http/quotes";
import { robinhoodBalance, waitForArrival } from "@/lib/arrival";
import { approveData, ETH, transferData, type Asset } from "@/lib/erc20";
import { rpcOn } from "@/skills/http";
import { copy } from "./fixtures/base";
import { ROUTES_FX, USER } from "./fixtures/routes";
import { DOWN, json, net, RpcError, useNet } from "./net";

useNet();

const USDC_ASSET: Asset = { kind: "erc20", address: USDC.address, symbol: "USDC", decimals: 6 };
const WETH_ASSET: Asset = { kind: "erc20", address: WETH.address, symbol: "WETH", decimals: 18 };
const OTHER = "0x1111111111111111111111111111111111111111";

type Json = Record<string, unknown>;

// ── quote plumbing ──────────────────────────────────────────────────────────

describe("askQuote", () => {
  it("returns the body, or the service's own sentence when it refuses", async () => {
    vi.stubGlobal("fetch", async () => json({ ok: 1 }));
    expect(await askQuote("Relay", "https://x")).toEqual({ ok: 1 });
    // MEASURED 2026-09-30: Relay's answer to an amount of 1
    vi.stubGlobal("fetch", async () => json({ message: "Amount is too small to be swapped", errorCode: "AMOUNT_TOO_LOW" }, 400));
    await expect(askQuote("Relay", "https://x")).rejects.toThrow("Relay: Amount is too small to be swapped.");
    vi.stubGlobal("fetch", async () => json([], 503));
    await expect(askQuote("Across", "https://x")).rejects.toThrow("Across: it answered 503.");
  });

  it("names the service when it cannot be reached or does not answer JSON", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
    await expect(askQuote("Across", "https://x")).rejects.toThrow("Across could not be reached. Nothing was quoted.");
    vi.stubGlobal("fetch", async () => new Response("<html>"));
    await expect(askQuote("Across", "https://x")).rejects.toThrow("Across answered with something that is not JSON.");
  });

  it("reads base-10 amounts and nothing else", () => {
    expect(rawAmount("5000000")).toBe(5_000_000n);
    expect(rawAmount("0")).toBe(0n);
    expect(rawAmount("05")).toBeNull();
    expect(rawAmount(5)).toBeNull();
  });
});

// ── Relay ───────────────────────────────────────────────────────────────────

const SELL_USDC: SwapRequest = { user: USER, sell: USDC_ASSET, buy: WETH_ASSET, amount: 5_000_000n, slippageBps: 50 };
const SELL_ETH: SwapRequest = { user: USER, sell: ETH, buy: USDC_ASSET, amount: 10n ** 15n, slippageBps: 50 };

/** The measured USDC→WETH quote with one edit applied — the edit is what each test is about. */
function usdcQuote(edit: (q: Json) => void = () => {}): Json {
  const q = copy(ROUTES_FX.relayUsdcWeth) as unknown as Json;
  edit(q);
  return q;
}
const item = (q: Json, step: number) => ((q.steps as Json[])[step]!.items as Json[])[0]!.data as Json;

describe("Relay's no-route refusal", () => {
  it("is recognised in both of Relay's wordings, thrown as an Error or as a bare string", () => {
    expect(isRelayNoRoute(new Error("Relay: No routes found."))).toBe(true);
    expect(isRelayNoRoute(new Error("Relay: no route"))).toBe(true);
    expect(isRelayNoRoute("Relay: No routes found")).toBe(true);
    expect(isRelayNoRoute("Relay: Amount is too small to be swapped.")).toBe(false);
    expect(isRelayNoRoute(new Error("No routes found"))).toBe(false);
  });
});

describe("checking a Relay swap", () => {
  it("accepts the measured USDC→WETH quote: an exact approval, then the swap, both to pinned contracts", () => {
    const q = checkSwap(ROUTES_FX.relayUsdcWeth, SELL_USDC);
    expect(q.steps.map((s) => s.label)).toEqual(["Approve Relay to move exactly this much USDC", "Swap USDC for WETH"]);
    expect(q.steps[0]!.tx.to.toLowerCase()).toBe(USDC.address.toLowerCase());
    expect(decodeFunctionData({ abi: erc20Abi, data: q.steps[0]!.tx.data! }).args).toEqual([RELAY.approvalProxy, 5_000_000n]);
    expect(q.steps[1]!.tx.to.toLowerCase()).toBe(RELAY.approvalProxy.toLowerCase());
    expect(q.steps[1]!.tx.value).toBe(0n);
    expect(q).toMatchObject({ out: 1858461545609535n, min: 1849169237881487n, impact: "-0.11", feeOn: false });
  });

  it("accepts the measured ETH→USDC quote: one step to the router, carrying exactly the amount", () => {
    const q = checkSwap(ROUTES_FX.relayEthUsdc, SELL_ETH);
    expect(q.steps).toHaveLength(1);
    expect(q.steps[0]!.tx.to.toLowerCase()).toBe(RELAY.router.toLowerCase());
    expect(q.steps[0]!.tx.value).toBe(10n ** 15n);
  });

  it.each([
    ["an unknown step", (q: Json) => ((q.steps as Json[])[0]!.id = "deposit"), /a step called "deposit"/],
    ["no swap step", (q: Json) => (q.steps = (q.steps as Json[]).slice(0, 1)), /no swap step/],
    ["another chain", (q: Json) => (item(q, 1).chainId = 1), /for chain 1/],
    ["another sender", (q: Json) => (item(q, 1).from = OTHER), /from a different wallet/],
    ["no destination", (q: Json) => (item(q, 1).to = 5), /no destination/],
    ["non-hex calldata", (q: Json) => (item(q, 1).data = "0xzz"), /calldata is not hex/],
    ["a bad value", (q: Json) => (item(q, 1).value = "1.0"), /value is not a whole number/],
    ["an approval on another token", (q: Json) => (item(q, 0).to = OTHER), /not on the token being sold/],
    ["an approval that is not approve()", (q: Json) => (item(q, 0).data = transferData(OTHER, 1n)), /not an ERC-20 approve/],
    ["an approval that does not decode", (q: Json) => (item(q, 0).data = "0x1234"), /not an ERC-20 approve/],
    ["an approval to another spender", (q: Json) => (item(q, 0).data = approveData(OTHER, 5_000_000n)), new RegExp(`approval is for ${OTHER}`)],
    ["an approval for more than is sold", (q: Json) => (item(q, 0).data = approveData(RELAY.approvalProxy, 2n ** 256n - 1n)), /not exactly the 5000000 being sold/],
    ["an approval that sends ETH", (q: Json) => (item(q, 0).value = "1"), /approval step sends ETH/],
    ["a swap to another contract", (q: Json) => (item(q, 1).to = OTHER), new RegExp(`swap goes to ${OTHER}`)],
    ["a token swap that sends ETH", (q: Json) => (item(q, 1).value = "7"), /sends 7 wei of ETH, not 0/],
    ["another token out", (q: Json) => ((((q.details as Json).currencyOut as Json).currency as Json).address = OTHER), /not the token asked for/],
    ["no token out", (q: Json) => delete ((q.details as Json).currencyOut as Json).currency, /is for null/],
    ["another amount in", (q: Json) => (((q.details as Json).currencyIn as Json).amount = "1"), /different amount in/],
    ["no amount out", (q: Json) => delete ((q.details as Json).currencyOut as Json).amount, /no amount out/],
    ["no minimum", (q: Json) => delete ((q.details as Json).currencyOut as Json).minimumAmount, /no minimum out/],
    ["a minimum above the estimate", (q: Json) => (((q.details as Json).currencyOut as Json).minimumAmount = "9999999999999999999"), /minimum is larger/],
  ])("refuses a quote with %s", (_, edit, why) => {
    expect(() => checkSwap(usdcQuote(edit), SELL_USDC)).toThrow(why);
    expect(() => checkSwap(usdcQuote(edit), SELL_USDC)).toThrow(/^This build will not sign Relay's quote: .* Nothing was sent\.$/);
  });

  it("refuses an approval step when ETH is sold", () => {
    const q = copy(ROUTES_FX.relayUsdcWeth) as unknown as Json;
    expect(() => checkSwap(q, { ...SELL_USDC, sell: ETH })).toThrow(/not on the token being sold/);
  });

  it("refuses an ETH swap that carries a different value", () => {
    const q = copy(ROUTES_FX.relayEthUsdc) as unknown as Json;
    item(q, 0).value = "1";
    expect(() => checkSwap(q, SELL_ETH)).toThrow(/sends 1 wei of ETH, not 1000000000000000/);
  });

  it("reads a quote with no steps or no details as refused, and no impact as unreported", () => {
    expect(() => checkSwap({}, SELL_USDC)).toThrow(/no swap step/);
    expect(() => checkSwap(null, SELL_USDC)).toThrow(/no swap step/);
    expect(() => checkSwap({ steps: [7] }, SELL_USDC)).toThrow(/a step is not an object/);
    expect(() => checkSwap({ steps: [{}] }, SELL_USDC)).toThrow(/a step called "null"/);
    const q = usdcQuote((x) => delete (x.details as Json).totalImpact);
    expect(checkSwap(q, SELL_USDC).impact).toBeNull();
  });
});

describe("quoting a Relay swap", () => {
  it("asks for an exact-input quote on Base, with no fee when there is no fee address", async () => {
    const seen: Json[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      expect(url).toBe(`${RELAY.api}/quote`);
      seen.push(JSON.parse(String(init.body)) as Json);
      return json(ROUTES_FX.relayUsdcWeth);
    });
    const q = await quoteSwap(SELL_USDC, null);
    expect(q.feeOn).toBe(false);
    expect(seen[0]).toEqual({
      user: USER,
      recipient: USER,
      originChainId: BASE.id,
      destinationChainId: BASE.id,
      originCurrency: USDC.address,
      destinationCurrency: WETH.address,
      amount: "5000000",
      tradeType: "EXACT_INPUT",
      slippageTolerance: "50",
    });
  });

  it("adds the app fee, in bps, only when a fee address is given", async () => {
    let body: Json = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Json;
      return json(ROUTES_FX.relayEthUsdc);
    });
    const q = await quoteSwap(SELL_ETH, OTHER);
    expect(q.feeOn).toBe(true);
    expect(body.originCurrency).toBe(NATIVE);
    expect(body.appFees).toEqual([{ recipient: OTHER, fee: "10" }]);
  });

  /** The owner's fee address is the default since 2026-09-30, so an ordinary quote carries the fee. */
  it("charges the fee to the configured treasury by default", async () => {
    let body: Json = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Json;
      return json(ROUTES_FX.relayUsdcWeth);
    });
    expect((await quoteSwap(SELL_USDC)).feeOn).toBe(true);
    expect(body.appFees).toEqual([{ recipient: CONTRACTS.treasury, fee: "10" }]);
    let asked = "";
    vi.stubGlobal("fetch", async (url: string) => {
      asked = url;
      return json(ROUTES_FX.acrossUsdc);
    });
    expect((await quoteBridge(BRIDGE_USDC)).feeOn).toBe(true);
    expect(new URL(asked).searchParams.get("appFeeRecipient")).toBe(CONTRACTS.treasury);
  });

  it("refuses to swap a token for itself without asking anyone", async () => {
    await expect(quoteSwap({ ...SELL_USDC, buy: USDC_ASSET })).rejects.toThrow("Pick two different tokens.");
  });
});

// ── Across ──────────────────────────────────────────────────────────────────

const BRIDGE_USDC: BridgeRequest = { user: USER, asset: "USDC", amount: 5_000_000n };
const BRIDGE_ETH: BridgeRequest = { user: USER, asset: "ETH", amount: 10n ** 15n };

/** Re-encode the measured deposit with one argument changed. */
function withArg(fixture: Json, index: number, value: unknown): Json {
  const q = copy(fixture);
  const tx = q.swapTx as Json;
  const call = decodeFunctionData({ abi: ACROSS_ABI, data: tx.data as `0x${string}` });
  const args = [...call.args] as unknown[];
  args[index] = value;
  tx.data = encodeFunctionData({ abi: ACROSS_ABI, functionName: call.functionName, args: args as never });
  return q;
}
const usdcFx = ROUTES_FX.acrossUsdc as unknown as Json;
const ethFx = ROUTES_FX.acrossEth as unknown as Json;
const word = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;

describe("checking an Across bridge", () => {
  it("accepts the measured USDC quote, and ignores Across's unlimited approval", () => {
    const q = checkBridge(usdcFx, BRIDGE_USDC);
    expect(q.tx.to).toBe(ACROSS.spokePool);
    expect(q.tx.value).toBe(0n);
    expect(q).toMatchObject({ min: 4988141n, receive: ROBINHOOD.usdg, fillSeconds: 2, feeOn: false });
    expect(q.spend).toEqual({ token: USDC.address, spender: ACROSS.spokePool });
    expect(q.expiresAt?.toISOString()).toBe(new Date(1790766299 * 1000).toISOString());
    // measured: Across asked for the maximum; the app builds exactly the amount instead
    expect(((usdcFx.approvalTxns as Json[])[0]!.data as string).endsWith("ffff")).toBe(true);
    const approval = exactApproval(q, 5_000_000n)!;
    expect(decodeFunctionData({ abi: erc20Abi, data: approval.data! }).args).toEqual([ACROSS.spokePool, 5_000_000n]);
  });

  it("accepts the measured ETH quote, delivered as ETH, with no approval", () => {
    const q = checkBridge(ethFx, BRIDGE_ETH);
    expect(q.tx).toMatchObject({ to: ACROSS.periphery, value: 10n ** 15n });
    expect(q.receive).toEqual({ symbol: "ETH", decimals: 18, address: NATIVE });
    expect(q.spend).toBeNull();
    expect(exactApproval(q, 1n)).toBeNull();
  });

  it.each([
    ["no transaction", () => ({ minOutputAmount: "1" }), /has no transaction/],
    ["no object at all", () => "error page" as unknown as Json, /has no transaction/],
    ["another chain", () => ({ ...copy(usdcFx), swapTx: { ...(usdcFx.swapTx as Json), chainId: 1 } }), /for chain 1/],
    ["no destination", () => ({ ...copy(usdcFx), swapTx: { ...(usdcFx.swapTx as Json), to: 5 } }), /has no destination/],
    ["non-hex calldata", () => ({ ...copy(usdcFx), swapTx: { ...(usdcFx.swapTx as Json), data: "0xz" } }), /calldata is not hex/],
    ["a bad value", () => ({ ...copy(usdcFx), swapTx: { ...(usdcFx.swapTx as Json), value: "x" } }), /value is not a whole number/],
    ["no minimum", () => ({ ...copy(usdcFx), minOutputAmount: null }), /no minimum output/],
    ["unreadable calldata", () => ({ ...copy(usdcFx), swapTx: { ...(usdcFx.swapTx as Json), data: "0x12345678" } }), /not an Across deposit/],
    ["the ETH entry point", () => ethFx, /must call deposit\./],
    ["another SpokePool", () => ({ ...copy(usdcFx), swapTx: { ...(usdcFx.swapTx as Json), to: OTHER } }), /not Across's verified SpokePool/],
    ["another depositor", () => withArg(usdcFx, 0, word(OTHER)), /deposits for a different wallet/],
    ["another recipient", () => withArg(usdcFx, 1, word(OTHER)), /pays out to a different address/],
    ["another input token", () => withArg(usdcFx, 2, word(OTHER)), /input is not USDC/],
    ["another output token", () => withArg(usdcFx, 3, word(OTHER)), /not the verified token/],
    ["another amount", () => withArg(usdcFx, 4, 1n), /different amount than was asked/],
    ["an output below its own minimum", () => withArg(usdcFx, 5, 1n), /less than its own quoted minimum/],
    ["another destination chain", () => withArg(usdcFx, 6, 1n), /bridges to chain 1, not Robinhood Chain \(4663\)/],
    ["a message", () => withArg(usdcFx, 11, "0xdeadbeef"), /call a contract with a message/],
    ["ETH sent with USDC", () => ({ ...copy(usdcFx), swapTx: { ...(usdcFx.swapTx as Json), value: "1" } }), /must not send ETH/],
  ])("refuses a USDC bridge with %s", (_, body, why) => {
    expect(() => checkBridge(body(), BRIDGE_USDC)).toThrow(why);
    expect(() => checkBridge(body(), BRIDGE_USDC)).toThrow(/^This build will not sign Across's quote: .* Nothing was sent\.$/);
  });

  it.each([
    ["the token entry point", () => usdcFx, /must call depositNative/],
    ["another periphery", () => ({ ...copy(ethFx), swapTx: { ...(ethFx.swapTx as Json), to: OTHER } }), /not Across's verified SpokePoolPeriphery/],
    ["another SpokePool inside", () => withArg(ethFx, 0, OTHER), /different SpokePool/],
    ["another depositor", () => withArg(ethFx, 1, OTHER), /deposits for a different wallet/],
    ["another recipient", () => withArg(ethFx, 2, word(OTHER)), /pays out to a different address/],
    ["another input", () => withArg(ethFx, 3, OTHER), /input is not ETH/],
    ["another amount", () => withArg(ethFx, 4, 1n), /different amount/],
    ["another value", () => ({ ...copy(ethFx), swapTx: { ...(ethFx.swapTx as Json), value: "1" } }), /different amount/],
    ["no value at all", () => ({ ...copy(ethFx), swapTx: { ...(ethFx.swapTx as Json), value: undefined } }), /different amount/],
    ["another output", () => withArg(ethFx, 5, word(ROBINHOOD.usdg.address)), /not the verified token/],
    ["a zero output", () => ({ ...withArg(ethFx, 6, 0n), minOutputAmount: "0" }), /less than its own quoted minimum/],
  ])("refuses an ETH bridge with %s", (_, body, why) => {
    expect(() => checkBridge(body(), BRIDGE_ETH)).toThrow(why);
  });

  it("reads no expiry and no fill time as unknown, not as now", () => {
    const q = checkBridge({ ...copy(usdcFx), quoteExpiryTimestamp: "soon", expectedFillTime: null }, BRIDGE_USDC);
    expect(q.expiresAt).toBeNull();
    expect(q.fillSeconds).toBeNull();
  });
});

describe("quoting an Across bridge", () => {
  it("asks for Base → 4663, to the same address, USDC out as USDG, with no fee when there is no fee address", async () => {
    let asked = "";
    vi.stubGlobal("fetch", async (url: string) => {
      asked = url;
      return json(usdcFx);
    });
    expect((await quoteBridge(BRIDGE_USDC, null)).feeOn).toBe(false);
    const u = new URL(asked);
    expect(u.origin + u.pathname).toBe(`${ACROSS.api}/swap/approval`);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      tradeType: "exactInput",
      amount: "5000000",
      inputToken: USDC.address,
      outputToken: ROBINHOOD.usdg.address,
      originChainId: "8453",
      destinationChainId: "4663",
      depositor: USER,
      recipient: USER,
    });
  });

  it("names ETH by the zero address both ways, and adds the fee as a fraction when an address is given", async () => {
    let asked = "";
    vi.stubGlobal("fetch", async (url: string) => {
      asked = url;
      return json(ethFx);
    });
    expect((await quoteBridge(BRIDGE_ETH, OTHER)).feeOn).toBe(true);
    const p = new URL(asked).searchParams;
    expect([p.get("inputToken"), p.get("outputToken"), p.get("appFee"), p.get("appFeeRecipient")]).toEqual([NATIVE, NATIVE, "0.001", OTHER]);
  });
});

// ── arriving on Robinhood Chain ─────────────────────────────────────────────

describe("measuring an arrival on Robinhood Chain", () => {
  it("reads ETH and USDG balances from Robinhood Chain's own RPC", async () => {
    const endpoints: string[] = [];
    net({
      rpc: (m, p, endpoint) => {
        endpoints.push(endpoint);
        if (m === "eth_getBalance") return "0x10";
        const { to, data } = p[0] as { to: string; data: `0x${string}` };
        expect(to).toBe(ROBINHOOD.usdg.address);
        expect(decodeFunctionData({ abi: erc20Abi, data }).args).toEqual([USER]);
        return `0x${(25n).toString(16).padStart(64, "0")}`;
      },
    });
    expect(await robinhoodBalance(NATIVE, USER)).toBe(16n);
    expect(await robinhoodBalance(ROBINHOOD.usdg.address, USER)).toBe(25n);
    expect(new Set(endpoints)).toEqual(new Set([ROBINHOOD.rpc]));
  });

  it("names Robinhood Chain when its RPC fails", async () => {
    net({ rpc: () => DOWN });
    await expect(robinhoodBalance(NATIVE, USER)).rejects.toThrow("The Robinhood Chain RPC could not be reached for eth_getBalance.");
    net({ rpc: () => new RpcError("bad") });
    await expect(rpcOn("Robinhood Chain", [ROBINHOOD.rpc], "eth_call", [])).rejects.toThrow("The Robinhood Chain RPC refused eth_call: bad.");
  });

  it("waits until the balance has risen by the minimum, and reports the rise", async () => {
    const reads = [100n, 100n, 180n];
    const naps: number[] = [];
    const rise = await waitForArrival(async () => reads.shift()!, 100n, 50n, { every: 7, within: 100, sleep: async (ms) => void naps.push(ms) });
    expect(rise).toBe(80n);
    expect(naps).toEqual([7, 7]);
  });

  it("gives up with null — not seen yet, never 'lost' — and waits for real by default", async () => {
    expect(await waitForArrival(async () => 0n, 0n, 1n, { every: 1, within: 1 })).toBeNull();
    expect(await waitForArrival(async () => 5n, 0n, 1n)).toBe(5n);
  });
});
