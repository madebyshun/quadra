import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { decodeFunctionData, erc20Abi } from "viem";
import { BASE, USDC, WETH } from "@/config/chain";
import { ACROSS, RELAY, ROBINHOOD } from "@/config/routes";
import { SwapPanel, impactTone, QUOTE_TTL_MS } from "@/features/panels/SwapPanel";
import { BridgePanel } from "@/features/panels/BridgePanel";
import { WalletProvider } from "@/ui/WalletProvider";
import type { Eip1193Provider, Eip1193Request } from "@/lib/wallet";
import { copy, walletReads } from "./fixtures/base";
import { ROUTES_FX, SWAPPER, USDC_ETH, USER } from "./fixtures/routes";
import { TRANSFER_TOPIC } from "@/lib/transact";
import { contractAt, ethCalls, json, net, simulated, useNet } from "./net";

useNet();

vi.mock("@/lib/connectors", () => ({ walletConnectProvider: vi.fn(), coinbaseProvider: vi.fn() }));

const HASH = `0x${"12".repeat(32)}`;
const OTHER_TOKEN = "0x2222222222222222222222222222222222222222";
type Json = Record<string, unknown>;

/** The connected wallet: jesse.base.eth, the address the captured quotes were made for. */
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

type World = {
  /** what `eth_getTransactionReceipt` answers for every step */
  readonly receipt?: unknown;
  /** the account's ETH balance by block tag; any other tag reads 1 ETH */
  readonly ethAt?: Readonly<Record<string, bigint>>;
  readonly usdc?: bigint;
  readonly allowance?: bigint;
  readonly code?: string;
  readonly quote?: () => Response;
  readonly rhBalances?: bigint[];
};

/**
 * Base and Robinhood Chain through the fake network, and the quote APIs through `quote`.
 * Balance reads are queues so a test can say "before, then after".
 */
function world(w: World = {}) {
  const rh = [...(w.rhBalances ?? [0n, 0n])];
  const base = ethCalls({
    [USDC.address]: (data) => {
      const f = decodeFunctionData({ abi: erc20Abi, data }).functionName;
      const answers: Record<string, unknown> = { decimals: 6, symbol: "USDC", balanceOf: w.usdc ?? 50_000_000n, allowance: w.allowance ?? 0n };
      return contractAt(erc20Abi, { [f]: answers[f] })(data);
    },
    [WETH.address]: contractAt(erc20Abi, { decimals: 18, symbol: "WETH", balanceOf: 0n }),
    [OTHER_TOKEN]: contractAt(erc20Abi, { decimals: 8, symbol: "B20", balanceOf: 0n }),
  });
  net({
    get: walletReads(),
    rpc: (m, p, endpoint) => {
      const sim = simulated()(m, p);
      if (sim !== undefined) return sim;
      if (endpoint === ROBINHOOD.rpc) {
        const next = `0x${(rh.shift() ?? 0n).toString(16)}`;
        return m === "eth_getBalance" ? next : `0x${next.slice(2).padStart(64, "0")}`;
      }
      if (m === "eth_getBalance") return `0x${(w.ethAt?.[String(p[1])] ?? 10n ** 18n).toString(16)}`;
      if (m === "eth_getCode") return w.code ?? "0x";
      if (m === "eth_getTransactionReceipt") return w.receipt ?? { status: "0x1", blockNumber: "0x2a", logs: [] };
      return base(m, p);
    },
  });
  const rpcFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    url.startsWith(RELAY.api) || url.startsWith(ACROSS.api) ? Promise.resolve(w.quote!()) : rpcFetch(url, init),
  );
}

async function settle() {
  await act(async () => {});
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

/** The captured USDC → ETH quote variant: Relay's USDC → WETH quote with ETH coming out. */
function ethOutQuote(): Json {
  const q = copy(ROUTES_FX.relayUsdcWeth) as unknown as Json;
  (((q.details as Json).currencyOut as Json).currency as Json).address = "0x0000000000000000000000000000000000000000";
  return q;
}

function mount(node: React.ReactNode) {
  return render(<WalletProvider>{node}</WalletProvider>);
}

const cta = () => screen.getByRole("button", { name: /Connect|Enter|Get a quote|Quoting|in wallet|Not enough|Swapped|Bridged/ });

// ── Swap ─────────────────────────────────────────────────────────────────────

describe("SwapPanel", () => {
  it("rates a price impact by size, and an unreported one as worth a look", () => {
    expect(impactTone("-0.11")).toBe("ok");
    expect(impactTone("-2")).toBe("warn");
    expect(impactTone("-6.5")).toBe("bad");
    expect(impactTone(null)).toBe("warn");
    expect(impactTone("n/a")).toBe("warn");
  });

  it("names what is missing, in order", async () => {
    vi.stubGlobal("ethereum", undefined);
    const first = mount(<SwapPanel />);
    await settle();
    expect(cta()).toHaveTextContent("Connect a wallet first");
    first.unmount();

    wallet();
    mount(<SwapPanel />);
    await settle();
    expect(cta()).toHaveTextContent("Enter an amount");
    await userEvent.selectOptions(screen.getByLabelText("You pay"), "other");
    expect(cta()).toHaveTextContent("Enter the address of the token you pay");
    await userEvent.selectOptions(screen.getByLabelText("You pay"), "USDC");
    await userEvent.selectOptions(screen.getByLabelText("You get"), "other");
    expect(cta()).toHaveTextContent("Enter the address of the token you get");
    await userEvent.type(screen.getByLabelText("You get address"), OTHER_TOKEN);
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    expect(cta()).toHaveTextContent("Get a quote");
  });

  it("quotes USDC → WETH, signs the exact approval and the swap, and measures what arrived", async () => {
    let asked: Json = {};
    const sent = wallet();
    world({ receipt: delivered(WETH.address, 1858461545609535n), quote: () => json(ROUTES_FX.relayUsdcWeth) });
    const rpcAndQuotes = globalThis.fetch;
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      if (url.startsWith(RELAY.api)) asked = JSON.parse(String(init!.body)) as Json;
      return rpcAndQuotes(url, init);
    });
    mount(<SwapPanel />);
    await settle();
    await userEvent.selectOptions(screen.getByLabelText("You get"), "WETH");
    await userEvent.selectOptions(screen.getByLabelText("Slippage"), "100");
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    await userEvent.click(cta());
    const review = await screen.findByRole("region", { name: "Review" });
    expect(asked.slippageTolerance).toBe("100");
    expect(review).toHaveTextContent("5 USDC");
    expect(review).toHaveTextContent("0.001858461545609535 WETH");
    expect(review).toHaveTextContent("0.001849169237881487 WETH (slippage 1%)");
    expect(review).toHaveTextContent("-0.11%");
    expect(review).toHaveTextContent(`Relay's verified contract ${RELAY.approvalProxy}`);
    expect(review).toHaveTextContent("exactly 5 USDC — never unlimited");
    // the owner's fee address is set, so the review states the fee
    expect(review).toHaveTextContent("fee0.1%");
    expect(review).toHaveTextContent(`Token you get${WETH.address}`);
    await userEvent.click(screen.getByRole("button", { name: "Swap in wallet" }));
    await waitFor(() =>
      expect(screen.getByText("Received 0.001858461545609535 WETH — the quoted minimum was 0.001849169237881487.")).toHaveClass("tx__ok"),
    );
    expect(sent.map((t) => t.to!.toLowerCase())).toEqual([USDC.address.toLowerCase(), RELAY.approvalProxy.toLowerCase()]);
    expect(cta()).toHaveTextContent("Swapped — edit a field to swap again");
  });

  it("swaps ETH in one step, and flags a result below the quoted minimum", async () => {
    const sent = wallet();
    // the real receipt delivered its USDC to its own sender, not to this user — so nothing arrived here
    world({ receipt: ROUTES_FX.receiptEthUsdc, quote: () => json(ROUTES_FX.relayEthUsdc) });
    mount(<SwapPanel />);
    await settle();
    await userEvent.selectOptions(screen.getByLabelText("You pay"), "ETH");
    await userEvent.selectOptions(screen.getByLabelText("You get"), "USDC");
    await userEvent.type(screen.getByLabelText("Amount"), "0.001");
    await userEvent.click(cta());
    const review = await screen.findByRole("region", { name: "Review" });
    expect(review).toHaveTextContent(`Relay's verified contract ${RELAY.router}`);
    expect(review).not.toHaveTextContent("never unlimited");
    await userEvent.click(screen.getByRole("button", { name: "Swap in wallet" }));
    await waitFor(() => expect(screen.getByText(/^Received 0 USDC — the quoted minimum was/)).toHaveClass("tx__bad"));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.value).toBe("0x38d7ea4c68000");
  });

  it("says an unreported impact as such", async () => {
    wallet();
    const q = copy(ROUTES_FX.relayUsdcWeth) as unknown as Json;
    delete (q.details as Json).totalImpact;
    world({ quote: () => json(q) });
    mount(<SwapPanel />);
    await settle();
    await userEvent.selectOptions(screen.getByLabelText("You get"), "WETH");
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    await userEvent.click(cta());
    expect(await screen.findByRole("region", { name: "Review" })).toHaveTextContent("not reported");
  });

  /** MEASURED: the real USDC → ETH receipt and its sender's balances, here standing for this user's. */
  it("measures ETH that arrived from the balance at the receipt's block, plus the fee", async () => {
    wallet();
    world({ receipt: ROUTES_FX.receiptUsdcEth, ethAt: { [USDC_ETH.block]: USDC_ETH.after, [USDC_ETH.previous]: USDC_ETH.before }, quote: () => json(ethOutQuote()) });
    mount(<SwapPanel />);
    await settle();
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    await userEvent.click(cta());
    await userEvent.click(await screen.findByRole("button", { name: "Swap in wallet" }));
    await waitFor(() => expect(screen.getByText(/^Received 0.04665297046451734 ETH — the quoted minimum was/)).toHaveClass("tx__ok"));
  });

  it("says a fall in the balance as zero received", async () => {
    wallet();
    world({ receipt: ROUTES_FX.receiptUsdcEth, ethAt: { [USDC_ETH.block]: USDC_ETH.before, [USDC_ETH.previous]: USDC_ETH.after }, quote: () => json(ethOutQuote()) });
    mount(<SwapPanel />);
    await settle();
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    await userEvent.click(cta());
    await userEvent.click(await screen.findByRole("button", { name: "Swap in wallet" }));
    await waitFor(() => expect(screen.getByText(/^Received 0 ETH — the quoted minimum was/)).toHaveClass("tx__bad"));
  });

  it("claims nothing arrived from a swap that reverted", async () => {
    wallet();
    const reverted = { ...(copy(ROUTES_FX.receiptEthUsdc) as Json), status: "0x0" };
    world({ receipt: reverted, quote: () => json(ROUTES_FX.relayEthUsdc) });
    mount(<SwapPanel />);
    await settle();
    await userEvent.selectOptions(screen.getByLabelText("You pay"), "ETH");
    await userEvent.selectOptions(screen.getByLabelText("You get"), "USDC");
    await userEvent.type(screen.getByLabelText("Amount"), "0.001");
    await userEvent.click(cta());
    await userEvent.click(await screen.findByRole("button", { name: "Swap in wallet" }));
    await waitFor(() => expect(screen.getByLabelText("Swap progress")).toHaveTextContent(/reverted/i));
    expect(screen.queryByText(/^Received/)).toBeNull();
    expect(screen.queryByText(/could not be measured/)).toBeNull();
  });

  it("says what arrived could not be measured, rather than guessing", async () => {
    wallet();
    const r = copy(ROUTES_FX.receiptUsdcEth) as Json;
    delete r.gasUsed;
    world({ receipt: r, quote: () => json(ethOutQuote()) });
    mount(<SwapPanel />);
    await settle();
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    await userEvent.click(cta());
    await userEvent.click(await screen.findByRole("button", { name: "Swap in wallet" }));
    expect(await screen.findByText("Confirmed, but what arrived could not be measured here — check your ETH balance on Basescan.")).toHaveClass("tx__warn");
  });

  it("shows no token address when the token you get is ETH", async () => {
    wallet();
    world({ quote: () => json(ethOutQuote()) });
    mount(<SwapPanel />);
    await settle();
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    await userEvent.click(cta());
    const review = await screen.findByRole("region", { name: "Review" });
    expect(review).toHaveTextContent("ETH");
    expect(review).not.toHaveTextContent("Token you get");
  });

  it("will not sign more than the balance", async () => {
    wallet();
    world({ usdc: 1_000_000n, quote: () => json(ROUTES_FX.relayUsdcWeth) });
    mount(<SwapPanel />);
    await settle();
    await userEvent.selectOptions(screen.getByLabelText("You get"), "WETH");
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    await userEvent.click(cta());
    expect(await screen.findByRole("button", { name: "Not enough USDC" })).toBeDisabled();
  });

  it("refuses a quote more than a minute old at the click, and sends nothing", async () => {
    const sent = wallet();
    world({ quote: () => json(ROUTES_FX.relayUsdcWeth) });
    mount(<SwapPanel />);
    await settle();
    await userEvent.selectOptions(screen.getByLabelText("You get"), "WETH");
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    await userEvent.click(cta());
    const swap = await screen.findByRole("button", { name: "Swap in wallet" });
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + QUOTE_TTL_MS + 1);
    try {
      await userEvent.click(swap);
    } finally {
      clock.mockRestore();
    }
    expect(screen.getByLabelText("Swap error")).toHaveTextContent("more than a minute old");
    expect(sent).toEqual([]);
  });

  it("says why a quote could not be had, in the service's words and the app's", async () => {
    wallet();
    world({ quote: () => json({ message: "Amount is too small to be swapped" }, 400) });
    mount(<SwapPanel />);
    await settle();
    await userEvent.selectOptions(screen.getByLabelText("You get"), "WETH");
    await userEvent.type(screen.getByLabelText("Amount"), "0.000001");
    await userEvent.click(cta());
    expect(await screen.findByLabelText("Swap error")).toHaveTextContent("Relay: Amount is too small to be swapped.");
    await userEvent.clear(screen.getByLabelText("Amount"));
    await userEvent.type(screen.getByLabelText("Amount"), "0");
    await userEvent.click(cta());
    expect(await screen.findByLabelText("Swap error")).toHaveTextContent("Enter an amount above zero.");
    await userEvent.selectOptions(screen.getByLabelText("You get"), "USDC");
    await userEvent.clear(screen.getByLabelText("Amount"));
    await userEvent.type(screen.getByLabelText("Amount"), "1");
    await userEvent.click(cta());
    expect(await screen.findByLabelText("Swap error")).toHaveTextContent("Pick two different tokens.");
  });

  it("reads a pasted token from its contract for either side", async () => {
    wallet();
    world({ quote: () => json({ message: "No route" }, 400) });
    mount(<SwapPanel />);
    await settle();
    await userEvent.selectOptions(screen.getByLabelText("You pay"), "other");
    await userEvent.type(screen.getByLabelText("You pay address"), OTHER_TOKEN);
    await userEvent.type(screen.getByLabelText("Amount"), "1.5");
    await userEvent.click(cta());
    expect(await screen.findByLabelText("Swap error")).toHaveTextContent("Relay: No route.");
  });
});

// ── Bridge ───────────────────────────────────────────────────────────────────

const FAST = { every: 1, within: 3, sleep: async () => {} };

/** A captured quote made valid for another ten minutes (or expired, when told). */
function fresh(fixture: unknown, expired = false): Json {
  const q = copy(fixture) as Json;
  q.quoteExpiryTimestamp = Math.floor(Date.now() / 1000) + (expired ? -10 : 600);
  return q;
}

describe("BridgePanel", () => {
  it("names what is missing", async () => {
    vi.stubGlobal("ethereum", undefined);
    const first = mount(<BridgePanel />);
    await settle();
    expect(cta()).toHaveTextContent("Connect a wallet first");
    first.unmount();
    wallet();
    mount(<BridgePanel />);
    await settle();
    expect(cta()).toHaveTextContent("Enter an amount");
  });

  it("bridges USDC: an exact approval, the deposit, then watches USDG arrive on Robinhood Chain", async () => {
    const sent = wallet();
    world({ quote: () => json(fresh(ROUTES_FX.acrossUsdc)), rhBalances: [0n, 0n, 4988141n] });
    mount(<BridgePanel arrival={FAST} />);
    await settle();
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    await userEvent.click(cta());
    const review = await screen.findByRole("region", { name: "Review" });
    expect(review).toHaveTextContent("4.988141 USDG on Robinhood Chain (4663)");
    expect(review).toHaveTextContent(`${USER} — your own address on Robinhood Chain`);
    expect(review).toHaveTextContent("exactly 5 USDC to Across — never unlimited");
    expect(review).toHaveTextContent("There is no USDC on Robinhood Chain. It arrives as USDG");
    expect(review).toHaveTextContent("about2 s");
    expect(within(review).getByRole("link", { name: /your own address/ })).toHaveAttribute("href", `${ROBINHOOD.explorer}/address/${USER}`);
    await userEvent.click(screen.getByRole("button", { name: "Bridge in wallet" }));
    await waitFor(() => expect(screen.getByText(/Arrived: your USDG balance on Robinhood Chain rose by 4.988141/)).toBeInTheDocument());
    expect(sent.map((t) => t.to)).toEqual([USDC.address, ACROSS.spokePool]);
    expect(decodeFunctionData({ abi: erc20Abi, data: sent[0]!.data as `0x${string}` }).args).toEqual([ACROSS.spokePool, 5_000_000n]);
    expect(cta()).toHaveTextContent("Bridged — edit a field to bridge again");
  });

  it("bridges ETH with no approval, and says so when it has not arrived yet", async () => {
    const sent = wallet();
    world({ quote: () => json(fresh(ROUTES_FX.acrossEth)), rhBalances: [0n] });
    mount(<BridgePanel arrival={FAST} />);
    await settle();
    await userEvent.selectOptions(screen.getByLabelText("Move"), "ETH");
    await userEvent.type(screen.getByLabelText("Amount"), "0.001");
    await userEvent.click(cta());
    const review = await screen.findByRole("region", { name: "Review" });
    expect(review).not.toHaveTextContent("Approval");
    expect(review).not.toHaveTextContent("There is no USDC");
    await userEvent.click(screen.getByRole("button", { name: "Bridge in wallet" }));
    await waitFor(() => expect(screen.getByText(/Not seen on Robinhood Chain yet/)).toBeInTheDocument());
    expect(sent).toEqual([expect.objectContaining({ to: ACROSS.periphery, value: "0x38d7ea4c68000" })]);
  });

  it("skips the approval when the allowance already covers it, and shows no expiry it was not given", async () => {
    const sent = wallet();
    const q = fresh(ROUTES_FX.acrossUsdc);
    delete q.quoteExpiryTimestamp;
    delete q.expectedFillTime;
    world({ allowance: 10n ** 12n, quote: () => json(q), rhBalances: [0n, 5_000_000n] });
    mount(<BridgePanel arrival={FAST} />);
    await settle();
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    await userEvent.click(cta());
    const review = await screen.findByRole("region", { name: "Review" });
    expect(review).toHaveTextContent("not estimated");
    expect(review).not.toHaveTextContent("Quote valid until");
    await userEvent.click(screen.getByRole("button", { name: "Bridge in wallet" }));
    await waitFor(() => expect(screen.getByText(/Arrived/)).toBeInTheDocument());
    expect(sent.map((t) => t.to)).toEqual([ACROSS.spokePool]);
  });

  /**
   * MEASURED 2026-09-30: the owner's own address has exactly this code on Base and on Robinhood
   * Chain — an EIP-7702 delegation to MetaMask's smart-account contract. One key controls it on
   * both chains, so it may bridge; ETH may arrive as WETH, and either counts.
   */
  it("bridges from a wallet with an EIP-7702 delegation, counting WETH as arrived ETH", async () => {
    const sent = wallet();
    world({
      code: "0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b",
      quote: () => json(fresh(ROUTES_FX.acrossEth)),
      // before: ETH 0, WETH 0 — after: ETH 0, WETH the minimum
      rhBalances: [0n, 0n, 0n, 992825534616529n],
    });
    mount(<BridgePanel arrival={FAST} />);
    await settle();
    await userEvent.selectOptions(screen.getByLabelText("Move"), "ETH");
    await userEvent.type(screen.getByLabelText("Amount"), "0.001");
    await userEvent.click(cta());
    expect(await screen.findByRole("region", { name: "Review" })).toHaveTextContent("smart-account delegation (EIP-7702)");
    await userEvent.click(screen.getByRole("button", { name: "Bridge in wallet" }));
    await waitFor(() =>
      expect(screen.getByText(/Arrived: your ETH and WETH balance on Robinhood Chain rose by 0.000992825534616529/)).toBeInTheDocument(),
    );
    expect(sent).toHaveLength(1);
  });

  it("says nothing about WETH when a delegated wallet bridges USDC", async () => {
    wallet();
    world({ code: "0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b", quote: () => json(fresh(ROUTES_FX.acrossUsdc)) });
    mount(<BridgePanel />);
    await settle();
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    await userEvent.click(cta());
    expect(await screen.findByRole("region", { name: "Review" })).not.toHaveTextContent("EIP-7702");
  });

  it("refuses to bridge from a smart-contract wallet", async () => {
    wallet();
    world({ code: "0x6080", quote: () => json(fresh(ROUTES_FX.acrossUsdc)) });
    mount(<BridgePanel />);
    await settle();
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    await userEvent.click(cta());
    expect(await screen.findByLabelText("Bridge error")).toHaveTextContent("smart-contract wallet");
  });

  it("refuses an expired quote at the click, and a zero amount, and more than the balance", async () => {
    const sent = wallet();
    world({ usdc: 10n ** 12n, quote: () => json(fresh(ROUTES_FX.acrossUsdc, true)) });
    mount(<BridgePanel />);
    await settle();
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    await userEvent.click(cta());
    await userEvent.click(await screen.findByRole("button", { name: "Bridge in wallet" }));
    expect(screen.getByLabelText("Bridge error")).toHaveTextContent("That quote has expired.");
    expect(sent).toEqual([]);
    await userEvent.clear(screen.getByLabelText("Amount"));
    await userEvent.type(screen.getByLabelText("Amount"), "0");
    await userEvent.click(cta());
    expect(await screen.findByLabelText("Bridge error")).toHaveTextContent("Enter an amount above zero.");
  });

  it("will not bridge more than the balance", async () => {
    wallet();
    world({ usdc: 1_000_000n, quote: () => json(fresh(ROUTES_FX.acrossUsdc)) });
    mount(<BridgePanel />);
    await settle();
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    await userEvent.click(cta());
    expect(await screen.findByRole("button", { name: "Not enough USDC" })).toBeDisabled();
  });

  it("stops at a refused step without watching for an arrival", async () => {
    wallet();
    const provider = (globalThis as unknown as { ethereum: Eip1193Provider }).ethereum;
    const original = provider.request.bind(provider);
    provider.request = (args: Eip1193Request) =>
      args.method === "eth_sendTransaction" ? Promise.reject(Object.assign(new Error("no"), { code: 4001 })) : original(args);
    world({ allowance: 10n ** 12n, quote: () => json(fresh(ROUTES_FX.acrossUsdc)) });
    mount(<BridgePanel arrival={FAST} />);
    await settle();
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    await userEvent.click(cta());
    await userEvent.click(await screen.findByRole("button", { name: "Bridge in wallet" }));
    await waitFor(() => expect(screen.getByLabelText("Bridge progress")).toHaveTextContent("You rejected it in your wallet."));
    expect(screen.queryByText(/Watching Robinhood Chain/)).not.toBeInTheDocument();
  });

  it("shows it is watching while the arrival is pending", async () => {
    wallet();
    world({ allowance: 10n ** 12n, quote: () => json(fresh(ROUTES_FX.acrossUsdc)), rhBalances: [0n] });
    mount(<BridgePanel arrival={{ every: 1, within: 1_000, sleep: () => new Promise(() => {}) }} />);
    await settle();
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    await userEvent.click(cta());
    await userEvent.click(await screen.findByRole("button", { name: "Bridge in wallet" }));
    expect(await screen.findByText("Watching Robinhood Chain for it to arrive…")).toBeInTheDocument();
  });
});
