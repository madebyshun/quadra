import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { row, type Report } from "@/skills/types";
import { forgetTips, onTip, type Tip } from "@/lib/assistant";
import { DEFAULT_THRESHOLD, isWatched, LOAN_WATCH_KEY, loadLoanWatch, MAX_WATCHED, unwatchLoan, watchLoan } from "@/lib/loanWatch";
import { checkLoans, EVERY_MS, LoanWatch, tipsFor, useLoanAlerts } from "@/features/loanAlerts";
import { ReportView } from "@/features/panels/ReportView";
import MORPHO_FX from "./fixtures/collateral/morpho.json";
import { net, RpcError, useNet } from "./net";

useNet();
afterEach(() => forgetTips());

/**
 * Liquidation alerts. The reports are written exactly as `collateralReport` writes them; the
 * end-to-end check runs on the real Morpho borrower captured in tests/fixtures/collateral.
 */

const W = "0x3998F134d6aaa2b6a5f723806D00fD2bBBBCE891";
const report = (...rows: ReturnType<typeof row>[]): Report => ({
  title: "0x3998…E891 — Collateral Watch",
  rows: [row("Wallet", W, { href: `https://basescan.org/address/${W}` }), ...rows],
  notes: [],
  sources: [],
});
const morpho = (sym: string, value: string, tone: "ok" | "warn" | "bad" = "warn") => row(`Morpho · ${sym}`, value, { tone });

function heard() {
  const tips: Tip[] = [];
  const off = onTip((t) => tips.push(t));
  return { tips, off };
}

describe("the watch list", () => {
  it("keeps up to five wallets with their thresholds, replaces a re-watched one, and forgets on request", () => {
    expect(loadLoanWatch()).toEqual([]);
    watchLoan(W);
    expect(loadLoanWatch()).toEqual([{ wallet: W, threshold: DEFAULT_THRESHOLD }]);
    watchLoan(W.toLowerCase(), 8);
    expect(loadLoanWatch()).toEqual([{ wallet: W.toLowerCase(), threshold: 8 }]);
    for (let i = 0; i < MAX_WATCHED + 2; i++) watchLoan(`0x${String(i).padStart(40, "0")}`);
    expect(loadLoanWatch()).toHaveLength(MAX_WATCHED);
    expect(isWatched(W, loadLoanWatch())).toBe(false);
    unwatchLoan("0x0000000000000000000000000000000000000006");
    expect(loadLoanWatch()).toHaveLength(MAX_WATCHED - 1);
  });

  it("reads a broken record as watching nothing, drops entries that are not a wallet and a threshold, and survives no storage", () => {
    localStorage.setItem(LOAN_WATCH_KEY, "{not json");
    expect(loadLoanWatch()).toEqual([]);
    localStorage.setItem(LOAN_WATCH_KEY, JSON.stringify({ wallet: W }));
    expect(loadLoanWatch()).toEqual([]);
    localStorage.setItem(LOAN_WATCH_KEY, JSON.stringify([{ wallet: "bob", threshold: 5 }, { wallet: W, threshold: -1 }, { wallet: W, threshold: 5 }, null]));
    expect(loadLoanWatch()).toEqual([{ wallet: W, threshold: 5 }]);
    expect(loadLoanWatch({ getItem: () => { throw new Error("blocked"); } } as unknown as Storage)).toEqual([]);
    const broken = { getItem: () => null, setItem: () => { throw new Error("full"); } } as unknown as Storage;
    expect(watchLoan(W, 5, broken)).toEqual([]);
  });
});

describe("what Q says", () => {
  const w = { wallet: W, threshold: 20 };

  it("names the nearest loan inside the threshold, or one that can be liquidated now", () => {
    const near = report(morpho("NVDAc", "109.83 NVDAc ($19,418.70) backing 10,216.53 USDC · health 1.19 · liquidated at $148.83, 15.8% below its oracle's $176.80"));
    expect(tipsFor(near, w)).toEqual([
      {
        id: `loan:${W}:Morpho:NVDAc:15`,
        tone: "bad",
        text: "0x3998…E891: NVDAc on Morpho is 15.8% from liquidation — you asked to hear under 20%.",
        action: { label: "Open Collateral Watch", command: `collateral ${W}` },
      },
    ]);
    expect(tipsFor(near, { wallet: W, threshold: 10 })).toEqual([]);
    const now = report(row("Health factor", "0.95 — liquidated below 1.00", { tone: "bad" }), row("Liquidation · NVDAc", "at or above Aave's $100.00 — the position can be liquidated now", { tone: "bad" }));
    expect(tipsFor(now, w)[0]!.text).toBe("0x3998…E891: NVDAc on Aave V4 can be liquidated now.");
  });

  it("speaks on the weekend when Base's price already puts a loan below a health of 1 — Aave's scenario or a Morpho loan", () => {
    const far = "64.4 AAPLc ($22,839.44) backing 11,611.21 USDC · health 1.40 · liquidated at $200.00, 43.6% below its oracle's $354.60";
    const aave = report(morpho("AAPLc", far), row("If the market reopened at Base's prices", "health 0.98 (now 1.10) — NVDAc $150.00 (-15.0% vs Aave)", { tone: "bad" }));
    expect(tipsFor(aave, w)[0]).toMatchObject({ id: `loan-weekend:${W}`, text: "0x3998…E891: at Base's weekend price, its Aave loan would already be below a health of 1 when the market reopens." });
    const m = report(morpho("AAPLc", `${far} · at Base's $250.00: health 0.99`));
    expect(tipsFor(m, w)[0]!.text).toBe("0x3998…E891: at Base's weekend price, AAPLc on Morpho would already be below a health of 1 when the market reopens.");
    expect(tipsFor(report(morpho("AAPLc", `${far} · at Base's $360.00: health 1.42`)), w)).toEqual([]);
    // the worst weekend on record would liquidate: Aave's stress row, or a Morpho loan's
    const stressed = report(morpho("AAPLc", far), row("At each stock's worst weekend gap", "health 0.96 (now 1.06) — would be liquidated — AAPLc -9.15% (weekend of 2026-09-18)", { tone: "bad" }));
    expect(tipsFor(stressed, w)[0]).toMatchObject({ id: `loan-worst:${W}`, text: "0x3998…E891: a repeat of the worst weekend gap on record would liquidate its Aave loan." });
    expect(tipsFor(report(morpho("AAPLc", `${far} · at its worst weekend gap (-30.00%, 2026-11-06): health 0.97`)), w)[0]!.text).toBe(
      "0x3998…E891: a repeat of the worst weekend gap on record would liquidate AAPLc on Morpho.",
    );
    // nothing borrowed: nothing to say
    expect(tipsFor(report(morpho("AAPLc", "1 AAPLc ($354.60), nothing borrowed", "ok")), w)).toEqual([]);
  });
});

describe("checking the chain", () => {
  type Fx = { calls: Record<string, string | { error: string }>; gets: Record<string, unknown> };
  const fx = MORPHO_FX as unknown as Fx;
  function chain(down = false) {
    net({
      rpc: (m, p) => {
        if (m !== "eth_call") return undefined;
        if (down) return new RpcError("busy");
        const { to, data } = p[0] as { to: string; data: string };
        const real = fx.calls[`${to.toLowerCase()} ${data}`];
        return typeof real === "object" ? new RpcError(real.error) : real;
      },
      get: (url) => fx.gets[url] ?? (url.startsWith("/api/weekend/scorecard?ticker=") ? { weekends: [] } : undefined),
    });
  }

  it("reads each watched wallet and raises what it earns — the real borrower, inside a 20% alert", async () => {
    chain();
    const { tips, off } = heard();
    const raised = await checkLoans([{ wallet: W, threshold: 20 }], Date.UTC(2026, 10, 12, 18));
    off();
    expect(raised.map((t) => t.text)).toEqual(["0x3998…E891: NVDAc on Morpho is 15.8% from liquidation — you asked to hear under 20%."]);
    expect(tips).toHaveLength(1);
  });

  it("raises nothing for a wallet it could not read — and clears nothing either", async () => {
    chain(true);
    expect(await checkLoans([{ wallet: W, threshold: 20 }])).toEqual([]);
  });

  function Alerts() {
    useLoanAlerts();
    return null;
  }

  it("checks when the app opens and every ten minutes while anything is watched", async () => {
    vi.useFakeTimers();
    try {
      render(<Alerts />);
      chain();
      watchLoan(W, 20);
      const { tips, off } = heard();
      const { unmount } = render(<Alerts />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      forgetTips();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(EVERY_MS);
      });
      unmount();
      off();
      expect(tips.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the Watch button under a Collateral Watch report", () => {
  const near = report(morpho("NVDAc", "109.83 NVDAc ($19,418.70) backing 10,216.53 USDC · health 1.19 · liquidated at $148.83, 15.8% below its oracle's $176.80"));

  it("watches, updates, and stops — and checks the wallet at once", async () => {
    net({ rpc: () => new RpcError("busy") });
    render(<ReportView report={near} />);
    await userEvent.clear(screen.getByLabelText("Alert threshold"));
    await userEvent.type(screen.getByLabelText("Alert threshold"), "12");
    await userEvent.click(screen.getByRole("button", { name: "Watch this wallet" }));
    expect(loadLoanWatch()).toEqual([{ wallet: W, threshold: 12 }]);
    expect(screen.getByText(/^Watching — Q checks this wallet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Update the alert" }));
    await userEvent.click(screen.getByRole("button", { name: "Stop watching" }));
    expect(loadLoanWatch()).toEqual([]);
  });

  it("refuses a threshold that is not a percent, and a sixth wallet", async () => {
    render(<LoanWatch wallet={W} />);
    await userEvent.clear(screen.getByLabelText("Alert threshold"));
    await userEvent.type(screen.getByLabelText("Alert threshold"), "abc");
    expect(screen.getByRole("button", { name: "Watch this wallet" })).toBeDisabled();
    for (let i = 0; i < MAX_WATCHED; i++) watchLoan(`0x${String(i).padStart(40, "0")}`);
    render(<LoanWatch wallet={W} />);
    expect(screen.getByRole("button", { name: `Watching ${MAX_WATCHED} wallets already` })).toBeDisabled();
  });

  it("is offered only under a Collateral Watch report with a loan", () => {
    render(<ReportView report={report(row("Aave V4 · MAG7", "no stock supplied and nothing borrowed", { tone: "ok" }))} />);
    expect(screen.queryByText("Liquidation alert")).toBeNull();
  });
});
