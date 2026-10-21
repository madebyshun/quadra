import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { IDLE_MS, Screensaver } from "@/ui/Screensaver";
import { PulseContext } from "@/ui/usePulse";
import { fakePulse, pulse } from "./pulseFake";
import { renderAt, settle } from "./helpers";

afterEach(() => vi.useRealTimers());

const saver = () => screen.queryByRole("img", { name: /Screensaver/ });

function mount(p = fakePulse(), idleMs?: number) {
  return render(
    <PulseContext.Provider value={p.store}>
      <Screensaver {...(idleMs === undefined ? {} : { idleMs })} />
    </PulseContext.Provider>,
  );
}

describe("Screensaver", () => {
  it("starts after the idle time, shows no blocks while the pulse waits, and input wakes it", () => {
    vi.useFakeTimers();
    const { unmount } = mount();
    act(() => void vi.advanceTimersByTime(IDLE_MS - 1));
    expect(saver()).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(saver()).not.toBeNull();
    expect(document.querySelectorAll(".saver__block")).toHaveLength(0);
    act(() => void fireEvent.keyDown(window));
    expect(saver()).toBeNull();
    act(() => void vi.advanceTimersByTime(IDLE_MS));
    expect(saver()).not.toBeNull();
    unmount();
  });

  it("draws the newest twelve blocks from the pulse history", () => {
    vi.useFakeTimers();
    const history = Array.from({ length: 15 }, (_, i) => pulse(1000 + i, { txs: i }));
    mount(fakePulse({ kind: "live", pulse: history[14]!, history }), 10);
    act(() => void vi.advanceTimersByTime(10));
    const blocks = document.querySelectorAll(".saver__block");
    expect(blocks).toHaveLength(12);
    expect(blocks[0]!.textContent).toBe("#1,003 · 3 txs");
    expect(blocks[11]!.textContent).toBe("#1,014 · 14 txs");
  });

  it("never runs for somebody who asked for less motion", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    mount(fakePulse(), 10);
    act(() => void vi.advanceTimersByTime(1000));
    expect(saver()).toBeNull();
  });

  it("is mounted on the real desktop", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    renderAt("/");
    await settle();
    act(() => void vi.advanceTimersByTime(IDLE_MS));
    expect(saver()).not.toBeNull();
  });
});
