import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { forgetCatalog, parseBaseStocks } from "@/adapters/http/markets";
import type { IndexedCoinPage } from "@/adapters/http/indexer";
import type { PoolValue } from "@/skills/launchpad";
import { STOCKS_PATH } from "@/server/stocks";
import { coinMove, DAY_MS, PairExposure, splitMove } from "@/features/panels/PairExposure";
import { MARKETS_FX, NVDA_ON_BASE } from "./fixtures/markets";
import { settle } from "./helpers";
import { DOWN, net, useNet } from "./net";

useNet();
afterEach(() => forgetCatalog());

/**
 * "Paired with …" (Stocks Maxxing 1.1). DexScreener's and Coinbase's answers are the captures in
 * tests/fixtures/markets; the coin's price points are written here so each branch can be reached.
 */

const NOW = Date.UTC(2026, 10, 13, 12);
const nvdaPool: PoolValue = { quote: NVDA_ON_BASE, quoteSymbol: "NVDAc", quoteDecimals: 8, supplyInQuote: 50, quoteUsd: 230 };
const page = (points: { at: number; price: number }[], price: number | null = points.at(-1)?.price ?? null) =>
  ({ coin: { price }, points }) as unknown as IndexedCoinPage;

describe("the day's move, taken apart", () => {
  it("measures the coin against its quote from a price a day back, or from launch when younger", () => {
    expect(coinMove([], NOW)).toBeNull();
    expect(coinMove([{ at: NOW - DAY_MS - 1, price: 2 }, { at: NOW - 10, price: 3 }], NOW)).toBeCloseTo(0.5);
    expect(coinMove([{ at: NOW - 3600_000, price: 4 }, { at: NOW, price: 5 }], NOW)).toBeCloseTo(0.25);
    expect(coinMove([{ at: NOW - 10, price: 4 }], NOW)).toBeNull();
    expect(coinMove([{ at: NOW - 10, price: 0 }, { at: NOW, price: 5 }], NOW)).toBeNull();
  });

  it("puts the quote's move and the coin's together as the dollar move, and says nothing without both", () => {
    expect(splitMove(0.1, 0.1).dollars).toBeCloseTo(0.21);
    expect(splitMove(-0.1, 0.1).dollars).toBeCloseTo(-0.01);
    expect(splitMove(null, 0.1).dollars).toBeNull();
    expect(splitMove(0.1, null).dollars).toBeNull();
  });
});

describe("Paired with … on a coin's page", () => {
  function chain(dex: unknown = MARKETS_FX.dexBase) {
    net({ get: (url) => (url.startsWith("https://api.dexscreener.com/tokens/v1/base/") ? dex : url === `${STOCKS_PATH}/base` ? MARKETS_FX.coinbaseStocks : undefined) });
  }

  it("shows the stock's price and NAV, the coin in shares and dollars, and the day split", async () => {
    chain();
    render(<PairExposure page={page([{ at: NOW - DAY_MS - 5, price: 0.000001 }, { at: NOW - 5, price: 0.0000012 }])} value={nvdaPool} now={NOW} />);
    await settle();
    const s = screen.getByRole("region", { name: "Paired with NVDAc" });
    expect(s).toHaveTextContent(/NVDAc on Base\$\d[\d,.]* · 24h [+−]\d+\.\d\d% · Coinbase NAV \$231\.28/);
    expect(s).toHaveTextContent("1 coin0.0₅12 NVDAc = 0.0₅12 share of NVDA = $0.000276");
    expect(s).toHaveTextContent(/NVDA [+−]\d+\.\d\d% · the coin \+20\.00% against NVDAc → [+−]\d+\.\d\d% in dollars/);
    expect(s).toHaveTextContent("only for eligible persons outside the U.S.");
  });

  it("prices a coin from its pool when the index has no trade, and says the coin's own move was not read", async () => {
    chain();
    render(<PairExposure page={null} value={nvdaPool} now={NOW} />);
    await settle();
    const s = screen.getByRole("region");
    expect(s).toHaveTextContent("1 coin0.0₇5 NVDAc");
    expect(s).toHaveTextContent("the coin's own move against NVDAc: not read — its trades have not been indexed yet");
  });

  it("names a young coin's move since launch, and an ETH pair by ETH with no shares", async () => {
    chain();
    const eth: PoolValue = { quote: "0x0000000000000000000000000000000000000000", quoteSymbol: "ETH", quoteDecimals: 18, supplyInQuote: 3, quoteUsd: null };
    render(<PairExposure page={page([{ at: NOW - 3600_000, price: 0.000000003 }, { at: NOW, price: 0.000000006 }])} value={eth} now={NOW} />);
    await settle();
    const s = screen.getByRole("region", { name: "Paired with ETH" });
    expect(s).toHaveTextContent("(since launch)");
    expect(s).not.toHaveTextContent("share");
    expect(s).not.toHaveTextContent("eligible persons");
  });

  it("says DexScreener did not answer, and shows nothing without a pool value", async () => {
    chain(DOWN);
    const { container, rerender } = render(<PairExposure page={null} value={nvdaPool} now={NOW} />);
    expect(screen.getByRole("region")).toHaveTextContent("reading…");
    await settle();
    expect(screen.getByRole("region")).toHaveTextContent("not read — DexScreener did not answer");
    rerender(<PairExposure page={null} value={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("counts shares by the stock's multiplier, and reads a market list with no market for the quote as not read", async () => {
    const googl = [...parseBaseStocks(MARKETS_FX.coinbaseStocks).values()].find((x) => x.multiplier !== 1)!;
    chain([{ chainId: "base", dexId: "aero", baseToken: {}, priceUsd: "1" }]);
    render(<PairExposure page={null} value={{ ...nvdaPool, quote: googl.address, quoteSymbol: googl.symbol }} now={NOW} />);
    await settle();
    const s = screen.getByRole("region");
    expect(s).toHaveTextContent(`shares of ${googl.ticker}`);
    expect(s).toHaveTextContent("not read — DexScreener did not answer");
  });

  it("names a quote that is not on Coinbase's list by its symbol, with no shares", async () => {
    chain();
    render(<PairExposure page={null} value={{ ...nvdaPool, quote: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", quoteSymbol: "USDC" }} now={NOW} />);
    await settle();
    const s = screen.getByRole("region", { name: "Paired with USDC" });
    expect(s).not.toHaveTextContent("share");
    expect(s).not.toHaveTextContent("eligible persons");
  });

  it("drops answers that come after the page closed", async () => {
    chain();
    const { unmount } = render(<PairExposure page={null} value={nvdaPool} now={NOW} />);
    unmount();
    await settle();
  });
});
