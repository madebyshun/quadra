import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { badgeOf, forgetBadges, VerdictBadge } from "@/features/panels/VerdictBadge";
import { row } from "@/skills/types";
import type { Report } from "@/skills/types";
import { settle } from "./helpers";

const tokenVerdict = vi.fn();
vi.mock("@/skills/verdict", async (orig) => ({ ...(await orig<typeof import("@/skills/verdict")>()), tokenVerdict: (...a: unknown[]) => tokenVerdict(...a) }));

const COIN = "0xb200000000000000000000694E3F5A4AB150b283";
const report = (value: string, tone: "ok" | "warn" | "bad"): Report => ({ title: "t", rows: [row("Verdict", value, { tone })], notes: [], sources: [] });

beforeEach(() => {
  vi.clearAllMocks();
  forgetBadges();
});

describe("a verdict badge", () => {
  it("shortens the verdict's own three answers, never to \"safe\"", () => {
    expect(badgeOf(report("Caution — 70/100, some lines raised a flag or could not be checked", "warn"))).toEqual({
      text: "Caution 70",
      tone: "warn",
      title: "Caution — 70/100, some lines raised a flag or could not be checked",
    });
    expect(badgeOf(report("No red flags found — 95/100", "ok")).text).toBe("No red flags found 95");
    expect(badgeOf(report("High risk", "bad")).text).toBe("High risk");
    expect(badgeOf({ ...report("x — y", "ok"), rows: [row("Verdict", "x — y")] }).tone).toBe("warn");
  });

  it("checks only when asked, once per page — the answer is kept for the next row that shows it", async () => {
    tokenVerdict.mockResolvedValue(report("High risk — 20/100, see the red lines", "bad"));
    render(<VerdictBadge token={COIN} now={() => 5} />);
    expect(tokenVerdict).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: `Check ${COIN}` }));
    expect(screen.getByText("checking…")).toBeInTheDocument();
    await settle();
    expect(tokenVerdict).toHaveBeenCalledWith(COIN, 5);
    expect(screen.getByLabelText("Verdict: High risk — 20/100, see the red lines")).toHaveClass("badge--bad");
    render(<VerdictBadge token={COIN.toLowerCase()} />);
    fireEvent.click(screen.getByRole("button", { name: `Check ${COIN.toLowerCase()}` }));
    await settle();
    expect(tokenVerdict).toHaveBeenCalledOnce();
  });

  it("says a verdict that could not run is not checked, and asks again on a click", async () => {
    tokenVerdict.mockRejectedValueOnce(new Error("RPC down")).mockResolvedValue(report("No red flags found — 90/100", "ok"));
    render(<VerdictBadge token={COIN} />);
    fireEvent.click(screen.getByRole("button", { name: `Check ${COIN}` }));
    await settle();
    expect(screen.getByRole("button", { name: `Check ${COIN} again` })).toHaveAttribute("title", "RPC down");
    fireEvent.click(screen.getByRole("button", { name: `Check ${COIN} again` }));
    await settle();
    expect(screen.getByText("No red flags found 90")).toHaveClass("badge--ok");
  });
});
