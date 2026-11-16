import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { basketLink, basketPost, BasketShare, BasketSvg } from "@/features/panels/BasketShare";
import { settle } from "./helpers";

const drawCard = vi.fn();
vi.mock("@/features/panels/BaseCard", async (orig) => ({ ...(await orig<typeof import("@/features/panels/BaseCard")>()), drawCard: (s: unknown) => drawCard(s) }));

/** The Treasury Basket card, from a quoted basket's legs. */

const mag7 = {
  lines: [
    { symbol: "AAPLc", weight: 15, impact: 0.33 },
    { symbol: "NVDAc", weight: 14, impact: null },
    { symbol: "PDDc", weight: 71, impact: 3.4 },
  ],
  total: "1,000",
};

describe("the Treasury Basket card", () => {
  it("draws each asset with its weight and quoted impact — red past 2% — and the worst leg", () => {
    render(<BasketSvg c={mag7} when="now" />);
    const svg = screen.getByRole("img", { name: "Treasury Basket card" });
    expect(svg).toHaveTextContent("3 assets, 1 basket");
    expect(svg).toHaveTextContent("AAPLc15%0.33% impact");
    expect(svg).toHaveTextContent("impact —");
    expect(svg).toHaveTextContent("1,000 USDC buy · max reported impact 3.40%");
    expect([...svg.querySelectorAll("text")].find((t) => t.textContent === "3.40% impact")).toHaveAttribute("fill", "#c62828");
  });

  it("shows all ten allowed target assets", () => {
    render(<BasketSvg c={{ lines: Array.from({ length: 10 }, (_, i) => ({ symbol: `S${i}`, weight: 10, impact: 0.1 })), total: "10" }} when="now" />);
    expect(screen.getByRole("img")).toHaveTextContent("S9");
  });

  it("posts the basket with a link to build one, and downloads exactly the picture shown", async () => {
    expect(decodeURIComponent(basketPost(mag7))).toContain(`My target basket on Base: AAPLc 15%, NVDAc 14%, PDDc 71% — target weights`);
    expect(decodeURIComponent(basketPost(mag7))).toContain(basketLink());
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    drawCard.mockResolvedValueOnce({ toDataURL: () => "data:image/png;base64,AA" }).mockRejectedValueOnce(new Error("no canvas"));
    render(<BasketShare c={mag7} />);
    fireEvent.click(screen.getByRole("button", { name: "Download picture" }));
    await settle();
    expect(drawCard).toHaveBeenCalledWith(screen.getByRole("img"));
    expect(click).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Saved to your computer");
    fireEvent.click(screen.getByRole("button", { name: "Download picture" }));
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("no canvas");
  });
  it("keeps skipped top-up assets in the full target and distinguishes confirmed, partial and quoted cards", () => {
    const full = { ...mag7, name: "My AI", state: "bought" as const, topUp: true, at: 0, link: "https://example.com/?do=basket&basket=recipe", lines: [...mag7.lines.map((l, i) => ({ ...l, weight: i === 0 ? 40 : 20 })), { symbol: "METAc", weight: 20, impact: null, skipped: true }] };
    const { rerender } = render(<BasketShare c={full} />);
    expect(screen.getByRole("img")).toHaveTextContent("4 assets, 1 wallet");
    expect(screen.getByRole("img")).toHaveTextContent("not bought this time");
    expect(screen.getByRole("img")).toHaveTextContent("Purchase confirmed on Base");
    expect(screen.getByRole("img")).toHaveTextContent("USDC top-up");
    expect(decodeURIComponent(basketPost(full))).toContain("Bought my basket");
    expect(decodeURIComponent(basketPost(full))).toContain(full.link);
    rerender(<BasketSvg c={{ ...full, state: "partial" }} when="now" />);
    expect(screen.getByRole("img")).toHaveTextContent("basket incomplete");
    rerender(<BasketSvg c={{ ...full, lines: Array.from({ length: 11 }, (_, i) => ({ symbol: `S${i}`, weight: 9, impact: null })) }} when="now" />);
    expect(screen.getByRole("img")).toHaveTextContent("and 1 more");
    rerender(<BasketSvg c={{ total: "0.5", lines: [{ symbol: "NVDAc", weight: 100, impact: null }] }} when="now" />);
    expect(screen.getByRole("img")).toHaveTextContent("1 asset, 1 basket");
    expect(screen.getByRole("img")).toHaveTextContent("impact not reported");
    expect(screen.getByRole("img")).toHaveTextContent("Some quote impacts unknown");
  });

});
