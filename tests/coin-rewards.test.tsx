import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { decodeFunctionData } from "viem";
import { CoinRewards } from "@/features/panels/CoinRewards";
import { FURNACE_ABI } from "@/lib/furnace";
import { settle } from "./helpers";

/**
 * Where a coin's 80% goes, on its page: stake into a RevenueShare, or — for the current recipient —
 * send it to another wallet, or hand it for good to a share. The reads and the signing path are tested
 * on their own (revenue-share.test.ts, TxSteps); they are mocked at the module boundary here.
 */
const shareOf = vi.fn();
const stakerOf = vi.fn();
const predictShare = vi.fn();
const deployer = vi.fn<() => string | null>(() => null);
const hasCode = vi.fn();
vi.mock("@/lib/revenueShare", async (orig) => ({
  ...(await orig<typeof import("@/lib/revenueShare")>()),
  shareOf: (...a: unknown[]) => shareOf(...a),
  stakerOf: (...a: unknown[]) => stakerOf(...a),
  predictShare: (...a: unknown[]) => predictShare(...a),
  deployer: () => deployer(),
  hasCode: (a: string) => hasCode(a),
}));
const poolKeyOf = vi.fn();
const quoteV4 = vi.fn();
vi.mock("@/lib/v4swap", async (orig) => ({
  ...(await orig<typeof import("@/lib/v4swap")>()),
  poolKeyOf: (t: string) => poolKeyOf(t),
  quoteV4: (...a: unknown[]) => quoteV4(...a),
}));
const furnaceOf = vi.fn();
vi.mock("@/lib/furnace", async (orig) => ({ ...(await orig<typeof import("@/lib/furnace")>()), furnaceOf: (...a: unknown[]) => furnaceOf(...a) }));
const chainToken = vi.fn();
vi.mock("@/skills/chaintoken", () => ({ chainToken: (a: string) => chainToken(a) }));
const allowance = vi.fn();
vi.mock("@/lib/erc20", async (orig) => ({ ...(await orig<typeof import("@/lib/erc20")>()), allowance: (...a: unknown[]) => allowance(...a) }));
const sendTransaction = vi.fn();
const waitForReceipt = vi.fn();
vi.mock("@/lib/transact", () => ({ sendTransaction: (...a: unknown[]) => sendTransaction(...a), waitForReceipt: (...a: unknown[]) => waitForReceipt(...a) }));
const provider = { request: vi.fn() };
let session: { wallet: unknown; signingProvider: () => unknown };
vi.mock("@/ui/WalletProvider", () => ({ useWalletSession: () => session }));

const ME = "0x00fd29b7000000000000000000000000000746ff";
const COIN = "0xb200000000000000000000694E3F5A4AB150b283";
const AAPL = "0xb200000000000000000000C2e324d24d7eEcd1fb";
const FACTORY = "0x006Da367654a487bb277fe25ff54f0fE0f741377";
const SHARE = "0x5157000000000000000000000000000000000Abc";
const AGENT = "0x884FBdd5cF193E7F87CBA76419e526D8F4dF7A9B";
const DEPLOYER = "0x5157000000000000000000000000000000000dEF";
const ETH = "0x0000000000000000000000000000000000000000";
const recordTo = (recipient: string) => ({ factory: FACTORY, creator: ME, creatorRecipient: recipient });
const share = { address: SHARE, agent: AGENT, agentBps: 500, totalStaked: 3n * 10n ** 18n };
const button = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
  session = { wallet: { kind: "ready", account: ME }, signingProvider: () => provider };
  shareOf.mockResolvedValue(null);
  poolKeyOf.mockResolvedValue({ key: { currency0: ETH, currency1: COIN } });
  stakerOf.mockResolvedValue({ staked: 10n ** 18n, claimable: [2n * 10n ** 15n, 5n * 10n ** 17n] });
  allowance.mockResolvedValue(0n);
  sendTransaction.mockResolvedValue("0xaa");
  waitForReceipt.mockResolvedValue({ status: "success", block: 9n, logs: [] });
  deployer.mockReturnValue(null);
  hasCode.mockResolvedValue(false);
  furnaceOf.mockResolvedValue(null);
});

describe("where the 80% goes", () => {
  it("says who receives it, and that it is your wallet when it is", async () => {
    session = { wallet: null, signingProvider: () => provider };
    const a = render(<CoinRewards token={COIN} symbol="TEST" record={recordTo(AGENT)} />);
    expect(screen.getByText("Reading where TEST's fees go…")).toBeInTheDocument();
    await settle();
    expect(screen.getByText(/creator's 80%/)).toHaveTextContent("0x884F…7A9B.");
    a.unmount();
    session = { wallet: { kind: "ready", account: ME }, signingProvider: () => provider };
    render(<CoinRewards token={COIN} symbol="TEST" record={recordTo(ME)} />);
    await settle();
    expect(screen.getByText(/creator's 80%/)).toHaveTextContent("— your wallet.");
  });

  it("says it could not be read", async () => {
    shareOf.mockRejectedValue(new Error("RPC down"));
    render(<CoinRewards token={COIN} symbol="TEST" record={recordTo(ME)} />);
    await settle();
    expect(screen.getByText("Where the fees go was not checked — RPC down")).toBeInTheDocument();
  });

  it("lets the recipient send it to another wallet — refusing a malformed one", async () => {
    render(<CoinRewards token={COIN} symbol="TEST" record={recordTo(ME)} />);
    await settle();
    fireEvent.change(screen.getByLabelText("New fee recipient"), { target: { value: "0x123" } });
    fireEvent.click(button("Send the 80% there"));
    await settle();
    expect(document.querySelector(".tx__warn")).toHaveTextContent(/New recipient:/);
    fireEvent.change(screen.getByLabelText("New fee recipient"), { target: { value: AGENT } });
    fireEvent.click(button("Send the 80% there"));
    await settle();
    expect(sendTransaction).toHaveBeenCalledWith(provider, ME, expect.objectContaining({ to: FACTORY }));
    // read again afterwards
    expect(shareOf).toHaveBeenCalledTimes(2);
  });

  it("waits on the deployer before offering to share with stakers", async () => {
    render(<CoinRewards token={COIN} symbol="TEST" record={recordTo(ME)} />);
    await settle();
    expect(screen.getByText(/deployer is not deployed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share with stakers" })).toBeNull();
  });

  it("hands it to a share for good — only once ticked, and only with a valid agent and cut", async () => {
    deployer.mockReturnValue(DEPLOYER);
    predictShare.mockResolvedValue(SHARE);
    render(<CoinRewards token={COIN} symbol="TEST" record={recordTo(ME)} />);
    await settle();
    expect(button("Share with stakers")).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    const cut = screen.getByLabelText("Agent share in basis points");
    fireEvent.change(cut, { target: { value: "500" } });
    fireEvent.click(button("Share with stakers"));
    await settle();
    expect(screen.getByText("Name the agent that takes the share, or set it to 0.")).toBeInTheDocument();
    fireEvent.change(cut, { target: { value: "9500" } });
    fireEvent.click(button("Share with stakers"));
    await settle();
    expect(screen.getByText(/from 0 to 9000/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Agent wallet"), { target: { value: "0xnope" } });
    fireEvent.click(button("Share with stakers"));
    await settle();
    expect(document.querySelector(".tx__warn")).toHaveTextContent(/Agent:/);
    fireEvent.change(screen.getByLabelText("Agent wallet"), { target: { value: AGENT } });
    fireEvent.change(cut, { target: { value: "500" } });
    predictShare.mockRejectedValueOnce(new Error("deployer unreadable"));
    fireEvent.click(button("Share with stakers"));
    await settle();
    expect(screen.getByText("deployer unreadable")).toBeInTheDocument();
    fireEvent.click(button("Share with stakers"));
    await settle();
    expect(predictShare).toHaveBeenLastCalledWith(DEPLOYER, COIN, AGENT, 500);
    expect(sendTransaction.mock.calls.map((c) => (c[2] as { to: string }).to)).toEqual([DEPLOYER, FACTORY]);
  });

  it("uses a share that is already there instead of creating it again — create would revert", async () => {
    deployer.mockReturnValue(DEPLOYER);
    predictShare.mockResolvedValue(SHARE);
    hasCode.mockResolvedValue(true);
    render(<CoinRewards token={COIN} symbol="TEST" record={recordTo(ME)} />);
    await settle();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(button("Share with stakers"));
    await settle();
    expect(hasCode).toHaveBeenCalledWith(SHARE);
    expect(sendTransaction.mock.calls.map((c) => (c[2] as { to: string }).to)).toEqual([FACTORY]);
  });

  it("shares with no agent at all", async () => {
    deployer.mockReturnValue(DEPLOYER);
    predictShare.mockResolvedValue(SHARE);
    sendTransaction.mockRejectedValue(new Error("User rejected"));
    render(<CoinRewards token={COIN} symbol="TEST" record={recordTo(ME)} />);
    await settle();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(button("Share with stakers"));
    await settle();
    expect(predictShare).toHaveBeenCalledWith(DEPLOYER, COIN, null, 0);
    expect(shareOf).toHaveBeenCalledTimes(1);
  });
});

describe("staking into a coin's share", () => {
  it("shows the share, your stake and what you can claim in both currencies — a stock read from the chain", async () => {
    shareOf.mockResolvedValue(share);
    poolKeyOf.mockResolvedValue({ key: { currency0: COIN, currency1: AAPL } });
    chainToken.mockResolvedValue({ symbol: "AAPLc", decimals: 8 });
    stakerOf.mockResolvedValue({ staked: 10n ** 18n, claimable: [10n ** 18n, 5n * 10n ** 6n] });
    render(<CoinRewards token={COIN} symbol="TEST" record={recordTo(SHARE)} />);
    await settle();
    expect(screen.getByRole("group", { name: "Stake TEST, earn its fees" })).toHaveTextContent("3 TEST staked in all. 5% goes to 0x884F…7A9B first.");
    expect(screen.getByText(/claimable now/)).toHaveTextContent("1 TEST + 0.05 AAPLc");
  });

  it("stakes with an exact approval, unstakes and claims; a bad amount is refused", async () => {
    shareOf.mockResolvedValue({ ...share, agent: null, agentBps: 0 });
    poolKeyOf.mockResolvedValue(null);
    render(<CoinRewards token={COIN} symbol="TEST" record={recordTo(SHARE)} />);
    await settle();
    expect(screen.getByRole("group")).not.toHaveTextContent("goes to");
    // the page reads the share again after each action, so the field is found afresh each time
    const amount = () => screen.getByLabelText("Amount of TEST to stake or unstake");
    fireEvent.change(amount(), { target: { value: "x" } });
    fireEvent.click(button("Stake"));
    await settle();
    expect(document.querySelector(".tx__warn")).not.toBeNull();
    fireEvent.change(amount(), { target: { value: "2" } });
    fireEvent.click(button("Stake"));
    await settle();
    expect(sendTransaction.mock.calls.map((c) => (c[2] as { to: string }).to)).toEqual([COIN, SHARE]);
    sendTransaction.mockClear();
    allowance.mockResolvedValue(10n ** 30n);
    fireEvent.change(amount(), { target: { value: "2" } });
    fireEvent.click(button("Stake"));
    await settle();
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    fireEvent.change(amount(), { target: { value: "1" } });
    fireEvent.click(button("Unstake"));
    await settle();
    fireEvent.click(button("Claim"));
    await settle();
    expect(sendTransaction).toHaveBeenCalledTimes(3);
    sendTransaction.mockRejectedValueOnce(new Error("User rejected"));
    fireEvent.click(button("Claim"));
    await settle();
  });

  it("asks for a wallet, reads, and says why your stake could not be read; nothing to claim is disabled", async () => {
    shareOf.mockResolvedValue(share);
    session = { wallet: null, signingProvider: () => provider };
    const a = render(<CoinRewards token={COIN} symbol="TEST" record={recordTo(SHARE)} />);
    await settle();
    expect(screen.getByText("Connect a wallet to stake.")).toBeInTheDocument();
    a.unmount();
    session = { wallet: { kind: "ready", account: ME }, signingProvider: () => provider };
    stakerOf.mockReturnValueOnce(new Promise(() => {}));
    const b = render(<CoinRewards token={COIN} symbol="TEST" record={recordTo(SHARE)} />);
    await settle();
    expect(screen.getByText("Reading your stake…")).toBeInTheDocument();
    b.unmount();
    stakerOf.mockRejectedValueOnce(new Error("share unreadable"));
    const c = render(<CoinRewards token={COIN} symbol="TEST" record={recordTo(SHARE)} />);
    await settle();
    expect(screen.getByText("share unreadable")).toBeInTheDocument();
    c.unmount();
    stakerOf.mockResolvedValue({ staked: 0n, claimable: [0n, 0n] });
    render(<CoinRewards token={COIN} symbol="TEST" record={recordTo(SHARE)} />);
    await settle();
    expect(button("Claim")).toBeDisabled();
    expect(button("Unstake")).toBeDisabled();
  });
});

describe("a coin's furnace", () => {
  const FURNACE = "0x78386A3c1888f89EF4C874675069Cb930536a44c";
  const TREASURY = "0xD5C1dFc036F9911348EA8065F73c8123f4013FAB";
  const furnace = { address: FURNACE, treasury: TREASURY, burnBps: 5_000, toBuy: 5_685_590n, burnedFromFees: 10n ** 24n, burnedFromBuybacks: 2n * 10n ** 24n, quoteSpent: 100_000n };
  const pool = { factory: FACTORY, token: COIN, quote: AAPL, tokenIs0: false, key: { currency0: AAPL, currency1: COIN, fee: 0x800000, tickSpacing: 200, hooks: ETH } };

  beforeEach(() => {
    furnaceOf.mockResolvedValue(furnace);
    poolKeyOf.mockResolvedValue(pool);
    chainToken.mockResolvedValue({ symbol: "AAPLc", decimals: 8 });
  });

  it("shows what it burnt, what it spent and what waits — and anyone may harvest", async () => {
    render(<CoinRewards token={COIN} symbol="QUADRA" record={recordTo(FURNACE)} />);
    await settle();
    const box = screen.getByRole("group", { name: "QUADRA's furnace" });
    expect(box).toHaveTextContent("50% to burning QUADRA");
    expect(screen.getByLabelText("Furnace")).toHaveTextContent(/QUADRA burnt3,000,000 — 1,000,000 from fees, 2,000,000 bought back/);
    expect(screen.getByLabelText("Furnace")).toHaveTextContent("0.056855 AAPLc");
    expect(screen.queryByRole("button", { name: "Buy back & burn" })).toBeNull();
    fireEvent.click(button("Harvest fees"));
    await settle();
    expect(sendTransaction).toHaveBeenCalledWith(provider, ME, expect.objectContaining({ to: FURNACE }));
    expect(furnaceOf).toHaveBeenCalledTimes(2);
  });

  it("offers the buyback to the treasury alone, at a floor 1% under the quote; a quote that fails says so", async () => {
    session = { wallet: { kind: "ready", account: TREASURY }, signingProvider: () => provider };
    quoteV4.mockRejectedValueOnce(new Error("Uniswap's quoter could not fill this swap")).mockResolvedValue({ amountOut: 10_000n, gasEstimate: 1n });
    render(<CoinRewards token={COIN} symbol="QUADRA" record={recordTo(FURNACE)} />);
    await settle();
    fireEvent.click(button("Buy back & burn"));
    await settle();
    expect(screen.getByText("Uniswap's quoter could not fill this swap")).toBeInTheDocument();
    fireEvent.click(button("Buy back & burn"));
    await settle();
    expect(quoteV4).toHaveBeenLastCalledWith(pool.key, true, 5_685_590n);
    const data = (sendTransaction.mock.calls[0]![2] as { data: `0x${string}` }).data;
    expect(decodeFunctionData({ abi: FURNACE_ABI, data })).toMatchObject({ functionName: "buyAndBurn", args: [5_685_590n, 9_900n] });
  });

  it("asks for a wallet to harvest; nothing waiting, nothing to buy back; a coin whose currency0 is the coin", async () => {
    session = { wallet: null, signingProvider: () => provider };
    const a = render(<CoinRewards token={COIN} symbol="QUADRA" record={recordTo(FURNACE)} />);
    await settle();
    expect(button("Connect a wallet to harvest")).toBeDisabled();
    a.unmount();
    session = { wallet: { kind: "ready", account: TREASURY }, signingProvider: () => provider };
    furnaceOf.mockResolvedValue({ ...furnace, toBuy: 0n });
    poolKeyOf.mockResolvedValue({ ...pool, tokenIs0: true, key: { ...pool.key, currency0: COIN, currency1: AAPL } });
    render(<CoinRewards token={COIN} symbol="QUADRA" record={recordTo(FURNACE)} />);
    await settle();
    expect(button("Buy back & burn")).toBeDisabled();
    expect(screen.getByLabelText("Furnace")).toHaveTextContent("0 AAPLc");
  });
});
