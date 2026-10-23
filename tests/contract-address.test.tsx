import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ContractAddress, COPIED_MS, copyText, CopyCa } from "@/features/panels/ContractAddress";

import { COINS } from "./fixtures/indexer";

// the first real launch on the v1 launchpad, in full — the CA is never shortened on the page
const CA = COINS.eth;

function stubClipboard(writeText: ((t: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "clipboard", { value: writeText ? { writeText } : undefined, configurable: true });
}

afterEach(() => {
  stubClipboard(undefined);
  vi.useRealTimers();
});

describe("copyText", () => {
  it("is true when the Clipboard API took the text, false when it is absent or refuses", async () => {
    const write = vi.fn(async () => {});
    stubClipboard(write);
    expect(await copyText("x")).toBe(true);
    expect(write).toHaveBeenCalledWith("x");
    stubClipboard(async () => {
      throw new Error("denied");
    });
    expect(await copyText("x")).toBe(false);
    stubClipboard(undefined);
    expect(await copyText("x")).toBe(false);
  });
});

describe("ContractAddress", () => {
  it("shows the full address with Basescan and Blockscout links that open apart from this page", () => {
    render(<ContractAddress address={CA} />);
    const box = screen.getByLabelText("Contract address");
    expect(box).toHaveTextContent(`CA${CA}`);
    expect(screen.getByRole("link", { name: "Basescan" })).toHaveAttribute("href", `https://basescan.org/token/${CA}`);
    const bs = screen.getByRole("link", { name: "Blockscout" });
    expect(bs).toHaveAttribute("href", `https://base.blockscout.com/token/${CA}`);
    expect(bs).toHaveAttribute("rel", "noopener noreferrer");
    expect(bs).toHaveAttribute("target", "_blank");
  });

  it("copies, says Copied, and goes back to Copy", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => {});
    stubClipboard(write);
    render(<ContractAddress address={CA} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(write).toHaveBeenCalledWith(CA);
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(COPIED_MS));
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("without a clipboard, selects the address and says how to copy it", async () => {
    stubClipboard(undefined);
    render(<ContractAddress address={CA} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(screen.getByLabelText("Contract address")).toHaveTextContent("the address is selected: press Ctrl+C");
    expect(window.getSelection()?.toString()).toBe(CA);
  });

  it("still says how to copy when the page has no selection to set", async () => {
    stubClipboard(undefined);
    const spy = vi.spyOn(window, "getSelection").mockReturnValue(null);
    render(<ContractAddress address={CA} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(screen.getByLabelText("Contract address")).toHaveTextContent("press Ctrl+C");
    spy.mockRestore();
  });
});

describe("CopyCa — the list row's short CA", () => {
  it("copies the full address without opening the row, then goes back", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => {});
    stubClipboard(write);
    const parent = vi.fn();
    render(
      <div onClick={parent}>
        <CopyCa address={CA} />
      </div>,
    );
    const b = screen.getByRole("button", { name: `Copy contract address ${CA}` });
    expect(b).toHaveTextContent("CA 0xB200…0dF9");
    await act(async () => {
      fireEvent.click(b);
    });
    expect(write).toHaveBeenCalledWith(CA);
    expect(parent).not.toHaveBeenCalled();
    expect(b).toHaveTextContent("Copied");
    act(() => vi.advanceTimersByTime(COPIED_MS));
    expect(b).toHaveTextContent("CA 0xB200…0dF9");
  });

  it("stays as it was when copying is refused", async () => {
    stubClipboard(undefined);
    render(<CopyCa address={CA} />);
    const b = screen.getByRole("button");
    await act(async () => {
      fireEvent.click(b);
    });
    expect(b).toHaveTextContent("CA 0xB200…0dF9");
  });
});
