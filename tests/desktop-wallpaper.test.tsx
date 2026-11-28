import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ControlPanel } from "@/features/panels/ControlPanel";
import { DesktopWallpaper, drawGlyph } from "@/features/DesktopWallpaper";
import { HalftoneField } from "@/ui/HalftoneField";
import { AboutDisk, AboutMachine } from "@/pages/AboutMachine";
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
  it("defaults to Halftone Motion, Q-001, and Square, and persists changes", () => {
    expect(wallpaperScene()).toBe("q001");
    expect(wallpaperShape()).toBe("square");
    setWallpaperScene("meadow");
    setWallpaperShape("jumbo");
    expect(localStorage.getItem(WALLPAPER_SCENE_KEY)).toBe("meadow");
    expect(localStorage.getItem(WALLPAPER_SHAPE_KEY)).toBe("jumbo");
    expect(wallpaperScene()).toBe("meadow");
    expect(wallpaperShape()).toBe("jumbo");

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
    for (const s of DOT_SHAPES) drawGlyph(ctx, s.id, 10, 10, 8, 2);
    expect(DOT_SHAPES.map((s) => s.id)).toEqual(["circle", "square", "jumbo", "rain", "blueprint"]);
    expect(ctx.arc).toHaveBeenCalledTimes(1);
    expect(ctx.rect).toHaveBeenCalled();
  });

  it("shows Scene, Photo upload, and Dot shape controls in ControlPanel when Halftone Motion is selected", () => {
    setWallpaper("motion");
    render(<ControlPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Sunlit Hill" }));
    expect(wallpaperScene()).toBe("meadow");
    fireEvent.click(screen.getByRole("button", { name: "Blueprint" }));
    expect(wallpaperShape()).toBe("blueprint");
    fireEvent.click(screen.getByRole("button", { name: "Rain" }));
    expect(wallpaperShape()).toBe("rain");
    fireEvent.click(screen.getByRole("button", { name: "Jumbotron" }));
    expect(wallpaperShape()).toBe("jumbo");
    act(() => setCustomWallpaperImage("data:image/png;base64,BBB"));
    fireEvent.click(screen.getByRole("button", { name: "Clear photo" }));
    expect(customWallpaperImage()).toBeNull();
    // Upload image path (empty selection + valid file via FileReader)
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [] } });
    class FakeReader {
      result: string | null = null;
      onload: (() => void) | null = null;
      readAsDataURL() {
        this.result = "data:image/png;base64,UPLOADED";
        this.onload?.();
      }
    }
    vi.stubGlobal("FileReader", FakeReader);
    fireEvent.change(input, { target: { files: [new File(["x"], "bg.png", { type: "image/png" })] } });
    expect(customWallpaperImage()).toBe("data:image/png;base64,UPLOADED");
    vi.unstubAllGlobals();
  });

  it("mounts DesktopWallpaper canvas cleanly without crashing in jsdom", () => {
    const { container } = render(<DesktopWallpaper />);
    expect(container.querySelector("canvas.desktop-wallpaper")).not.toBeNull();
  });

  it("draws DesktopWallpaper (q001 + photo scenes), HalftoneField, AboutMachine and AboutDisk with a 2D canvas context", () => {
    const prevGetContext = HTMLCanvasElement.prototype.getContext;
    const rafQueue: FrameRequestCallback[] = [];
    let reducedMotion = false;
    const mediaListeners: (() => void)[] = [];
    const mockCtx = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      rect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      setTransform: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < data.length; i += 4) {
          data[i] = 100;
          data[i + 1] = 120;
          data[i + 2] = 140;
          data[i + 3] = 255;
        }
        return { data, width: w, height: h };
      }),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      globalAlpha: 1,
    };
    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(240);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(160);
    vi.stubGlobal("matchMedia", () => ({
      get matches() { return reducedMotion; },
      addEventListener: (_: string, fn: () => void) => mediaListeners.push(fn),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const ioCallbacks: IntersectionObserverCallback[] = [];
    vi.stubGlobal("ResizeObserver", class {
      observe = vi.fn();
      disconnect = vi.fn();
    });
    vi.stubGlobal("IntersectionObserver", class {
      constructor(cb: IntersectionObserverCallback) { ioCallbacks.push(cb); }
      observe = vi.fn();
      disconnect = vi.fn();
    });
    let imgW = 800;
    let imgH = 400;
    const loadedImages: { onload: (() => void) | null }[] = [];
    vi.stubGlobal("Image", class {
      complete = true;
      get naturalWidth() { return imgW; }
      get naturalHeight() { return imgH; }
      onload: (() => void) | null = null;
      set src(_v: string) { loadedImages.push(this); }
    });
    try {
      // 1. DesktopWallpaper: q001 + blueprint + rain + pointer move/leave
      act(() => {
        setCustomWallpaperImage(null);
        setWallpaperScene("q001");
        setWallpaperShape("blueprint");
      });
      const w1 = render(<DesktopWallpaper />);
      fireEvent.pointerMove(window, { pointerType: "mouse", clientX: 80, clientY: 60 });
      fireEvent.pointerMove(window, { pointerType: "mouse", clientX: 90, clientY: 70 });
      rafQueue.splice(0).forEach((cb) => cb(1200));
      act(() => setWallpaperShape("rain"));
      rafQueue.splice(0).forEach((cb) => cb(2400));
      fireEvent.pointerLeave(document.documentElement);
      w1.unmount();

      // 2. DesktopWallpaper: photo scene (wide & tall images) + blueprint + rain
      act(() => {
        setWallpaperScene("meadow");
        setWallpaperShape("blueprint");
      });
      const w2 = render(<DesktopWallpaper />);
      loadedImages.splice(0).forEach((im) => im.onload?.());
      fireEvent.pointerMove(window, { pointerType: "mouse", clientX: 60, clientY: 50 });
      rafQueue.splice(0).forEach((cb) => cb(1500));
      act(() => setWallpaperShape("rain"));
      imgW = 200;
      imgH = 600;
      rafQueue.splice(0).forEach((cb) => cb(2500));
      w2.unmount();

      // 3. HalftoneField (intro & document, pointer move/touch/leave, intersection, reduced motion)
      Object.defineProperty(window, "devicePixelRatio", { value: 0, configurable: true });
      const h1 = render(<div><HalftoneField variant="intro" /><HalftoneField variant="document" /></div>);
      const parent = h1.container.firstElementChild!;
      fireEvent(parent, Object.assign(new Event("pointermove"), { pointerType: "touch", clientX: 20, clientY: 20 }));
      fireEvent(parent, Object.assign(new Event("pointermove"), { pointerType: "mouse", clientX: 40, clientY: 40 }));
      rafQueue.splice(0).forEach((cb) => cb(500));
      fireEvent.pointerLeave(parent);
      ioCallbacks.forEach((cb) => cb([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
      ioCallbacks.forEach((cb) => cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
      ioCallbacks.forEach((cb) => cb([], {} as IntersectionObserver));
      ioCallbacks.forEach((cb) => cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
      reducedMotion = true;
      mediaListeners.forEach((fn) => fn());
      reducedMotion = false;
      h1.unmount();

      // 3b. DesktopWallpaper pointer move/leave + photo scene with & without photo + urlParam + !alive + !sctx
      window.history.pushState({}, "", "/?scene=q001&dots=rain");
      const wMove = render(<DesktopWallpaper />);
      fireEvent(window, Object.assign(new Event("pointermove"), { pointerType: "touch", clientX: 10, clientY: 10 }));
      fireEvent(window, Object.assign(new Event("pointermove"), { pointerType: "mouse", clientX: 40, clientY: 40 }));
      fireEvent(window, Object.assign(new Event("pointermove"), { pointerType: "mouse", clientX: 50, clientY: 50 }));
      rafQueue.splice(0).forEach((cb) => cb(1200));
      rafQueue.splice(0).forEach((cb) => cb(1400));
      fireEvent(window, new Event("pointerleave"));
      wMove.unmount();

      window.history.pushState({}, "", "/");
      setWallpaperScene("meadow");
      setCustomWallpaperImage(null);
      // Photo scene with mouse hover + late onload after unmount (!alive)
      const wPhotoHover = render(<DesktopWallpaper />);
      const lateImg = loadedImages.splice(0);
      lateImg.forEach((im) => im.onload?.());
      fireEvent(window, Object.assign(new Event("pointermove"), { pointerType: "mouse", clientX: 40, clientY: 40 }));
      rafQueue.splice(0).forEach((cb) => cb(1600));
      rafQueue.splice(0).forEach((cb) => cb(1800));
      wPhotoHover.unmount();
      lateImg.forEach((im) => im.onload?.());

      // Photo scene when offscreen getContext returns null (!sctx) and AboutMachine when sampler getContext returns null
      let ctxCalls = 0;
      HTMLCanvasElement.prototype.getContext = vi.fn(() => (++ctxCalls % 2 === 1 ? mockCtx : null)) as unknown as typeof HTMLCanvasElement.prototype.getContext;
      const wNoSctx = render(<DesktopWallpaper />);
      loadedImages.splice(0).forEach((im) => im.onload?.());
      wNoSctx.unmount();

      ctxCalls = 0;
      const amNoSampler = render(<AboutMachine />);
      amNoSampler.unmount();
      HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx) as unknown as typeof HTMLCanvasElement.prototype.getContext;

      vi.stubGlobal("Image", class {
        complete = false;
        naturalWidth = 0;
        naturalHeight = 0;
        onload: (() => void) | null = null;
        set src(_v: string) { loadedImages.push(this); }
      });
      const wEmpty = render(<DesktopWallpaper />);
      wEmpty.unmount();
      Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });

      // 4. AboutMachine & AboutDisk (machine + disk, transition phase, !size continue, touch pointerType)
      let samplePass = 0;
      mockCtx.getImageData.mockImplementation((_x: number, _y: number, w: number, h: number) => {
        samplePass++;
        const data = new Uint8ClampedArray(w * h * 4);
        const val = samplePass % 2 === 1 ? 80 : 250;
        for (let i = 0; i < data.length; i += 4) {
          data[i] = val;
          data[i + 1] = val;
          data[i + 2] = val;
          data[i + 3] = 255;
        }
        return { data, width: w, height: h };
      });
      const am = render(<><AboutMachine /><AboutDisk /></>);
      loadedImages.splice(0).forEach((im) => im.onload?.());
      const art = am.container.querySelector(".about__machine-art")!;
      fireEvent(art, Object.assign(new Event("pointermove", { bubbles: true }), { pointerType: "touch", clientX: 20, clientY: 20 }));
      fireEvent(art, Object.assign(new Event("pointermove", { bubbles: true }), { pointerType: "mouse", clientX: 50, clientY: 50 }));
      rafQueue.splice(0).forEach((cb) => cb(2600));
      rafQueue.splice(0).forEach((cb) => cb(3300));
      rafQueue.splice(0).forEach((cb) => cb(5000));
      fireEvent.pointerLeave(art);
      reducedMotion = true;
      rafQueue.splice(0).forEach((cb) => cb(6000));
      am.unmount();
    } finally {
      HTMLCanvasElement.prototype.getContext = prevGetContext;
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});
