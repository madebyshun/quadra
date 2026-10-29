import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { parseCoinPage } from "@/adapters/http/indexer";
import { BLOCKSCOUT } from "@/skills/blockscout";
import { copy, FX } from "./fixtures/base";
import { COINS } from "./fixtures/indexer";
import { AT, served } from "./indexerPage";
import { DOWN, net, useNet } from "./net";

const launchesBy = vi.fn();
vi.mock("@/skills/launchpad", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/skills/launchpad")>()),
  launchesBy: (...a: unknown[]) => launchesBy(...a),
}));

const { CoinMoves, CreatorLaunches, FeeLedger, TokenTabs } = await import("@/features/panels/TokenPage");

useNet();

/**
 * The coin page's smaller blocks: market activity (DexScreener's real DEGEN pair), the fee route,
 * the creator's other launches, and the holders' concentration. Each one says "not read" for a
 * figure it does not have — never a zero.
 */

const DEGEN = "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed";
const DEX = `https://api.dexscreener.com/tokens/v1/base/${DEGEN}`;
const CREATOR = "0xD5C1dFc036F9911348EA8065F73c8123f4013FAB";

describe("market activity", () => {
  it("shows DEGEN's real 24h flow and its moves, a missing window as not read", async () => {
    net({ get: (u) => (u === DEX ? FX.dexscreenerDegen : undefined) });
    render(<CoinMoves token={DEGEN} />);
    expect(screen.getByText("Reading market activity…")).toBeInTheDocument();
    const box = await screen.findByRole("region", { name: "Market activity" });
    expect(box).toHaveTextContent("404 buys · 582 sells · 24h");
    expect(within(box).getByLabelText("41% buys")).toBeInTheDocument();
    // the capture publishes h1, h6 and h24 but no m5
    expect(within(box).getByText("not read")).toHaveClass("dim");
    expect(within(box).getByText("-0.05%")).toHaveClass("tone-bad");
    expect(within(box).getByText("+1.26%")).toHaveClass("tone-ok");
  });

  it("says when the split is not reported or empty — a variant of the capture, built here", async () => {
    const quiet = copy(FX.dexscreenerDegen) as { txns: { h24: { buys: number | null; sells: number | null } } }[];
    quiet[0]!.txns.h24 = { buys: null, sells: 3 };
    net({ get: (u) => (u === DEX ? quiet : undefined) });
    const a = render(<CoinMoves token={DEGEN} />);
    expect(await screen.findByText("Buy / sell 24h: not read")).toBeInTheDocument();
    expect(screen.getByText("Buy/sell split not reported.")).toBeInTheDocument();
    a.unmount();
    quiet[0]!.txns.h24 = { buys: 2, sells: null };
    const b = render(<CoinMoves token={DEGEN} />);
    expect(await screen.findByText("Buy / sell 24h: not read")).toBeInTheDocument();
    expect(screen.getByLabelText("100% buys")).toBeInTheDocument();
    b.unmount();
    quiet[0]!.txns.h24 = { buys: 1, sells: 1 };
    const c = render(<CoinMoves token={DEGEN} />);
    expect(await screen.findByText("1 buy · 1 sell · 24h")).toBeInTheDocument();
    c.unmount();
    quiet[0]!.txns.h24 = { buys: 0, sells: 0 };
    render(<CoinMoves token={DEGEN} />);
    expect(await screen.findByText("0 buys · 0 sells · 24h")).toBeInTheDocument();
    expect(screen.getByText("Buy/sell split not reported.")).toBeInTheDocument();
  });

  it("is not checked when DexScreener cannot be reached", async () => {
    net({ get: (u) => (u === DEX ? DOWN : undefined) });
    render(<CoinMoves token={DEGEN} />);
    expect(await screen.findByText(/DexScreener has no pair/)).toBeInTheDocument();
  });
});

describe("the fee route", () => {
  const page = parseCoinPage(served(true));

  it("reads while the page reads, and says why it could not", () => {
    const a = render(<FeeLedger page="reading" fee="reading" referrer="reading" />);
    expect(screen.getByText("Reading the fee ledger…")).toBeInTheDocument();
    a.unmount();
    render(<FeeLedger page={{ problem: "index down" }} fee="reading" referrer="reading" />);
    expect(screen.getByText("Fee ledger not checked — index down")).toBeInTheDocument();
  });

  it("names the referrer's 5% when there is one, and an unread fee or total as such", () => {
    render(<FeeLedger page={{ ...page, feesQuote: null, feesToken: null }} fee="reading" referrer={{ referrer: CREATOR }} />);
    const ledger = screen.getByLabelText("Fee ledger");
    expect(ledger).toHaveTextContent("reading…");
    expect(ledger).toHaveTextContent("Creator 80% · Referrer 5% · Protocol ~15%");
    expect(ledger).toHaveTextContent("Collected quote: not read");
    expect(ledger).toHaveTextContent("Collected coin: not read");
    expect(ledger).not.toHaveTextContent(/furnace/i);
  });

  it("says a fee it could not read is not checked", () => {
    render(<FeeLedger page={page} fee={{ problem: "hook unreadable" }} referrer={{ problem: "x" }} />);
    expect(screen.getByLabelText("Fee ledger")).toHaveTextContent("not checked — hook unreadable");
    expect(screen.getByLabelText("Fee ledger")).toHaveTextContent("Creator 80% · Protocol ~20%");
  });
});

describe("the creator's other launches", () => {
  const launch = (token: string, symbol?: string | null) => ({ token, block: 1, ...(symbol === undefined ? {} : { symbol }) });

  it("lists up to five others, by symbol or short address", async () => {
    const others = ["0x1", "0x2", "0x3", "0x4", "0x5", "0x6"].map((n) => `0x${n.slice(2).padStart(40, "0")}`);
    launchesBy.mockResolvedValue({ launches: [launch(COINS.eth, "TEST"), launch(others[0]!, "AAA"), launch(others[1]!, null), ...others.slice(2).map((t) => launch(t))] });
    render(<CreatorLaunches creator={CREATOR} current={COINS.eth.toLowerCase()} />);
    expect(screen.getByText("Reading this creator's launches…")).toBeInTheDocument();
    const box = await screen.findByLabelText("Creator launches");
    expect(box).toHaveTextContent("0xD5C1…3FAB launched 7 coins");
    expect(within(box).getAllByRole("link")).toHaveLength(5);
    expect(within(box).getByRole("link", { name: "AAA" })).toHaveAttribute("href", `?do=coins&t=${others[0]}`);
    expect(within(box).getByRole("link", { name: "0x0000…0002" })).toBeInTheDocument();
  });

  it("one launch is this one; a history that cannot be read is not checked", async () => {
    launchesBy.mockResolvedValue({ launches: [launch(COINS.eth)] });
    const a = render(<CreatorLaunches creator={CREATOR} current={COINS.eth} />);
    expect(await screen.findByText("No other launch indexed yet.")).toBeInTheDocument();
    expect(screen.getByLabelText("Creator launches")).toHaveTextContent("launched 1 coin");
    a.unmount();
    launchesBy.mockRejectedValue(new Error("Blockscout down"));
    render(<CreatorLaunches creator={CREATOR} current={COINS.eth} />);
    expect(await screen.findByText("Creator history not checked — Blockscout down")).toBeInTheDocument();
  });
});

describe("holder concentration", () => {
  const HOLDERS = `${BLOCKSCOUT}/tokens/${COINS.eth}/holders`;

  it("reads the top 1, 5 and 10's share of what is listed — and not read when it all sums to nothing", async () => {
    const body = copy(FX.holdersDegen) as { items: { value: string }[] };
    net({ get: (u) => (u === HOLDERS ? body : undefined) });
    const a = render(<TokenTabs token={COINS.eth} page="reading" now={AT} />);
    fireEvent.click(screen.getByRole("tab", { name: "Holders" }));
    const shares = await screen.findByLabelText("Holder concentration");
    expect(within(shares).getAllByText(/%$/)).toHaveLength(3);
    a.unmount();
    // a variant of the capture, built here: every balance zero
    for (const h of body.items) h.value = "0";
    render(<TokenTabs token={COINS.eth} page="reading" now={AT} />);
    fireEvent.click(screen.getByRole("tab", { name: "Holders" }));
    await waitFor(() => expect(within(screen.getByLabelText("Holder concentration")).getAllByText("not read")).toHaveLength(3));
  });
});
