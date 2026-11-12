import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { row, type Report } from "@/skills/types";
import { collateralCard, collateralLink, collateralPost, CollateralShare, CollateralSvg, leadOf, LOANS_SHOWN } from "@/features/panels/CollateralShare";
import { ReportView } from "@/features/panels/ReportView";
import { settle } from "./helpers";
import { PulseContext } from "@/ui/usePulse";
import { fakePulse, pulse } from "./pulseFake";

const drawCard = vi.fn();
vi.mock("@/features/panels/BaseCard", async (orig) => ({ ...(await orig<typeof import("@/features/panels/BaseCard")>()), drawCard: (s: unknown) => drawCard(s) }));

/**
 * The Collateral Watch card, from rows written exactly as `collateralReport` writes them — the two
 * real wallets of tests/collateral.test.ts as they read on 2026-11-12.
 */

const WALLET = "0x3998F134d6aaa2b6a5f723806D00fD2bBBBCE891";
const AAVE = "0xDE09e16675B667B6aBB6d7910d6e009f630BcB96";
const head = (w: string) => row("Wallet", w, { href: `https://basescan.org/address/${w}` });

const morpho: Report = {
  title: "0x3998…E891 — Collateral Watch",
  rows: [
    head(WALLET),
    row("Aave V4 · MAG7", "no stock supplied and nothing borrowed", { tone: "ok" }),
    row("Morpho · AAPLc", "64.4 AAPLc ($22,839.44) backing 11,611.21 USDC · health 1.23 · liquidated at $288.44, 18.7% below its oracle's $354.60", { tone: "warn" }),
    row("Morpho · METAc", "34.81 METAc ($22,228.88) backing 10,610.44 USDC · health 1.31 · liquidated at $487.65, 23.6% below its oracle's $638.52", { tone: "ok" }),
    row("Morpho · NVDAc", "109.83 NVDAc ($19,418.70) backing 10,216.53 USDC · health 1.19 · liquidated at $148.83, 15.8% below its oracle's $176.80", { tone: "warn" }),
    row("Morpho · SPCXc", "1 SPCXc ($142.19), nothing borrowed", { tone: "ok" }),
  ],
  notes: [],
  sources: [],
};

const aave: Report = {
  title: "0xDE09…CB96 — Collateral Watch",
  rows: [
    head(AAVE),
    row("Health factor", "1.40 — liquidated below 1.00", { tone: "ok" }),
    row("Supplied · NVDAc", "6,871.09 NVDAc · $1,214,807.33 at Aave's price · counts 70% as collateral"),
    row("Liquidation · NVDAc", "$126.29 — 28.6% below Aave's $176.80 (other holdings unchanged)", { tone: "ok" }),
    row("Morpho", "no stock collateral and no debt in its stock markets", { tone: "ok" }),
  ],
  notes: [],
  sources: [],
};

describe("the Collateral Watch card", () => {
  it("lists each loan nearest-first, read off the report, and leads with the nearest", () => {
    const c = collateralCard(morpho)!;
    expect(c).toMatchObject({ wallet: WALLET, name: "0x3998…E891", tone: "warn", headline: "WATCH" });
    expect(c.loans.map((l) => [l.venue, l.symbol, l.value, l.health, l.distance])).toEqual([
      ["Morpho", "NVDAc", "$19,418", "1.19", 15.8],
      ["Morpho", "AAPLc", "$22,839", "1.23", 18.7],
      ["Morpho", "METAc", "$22,228", "1.31", 23.6],
    ]);
    expect(leadOf(c)).toBe("if NVDAc falls 15.8%, its Morpho loan is liquidated");
    const a = collateralCard(aave)!;
    expect(a.loans).toEqual([{ venue: "Aave V4", symbol: "NVDAc", value: "$1,214,807", health: "1.40", distance: 28.6, tone: "ok" }]);
    expect(a.headline).toBe("HEALTHY");
  });

  it("is no card for another report, a wallet with nothing borrowed, or a report without its wallet", () => {
    expect(collateralCard({ ...morpho, title: "Radar" })).toBeNull();
    expect(collateralCard({ ...morpho, rows: morpho.rows.filter((r) => r.label !== "Wallet") })).toBeNull();
    expect(collateralCard({ ...morpho, rows: [head(WALLET), row("Aave V4 · MAG7", "no stock supplied and nothing borrowed", { tone: "ok" })] })).toBeNull();
  });

  it("says a loan that can be liquidated now, one whose distance was not worked out, and fills what it could not read", () => {
    const now = collateralCard({ ...aave, rows: [head(AAVE), row("Health factor", "0.92 — liquidated below 1.00", { tone: "bad" }), row("Liquidation · NVDAc", "at or above Aave's $100.00 — the position can be liquidated now", { tone: "bad" })] })!;
    expect(now).toMatchObject({ tone: "bad", headline: "AT RISK" });
    expect(now.loans[0]).toMatchObject({ value: "—", distance: 0 });
    expect(leadOf(now)).toBe("NVDAc on Aave V4 can be liquidated now");
    const odd = collateralCard({ ...morpho, rows: [head(WALLET), row("Morpho · XYZc", "backing something", {})] })!;
    expect(odd.loans[0]).toEqual({ venue: "Morpho", symbol: "XYZc", value: "—", health: "—", distance: null, tone: "warn" });
    expect(leadOf(odd)).toBe("XYZc on Morpho: distance not worked out");
    const mixed = collateralCard({ ...aave, rows: [head(AAVE), aave.rows[1]!, row("Liquidation · NVDAc", "$126.29 — 28.6% below Aave's $176.80"), row("Morpho · XYZc", "backing something"), morpho.rows[4]!] })!;
    expect(mixed.loans.map((l) => [l.symbol, l.tone])).toEqual([["NVDAc", "warn"], ["NVDAc", "warn"], ["XYZc", "warn"]]);
    // an Aave liquidation row with no health factor above it is not a loan the card can describe
    expect(collateralCard({ ...aave, rows: [head(AAVE), aave.rows[3]!] })).toBeNull();
  });

  it("posts the lead with a link that watches the same wallet", () => {
    const c = collateralCard(morpho)!;
    expect(collateralLink(WALLET)).toBe(`${window.location.origin}/?do=research&run-research=${encodeURIComponent(`collateral ${WALLET}`)}`);
    expect(decodeURIComponent(collateralPost(c))).toContain("if NVDAc falls 15.8%, its Morpho loan is liquidated — a wallet's stock loans on Base");
  });

  it("draws the nearest distance big, a row per loan, 'and N more' past the room, and the block when known", () => {
    const c = collateralCard(morpho)!;
    const { rerender } = render(<CollateralSvg c={c} when="now" block={56_163_987} />);
    const svg = screen.getByRole("img", { name: "Collateral Watch card for 0x3998…E891" });
    expect(svg).toHaveTextContent("15.8%");
    expect(svg).toHaveTextContent("−23.6%");
    expect(svg).toHaveTextContent("block 56,163,987");
    const many = { ...c, loans: Array.from({ length: LOANS_SHOWN + 2 }, (_, i) => ({ ...c.loans[0]!, symbol: `S${i}` })) };
    rerender(<CollateralSvg c={many} when="now" />);
    expect(screen.getByRole("img")).toHaveTextContent("and 2 more");
    expect(screen.getByRole("img")).not.toHaveTextContent("block");
    rerender(<CollateralSvg c={{ ...c, tone: "bad", loans: [{ ...c.loans[0]!, distance: 0 }, { ...c.loans[1]!, distance: null }] }} when="now" />);
    expect(screen.getByRole("img")).toHaveTextContent("now");
    rerender(<CollateralSvg c={{ ...c, loans: [{ ...c.loans[0]!, distance: null }] }} when="now" />);
    expect(screen.getByRole("img")).toHaveTextContent("1 loan");
  });

  it("sits under a collateral report, folded, and downloads exactly the picture shown", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    drawCard.mockResolvedValueOnce({ toDataURL: () => "data:image/png;base64,AA" }).mockRejectedValueOnce(new Error("no canvas"));
    const live = fakePulse({ kind: "live", pulse: pulse(56_000_000), history: [] });
    render(
      <PulseContext.Provider value={live.store}>
        <ReportView report={morpho} />
      </PulseContext.Provider>,
    );
    expect(screen.getByText("Share as a picture")).toBeInTheDocument();
    await settle();
    const card = screen.getByRole("img", { name: "Collateral Watch card for 0x3998…E891" });
    expect(card).toHaveTextContent("block 56,000,000");
    fireEvent.click(screen.getByRole("button", { name: "Download picture" }));
    await settle();
    expect(drawCard).toHaveBeenCalledWith(card);
    expect(click).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Saved to your computer");
    fireEvent.click(screen.getByRole("button", { name: "Download picture" }));
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("no canvas");
  });

  it("shows nothing to share for a wallet with no loans", () => {
    render(<CollateralShare c={collateralCard(aave)!} />);
    expect(screen.getByRole("group", { name: "Share this collateral check" })).toBeInTheDocument();
    render(<ReportView report={{ ...aave, rows: [head(AAVE)] }} />);
    expect(screen.queryByText("Share as a picture")).toBeNull();
  });
});
