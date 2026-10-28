import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { OpenWindowProvider } from "@/features/openWindow";
import { SoonPanel } from "@/features/panels/FolderPanel";
import { RugsweeperPanel, SIZE } from "@/features/panels/RugsweeperPanel";
import { AchievementsPanel, localAchievements, walletAchievements, walletFacts, type WalletFacts } from "@/features/panels/AchievementsPanel";
import { LeaderboardPanel, fromLogs, rank, rankIndexed, TOP } from "@/features/panels/LeaderboardPanel";
import * as registry from "@/features/registry";
import { forgetTips, onTip } from "@/lib/assistant";
import { ACHIEVEMENTS_KEY, count } from "@/lib/achievements";
import type { Field } from "@/skills/activity";
import type { Launch } from "@/skills/launchpad";
import type { Market } from "@/skills/dexscreener";
import type { LaunchpadIndex, IndexedCoin } from "@/adapters/http/indexer";
import { USDC } from "@/config/chain";
import { settle } from "./helpers";

const minefield = vi.fn<() => Promise<Field[]>>();
vi.mock("@/skills/activity", () => ({ minefield: () => minefield() }));
const launchesBy = vi.fn();
const pendingFees = vi.fn();
vi.mock("@/skills/launchpad", () => ({ launchesBy: (a: unknown) => launchesBy(a), pendingFees: (f: string, t: string) => pendingFees(f, t) }));
const nameOf = vi.fn();
vi.mock("@/skills/names", () => ({ nameOf: (a: string) => nameOf(a) }));
const transfersOf = vi.fn();
vi.mock("@/skills/profile", async (orig) => ({ ...(await orig<typeof import("@/skills/profile")>()), transfersOf: (a: string) => transfersOf(a) }));
const marketsOf = vi.fn();
vi.mock("@/skills/dexscreener", async (orig) => ({ ...(await orig<typeof import("@/skills/dexscreener")>()), marketsOf: (t: string[]) => marketsOf(t) }));
const launchpadCoins = vi.fn();
vi.mock("@/adapters/http/indexer", async (orig) => ({ ...(await orig<typeof import("@/adapters/http/indexer")>()), launchpadCoins: () => launchpadCoins() }));
let session: { wallet: unknown } = { wallet: null };
vi.mock("@/ui/WalletProvider", () => ({ useWalletSession: () => session }));
vi.mock("@/features/registry", async (orig) => {
  const real = await orig<typeof import("@/features/registry")>();
  return { ...real, comingSoon: vi.fn(real.comingSoon) };
});

beforeEach(() => {
  vi.clearAllMocks();
  forgetTips();
  session = { wallet: null };
});

const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const ETH = "0x0000000000000000000000000000000000000000";

describe("SoonPanel", () => {
  it("lists the programs switched off and opens one", () => {
    const open = vi.fn();
    render(
      <OpenWindowProvider open={open}>
        <SoonPanel />
      </OpenWindowProvider>,
    );
    const items = screen.getAllByRole("button");
    expect(items.length).toBe(registry.comingSoon().length);
    fireEvent.click(items[0]!);
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(`${registry.comingSoon()[0]!.title} — ${registry.comingSoon()[0]!.blurb}`);
    fireEvent.doubleClick(items[0]!);
    expect(open).toHaveBeenCalledWith(registry.comingSoon()[0]!.id);
    fireEvent.keyDown(items[1]!, { key: "a" });
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(items[1]!, { key: "Enter" });
    expect(open).toHaveBeenLastCalledWith(registry.comingSoon()[1]!.id);
  });
  it("opens nothing outside the desktop", () => {
    render(<SoonPanel />);
    fireEvent.doubleClick(screen.getAllByRole("button")[0]!);
    fireEvent.keyDown(screen.getAllByRole("button")[0]!, { key: "Enter" });
  });
  it("says nothing is waiting when every flag is on", () => {
    vi.mocked(registry.comingSoon).mockReturnValueOnce([]);
    render(<SoonPanel />);
    expect(screen.getByText("Everything is out of the box. Nothing is waiting.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("0 objects");
  });
});

const field = (n: number, mines: number[]): Field[] =>
  Array.from({ length: n }, (_, i) => ({ token: A(i + 1), symbol: `C${i}`, mine: mines.includes(i), why: mines.includes(i) ? "hook takes a cut" : null }));
const cell = (i: number) => document.querySelectorAll(".sweep__cell")[i] as HTMLElement;

describe("RugsweeperPanel", () => {
  it("reads, fails, retries; one click clears a board with one mine in the corner", async () => {
    const tips: string[] = [];
    const off = onTip((t) => tips.push(t.id));
    minefield.mockRejectedValueOnce(new Error("no logs")).mockResolvedValueOnce(field(10, [0]));
    const open = vi.fn();
    render(
      <OpenWindowProvider open={open}>
        <RugsweeperPanel />
      </OpenWindowProvider>,
    );
    expect(screen.getByText(/Laying out/)).toBeInTheDocument();
    await settle();
    expect(screen.getByText("No board — the launches could not be read: no logs")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settle();
    expect(screen.getByRole("grid", { name: "Rugsweeper, 1 mines" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mines not flagged")).toHaveTextContent("001");
    expect(screen.getByText(/1 mines among the 10 newest/)).toBeInTheDocument();
    fireEvent.click(cell(SIZE * SIZE - 1));
    expect(screen.getByRole("status")).toHaveTextContent(/You cleared it/);
    expect(screen.getByRole("button", { name: "New board" })).toHaveTextContent("😎");
    expect(cell(1)).toHaveAccessibleName("1 near");
    expect(cell(1).title).toBe("C1");
    expect(cell(63).title).toBe("");
    expect(cell(63)).toHaveAccessibleName("clear");
    expect(cell(0)).toHaveAccessibleName("mine: C0");
    expect(tips).toContain("sweep-won");
    const c = JSON.parse(localStorage.getItem(ACHIEVEMENTS_KEY)!);
    expect([c.sweeps, c.sweepWins]).toEqual([1, 1]);
    fireEvent.click(screen.getByRole("button", { name: `verdict ${A(1)}` }));
    expect(open).toHaveBeenCalled();
    fireEvent.click(cell(5)); // the game is over: nothing happens
    off();
  });

  it("flags by mode and by right-click, opens a numbered square, loses on a mine, and deals again", async () => {
    minefield.mockResolvedValue(field(10, [0]));
    render(<RugsweeperPanel />);
    await settle();
    fireEvent.contextMenu(cell(0));
    expect(cell(0)).toHaveAccessibleName("flagged");
    expect(screen.getByLabelText("Mines not flagged")).toHaveTextContent("000");
    fireEvent.click(screen.getByRole("button", { name: /Flag mode/ }));
    fireEvent.click(cell(2));
    expect(screen.getByLabelText("Mines not flagged")).toHaveTextContent("000"); // never below zero
    fireEvent.click(cell(2));
    fireEvent.click(cell(0));
    expect(cell(0)).toHaveAccessibleName("closed");
    fireEvent.click(screen.getByRole("button", { name: /Flag mode/ }));
    fireEvent.click(cell(1));
    expect(cell(1)).toHaveAccessibleName("1 near");
    fireEvent.click(cell(1)); // already open: no change
    fireEvent.click(cell(0));
    expect(screen.getByRole("status")).toHaveTextContent(/Boom/);
    expect(screen.getByRole("button", { name: "New board" })).toHaveTextContent("😵");
    expect(screen.getByRole("list", { name: "The mines" })).toHaveTextContent("C0 — hook takes a cut");
    expect(screen.queryByRole("button", { name: /^verdict/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New board" }));
    await settle();
    expect(screen.getByRole("button", { name: "New board" })).toHaveTextContent("🙂");
  });

  it("a board with no mines lists none when cleared", async () => {
    minefield.mockResolvedValue(field(3, []));
    render(<RugsweeperPanel />);
    await settle();
    fireEvent.click(cell(10));
    expect(screen.getByRole("status")).toHaveTextContent(/You cleared it/);
    expect(screen.queryByRole("list", { name: "The mines" })).toBeNull();
  });
});

const L = (i: number, creator: string, factory = A(900)): Launch => ({ factory, token: A(i), creator, block: i, at: null, tx: "0x" });

describe("achievements", () => {
  it("localAchievements follows the counters", () => {
    const zero = localAchievements({ verdicts: 0, sweeps: 0, sweepWins: 0, binVisits: 0, taskmgr: 0 });
    expect(zero.every((a) => a.state === "locked")).toBe(true);
    expect(zero[1]!.progress).toBe("0/10");
    const lots = localAchievements({ verdicts: 12, sweeps: 1, sweepWins: 1, binVisits: 1, taskmgr: 1 });
    expect(lots.every((a) => a.state === "earned")).toBe(true);
    expect(lots[1]!.progress).toBe("10/10");
  });

  it("walletFacts: every read failing is unknown, not locked", async () => {
    launchesBy.mockRejectedValue(new Error("x"));
    nameOf.mockRejectedValue(new Error("x"));
    transfersOf.mockRejectedValue(new Error("x"));
    const f = await walletFacts(A(1));
    expect(f).toEqual({ launches: null, stockPaired: null, feesWaiting: null, basename: null, poisoned: null });
    expect(walletAchievements(f).map((a) => a.state)).toEqual(Array(6).fill("unknown"));
    expect(walletAchievements(f)[1]!.progress).toBeUndefined();
  });

  it("walletFacts: a stock pair and fees waiting, a verified name, a planted lure", async () => {
    launchesBy.mockResolvedValue({ launches: [L(1, A(1)), L(2, A(1))], complete: true });
    pendingFees.mockResolvedValueOnce({ quote: A(77), inQuote: 0n, inToken: 0n }).mockResolvedValueOnce({ quote: ETH, inQuote: 0n, inToken: 5n });
    nameOf.mockResolvedValue({ kind: "verified", name: "me.base.eth" });
    transfersOf.mockResolvedValue([{ symbol: "USDC", token: A(5) }]);
    const f = await walletFacts(A(1));
    expect(f).toEqual({ launches: 2, stockPaired: true, feesWaiting: true, basename: true, poisoned: true });
    expect(walletAchievements({ ...f, launches: 6 }).map((a) => a.state)).toEqual(Array(6).fill("earned"));
  });

  it("walletFacts: ETH pairs with nothing waiting, an unverified name, clean history; and partial pool reads", async () => {
    launchesBy.mockResolvedValue({ launches: [L(1, A(1))], complete: true });
    pendingFees.mockResolvedValueOnce({ quote: ETH, inQuote: 1n, inToken: 0n });
    nameOf.mockResolvedValue({ kind: "none" });
    transfersOf.mockResolvedValue([{ symbol: "USDC", token: USDC.address }]);
    expect(await walletFacts(A(1))).toEqual({ launches: 1, stockPaired: false, feesWaiting: true, basename: false, poisoned: false });

    pendingFees.mockResolvedValueOnce({ quote: ETH, inQuote: 0n, inToken: 0n });
    let f = await walletFacts(A(1));
    expect([f.stockPaired, f.feesWaiting]).toEqual([false, false]);
    expect(walletAchievements(f).map((a) => a.state)).toEqual(["earned", "locked", "locked", "locked", "locked", "locked"]);

    launchesBy.mockResolvedValue({ launches: [L(1, A(1)), L(2, A(1))], complete: true });
    pendingFees.mockResolvedValueOnce({ quote: ETH, inQuote: 0n, inToken: 0n }).mockRejectedValueOnce(new Error("x"));
    f = await walletFacts(A(1));
    expect([f.stockPaired, f.feesWaiting]).toEqual([null, null]);
    const none: WalletFacts = { launches: 0, stockPaired: false, feesWaiting: false, basename: false, poisoned: false };
    expect(walletAchievements(none)[0]!.state).toBe("locked");
  });

  it("the panel without a wallet, then with one", async () => {
    count("verdicts");
    const { rerender } = render(<AchievementsPanel />);
    expect(screen.getByText(/Connect a wallet to see/)).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    act(() => void count("taskmgr"));
    expect(screen.getByText("2")).toBeInTheDocument();

    launchesBy.mockResolvedValue({ launches: [L(1, A(1))], complete: true });
    pendingFees.mockResolvedValue({ quote: ETH, inQuote: 0n, inToken: 0n });
    nameOf.mockRejectedValue(new Error("x"));
    transfersOf.mockResolvedValue([]);
    session = { wallet: { kind: "ready", account: A(1) } };
    rerender(<AchievementsPanel />);
    expect(screen.getByText("Reading your wallet from Base…")).toBeInTheDocument();
    await settle();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/Not checked — could not be read just now/)).toBeInTheDocument();

    session = { wallet: { kind: "disconnected", why: "" } };
    rerender(<AchievementsPanel />);
    expect(screen.getByText(/Connect a wallet to see/)).toBeInTheDocument();
  });
});

const M = (base: string, over: Partial<Market> = {}): Market => ({
  dex: "uniswap", pair: null, priceUsd: 1, liquidityUsd: 10, volume24h: 100, createdAt: null, quote: "WETH", url: null, buys24h: null, sells24h: null, base, symbol: "SYM", marketCap: null, ...over,
});
const coin = (i: number, trades24h: number, trades: number, symbol: string | null = `T${i}`): IndexedCoin => ({ token: A(i), symbol, trades24h, trades }) as unknown as IndexedCoin;

describe("leaderboard", () => {
  it("rank orders launchers and coins by volume, untraded last", () => {
    const launches = [L(1, A(100)), L(2, A(200)), L(3, A(200))];
    const b = rank(launches, [M(A(2), { volume24h: 50 }), M(A(1).toUpperCase().replace("0X", "0x"), { volume24h: 500, symbol: null })]);
    expect(b.launchers).toEqual([{ address: A(200), launches: 2 }, { address: A(100), launches: 1 }]);
    expect(b.coins.map((c) => c.token)).toEqual([A(1), A(2), A(3)]);
    expect(b.coins[0]!.symbol).toMatch(/^0x/); // DexScreener named no symbol: the address, shortened
    expect(b.coins[2]!.market).toBeNull();
    expect(b).toMatchObject({ total: 3, complete: true });
    expect(rank(Array.from({ length: TOP + 2 }, (_, i) => L(i + 1, A(i + 1))), [M(A(5), { volume24h: null })]).coins).toHaveLength(TOP);
  });

  it("rankIndexed orders coins by trades today, then all trades", () => {
    const idx = { behind: 0, creators: [{ creator: A(9), launches: 2, tokens: [] }], coins: [coin(1, 0, 0, null), coin(2, 3, 9), coin(3, 0, 4), coin(4, 3, 10)] } as unknown as LaunchpadIndex;
    const b = rankIndexed(idx);
    expect(b.coins.map((c) => c.token)).toEqual([A(4), A(2), A(3), A(1)]);
    expect([...b.trades.values()]).toEqual(["3 trades in 24 h", "3 trades in 24 h", "4 trades, none today", "not traded yet"]);
    expect(b.complete).toBe(true);
    expect(rankIndexed({ ...idx, behind: null }).complete).toBe(false);
  });

  it("fromLogs pages tokens 30 at a time and treats a failed page as no markets", async () => {
    launchesBy.mockResolvedValue({ launches: Array.from({ length: 31 }, (_, i) => L(i + 1, A(1))), complete: false });
    marketsOf.mockResolvedValueOnce([M(A(1))]).mockRejectedValueOnce(new Error("429"));
    const b = await fromLogs();
    expect(marketsOf).toHaveBeenCalledTimes(2);
    expect(b.complete).toBe(false);
    expect(b.coins[0]!.token).toBe(A(1));
  });

  it("the panel reads the indexer, and its buttons open Profile and Coins", async () => {
    launchpadCoins.mockResolvedValue({ behind: 5, creators: [{ creator: A(9), launches: 1, tokens: [] }, { creator: A(8), launches: 2, tokens: [] }], coins: [coin(1, 2, 2)] });
    const open = vi.fn();
    render(
      <OpenWindowProvider open={open}>
        <LeaderboardPanel />
      </OpenWindowProvider>,
    );
    expect(screen.getByText(/Counting every launch/)).toBeInTheDocument();
    await settle();
    expect(screen.getByText(/coins launched here so far/).textContent).toBe("1+ coins launched here so far.");
    expect(screen.getByText("1 launch")).toBeInTheDocument();
    expect(screen.getByText("2 launches")).toBeInTheDocument();
    expect(screen.getByText("2 trades in 24 h")).toBeInTheDocument();
    expect(screen.getByText(/launchpad indexer/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button")[0]!);
    expect(open.mock.calls[0]![0]).toBe("profile");
    fireEvent.click(screen.getByRole("button", { name: "T1" }));
    expect(open.mock.calls[1]![0]).toBe("coins");
  });

  it("falls back to the logs, with medals past third and volumes; outside the desktop the buttons do nothing", async () => {
    launchpadCoins.mockRejectedValue(new Error("absent"));
    launchesBy.mockResolvedValue({ launches: [1, 2, 3, 4].map((i) => L(i, A(i))), complete: true });
    marketsOf.mockResolvedValue([M(A(1), { volume24h: 1234 })]);
    render(<LeaderboardPanel />);
    await settle();
    expect(screen.getByText(/coins launched here so far/).textContent).toBe("4 coins launched here so far.");
    expect(screen.getAllByText("4.").length).toBe(2);
    expect(screen.getAllByText("not traded yet").length).toBe(3);
    expect(screen.getByText(/factories' logs/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button")[0]!);
  });

  it("says when neither source could be read", async () => {
    launchpadCoins.mockRejectedValue(new Error("absent"));
    launchesBy.mockRejectedValue(new Error("blockscout down"));
    render(<LeaderboardPanel />);
    await settle();
    expect(screen.getByText("Not checked — the launches could not be read: blockscout down")).toBeInTheDocument();
  });
});
