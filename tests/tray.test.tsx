import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { BlockClock, SoundToggle, clockText } from "@/ui/TrayExtras";
import { PulseContext } from "@/ui/usePulse";
import { SOUND_KEY, soundOn } from "@/lib/sound";
import { renderAt, settle } from "./helpers";
import { fakePulse, pulse } from "./pulseFake";

afterEach(() => vi.useRealTimers());

describe("BlockClock", () => {
  it("says it is reading while the pulse waits, and ticks the time every 15 s", () => {
    vi.useFakeTimers();
    let t = new Date(2026, 9, 14, 9, 5);
    const now = () => t;
    const p = fakePulse();
    render(
      <PulseContext.Provider value={p.store}>
        <BlockClock now={now} />
      </PulseContext.Provider>,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveAccessibleName(`reading Base…, ${clockText(t)}. Open Task Manager`);
    expect(button.title).toMatch(/Click for Task Manager/);
    t = new Date(2026, 9, 14, 9, 6);
    act(() => void vi.advanceTimersByTime(15_000));
    expect(screen.getByText(clockText(t))).toBeInTheDocument();
  });

  it("shows a live block with a beat, then a stale one, then no block at all", () => {
    const p = fakePulse({ kind: "live", pulse: pulse(36_000_001), history: [pulse(36_000_001)] });
    const onOpen = vi.fn();
    const { container } = render(
      <PulseContext.Provider value={p.store}>
        <BlockClock onOpen={onOpen} />
      </PulseContext.Provider>,
    );
    expect(screen.getByRole("button", { name: /^block 36,000,001, / })).toBeInTheDocument();
    expect(container.querySelector(".tray__beat--live")).not.toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledOnce();

    act(() => p.set({ kind: "stale", pulse: pulse(36_000_001), history: [], why: "rpc down" }));
    const b = screen.getByRole("button");
    expect(b).toHaveClass("tray__clock--stale");
    expect(b.title).toBe("The latest block could not be read: rpc down");
    expect(container.querySelector(".tray__beat")).not.toBeNull();
    expect(container.querySelector(".tray__beat--live")).toBeNull();

    act(() => p.set({ kind: "stale", pulse: null, history: [], why: "rpc down" }));
    expect(screen.getByRole("button", { name: /^Base not reached, / })).toBeInTheDocument();
    expect(container.querySelector(".tray__beat")).toBeNull();
  });
});

describe("SoundToggle", () => {
  it("is off until asked, turns on (persisted) and off again", () => {
    render(<SoundToggle />);
    const b = screen.getByRole("button", { name: "Sound off — click to turn on" });
    expect(b).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(b);
    expect(localStorage.getItem(SOUND_KEY)).toBe("on");
    expect(soundOn()).toBe(true);
    const on = screen.getByRole("button", { name: "Sound on — click to mute" });
    expect(on).toHaveAttribute("title", "Sound on");
    fireEvent.click(on);
    expect(localStorage.getItem(SOUND_KEY)).toBe("off");
    expect(screen.getByRole("button", { name: "Sound off — click to turn on" })).toHaveAttribute("title", "Sound off");
  });
});

describe("the tray and desktop on the real page", () => {
  it("has the clock in the tray, which opens Task Manager", async () => {
    renderAt("/");
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Open Task Manager/ }));
    await settle();
    expect(screen.getAllByRole("tab", { name: "Performance" }).length).toBeGreaterThan(0);
  });
});
