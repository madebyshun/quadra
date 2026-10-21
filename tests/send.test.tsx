import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { decodeFunctionData, erc20Abi } from "viem";
import { BASE, USDC } from "@/config/chain";
import { SendPanel } from "@/features/panels/SendPanel";
import { TxStepList, useTxSteps, type StepState } from "@/features/panels/TxSteps";
import { WalletProvider } from "@/ui/WalletProvider";
import type { Eip1193Provider, Eip1193Request } from "@/lib/wallet";
import { ADDR, walletReads } from "./fixtures/base";
import { basenames, contractAt, DOWN, ethCalls, net, simulated, useNet, type Answer } from "./net";
import { OWNER, PX } from "./fixtures/profile";

useNet();

vi.mock("@/lib/connectors", () => ({ walletConnectProvider: vi.fn(), coinbaseProvider: vi.fn() }));

const ME = "0xabcdef0123456789abcdef0123456789abcdef01";
const THEM = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"cd".repeat(32)}`;
const TOKEN = "0x2222222222222222222222222222222222222222";

/** An injected wallet, connected on Base as ME, recording what it was asked to send. */
function injected(send: () => unknown = () => HASH) {
  const sent: Record<string, string>[] = [];
  const provider: Eip1193Provider = {
    request(args: Eip1193Request) {
      if (args.method === "eth_accounts") return Promise.resolve([ME]);
      if (args.method === "eth_chainId") return Promise.resolve(BASE.idHex);
      if (args.method === "eth_sendTransaction") {
        sent.push(args.params?.[0] as Record<string, string>);
        try {
          return Promise.resolve(send());
        } catch (e) {
          return Promise.reject(e);
        }
      }
      return Promise.reject(new Error(`unstubbed ${args.method}`));
    },
  };
  vi.stubGlobal("ethereum", provider);
  return sent;
}

type Chain = { eth?: bigint; usdc?: bigint; code?: Record<string, string>; receipt?: unknown; transfers?: Answer };

/** Base as the panel reads it: balances, code, USDC and one other token, jesse.base.eth, receipts. */
function chain(c: Chain = {}) {
  const calls = ethCalls({
    ...basenames({ forward: { "jesse.base.eth": ADDR.jesse }, resolver: ADDR.l2Resolver }),
    [USDC.address]: contractAt(erc20Abi, { decimals: 6, symbol: "USDC", balanceOf: c.usdc ?? 50_000_000n }),
    [TOKEN]: contractAt(erc20Abi, { decimals: 8, symbol: "B20", balanceOf: 10n ** 8n }),
  });
  return net({
    // the sender's token history, for the look-alike check: none by default
    get: (u) => (u.includes("/token-transfers") ? (c.transfers ?? { items: [] }) : walletReads()(u)),
    rpc: (m, p) => {
      const sim = simulated()(m, p);
      if (sim !== undefined) return sim;
      if (m === "eth_getBalance") return `0x${(c.eth ?? 10n ** 18n).toString(16)}`;
      if (m === "eth_getCode") return c.code?.[String(p[0]).toLowerCase()] ?? "0x";
      if (m === "eth_getTransactionReceipt") return c.receipt ?? { status: "0x1", blockNumber: "0x2a", logs: [] };
      return calls(m, p);
    },
  });
}

function mount() {
  return render(
    <WalletProvider>
      <SendPanel />
    </WalletProvider>,
  );
}

async function settle() {
  await act(async () => {});
}

const cta = () => screen.getByRole("button", { name: /Connect|Enter|Review|Reading|Send|Not enough|Sent/ });

async function fill(opts: { token?: string; tokenAddress?: string; to?: string; amount?: string }) {
  if (opts.token) await userEvent.selectOptions(screen.getByLabelText("Token"), opts.token);
  if (opts.tokenAddress) await userEvent.type(screen.getByLabelText("Token address"), opts.tokenAddress);
  if (opts.to) await userEvent.type(screen.getByLabelText("Recipient"), opts.to);
  if (opts.amount) await userEvent.type(screen.getByLabelText("Amount"), opts.amount);
}

describe("SendPanel: what the button says", () => {
  it("asks for a wallet first", async () => {
    vi.stubGlobal("ethereum", undefined);
    mount();
    await settle();
    expect(cta()).toHaveTextContent("Connect a wallet first");
    expect(cta()).toBeDisabled();
  });

  it("names the next thing missing, one at a time", async () => {
    injected();
    mount();
    await settle();
    expect(cta()).toHaveTextContent("Enter a recipient");
    await userEvent.selectOptions(screen.getByLabelText("Token"), "other");
    expect(cta()).toHaveTextContent("Enter the token address");
    await userEvent.type(screen.getByLabelText("Token address"), TOKEN);
    await fill({ to: THEM });
    expect(cta()).toHaveTextContent("Enter an amount");
    await fill({ amount: "1" });
    expect(cta()).toHaveTextContent("Review");
    expect(cta()).toBeEnabled();
  });
});

describe("SendPanel: sending", () => {
  it("reviews and sends ETH to an address, then watches it confirm", async () => {
    chain();
    const sent = injected();
    mount();
    await settle();
    await fill({ to: THEM, amount: "0.01" });
    await userEvent.click(cta());
    const review = await screen.findByRole("region", { name: "Review" });
    expect(within(review).getByText("0.01 ETH")).toBeInTheDocument();
    expect(within(review).getByText("ETH, Base's own currency")).toBeInTheDocument();
    expect(within(review).getByText("1 ETH")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send in wallet" }));
    await waitFor(() => expect(screen.getByLabelText("Send progress")).toHaveTextContent("confirmed in block 42"));
    expect(sent).toEqual([{ from: ME, to: THEM, value: "0x2386f26fc10000" }]);
    expect(screen.getByRole("link", { name: `${HASH.slice(0, 10)}…` })).toHaveAttribute("href", `${BASE.explorer}/tx/${HASH}`);
    expect(cta()).toHaveTextContent("Sent — edit a field to send again");
    expect(cta()).toBeDisabled();
  });

  /**
   * Send Check inside Send (2026-10-02): the owner's REAL poisoned history, re-pointed at this
   * test's wallet — a variant, built here — refuses the address the campaign planted.
   */
  it("refuses an address a fake transfer planted in your history, and says when the history could not be read", async () => {
    const ownerLower = OWNER.toLowerCase();
    const mine = JSON.parse(JSON.stringify(PX.transfersOwner).replace(new RegExp(OWNER, "gi"), ME)) as typeof PX.transfersOwner;
    const planted = PX.transfersOwner.items.find((i) => i.token.symbol === "ETH" && i.from.hash.toLowerCase() === ownerLower)!.to.hash;
    chain({ transfers: mine });
    injected();
    const a = mount();
    await settle();
    await fill({ to: planted, amount: "0.01" });
    await userEvent.click(cta());
    const review = await screen.findByRole("region", { name: "Review" });
    expect(within(review).getByText(/PLANTED in your history/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refused: a planted address" })).toBeDisabled();
    a.unmount();

    chain({ transfers: DOWN });
    injected();
    mount();
    await settle();
    await fill({ to: THEM, amount: "0.01" });
    await userEvent.click(cta());
    expect(within(await screen.findByRole("region", { name: "Review" })).getByText(/^not checked — your token history could not be read/)).toBeInTheDocument();
  });

  it("sends USDC to a Basename, as a transfer on the token contract", async () => {
    chain();
    const sent = injected();
    mount();
    await settle();
    await fill({ token: "USDC", to: "jesse", amount: "5" });
    await userEvent.click(cta());
    const review = await screen.findByRole("region", { name: "Review" });
    expect(within(review).getByText(`jesse.base.eth → ${ADDR.jesse}`)).toBeInTheDocument();
    expect(within(review).getByText(`USDC · ${USDC.address}`)).toBeInTheDocument();
    expect(within(review).getByText("Sources: Base RPC, Basenames, Blockscout (your token transfers)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send in wallet" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.to).toBe(USDC.address);
    expect(decodeFunctionData({ abi: erc20Abi, data: sent[0]!.data as `0x${string}` })).toEqual({
      functionName: "transfer",
      args: [ADDR.jesse, 5_000_000n],
    });
    expect(screen.getByText(/Send 5 USDC to jesse.base.eth/)).toBeInTheDocument();
  });

  it("reads another token's decimals from its contract", async () => {
    chain();
    injected();
    mount();
    await settle();
    await fill({ token: "other", tokenAddress: TOKEN, to: THEM, amount: "0.5" });
    await userEvent.click(cta());
    expect(await screen.findByText("0.5 B20")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Token"), "WETH");
    expect(screen.queryByRole("region", { name: "Review" })).not.toBeInTheDocument();
  });

  it("will not send more than the balance, and says which token is short", async () => {
    chain({ usdc: 1_000_000n });
    injected();
    mount();
    await settle();
    await fill({ token: "USDC", to: THEM, amount: "5" });
    await userEvent.click(cta());
    await screen.findByRole("region", { name: "Review" });
    expect(screen.getByRole("button", { name: "Not enough USDC" })).toBeDisabled();
    expect(screen.getByText("1 USDC").closest(".report__row")).toHaveClass("report__row--bad");
  });

  it("warns about a contract recipient, your own address, and leaving no gas", async () => {
    chain({ eth: 10n ** 16n, code: { [ME.toLowerCase()]: "0x6080" } });
    injected();
    mount();
    await settle();
    await fill({ to: ME, amount: "0.01" });
    await userEvent.click(cta());
    const review = await screen.findByRole("region", { name: "Review" });
    expect(review).toHaveTextContent("That is your own address.");
    expect(review).toHaveTextContent("This address is a contract.");
    expect(review).toHaveTextContent("This leaves almost no ETH to pay for the next transaction.");
  });

  it("refuses a zero amount and a bad token address, in words", async () => {
    chain();
    injected();
    mount();
    await settle();
    await fill({ to: THEM, amount: "0" });
    await userEvent.click(cta());
    expect(await screen.findByLabelText("Send error")).toHaveTextContent("Enter an amount above zero.");
    await userEvent.selectOptions(screen.getByLabelText("Token"), "other");
    await userEvent.type(screen.getByLabelText("Token address"), "0x12");
    await userEvent.clear(screen.getByLabelText("Amount"));
    await userEvent.type(screen.getByLabelText("Amount"), "1");
    await userEvent.click(cta());
    expect(await screen.findByLabelText("Send error")).toHaveTextContent(/Token address/);
  });

  it("shows the wallet's refusal on the step, and lets nothing else happen", async () => {
    chain();
    injected(() => {
      throw Object.assign(new Error("denied"), { code: 4001 });
    });
    mount();
    await settle();
    await fill({ to: THEM, amount: "0.01" });
    await userEvent.click(cta());
    await userEvent.click(await screen.findByRole("button", { name: "Send in wallet" }));
    await waitFor(() => expect(screen.getByLabelText("Send progress")).toHaveTextContent("You rejected it in your wallet. Nothing was sent."));
  });

  it("forgets the review, and the progress, when a field changes", async () => {
    chain();
    injected();
    mount();
    await settle();
    await fill({ to: THEM, amount: "0.01" });
    await userEvent.click(cta());
    await userEvent.click(await screen.findByRole("button", { name: "Send in wallet" }));
    await waitFor(() => expect(screen.getByLabelText("Send progress")).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    expect(screen.queryByRole("region", { name: "Review" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Send progress")).not.toBeInTheDocument();
    expect(cta()).toHaveTextContent("Review");
  });
});

describe("the step runner", () => {
  const states: StepState[] = [
    { label: "a", status: "queued" },
    { label: "b", status: "wallet" },
    { label: "c", status: "pending", hash: HASH },
    { label: "d", status: "confirmed", hash: HASH, block: 7n },
    { label: "e", status: "reverted", hash: HASH, block: 8n },
    { label: "f", status: "slow", hash: HASH },
    { label: "g", status: "failed", why: "because" },
  ];

  it("says what is happening to every step, in words", () => {
    render(<TxStepList states={states} label="Progress" />);
    const list = screen.getByLabelText("Progress");
    for (const text of [
      "next",
      "waiting for your wallet",
      "sent, waiting for Base to include it",
      "confirmed in block 7",
      "reverted in block 8 — nothing moved except the gas fee",
      "still pending after the wait — NOT failed",
      "because",
    ]) {
      expect(list).toHaveTextContent(text);
    }
    expect(within(list).getAllByRole("link")).toHaveLength(4);
  });

  it("renders nothing before anything has run", () => {
    const { container } = render(<TxStepList states={[]} label="Progress" />);
    expect(container).toBeEmptyDOMElement();
  });

  function Harness({ receipt, steps }: { receipt: "revert" | "never"; steps: number }) {
    const runner = useTxSteps({ every: 1, within: 0, sleep: async () => {} });
    return (
      <>
        <button
          onClick={() => {
            const provider = (globalThis as unknown as { ethereum: Eip1193Provider }).ethereum;
            void runner.run(
              provider,
              ME,
              Array.from({ length: steps }, (_, i) => ({ label: `step ${i + 1}`, build: async () => ({ to: THEM }) })),
            );
          }}
        >
          go
        </button>
        <span data-testid="running">{String(runner.running)}</span>
        <TxStepList states={runner.states} label={receipt} />
      </>
    );
  }

  it("stops at a reverted step and never asks for the next", async () => {
    const sent = injected();
    chain({ receipt: { status: "0x0", blockNumber: "0x9" } });
    render(<Harness receipt="revert" steps={2} />);
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => expect(screen.getByLabelText("revert")).toHaveTextContent("reverted in block 9"));
    expect(screen.getByLabelText("revert")).toHaveTextContent("next");
    expect(sent).toHaveLength(1);
    expect(screen.getByTestId("running")).toHaveTextContent("false");
  });

  it("reports a step with no receipt as slow, not failed", async () => {
    injected();
    net({ rpc: (m, p) => simulated()(m, p) ?? (m === "eth_getTransactionReceipt" ? null : m === "eth_accounts" ? [ME] : undefined) });
    render(<Harness receipt="never" steps={1} />);
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => expect(screen.getByLabelText("never")).toHaveTextContent("still pending after the wait — NOT failed"));
  });
});
