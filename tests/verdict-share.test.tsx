import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BRAND } from "@/brand";
import { row, type Report } from "@/skills/types";
import { LAUNCHPAD_CODE } from "@/skills/verdict";
import { checkedAt, words, logoOf, qrCells, VerdictShare, VerdictSvg, verdictCard, verdictLink, verdictPost } from "@/features/panels/VerdictShare";
import { ReportView } from "@/features/panels/ReportView";
import { settle } from "./helpers";
import { PulseContext } from "@/ui/usePulse";
import { fakePulse, pulse } from "./pulseFake";

const drawCard = vi.fn();
vi.mock("@/features/panels/BaseCard", async (orig) => ({ ...(await orig<typeof import("@/features/panels/BaseCard")>()), drawCard: (s: unknown) => drawCard(s) }));

const TOKEN = "0xb200000000000000000000694E3F5A4AB150b283";
type R = ReturnType<typeof row>;
const verdict = (value: string, tone: "ok" | "warn" | "bad", extra: R[] = []): Report => ({
  title: "TEST — Token Verdict",
  rows: [row("Token", "Test (TEST)", { href: `https://basescan.org/token/${TOKEN}` }), row("Verdict", value, { tone }), ...extra],
  notes: [],
  sources: ["Relay"],
});
const reboot = verdict("Caution — 70/100", "warn", [
  row("Buy → sell, simulated now", "2.68% lost on the round trip (fees, impact and any tax)", { tone: "ok" }),
  row("Code scan", "11 checks passed — not a honeypot, no mint, no pause, no blacklist, source verified, tax 0.00% buy / 0.00% sell", { tone: "ok" }),
  row("Top 10 holders", "none indexed yet — the indexer can lag a new token", { tone: "warn" }),
  row("Liquidity (uniswap, vs WETH)", "$473,011.27", { tone: "ok" }),
  row("Volume 24h", "$1,402,338.89"),
  row("Pool age", "18 hours", { tone: "warn" }),
]);
const scam = verdict("High risk — 0/100, see the red lines", "bad", [
  row("Buy → sell, simulated now", "the sell reverted — you could buy and not sell", { tone: "bad" }),
  row("Owner can mint more", "yes", { tone: "warn" }),
  row("Transfers can be paused", "yes", { tone: "warn" }),
  row("Launcher pulled liquidity", "2 hours ago — it took liquidity out of a pool", { tone: "bad" }),
]);

const offline = () => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
afterEach(() => vi.restoreAllMocks());

describe("a Token Verdict as a picture", () => {
  it("says it in three tiles — does it sell, is the code clean, what else — and the market's two figures", () => {
    const c = verdictCard(reboot)!;
    expect(c).toMatchObject({ token: TOKEN, symbol: "TEST", tone: "warn", headline: "CAUTION", score: "70/100", reason: null });
    expect(c.tiles).toEqual([
      { tone: "ok", title: "Sells fine", sub: "−2.68% round trip" },
      { tone: "ok", title: "Code clean", sub: "0% buy / 0% sell tax" },
      { tone: "warn", title: "Top 10 holders", sub: "none indexed yet" },
    ]);
    expect(c.figures).toEqual([
      { label: "Liquidity", value: "$473,011" },
      { label: "Volume 24h", value: "$1,402,338" },
      { label: "Pool age", value: "18 hours" },
    ]);
  });

  it("leads a high-risk card with its first red line, and counts the code's flags", () => {
    const c = verdictCard(scam)!;
    expect(c.reason).toBe("Buy → sell, simulated now: the sell reverted");
    expect(c.tiles).toEqual([
      { tone: "bad", title: "Can't sell", sub: "the sell reverted" },
      { tone: "warn", title: "2 code flags", sub: "Owner can mint more" },
      { tone: "bad", title: "Launcher pulled…", sub: "2 hours ago" },
    ]);
    expect(verdictCard(verdict("High risk — 0/100", "bad", [row("Hidden owner", "yes", { tone: "bad" }), row("Owner can mint more", "yes", { tone: "warn" })]))!.tiles[1]).toEqual({
      tone: "bad",
      title: "Code trap",
      sub: "Hidden owner",
    });
    expect(verdictCard(verdict("Caution", "warn", [row("Owner can mint more", "yes", { tone: "warn" })]))!.tiles[1].title).toBe("1 code flag");
  });

  it("says what it could not check, and what a launchpad coin's code guarantees", () => {
    const none = verdictCard(verdict("Caution — 80/100", "warn"))!;
    expect(none.tiles).toEqual([
      { tone: "warn", title: "Trade not checked", sub: "no simulation" },
      { tone: "warn", title: "Code not scanned", sub: "no report" },
      { tone: "ok", title: "No other flags", sub: "0 more checks" },
    ]);
    const unread = verdictCard(
      verdict("Caution", "warn", [row("Buy → sell, simulated now", "not checked — Relay refused", { tone: "warn" }), row("Code scan", "not checked — GoPlus could not be reached", { tone: "warn" })]),
    )!;
    expect(unread.tiles.slice(0, 2)).toEqual([
      { tone: "warn", title: "Trade not checked", sub: "not checked" },
      { tone: "warn", title: "Code not scanned", sub: "not checked" },
    ]);
    const ours = verdictCard(verdict("No red flags found — 100/100", "ok", [LAUNCHPAD_CODE, row("Buy → sell, simulated now", "went through", { tone: "ok" }), row("Pool age", "3 days", { tone: "ok" })]))!;
    expect(ours.tiles).toEqual([
      { tone: "ok", title: "Sells fine", sub: "went through" },
      { tone: "ok", title: "Code clean", sub: "no admin, ever" },
      { tone: "ok", title: "No other flags", sub: "1 more checks" },
    ]);
    expect(verdictCard(verdict("x", "warn", [row("Code scan", "clean", { tone: "ok" })]))!.tiles[1].sub).toBe("clean");
    expect(verdictCard(verdict("x", "warn", [row("Buy → sell", "odd", {})]))!.tiles[0].title).toBe("Trade not checked");
  });

  it("is no card for any other report, or a verdict without a token", () => {
    expect(verdictCard({ title: "Radar", rows: [row("Launch", "x")], notes: [], sources: [] })).toBeNull();
    expect(verdictCard({ ...reboot, rows: [row("Verdict", "Caution", { tone: "warn" })] })).toBeNull();
    expect(verdictCard({ ...reboot, rows: [row("Token", "t"), row("Verdict", "Caution", { tone: "warn" })] })).toBeNull();
    expect(verdictCard(verdict("High risk", "bad"))).toMatchObject({ score: "", reason: null, headline: "HIGH RISK" });
    expect(verdictCard(verdict("No red flags found — 90/100", "ok"))!.headline).toBe("NO RED FLAGS FOUND");
  });

  it("posts a link that runs the same check, never says safe, and dates itself in UTC", () => {
    const c = verdictCard(verdict("No red flags found — 90/100", "ok"))!;
    expect(verdictLink(TOKEN)).toBe(`${window.location.origin}/?do=safety&run-safety=verdict%20${TOKEN}`);
    const text = decodeURIComponent(verdictPost(c).replace("https://x.com/intent/post?text=", ""));
    expect(text).toContain(`$TEST on Base: no red flags found — 90/100 on ${BRAND.name}'s Token Verdict`);
    expect(text).toContain(verdictLink(TOKEN));
    expect(text.toLowerCase()).not.toContain("safe ");
    expect(words("even 0.01 ETH cannot be filled", 20)).toBe("even 0.01 ETH…");
    expect(words("Supercalifragilistic", 8)).toBe("Superca…");
    expect(words("short", 8)).toBe("short");
    expect(checkedAt(Date.UTC(2026, 10, 4, 13, 19))).toBe("4 Nov 2026, 13:19 UTC");
    const qr = qrCells(verdictLink(TOKEN));
    expect(qr.cells.length).toBeGreaterThan(qr.size);
  });

  it("draws the way back — the address, a QR code — when and at which block, red for high risk", () => {
    const { container, rerender } = render(<VerdictSvg c={verdictCard(scam)!} when="4 Nov 2026, 13:19 UTC" block={53_504_505} />);
    const card = screen.getByRole("img", { name: "Token Verdict card for TEST" });
    expect(card).toHaveTextContent("✕ Buy → sell, simulated now: the sell reverted");
    expect(card).toHaveTextContent("Checked 4 Nov 2026, 13:19 UTC · block 53,504,505");
    expect(card).toHaveTextContent(`Check any token free → ${BRAND.domain}`);
    expect(container.querySelector("#kit-sky stop")).toHaveAttribute("stop-color", "#8a1414");
    expect(card.querySelector("image")).toBeNull();
    rerender(<VerdictSvg c={verdictCard(reboot)!} logo="data:image/png;base64,AA" when="now" />);
    expect(container.querySelector("#kit-sky stop")).toHaveAttribute("stop-color", "#0A3DFF");
    expect(card.querySelector("image")).toHaveAttribute("href", "data:image/png;base64,AA");
    expect(card).not.toHaveTextContent("block");
    rerender(<VerdictSvg c={verdictCard(verdict("No red flags found — 100/100", "ok"))!} when="now" />);
    expect(card).toHaveTextContent("NO RED FLAGS FOUND");
    expect(card).toHaveTextContent("no red flags found — 100/100");
    rerender(<VerdictSvg c={{ ...verdictCard(verdict("No red flags found — 100/100", "ok"))!, score: "" }} when="now" />);
    expect(card).toHaveTextContent("no red flags found");
    rerender(<VerdictSvg c={{ ...verdictCard(reboot)!, symbol: "AVERYLONGSYMBOL" }} when="now" />);
    expect(card).toHaveTextContent("$AVERYLONG…");
  });

  it("reads the logo from this app's own route as a data: URL, and goes without one", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } }));
    expect(await logoOf(TOKEN)).toBe("data:image/png;base64,AQID");
    expect(f).toHaveBeenCalledWith(`/api/logo/${TOKEN}`, { headers: { "x-quadra": "1" } });
    f.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await logoOf(TOKEN)).toBeNull();
    f.mockResolvedValueOnce(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect(await logoOf(TOKEN)).toBeNull();
    const bare = new Response("x", { status: 200 });
    bare.headers.delete("content-type");
    f.mockResolvedValueOnce(bare);
    expect(await logoOf(TOKEN)).toBeNull();
  });

  it("sits under a verdict's report, folded, shows the logo when it arrives, and downloads exactly the picture shown", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "image/png" } }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    drawCard.mockResolvedValueOnce({ toDataURL: () => "data:image/png;base64,AA" }).mockRejectedValueOnce(new Error("no canvas"));
    render(<ReportView report={reboot} />);
    expect(screen.getByText("Share as a picture")).toBeInTheDocument();
    await settle();
    const card = screen.getByRole("img", { name: "Token Verdict card for TEST" });
    expect(card.querySelector("image")).not.toBeNull();
    expect(card).toHaveTextContent("Sells fine");
    fireEvent.click(screen.getByRole("button", { name: "Download picture" }));
    await settle();
    expect(drawCard).toHaveBeenCalledWith(card);
    expect(click).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Saved to your computer");
    fireEvent.click(screen.getByRole("button", { name: "Download picture" }));
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("no canvas");
  });

  it("forgets a logo that arrives after it closed, survives a failed read, and a radar report has no card", async () => {
    let answer!: (r: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValueOnce(new Promise((r) => (answer = r))).mockRejectedValueOnce(new Error("offline"));
    const a = render(<VerdictShare c={verdictCard(reboot)!} />);
    a.unmount();
    answer(new Response(null, { status: 404 }));
    const live = fakePulse({ kind: "live", pulse: pulse(53_504_505), history: [] });
    render(
      <PulseContext.Provider value={live.store}>
        <VerdictShare c={verdictCard(scam)!} />
      </PulseContext.Provider>,
    );
    await settle();
    expect(screen.getByRole("img").querySelector("image")).toBeNull();
    expect(screen.getByRole("img")).toHaveTextContent("block 53,504,505");
    offline();
    render(<ReportView report={{ title: "Radar", rows: [], notes: [], sources: [] }} />);
    expect(screen.queryByText("Share as a picture")).toBeNull();
  });
});
