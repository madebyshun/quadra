import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { decodeFunctionData, erc20Abi } from "viem";
import { BASE, CONTRACTS, USDC } from "@/config/chain";
import { TRADE_CRYPTO } from "@/config/markets";
import { ROUTER_ABI } from "@/lib/basketRouter";
import { RELAY } from "@/config/routes";
import { forgetCatalog, parseBaseStocks } from "@/adapters/http/markets";
import { approveData } from "@/lib/erc20";
import { basketProblem, MAX_LEGS, PRESETS, split, topUp, weightsNow, type Leg } from "@/lib/basket";
import { TRANSFER_TOPIC } from "@/lib/transact";
import { STOCKS_PATH } from "@/server/stocks";
import { BasketPanel, catalog, PACE, quoteLeg } from "@/features/panels/BasketPanel";
import { WalletProvider } from "@/ui/WalletProvider";
import { OpenWindowProvider } from "@/features/openWindow";
import type { Eip1193Provider, Eip1193Request } from "@/lib/wallet";
import { copy } from "./fixtures/base";
import { AAPL_ON_BASE, MARKETS_FX, NVDA_ON_BASE } from "./fixtures/markets";
import { ROUTES_FX, SWAPPER, USER } from "./fixtures/routes";
import { contractAt, json, net, simulated, useNet } from "./net";

/**
 * Treasury Basket. Coinbase's list, DexScreener and Relay's USDC → NVDAc quote are real captures; a
 * leg for another asset or amount is that same quote with its amount, approval and token rewritten
 * HERE, where it can be read — the shape Relay sends is the capture's.
 */

useNet();
afterEach(() => forgetCatalog());
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  PACE.gapMs = 0;
  PACE.retryMs = [0, 0];
});

vi.mock("@/lib/connectors", () => ({ walletConnectProvider: vi.fn(), coinbaseProvider: vi.fn() }));

const HASH = `0x${"56".repeat(32)}`;
type Json = Record<string, unknown>;
const STOCKS = parseBaseStocks(MARKETS_FX.coinbaseStocks);

function wallet() {
  const sent: Record<string, string>[] = [];
  const provider: Eip1193Provider = {
    request(args: Eip1193Request) {
      if (args.method === "eth_accounts") return Promise.resolve([USER]);
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

/** Relay's captured USDC → NVDAc quote, for `amount` of USDC into `token`. */
function quoteFor(body: Json): Json {
  const q = copy(ROUTES_FX.relayUsdcNvda) as { steps: { id: string; items: { data: Json }[] }[]; details: { currencyIn: Json; currencyOut: { currency: Json } } };
  const amount = String(body.amount);
  for (const step of q.steps) for (const item of step.items) item.data.from = body.user;
  q.details.currencyIn.amount = amount;
  q.details.currencyOut.currency.address = String(body.destinationCurrency).toLowerCase();
  const approve = q.steps.find((s) => s.id === "approve")!.items[0]!.data;
  const spender = `0x${String(approve.data).slice(34, 74)}`;
  approve.data = approveData(spender, BigInt(amount));
  return q as unknown as Json;
}

/** A receipt delivering `amount` of `token` to USER — the captured ETH → USDC receipt, re-addressed. */
function delivered(token: string, amount: bigint): unknown {
  const r = copy(ROUTES_FX.receiptEthUsdc) as { logs: { address: string; topics: string[]; data: string }[] };
  const log = r.logs.find((l) => l.topics[0] === TRANSFER_TOPIC && l.topics[2]!.endsWith(SWAPPER.slice(2)))!;
  log.address = token;
  log.topics[2] = `0x${USER.slice(2).toLowerCase().padStart(64, "0")}`;
  log.data = `0x${amount.toString(16).padStart(64, "0")}`;
  return r;
}

type World = { readonly routerAllowance?: bigint; readonly relay?: (body: Json, i: number) => Response; readonly usdc?: bigint; readonly held?: bigint; readonly receipt?: (i: number) => unknown; readonly stocks?: unknown; readonly region?: string; readonly batchSim?: (params: readonly unknown[]) => unknown; readonly noPrices?: boolean; readonly spotsError?: boolean };

function world(w: World = {}) {
  const asked: Json[] = [];
  const token = (balance: bigint) => contractAt(erc20Abi, { balanceOf: balance, decimals: 8, symbol: "X", allowance: 0n });
  const usdcErc20 = contractAt(erc20Abi, { balanceOf: w.usdc ?? 5_000_000_000n, allowance: w.routerAllowance ?? 0n });
  // USDC's EIP-2612 nonce (nonces(address), 0x7ecebe00) for the permit; everything else is plain ERC-20
  const usdc = (data: `0x${string}`) => (data.startsWith("0x7ecebe00") ? `0x${"0".repeat(63)}7` : usdcErc20(data));
  const nvda = token(w.held ?? 0n);
  // every other token in a basket holds nothing
  const other = token(0n);
  const calls = (m: string, p: readonly unknown[]) => {
    if (m !== "eth_call") return undefined;
    const { to, data } = p[0] as { to: string; data: `0x${string}` };
    return (to.toLowerCase() === USDC.address.toLowerCase() ? usdc : to.toLowerCase() === NVDA_ON_BASE.toLowerCase() ? nvda : other)(data);
  };
  let receipts = 0;
  net({
    get: (url) => {
      if (url === "/api/region") return { country: w.region ?? null };
      if (url === `${STOCKS_PATH}/base`) return w.stocks ?? MARKETS_FX.coinbaseStocks;
      if (url.startsWith("https://api.dexscreener.com/tokens/v1/base/")) return w.spotsError ? json({}, 502) : w.noPrices ? [] : MARKETS_FX.dexBase;
      return undefined;
    },
    rpc: (m, p) => {
      if (m === "eth_blockNumber") return "0x3ae8b00";
      if (m === "eth_getLogs") return [];
      if (m === "eth_simulateV1") return w.batchSim ? w.batchSim(p) : [{ calls: ((p[0] as { blockStateCalls: { calls: unknown[] }[] }).blockStateCalls[0]!.calls).map(() => ({ status: "0x1" })) }];
      const sim = simulated()(m, p);
      if (sim !== undefined) return sim;
      if (m === "eth_getTransactionReceipt") return w.receipt?.(receipts++) ?? { status: "0x1", blockNumber: "0x2a", logs: [] };
      return calls(m, p);
    },
  });
  const rpcFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url.startsWith(RELAY.api)) {
      const body = JSON.parse(String(init!.body)) as Json;
      asked.push(body);
      return Promise.resolve(w.relay ? w.relay(body, asked.length - 1) : json(quoteFor(body)));
    }
    return rpcFetch(url, init);
  });
  return asked;
}

async function settle() {
  for (let i = 0; i < 10; i++) await act(async () => {});
}

function mount() {
  return render(
    <WalletProvider>
      <BasketPanel />
    </WalletProvider>,
  );
}

async function basket(rows: readonly (readonly [string, string])[]) {
  const legs = within(screen.getByRole("list", { name: "Assets and weights" }));
  while (legs.queryAllByRole("button", { name: /^Remove asset/ }).length > 0) await userEvent.click(legs.getAllByRole("button", { name: /^Remove asset/ })[0]!);
  for (const [i, [sym, w]] of rows.entries()) {
    await userEvent.click(screen.getByRole("button", { name: "Add an asset" }));
    await userEvent.type(screen.getByLabelText(`Asset ${i + 1}`), sym);
    await userEvent.type(screen.getByLabelText(`Weight ${i + 1}`), w);
  }
}

const cta = () => screen.getByRole("button", { name: /Quote the basket|Quoting|Connect|Enter how much|Buy the (basket|rest)|Not enough|cannot be bought|weights add|Add at least|is not a|Reading|transfers are paused|not offered|could not be read/ });

describe("a basket's arithmetic", () => {
  const asset = (n: number) => ({ symbol: `A${n}`, address: `0x${String(n).padStart(40, "0")}`, decimals: 8, kind: "stock" as const });
  const legs = (...w: number[]): Leg[] => w.map((weight, i) => ({ asset: asset(i), weight }));

  it("refuses an empty basket, too many legs, a bad weight, a repeat, and weights that do not add to 100", () => {
    expect(basketProblem([])).toBe("Add at least one asset.");
    expect(basketProblem(legs(...Array.from({ length: MAX_LEGS + 1 }, () => 1)))).toBe(`A basket takes at most ${MAX_LEGS} assets.`);
    expect(basketProblem(legs(50, 0, 50))).toBe("A1's weight must be a whole percent above 0.");
    expect(basketProblem(legs(50, 49.5))).toBe("A1's weight must be a whole percent above 0.");
    expect(basketProblem([...legs(50), { asset: asset(0), weight: 50 }])).toBe("A0 is in the basket twice.");
    expect(basketProblem(legs(60, 30))).toBe("The weights add up to 90%, not 100%.");
    expect(basketProblem(legs(60, 40))).toBeNull();
  });

  it("preserves USDC precision for small test baskets without imposing a dollar floor", () => {
    expect(split(500_000n, [50, 50])).toEqual([250_000n, 250_000n]);
    expect(split(10_001n, [50, 50])).toEqual([5_001n, 5_000n]);
    expect(split(1n, [50, 50])).toEqual([1n, 0n]);
  });

  it("splits exactly what was typed — floored, the remainder to the largest leg", () => {
    expect(split(1_000_000n, [15, 15, 14, 14, 14, 14, 14])).toEqual([150_000n, 150_000n, 140_000n, 140_000n, 140_000n, 140_000n, 140_000n]);
    const odd = split(1_000_001n, [33, 33, 34]);
    expect(odd).toEqual([330_000n, 330_000n, 340_001n]);
    expect(odd.reduce((s, v) => s + v, 0n)).toBe(1_000_001n);
    expect(split(5n, [])).toEqual([]);
    for (const p of PRESETS) expect(p.picks.reduce((s, [, w]) => s + w, 0), p.id).toBe(100);
  });

  it("tops up the most underweight first, scaled when the shortfall is larger, by weight when nothing is short", () => {
    // 50/50 target, holding 900 and 100 — 200 more all goes to the second
    expect(topUp(200n, [50, 50], [900n, 100n])).toEqual([0n, 200n]);
    // shortfall 400 and 0 against 1,000 more — the 400 first, the other 600 by weight
    expect(topUp(1000n, [50, 50], [300n, 700n])).toEqual([700n, 300n]);
    // already on target: by weight
    expect(topUp(100n, [50, 50], [500n, 500n])).toEqual([50n, 50n]);
    // nothing held at all: by weight
    expect(topUp(100n, [70, 30], [0n, 0n])).toEqual([70n, 30n]);
    // nothing to add and nothing short: nothing moves
    expect(topUp(0n, [50, 50], [500n, 500n])).toEqual([0n, 0n]);
    // the flooring's crumb goes to the largest part
    expect(topUp(10n, [50, 50], [0n, 3n])).toEqual([7n, 3n]);
    // too little for any target to move: split by weight instead
    expect(topUp(1n, [50, 50], [0n, 0n])).toEqual([1n, 0n]);
  });

  it("drops a top-up leg below the minimum and gives its share to the others, unless every leg is below it", () => {
    expect(topUp(100n, [50, 50], [0n, 49n], 10n)).toEqual([75n, 25n]);
    expect(topUp(100n, [50, 50], [0n, 49n], 30n)).toEqual([100n, 0n]);
    expect(topUp(100n, [50, 50], [0n, 49n], 1000n)).toEqual([75n, 25n]);
    // dust legs under minLeg are dropped to 0 and redistributed to genuinely underweight legs
    expect(topUp(1_000_000n, [10, 10, 10, 70], [0n, 199_800n, 199_900n, 0n], 50_000n)).toEqual([125_000n, 0n, 0n, 875_000n]);
  });

  it("says each leg's share now, and zero for an empty basket", () => {
    expect(weightsNow([300n, 100n])).toEqual([75, 25]);
    expect(weightsNow([0n, 0n])).toEqual([0, 0]);
  });

  it("knows Coinbase's stocks by ticker and symbol and the verified crypto, never USDC, and a paused stock as paused", () => {
    const withVvvStock = new Map(STOCKS);
    const sample = STOCKS.get("NVDA")!;
    withVvvStock.set("VVV", { ...sample, ticker: "VVV", symbol: "VVVc", address: "0x0000000000000000000000000000000000000vvv".replace("vvv", "111") });
    const c = catalog(withVvvStock);
    expect(c.get("NVDA")).toMatchObject({ symbol: "NVDAc", address: NVDA_ON_BASE, kind: "stock", paused: false });
    expect(c.get("NVDAC")).toBe(c.get("NVDA"));
    expect(c.get("CBBTC")).toMatchObject({ kind: "crypto" });
    expect(c.get("VVV")).toMatchObject({ symbol: "VVV", kind: "crypto" });
    expect(c.get("VVVC")).toMatchObject({ symbol: "VVVc", kind: "stock" });
    expect(c.has("USDC")).toBe(false);
    expect(c.get("DKNG")!.paused).toBe(true);
  });

  it("asks Relay again while it says it is busy, and gives up after the last pause or on any other refusal", async () => {
    let n = 0;
    world({ relay: (body) => (n++ < 2 ? json({ message: "Could not process request. Please try again later." }, 500) : json(quoteFor(body))) });
    const nvda = catalog(STOCKS).get("NVDA")!;
    await expect(quoteLeg(USER, nvda, 5_000_000n)).resolves.toMatchObject({ out: expect.any(BigInt) });
    n = 0;
    world({ relay: () => json({ message: "Could not process request. Please try again later." }, 500) });
    await expect(quoteLeg(USER, nvda, 5_000_000n)).rejects.toThrow(/try again later/);
    world({ relay: () => json({ message: "Amount is too small to be swapped" }, 400) });
    await expect(quoteLeg(USER, nvda, 5_000_000n)).rejects.toThrow("Relay: Amount is too small to be swapped.");
  });
});

describe("the Treasury Basket window", () => {
  it("opens on MAG7 and names what is missing before anything is quoted", async () => {
    world();
    mount();
    await settle();
    expect(screen.getByLabelText("Asset 1")).toHaveValue("AAPL");
    // the 2026-09-30 capture of Coinbase's list has no Amazon yet — said by name, never guessed
    expect(cta()).toHaveTextContent("AMZN is not a Coinbase stock or a listed token on Base.");
    await userEvent.click(screen.getByRole("button", { name: "AI compute" }));
    expect(screen.getByLabelText("Asset 1")).toHaveValue("NVDA");
    await userEvent.click(screen.getByRole("button", { name: "AI on Base" }));
    expect(screen.getByRole("heading", { name: "Buy AI on Base" })).toBeInTheDocument();
    expect(screen.getByLabelText("Asset 1")).toHaveValue("VVV");
    expect(screen.getByLabelText("Asset 2")).toHaveValue("VIRTUAL");
    expect(screen.getByLabelText("Asset 3")).toHaveValue("CLANKER");
    expect(screen.getByLabelText("Asset 4")).toHaveValue("BNKR");
    const aiPreset = PRESETS.find((p) => p.id === "ai-on-base")!;
    expect(aiPreset.picks.every(([sym]) => TRADE_CRYPTO.some((c) => c.symbol.toUpperCase() === sym.toUpperCase()))).toBe(true);
    await basket([["NVDA", "100"]]);
    expect(cta()).toHaveTextContent("Connect a wallet first");
  });

  it("refuses a symbol it does not know, a paused stock, weights that do not add up, and says the list could not be read", async () => {
    wallet();
    world();
    mount();
    await settle();
    await basket([["DOGE", "100"]]);
    expect(cta()).toHaveTextContent("DOGE is not a Coinbase stock or a listed token on Base.");
    await basket([["DKNG", "100"]]);
    expect(cta()).toHaveTextContent("DKNGc's transfers are paused by its issuer");
    await basket([["NVDA", "60"]]);
    expect(cta()).toHaveTextContent("The weights add up to 60%, not 100%.");
    await basket([]);
    await userEvent.click(screen.getByRole("button", { name: "Add an asset" }));
    expect(cta()).toHaveTextContent("An empty row is not a Coinbase stock");
  });

  it("says Coinbase's list could not be read", async () => {
    wallet();
    world({ stocks: json({}, 502) });
    mount();
    await settle();
    expect(cta()).toHaveTextContent(/^Coinbase's list of stocks could not be read/);
  });

  it("offers a U.S. visitor crypto only", async () => {
    wallet();
    world({ region: "US" });
    mount();
    await settle();
    expect(screen.getByText(/A basket of crypto only still works/)).toBeInTheDocument();
    expect(cta()).toHaveTextContent(/not offered where you are/);
    await basket([["cbBTC", "100"]]);
    expect(cta()).toHaveTextContent("Enter how much USDC to put in");
  });

  it("quotes each leg, one at a time, then signs approve + buy per leg from a fresh quote, and reads what arrived", async () => {
    const sent = wallet();
    const asked = world({ receipt: (i) => (i === 1 ? delivered(NVDA_ON_BASE, 3n * 10n ** 7n) : i === 3 ? { status: "0x1", blockNumber: "0x2b", logs: [] } : undefined) });
    mount();
    await settle();
    await basket([
      ["NVDA", "60"],
      ["AAPL", "40"],
    ]);
    await userEvent.type(screen.getByLabelText("USDC to put in"), "10");
    await userEvent.click(cta());
    await settle();
    expect(asked.map((a) => [String(a.destinationCurrency).toLowerCase(), a.amount])).toEqual([
      [NVDA_ON_BASE.toLowerCase(), "6000000"],
      [AAPL_ON_BASE.toLowerCase(), "4000000"],
    ]);
    const table = screen.getByRole("table", { name: "The basket, quoted" });
    expect(table).toHaveTextContent("NVDAc6 USDC≈");
    expect(table).toHaveTextContent("0.19% impact");
    await userEvent.click(screen.getByRole("button", { name: "Buy the basket — 10 USDC" }));
    await settle();
    // two fresh quotes at signing, four signatures: approve exactly, buy — per leg
    expect(asked).toHaveLength(4);
    expect(sent).toHaveLength(4);
    // the first approval is for exactly the first leg's USDC
    expect(String(sent[0]!.to).toLowerCase()).toBe(USDC.address.toLowerCase());
    expect(String(sent[0]!.data).endsWith((6_000_000n).toString(16).padStart(64, "0"))).toBe(true);
    expect(String(sent[2]!.data).endsWith((4_000_000n).toString(16).padStart(64, "0"))).toBe(true);
    expect(screen.getByRole("table", { name: "The basket, quoted" })).toHaveTextContent("arrived: 0.3 NVDAc");
    expect(screen.getByRole("table", { name: "The basket, quoted" })).toHaveTextContent("arrived: 0 AAPLc");
  });

  it("quotes and buys a basket below 1 USDC with exact fractional approvals", async () => {
    const sent = wallet();
    const asked = world();
    mount();
    await settle();
    await basket([["NVDA", "50"], ["AAPL", "50"]]);
    await userEvent.type(screen.getByLabelText("USDC to put in"), "0.5");
    await userEvent.click(cta());
    await settle();
    expect(asked.map((q) => q.amount)).toEqual(["250000", "250000"]);
    expect(cta()).toHaveTextContent("Buy the basket — 0.5 USDC");
    await userEvent.click(cta());
    await settle();
    expect(sent).toHaveLength(4);
    expect(sent[0]!.data).toBe(approveData(RELAY.approvalProxy, 250_000n));
    expect(sent[2]!.data).toBe(approveData(RELAY.approvalProxy, 250_000n));
  });

  it("refuses zero USDC before requesting quotes", async () => {
    wallet();
    const asked = world();
    mount();
    await settle();
    await basket([["NVDA", "100"]]);
    await userEvent.type(screen.getByLabelText("USDC to put in"), "0");
    await userEvent.click(cta());
    await settle();
    expect(screen.getByText("Enter an amount above 0 USDC.")).toBeInTheDocument();
    expect(asked).toHaveLength(0);
  });

  it("stops at a leg that is too thin or could not be quoted, and quotes only the failed ones again", async () => {
    wallet();
    let busy = true;
    const asked = world({
      relay: (body) => {
        if (String(body.destinationCurrency).toLowerCase() === AAPL_ON_BASE.toLowerCase() && busy) return json({ message: "No routes found" }, 400);
        const q = quoteFor(body) as { details: { totalImpact: Json } };
        if (String(body.destinationCurrency).toLowerCase() === NVDA_ON_BASE.toLowerCase()) q.details.totalImpact = { percent: "-0.40" };
        return json(q);
      },
    });
    mount();
    await settle();
    await basket([
      ["NVDA", "50"],
      ["AAPL", "50"],
    ]);
    await userEvent.type(screen.getByLabelText("USDC to put in"), "10");
    await userEvent.click(cta());
    await settle();
    expect(cta()).toHaveTextContent("A leg cannot be bought — see it above");
    expect(screen.getByRole("table", { name: "The basket, quoted" })).toHaveTextContent("Relay: No routes found.");
    busy = false;
    await userEvent.click(screen.getByRole("button", { name: "Quote the failed ones again" }));
    await settle();
    // only AAPL was asked again
    expect(asked.slice(2).map((a) => String(a.destinationCurrency).toLowerCase())).toEqual([AAPL_ON_BASE.toLowerCase()]);
    expect(cta()).toHaveTextContent("Buy the basket — 10 USDC");
    // a thin leg blocks too
    world({ relay: (body) => json({ ...quoteFor(body), details: { ...(quoteFor(body).details as Json), totalImpact: { percent: "-3.1" } } }) });
    await userEvent.type(screen.getByLabelText("USDC to put in"), "0");
    await userEvent.click(cta());
    await settle();
    expect(screen.getByRole("table", { name: "The basket, quoted" })).toHaveTextContent("moves its market 3.10% — too thin for this size");
  });

  it("says when the wallet has too little USDC, an impact Relay did not give, and a typo in the amount", async () => {
    wallet();
    world({ usdc: 1_000_000n, relay: (body) => json({ ...quoteFor(body), details: { ...(quoteFor(body).details as Json), totalImpact: null } }) });
    mount();
    await settle();
    await basket([["NVDA", "100"]]);
    await userEvent.type(screen.getByLabelText("USDC to put in"), "abc");
    await userEvent.click(cta());
    await settle();
    expect(screen.getByText('"abc" is not a plain decimal number.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("USDC to put in"));
    await userEvent.type(screen.getByLabelText("USDC to put in"), "10");
    await userEvent.click(cta());
    await settle();
    expect(screen.getByRole("table", { name: "The basket, quoted" })).toHaveTextContent("impact not given");
    expect(cta()).toHaveTextContent("Not enough USDC");
  });

  it("approves exactly the leg itself when Relay saw an allowance already there and sent no approval", async () => {
    const sent = wallet();
    world({
      relay: (body) => {
        const q = quoteFor(body) as { steps: { id: string }[] };
        q.steps = q.steps.filter((x) => x.id !== "approve");
        return json(q);
      },
    });
    mount();
    await settle();
    await basket([["NVDA", "100"]]);
    await userEvent.type(screen.getByLabelText("USDC to put in"), "5");
    await userEvent.click(cta());
    await settle();
    await userEvent.click(screen.getByRole("button", { name: "Buy the basket — 5 USDC" }));
    await settle();
    expect(String(sent[0]!.to).toLowerCase()).toBe(USDC.address.toLowerCase());
    expect(sent[0]!.data).toBe(approveData(RELAY.approvalProxy, 5_000_000n));
  });

  it("resumes at the leg that failed, rather than charging the confirmed legs again", async () => {
    const sent = wallet();
    // MEASURED 2026-11-15: a first leg's approval confirmed and its buy reverted on chain
    world({
      receipt: (i) => (i === 1 ? { status: "0x0", blockNumber: "0x2a", logs: [] } : undefined),
    });
    mount();
    await settle();
    await basket([
      ["NVDA", "50"],
      ["AAPL", "50"],
    ]);
    await userEvent.type(screen.getByLabelText("USDC to put in"), "10");
    await userEvent.click(cta());
    await settle();
    await userEvent.click(screen.getByRole("button", { name: "Buy the basket — 10 USDC" }));
    await settle();
    expect(sent).toHaveLength(2);
    // the failed leg is leg 0, so nothing confirmed: the whole basket is still offered
    expect(cta()).toHaveTextContent("Buy the basket — 10 USDC");

    // now the first leg succeeds and the second reverts: a retry must start at the second
    const asked2 = world({ receipt: (i) => (i === 3 ? { status: "0x0", blockNumber: "0x2b", logs: [] } : undefined) });
    await userEvent.click(cta());
    await settle();
    expect(sent).toHaveLength(6);
    expect(cta()).toHaveTextContent("Buy the rest — 5 USDC");
    expect(screen.getByText(/1 of 2 bought/)).toBeInTheDocument();
    const before = asked2.length;
    await userEvent.click(cta());
    await settle();
    // only the remaining leg was quoted and signed: one approval and one buy
    expect(asked2.length - before).toBe(1);
    expect(sent).toHaveLength(8);
    expect(String(asked2.at(-1)!.destinationCurrency).toLowerCase()).toBe(AAPL_ON_BASE.toLowerCase());
  });

  it("stops when the wallet refuses, and buys nothing past it", async () => {
    const provider: Eip1193Provider = {
      request(args: Eip1193Request) {
        if (args.method === "eth_accounts") return Promise.resolve([USER]);
        if (args.method === "eth_chainId") return Promise.resolve(BASE.idHex);
        return Promise.reject(new Error("User rejected the request."));
      },
    };
    vi.stubGlobal("ethereum", provider);
    world();
    mount();
    await settle();
    await basket([["NVDA", "100"]]);
    await userEvent.type(screen.getByLabelText("USDC to put in"), "5");
    await userEvent.click(cta());
    await settle();
    await userEvent.click(screen.getByRole("button", { name: "Buy the basket — 5 USDC" }));
    await settle();
    expect(screen.getByText(/User rejected the request/)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "The basket, quoted" })).not.toHaveTextContent("arrived");
  });

  it("shows each asset's weight now, and tops up toward the weights when asked", async () => {
    wallet();
    const asked = world({ held: 10n ** 8n });
    mount();
    await settle();
    await basket([
      ["NVDA", "50"],
      ["AAPL", "50"],
    ]);
    await settle();
    expect(screen.getAllByText(/^now \d+(\.\d)?%$/)).toHaveLength(2);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.type(screen.getByLabelText("USDC to put in"), "0.5");
    await userEvent.click(cta());
    await settle();
    // NVDA is already far over its half, so the whole 0.5 USDC goes to AAPL
    expect(asked.map((a) => [String(a.destinationCurrency).toLowerCase(), a.amount])).toEqual([[AAPL_ON_BASE.toLowerCase(), "500000"]]);
    expect(screen.getByRole("table", { name: "The basket, quoted" })).toHaveTextContent("nothing to add in this allocation");
  });
});


function batchWallet(status = "supported") {
  let id = "";
  let outcome: "pending" | "confirmed" | "failed" = "confirmed";
  let reject = false;
  const sent: Json[] = [];
  vi.stubGlobal("ethereum", { request: async ({ method, params }: Eip1193Request) => {
    if (method === "eth_accounts") return [USER];
    if (method === "eth_chainId") return BASE.idHex;
    if (method === "wallet_getCapabilities") return { [BASE.idHex]: { atomic: { status } } };
    if (method === "wallet_sendCalls") {
      if (reject) throw { code: 4001 };
      const request = params![0] as Json;
      id = String(request.id);
      sent.push(request);
      return { id };
    }
    if (method === "wallet_getCallsStatus") return { id, chainId: BASE.idHex, status: outcome === "pending" ? 100 : outcome === "failed" ? 500 : 200, atomic: true, receipts: [delivered(NVDA_ON_BASE, 30_000_000n)] };
    throw Error(`Unexpected wallet method ${method}`);
  } });
  return { sent, outcome: (value: typeof outcome) => { outcome = value; }, reject: () => { reject = true; } };
}

async function reviewBatch(amount = "10") {
  mount();
  await settle();
  await basket([["NVDA", "60"], ["AAPL", "40"]]);
  await userEvent.type(screen.getByLabelText("USDC to put in"), amount);
  await userEvent.click(cta());
  await settle();
}
const batchBuy = () => screen.getByRole("button", { name: "Buy basket · 1 confirmation" });

describe("Treasury Basket atomic purchase", () => {
  // the Relay-calls batch: the path a wallet that can batch takes while no router is set
  const ROUTER_DEPLOYED = CONTRACTS.basketRouter;
  beforeEach(() => { (CONTRACTS as { basketRouter: string | null }).basketRouter = null; });
  afterEach(() => { (CONTRACTS as { basketRouter: string | null }).basketRouter = ROUTER_DEPLOYED; });
  it("buys below 1 USDC with one batch request and exact per-leg approvals", async () => {
    const wallet = batchWallet();
    const asked = world();
    await reviewBatch("0.5");
    await userEvent.click(batchBuy());
    await settle();
    expect(asked.map((q) => q.amount)).toEqual(["300000", "200000", "300000", "200000"]);
    expect(wallet.sent).toHaveLength(1);
    const calls = wallet.sent[0]!.calls as Json[];
    expect(calls[0]!.data).toBe(approveData(RELAY.approvalProxy, 300_000n));
    expect(calls[2]!.data).toBe(approveData(RELAY.approvalProxy, 200_000n));
  });

  it("batches only the underweight top-up asset and preserves the zero leg in review", async () => {
    const wallet = batchWallet();
    world({ held: 10n ** 8n });
    mount();
    await settle();
    await basket([["NVDA", "50"], ["AAPL", "50"]]);
    await settle();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.type(screen.getByLabelText("USDC to put in"), "10");
    await userEvent.click(cta());
    await settle();
    await userEvent.click(batchBuy());
    await settle();
    expect((wallet.sent[0]!.calls as unknown[])).toHaveLength(2);
    expect(screen.getByRole("table", { name: "The basket, quoted" })).toHaveTextContent("nothing to add in this allocation");
  });

  it("shows capability discovery while the wallet is still answering", async () => {
    const sent = wallet();
    const original = (globalThis as unknown as { ethereum: Eip1193Provider }).ethereum;
    let resolve!: (value: unknown) => void;
    vi.stubGlobal("ethereum", { request: (args: Eip1193Request) => args.method === "wallet_getCapabilities" ? new Promise((r) => { resolve = r; }) : original.request(args) });
    world();
    await reviewBatch();
    expect(screen.getByText(/Checking whether your wallet/)).toBeInTheDocument();
    await act(async () => { resolve({}); });
    expect(screen.getByText(/does not report atomic batching/)).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  it("submits fresh interleaved approvals and swaps once, then measures delivered assets from the batch receipt", async () => {
    const wallet = batchWallet();
    const asked = world();
    await reviewBatch();
    await userEvent.click(batchBuy());
    await settle();
    expect(asked).toHaveLength(4);
    expect(wallet.sent).toHaveLength(1);
    expect(wallet.sent[0]!.atomicRequired).toBe(true);
    const calls = wallet.sent[0]!.calls as Json[];
    expect(calls).toHaveLength(4);
    expect(calls[0]!.data).toBe(approveData(RELAY.approvalProxy, 6_000_000n));
    expect(calls[2]!.data).toBe(approveData(RELAY.approvalProxy, 4_000_000n));
    expect(screen.getByRole("table", { name: "The basket, quoted" })).toHaveTextContent("arrived: 0.3 NVDAc");
    expect(batchBuy()).toBeDisabled();
    expect(cta()).toBeDisabled();
    await userEvent.type(screen.getByLabelText("USDC to put in"), "0");
    expect(cta()).toHaveTextContent("Quote the basket");
  });

  it("keeps pending work locked, checks it without signing again and measures the eventual result", async () => {
    const wallet = batchWallet("ready");
    wallet.outcome("pending");
    world();
    await reviewBatch();
    expect(screen.getByText(/may first ask you to enable batching/)).toBeInTheDocument();
    await userEvent.click(batchBuy());
    await settle();
    expect(screen.getByLabelText("USDC to put in")).toBeDisabled();
    expect(batchBuy()).toBeDisabled();
    expect(cta()).toBeDisabled();
    expect(screen.getByText(/Batch ID:/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check basket status" }));
    await settle();
    wallet.outcome("confirmed");
    await userEvent.click(screen.getByRole("button", { name: "Check basket status" }));
    await settle();
    expect(wallet.sent).toHaveLength(1);
    expect(screen.getByRole("table", { name: "The basket, quoted" })).toHaveTextContent("arrived: 0.3 NVDAc");
    expect(batchBuy()).toBeDisabled();
  });

  it("does not fall back after rejection or a reverted batch, allowing a deliberate retry", async () => {
    const wallet = batchWallet();
    world();
    await reviewBatch();
    wallet.outcome("failed");
    await userEvent.click(batchBuy());
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("batch failed");
    expect(batchBuy()).toBeEnabled();
    wallet.reject();
    await userEvent.click(batchBuy());
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("You rejected");
    expect(wallet.sent).toHaveLength(1);
  });

  it("stops before signing if the refreshed impact is too high", async () => {
    const wallet = batchWallet();
    world({ relay: (body, i) => json(i >= 2 ? { ...quoteFor(body), details: { ...(quoteFor(body).details as Json), totalImpact: { percent: "-3.1" } } } : quoteFor(body)) });
    await reviewBatch();
    await userEvent.click(batchBuy());
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("now moves its market 3.10%");
    expect(wallet.sent).toHaveLength(0);
  });

  it("also rechecks impact in step-by-step mode", async () => {
    const sent = wallet();
    world({ relay: (body, i) => json(i >= 2 ? { ...quoteFor(body), details: { ...(quoteFor(body).details as Json), totalImpact: { percent: "-3.1" } } } : quoteFor(body)) });
    await reviewBatch();
    await userEvent.click(cta());
    await settle();
    expect(screen.getByText(/now moves its market 3.10%/)).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  it("refuses a multi-swap leg instead of spending its amount twice", async () => {
    const wallet = batchWallet();
    world({ relay: (body, i) => {
      const q = quoteFor(body) as { steps: { id: string }[] };
      if (i >= 2) q.steps.push(q.steps.find((s) => s.id === "swap")!);
      return json(q);
    } });
    await reviewBatch();
    await userEvent.click(batchBuy());
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("one same-chain swap");
    expect(wallet.sent).toHaveLength(0);
  });

  it("refuses preparation that took too long", async () => {
    const wallet = batchWallet();
    let clock = 1000;
    const clockSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);
    world({ relay: (body) => { clock += 31_000; return json(quoteFor(body)); } });
    await reviewBatch();
    await userEvent.click(batchBuy());
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("took too long");
    expect(wallet.sent).toHaveLength(0);
    clockSpy.mockRestore();
  });
  it("measures Strength from weighted quotes without requesting a signature", async () => {
    const sent = wallet();
    const asked = world();
    mount(); await settle();
    await basket([["NVDA", "60"], ["AAPL", "40"]]);
    await userEvent.click(screen.getByRole("button", { name: "Measure basket Strength" }));
    await settle();
    const strength = screen.getByRole("region", { name: "Basket Strength" });
    await waitFor(() => expect(strength).toHaveTextContent("Measured buy depth ≥ $100,000.00"));
    expect(asked).toHaveLength(8);
    expect(sent).toHaveLength(0);
    expect(asked[0]!.amount).toBe("60000000");
    await userEvent.click(screen.getByRole("button", { name: "Refresh holdings" }));
    await settle();
    expect(screen.getByRole("table", { name: "Basket target and current holdings" })).toHaveTextContent("NVDAc60%");
  });

  it("names the limiting Strength leg, keeps missing data unknown and reports holdings failures", async () => {
    wallet();
    world({ held: 100n, noPrices: true, relay: (body) => json({ ...quoteFor(body), details: { ...(quoteFor(body).details as Json), totalImpact: { percent: "-3" } } }) });
    mount(); await settle();
    await basket([["NVDA", "100"]]);
    await settle();
    expect(screen.getByRole("region", { name: "Your basket holdings" })).toHaveTextContent("Holdings value unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Measure basket Strength" })); await settle();
    expect(screen.getByRole("region", { name: "Basket Strength" })).toHaveTextContent("No tested size passed · NVDAc exceeded 2%");
    world({ spotsError: true, relay: () => json({ message: "No routes found" }, 400) });
    await userEvent.click(screen.getByRole("button", { name: "Refresh holdings" })); await settle();
    await userEvent.click(screen.getByRole("button", { name: "Measure basket Strength" })); await settle();
    expect(screen.getByRole("region", { name: "Basket Strength" })).toHaveTextContent("not measured — Relay: No routes found");
  });

  it("loads a shared target without copying an amount or signing and keeps the full top-up card", async () => {
    const sent = wallet(); world({ held: 10n ** 8n });
    const recipe = { name: "My AI", picks: [["NVDA", 60], ["AAPL", 40]] };
    window.history.replaceState(null, "", `/?do=basket&basket=${encodeURIComponent(JSON.stringify(recipe))}`);
    mount(); await settle();
    expect(screen.getByLabelText("Basket name")).toHaveValue("My AI");
    expect(screen.getByLabelText("Asset 1")).toHaveValue("NVDA");
    expect(screen.getByLabelText("USDC to put in")).toHaveValue("");
    expect(sent).toHaveLength(0);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.type(screen.getByLabelText("USDC to put in"), "0.5");
    await userEvent.click(cta()); await settle();
    const card = screen.getByRole("img", { name: "Treasury Basket card" });
    expect(card).toHaveTextContent("2 assets, 1 basket");
    expect(card).toHaveTextContent("NVDAc60%not bought this time");
    expect(card).toHaveTextContent("AAPLc40%");
    await userEvent.clear(screen.getByLabelText("Basket name"));
    expect(screen.getByRole("link", { name: "Post on X" }).getAttribute("href")).not.toContain("basket%3D");
    window.history.replaceState(null, "", "/");
  });

  it("does not restore a previous wallet's review when its transaction finishes after switching accounts", async () => {
    let account = USER;
    let notify: () => void = () => {};
    let approve!: (hash: string) => void;
    vi.stubGlobal("ethereum", {
      on: (event: string, callback: () => void) => { if (event === "accountsChanged") notify = callback; },
      removeListener: () => {},
      request: async ({ method }: Eip1193Request) => {
        if (method === "eth_accounts") return [account];
        if (method === "eth_chainId") return BASE.idHex;
        if (method === "eth_sendTransaction") return new Promise<string>((resolve) => { approve = resolve; });
        throw Error("unsupported");
      },
    });
    world(); await reviewBatch("0.5");
    await userEvent.click(cta());
    await waitFor(() => expect(approve).toBeDefined());
    await act(async () => { account = `0x${"12".repeat(20)}`; notify(); });
    await settle();
    await act(async () => { approve(HASH); });
    await settle();
    expect(screen.queryByRole("table", { name: "The basket, quoted" })).not.toBeInTheDocument();
    expect(cta()).toHaveTextContent("Quote the basket");
  });

  it("lets a visitor measure Strength without connecting or signing a wallet", async () => {
    const asked = world();
    mount(); await settle();
    await basket([["NVDA", "100"]]);
    await userEvent.click(screen.getByRole("button", { name: "Measure basket Strength" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Basket Strength" })).toHaveTextContent("Measured buy depth ≥"));
    expect(asked).toHaveLength(4);
    expect(asked[0]!.user).toBe("0x000000000000000000000000000000000000dEaD");
  });

});


it("restores sequential basket recovery for known, unknown and unreadable pending work", async () => {
  for (const hash of [HASH, null, "corrupt"] as const) {
    wallet(); world();
    localStorage.setItem(`quadra.basket.sequence.v1:${USER.toLowerCase()}`, hash === "corrupt" ? "invalid" : JSON.stringify({ account: USER.toLowerCase(), label: "Buy NVDAc", hash }));
    const view = mount(); await settle();
    const recovery = screen.getByRole("region", { name: "Basket recovery" });
    expect(recovery).toBeVisible();
    if (hash !== "corrupt") {
      await userEvent.click(within(recovery).getByRole("button", { name: "Check previous transaction" }));
      await settle();
      expect(screen.getByRole("region", { name: "Basket recovery" })).toHaveTextContent(hash === null ? "unresolved" : "confirmed");
    }
    view.unmount(); localStorage.removeItem(`quadra.basket.sequence.v1:${USER.toLowerCase()}`);
  }
});

describe("Treasury Basket, the rest of the window", () => {
  // the Relay-calls batch: the path a wallet that can batch takes while no router is set
  const ROUTER_DEPLOYED = CONTRACTS.basketRouter;
  beforeEach(() => { (CONTRACTS as { basketRouter: string | null }).basketRouter = null; });
  afterEach(() => { (CONTRACTS as { basketRouter: string | null }).basketRouter = ROUTER_DEPLOYED; });
  it("gathers a basket of more than five into one approval per Relay contract, then the swaps, within ten calls", async () => {
    const wallet = batchWallet();
    world();
    mount();
    await settle();
    await basket([["NVDA", "20"], ["AAPL", "20"], ["AMD", "20"], ["GOOGL", "20"], ["TSLA", "10"], ["cbBTC", "10"]]);
    await userEvent.type(screen.getByLabelText("USDC to put in"), "10");
    await userEvent.click(cta());
    await settle();
    await userEvent.click(await screen.findByRole("button", { name: "Buy basket · 1 confirmation" }, { timeout: 3000 }));
    await waitFor(() => expect(wallet.sent).toHaveLength(1), { timeout: 3000 });
    const calls = wallet.sent[0]!.calls as Json[];
    expect(calls).toHaveLength(7);
    expect(calls[0]!.data).toBe(approveData(RELAY.approvalProxy, 10_000_000n));
    expect(calls.slice(1).every((c) => String(c.to).toLowerCase() !== USDC.address.toLowerCase())).toBe(true);
  });

  it("splits the weights evenly, the remainder to the first rows, and does nothing with no rows", async () => {
    world();
    mount();
    await settle();
    await basket([["NVDA", "1"], ["AAPL", "1"], ["AMD", "1"]]);
    await userEvent.click(screen.getByRole("button", { name: "Equal split" }));
    expect([1, 2, 3].map((i) => (screen.getByLabelText(`Weight ${i}`) as HTMLInputElement).value)).toEqual(["34", "33", "33"]);
    // a weight that is not a number counts as nothing toward the total
    await userEvent.clear(screen.getByLabelText("Weight 3"));
    await userEvent.type(screen.getByLabelText("Weight 3"), "x");
    expect(screen.getByText("67% / 100%")).toBeInTheDocument();
    await basket([]);
    await userEvent.click(screen.getByRole("button", { name: "Equal split" }));
    expect(screen.queryByLabelText("Weight 1")).toBeNull();
  });

  it("fills the amount from the quick buttons, and clears a stuck batch by hand", async () => {
    const wallet = batchWallet();
    wallet.outcome("pending");
    world();
    await reviewBatch();
    await userEvent.click(screen.getByRole("button", { name: "$25" }));
    expect(screen.getByLabelText("USDC to put in")).toHaveValue("25");
    await userEvent.click(cta());
    await settle();
    await userEvent.click(batchBuy());
    await settle();
    expect(screen.getByText(/still pending/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear stuck batch" }));
    expect(screen.queryByRole("button", { name: "Clear stuck batch" })).toBeNull();
  });

  it("offers to sell a held asset through Swap, and nothing to sell where nothing is held", async () => {
    wallet();
    world({ held: 100_000_000n });
    const open = vi.fn();
    render(
      <OpenWindowProvider open={open as never}>
        <WalletProvider>
          <BasketPanel />
        </WalletProvider>
      </OpenWindowProvider>,
    );
    await settle();
    await basket([["NVDA", "60"], ["AAPL", "40"]]);
    await settle();
    const table = await screen.findByRole("table", { name: "Basket target and current holdings" });
    const sells = within(table).getAllByRole("button", { name: "Sell" });
    expect(sells[1]).toBeDisabled();
    await userEvent.click(sells[0]!);
    expect(open).toHaveBeenCalledWith("swap", { sell: NVDA_ON_BASE });
  });
});

describe("Treasury Basket through BasketRouter, for a wallet that cannot batch", () => {
  const ROUTER = "0x00000000000000000000000000000000ba5ce701";
  const SIGNATURE = `0x${"11".repeat(32)}${"22".repeat(32)}1b`;
  const DEPLOYED = CONTRACTS.basketRouter;
  afterEach(() => {
    (CONTRACTS as { basketRouter: string | null }).basketRouter = DEPLOYED;
  });

  it("batches an exact approval to the router and its `buy` into one confirmation, for a wallet that can batch", async () => {
    const wallet = batchWallet();
    const asked = world();
    await reviewBatch("10");
    await userEvent.click(batchBuy());
    await waitFor(() => expect(wallet.sent).toHaveLength(1), { timeout: 3000 });
    const calls = wallet.sent[0]!.calls as Json[];
    expect(calls).toHaveLength(2);
    const router = DEPLOYED!.toLowerCase();
    expect(String(calls[0]!.to).toLowerCase()).toBe(USDC.address.toLowerCase());
    expect(calls[0]!.data).toBe(approveData(DEPLOYED!, 10_000_000n));
    expect(String(calls[1]!.to).toLowerCase()).toBe(router);
    expect(decodeFunctionData({ abi: ROUTER_ABI, data: calls[1]!.data as `0x${string}` }).functionName).toBe("buy");
    expect(asked.slice(-2).map((q) => String(q.user).toLowerCase())).toEqual([router, router]);
    expect(screen.getByText("1 SIGN")).toBeInTheDocument();
  });

  it("refuses a fresh router quote that now moves its market too far, sending nothing", async () => {
    const wallet = batchWallet();
    world({ relay: (body, i) => {
      const q = quoteFor(body) as { details: { totalImpact?: { percent: string } } };
      if (i >= 2) q.details.totalImpact = { percent: "-9.5" };
      return json(q);
    } });
    await reviewBatch("10");
    await userEvent.click(batchBuy());
    expect(await screen.findByText(/now moves its market 9\.50%/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(wallet.sent).toHaveLength(0);
  });

  it("says a wallet that cannot batch buys step by step while no router is set", async () => {
    (CONTRACTS as { basketRouter: string | null }).basketRouter = null;
    plainWallet();
    world();
    await reviewPlain();
    expect(screen.getByText(/does not report atomic batching/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Buy basket · 1 transaction" })).toBeNull();
  });

  /** A plain wallet: no batching, signs a permit, sends a transaction. */
  function plainWallet(sign: () => unknown = () => SIGNATURE) {
    const sent: Record<string, string>[] = [];
    const signed: unknown[][] = [];
    vi.stubGlobal("ethereum", { request: async ({ method, params }: Eip1193Request) => {
      if (method === "eth_accounts") return [USER];
      if (method === "eth_chainId") return BASE.idHex;
      if (method === "eth_signTypedData_v4") { signed.push(params as unknown[]); return sign(); }
      if (method === "eth_sendTransaction") { sent.push(params![0] as Record<string, string>); return HASH; }
      throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
    } });
    return { sent, signed };
  }

  async function reviewPlain(amount = "10") {
    mount();
    await settle();
    await basket([["NVDA", "60"], ["AAPL", "40"]]);
    await userEvent.type(screen.getByLabelText("USDC to put in"), amount);
    await userEvent.click(cta());
    await settle();
  }
  const routerBuy = () => screen.getByRole("button", { name: /Buy basket · 1 transaction|Preparing basket/ });

  it("asks for one USDC permit for exactly the total, then sends one transaction to the router, and measures what arrived", async () => {
    (CONTRACTS as { basketRouter: string | null }).basketRouter = ROUTER;
    const wallet = plainWallet();
    const asked = world({ receipt: () => delivered(NVDA_ON_BASE, 30_000_000n) });
    await reviewPlain();
    await userEvent.click(routerBuy());
    await waitFor(() => expect(wallet.sent).toHaveLength(1), { timeout: 3000 });
    // the fresh legs were quoted with the router sending and this wallet receiving
    expect(asked.slice(-2).map((q) => [String(q.user).toLowerCase(), String(q.recipient).toLowerCase()])).toEqual([[ROUTER, USER.toLowerCase()], [ROUTER, USER.toLowerCase()]]);
    const permit = JSON.parse(String(wallet.signed[0]![1])) as { primaryType: string; message: Record<string, string> };
    expect(permit.primaryType).toBe("Permit");
    expect({ ...permit.message, owner: permit.message.owner!.toLowerCase() }).toMatchObject({ owner: USER.toLowerCase(), spender: ROUTER, value: "10000000", nonce: "7" });
    expect(wallet.sent[0]!.to!.toLowerCase()).toBe(ROUTER);
    const call = decodeFunctionData({ abi: ROUTER_ABI, data: wallet.sent[0]!.data as `0x${string}` });
    expect(call.functionName).toBe("buyWithPermit");
    expect((call.args[0] as readonly { amountIn: bigint }[]).map((l) => l.amountIn)).toEqual([6_000_000n, 4_000_000n]);
    expect(await screen.findByText(/arrived: 0\.3 NVDAc/)).toBeInTheDocument();
  });

  it("sends `buy` with no signature when the allowance already covers the total", async () => {
    (CONTRACTS as { basketRouter: string | null }).basketRouter = ROUTER;
    const wallet = plainWallet();
    world({ routerAllowance: 10_000_000n });
    await reviewPlain();
    await userEvent.click(routerBuy());
    await waitFor(() => expect(wallet.sent).toHaveLength(1), { timeout: 3000 });
    expect(wallet.signed).toHaveLength(0);
    expect(decodeFunctionData({ abi: ROUTER_ABI, data: wallet.sent[0]!.data as `0x${string}` }).functionName).toBe("buy");
  });

  it("sends nothing when the permit is declined, or a fresh quote moves its market too far", async () => {
    (CONTRACTS as { basketRouter: string | null }).basketRouter = ROUTER;
    const wallet = plainWallet(() => { throw Object.assign(new Error("denied"), { code: 4001 }); });
    world();
    await reviewPlain();
    await userEvent.click(routerBuy());
    expect(await screen.findByText(/You declined the USDC signature/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(wallet.sent).toHaveLength(0);
  });

  it("measures nothing when the wallet refuses the transaction", async () => {
    (CONTRACTS as { basketRouter: string | null }).basketRouter = ROUTER;
    vi.stubGlobal("ethereum", { request: async ({ method }: Eip1193Request) => {
      if (method === "eth_accounts") return [USER];
      if (method === "eth_chainId") return BASE.idHex;
      if (method === "eth_signTypedData_v4") return SIGNATURE;
      if (method === "eth_sendTransaction") throw Object.assign(new Error("User rejected"), { code: 4001 });
      throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
    } });
    world();
    await reviewPlain();
    await userEvent.click(routerBuy());
    await waitFor(() => expect(screen.getByRole("button", { name: "Buy basket · 1 transaction" })).toBeEnabled(), { timeout: 3000 });
    expect(screen.queryByText(/arrived:/)).toBeNull();
  });

  it("measures nothing for a wallet that switched accounts while the transaction was out", async () => {
    (CONTRACTS as { basketRouter: string | null }).basketRouter = ROUTER;
    let account = USER;
    let notify: () => void = () => {};
    let approve!: (hash: string) => void;
    vi.stubGlobal("ethereum", {
      on: (event: string, callback: () => void) => { if (event === "accountsChanged") notify = callback; },
      removeListener: () => {},
      request: async ({ method }: Eip1193Request) => {
        if (method === "eth_accounts") return [account];
        if (method === "eth_chainId") return BASE.idHex;
        if (method === "eth_signTypedData_v4") return SIGNATURE;
        if (method === "eth_sendTransaction") return new Promise<string>((resolve) => { approve = resolve; });
        throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
      },
    });
    world({ receipt: () => delivered(NVDA_ON_BASE, 30_000_000n) });
    await reviewPlain();
    await userEvent.click(routerBuy());
    await waitFor(() => expect(approve).toBeDefined(), { timeout: 3000 });
    await act(async () => { account = `0x${"12".repeat(20)}`; notify(); });
    await settle();
    await act(async () => { approve(HASH); });
    await settle();
    expect(screen.queryByText(/arrived:/)).toBeNull();
  });

  it("refuses a fresh quote that now moves its market too far", async () => {
    (CONTRACTS as { basketRouter: string | null }).basketRouter = ROUTER;
    const wallet = plainWallet();
    world({ relay: (body, i) => {
      const q = quoteFor(body) as { details: { totalImpact?: { percent: string } } };
      if (i >= 2) q.details.totalImpact = { percent: "-9.5" };
      return json(q);
    } });
    await reviewPlain();
    await userEvent.click(routerBuy());
    expect(await screen.findByText(/now moves its market 9\.50%/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(wallet.sent).toHaveLength(0);
  });
});
