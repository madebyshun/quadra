import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderAt, settle } from "./helpers";
import { BRAND } from "@/brand";
import {
  DEFAULT_SAVER_MINUTES,
  SAVER_KEY,
  SAVER_MINUTES_KEY,
  WALLPAPER_KEY,
  onSettingsChange,
  saverMinutes,
  saverOn,
  setSaverMinutes,
  setSaverOn,
  setWallpaper,
  wallpaper,
} from "@/lib/settings";
import { useSetting } from "@/ui/useSettings";
import { SOUND_KEY, soundOn, setSoundOn } from "@/lib/sound";
import { WELCOME_KEY, welcomeOn } from "@/lib/welcome";
import { ControlPanel } from "@/features/panels/ControlPanel";
import { README, ReadmePanel } from "@/features/panels/ReadmePanel";
import { FolderPanel } from "@/features/panels/FolderPanel";
import { Screensaver } from "@/ui/Screensaver";
import { PulseContext } from "@/ui/usePulse";
import { fakePulse } from "./pulseFake";

/**
 * The desktop reorganised into folders (2026-10-21): the Control Panel's settings, README.TXT and
 * an empty folder. The folders themselves are driven through the whole app in `app.test.tsx`.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the Control Panel's settings", () => {
  it("keeps each under its own frozen key", () => {
    expect(WALLPAPER_KEY).toBe("quadra.wallpaper.v1");
    expect(SAVER_KEY).toBe("quadra.saver.v1");
    expect(SAVER_MINUTES_KEY).toBe("quadra.saver-minutes.v1");
  });

  it("reads the defaults from an empty browser, and what was picked after", () => {
    expect([wallpaper(), saverOn(), saverMinutes()]).toEqual(["bliss", true, DEFAULT_SAVER_MINUTES]);
    setWallpaper("teal");
    setSaverOn(false);
    setSaverMinutes(10);
    expect([wallpaper(), saverOn(), saverMinutes()]).toEqual(["teal", false, 10]);
    setSaverOn(true);
    expect(localStorage.getItem(SAVER_KEY)).toBe("on");
  });

  it("reads a value it does not recognise as the default", () => {
    localStorage.setItem(WALLPAPER_KEY, "constructor");
    localStorage.setItem(SAVER_MINUTES_KEY, "7");
    expect(wallpaper()).toBe("bliss");
    expect(saverMinutes()).toBe(DEFAULT_SAVER_MINUTES);
  });

  it("reads unreadable storage as the defaults, and survives a write that fails", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect([wallpaper(), saverOn(), saverMinutes()]).toEqual(["bliss", true, DEFAULT_SAVER_MINUTES]);
    const heard = vi.fn();
    const off = onSettingsChange(heard);
    setWallpaper("dark");
    expect(heard).toHaveBeenCalledTimes(1);
    off();
    setWallpaper("dark");
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("re-renders a component when a setting changes", () => {
    const { result } = renderHook(() => useSetting(wallpaper));
    expect(result.current).toBe("bliss");
    act(() => setWallpaper("dither"));
    expect(result.current).toBe("dither");
  });
});

describe("the Control Panel window", () => {
  it("changes the wallpaper, and the desktop wears it at once", async () => {
    const user = userEvent.setup();
    renderAt("/?do=control");
    await settle();
    const desk = document.querySelector(".desktop")!;
    expect(desk).toHaveClass("wallpaper--bliss");
    expect(screen.getByRole("radio", { name: "Blue-grey" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Teal" }));
    expect(desk).toHaveClass("wallpaper--teal");
    expect(localStorage.getItem(WALLPAPER_KEY)).toBe("teal");
    await user.click(screen.getByRole("radio", { name: "Bricks" }));
    expect(desk).toHaveClass("wallpaper--bricks");
  });

  it("keeps every XP-era wallpaper a browser may have saved: each id still reads, now as a Platinum desktop", () => {
    for (const id of ["bliss", "teal", "dither", "dark"]) {
      localStorage.setItem(WALLPAPER_KEY, id);
      expect(wallpaper()).toBe(id);
    }
  });

  it("turns sound on and off, the same switch as the tray's", async () => {
    const user = userEvent.setup();
    render(<ControlPanel />);
    const box = screen.getByRole("checkbox", { name: "Play the machine's sounds" });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(soundOn()).toBe(true);
    expect(localStorage.getItem(SOUND_KEY)).toBe("on");
    await user.click(box);
    expect(soundOn()).toBe(false);
    act(() => setSoundOn(true));
    expect(box).toBeChecked();
  });

  it("sets the screen saver and its idle minutes, the minutes greyed while it is off", async () => {
    const user = userEvent.setup();
    render(<ControlPanel />);
    const minutes = screen.getByRole("combobox");
    await user.selectOptions(minutes, "5");
    expect(saverMinutes()).toBe(5);
    await user.click(screen.getByRole("checkbox", { name: /Show Base's blocks/ }));
    expect(saverOn()).toBe(false);
    expect(minutes).toBeDisabled();
  });

  it("switches the Welcome screen off and back on", async () => {
    const user = userEvent.setup();
    localStorage.removeItem(WELCOME_KEY);
    render(<ControlPanel />);
    const box = screen.getByRole("checkbox", { name: "Show the Welcome screen at startup" });
    expect(box).toBeChecked();
    await user.click(box);
    expect(welcomeOn()).toBe(false);
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(welcomeOn()).toBe(true);
  });
});

describe("the screen saver's settings", () => {
  const mount = () =>
    render(
      <PulseContext.Provider value={fakePulse().store}>
        <Screensaver />
      </PulseContext.Provider>,
    );
  const saver = () => screen.queryByRole("img", { name: /Screensaver/ });

  it("waits the minutes the Control Panel set", () => {
    vi.useFakeTimers();
    setSaverMinutes(1);
    mount();
    act(() => void vi.advanceTimersByTime(59_999));
    expect(saver()).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(saver()).not.toBeNull();
  });

  it("never starts once switched off, and stops when switched off while running", () => {
    vi.useFakeTimers();
    setSaverMinutes(1);
    mount();
    act(() => void vi.advanceTimersByTime(60_000));
    expect(saver()).not.toBeNull();
    act(() => setSaverOn(false));
    expect(saver()).toBeNull();
    act(() => void vi.advanceTimersByTime(600_000));
    expect(saver()).toBeNull();
  });
});

describe("README.TXT", () => {
  it("opens in Notepad from the desktop, in the product's own name", async () => {
    const user = userEvent.setup();
    renderAt("/");
    await user.click(within(screen.getByLabelText("What you can do")).getByRole("button", { name: /^README\.TXT/ }));
    const text = screen.getByLabelText("README.TXT", { selector: "pre" });
    expect(text.textContent).toBe(README);
    expect(README.startsWith(`${BRAND.name.toUpperCase()} FOR BASE 8453\n${"=".repeat(`${BRAND.name} FOR BASE 8453`.length)}\n`)).toBe(true);
    expect(screen.getByLabelText("README.TXT - Notepad", { selector: "section" })).toBeInTheDocument();
  });

  it("names every folder on the desktop", () => {
    render(<ReadmePanel />);
    for (const name of ["My Computer", "Research", "Money", "Launchpad", "Games", "Agents"]) expect(README).toContain(`  ${name}`);
  });
});

describe("a folder", () => {
  it("says it is empty when nothing in it is switched on", async () => {
    const registry = await import("@/features/registry");
    vi.spyOn(registry, "folderItems").mockReturnValue([]);
    render(<FolderPanel id="folder-games" />);
    expect(screen.getByText("This folder is empty.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("0 objects");
  });

  it("counts one object in the singular", async () => {
    const registry = await import("@/features/registry");
    vi.spyOn(registry, "folderItems").mockReturnValue([registry.entryOf("taskmgr")]);
    render(<FolderPanel id="computer" />);
    expect(screen.getByRole("status")).toHaveTextContent(/^1 object(?!s)/);
    fireEvent.click(screen.getByRole("button", { name: "Task Manager" }));
    expect(screen.getByRole("status")).toHaveTextContent("Task Manager — the CPU is Base");
  });
});
