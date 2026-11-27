import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ControlPanel } from "@/features/panels/ControlPanel";
import { DesktopWallpaper, drawGlyph } from "@/features/DesktopWallpaper";
import {
  DOT_SHAPES,
  WALLPAPER_SCENE_KEY,
  WALLPAPER_SHAPE_KEY,
  customWallpaperImage,
  setCustomWallpaperImage,
  setWallpaper,
  setWallpaperScene,
  setWallpaperShape,
  wallpaperScene,
  wallpaperShape,
} from "@/lib/settings";

afterEach(() => {
  localStorage.clear();
  setCustomWallpaperImage(null);
  vi.restoreAllMocks();
});

describe("Halftone Motion wallpaper settings & Control Panel", () => {
  it("persists wallpaper scene, dot shape, and custom uploaded photo", () => {
    expect(wallpaperScene()).toBe("q001");
    expect(wallpaperShape()).toBe("circle");
    setWallpaperScene("meadow");
    setWallpaperShape("diamond");
    expect(localStorage.getItem(WALLPAPER_SCENE_KEY)).toBe("meadow");
    expect(localStorage.getItem(WALLPAPER_SHAPE_KEY)).toBe("diamond");
    expect(wallpaperScene()).toBe("meadow");
    expect(wallpaperShape()).toBe("diamond");

    setCustomWallpaperImage("data:image/png;base64,AAA");
    expect(customWallpaperImage()).toBe("data:image/png;base64,AAA");
    setCustomWallpaperImage(null);
    expect(customWallpaperImage()).toBeNull();
  });

  it("renders all 5 dot shapes cleanly via drawGlyph", () => {
    const ctx = {
      moveTo: vi.fn(),
      arc: vi.fn(),
      rect: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    for (const s of DOT_SHAPES) drawGlyph(ctx, s.id, 10, 10, 8);
    expect(ctx.arc).toHaveBeenCalledTimes(1);
    expect(ctx.rect).toHaveBeenCalled();
    expect(ctx.closePath).toHaveBeenCalledTimes(1);
  });

  it("shows Scene, Photo upload, and Dot shape controls in ControlPanel when Halftone Motion is selected", () => {
    setWallpaper("motion");
    render(<ControlPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Sunlit Hill" }));
    expect(wallpaperScene()).toBe("meadow");
    fireEvent.click(screen.getByRole("button", { name: "Square" }));
    expect(wallpaperShape()).toBe("square");
    act(() => setCustomWallpaperImage("data:image/png;base64,BBB"));
    fireEvent.click(screen.getByRole("button", { name: "Clear photo" }));
    expect(customWallpaperImage()).toBeNull();
  });

  it("mounts DesktopWallpaper canvas cleanly without crashing in jsdom", () => {
    const { container } = render(<DesktopWallpaper />);
    expect(container.querySelector("canvas.desktop-wallpaper")).not.toBeNull();
  });
});
