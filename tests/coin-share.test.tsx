import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BRAND } from "@/brand";
import { CoinShare, coinLink, postUrl, type CoinCard } from "@/features/panels/CoinShare";
import { settle } from "./helpers";

const drawCard = vi.fn();
vi.mock("@/features/panels/BaseCard", async (orig) => ({ ...(await orig<typeof import("@/features/panels/BaseCard")>()), drawCard: (s: unknown) => drawCard(s) }));

const c: CoinCard = { token: "0xb200000000000000000000694E3F5A4AB150b283", name: "Test", symbol: "TEST", pair: "AAPLc", cap: "$11,540.37" };

afterEach(() => vi.restoreAllMocks());

describe("a coin's share card", () => {
  it("links the post back to the coin's own page, and names what the launchpad guarantees", () => {
    expect(coinLink(c.token)).toBe(`${window.location.origin}/?do=coins&t=${c.token}`);
    const text = decodeURIComponent(postUrl(c).replace("https://x.com/intent/post?text=", ""));
    expect(text).toBe(`Test ($TEST) on Base, paired with AAPLc — launched on ${BRAND.name}: no admin, liquidity locked for good. ${coinLink(c.token)}`);
  });

  it("draws the coin, its pair, cap and contract, and offers the post as a link that opens elsewhere", () => {
    render(<CoinShare c={c} />);
    const card = screen.getByRole("img", { name: "Share card for TEST" });
    expect(card).toHaveTextContent("$TEST");
    expect(card).toHaveTextContent("Test · paired with AAPLc");
    expect(card).toHaveTextContent("$11,540.37");
    expect(card).toHaveTextContent("CA 0xb200…b283");
    const post = screen.getByRole("link", { name: "Post on X" });
    expect(post).toHaveAttribute("href", postUrl(c));
    expect(post).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("downloads exactly the picture shown, or says why it could not", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    drawCard.mockResolvedValueOnce({ toDataURL: () => "data:image/png;base64,AA" });
    render(<CoinShare c={c} />);
    fireEvent.click(screen.getByRole("button", { name: "Download picture" }));
    await settle();
    expect(drawCard).toHaveBeenCalledWith(screen.getByRole("img", { name: "Share card for TEST" }));
    expect(click).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Saved to your computer");
    drawCard.mockRejectedValueOnce(new Error("This browser cannot draw the picture — take a screenshot instead."));
    fireEvent.click(screen.getByRole("button", { name: "Download picture" }));
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("take a screenshot instead");
  });
});
