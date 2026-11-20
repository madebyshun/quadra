import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AT, BACKDROP, blockLine, loaded, MACHINE, MENU, moveTo, phaseAt, shouldPlayIntro, ZOOM_MS } from "@/intro/photo";
import { PulseContext } from "@/ui/usePulse";
import { fakePulse, pulse } from "./pulseFake";
import { PhotoIntro } from "@/intro/PhotoIntro";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The photo intro: its clock, loading bar, and automatic handoff to the desktop. */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
afterEach(() => vi.useRealTimers());

describe("the intro's arithmetic", () => {
  it("rises out of the haze, powers on, shows its icon, welcomes and loads, then finishes", () => {
    expect([0, AT.power - 1, AT.power, AT.icon, AT.welcome, AT.menu - 1, AT.menu, 99_999].map(phaseAt)).toEqual(["haze", "haze", "power", "icon", "welcome", "welcome", "menu", "menu"]);
    expect([AT.welcome - 5, AT.welcome, (AT.welcome + AT.menu) / 2, AT.menu + 50].map(loaded)).toEqual([0, 0, 0.5, 1]);
  });

  it("says the latest block, or that it is still reading it", () => {
    expect(blockLine(null)).toBe("base 8453 / reading the latest block");
    expect(blockLine(59407813)).toBe("base 8453 / block 59,407,813");
  });

  it("plays only for a bare load where motion is welcome", () => {
    const media = (reduce: boolean) => () => ({ matches: reduce });
    expect(shouldPlayIntro({ search: "", matchMedia: media(false) })).toBe(true);
    expect(shouldPlayIntro({ search: "do=basket", matchMedia: media(false) })).toBe(false);
    expect(shouldPlayIntro({ search: "", matchMedia: media(true) })).toBe(false);
    expect(shouldPlayIntro({ search: "", matchMedia: undefined })).toBe(false);
  });

  it("moves through the menu with the arrows, wrapping, and ignores other keys", () => {
    expect(moveTo(0, "ArrowDown")).toBe(1);
    expect(moveTo(MENU.length - 1, "ArrowDown")).toBe(0);
    expect(moveTo(0, "ArrowUp")).toBe(MENU.length - 1);
    expect(moveTo(2, "a")).toBe(2);
  });

  it("draws over a backdrop that ships, with its glass inside the drawing", () => {
    expect(existsSync(resolve(ROOT, "public", BACKDROP.slice(1)))).toBe(true);
    const s = MACHINE.screen;
    expect(s.left + s.width).toBeLessThan(1);
    expect(s.top + s.height).toBeLessThan(1);
  });
});

describe("the intro on screen", () => {
  function mount(onDone = vi.fn()) {
    let t = 0;
    const clock = () => t;
    vi.useFakeTimers({ toFake: ["setTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    const view = render(<PhotoIntro onDone={onDone} clock={clock} />);
    const to = async (ms: number) => {
      t = ms;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
    };
    return { view, to, onDone };
  }

  it("plays the icon and welcome loading bar, then automatically zooms into the desktop", async () => {
    const { to, onDone } = mount();
    const dialog = screen.getByRole("dialog", { name: "quadra is starting" });
    expect(dialog).toHaveClass("pintro--haze");
    expect(screen.getByRole("img", { name: /straight on/ })).toBeInTheDocument();
    await to(AT.icon + 10);
    expect(dialog).toHaveClass("pintro--icon");
    await to(AT.welcome + 800);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    await to(AT.menu + 10);
    expect(dialog).toHaveClass("pintro--zoom");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ZOOM_MS);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(null);
  });

  it("goes straight to the desktop on Esc, Skip, or clicking the screen", async () => {
    for (const how of ["esc", "skip", "click"] as const) {
      const { to, onDone, view } = mount();
      await to(AT.welcome + 100);
      if (how === "esc") fireEvent.keyDown(window, { key: "Escape" });
      if (how === "skip") fireEvent.click(screen.getByRole("button", { name: "skip" }));
      if (how === "click") fireEvent.click(screen.getByRole("dialog"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ZOOM_MS);
      });
      expect(onDone, how).toHaveBeenCalledWith(null);
      view.unmount();
      vi.useRealTimers();
    }
  });

  it("shows the welcome box with the latest block the page's pulse has read", async () => {
    const live = fakePulse({ kind: "live", pulse: pulse(59_407_813), history: [] });
    let t = 0;
    render(
      <PulseContext.Provider value={live.store}>
        <PhotoIntro onDone={vi.fn()} clock={() => t} />
      </PulseContext.Provider>,
    );
    t = AT.welcome + 100;
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
    });
    expect(screen.getByText("welcome to quadra")).toBeInTheDocument();
    expect(screen.getByText("base 8453 / block 59,407,813")).toBeInTheDocument();
  });

  it("runs on the page's own clock when none is given", () => {
    const { unmount } = render(<PhotoIntro onDone={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    unmount();
  });

  it("shows the power line before the page, and nothing on the tube in the haze", async () => {
    const { to } = mount();
    expect(screen.queryByRole("progressbar")).toBeNull();
    await to(AT.power + 10);
    expect(screen.getByRole("dialog")).toHaveClass("pintro--power");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
