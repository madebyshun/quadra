import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PoolTrade, SLIPPAGE_BPS } from "@/features/panels/PoolTrade";
import type { LaunchPool } from "@/lib/v4swap";
import { settle } from "./helpers";

/**
 * Trading a launchpad coin against its own pool. `lib/v4swap.ts` (quotes, steps) and the signing path
 * are tested on their own; they are mocked at the module boundary here to drive the window's states.
 */
const poolKeyOf = vi.fn();
const quoteV4 = vi.fn();
const swapSteps = vi.fn();
const minOutFor = vi.fn((q: bigint, bps: number) => (q * BigInt(10_000 - bps)) / 10_000n);
vi.mock("@/lib/v4swap", async (orig) => ({
  ...(await orig<typeof import("@/lib/v4swap")>()),
  poolKeyOf: (t: string) => poolKeyOf(t),
  quoteV4: (...a: unknown[]) => quoteV4(...a),
  swapSteps: (p: unknown) => swapSteps(p),
  minOutFor: (q: bigint, b: number) => minOutFor(q, b),
}));
const chainToken = vi.fn();
vi.mock("@/skills/chaintoken", () => ({ chainToken: (a: string) => chainToken(a) }));
const mockBalanceOf = vi.fn<(...args: unknown[]) => Promise<bigint>>(async () => 0n);
vi.mock("@/lib/erc20", async (orig) => ({
  ...(await orig<typeof import("@/lib/erc20")>()),
  balanceOf: (...a: unknown[]) => mockBalanceOf(...a),
}));
const sendTransaction = vi.fn();
const waitForReceipt = vi.fn();
vi.mock("@/lib/transact", () => ({ sendTransaction: (...a: unknown[]) => sendTransaction(...a), waitForReceipt: (...a: unknown[]) => waitForReceipt(...a) }));
const provider = { request: vi.fn() };
let session: { wallet: unknown; signingProvider: () => unknown } = { wallet: null, signingProvider: () => provider };
vi.mock("@/ui/WalletProvider", () => ({ useWalletSession: () => session }));

const ME = "0x00fd290000000000000000000000000000000001";
const TOKEN = "0xb200000000000000000000000000000000000abc";
const STOCK = "0xb2000000000000000000000000000000000000aa";
const ETH = "0x0000000000000000000000000000000000000000";
const key = { currency0: ETH, currency1: TOKEN, fee: 10_000, tickSpacing: 200, hooks: ETH };
const ethPool: LaunchPool = { factory: "0xef1f", key, token: TOKEN, quote: ETH, tokenIs0: false };
const amount = () => screen.getByRole("textbox");
const cta = () => screen.getAllByRole("button").find((b) => b.classList.contains("mf__cta"))!;

beforeEach(() => {
  vi.clearAllMocks();
  session = { wallet: { kind: "ready", account: ME }, signingProvider: () => provider };
});

describe("PoolTrade", () => {
  it("reads the pool, quotes a buy, and trades it; success clears the review", async () => {
    poolKeyOf.mockResolvedValue(ethPool);
    quoteV4.mockResolvedValue({ amountOut: 10n ** 24n, gasEstimate: 1n });
    swapSteps.mockResolvedValue([{ to: "0xrouter", data: "0x01", value: 10n ** 16n, what: "Buy TEST" }]);
    sendTransaction.mockResolvedValue("0xaa");
    waitForReceipt.mockResolvedValue({ status: "success", block: 9n, logs: [] });
    render(<PoolTrade token={TOKEN} symbol="TEST" side="buy" />);
    expect(screen.getByText("Reading TEST's pool…")).toBeInTheDocument();
    await settle();
    expect(screen.getByText(/You pay \(ETH\)/)).toBeInTheDocument();
    expect(cta()).toBeDisabled();
    fireEvent.change(amount(), { target: { value: "0.01" } });
    let resolve!: (v: unknown) => void;
    quoteV4.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    fireEvent.click(cta());
    await settle();
    expect(screen.getByText("Asking Uniswap's Quoter…")).toBeInTheDocument();
    expect(cta()).toBeDisabled();
    resolve({ amountOut: 10n ** 24n, gasEstimate: 1n });
    await settle();
    expect(quoteV4).toHaveBeenCalledWith(key, true, 10n ** 16n);
    expect(minOutFor).toHaveBeenCalledWith(10n ** 24n, SLIPPAGE_BPS);
    expect(screen.getByText(/You get ≈/).textContent).toMatch(/1,000,000 TEST — at least 990,000/);
    fireEvent.click(screen.getByRole("button", { name: "Buy — sign in your wallet" }));
    await settle();
    await settle();
    expect(swapSteps).toHaveBeenCalledWith(expect.objectContaining({ from: ME, amountIn: 10n ** 16n, zeroForOne: true, asset: { symbol: "ETH", decimals: 18 } }));
    expect(sendTransaction).toHaveBeenCalledWith(provider, ME, { to: "0xrouter", data: "0x01", value: 10n ** 16n });
    expect(screen.getByText(/confirmed in block 9/)).toBeInTheDocument();
    expect(amount()).toHaveValue("");
    expect(screen.queryByText(/You get ≈/)).toBeNull();
  });

  it("a stock-paired BUY offers paying with ETH as well as the stock, and back (2026-10-29)", async () => {
    poolKeyOf.mockResolvedValue({ ...ethPool, quote: STOCK, key: { ...key, currency0: STOCK }, tokenIs0: true });
    chainToken.mockResolvedValue({ symbol: "AAPLc", decimals: 8 });
    render(<PoolTrade token={TOKEN} symbol="TEST" side="buy" />);
    await settle();
    expect(screen.getByRole("button", { name: "Pay with AAPLc" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/You pay \(AAPLc\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pay with ETH" }));
    expect(screen.getByLabelText("Amount of ETH")).toBeInTheDocument();
    expect(screen.getByText(/only for eligible persons outside the U\.S\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pay with AAPLc" }));
    expect(screen.getByText(/You pay \(AAPLc\)/)).toBeInTheDocument();
  });

  it("an ETH-paired buy has no choice to make", async () => {
    poolKeyOf.mockResolvedValue(ethPool);
    render(<PoolTrade token={TOKEN} symbol="TEST" side="buy" />);
    await settle();
    expect(screen.queryByRole("group", { name: "Pay with" })).toBeNull();
  });

  it("a stock-paired sell: the quote's symbol read from the chain; a failed trade keeps the review; an edit drops it", async () => {
    poolKeyOf.mockResolvedValue({ ...ethPool, quote: STOCK, key: { ...key, currency0: STOCK }, tokenIs0: true });
    chainToken.mockResolvedValue({ symbol: "AAPLc", decimals: 8 });
    quoteV4.mockResolvedValue({ amountOut: 5n * 10n ** 7n, gasEstimate: 1n });
    swapSteps.mockResolvedValue([{ to: "0xrouter", data: "0x02", value: 0n, what: "Sell" }]);
    sendTransaction.mockRejectedValue(new Error("User rejected"));
    render(<PoolTrade token={TOKEN} symbol="TEST" side="sell" />);
    await settle();
    expect(screen.getByText(/You sell \(TEST\)/)).toBeInTheDocument();
    fireEvent.change(amount(), { target: { value: "100" } });
    fireEvent.click(cta());
    await settle();
    expect(screen.getByText(/You get ≈/).textContent).toMatch(/0\.5 AAPLc/);
    fireEvent.click(screen.getByRole("button", { name: "Sell — sign in your wallet" }));
    await settle();
    expect(screen.getByText("User rejected")).toBeInTheDocument();
    expect(screen.getByText(/You get ≈/)).toBeInTheDocument();
    fireEvent.change(amount(), { target: { value: "101" } });
    expect(screen.queryByText(/You get ≈/)).toBeNull();
    expect(cta()).toHaveTextContent("Review");
  });

  it("refuses a bad amount and says when the quote fails", async () => {
    poolKeyOf.mockResolvedValue(ethPool);
    quoteV4.mockRejectedValue(new Error("Quoter reverted"));
    render(<PoolTrade token={TOKEN} symbol="TEST" side="buy" />);
    await settle();
    fireEvent.change(amount(), { target: { value: "abc" } });
    fireEvent.click(cta());
    await settle();
    expect(document.querySelector(".tx__warn")).not.toBeNull();
    fireEvent.change(amount(), { target: { value: "1" } });
    fireEvent.click(cta());
    await settle();
    expect(screen.getByText("Quoter reverted")).toBeInTheDocument();
  });

  it("opens wallet connect directly when no wallet is connected, or opens wallet window on desktop, and disables while busy", async () => {
    const connectInjected = vi.fn();
    session = { wallet: { kind: "disconnected", why: "" }, signingProvider: () => provider, connectInjected, busy: false } as unknown as typeof session;
    poolKeyOf.mockResolvedValue(ethPool);
    const a = render(<PoolTrade token={TOKEN} symbol="TEST" side="buy" />);
    await settle();
    expect(cta()).toHaveTextContent("Connect wallet");
    expect(cta()).toBeEnabled();
    fireEvent.click(cta());
    expect(connectInjected).toHaveBeenCalledTimes(1);
    a.unmount();

    const open = vi.fn();
    const { OpenWindowProvider } = await import("@/features/openWindow");
    const b = render(
      <OpenWindowProvider open={open}>
        <PoolTrade token={TOKEN} symbol="TEST" side="buy" />
      </OpenWindowProvider>,
    );
    await settle();
    fireEvent.click(cta());
    expect(open).toHaveBeenCalledWith("wallet");
    b.unmount();

    session = { wallet: { kind: "disconnected", why: "" }, signingProvider: () => provider, connectInjected, busy: true } as unknown as typeof session;
    render(<PoolTrade token={TOKEN} symbol="TEST" side="buy" />);
    await settle();
    expect(cta()).toHaveTextContent("Connecting…");
    expect(cta()).toBeDisabled();
  });

  it("says when the coin has no pool here, or the pool could not be read", async () => {
    poolKeyOf.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("rpc down"));
    const a = render(<PoolTrade token={TOKEN} symbol="TEST" side="buy" />);
    await settle();
    expect(screen.getByText("TEST has no pool on this launchpad.")).toBeInTheDocument();
    a.unmount();
    render(<PoolTrade token={TOKEN} symbol="TEST" side="buy" />);
    await settle();
    expect(screen.getByText("The pool could not be read: rpc down")).toBeInTheDocument();
  });

  it("supports quick amount presets and inline max slippage selection", async () => {
    poolKeyOf.mockResolvedValue(ethPool);
    quoteV4.mockResolvedValue({ amountOut: 10n ** 24n, gasEstimate: 1n });
    render(<PoolTrade token={TOKEN} symbol="TEST" side="buy" />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "0.05 ETH" }));
    expect(amount()).toHaveValue("0.05");
    fireEvent.click(screen.getByRole("button", { name: "5%" }));
    expect(screen.getByRole("button", { name: "5%" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(cta());
    await settle();
    expect(minOutFor).toHaveBeenCalledWith(10n ** 24n, 500);
    expect(screen.getByText(/5% slippage/)).toBeInTheDocument();
  });

  it("drops a pool answer that lands after it was closed", async () => {
    for (const answer of [() => Promise.resolve(null), () => Promise.reject(new Error("late")), () => Promise.resolve(ethPool)]) {
      poolKeyOf.mockImplementationOnce(answer);
      render(<PoolTrade token={TOKEN} symbol="TEST" side="buy" />).unmount();
      await settle();
    }
  });

  it("fills quick sell percentage presets (25% and 100%) from the wallet's token balance", async () => {
    mockBalanceOf.mockResolvedValueOnce(1000n * 10n ** 18n);
    render(<PoolTrade token={TOKEN} symbol="TEST" side="sell" />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "25%" }));
    expect(screen.getByLabelText("Amount of TEST")).toHaveValue("250");
    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    expect(screen.getByLabelText("Amount of TEST")).toHaveValue("1000");
    mockBalanceOf.mockRejectedValueOnce(new Error("rpc"));
    render(<PoolTrade token={TOKEN} symbol="TEST" side="sell" />);
    await settle();
  });

  it("shows stablecoin presets when buying with USDC", async () => {
    poolKeyOf.mockResolvedValue({ ...ethPool, quote: STOCK, key: { ...key, currency0: STOCK }, tokenIs0: true });
    chainToken.mockResolvedValue({ symbol: "USDC", decimals: 6 });
    render(<PoolTrade token={TOKEN} symbol="TEST" side="buy" />);
    await settle();
    expect(screen.getByRole("button", { name: "10 USDC" })).toBeInTheDocument();
  });
});
