import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CONTRACTS, UNISWAP_V4_POOL_MANAGER } from "@/config/chain";
import { parseCoinPage, type IndexedCoinPage } from "@/adapters/http/indexer";
import { BLOCKSCOUT } from "@/skills/blockscout";
import type { PoolValue } from "@/skills/launchpad";
import { ago, autoFrame, bucket, CoinMoves, Disclosures, FeeLedger, FRAMES, inBoth, NewLaunches, TokenChart, TokenGuarantees, TokenInfo, TokenPosition, TokenStats, TokenTabs, TokenWarning, useCoinPage } from "@/features/panels/TokenPage";
import { MemoryRouter } from "react-router-dom";
import { WETH } from "@/config/chain";
import { CBBTC } from "@/config/markets";
import { OpenWindowProvider } from "@/features/openWindow";
import { TokenWindow } from "@/features/panels/TokenWindow";
import { WalletProvider } from "@/ui/WalletProvider";
import { CHARTS_PATH } from "@/server/charts";
import { STOCKS_PATH } from "@/server/stocks";
import { copy, FX } from "./fixtures/base";
import { MARKETS_FX, NVDA_ON_BASE } from "./fixtures/markets";
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
  it("inBoth: not read, a tiny amount in subscript zeros (never exponent form), with and without a dollar price", () => {
    expect(inBoth(null, "ETH", 2000)).toBe("not read");
    expect(inBoth(0.00001, "ETH", null)).toBe("0.0₄1 ETH");
    // under a cent, the dollar half is dropped rather than printed as "<$0.01" beside the amount
    expect(inBoth(0.00000299, "AAPLc", 331)).toBe("0.0₅299 AAPLc");
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
    // the index is behind, so recent factory logs are asked for too (indexer.ts mergeRecentLaunches): none newer
    net({ get: (u) => (u === "/api/launchpad/coins" ? index : u.startsWith("https://base.blockscout.com/api/v2/addresses/") ? { items: [] } : undefined) });
    const open = vi.fn();
    const a = render(<NewLaunches onOpen={open} />);
    const strip = await screen.findByRole("group", { name: "Newest launches" });
    await userEvent.click(within(strip).getByRole("button", { name: "TEST" }));
    expect(open).toHaveBeenCalledWith(COINS.eth);
    expect(within(strip).getByRole("button", { name: "0xb200…E124" })).toBeInTheDocument();
    a.unmount();

    // no index, and the factory-log fallback (Blockscout) unreachable too: nothing, never an empty strip
    net({ get: (u) => (u === "/api/launchpad/coins" ? new Response("<!doctype html>", { headers: { "content-type": "text/html" } }) : u.startsWith("https://base.blockscout.com/api/v2/addresses/") ? new Response("", { status: 502 }) : undefined) });
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
    expect(cards).toHaveTextContent(/Price\$0\.0₅\d+0\.0₈\d+ ETH/);
    expect(cards).not.toHaveTextContent(/e-\d/);
    expect(cards).toHaveTextContent("Volume 24h");
    expect(cards).toHaveTextContent("1 trade");
    expect(cards).toHaveTextContent("Holders1,234");
  });

  it("TokenStats: no index — falls back to live pool slot0 price and DexScreener 24h volume; no pool value — no trade yet", () => {
    const a = render(<TokenStats page={{ problem: "x" }} value={value({ quoteUsd: null })} holders={null} />);
    const cards = screen.getByLabelText("Numbers");
    expect(cards).toHaveTextContent("Market cap5 ETH");
    expect(cards).toHaveTextContent(/Price0\.0₈5 ETH/);
    expect(cards).toHaveTextContent("Volume 24hnot read");
    expect(cards).toHaveTextContent("Lifetime volumenot read");
    expect(cards).toHaveTextContent("Holdersnot read");
    a.unmount();
    render(<TokenStats page="reading" value={null} holders={null} />);
    expect(screen.getByLabelText("Numbers")).toHaveTextContent("Market capnot read");
    expect(screen.getByLabelText("Numbers")).toHaveTextContent("Priceno trade yet");
  });

  it("TokenStats: a price without a dollar figure, and several trades", () => {
    render(<TokenStats page={pageOf(true)} value={null} holders={0} />);
    const cards = screen.getByLabelText("Numbers");
    expect(cards).toHaveTextContent(/Price0\.0₈\d+ ETH/);
    expect(cards).toHaveTextContent("3 trades");
  });

  it("TokenStats: an index row without a quote symbol takes the pool's", () => {
    const p = pageOf();
    render(<TokenStats page={{ ...p, coin: { ...p.coin, quoteSymbol: null, mcapInQuote: null } }} value={value({ quoteSymbol: "AAPLc", quoteUsd: null })} holders={null} />);
    expect(screen.getByLabelText("Numbers")).toHaveTextContent("Market cap5 AAPLc");
  });

  it("TokenChart: reading, a problem, fewer than two points, the auto frame, picking one, one candle, a chart", async () => {
    const a = render(<TokenChart page="reading" />);
    expect(screen.getByText("Reading the trades…")).toBeInTheDocument();
    expect(a.container.querySelector("svg")).not.toBeNull();
    a.unmount();
    const b = render(<TokenChart page={{ problem: "down" }} />);
    expect(screen.getByText("No chart: down")).toBeInTheDocument();
    expect(b.container.querySelector("svg")).not.toBeNull();
    b.unmount();
    const c = render(<TokenChart page={pageOf()} />);
    expect(screen.getByText(/^No chart yet — it starts at the launch price/)).toBeInTheDocument();
    expect(c.container.querySelector("svg")).not.toBeNull();
    c.unmount();
    // the captured buy, its sell variant and the buy two hours later: two hourly candles, so 1h is chosen
    const p = pageOf(true);
    const d = render(<TokenChart page={p} quoteUsd={2000} />);
    const pressed = () => screen.getAllByRole("button").filter((x) => x.getAttribute("aria-pressed") === "true").map((x) => x.textContent);
    expect(pressed()).toEqual(["1h", "Candles", "Price"]);
    expect(d.container.querySelector("svg")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Market cap" }));
    expect(pressed()).toEqual(["1h", "Candles", "Market cap"]);
    expect(screen.getByLabelText(/market cap in USD/)).toBeInTheDocument();
    // a day holds every trade: one candle, placeholder frame with reference line
    const day = Math.floor(AT / 86_400) * 86_400;
    d.unmount();
    const e = render(<TokenChart page={{ ...p, points: [{ at: day + 10, price: 1 }, { at: day + 4000, price: 2 }] }} />);
    expect(pressed()).toEqual(["1h", "Candles", "Price"]);
    await userEvent.click(screen.getByRole("button", { name: "Market cap" }));
    expect(screen.getByLabelText(/market cap in ETH/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "1d" }));
    expect(pressed()).toEqual(["1d", "Candles", "Market cap"]);
    expect(screen.getByText("Every trade so far falls in one 1d candle — pick a finer frame.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Each trade" }));
    expect(e.container.querySelector("svg")).not.toBeNull();
    e.unmount();
    render(<TokenChart page={{ ...p, coin: { ...p.coin, symbol: null, quoteSymbol: null } }} />);
    expect(screen.getByLabelText(/^Coin price in , from its pool's opening price/)).toBeInTheDocument();
  });

  it("TokenChart: falls back to GeckoTerminal OHLCV when index is missing, and shows live slot0 reference price otherwise", async () => {
    const pool = "0x1111111111111111111111111111111111111111111111111111111111111111";
    const ohlcv = {
      data: {
        attributes: {
          ohlcv_list: [
            [AT, 0.00001, 0.000012, 0.000009, 0.000011, 100],
            [AT + 3600, 0.000011, 0.000015, 0.00001, 0.000014, 200],
          ],
        },
      },
    };
    net({
      get: (u) => {
        if (u.startsWith("https://api.dexscreener.com/tokens/v1/base/")) {
          return [{ baseToken: { address: COINS.eth, symbol: "TEST", name: "Test" }, pairAddress: pool, priceUsd: "0.000014", liquidity: { usd: 5000 } }];
        }
        if (u.startsWith("/api/charts/ohlcv?")) return ohlcv;
        return undefined;
      },
    });
    const a = render(<TokenChart page={{ problem: "not indexed yet" }} token={COINS.eth} symbol="TEST" value={value()} quoteUsd={2000} />);
    await waitFor(() => expect(screen.getByText("GeckoTerminal · USD")).toBeInTheDocument());
    expect(screen.getByLabelText(/TEST price in USD, from GeckoTerminal/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Market cap" }));
    expect(screen.getByLabelText(/TEST market cap in USD, from GeckoTerminal/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "1D" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "1D" })).toHaveAttribute("aria-pressed", "true"));
    a.unmount();

    // GeckoTerminal fallback without explicit symbol falls back to "Coin"
    const a2 = render(<TokenChart page={{ problem: "not indexed yet" }} token={COINS.eth} value={value()} quoteUsd={2000} />);
    await waitFor(() => expect(screen.getByLabelText(/Coin price in USD, from GeckoTerminal/)).toBeInTheDocument());
    a2.unmount();

    // GeckoTerminal returns no pool: falls back to live Uniswap v4 slot0 reference line (USD and quote-only)
    net({ get: (u) => (u.startsWith("https://api.dexscreener.com/tokens/v1/base/") ? [] : undefined) });
    const b = render(<TokenChart page={{ problem: "not indexed yet" }} token={COINS.eth} symbol="TEST" value={value()} quoteUsd={2000} />);
    await waitFor(() => expect(screen.getByText("Live pool reference · Uniswap v4")).toBeInTheDocument());
    expect(screen.getByText("No chart: not indexed yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Market cap" }));
    expect(b.container.querySelector("svg")).toHaveTextContent("$10,000.00");
    b.unmount();

    // GeckoTerminal errors and quoteUsd is null: still renders frame with quote-denominated slot0 price
    net({ get: (u) => (u.startsWith("https://api.dexscreener.com/tokens/v1/base/") ? DOWN : undefined) });
    const c = render(<TokenChart page={pageOf()} token={COINS.eth} value={value({ quoteUsd: null })} quoteUsd={null} />);
    await waitFor(() => expect(screen.getByText("Live pool reference · Uniswap v4")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Market cap" }));
    expect(c.container.querySelector("svg")).toHaveTextContent("5 ETH");
    c.unmount();
  });

  it("bucket and autoFrame", () => {
    const h = 3600 * 1000;
    const pts = [{ at: h / 1000, price: 2 }, { at: h / 1000 + 10, price: 5 }, { at: h / 1000 + 20, price: 1 }, { at: h / 1000 + 400, price: 3 }];
    expect(bucket(pts, 0).map((x) => x.t)).toEqual([h, h + 10_000, h + 20_000, h + 400_000]);
    expect(bucket(pts, 300)).toEqual([{ t: h, o: 2, h: 5, l: 1, c: 1 }, { t: h + 300_000, o: 3, h: 3, l: 3, c: 3 }]);
    expect(bucket(pts, 3600)).toEqual([{ t: h, o: 2, h: 5, l: 1, c: 3 }]);
    expect(autoFrame(pts)).toBe("5m");
    expect(autoFrame([pts[0]!, { at: 2 * 3600, price: 1 }])).toBe("1h");
    expect(autoFrame(pts.slice(0, 2))).toBe("trades");
    expect(FRAMES.map((f) => f.id)).toEqual(["trades", "5m", "1h", "1d"]);
  });

  it("TokenInfo: fees known, split 80/20; the coin's own fees only when there are some; nothing read", () => {
    const a = render(<TokenInfo page={pageOf(true)} creator={COINS.owner} launchedAt={AT} quoteUsd={2000} />);
    const info = screen.getByLabelText("Info");
    expect(info).toHaveTextContent("Fees earned (in ETH)");
    expect(info).toHaveTextContent(/Creator's share80% — 0\.0₇\d+ ETH/);
    expect(info).not.toHaveTextContent("<$0.01");
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

describe("coin analytics blocks", () => {
  it("states when DexScreener has no market", async () => {
    net({ get: (u) => u.startsWith("https://api.dexscreener.com/tokens/v1/base/") ? [] : undefined });
    render(<CoinMoves token={COINS.eth} />);
    expect(await screen.findByText(/DexScreener has no pair/)).toBeInTheDocument();
  });

  it("renders the fee route and the generic ledger", () => {
    render(<FeeLedger page={pageOf(true)} fee={{ fee: 10_000, opening: null }} referrer={{ referrer: null }} />);
    expect(screen.getByLabelText("Fee ledger")).toHaveTextContent("1% per trade");
    expect(screen.getByLabelText("Fee ledger")).toHaveTextContent("Creator 80% · Protocol ~20%");
    expect(screen.getByLabelText("Fee ledger")).toHaveTextContent("Collected quote:");
  });
});

describe("TokenTabs", () => {
  const HOLDERS = `${BLOCKSCOUT}/tokens/${COINS.eth}/holders`;

  it("Transactions: all, buys, sells; a wallet looked up or a dash", async () => {
    render(<TokenTabs token={COINS.eth} page={pageOf(true)} now={AT + 7300} />);
    const rows = () => screen.getAllByRole("row").slice(1);
    expect(rows()).toHaveLength(3);
    expect(rows()[0]).toHaveTextContent(/1m ago.*Buy.*—/);
    expect(rows()[1]).toHaveTextContent(/Sell.*0xD5C1…3FAB/);
    await userEvent.click(screen.getByRole("button", { name: "Buy" }));
    expect(rows()).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Sell" }));
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
    await userEvent.click(screen.getByRole("button", { name: "Sell" }));
    expect(screen.getByText("No trades match this filter.")).toBeInTheDocument();
    b.unmount();
    const c = render(<TokenTabs token={COINS.eth} page="reading" now={AT} />);
    expect(screen.getByText("Reading the trades…")).toBeInTheDocument();
    c.unmount();
    net({ get: (u) => (u.startsWith("https://api.dexscreener.com/tokens/v1/base/") ? [] : undefined) });
    render(<TokenTabs token={COINS.eth} page={{ problem: "down" }} now={AT} />);
    expect(await screen.findByText("Not checked — the trades could not be read: down")).toBeInTheDocument();
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

  it("renders optional Fees, Top traders, and Pool tabs cleanly", async () => {
    render(
      <TokenTabs
        token={COINS.eth}
        page={pageOf(true)}
        now={AT}
        feesTab={<p>Fees panel body</p>}
        poolTab={<p>Pool details body</p>}
        disclosuresTab={<p>Disclosures panel body</p>}
      />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Fees" }));
    expect(screen.getByText("Fees panel body")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Top traders" }));
    expect(screen.getByRole("table", { name: "Top traders" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Pool" }));
    expect(screen.getByText("Pool details body")).toBeInTheDocument();
    expect(screen.getByText("Disclosures panel body")).toBeInTheDocument();
  });
});

describe("TokenGuarantees & TokenPosition", () => {
  it("shows version, fee status, and active v3 anti-sniper countdown", () => {
    const v3 = CONTRACTS.launchFactoryV3!;
    const a = render(<TokenGuarantees factory={v3} fee={{ fee: 10_000, opening: { startFee: 500_000, window: 15, openedAt: 1000 } }} launchedAt={1000} now={1005} />);
    expect(screen.getByLabelText("Contract guarantees")).toHaveTextContent(/v3.*1% fee.*anti-sniper active · 10s left \(50% → 1%\)/);
    a.unmount();
    const b = render(<TokenGuarantees factory={COINS.v2} fee="reading" launchedAt={null} now={1005} />);
    expect(screen.getByLabelText("Contract guarantees")).toHaveTextContent(/v2.*fee reading/);
    b.unmount();
    const c = render(<TokenGuarantees factory={COINS.v1} fee={{ problem: "rpc down" }} launchedAt={1000} now={1005} />);
    expect(screen.getByLabelText("Contract guarantees")).toHaveTextContent(/v1.*fee not checked/);
    c.unmount();
  });

  it("reads connected wallet balance, shows % of supply, Est. value, Sell shortcut, zero balance, and RPC failure", async () => {
    const raw = (2_500_000n * 10n ** 18n).toString(16).padStart(64, "0");
    net({ rpc: (m) => (m === "eth_call" ? `0x${raw}` : undefined) });
    const onSell = vi.fn();
    const a = render(<TokenPosition token={COINS.eth} symbol="TEST" account={COINS.owner} page={pageOf(true)} value={value()} onSell={onSell} />);
    expect(screen.getByText("Reading your TEST balance…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Your position")).toHaveTextContent(/2,500,000 TEST.*0\.25% of supply.*Est\. value:/));
    await userEvent.click(screen.getByRole("button", { name: "Sell TEST" }));
    expect(onSell).toHaveBeenCalledTimes(1);
    a.unmount();

    // tiny dust balance (<0.01% of supply) and poolValue fallback when page is unread
    const dust = (1000n * 10n ** 18n).toString(16).padStart(64, "0");
    net({ rpc: (m) => (m === "eth_call" ? `0x${dust}` : undefined) });
    const b = render(<TokenPosition token={COINS.eth} symbol="TEST" account={COINS.owner} page="reading" value={value({ quoteUsd: null })} />);
    await waitFor(() => expect(screen.getByLabelText("Your position")).toHaveTextContent(/<0\.01% of supply/));
    b.unmount();

    // zero balance
    net({ rpc: (m) => (m === "eth_call" ? `0x${"0".repeat(64)}` : undefined) });
    const c = render(<TokenPosition token={COINS.eth} symbol="TEST" account={COINS.owner} page="reading" value={null} />);
    await waitFor(() => expect(screen.getByLabelText("Your position")).toHaveTextContent(/0 TEST.*no balance/));
    c.unmount();

    // RPC error shows amber not checked
    net({ rpc: (m) => (m === "eth_call" ? DOWN : undefined) });
    render(<TokenPosition token={COINS.eth} symbol="TEST" account={COINS.owner} page="reading" value={null} />);
    expect(await screen.findByText(/^Position not checked —/)).toBeInTheDocument();
  });

  it("renders Top traders with buys/sells and falls back to GeckoTerminal live trades when index fails", async () => {
    const traderA = "0x1111111111111111111111111111111111111111";
    const traderB = "0x2222222222222222222222222222222222222222";
    const poolAddr = "0x3333333333333333333333333333333333333333";
    net({
      get: (u) => {
        if (u.startsWith("https://api.dexscreener.com/")) {
          return [{ baseToken: { address: COINS.eth, symbol: "TEST", name: "Test" }, pairAddress: poolAddr, priceUsd: "0.01", liquidity: { usd: 5000 } }];
        }
        if (u.startsWith("/api/charts/trades")) {
          return {
            data: [
              {
                attributes: {
                  block_timestamp: "2026-10-02T07:59:00Z",
                  tx_hash: `0x${"aa".repeat(32)}`,
                  kind: "buy",
                  to_token_amount: "1000",
                  from_token_amount: "1",
                  volume_in_usd: "10",
                  price_to_in_usd: "0.01",
                  tx_from_address: traderA,
                },
              },
              {
                attributes: {
                  block_timestamp: "2026-10-02T07:58:00Z",
                  tx_hash: `0x${"bb".repeat(32)}`,
                  kind: "sell",
                  from_token_amount: "500",
                  to_token_amount: "0.5",
                  volume_in_usd: "5",
                  price_from_in_usd: "0.01",
                  tx_from_address: traderA,
                },
              },
              {
                attributes: {
                  block_timestamp: "2026-10-02T07:57:00Z",
                  tx_hash: `0x${"cc".repeat(32)}`,
                  kind: "sell",
                  from_token_amount: "200",
                  to_token_amount: "0.2",
                  volume_in_usd: "2",
                  price_from_in_usd: "0.01",
                  tx_from_address: traderB,
                },
              },
            ],
          };
        }
        return undefined;
      },
    });
    render(<TokenTabs token={COINS.eth} page={{ problem: "index down" }} now={Date.parse("2026-10-02T08:00:00Z") / 1000} symbol="TEST" />);
    expect(await screen.findByText("Live swaps · GeckoTerminal")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Top traders" }));
    const tbl = await screen.findByRole("table", { name: "Top traders" });
    expect(tbl).toHaveTextContent("1B / 1S");
    expect(tbl).toHaveTextContent("0B / 1S");
  });
});

describe("TokenWindow", () => {
  const POOL_ADDR = "0x4444444444444444444444444444444444444444";
  const TRADER_A = "0x1111111111111111111111111111111111111111";
  const TRADER_B = "0x2222222222222222222222222222222222222222";
  const DKNG_ON_BASE = (MARKETS_FX.coinbaseStocks as { tokens: { symbol: string; contract_address: string }[] }).tokens.find((t) => t.symbol === "DKNGc")!.contract_address;

  const poolsPayload = (token: string) => ({
    data: [
      {
        attributes: {
          address: POOL_ADDR,
          name: "NVDAc / USDC",
          reserve_in_usd: "150000",
          volume_usd: { h24: "50000" },
          base_token_price_usd: "235",
          price_change_percentage: { h24: "2.1" },
        },
        relationships: { base_token: { data: { id: `base_${token.toLowerCase()}` } }, dex: { data: { id: "uniswap_v4" } } },
      },
      {
        attributes: {
          address: "0x5555555555555555555555555555555555555555",
          name: "NVDAc / ETH",
          reserve_in_usd: null,
          volume_usd: { h24: null },
          base_token_price_usd: "234",
        },
        relationships: { base_token: { data: { id: `base_${token.toLowerCase()}` } }, dex: { data: { id: "aerodrome" } } },
      },
    ],
  });

  const tradesPayload = {
    data: [
      {
        attributes: {
          block_timestamp: "2026-10-02T07:59:00Z",
          tx_hash: `0x${"aa".repeat(32)}`,
          kind: "buy",
          to_token_amount: "10",
          from_token_amount: "2350",
          volume_in_usd: "2350",
          price_to_in_usd: "235",
          tx_from_address: TRADER_A,
        },
      },
      {
        attributes: {
          block_timestamp: "2026-10-02T07:58:00Z",
          tx_hash: `0x${"bb".repeat(32)}`,
          kind: "sell",
          from_token_amount: "4",
          to_token_amount: "940",
          volume_in_usd: "940",
          price_from_in_usd: "235",
          tx_from_address: TRADER_A,
        },
      },
      {
        attributes: {
          block_timestamp: "2026-10-02T07:57:00Z",
          tx_hash: `0x${"cc".repeat(32)}`,
          kind: "sell",
          from_token_amount: "5",
          to_token_amount: "1175",
          volume_in_usd: null,
          price_from_in_usd: null,
          tx_from_address: TRADER_B,
        },
      },
      {
        attributes: {
          block_timestamp: "2026-10-02T07:56:00Z",
          tx_hash: `0x${"dd".repeat(32)}`,
          kind: "buy",
          to_token_amount: "1",
          from_token_amount: "235",
          volume_in_usd: "235",
          price_to_in_usd: "235",
          tx_from_address: null,
        },
      },
    ],
  };

  const ohlcvPayload = {
    data: {
      attributes: {
        ohlcv_list: [
          [AT, 230, 236, 229, 235, 1000],
          [AT + 3600, 235, 240, 234, 238, 1200],
        ],
      },
    },
  };

  it("renders a Coinbase Base stock with pools, chart range fallback, Buy/Sell, Transactions, Holders, Top traders, and Pools tabs", async () => {
    const holdersBody = copy(FX.holdersDegen) as { items: { address: { hash: string; name: string | null } }[] };
    holdersBody.items[0]!.address.hash = UNISWAP_V4_POOL_MANAGER;
    let ohlcvCalls = 0;
    net({
      rpc: () => DOWN,
      get: (u) => {
        if (u === `${STOCKS_PATH}/base`) return MARKETS_FX.coinbaseStocks;
        if (u.startsWith("https://api.dexscreener.com/tokens/v1/base/")) return MARKETS_FX.dexBase;
        if (u.startsWith(`${CHARTS_PATH}/pools`)) return poolsPayload(NVDA_ON_BASE);
        if (u.startsWith(`${CHARTS_PATH}/trades`)) return tradesPayload;
        if (u.startsWith(`${CHARTS_PATH}/ohlcv`)) {
          ohlcvCalls++;
          return ohlcvCalls === 1 ? DOWN : ohlcvPayload;
        }
        if (u === `${BLOCKSCOUT}/tokens/${NVDA_ON_BASE}/holders`) return holdersBody;
        return undefined;
      },
    });
    const open = vi.fn();
    const onTitle = vi.fn();
    render(
      <MemoryRouter>
        <OpenWindowProvider open={open as never}>
          <WalletProvider>
            <TokenWindow address={NVDA_ON_BASE} onTitle={onTitle} />
          </WalletProvider>
        </OpenWindowProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(onTitle).toHaveBeenCalledWith("NVDA"));
    expect(screen.getByText("Coinbase Stock · Base 8453")).toBeInTheDocument();
    expect(await screen.findByLabelText("Top DEX pools")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("img", { name: "NVDAc price in USD" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "← Stocks" }));
    expect(open).toHaveBeenCalledWith("stocks");
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(open).toHaveBeenCalledWith("wallet");

    await userEvent.click(screen.getByRole("button", { name: "Sell NVDA" }));
    await userEvent.click(screen.getByRole("button", { name: "ETH" }));
    await userEvent.click(screen.getByRole("button", { name: "Buy NVDA" }));
    await userEvent.click(screen.getByRole("button", { name: "USDC" }));

    await userEvent.click(screen.getByRole("button", { name: "7D" }));
    await userEvent.click(screen.getByRole("button", { name: "Line" }));
    await userEvent.click(screen.getByRole("button", { name: "Candles" }));

    await userEvent.click(screen.getByRole("button", { name: "Buy" }));
    await userEvent.click(screen.getByRole("button", { name: "Sell" }));
    await userEvent.click(screen.getByRole("button", { name: "All" }));

    await userEvent.click(screen.getByRole("tab", { name: "Holders" }));
    const hList = await screen.findByRole("list", { name: "Top holders" });
    expect(hList).toHaveTextContent("— Uniswap v4 PoolManager");
    expect(hList).toHaveTextContent("— TransparentUpgradeableProxy");

    await userEvent.click(screen.getByRole("tab", { name: "Top traders" }));
    const tTable = screen.getByRole("table", { name: "Top traders" });
    expect(tTable).toHaveTextContent("1B / 1S");
    expect(tTable).toHaveTextContent("0B / 1S");

    await userEvent.click(screen.getByRole("tab", { name: "Pools" }));
    expect(screen.getByRole("table", { name: "Token DEX pools" })).toBeInTheDocument();
    expect(screen.getByLabelText("Pool details")).toHaveTextContent("Coinbase Tokenized Stocks");
  });

  it("renders a paused stock, WETH, known crypto, and unknown ERC-20 with empty/error states", async () => {
    net({
      rpc: () => DOWN,
      get: (u) => {
        if (u === `${STOCKS_PATH}/base`) return MARKETS_FX.coinbaseStocks;
        if (u.startsWith("https://api.dexscreener.com/")) return [];
        if (u.startsWith(`${CHARTS_PATH}/pools`)) return DOWN;
        if (u.startsWith(`${BLOCKSCOUT}/tokens/`)) return DOWN;
        return undefined;
      },
    });
    const a = render(
      <MemoryRouter>
        <TokenWindow address={DKNG_ON_BASE} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/transfers are paused on its token contract/)).toBeInTheDocument();
    expect(screen.getByText(/No chart candles available/)).toBeInTheDocument();
    expect(screen.getByText("No recent DEX swaps indexed for this pool yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Holders" }));
    expect(await screen.findByText(/^Holders not checked —/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Top traders" }));
    expect(screen.getByText("No trader wallets indexed yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Pools" }));
    expect(screen.getByLabelText("Pool details")).toHaveTextContent("not read");
    a.unmount();

    net({
      rpc: () => DOWN,
      get: (u) => {
        if (u === `${STOCKS_PATH}/base`) return { tokens: [] };
        if (u.startsWith("https://api.dexscreener.com/")) return [];
        if (u.startsWith(`${CHARTS_PATH}/pools`)) return { data: [] };
        if (u.startsWith(`${BLOCKSCOUT}/tokens/`)) return { items: [] };
        return undefined;
      },
    });
    const open = vi.fn();
    const onWethTitle = vi.fn();
    const b = render(
      <MemoryRouter>
        <OpenWindowProvider open={open as never}>
          <TokenWindow address={WETH.address} onTitle={onWethTitle} />
        </OpenWindowProvider>
      </MemoryRouter>,
    );
    await screen.findByText("Base 8453");
    expect(onWethTitle).toHaveBeenCalledWith("ETH");
    await userEvent.click(screen.getByRole("button", { name: "← Markets" }));
    expect(open).toHaveBeenCalledWith("markets");
    await userEvent.click(screen.getByRole("tab", { name: "Holders" }));
    expect(await screen.findByText("No holders indexed yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Pools" }));
    expect(screen.getByLabelText("Pool details")).toHaveTextContent("not read");
    b.unmount();

    const c = render(
      <MemoryRouter>
        <TokenWindow address={CBBTC.address} />
      </MemoryRouter>,
    );
    await screen.findByText("cbBTC (cbBTC)");
    c.unmount();

    const unknownAddr = "0x9999999999999999999999999999999999999999";
    const d = render(
      <MemoryRouter>
        <TokenWindow address={unknownAddr} />
      </MemoryRouter>,
    );
    await screen.findByText("0x9999…9999 (0x9999…9999)");
    d.unmount();

    // 4) Connect wallet without openWindow
    const e = render(
      <MemoryRouter>
        <WalletProvider>
          <TokenWindow address={CBBTC.address} />
        </WalletProvider>
      </MemoryRouter>,
    );
    await screen.findByText("cbBTC (cbBTC)");
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    e.unmount();

    // 5) Launch-ready stock shows Launch with NVDA button
    const enabledQuote = `0x${"0".repeat(63)}1${"0".repeat(64)}`;
    net({
      rpc: (m) => (m === "eth_call" ? enabledQuote : undefined),
      get: (u) => {
        if (u === `${STOCKS_PATH}/base`) return MARKETS_FX.coinbaseStocks;
        if (u.startsWith("https://api.dexscreener.com/")) return MARKETS_FX.dexBase;
        if (u.startsWith(`${CHARTS_PATH}/pools`)) return { data: [] };
        if (u.startsWith(`${CHARTS_PATH}/trades`)) return { data: [] };
        if (u.startsWith(`${CHARTS_PATH}/ohlcv`)) return DOWN;
        return undefined;
      },
    });
    const openLaunch = vi.fn();
    const f = render(
      <MemoryRouter>
        <OpenWindowProvider open={openLaunch as never}>
          <TokenWindow address={NVDA_ON_BASE} />
        </OpenWindowProvider>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Launch with NVDA" }));
    expect(openLaunch).toHaveBeenCalledWith("launch", { pair: NVDA_ON_BASE });
    f.unmount();

    // 6) AMD stock (nav: null in Pools tab) + US restricted region (stock && closed banner) + no factory
    const { forgetRegion } = await import("@/lib/region");
    const AMD_ON_BASE = "0xB2000000000000000000000d8Ce462E99ee7A47B";
    const prevV3 = CONTRACTS.launchFactoryV3;
    const prevV2 = CONTRACTS.launchFactory;
    (CONTRACTS as { launchFactoryV3: string | null; launchFactory: string | null }).launchFactoryV3 = null;
    (CONTRACTS as { launchFactoryV3: string | null; launchFactory: string | null }).launchFactory = null;
    forgetRegion();
    net({
      rpc: () => DOWN,
      get: (u) => {
        if (u === "/api/region") return { country: "US" };
        if (u === `${STOCKS_PATH}/base`) return MARKETS_FX.coinbaseStocks;
        if (u.startsWith("https://api.dexscreener.com/")) return [];
        if (u.startsWith(`${CHARTS_PATH}/pools`)) return { data: [] };
        return undefined;
      },
    });
    const g = render(
      <MemoryRouter>
        <TokenWindow address={AMD_ON_BASE} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/not offered where you are/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Pools" }));
    expect(screen.getByLabelText("Pool details")).toHaveTextContent("not published");
    g.unmount();
    (CONTRACTS as { launchFactoryV3: string | null; launchFactory: string | null }).launchFactoryV3 = prevV3;
    (CONTRACTS as { launchFactoryV3: string | null; launchFactory: string | null }).launchFactory = prevV2;
    forgetRegion();

    // 7) Launched coin resolution -> CoinPage + onTitle + onBack
    const { chainRoutes, getRoutes, T: LAUNCHED_T } = await import("./launchpadChain");
    (CONTRACTS as { launchFactoryV3: string | null; launchFactory: string | null }).launchFactoryV3 = null;
    (CONTRACTS as { launchFactoryV3: string | null; launchFactory: string | null }).launchFactory = null;
    try {
      net({
        rpc: chainRoutes(),
        get: (u) => (u === `${STOCKS_PATH}/base` ? { tokens: [] } : getRoutes()(u)),
      });
      const openCoin = vi.fn();
      const onCoinTitle = vi.fn();
      const h = render(
        <MemoryRouter>
          <OpenWindowProvider open={openCoin as never}>
            <WalletProvider>
              <TokenWindow address={LAUNCHED_T} onTitle={onCoinTitle} />
            </WalletProvider>
          </OpenWindowProvider>
        </MemoryRouter>,
      );
      await waitFor(() => expect(onCoinTitle).toHaveBeenCalledWith("test"));
      await userEvent.click(await screen.findByRole("button", { name: "← All coins" }));
      expect(openCoin).toHaveBeenCalledWith("coins");
      h.unmount();
    } finally {
      (CONTRACTS as { launchFactoryV3: string | null; launchFactory: string | null }).launchFactoryV3 = prevV3;
      (CONTRACTS as { launchFactoryV3: string | null; launchFactory: string | null }).launchFactory = prevV2;
    }

    // 8) Unknown ERC-20 where chainToken succeeds + unmount mid-fetch
    const customAddr = "0x8888888888888888888888888888888888888888";
    const { contractAt, ethCalls } = await import("./net");
    const { erc20Abi } = await import("viem");
    const customRpc = ethCalls({ [customAddr]: contractAt(erc20Abi, { name: "Custom Token", symbol: "CUST", decimals: 6, totalSupply: 1_000_000n }) });
    net({
      rpc: (m, p) => customRpc(m, p) ?? DOWN,
      get: (u) => {
        if (u === `${STOCKS_PATH}/base`) return { tokens: [] };
        if (u.startsWith("https://api.dexscreener.com/")) return [];
        if (u.startsWith(`${CHARTS_PATH}/pools`)) return { data: [] };
        if (u.startsWith("https://base.blockscout.com/")) return { items: [] };
        return undefined;
      },
    });
    const i = render(
      <MemoryRouter>
        <TokenWindow address={customAddr} />
      </MemoryRouter>,
    );
    await screen.findByText("CUST (CUST)");
    i.unmount();

    // Unmount mid-fetch
    render(
      <MemoryRouter>
        <TokenWindow address={NVDA_ON_BASE} />
      </MemoryRouter>,
    ).unmount();
    await act(async () => {});
  });

  it("covers remaining TokenPage branches (TokenStats market trades, TokenChart Line & Tier-3 range, TopTraders reading/empty)", async () => {
    const mkt = { pair: POOL_ADDR, dex: "uniswap", base: COINS.eth, quote: "USDC", priceUsd: 0.01, liquidityUsd: 5000, volume24h: 1000, buys24h: 3, sells24h: null, change: { m5: null, h1: null, h6: null, h24: null }, createdAt: null, url: null, symbol: "TEST", marketCap: null };
    const s1 = render(<TokenStats page={{ problem: "x" }} value={null} holders={null} market={mkt} />);
    expect(screen.getByLabelText("Numbers")).toHaveTextContent("3 trades · DexScreener");
    s1.unmount();
    const s2 = render(<TokenStats page={{ problem: "x" }} value={null} holders={null} market={{ ...mkt, buys24h: null, sells24h: 2 }} />);
    expect(screen.getByLabelText("Numbers")).toHaveTextContent("2 trades · DexScreener");
    s2.unmount();

    // TokenChart: click Line button + Tier 3 range button + auto-fallback 15m -> 1D
    let calls = 0;
    net({
      get: (u) => {
        if (u.startsWith("https://api.dexscreener.com/")) return [{ baseToken: { address: COINS.eth, symbol: "TEST", name: "Test" }, pairAddress: POOL_ADDR, priceUsd: "0.01", liquidity: { usd: 5000 } }];
        if (u.startsWith(`${CHARTS_PATH}/ohlcv`)) return ++calls === 1 ? DOWN : ohlcvPayload;
        return undefined;
      },
    });
    const c1 = render(<TokenChart page={{ problem: "down" }} token={COINS.eth} symbol="TEST" value={null} />);
    await waitFor(() => expect(screen.getByText("GeckoTerminal · USD")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Line" }));
    c1.unmount();

    net({ get: (u) => (u.startsWith("https://api.dexscreener.com/") ? [] : undefined) });
    const c2 = render(<TokenChart page={{ problem: "down" }} token={COINS.eth} symbol="TEST" value={null} />);
    await waitFor(() => expect(screen.getByText("No chart: down")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "7D" }));
    c2.unmount();

    // TokenTabs: Top traders while reading + empty traders
    const t1 = render(<TokenTabs token={COINS.eth} page="reading" now={AT} />);
    await userEvent.click(screen.getByRole("tab", { name: "Top traders" }));
    expect(screen.getByText("Reading top traders…")).toBeInTheDocument();
    t1.unmount();
    const p = pageOf();
    const t2 = render(<TokenTabs token={COINS.eth} page={{ ...p, trades: [] }} now={AT} />);
    await userEvent.click(screen.getByRole("tab", { name: "Top traders" }));
    expect(screen.getByText("No trader wallets indexed yet.")).toBeInTheDocument();
    t2.unmount();

    // TopTraders tie-breaker (equal volUsd = 0, different trade count) + TokenChart unmount mid-fetch
    const t3 = render(
      <TokenTabs
        token={COINS.eth}
        page={{
          ...p,
          trades: [
            { at: AT, tx: "0x1", side: "buy", tokens: 10, quote: 1, price: 0.1, fee: 0, feeIn: "quote", trader: TRADER_A },
            { at: AT + 1, tx: "0x2", side: "buy", tokens: 10, quote: 1, price: 0.1, fee: 0, feeIn: "quote", trader: TRADER_B },
            { at: AT + 2, tx: "0x3", side: "sell", tokens: 5, quote: 0.5, price: 0.1, fee: 0, feeIn: "quote", trader: TRADER_B },
          ],
        }}
        quoteUsd={null}
        now={AT + 10}
      />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Top traders" }));
    expect(screen.getByRole("table", { name: "Top traders" })).toHaveTextContent("1B / 1S");
    t3.unmount();

    net({ get: () => new Promise<Response>(() => {}) });
    render(<TokenChart page={{ problem: "down" }} token={COINS.eth} symbol="TEST" value={null} />).unmount();

    // TokenWindow: bestPool null + spot.pool present -> "Base" title, nav!=null & navAt=null in Pools tab, trader tie-break, and unmount mid-fetch
    const { forgetCatalog } = await import("@/adapters/http/markets");
    forgetCatalog();
    const noDateStocks = {
      tokens: [{ symbol: "NVDAc", name: "NVIDIA", contract_address: NVDA_ON_BASE, decimals: 8, multiplier: 1, nav_price: 230, nav_price_updated_at: null, paused_features: [] }],
    };
    net({
      rpc: () => DOWN,
      get: (u) => {
        if (u === `${STOCKS_PATH}/base`) return noDateStocks;
        if (u.startsWith("https://api.dexscreener.com/")) return MARKETS_FX.dexBase;
        if (u.startsWith(`${CHARTS_PATH}/pools`)) return { data: [] };
        if (u.startsWith(`${CHARTS_PATH}/ohlcv`)) return ohlcvPayload;
        if (u.startsWith(`${CHARTS_PATH}/trades`)) {
          return {
            data: [
              { attributes: { block_timestamp: "2026-10-02T07:59:00Z", tx_hash: "0x1", kind: "buy", to_token_amount: "1", volume_in_usd: null, tx_from_address: TRADER_A } },
              { attributes: { block_timestamp: "2026-10-02T07:58:00Z", tx_hash: "0x2", kind: "buy", to_token_amount: "1", volume_in_usd: null, tx_from_address: TRADER_B } },
              { attributes: { block_timestamp: "2026-10-02T07:57:00Z", tx_hash: "0x3", kind: "sell", from_token_amount: "1", volume_in_usd: null, tx_from_address: TRADER_B } },
            ],
          };
        }
        return undefined;
      },
    });
    const tw = render(
      <MemoryRouter>
        <TokenWindow address={NVDA_ON_BASE} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("img", { name: "NVDAc price in USD" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("tab", { name: "Top traders" }));
    expect(screen.getByRole("table", { name: "Top traders" })).toHaveTextContent("1B / 1S");
    await userEvent.click(screen.getByRole("tab", { name: "Pools" }));
    expect(screen.getByLabelText("Pool details")).toHaveTextContent("$230.00");
    tw.unmount();

    // Deferred unmount tests to cover all 4 `if (!live) return` guards in TokenWindow
    const { contractAt, ethCalls } = await import("./net");
    const { erc20Abi } = await import("viem");
    const { chainRoutes, getRoutes, T: LAUNCHED_T2 } = await import("./launchpadChain");

    // 1) Unknown ERC-20 unmounted while chainToken is pending (line 108)
    const customAddr2 = "0x7777777777777777777777777777777777777777";
    const customRpc2 = ethCalls({ [customAddr2]: contractAt(erc20Abi, { name: "Late", symbol: "LATE", decimals: 18, totalSupply: 1n }) });
    net({
      rpc: (m, p) => customRpc2(m, p) ?? DOWN,
      get: (u) => (u === `${STOCKS_PATH}/base` ? { tokens: [] } : u.startsWith("https://api.dexscreener.com/") ? [] : u.startsWith(`${CHARTS_PATH}/pools`) ? { data: [] } : undefined),
    });
    const baseFetch1 = globalThis.fetch;
    let rel1!: () => void;
    const gate1 = new Promise<void>((r) => (rel1 = r));
    vi.stubGlobal("fetch", (u: string, i?: RequestInit) => {
      if (typeof i?.body === "string" && i.body.toLowerCase().includes(`"to":"${customAddr2.toLowerCase()}"`)) {
        return gate1.then(() => baseFetch1(u, i));
      }
      return baseFetch1(u, i);
    });
    const u1 = render(<MemoryRouter><TokenWindow address={customAddr2} /></MemoryRouter>);
    for (let k = 0; k < 6; k++) await act(async () => {});
    u1.unmount();
    rel1();
    for (let k = 0; k < 4; k++) await act(async () => {});

    // 2) Launched coin unmounted while chainToken is pending (line 85)
    const prevV3b = CONTRACTS.launchFactoryV3;
    const prevV2b = CONTRACTS.launchFactory;
    (CONTRACTS as { launchFactoryV3: string | null; launchFactory: string | null }).launchFactoryV3 = null;
    (CONTRACTS as { launchFactoryV3: string | null; launchFactory: string | null }).launchFactory = null;
    try {
      net({
        rpc: chainRoutes(),
        get: (u) => (u === `${STOCKS_PATH}/base` ? { tokens: [] } : getRoutes()(u)),
      });
      const baseFetch2 = globalThis.fetch;
      let rel2!: () => void;
      const gate2 = new Promise<void>((r) => (rel2 = r));
      vi.stubGlobal("fetch", (u: string, i?: RequestInit) => {
        if (typeof i?.body === "string" && i.body.toLowerCase().includes(`"to":"${LAUNCHED_T2.toLowerCase()}"`)) {
          return gate2.then(() => baseFetch2(u, i));
        }
        return baseFetch2(u, i);
      });
      const u2 = render(<MemoryRouter><WalletProvider><TokenWindow address={LAUNCHED_T2} /></WalletProvider></MemoryRouter>);
      for (let k = 0; k < 6; k++) await act(async () => {});
      u2.unmount();
      rel2();
      for (let k = 0; k < 4; k++) await act(async () => {});
    } finally {
      (CONTRACTS as { launchFactoryV3: string | null; launchFactory: string | null }).launchFactoryV3 = prevV3b;
      (CONTRACTS as { launchFactoryV3: string | null; launchFactory: string | null }).launchFactory = prevV2b;
    }

    // 3) Stock MarketTokenDetail unmounted while launchPairs & candles are pending (lines 208 & 243)
    forgetCatalog();
    const enabledQuote3 = `0x${"0".repeat(63)}1${"0".repeat(64)}`;
    net({
      rpc: (m) => (m === "eth_call" ? enabledQuote3 : undefined),
      get: (u) => {
        if (u === `${STOCKS_PATH}/base`) return noDateStocks;
        if (u.startsWith("https://api.dexscreener.com/")) return MARKETS_FX.dexBase;
        if (u.startsWith(`${CHARTS_PATH}/pools`)) return { data: [] };
        if (u.startsWith(`${CHARTS_PATH}/trades`)) return { data: [] };
        if (u.startsWith(`${CHARTS_PATH}/ohlcv`)) return ohlcvPayload;
        return undefined;
      },
    });
    const baseFetch3 = globalThis.fetch;
    let rel3!: () => void;
    const gate3 = new Promise<void>((r) => (rel3 = r));
    vi.stubGlobal("fetch", (u: string, i?: RequestInit) => {
      if (String(u).startsWith(`${CHARTS_PATH}/ohlcv`) || (typeof i?.body === "string" && i.body.includes("0000000000000000000000000000000000000000"))) {
        return gate3.then(() => baseFetch3(u, i));
      }
      return baseFetch3(u, i);
    });
    const u3 = render(<MemoryRouter><TokenWindow address={NVDA_ON_BASE} /></MemoryRouter>);
    await screen.findByText("NVDA (NVDAc)");
    u3.unmount();
    rel3();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    forgetCatalog();
  });
});
