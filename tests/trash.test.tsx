import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TrashPanel, fileName } from "@/features/panels/TrashPanel";
import { OpenWindowProvider } from "@/features/openWindow";
import { USDC } from "@/config/chain";
import type { Bin, Emptied } from "@/skills/rugs";
import { renderAt, settle } from "./helpers";

const recycleBin = vi.fn<() => Promise<Bin>>();
vi.mock("@/skills/rugs", () => ({ recycleBin: () => recycleBin() }));
beforeEach(() => recycleBin.mockReset());

const TOKEN = "0x1698000000000000000000000000000000000001";
const BY = "0x00fd29000000000000000000000000000000746f";
const item = (over: Partial<Emptied> = {}): Emptied => ({
  pool: "0x" + "ab".repeat(32),
  token: TOKEN,
  symbol: "PEPE",
  by: BY,
  tx: "0x" + "cd".repeat(32),
  minutesAgo: 12,
  market: null,
  ...over,
});
const bin = (over: Partial<Bin> = {}): Bin => ({ latest: 1, minutes: 180, removals: 3, emptied: [], unread: 0, ...over });

describe("fileName", () => {
  it("is ASCII, names a famous ticker at the wrong contract FAKE-, and never comes out empty", () => {
    expect(fileName("USDC", TOKEN)).toBe("FAKE-USDC.exe");
    expect(fileName("USDC", USDC.address)).toBe("USDC.exe");
    expect(fileName("ꓴ឵ՏᎠ឵Ꮳ", TOKEN)).toBe("FAKE-TOKEN.exe");
    expect(fileName("E឵Τ឵H", TOKEN)).toBe("FAKE-EH.exe");
    expect(fileName("ꓴ឵ՏᎠ")).toBe("UNNAMED.exe");
    expect(fileName("my_coin-2")).toBe("my_coin-2.exe");
  });
});

describe("TrashPanel", () => {
  it("reads, fails, and tries again into an empty bin", async () => {
    recycleBin.mockRejectedValueOnce(new Error("logs refused")).mockResolvedValueOnce(bin());
    render(<TrashPanel />);
    expect(screen.getByText(/Looking through the last three hours/)).toBeInTheDocument();
    await settle();
    expect(screen.getByText("Not checked — the pools could not be read: logs refused")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settle();
    expect(screen.getByText(/The Recycle Bin is empty/)).toBeInTheDocument();
    expect(screen.getByText(/items — pools on Uniswap v4/)).toBeInTheDocument();
  });

  it("lists items, says what it could not read, and its buttons only explain themselves outside the desktop", async () => {
    recycleBin.mockResolvedValue(bin({ emptied: [item({ symbol: "USDC", market: { volume24h: 1234 } as Emptied["market"] })], unread: 1 }));
    render(<TrashPanel />);
    await settle();
    expect(screen.getByText(/1 more emptied pool could not be read/)).toBeInTheDocument();
    expect(screen.getByText(/item — pools/)).toBeInTheDocument();
    expect(screen.getAllByText(/FAKE-USDC\.exe/).length).toBe(2);
    expect(document.querySelector(".bin__why")!.textContent).toMatch(/traded \$1,234(\.00)? in 24h/);
    fireEvent.click(screen.getByRole("button", { name: "Why?" }));
    expect(screen.getByRole("status")).toHaveTextContent("Windows open from the desktop.");
    fireEvent.click(screen.getByRole("button", { name: "Empty Recycle Bin" }));
    expect(screen.getByRole("status")).toHaveTextContent(/cannot be emptied any further/);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await settle();
    expect(recycleBin).toHaveBeenCalledTimes(2);
  });

  it("runs Why? and Who on the desktop", async () => {
    recycleBin.mockResolvedValue(bin({ emptied: [item(), item({ pool: "0x02", market: { volume24h: 0 } as Emptied["market"] })], unread: 2 }));
    const open = vi.fn();
    render(
      <OpenWindowProvider open={open}>
        <TrashPanel />
      </OpenWindowProvider>,
    );
    await settle();
    expect(screen.getByText(/2 more emptied pools/)).toBeInTheDocument();
    expect(screen.queryByText(/traded/)).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Why?" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Who" })[0]!);
    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[1]![0]).toBe("profile");
  });

  it("opens from the Recycle Bin in the desktop's corner", async () => {
    recycleBin.mockResolvedValue(bin());
    renderAt("/");
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Recycle Bin" }));
    await settle();
    expect(screen.getByText(/The Recycle Bin is empty/)).toBeInTheDocument();
  });
});
