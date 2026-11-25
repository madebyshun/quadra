import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TxToast } from "@/ui/TxToast";
import { clearTxNotices, dismissTxNotice, pushTxNotice } from "@/lib/txNotice";

/** The transaction popups: every status in words, the explorer link, closing by hand and by time. */
afterEach(() => {
  act(() => clearTxNotices());
  vi.useRealTimers();
});

describe("TxToast", () => {
  it("renders nothing until a transaction speaks", () => {
    const { container } = render(<TxToast />);
    expect(container).toBeEmptyDOMElement();
  });

  it("words every status, numbers the steps, and links the hash", () => {
    render(<TxToast />);
    act(() => {
      pushTxNotice({ id: "a", label: "Approve", status: "wallet", step: 1, total: 2 });
      pushTxNotice({ id: "b", label: "Buy", status: "pending", hash: "0x1234567890abcdef" });
      pushTxNotice({ id: "c", label: "One", status: "confirmed", block: 42n, step: 1, total: 1 });
    });
    const list = screen.getByRole("complementary", { name: "Transaction notifications" });
    expect(list).toHaveTextContent("Transaction · Step 1/2");
    expect(list).toHaveTextContent("Waiting for your wallet");
    expect(list).toHaveTextContent("Sent — waiting for Base to confirm.");
    expect(screen.getByRole("link", { name: /View on Basescan \(0x12345678…\)/ })).toHaveAttribute("href", expect.stringContaining("/tx/0x1234567890abcdef"));
    expect(list).toHaveTextContent("Confirmed in block 42.");
    const words: [Parameters<typeof pushTxNotice>[0], string][] = [
      [{ id: "d", label: "x", status: "confirmed" }, "Confirmed on Base."],
      [{ id: "e", label: "x", status: "reverted", block: 7n }, "Reverted in block 7 — nothing moved except gas."],
      [{ id: "f", label: "x", status: "reverted" }, "Reverted on Base."],
      [{ id: "g", label: "x", status: "slow" }, "Still pending after the wait"],
      [{ id: "h", label: "x", status: "failed", why: "rejected" }, "rejected"],
      [{ id: "i", label: "x", status: "failed" }, "Transaction did not send."],
    ];
    for (const [n, text] of words) {
      act(() => pushTxNotice(n));
      expect(screen.getByRole("complementary")).toHaveTextContent(text);
    }
  });

  it("closes by hand, and closes finished ones by itself while a waiting one stays", () => {
    vi.useFakeTimers();
    render(<TxToast />);
    act(() => {
      pushTxNotice({ id: "w", label: "Waiting", status: "wallet" });
      pushTxNotice({ id: "done", label: "Done", status: "confirmed" });
    });
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.queryByText("Done")).toBeNull();
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByText("Waiting")).toBeNull();
    act(() => dismissTxNotice("nobody"));
    act(() => clearTxNotices());
  });
});
