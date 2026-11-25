import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarketRows } from "@/features/markets/Rows";
import type { MarketRow } from "@/features/markets/MarketsProvider";
import { THIN_MARKET_USD } from "@/config/markets";

/** The rows' tooltip says why a price or chart is missing, or that the market is thin — in that order. */
const row = (over: Partial<MarketRow>): MarketRow => ({
  key: "k", watch: { kind: "token", address: "0x1" } as MarketRow["watch"], label: "TOK", venue: "base", address: "0x1",
  price: 1, change: 1, series: null, staleSeconds: null, depth: null, pool: null, name: null, quote: null, stock: null, problem: null, chartProblem: null,
  ...over,
});

describe("MarketRows", () => {
  it("titles each row by its first missing thing, and leaves a healthy one untitled", () => {
    const pick = vi.fn();
    render(
      <MarketRows
        onPick={pick}
        selected="b"
        rows={[
          row({ key: "a", label: "A", problem: "no price" , chartProblem: "no chart read" }),
          row({ key: "b", label: "B", chartProblem: "no chart read" }),
          row({ key: "c", label: "C", depth: THIN_MARKET_USD - 1 }),
          row({ key: "d", label: "D", depth: THIN_MARKET_USD + 1 }),
        ]}
      />,
    );
    const titles = screen.getAllByRole("button").map((b) => b.getAttribute("title"));
    expect(titles[0]).toBe("no price");
    expect(titles[1]).toBe("no chart read");
    expect(titles[2]).toMatch(/^Thin market: \$/);
    expect(titles[3]).toBeNull();
    expect(screen.getByRole("button", { name: /^B/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /^C/ }));
    expect(pick).toHaveBeenCalledWith("c");
  });
});
