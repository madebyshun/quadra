import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CONTRACTS, UNISWAP_V4_POOL_MANAGER } from "@/config/chain";
import { parseCoinPage, type IndexedCoinPage } from "@/adapters/http/indexer";
import { BLOCKSCOUT } from "@/skills/blockscout";
import type { PoolValue } from "@/skills/launchpad";
import { ago, Disclosures, inBoth, NewLaunches, TokenChart, TokenInfo, TokenStats, TokenTabs, TokenWarning, useCoinPage } from "@/features/panels/TokenPage";
import { copy, FX } from "./fixtures/base";
import { COINS } from "./fixtures/indexer";
import { DOWN, net, useNet } from "./net";
import { AT, served } from "./indexerPage";

useNet();
afterEach(() => vi.unstubAllGlobals());

/**
 * The coin page's parts, read against the launchpad index's REAL captures (tests/fixtures/indexer):
 * the first launch's ETH pool and its one captured buy, served exactly as `GET /api/launchpad/coin`
 * serves it (`coinDetail` → JSON → `parseCoinPage`). Holders are Blockscout's real DEGEN holders
 * (tests/fixtures/base) — the only holders capture there is; no coin of this launchpad's was captured.
 */

const pageOf = (withMore = false): IndexedCoinPage => parseCoinPage(served(withMore));
const value = (over: Partial<PoolValue> = {}): PoolValue => ({ quote: "0x0000000000000000000000000000000000000000", quoteSymbol: "ETH", quoteDecimals: 18, supplyInQuote: 5, quoteUsd: 2000, ...over });

describe("the small helpers", () => {
  it("inBoth: not read, a tiny amount in exponent form, with and without a dollar price", () => {
    expect(inBoth(null, "ETH", 2000)).toBe("not read");
    expect(inBoth(0.00001, "ETH", null)).toBe("1.00e-5 ETH");
    expect(inBoth(0, "ETH", null)).toBe("0 ETH");
    expect(inBoth(1.5, "ETH", 2000)).toBe("$3,000.00 · 1.5 ETH");
  });

  it("ago: seconds, minutes, hours, days — and never in the future", () => {
    expect(ago(100, 90)).toBe("0s ago");
    expect(ago(0, 59)).toBe("59s ago");
    expect(ago(0, 120)).toBe("2m ago");
    expect(ago(0, 7200)).toBe("2h ago");
    expect(ago(0, 3 * 86400)).toBe("3d ago");
  });
});

function Page({ token }: { token: string }) {
  const p = useCoinPage(token);
  return <output aria-label="page">{p === "reading" ? "reading" : "problem" in p ? p.problem : p.coin.token}</output>;
}

describe("useCoinPage", () => {
  it("reads the coin's page, says why not, and lets go when unmounted", async () => {
    net({ get: (u) => (u === `/api/launchpad/coin?token=${COINS.eth}` ? served() : u.startsWith("/api/launchpad/coin") ? new Response("{}", { status: 404 }) : undefined) });
    const a = render(<Page token={COINS.eth} />);
    expect(screen.getByLabelText("page")).toHaveTextContent("reading");
    await waitFor(() => expect(screen.getByLabelText("page")).toHaveTextContent(COINS.eth));
    a.unmount();
    render(<Page token={COINS.stock} />);
    await waitFor(() => expect(screen.getByLabelText("page")).toHaveTextContent("The launchpad index answered 404."));
    render(<Page token={COINS.eth} />).unmount();
    await act(async () => {});
    render(<Page token={COINS.second} />).unmount();
    await act(async () => {});
  });
});

describe("NewLaunches", () => {
  it("shows the newest launches and opens one; nothing at all when the index is absent", async () => {
    const index = { coins: [JSON.parse(JSON.stringify(pageOf().coin)), { ...JSON.parse(JSON.stringify(pageOf().coin)), token: COINS.stock, symbol: null }] };
    net({ get: (u) => (u === "/api/launchpad/coins" ? index : undefined) });
    const open = vi.fn();
    const a = render(<NewLaunches onOpen={open} />);
    const strip = await screen.findByRole("group", { name: "Newest launches" });
    await userEvent.click(within(strip).getByRole("button", { name: "TEST" }));
    expect(open).toHaveBeenCalledWith(COINS.eth);
    expect(within(strip).getByRole("button", { name: "0xb200…E124" })).toBeInTheDocument();
    a.unmount();

    net({ get: (u) => (u === "/api/launchpad/coins" ? new Response("<!doctype html>", { headers: { "content-type": "text/html" } }) : undefined) });
    const b = render(<NewLaunches onOpen={open} />);
    await act(async () => {});
    expect(b.container).toBeEmptyDOMElement();
  });
});

describe("the page's cards and facts", () => {
  it("TokenWarning says what the contract rules out and what it cannot", () => {
    render(<TokenWarning />);
    expect(screen.getByRole("note")).toHaveTextContent(/cannot mint more.*None of that makes it worth anything/);
  });

  it("TokenStats: the index's figures in dollars and in the quote", () => {
    render(<TokenStats page={pageOf()} value={value()} holders={1234} />);
    const cards = screen.getByLabelText("Numbers");
    expect(cards).toHaveTextContent(/Market cap\$[\d,.]+[\d.]+ ETH/);
    expect(cards).toHaveTextContent(/Price\$0\.0000\d+[\d.]+e-9 ETH/);
    expect(cards).toHaveTextContent("Volume 24h");
    expect(cards).toHaveTextContent("1 trade");
    expect(cards).toHaveTextContent("Holders1,234");
  });

  it("TokenStats: no index — the pool's value for the cap, the rest not read; no dollar price — the quote alone", () => {
    const a = render(<TokenStats page={{ problem: "x" }} value={value({ quoteUsd: null })} holders={null} />);
    const cards = screen.getByLabelText("Numbers");
    expect(cards).toHaveTextContent("Market cap5 ETH");
    expect(cards).toHaveTextContent("Priceno trade yet");
    expect(cards).toHaveTextContent("Volume 24hnot read");
    expect(cards).toHaveTextContent("Lifetime volumenot read");
    expect(cards).toHaveTextContent("Holdersnot read");
    a.unmount();
    render(<TokenStats page="reading" value={null} holders={null} />);
    expect(screen.getByLabelText("Numbers")).toHaveTextContent("Market capnot read");
  });

  it("TokenStats: a price without a dollar figure, and several trades", () => {
    render(<TokenStats page={pageOf(true)} value={null} holders={0} />);
    const cards = screen.getByLabelText("Numbers");
    expect(cards).toHaveTextContent(/Price[\d.]+e-9 ETH/);
    expect(cards).toHaveTextContent("3 trades");
  });

  it("TokenStats: an index row without a quote symbol takes the pool's", () => {
    const p = pageOf();
    render(<TokenStats page={{ ...p, coin: { ...p.coin, quoteSymbol: null, mcapInQuote: null } }} value={value({ quoteSymbol: "AAPLc", quoteUsd: null })} holders={null} />);
    expect(screen.getByLabelText("Numbers")).toHaveTextContent("Market cap5 AAPLc");
  });

  it("TokenChart: reading, a problem, fewer than two hours, a chart", () => {
    const a = render(<TokenChart page="reading" />);
    expect(screen.getByText("Reading the trades…")).toBeInTheDocument();
    a.unmount();
    const b = render(<TokenChart page={{ problem: "down" }} />);
    expect(screen.getByText("No chart: down")).toBeInTheDocument();
    b.unmount();
    const c = render(<TokenChart page={pageOf()} />);
    expect(screen.getByText(/^No chart yet/)).toBeInTheDocument();
    c.unmount();
    const p = pageOf(true);
    const d = render(<TokenChart page={p} />);
    expect(d.container.querySelector("svg")).not.toBeNull();
    d.unmount();
    render(<TokenChart page={{ ...p, coin: { ...p.coin, symbol: null, quoteSymbol: null } }} />);
    expect(screen.getByLabelText(/^Coin price in , hourly/)).toBeInTheDocument();
  });

  it("TokenInfo: fees known, split 80/20; the coin's own fees only when there are some; nothing read", () => {
    const a = render(<TokenInfo page={pageOf(true)} creator={COINS.owner} launchedAt={AT} quoteUsd={2000} />);
    const info = screen.getByLabelText("Info");
    expect(info).toHaveTextContent("Fees earned (in ETH)");
    expect(info).toHaveTextContent(/Creator's share80% — <\$0\.01 · /);
    expect(info).toHaveTextContent("Fees earned (in the coin)");
    expect(info).not.toHaveTextContent("not read");
    a.unmount();
    const b = render(<TokenInfo page={pageOf()} creator={COINS.owner} launchedAt={null} quoteUsd={null} />);
    expect(screen.getByLabelText("Info")).toHaveTextContent("Creatednot read");
    expect(screen.getByLabelText("Info")).not.toHaveTextContent("in the coin");
    b.unmount();
    render(<TokenInfo page={{ problem: "x" }} creator={COINS.owner} launchedAt={null} quoteUsd={null} />);
    expect(screen.getByLabelText("Info")).toHaveTextContent("Fees earned (in the quote)not read");
    expect(screen.getByLabelText("Info")).toHaveTextContent("Creator's sharenot read");
  });

  it("Disclosures name the launchpad version from the factory", () => {
    const a = render(<Disclosures factory={COINS.v1} />);
    expect(screen.getByText(/v1 opens trading/)).toBeInTheDocument();
    a.unmount();
    const b = render(<Disclosures factory={COINS.v2} />);
    expect(screen.getByText(/v2 opens trading/)).toBeInTheDocument();
    b.unmount();
    const saved = CONTRACTS.launchFactoryV1;
    (CONTRACTS as { launchFactoryV1: string | null }).launchFactoryV1 = null;
    try {
      render(<Disclosures factory={COINS.v1} />);
      expect(screen.getByText(/v2 opens trading/)).toBeInTheDocument();
    } finally {
      (CONTRACTS as { launchFactoryV1: string | null }).launchFactoryV1 = saved;
    }
  });
});

describe("TokenTabs", () => {
  const HOLDERS = `${BLOCKSCOUT}/tokens/${COINS.eth}/holders`;

  it("Transactions: all, buys, sells; a wallet looked up or a dash", async () => {
    render(<TokenTabs token={COINS.eth} page={pageOf(true)} now={AT + 7300} />);
    const rows = () => screen.getAllByRole("row").slice(1);
    expect(rows()).toHaveLength(3);
    expect(rows()[0]).toHaveTextContent(/1m ago.*Buy.*ETH.*—/);
    expect(rows()[1]).toHaveTextContent(/Sell.*TEST/);
    expect(rows()[1]).toHaveTextContent("0xD5C1…3FAB");
    await userEvent.click(screen.getByRole("button", { name: "Buys" }));
    expect(rows()).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Sells" }));
    expect(rows()).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(rows()).toHaveLength(3);
  });

  it("Transactions: none yet, none of the filter, reading, could not be read; a coin with no symbols", async () => {
    const p = pageOf();
    const a = render(<TokenTabs token={COINS.eth} page={{ ...p, trades: [] }} now={AT} />);
    expect(screen.getByText(/^No trades yet/)).toBeInTheDocument();
    a.unmount();
    const b = render(<TokenTabs token={COINS.eth} page={{ ...p, coin: { ...p.coin, symbol: null, quoteSymbol: null } }} now={AT} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toContain("coin");
    await userEvent.click(screen.getByRole("button", { name: "Sells" }));
    expect(screen.getByText("None of these.")).toBeInTheDocument();
    b.unmount();
    const c = render(<TokenTabs token={COINS.eth} page="reading" now={AT} />);
    expect(screen.getByText("Reading the trades…")).toBeInTheDocument();
    c.unmount();
    render(<TokenTabs token={COINS.eth} page={{ problem: "down" }} now={AT} />);
    expect(screen.getByText("Not checked — the trades could not be read: down")).toBeInTheDocument();
  });

  it("Holders: the list, the PoolManager named as the pool, a label, the rest plain", async () => {
    // DEGEN's real holders, with the first holder's address replaced by the PoolManager's — a variant, visibly
    const body = copy(FX.holdersDegen) as { items: { address: { hash: string; name: string | null } }[] };
    body.items[0]!.address.hash = UNISWAP_V4_POOL_MANAGER;
    net({ get: (u) => (u === HOLDERS ? body : undefined) });
    render(<TokenTabs token={COINS.eth} page="reading" now={AT} />);
    fireEvent.click(screen.getByRole("tab", { name: "Holders" }));
    expect(screen.getByText("Reading the holders…")).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Top holders" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(12);
    expect(items[0]).toHaveTextContent("— the pool (Uniswap v4)");
    expect(items[2]).toHaveTextContent("— TransparentUpgradeableProxy");
    expect(items[1]).not.toHaveTextContent("—");
    expect(items[0]).toHaveTextContent(/\(\d+\.\d\d%\)/);
  });

  it("Holders: none indexed yet, and not checked when Blockscout cannot be reached", async () => {
    const empty = { ...copy(FX.holdersDegen), items: [] };
    net({ get: (u) => (u === HOLDERS ? empty : undefined) });
    const a = render(<TokenTabs token={COINS.eth} page="reading" now={AT} />);
    await userEvent.click(screen.getByRole("tab", { name: "Holders" }));
    expect(await screen.findByText(/^No holders indexed yet/)).toBeInTheDocument();
    a.unmount();
    net({ get: (u) => (u === HOLDERS ? DOWN : undefined) });
    render(<TokenTabs token={COINS.eth} page="reading" now={AT} />);
    await userEvent.click(screen.getByRole("tab", { name: "Holders" }));
    expect(await screen.findByText(/^Not checked — the holders could not be read:/)).toBeInTheDocument();
  });
});
