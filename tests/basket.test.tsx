import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { erc20Abi } from "viem";
import { BASE, USDC } from "@/config/chain";
import { RELAY } from "@/config/routes";
import { forgetCatalog, parseBaseStocks } from "@/adapters/http/markets";
import { approveData } from "@/lib/erc20";
import { basketProblem, MAX_LEGS, PRESETS, split, topUp, weightsNow, type Leg } from "@/lib/basket";
import { TRANSFER_TOPIC } from "@/lib/transact";
import { STOCKS_PATH } from "@/server/stocks";
import { BasketPanel, catalog, PACE, quoteLeg } from "@/features/panels/BasketPanel";
import { WalletProvider } from "@/ui/WalletProvider";
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

type World = { readonly relay?: (body: Json, i: number) => Response; readonly usdc?: bigint; readonly held?: bigint; readonly receipt?: (i: number) => unknown; readonly stocks?: unknown; readonly region?: string };

function world(w: World = {}) {
  const asked: Json[] = [];
  const token = (balance: bigint) => contractAt(erc20Abi, { balanceOf: balance, decimals: 8, symbol: "X", allowance: 0n });
  const usdc = contractAt(erc20Abi, { balanceOf: w.usdc ?? 5_000_000_000n, allowance: 0n });
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
      if (url.startsWith("https://api.dexscreener.com/tokens/v1/base/")) return MARKETS_FX.dexBase;
      return undefined;
    },
    rpc: (m, p) => {
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

const cta = () => screen.getByRole("button", { name: /Quote the basket|Quoting|Connect|Enter how much|Buy the basket|Not enough|cannot be bought|weights add|Add at least|is not a|Reading|transfers are paused|not offered|could not be read/ });

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
  });

  it("says each leg's share now, and zero for an empty basket", () => {
    expect(weightsNow([300n, 100n])).toEqual([75, 25]);
    expect(weightsNow([0n, 0n])).toEqual([0, 0]);
  });

  it("knows Coinbase's stocks by ticker and symbol and the verified crypto, never USDC, and a paused stock as paused", () => {
    const c = catalog(STOCKS);
    expect(c.get("NVDA")).toMatchObject({ symbol: "NVDAc", address: NVDA_ON_BASE, kind: "stock", paused: false });
    expect(c.get("NVDAC")).toBe(c.get("NVDA"));
    expect(c.get("CBBTC")).toMatchObject({ kind: "crypto" });
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
    expect(screen.getByRole("table")).toHaveTextContent("arrived: 0.3 NVDAc");
    expect(screen.getByRole("table")).toHaveTextContent("arrived: 0 AAPLc");
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
    expect(screen.getByRole("table")).toHaveTextContent("Relay: No routes found.");
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
    expect(screen.getByRole("table")).toHaveTextContent("moves its market 3.10% — too thin for this size");
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
    expect(screen.getByRole("table")).toHaveTextContent("impact not given");
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
    expect(screen.getByRole("table")).not.toHaveTextContent("arrived");
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
    await userEvent.type(screen.getByLabelText("USDC to put in"), "10");
    await userEvent.click(cta());
    await settle();
    // NVDA is already far over its half, so the whole 10 USDC goes to AAPL
    expect(asked.map((a) => [String(a.destinationCurrency).toLowerCase(), a.amount])).toEqual([[AAPL_ON_BASE.toLowerCase(), "10000000"]]);
    expect(screen.getByRole("table")).toHaveTextContent("nothing to add — already at its weight");
  });
});
