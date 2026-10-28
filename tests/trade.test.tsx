import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { erc20Abi } from "viem";
import { BASE, USDC } from "@/config/chain";
import { TRADE_CRYPTO } from "@/config/markets";
import { RELAY } from "@/config/routes";
import { DEXSCREENER, forgetCatalog, parseBaseStocks } from "@/adapters/http/markets";
import { checkAddress } from "@/lib/address";
import { TRANSFER_TOPIC } from "@/lib/transact";
import { STOCKS_PATH } from "@/server/stocks";
import { TradePanel, transfersPaused } from "@/features/panels/TradePanel";
import { WalletProvider } from "@/ui/WalletProvider";
import type { Eip1193Provider, Eip1193Request } from "@/lib/wallet";
import { copy } from "./fixtures/base";
import { AAPL_ON_BASE, MARKETS_FX, NVDA_ON_BASE } from "./fixtures/markets";
import { ROUTES_FX, SWAPPER, USER } from "./fixtures/routes";
import { contractAt, DOWN, ethCalls, json, net, simulated, useNet } from "./net";

/**
 * Trade — the owner's ask of 2026-09-30: "build trade for the tokens on Base, Crypto and Stocks".
 * Prices, the stock list and the three Relay quotes are real captures (tests/fixtures).
 */

useNet();
afterEach(() => forgetCatalog());

vi.mock("@/lib/connectors", () => ({ walletConnectProvider: vi.fn(), coinbaseProvider: vi.fn() }));

const HASH = `0x${"34".repeat(32)}`;
type Json = Record<string, unknown>;

function wallet(account: string | null = USER) {
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

/**
 * The captured ETH → USDC receipt with its one delivery re-addressed to `USER` and set to
 * `amount` of `token` — a variant of a real receipt, built here where it can be read.
 */
function delivered(token: string, amount: bigint): unknown {
  const r = copy(ROUTES_FX.receiptEthUsdc) as { logs: { address: string; topics: string[]; data: string }[] };
  const log = r.logs.find((l) => l.topics[0] === TRANSFER_TOPIC && l.topics[2]!.endsWith(SWAPPER.slice(2)))!;
  log.address = token;
  log.topics[2] = `0x${USER.slice(2).toLowerCase().padStart(64, "0")}`;
  log.data = `0x${amount.toString(16).padStart(64, "0")}`;
  return r;
}

type World = { readonly quote?: () => Response; readonly receipt?: unknown; readonly get?: (url: string) => unknown };

/** A Relay request with its addresses lowercased — the app sends them as the address door returns them. */
const lower = (q: Json | undefined) => Object.fromEntries(Object.entries(q ?? {}).map(([k, v]) => [k, typeof v === "string" && v.startsWith("0x") ? v.toLowerCase() : v]));

/** DexScreener, Coinbase's list, Base's RPC (two stock tokens and USDC) and Relay — answered from captures. */
function world(w: World = {}) {
  const calls = ethCalls({
    [USDC.address]: contractAt(erc20Abi, { balanceOf: 50_000_000n, allowance: 0n }),
    [NVDA_ON_BASE]: contractAt(erc20Abi, { decimals: 8, symbol: "NVDAc", balanceOf: 10n ** 8n, allowance: 0n }),
    [AAPL_ON_BASE]: contractAt(erc20Abi, { decimals: 8, symbol: "AAPLc", balanceOf: 0n }),
  });
  net({
    get: (url) => {
      const special = w.get?.(url);
      if (special !== undefined) return special;
      if (url === `${STOCKS_PATH}/base`) return MARKETS_FX.coinbaseStocks;
      if (url.startsWith(`${DEXSCREENER}/base/`)) return MARKETS_FX.dexBase;
      return undefined;
    },
    rpc: (m, p) => {
      const sim = simulated()(m, p);
      if (sim !== undefined) return sim;
      if (m === "eth_getBalance") return `0x${(10n ** 18n).toString(16)}`;
      if (m === "eth_getCode") return "0x";
      if (m === "eth_getTransactionReceipt") return w.receipt ?? { status: "0x1", blockNumber: "0x2a", logs: [] };
      return calls(m, p);
    },
  });
  const asked: Json[] = [];
  const rpcFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url.startsWith(RELAY.api)) {
      asked.push(JSON.parse(String(init!.body)) as Json);
      return Promise.resolve(w.quote!());
    }
    return rpcFetch(url, init);
  });
  return asked;
}

async function settle() {
  for (let i = 0; i < 8; i++) await act(async () => {});
}

function mount() {
  return render(
    <WalletProvider>
      <TradePanel />
    </WalletProvider>,
  );
}

const list = (name: string) => within(screen.getByRole("list", { name }));
const rowTexts = (name: string) => list(name).getAllByRole("button").map((b) => b.textContent);
const cta = () => screen.getByRole("button", { name: /Connect|Enter|Get a quote|Quoting|in wallet|Not enough|Swapped/ });

describe("the tokens Trade offers", () => {
  it("are all verified addresses, with their EIP-55 checksum", () => {
    for (const t of TRADE_CRYPTO) expect(checkAddress(t.address).kind, t.symbol).toBe("checksummed");
    expect(new Set(TRADE_CRYPTO.map((t) => t.address.toLowerCase())).size).toBe(TRADE_CRYPTO.length);
  });

  it("knows a stock with its transfers paused from one with only something else paused", () => {
    const stocks = parseBaseStocks(MARKETS_FX.coinbaseStocks);
    expect(transfersPaused(stocks.get("DKNG")!)).toBe(true);
    expect(transfersPaused(stocks.get("NVDA")!)).toBe(false);
    expect(transfersPaused({ ...stocks.get("NVDA")!, paused: [1, 2] })).toBe(false);
    expect(transfersPaused(null)).toBe(false);
  });
});

describe("TradePanel: the lists", () => {
  it("lists Base crypto first — ETH priced by WETH — each with its price and change", async () => {
    world();
    mount();
    expect(screen.getByText("Reading prices…")).toBeInTheDocument();
    await settle();
    const rows = rowTexts("Crypto on Base");
    expect(rows).toHaveLength(1 + TRADE_CRYPTO.length);
    expect(rows[0]).toBe("ETHEther$2,670.91−1.70%");
    // a token DexScreener named no pair for is a dash, never a zero
    expect(rows[1]).toBe("USDCUSD Coin——");
    expect(rows[2]).toMatch(/^cbBTCCoinbase Wrapped BTC\$83,546\.65/);
    expect(screen.getByText("Pick a token to buy or sell it on Base.")).toBeInTheDocument();
  });

  it("lists Coinbase's stocks on Base, deepest markets first, and marks a paused one", async () => {
    world();
    mount();
    await settle();
    await userEvent.click(screen.getByRole("tab", { name: "Stocks" }));
    await settle();
    const rows = rowTexts("Stocks on Base");
    expect(rows.slice(0, 2)).toEqual(["NVDANVIDIA Corporation$230.55−0.10%", "AAPLApple Inc.$338.64+2.01%"]);
    expect(rows).toHaveLength(6);
    expect(rows.find((r) => r!.startsWith("DKNG"))).toMatch(/—paused$/);
    expect(screen.getByRole("tab", { name: "Stocks" })).toHaveAttribute("aria-selected", "true");
  });

  it("filters by ticker or name, and says when nothing matches", async () => {
    world();
    mount();
    await settle();
    await userEvent.type(screen.getByLabelText("Search"), "coinbase");
    expect(rowTexts("Crypto on Base").map((r) => r!.slice(0, 5))).toEqual(["cbBTC", "cbETH"]);
    await userEvent.clear(screen.getByLabelText("Search"));
    await userEvent.type(screen.getByLabelText("Search"), "zzz");
    expect(screen.getByText("Nothing matches “zzz”.")).toBeInTheDocument();
    // a new tab starts with no search and nothing picked
    await userEvent.click(screen.getByRole("tab", { name: "Stocks" }));
    expect(screen.getByLabelText("Search")).toHaveValue("");
  });

  it("still lists everything when prices cannot be read, and says why", async () => {
    world({ get: (u) => (u.startsWith(DEXSCREENER) ? DOWN : undefined) });
    mount();
    await settle();
    expect(rowTexts("Crypto on Base")[0]).toBe("ETHEther——");
    expect(screen.getByLabelText("Trade prices")).toHaveTextContent("DexScreener could not be reached for prices.");
  });

  it("says when Coinbase's list of stocks cannot be read", async () => {
    world({ get: (u) => (u === `${STOCKS_PATH}/base` ? DOWN : undefined) });
    mount();
    await settle();
    await userEvent.click(screen.getByRole("tab", { name: "Stocks" }));
    await settle();
    expect(screen.getByLabelText("Trade prices")).toHaveTextContent("This app's server could not be reached for the list of stocks on Base.");
  });

  it("reads prices again every minute while it is open, and stops when it closes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const calls = { n: 0 };
      world({ get: (u) => (u.startsWith(DEXSCREENER) ? (calls.n++, undefined) : undefined) });
      const view = mount();
      await settle();
      expect(calls.n).toBe(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      await settle();
      expect(calls.n).toBe(2);
      view.unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(calls.n).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops an answer that arrives after the window closed", async () => {
    world();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const answered = globalThis.fetch;
    vi.stubGlobal("fetch", (u: string, i?: RequestInit) => (u.startsWith(DEXSCREENER) || u.startsWith(STOCKS_PATH) ? gate.then(() => answered(u, i)) : answered(u, i)));
    const view = mount();
    await settle();
    view.unmount();
    release();
    await settle();
    // and a list that fails after closing
    world({ get: (u) => (u === `${STOCKS_PATH}/base` ? DOWN : undefined) });
    const again = mount();
    await settle();
    await userEvent.click(screen.getByRole("tab", { name: "Stocks" }));
    again.unmount();
    await settle();
  });
});

describe("TradePanel: buying and selling", () => {
  async function pick(tab: "Crypto" | "Stocks", ticker: string) {
    if (tab === "Stocks") {
      await userEvent.click(screen.getByRole("tab", { name: "Stocks" }));
      await settle();
    }
    await userEvent.click(list(tab === "Stocks" ? "Stocks on Base" : "Crypto on Base").getByRole("button", { name: new RegExp(`^${ticker}`) }));
  }

  it("shows a stock at a glance — price, shares per token, status — and who may hold it", async () => {
    world();
    wallet();
    mount();
    await settle();
    await pick("Stocks", "NVDA");
    const glance = screen.getByRole("region", { name: "NVDA at a glance" });
    expect(glance).toHaveTextContent("NVDA — NVIDIA Corporation");
    expect(glance).toHaveTextContent("$230.55 · −0.10% 24h · 1 token = 1 share · nothing paused");
    expect(glance).toHaveTextContent("only for persons in eligible jurisdictions outside the U.S.");
    await userEvent.click(screen.getByText("Everything about NVDA, with sources"));
    const facts = screen.getByRole("region", { name: "NVDA — NVIDIA Corporation" });
    expect(facts).toHaveTextContent("Shares per token1 — one token is not always one share");
    expect(facts).toHaveTextContent("Reference (NAV)$231.28 per token — Chainlink; not a trade price");
    expect(within(facts).getByRole("link", { name: NVDA_ON_BASE })).toHaveAttribute("href", `https://basescan.org/token/${NVDA_ON_BASE}`);
    expect(facts).toHaveTextContent("Sources: Coinbase Tokenized Stocks API, DexScreener (price)");
  });

  it("says a multiplier that is not one in shares, and a missing NAV as such", async () => {
    world();
    mount();
    await settle();
    await pick("Stocks", "GOOGL");
    expect(screen.getByRole("region", { name: "GOOGL at a glance" })).toHaveTextContent(/1 token = 1\.0003\d* shares/);
    await userEvent.click(screen.getByText("Everything about GOOGL, with sources"));
    expect(within(screen.getByRole("region", { name: "GOOGL — Alphabet Inc." })).getByText(/one token is not always one share/).closest(".report__row")).toHaveClass("report__row--warn");
    await pick("Stocks", "AMD");
    await userEvent.click(screen.getByText("Everything about AMD, with sources"));
    const amd = screen.getByRole("region", { name: "AMD — Advanced Micro Devices, Inc." });
    expect(amd).toHaveTextContent("Reference (NAV)not published");
    expect(amd).toHaveTextContent("Priceno DEX market found");
    expect(amd).toHaveTextContent("Market depthnot read");
  });

  it("refuses to quote a stock whose transfers are paused", async () => {
    world();
    wallet();
    mount();
    await settle();
    await pick("Stocks", "DKNG");
    expect(screen.getByLabelText("Trading paused")).toHaveTextContent("DKNG's transfers are paused on its token contract");
    expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "DKNG at a glance" })).toHaveTextContent("paused: transfers, minting, burning");
  });

  it("buys a stock with USDC: a quote for exactly that pair, checked, signed, and measured", async () => {
    const sent = wallet();
    const asked = world({ quote: () => json(ROUTES_FX.relayUsdcNvda), receipt: delivered(NVDA_ON_BASE, 2_166_624n) });
    mount();
    await settle();
    await pick("Stocks", "NVDA");
    expect(screen.getByRole("button", { name: "Buy NVDA" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("group", { name: "Pay with" })).getByRole("button", { name: "USDC" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("USDC → NVDAc on Base")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    await userEvent.click(cta());
    const review = await screen.findByRole("region", { name: "Review" });
    expect(lower(asked[0])).toMatchObject({ originCurrency: USDC.address.toLowerCase(), destinationCurrency: NVDA_ON_BASE.toLowerCase(), amount: "5000000" });
    expect(review).toHaveTextContent("5 USDC");
    expect(review).toHaveTextContent("0.02166624 NVDAc");
    expect(review).toHaveTextContent("exactly 5 USDC — never unlimited");
    await userEvent.click(screen.getByRole("button", { name: "Swap in wallet" }));
    await waitFor(() => expect(screen.getByText(/^Received 0\.02166624 NVDAc — the quoted minimum was 0\.02144957\.$/)).toHaveClass("tx__ok"));
    expect(sent.map((t) => t.to!.toLowerCase())).toEqual([USDC.address.toLowerCase(), RELAY.approvalProxy.toLowerCase()]);
  });

  it("sells a stock for USDC, approving exactly the stock it sells", async () => {
    const sent = wallet();
    const asked = world({ quote: () => json(ROUTES_FX.relayNvdaUsdc), receipt: delivered(USDC.address, 2_300_590n) });
    mount();
    await settle();
    await pick("Stocks", "NVDA");
    await userEvent.click(screen.getByRole("button", { name: "Sell NVDA" }));
    expect(screen.getByText("NVDAc → USDC on Base")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Receive" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["USDC", "ETH"]);
    await userEvent.type(screen.getByLabelText("Amount"), "0.01");
    await userEvent.click(cta());
    const review = await screen.findByRole("region", { name: "Review" });
    expect(lower(asked[0])).toMatchObject({ originCurrency: NVDA_ON_BASE.toLowerCase(), destinationCurrency: USDC.address.toLowerCase(), amount: "1000000" });
    expect(review).toHaveTextContent("exactly 0.01 NVDAc — never unlimited");
    await userEvent.click(screen.getByRole("button", { name: "Swap in wallet" }));
    await waitFor(() => expect(screen.getByText(/^Received 2\.30059 USDC/)).toHaveClass("tx__ok"));
    expect(sent[0]!.to!.toLowerCase()).toBe(NVDA_ON_BASE.toLowerCase());
  });

  it("buys with ETH in one step, and never offers ETH for ETH or USDC for USDC", async () => {
    const sent = wallet();
    const asked = world({ quote: () => json(ROUTES_FX.relayEthAapl) });
    mount();
    await settle();
    await pick("Crypto", "ETH");
    expect(within(screen.getByRole("group", { name: "Pay with" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["USDC"]);
    await pick("Crypto", "USDC");
    expect(within(screen.getByRole("group", { name: "Pay with" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["ETH"]);
    // picked ETH while on USDC: the pair falls back to the one that makes sense
    expect(screen.getByText("ETH → USDC on Base")).toBeInTheDocument();
    await pick("Stocks", "AAPL");
    await userEvent.click(within(screen.getByRole("group", { name: "Pay with" })).getByRole("button", { name: "ETH" }));
    expect(screen.getByText("ETH → AAPLc on Base")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Amount"), "0.001");
    await userEvent.click(cta());
    await screen.findByRole("region", { name: "Review" });
    expect(lower(asked[0])).toMatchObject({ originCurrency: "0x0000000000000000000000000000000000000000", destinationCurrency: AAPL_ON_BASE.toLowerCase(), amount: "1000000000000000" });
    await userEvent.click(screen.getByRole("button", { name: "Swap in wallet" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(lower(sent[0])).toMatchObject({ to: RELAY.router.toLowerCase(), value: "0x38d7ea4c68000" });
  });

  it("asks for a wallet before anything is quoted", async () => {
    vi.stubGlobal("ethereum", undefined);
    world();
    mount();
    await settle();
    await pick("Crypto", "cbBTC");
    expect(cta()).toHaveTextContent("Connect a wallet first");
    expect(screen.getByText("USDC → cbBTC on Base")).toBeInTheDocument();
  });
});
