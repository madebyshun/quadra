import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportView, tipFor } from "@/features/panels/ReportView";
import { WalletPanel } from "@/features/panels/WalletPanel";
import { WalletProvider } from "@/ui/WalletProvider";
import { ACHIEVEMENTS_KEY } from "@/lib/achievements";
import { forgetTips, onTip, type Tip } from "@/lib/assistant";
import type { Report } from "@/skills/types";
import { settle } from "./helpers";

vi.mock("@/lib/connectors", () => ({ walletConnectProvider: vi.fn(), coinbaseProvider: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

const report = (rows: Report["rows"], title = "Token Verdict"): Report => ({ title, rows, notes: [], sources: [] });

describe("ReportView and Q", () => {
  it("tipFor speaks up for a red Verdict or Decision only", () => {
    expect(tipFor(report([{ label: "Verdict", value: "High risk", tone: "bad" }]))).toMatchObject({ id: "red:Token Verdict", tone: "bad", text: expect.stringContaining('"High risk"') });
    expect(tipFor(report([{ label: "Decision", value: "block", tone: "bad" }], "Gate"))!.id).toBe("red:Gate");
    expect(tipFor(report([{ label: "Verdict", value: "Caution", tone: "warn" }]))).toBeNull();
    expect(tipFor(report([{ label: "Holders", value: "x", tone: "bad" }]))).toBeNull();
  });

  it("says the tip and counts a verdict when shown; a plain report does neither", () => {
    forgetTips();
    const tips: Tip[] = [];
    const off = onTip((t) => tips.push(t));
    render(<ReportView report={report([{ label: "Verdict", value: "High risk", tone: "bad" }])} />);
    expect(tips).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(ACHIEVEMENTS_KEY)!).verdicts).toBe(1);
    render(<ReportView report={report([{ label: "Block", value: "1" }], "Gas")} />);
    expect(tips).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(ACHIEVEMENTS_KEY)!).verdicts).toBe(1);
    off();
  });
});

describe("the Wallet window signed out", () => {
  it("offers a passkey wallet to somebody with no extension", async () => {
    render(
      <WalletProvider>
        <WalletPanel />
      </WalletProvider>,
    );
    await settle();
    expect(screen.getByText(/Coinbase Smart Wallet makes a wallet with a passkey/)).toBeInTheDocument();
    expect(screen.queryByText("Your fees")).toBeNull();
  });
});
