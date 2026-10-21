import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BaseCard, cardLines, shareUrl, type CardFacts } from "@/features/panels/BaseCard";
import { ReportView, tipFor } from "@/features/panels/ReportView";
import { WalletPanel } from "@/features/panels/WalletPanel";
import { WalletProvider } from "@/ui/WalletProvider";
import { BRAND } from "@/brand";
import { ACHIEVEMENTS_KEY } from "@/lib/achievements";
import { forgetTips, onTip, type Tip } from "@/lib/assistant";
import type { Report } from "@/skills/types";
import { settle } from "./helpers";

vi.mock("@/lib/connectors", () => ({ walletConnectProvider: vi.fn(), coinbaseProvider: vi.fn() }));

const ADDRESS = "0x00FD290000000000000000000000000000000001";
const FACTS: CardFacts = { address: ADDRESS, name: "shun.base.eth", launched: 1, feesWaiting: 0, holdings: "ETH and 2 priced tokens", lures: 7 };
const NONE: CardFacts = { address: ADDRESS, name: null, launched: null, feesWaiting: null, holdings: null, lures: null };

afterEach(() => vi.restoreAllMocks());

describe("the Base card's words", () => {
  it("says what was read, and 'not read' for what was not", () => {
    expect(cardLines(FACTS)).toEqual([
      "Coins launched here: 1 coin",
      "Coins with fees waiting: 0",
      "Holdings: ETH and 2 priced tokens",
      "Fake look-alike tokens dodged: 7",
    ]);
    expect(cardLines({ ...FACTS, launched: 3 })[0]).toBe("Coins launched here: 3 coins");
    expect(cardLines(NONE)).toEqual(["Coins launched here: not read", "Coins with fees waiting: not read", "Holdings: not read", "Fake look-alike tokens dodged: not read"]);
  });

  it("encodes the post for X, naming the wallet by Basename or short address", () => {
    const url = shareUrl(FACTS);
    expect(url.startsWith("https://x.com/intent/post?text=")).toBe(true);
    const text = decodeURIComponent(url.split("text=")[1]!);
    expect(text).toContain(`My Base card from ${BRAND.name}`);
    expect(text).toContain("shun.base.eth: 1 coin launched");
    expect(decodeURIComponent(shareUrl(NONE))).toMatch(/0x00FD…0001: not read launched/);
    expect(url).not.toMatch(/ /);
  });
});

/** An Image whose load or error the test decides. */
function stubImage(outcome: "load" | "error") {
  const made: { src?: string }[] = [];
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(v: string) {
        made.push({ src: v });
        queueMicrotask(() => (outcome === "load" ? this.onload?.() : this.onerror?.()));
      }
    },
  );
  return made;
}

describe("BaseCard", () => {
  it("saves a PNG drawn from the card", async () => {
    const made = stubImage("load");
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: draw } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAA");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<BaseCard facts={FACTS} />);
    expect(screen.getByRole("img", { name: "Base card for shun.base.eth" })).toHaveTextContent("Coins launched here: 1 coin");
    expect(screen.getByRole("link", { name: "Share on X" })).toHaveAttribute("href", shareUrl(FACTS));
    fireEvent.click(screen.getByRole("button", { name: "Save as PNG" }));
    await settle();
    expect(made[0]!.src).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 1200, 630);
    expect(click).toHaveBeenCalledOnce();
    expect((click.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe("base-card-00FD29.png");
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
  });

  it("says when the browser cannot draw it", async () => {
    stubImage("load");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(<BaseCard facts={NONE} />);
    expect(screen.getByRole("img", { name: `Base card for ${ADDRESS}` })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save as PNG" }));
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("This browser cannot draw the picture — take a screenshot instead.");
  });

  it("says when the picture will not load", async () => {
    stubImage("error");
    render(<BaseCard facts={FACTS} />);
    fireEvent.click(screen.getByRole("button", { name: "Save as PNG" }));
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("The picture could not be drawn — take a screenshot instead.");
  });
});

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
