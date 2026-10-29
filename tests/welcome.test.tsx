import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { BRAND } from "@/brand";
import { Welcome, cardWindow } from "@/ui/Welcome";
import { OpenWindowProvider } from "@/features/openWindow";
import { PulseContext } from "@/ui/usePulse";
import { WELCOME_KEY } from "@/lib/welcome";
import { GREETING, forgetTips } from "@/lib/assistant";
import { HELLO_MS } from "@/ui/Assistant";
import type { Activity } from "@/skills/activity";
import type { Bin } from "@/skills/rugs";
import { fakePulse } from "./pulseFake";
import { renderAt, settle } from "./helpers";

const launchActivity = vi.fn<() => Promise<Activity>>();
const recycleBin = vi.fn<() => Promise<Bin>>();
vi.mock("@/skills/activity", () => ({ launchActivity: () => launchActivity() }));
vi.mock("@/skills/rugs", () => ({ recycleBin: () => recycleBin() }));


beforeEach(() => {
  localStorage.removeItem(WELCOME_KEY);
  launchActivity.mockReset().mockReturnValue(new Promise(() => {}));
  recycleBin.mockReset().mockReturnValue(new Promise(() => {}));
  forgetTips();
});
afterEach(() => vi.useRealTimers());

function mount(p = fakePulse()) {
  const open = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <PulseContext.Provider value={p.store}>
      <OpenWindowProvider open={open}>
        <Welcome onClose={onClose} />
      </OpenWindowProvider>
    </PulseContext.Provider>,
  );
  return { open, onClose, p, view };
}

/** A checksummed token on Base — the first launch on this app's launchpad. */
const TOKEN = "0xb200000000000000000000694E3F5A4AB150b283";
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("the Welcome screen", () => {
  it("is the front door: the brand, one field to check a token, and three doors", () => {
    mount();
    expect(screen.getByRole("heading", { name: `Welcome to ${BRAND.name}` }).querySelector("b")).toHaveTextContent(BRAND.name);
    expect(screen.getByRole("button", { name: "Check" })).toBeDisabled();
    for (const name of ["Launch a coin", "Browse coins", "Your wallet"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    // the playful doors moved to My Computer
    expect(screen.queryByRole("button", { name: "Next Tip" })).toBeNull();
    expect(screen.queryByRole("button", { name: "What's New" })).toBeNull();
  });

  it("checks a pasted token in the Check window, and closes", () => {
    const { open, onClose } = mount();
    fireEvent.change(screen.getByLabelText("Check a token before you buy it"), { target: { value: ` ${TOKEN} ` } });
    click("Check");
    expect(open).toHaveBeenCalledWith("safety", { "run-safety": `verdict ${TOKEN}` });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("says why a paste is not an address, and checks nothing", () => {
    const { open, onClose } = mount();
    const field = screen.getByLabelText("Check a token before you buy it");
    fireEvent.change(field, { target: { value: "pepe" } });
    click("Check");
    expect(screen.getByText(/pepe/)).toHaveClass("tx__warn");
    expect(open).not.toHaveBeenCalled();
    // a wrong checksum is refused too, never "corrected"
    fireEvent.change(field, { target: { value: TOKEN.replace("B", "b").replace("E", "e").replace("f", "F") } });
    expect(screen.queryByText(/pepe/)).toBeNull();
    click("Check");
    expect(document.querySelector(".welcome .tx__warn")).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("opens Launch, Coins and the wallet — each closing the Welcome screen", () => {
    const { open, onClose } = mount();
    click("Launch a coin");
    click("Browse coins");
    click("Your wallet");
    expect(open.mock.calls.map((c) => c[0])).toEqual(["launch", "coins", "wallet"]);
    expect(onClose).toHaveBeenCalledTimes(3);
    fireEvent.click(document.querySelector(".welcome__win .light--close")!);
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it("the card window is `card` once registered, else the profile", () => {
    expect(cardWindow(() => ({}))).toBe("card");
    expect(cardWindow(() => null)).toBe("profile");
  });

  it("Esc closes it, other keys do not; the checkbox remembers", () => {
    const { onClose } = mount();
    fireEvent.keyDown(window, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
    const box = screen.getByRole("checkbox", { name: `Show this Welcome Screen next time you start ${BRAND.name}` });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(localStorage.getItem(WELCOME_KEY)).toBe("off");
    fireEvent.click(box);
    expect(localStorage.getItem(WELCOME_KEY)).toBe("on");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("the Welcome screen on the desktop", () => {
  it("shows on a bare load, keeps Q's hello to itself, and Esc closes it without closing a window", async () => {
    vi.useFakeTimers();
    renderAt("/");
    await act(async () => {});
    expect(screen.getByRole("dialog", { name: `Welcome to ${BRAND.name}` })).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(HELLO_MS * 2));
    expect(screen.queryByText(GREETING.text)).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: `Welcome to ${BRAND.name}` })).toBeNull();
  });

  it("does not show for a ?do= link, and Q stays quiet until something real happens (2026-10-29)", async () => {
    vi.useFakeTimers();
    renderAt("/?do=markets");
    await act(async () => {});
    expect(screen.queryByRole("dialog", { name: `Welcome to ${BRAND.name}` })).toBeNull();
    act(() => void vi.advanceTimersByTime(HELLO_MS * 2));
    expect(screen.queryByText(GREETING.text)).toBeNull();
  });

  it("does not show once turned off, and Q greets", async () => {
    localStorage.setItem(WELCOME_KEY, "off");
    renderAt("/");
    await settle();
    expect(screen.queryByRole("dialog", { name: `Welcome to ${BRAND.name}` })).toBeNull();
  });
});
