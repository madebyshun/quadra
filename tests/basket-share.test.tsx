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
    expect(svg).toHaveTextContent("3 assets, 1 wallet");
    expect(svg).toHaveTextContent("AAPLc15%0.33% impact");
    expect(svg).toHaveTextContent("impact —");
    expect(svg).toHaveTextContent("1,000 USDC · worst leg 3.40%");
    expect([...svg.querySelectorAll("text")].find((t) => t.textContent === "3.40% impact")).toHaveAttribute("fill", "#c62828");
  });

  it("says how many legs did not fit", () => {
    render(<BasketSvg c={{ lines: Array.from({ length: 10 }, (_, i) => ({ symbol: `S${i}`, weight: 10, impact: 0.1 })), total: "10" }} when="now" />);
    expect(screen.getByRole("img")).toHaveTextContent("and 2 more");
  });

  it("posts the basket with a link to build one, and downloads exactly the picture shown", async () => {
    expect(decodeURIComponent(basketPost(mag7))).toContain(`My basket on Base: AAPLc 15%, NVDAc 14%, PDDc 71% — every asset in my own wallet`);
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
});
