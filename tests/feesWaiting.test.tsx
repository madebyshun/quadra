import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FeesWaiting } from "@/features/panels/FeesWaiting";
import { forgetTips, onTip, type Tip } from "@/lib/assistant";
import type { Owed } from "@/skills/owed";
import { settle } from "./helpers";

/**
 * The Wallet window's "Your fees". The chain reads (`readCoins`, `owedTo`) and the signing path
 * (`sendTransaction`, `waitForReceipt`) are mocked at their module boundaries — those modules are
 * tested on real captures elsewhere; here it is the window's states.
 */
const readCoins = vi.fn();
vi.mock("@/features/panels/ProfilePanel", () => ({ readCoins: (a: string) => readCoins(a) }));
const owedTo = vi.fn();
vi.mock("@/skills/owed", () => ({ owedTo: (a: string, q: string[]) => owedTo(a, q) }));
const collectTx = vi.fn((factory: string, token: string) => ({ to: factory, data: `0xc0${token.slice(2, 6)}` }));
vi.mock("@/adapters/http/launchpad", () => ({ collectTx: (f: string, t: string) => collectTx(f, t) }));
const sendTransaction = vi.fn();
const waitForReceipt = vi.fn();
vi.mock("@/lib/transact", () => ({
  sendTransaction: (...a: unknown[]) => sendTransaction(...a),
  waitForReceipt: (...a: unknown[]) => waitForReceipt(...a),
}));
const provider = { request: vi.fn() };
vi.mock("@/ui/WalletProvider", () => ({ useWalletSession: () => ({ signingProvider: () => provider }) }));

const ME = "0x00fd290000000000000000000000000000000001";
const ETH = "0x0000000000000000000000000000000000000000";
const STOCK = "0xb200000000000000000000000000000000000001";
const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const mine = (n: number, fees: { inQuote: bigint; inToken: bigint } | null, name: string | null = `Coin ${n} (C${n})`, withValue = true) => ({
  factory: A(900),
  token: A(n),
  creator: ME,
  block: n,
  at: null,
  tx: "0x",
  name,
  value: withValue ? { quote: ETH, quoteSymbol: "ETH", quoteDecimals: 18 } : null,
  fees: fees ? { quote: ETH, ...fees } : null,
});
const coins = (m: unknown[]) => ({ launches: [], all: new Set(), mine: m, complete: true });
const receipt = { status: "success", block: 10n, logs: [] };

beforeEach(() => {
  vi.clearAllMocks();
  forgetTips();
});

describe("FeesWaiting", () => {
  it("reads, then says there are no coins yet", async () => {
    readCoins.mockResolvedValue(coins([]));
    owedTo.mockResolvedValue([]);
    render(<FeesWaiting account={ME} />);
    expect(screen.getByText("Reading the fees waiting for you…")).toBeInTheDocument();
    await settle();
    expect(screen.getByText(/You have not launched a coin here yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says when the fees could not be read", async () => {
    readCoins.mockRejectedValue(new Error("blockscout down"));
    render(<FeesWaiting account={ME} />);
    await settle();
    expect(screen.getByText("Could not read your fees: blockscout down")).toBeInTheDocument();
  });

  it("coins with no fees: a disabled button, and an unreadable owed list is 'not checked'", async () => {
    readCoins.mockResolvedValue(coins([mine(1, { inQuote: 0n, inToken: 0n }), mine(2, null, null, false)]));
    owedTo.mockRejectedValue(new Error("x"));
    render(<FeesWaiting account={ME} />);
    await settle();
    expect(screen.getByRole("button", { name: "No fees waiting" })).toBeDisabled();
    expect(screen.getByText("no fees waiting")).toBeInTheDocument();
    expect(screen.getByText("fees could not be read")).toBeInTheDocument();
    expect(screen.getByText(/Not checked — whether a launchpad owes you/)).toBeInTheDocument();
    expect(owedTo).toHaveBeenCalledWith(ME, [ETH]);
  });

  it("claims every coin's fees in order, re-reads after, and Q raises the tip once", async () => {
    const tips: Tip[] = [];
    const off = onTip((t) => tips.push(t));
    readCoins.mockResolvedValue(coins([mine(1, { inQuote: 5n, inToken: 0n }), mine(2, { inQuote: 0n, inToken: 7n }, null)]));
    owedTo.mockResolvedValue([]);
    sendTransaction.mockResolvedValueOnce("0xaa").mockResolvedValueOnce("0xbb");
    waitForReceipt.mockResolvedValue(receipt);
    render(<FeesWaiting account={ME} />);
    await settle();
    expect(tips.map((t) => t.text)).toEqual([expect.stringMatching(/fees waiting on 2 coins/)]);
    fireEvent.click(screen.getByRole("button", { name: "Claim all — 2 coins" }));
    await settle();
    await settle();
    expect(collectTx).toHaveBeenCalledWith(A(900), A(1));
    expect(sendTransaction).toHaveBeenCalledTimes(2);
    expect(sendTransaction.mock.calls[0]![0]).toBe(provider);
    expect(screen.getByText(/Collect the fees of Coin 1/)).toBeInTheDocument();
    expect(readCoins).toHaveBeenCalledTimes(2);
    expect(tips).toHaveLength(1);
    off();
  });

  it("one coin: singular wording; a failed claim does not re-read", async () => {
    const tips: Tip[] = [];
    const off = onTip((t) => tips.push(t));
    readCoins.mockResolvedValue(coins([mine(1, { inQuote: 5n, inToken: 0n })]));
    owedTo.mockResolvedValue([]);
    sendTransaction.mockRejectedValue(new Error("User rejected"));
    render(<FeesWaiting account={ME} />);
    await settle();
    expect(tips[0]!.text).toMatch(/on 1 coin you launched/);
    fireEvent.click(screen.getByRole("button", { name: "Claim all — 1 coin" }));
    await settle();
    expect(screen.getByText("User rejected")).toBeInTheDocument();
    expect(readCoins).toHaveBeenCalledTimes(1);
    off();
  });

  it("lists what a launchpad owes and withdraws it", async () => {
    const owed: Owed[] = [
      { factory: A(900), currency: ETH, amount: 10n ** 15n, tx: { to: A(900), data: "0x01" } },
      { factory: A(901), currency: STOCK, amount: 2n * 10n ** 8n, tx: { to: A(901), data: "0x02" } },
    ];
    readCoins.mockResolvedValue(coins([]));
    owedTo.mockResolvedValue(owed);
    sendTransaction.mockResolvedValue("0xcc");
    waitForReceipt.mockResolvedValueOnce(receipt).mockResolvedValueOnce({ ...receipt, status: "reverted" });
    render(<FeesWaiting account={ME} />);
    await settle();
    expect(screen.getByText(/owes you 0\.001 ETH/)).toBeInTheDocument();
    expect(screen.getByText(/owes you 2 0xb200/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Withdraw" })[0]!);
    await settle();
    await settle();
    expect(sendTransaction.mock.calls[0]![2]).toEqual(owed[0]!.tx);
    expect(readCoins).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Withdraw" })[1]!);
    await settle();
    expect(readCoins).toHaveBeenCalledTimes(2);
  });

  it("drops an answer that lands after it was unmounted", async () => {
    let fail!: (e: Error) => void;
    readCoins.mockReturnValueOnce(new Promise((_, r) => (fail = r)));
    const { unmount } = render(<FeesWaiting account={ME} />);
    unmount();
    fail(new Error("late"));
    await settle();
    let ok!: (v: unknown) => void;
    readCoins.mockReturnValueOnce(new Promise((r) => (ok = r)));
    owedTo.mockResolvedValue([]);
    const second = render(<FeesWaiting account={ME} />);
    second.unmount();
    ok(coins([]));
    await settle();
  });
});
