import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { row, type Report } from "@/skills/types";
import { depthCard, depthLink, depthPost, DepthShare, DepthSvg } from "@/features/panels/DepthShare";
import { ReportView } from "@/features/panels/ReportView";
import { settle } from "./helpers";
import { PulseContext } from "@/ui/usePulse";
import { fakePulse, pulse } from "./pulseFake";

const drawCard = vi.fn();
vi.mock("@/features/panels/BaseCard", async (orig) => ({ ...(await orig<typeof import("@/features/panels/BaseCard")>()), drawCard: (s: unknown) => drawCard(s) }));

/**
 * The Trade Depth card, built from report rows written exactly as `depthReport` writes them — PDDc's
 * as it read on 2026-11-12 (a $100k buy refused at 74.24%, a $100k sell at 71.22%).
 */

const TOKEN = "0xB200000000000000000000c8A7223510467D8563";
const pddc: Report = {
  title: "PDDc — Trade Depth",
  rows: [
    row("Depth", "Thin — buy $100,000, sell $100,000 move the price more than 2%", { tone: "bad" }),
    row("Token", `PDD Holdings Inc. (PDDc) — ${TOKEN}`, { href: `https://basescan.org/token/${TOKEN}` }),
    row("Buy $1,000", "0.01% impact (0.16% with fees) · 12.6199 PDDc", { tone: "ok" }),
    row("Buy $10,000", "0.20% impact (0.35% with fees) · 125.9498 PDDc", { tone: "ok" }),
    row("Buy $100,000", "74.24% impact — too much for the pools; Relay will not route it", { tone: "bad" }),
    row("Sell $1,000", "0.50% impact (0.65% with fees) · $993.58 in USDC", { tone: "ok" }),
    row("Sell $10,000", "0.60% impact (0.75% with fees) · $9,925.34 in USDC", { tone: "warn" }),
    row("Sell $100,000", "not quoted — Relay: Could not process request.", { tone: "warn" }),
    row("Pool · Aerodrome vs USDC", "$50,828.58 liquidity"),
  ],
  notes: [],
  sources: [],
};

describe("the Trade Depth card", () => {
  it("lays out six sizes from the report — a refused size red with its number, an unquoted one said so", () => {
    const c = depthCard(pddc)!;
    expect(c).toMatchObject({ token: TOKEN, symbol: "PDDc", tone: "bad", headline: "THIN", pool: "Deepest pool: $50,828.58 on Aerodrome vs USDC" });
    expect(c.buys.map((x) => [x.label, x.figure, x.tone, x.note])).toEqual([
      ["$1,000", "0.01%", "ok", "price impact"],
      ["$10,000", "0.20%", "ok", "price impact"],
      ["$100,000", "74.24%", "bad", "refused — too thin"],
    ]);
    expect(c.sells[2]).toEqual({ label: "$100,000", tone: "warn", figure: "—", note: "not quoted" });
  });

  it("is no card for another report, or a depth report without its token or rows", () => {
    expect(depthCard({ ...pddc, title: "Radar" })).toBeNull();
    expect(depthCard({ ...pddc, rows: pddc.rows.filter((r) => r.label !== "Token") })).toBeNull();
    expect(depthCard({ ...pddc, rows: [] })).toBeNull();
    const plain = depthCard({ ...pddc, rows: [row("Depth", "x"), row("Token", "t", { href: "https://basescan.org/token/0x1" }), row("Buy $1,000", "0.10% impact", {})] })!;
    expect(plain).toMatchObject({ tone: "warn", headline: "PARTLY QUOTED", pool: null });
    expect(plain.buys[0]!.tone).toBe("warn");
  });

  it("posts the refused size, or the headline, with a link that runs the same check", () => {
    const c = depthCard(pddc)!;
    expect(depthLink(TOKEN)).toBe(`${window.location.origin}/?do=research&run-research=${encodeURIComponent(`depth ${TOKEN}`)}`);
    expect(decodeURIComponent(depthPost(c))).toContain("$PDDc on Base: a $100,000 order is refused at 74.24% price impact");
    const deep = depthCard({ ...pddc, rows: [row("Depth", "No size", { tone: "ok" }), pddc.rows[1]!, row("Buy $1,000", "0.01% impact", { tone: "ok" })] })!;
    expect(decodeURIComponent(depthPost(deep))).toContain("$PDDc on Base: deep enough —");
  });

  it("draws the stamp, the sizes, a logo or the first letter, and the block", () => {
    const c = depthCard(pddc)!;
    const { rerender } = render(<DepthSvg c={c} when="now" block={56_158_644} />);
    const svg = screen.getByRole("img", { name: "Trade Depth card for PDDc" });
    expect(svg).toHaveTextContent("THIN");
    expect(svg).toHaveTextContent("74.24%");
    expect(svg).toHaveTextContent("block 56,158,644");
    expect(svg.querySelector("image")).toBeNull();
    rerender(<DepthSvg c={{ ...c, tone: "ok", headline: "DEEP ENOUGH", pool: null }} logo="data:image/png;base64,AA" when="now" />);
    expect(screen.getByRole("img").querySelector("image")).not.toBeNull();
    expect(screen.getByRole("img")).not.toHaveTextContent("Deepest pool");
  });

  it("sits under a depth report, folded, and downloads exactly the picture shown", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 404 }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    drawCard.mockResolvedValueOnce({ toDataURL: () => "data:image/png;base64,AA" }).mockRejectedValueOnce(new Error("no canvas"));
    render(<ReportView report={pddc} />);
    expect(screen.getByText("Share as a picture")).toBeInTheDocument();
    await settle();
    const card = screen.getByRole("img", { name: "Trade Depth card for PDDc" });
    fireEvent.click(screen.getByRole("button", { name: "Download picture" }));
    await settle();
    expect(drawCard).toHaveBeenCalledWith(card);
    expect(click).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Saved to your computer");
    fireEvent.click(screen.getByRole("button", { name: "Download picture" }));
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("no canvas");
  });

  it("shows a logo that arrives, forgets one that arrives after it closed, and survives a failed read", async () => {
    let answer!: (r: Response) => void;
    vi.spyOn(globalThis, "fetch")
      .mockReturnValueOnce(new Promise((r) => (answer = r)))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "image/png" } }))
      .mockRejectedValueOnce(new Error("offline"));
    const a = render(<DepthShare c={depthCard(pddc)!} />);
    a.unmount();
    answer(new Response(null, { status: 404 }));
    const live = fakePulse({ kind: "live", pulse: pulse(56_000_000), history: [] });
    const b = render(
      <PulseContext.Provider value={live.store}>
        <DepthShare c={depthCard(pddc)!} />
      </PulseContext.Provider>,
    );
    await settle();
    expect(screen.getByRole("img").querySelector("image")).not.toBeNull();
    expect(screen.getByRole("img")).toHaveTextContent("block 56,000,000");
    b.unmount();
    render(<DepthShare c={depthCard(pddc)!} />);
    await settle();
    expect(screen.getByRole("img").querySelector("image")).toBeNull();
  });
});
