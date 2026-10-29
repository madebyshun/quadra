import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PoolTradeEth, QUOTE_TTL_MS, STOCK_SLIPPAGE_BPS } from "@/features/panels/PoolTradeEth";
import type { LaunchPool } from "@/lib/v4swap";
import { settle } from "./helpers";

/**
 * Buying a stock-paired coin with plain ETH: Relay's leg (ETH → the stock), then the pool's leg with
 * exactly what arrived. Relay, the pool and the signing path are tested on their own; they are
 * mocked at the module boundary here to drive the window through each outcome.
 */
const quoteSwap = vi.fn();
vi.mock("@/adapters/http/relay", () => ({ quoteSwap: (...a: unknown[]) => quoteSwap(...a) }));
const quoteV4 = vi.fn();
const swapSteps = vi.fn();
vi.mock("@/lib/v4swap", async (orig) => ({
  ...(await orig<typeof import("@/lib/v4swap")>()),
  quoteV4: (...a: unknown[]) => quoteV4(...a),
  swapSteps: (p: unknown) => swapSteps(p),
}));
const sendTransaction = vi.fn();
const waitForReceipt = vi.fn();
const tokenReceived = vi.fn();
vi.mock("@/lib/transact", () => ({
  sendTransaction: (...a: unknown[]) => sendTransaction(...a),
  waitForReceipt: (...a: unknown[]) => waitForReceipt(...a),
  tokenReceived: (...a: unknown[]) => tokenReceived(...a),
}));
const provider = { request: vi.fn() };
let session: { wallet: unknown; signingProvider: () => unknown } = { wallet: null, signingProvider: () => provider };
vi.mock("@/ui/WalletProvider", () => ({ useWalletSession: () => session }));

const ME = "0x00fd290000000000000000000000000000000001";
const TOKEN = "0xb200000000000000000000000000000000000abc";
const AAPL = "0xb200000000000000000000C2e324d24d7eEcd1fb";
const key = { currency0: TOKEN, currency1: AAPL, fee: 0x800000, tickSpacing: 200, hooks: "0x0D9DdcC907658E3C61318d0F979F978e600AA880" };
const pool: LaunchPool & { quoteSymbol: string; quoteDecimals: number } = { factory: "0x006d", key, token: TOKEN, quote: AAPL, tokenIs0: true, quoteSymbol: "AAPLc", quoteDecimals: 8 };
const relay = { steps: [{ label: "Swap", tx: { to: "0xrelay", data: "0x01", value: 10n ** 16n } }], out: 7_000_000n, min: 6_930_000n, impact: "-0.1", feeOn: true };
const ok = { status: "success", block: 9n, logs: [] };
const cta = () => screen.getAllByRole("button").find((b) => b.classList.contains("mf__cta"))!;
const type = (v: string) => fireEvent.change(screen.getByLabelText("Amount of ETH"), { target: { value: v } });

let clock = 1_000_000;
const now = () => clock;

beforeEach(() => {
  vi.clearAllMocks();
  clock = 1_000_000;
  session = { wallet: { kind: "ready", account: ME }, signingProvider: () => provider };
  quoteSwap.mockResolvedValue(relay);
  quoteV4.mockResolvedValue({ amountOut: 5n * 10n ** 24n, gasEstimate: 1n });
  swapSteps.mockResolvedValue([{ to: "0xrouter", data: "0x02", value: 0n, what: "swap through the launchpad pool on Uniswap v4" }]);
  sendTransaction.mockResolvedValue("0xaa");
  waitForReceipt.mockResolvedValue(ok);
  tokenReceived.mockReturnValue(6_950_000n);
});

async function reviewed(v = "0.01") {
  render(<PoolTradeEth pool={pool} symbol="TEST" now={now} />);
  type(v);
  fireEvent.click(cta());
  await settle();
}

describe("buying a stock-paired coin with ETH", () => {
  it("quotes both legs — the coin for the LEAST the stock leg may deliver — then signs them in order", async () => {
    await reviewed();
    expect(quoteSwap).toHaveBeenCalledWith({ user: ME, sell: expect.objectContaining({ kind: "native" }), buy: expect.objectContaining({ address: AAPL, decimals: 8 }), amount: 10n ** 16n, slippageBps: STOCK_SLIPPAGE_BPS });
    expect(quoteV4).toHaveBeenCalledWith(key, false, relay.min);
    expect(screen.getByText(/0\.07 AAPLc/)).toBeInTheDocument();
    expect(cta()).toHaveTextContent("Buy — two signatures in your wallet");
    fireEvent.click(cta());
    await settle();
    // leg two is quoted again with what really arrived, and spends exactly that
    expect(tokenReceived).toHaveBeenCalledWith(ok, AAPL, ME);
    expect(quoteV4).toHaveBeenLastCalledWith(key, false, 6_950_000n);
    expect(swapSteps).toHaveBeenCalledWith(expect.objectContaining({ amountIn: 6_950_000n, from: ME, asset: { symbol: "AAPLc", decimals: 8 } }));
    expect(sendTransaction).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("Bought TEST with 0.0695 AAPLc.");
    expect(screen.getByLabelText("Amount of ETH")).toHaveValue("");
  });

  it("asks for a wallet, and says why an amount or a quote is refused", async () => {
    session = { wallet: null, signingProvider: () => provider };
    const a = render(<PoolTradeEth pool={pool} symbol="TEST" />);
    expect(cta()).toHaveTextContent("Connect a wallet first");
    expect(cta()).toBeDisabled();
    a.unmount();
    session = { wallet: { kind: "ready", account: ME }, signingProvider: () => provider };
    await reviewed("lots");
    expect(document.querySelector(".tx__warn")).not.toBeNull();
    expect(quoteSwap).not.toHaveBeenCalled();
    let resolve!: (v: unknown) => void;
    quoteSwap.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    type("0.01");
    fireEvent.click(cta());
    expect(screen.getByText(/Asking Relay for AAPLc/)).toBeInTheDocument();
    resolve(relay);
    await settle();
    quoteSwap.mockRejectedValueOnce(new Error("This build will not sign Relay's quote: no. Nothing was sent."));
    type("0.02");
    fireEvent.click(cta());
    await settle();
    expect(screen.getByText(/will not sign Relay's quote/)).toBeInTheDocument();
  });

  it("refuses a quote older than a minute, and sends nothing", async () => {
    await reviewed();
    clock += QUOTE_TTL_MS + 1;
    fireEvent.click(cta());
    await settle();
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("more than a minute old");
  });

  it("stops after leg one when it is rejected, or when no stock can be seen arriving", async () => {
    sendTransaction.mockRejectedValueOnce(new Error("User rejected"));
    await reviewed();
    fireEvent.click(cta());
    await settle();
    expect(swapSteps).not.toHaveBeenCalled();
    fireEvent.click(cta());
    tokenReceived.mockReturnValueOnce(0n);
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("no AAPLc arriving at your wallet could be read");
    expect(swapSteps).not.toHaveBeenCalled();
  });

  it("keeps the stock and says so when leg two cannot be prepared or is not signed", async () => {
    swapSteps.mockRejectedValueOnce(new Error("allowance unreadable"));
    await reviewed();
    fireEvent.click(cta());
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("You now hold 0.0695 AAPLc; buying TEST with it could not be prepared: allowance unreadable");
    sendTransaction.mockResolvedValueOnce("0xaa").mockRejectedValueOnce(new Error("User rejected"));
    fireEvent.click(cta());
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent('The AAPLc stays in your wallet — buy TEST with it from the "Pay with AAPLc" tab.');
  });

  it("keeps time from the clock by default", async () => {
    render(<PoolTradeEth pool={pool} symbol="TEST" />);
    type("0.01");
    fireEvent.click(cta());
    await settle();
    fireEvent.click(cta());
    await settle();
    expect(sendTransaction).toHaveBeenCalledTimes(2);
  });
});
