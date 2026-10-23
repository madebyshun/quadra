import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { BRAND } from "@/brand";
import { Welcome, cardWindow } from "@/ui/Welcome";
import { OpenWindowProvider } from "@/features/openWindow";
import { PulseContext } from "@/ui/usePulse";
import { FIXED_TIPS, WELCOME_KEY } from "@/lib/welcome";
import { WHATS_NEW } from "@/lib/whatsnew";
import { GREETING, forgetTips } from "@/lib/assistant";
import { HELLO_MS } from "@/ui/Assistant";
import type { Activity } from "@/skills/activity";
import type { Bin } from "@/skills/rugs";
import { fakePulse, pulse } from "./pulseFake";
import { renderAt, settle } from "./helpers";

const launchActivity = vi.fn<() => Promise<Activity>>();
const recycleBin = vi.fn<() => Promise<Bin>>();
vi.mock("@/skills/activity", () => ({ launchActivity: () => launchActivity() }));
vi.mock("@/skills/rugs", () => ({ recycleBin: () => recycleBin() }));

const ACT: Activity = { latest: 9, minutes: 10, total: 7, processes: [{ name: "Zora", launches: 5, ours: false }] };
const BIN: Bin = { latest: 9, minutes: 180, removals: 0, emptied: [], unread: 0 };

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

const tip = () => document.querySelector(".welcome__text")!.textContent;
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("the Welcome screen", () => {
  it("titles itself with the brand, shows a fixed tip until something is read, then a live one first", async () => {
    let done!: (a: Activity) => void;
    launchActivity.mockReturnValue(new Promise((r) => (done = r)));
    const { p } = mount();
    expect(screen.getByRole("heading", { name: `Welcome to ${BRAND.name}` }).querySelector("b")).toHaveTextContent(BRAND.name);
    expect(tip()).toBe(FIXED_TIPS[0]);
    act(() => p.set({ kind: "live", pulse: pulse(100), history: [] }));
    expect(tip()).toMatch(/^The latest Base block is #100/);
    act(() => p.set({ kind: "live", pulse: pulse(104), history: [] }));
    expect(tip()).toMatch(/^Base has made 4 blocks since you opened this page/);
    await act(async () => done(ACT));
    expect(tip()).toMatch(/^7 pools opened .* Zora, with 5\./);
  });

  it("Next Tip cycles, reading the Trash once, lazily; a failed read adds nothing", async () => {
    mount();
    expect(recycleBin).not.toHaveBeenCalled();
    click("Next Tip");
    expect(tip()).toBe(FIXED_TIPS[1]);
    click("Next Tip");
    expect(recycleBin).toHaveBeenCalledOnce();
    for (let i = 2; i < FIXED_TIPS.length; i++) click("Next Tip");
    expect(tip()).toBe(FIXED_TIPS[0]);
  });

  it("shows the Trash tip at the end once read; a failed activity read is simply absent", async () => {
    launchActivity.mockRejectedValue(new Error("down"));
    recycleBin.mockResolvedValue(BIN);
    mount();
    await act(async () => click("Next Tip"));
    for (let i = 1; i < FIXED_TIPS.length; i++) click("Next Tip");
    expect(tip()).toMatch(/Trash is empty/);
  });

  it("a stale pulse still names its last block; an activity read that lands after closing is dropped", async () => {
    let done!: (a: Activity) => void;
    launchActivity.mockReturnValue(new Promise((r) => (done = r)));
    const { view } = mount(fakePulse({ kind: "stale", pulse: pulse(5), history: [], why: "x" }));
    expect(tip()).toMatch(/#5/);
    view.unmount();
    await act(async () => done(ACT));
  });

  it("opens Explore Base, the Base card, Launch — each closing the Welcome screen", () => {
    const { open, onClose } = mount();
    click("Explore Base");
    expect(open.mock.calls[0]![0]).toBe("explore");
    click("Make my Base card");
    expect(open.mock.calls[1]![0]).toBe(cardWindow());
    click("Launch a coin");
    expect(open.mock.calls[2]![0]).toBe("launch");
    expect(onClose).toHaveBeenCalledTimes(3);
    click("Close");
    fireEvent.click(document.querySelector(".welcome__win .light--close")!);
    expect(onClose).toHaveBeenCalledTimes(5);
  });

  it("the card window is `card` once registered, else the profile", () => {
    expect(cardWindow(() => ({}))).toBe("card");
    expect(cardWindow(() => null)).toBe("profile");
  });

  it("What's New lists every item; Later and Esc close it alone; Show me opens the first item's window", () => {
    const { open, onClose } = mount();
    click("What's New");
    const news = screen.getByRole("dialog", { name: "What's New" });
    expect(news).toHaveTextContent(`New in ${BRAND.name}!`);
    for (const item of WHATS_NEW) expect(news).toHaveTextContent(item.title);
    click("Later");
    expect(screen.queryByRole("dialog", { name: "What's New" })).toBeNull();
    click("What's New");
    click("Close What's New");
    click("What's New");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "What's New" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    click("What's New");
    click("Show me");
    expect(open).toHaveBeenCalledWith(WHATS_NEW[0]!.window);
    expect(onClose).toHaveBeenCalledOnce();
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

  it("does not show for a ?do= link, and Q greets as before", async () => {
    vi.useFakeTimers();
    renderAt("/?do=markets");
    await act(async () => {});
    expect(screen.queryByRole("dialog", { name: `Welcome to ${BRAND.name}` })).toBeNull();
    act(() => void vi.advanceTimersByTime(HELLO_MS));
    expect(screen.getByText(GREETING.text)).toBeInTheDocument();
  });

  it("does not show once turned off, and Q greets", async () => {
    localStorage.setItem(WELCOME_KEY, "off");
    renderAt("/");
    await settle();
    expect(screen.queryByRole("dialog", { name: `Welcome to ${BRAND.name}` })).toBeNull();
  });
});
