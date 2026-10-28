import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  EDGE_MARGIN,
  EMPTY_STATE,
  centeredOrigin,
  windowWidth,
  MIN_HEIGHT,
  PAGE_HEIGHT,
  pageHeight,
  MIN_WIDTH,
  closeWindow,
  focusWindow,
  minimizeAll,
  minimizeWindow,
  moveWindow,
  openWindow,
  reduceWindows,
  resizeWindow,
  restoreWindow,
  topWindowId,
  toggleFromTaskbar,
  type WindowManagerState,
} from "@/lib/windowManager";

describe("windowManager", () => {
  it("has no top window in the empty state", () => {
    expect(topWindowId(EMPTY_STATE)).toBeNull();
  });

  it("opens a window and makes it the top window", () => {
    const s1 = openWindow(EMPTY_STATE, "send");
    expect(s1.windows).toHaveLength(1);
    expect(s1.windows[0]!).toMatchObject({ id: "send", minimized: false, z: 1 });
    expect(topWindowId(s1)).toBe("send");
  });

  it("opens at the panel height unless a caller asks for another", () => {
    expect(openWindow(EMPTY_STATE, "send").windows[0]!.height).toBe(DEFAULT_HEIGHT);
    expect(openWindow(EMPTY_STATE, "docs", undefined, 660).windows[0]!.height).toBe(660);
  });

  /** The prose windows: tall enough not to open into a scrollbar, never taller than the viewport. */
  it("clamps the prose height to the viewport, with the same floor a manual resize gets", () => {
    expect(pageHeight(2000)).toBe(PAGE_HEIGHT);
    expect(pageHeight(500)).toBe(380);
    expect(pageHeight(100)).toBe(MIN_HEIGHT);
  });

  it("cascades the position of each newly opened window", () => {
    const s1 = openWindow(EMPTY_STATE, "send");
    const s2 = openWindow(s1, "mcp");
    expect(s2.windows[1]!.x).toBeGreaterThan(s2.windows[0]!.x);
    expect(s2.windows[1]!.y).toBeGreaterThan(s2.windows[0]!.y);
  });

  it("wraps the cascade after ten windows rather than walking off-screen", () => {
    const ids = ["send", "mcp", "x402", "hooks", "inference", "swap", "research", "bridge", "launch", "audit"] as const;
    let state: WindowManagerState = EMPTY_STATE;
    for (const id of ids) state = openWindow(state, id);
    const audit = state.windows.find((w) => w.id === "audit")!;
    // closing "send" (slot 0) drops the open count to 9 — reopening it lands on slot 9, same as "audit"
    const reopened = openWindow(closeWindow(state, "send"), "send");
    expect(reopened.windows.find((w) => w.id === "send")!.x).toBe(audit.x);
  });

  /**
   * MEASURED 2026-10-02 at a true 390x844 layout: x=260, width 460, right edge 720.
   * The window is position: fixed, so scrollWidth never saw it — these are the numbers
   * that do. `inside` is the property; the exact values pin the desktop as unchanged.
   */
  describe("fitting the viewport", () => {
    const inside = (o: ReturnType<typeof centeredOrigin>, vw: number) =>
      o.x >= EDGE_MARGIN && o.x + o.width! <= vw - EDGE_MARGIN;

    it("leaves desktop placement where it was", () => {
      expect(centeredOrigin(1120, 700)).toEqual({ x: 330, y: 46, width: DEFAULT_WIDTH, maxX: 652 });
      expect(centeredOrigin(1120, 700, pageHeight(700)).x).toBe(330);
    });

    it("keeps clear of the icon column whenever the window fits beside it", () => {
      expect(centeredOrigin(728, 700).x).toBe(260);
    });

    it("narrows and slides a window left until it is on screen at 390px", () => {
      const o = centeredOrigin(390, 844);
      expect(o).toMatchObject({ x: EDGE_MARGIN, width: 390 - 2 * EDGE_MARGIN });
      expect(inside(o, 390)).toBe(true);
    });

    it("gives up the icon column before it gives up the screen, between the two layouts", () => {
      // 700px still has the icon column, but 260 + 460 runs 20px off the right edge
      const o = centeredOrigin(700, 700);
      expect(o).toMatchObject({ x: 700 - EDGE_MARGIN - DEFAULT_WIDTH, width: DEFAULT_WIDTH });
      expect(inside(o, 700)).toBe(true);
    });

    it("is on screen at every width from a small phone up", () => {
      for (let vw = 320; vw <= 1600; vw += 1) expect(inside(centeredOrigin(vw, 800), vw)).toBe(true);
    });

    it("opens no wider than the viewport, even below the resize floor", () => {
      expect(windowWidth(2000)).toBe(DEFAULT_WIDTH);
      expect(windowWidth(300)).toBe(300 - 2 * EDGE_MARGIN);
      expect(windowWidth(300)).toBeLessThan(MIN_WIDTH);
    });

    it("opens at the fitted width and keeps a whole cascade on screen", () => {
      const origin = centeredOrigin(390, 844);
      const ids = ["send", "mcp", "x402", "hooks", "inference", "swap", "research", "bridge", "launch", "audit"] as const;
      let state: WindowManagerState = EMPTY_STATE;
      for (const id of ids) state = openWindow(state, id, origin);
      for (const w of state.windows) {
        expect(w.width).toBe(origin.width);
        expect(w.x + w.width).toBeLessThanOrEqual(390 - EDGE_MARGIN);
      }
      // the vertical step survives, so the stack still reads as a cascade
      expect(state.windows[9]!.y).toBeGreaterThan(state.windows[0]!.y);
    });

    it("still cascades rightward when there is room", () => {
      const origin = centeredOrigin(1120, 700);
      const s = openWindow(openWindow(EMPTY_STATE, "send", origin), "mcp", origin);
      expect(s.windows[1]!.x).toBe(330 + 28);
    });
  });

  it("opening an already-open window focuses it instead of duplicating it", () => {
    const s1 = openWindow(EMPTY_STATE, "send");
    const s2 = openWindow(s1, "mcp");
    const s3 = openWindow(s2, "send");
    expect(s3.windows).toHaveLength(2);
    expect(topWindowId(s3)).toBe("send");
  });

  it("opening a minimised window un-minimises and focuses it", () => {
    const s1 = openWindow(EMPTY_STATE, "send");
    const s2 = minimizeWindow(s1, "send");
    expect(topWindowId(s2)).toBeNull();
    const s3 = openWindow(s2, "send");
    expect(s3.windows[0]!.minimized).toBe(false);
    expect(topWindowId(s3)).toBe("send");
  });

  it("focusing a window that is not open is a no-op", () => {
    const s1 = openWindow(EMPTY_STATE, "send");
    const s2 = focusWindow(s1, "mcp");
    expect(s2).toEqual(s1);
  });

  it("focusing the back window brings it to the top", () => {
    const s1 = openWindow(EMPTY_STATE, "send");
    const s2 = openWindow(s1, "mcp");
    expect(topWindowId(s2)).toBe("mcp");
    const s3 = focusWindow(s2, "send");
    expect(topWindowId(s3)).toBe("send");
  });

  it("closes a window, leaving others open", () => {
    const s1 = openWindow(EMPTY_STATE, "send");
    const s2 = openWindow(s1, "mcp");
    const s3 = closeWindow(s2, "send");
    expect(s3.windows.map((w) => w.id)).toEqual(["mcp"]);
  });

  it("minimizing drops a window out of the visible top, but keeps it in state", () => {
    const s1 = openWindow(EMPTY_STATE, "send");
    const s2 = minimizeWindow(s1, "send");
    expect(s2.windows[0]!.minimized).toBe(true);
    expect(topWindowId(s2)).toBeNull();
  });

  it("restoring a minimised window un-minimises and focuses it", () => {
    const s1 = openWindow(EMPTY_STATE, "send");
    const s2 = openWindow(s1, "mcp");
    const s3 = minimizeWindow(s2, "mcp");
    const s4 = restoreWindow(s3, "mcp");
    expect(s4.windows.find((w) => w.id === "mcp")!.minimized).toBe(false);
    expect(topWindowId(s4)).toBe("mcp");
  });

  it("minimizeAll hides every window, closing none", () => {
    const s1 = openWindow(EMPTY_STATE, "send");
    const s2 = openWindow(s1, "mcp");
    const s3 = minimizeAll(s2);
    expect(s3.windows).toHaveLength(2);
    expect(s3.windows.every((w) => w.minimized)).toBe(true);
    expect(topWindowId(s3)).toBeNull();
  });

  it("moves a window to a given position, leaving other windows alone", () => {
    const s1 = openWindow(openWindow(EMPTY_STATE, "send"), "mcp");
    const s2 = moveWindow(s1, "send", 123, 456);
    expect(s2.windows.find((w) => w.id === "send")).toMatchObject({ x: 123, y: 456 });
    expect(s2.windows.find((w) => w.id === "mcp")).toMatchObject(s1.windows.find((w) => w.id === "mcp")!);
  });

  it("resizes a window, leaving other windows alone", () => {
    const s1 = openWindow(openWindow(EMPTY_STATE, "send"), "mcp");
    const s2 = resizeWindow(s1, "send", 500, 400);
    expect(s2.windows.find((w) => w.id === "send")).toMatchObject({ width: 500, height: 400 });
    expect(s2.windows.find((w) => w.id === "mcp")).toMatchObject(s1.windows.find((w) => w.id === "mcp")!);
  });

  it("clamps a resize to the minimum width and height", () => {
    const s1 = openWindow(EMPTY_STATE, "send");
    const s2 = resizeWindow(s1, "send", 10, 10);
    expect(s2.windows[0]!).toMatchObject({ width: MIN_WIDTH, height: MIN_HEIGHT });
  });

  describe("toggleFromTaskbar", () => {
    it("is a no-op for a window that is not open", () => {
      const s1 = openWindow(EMPTY_STATE, "send");
      const s2 = toggleFromTaskbar(s1, "mcp");
      expect(s2).toEqual(s1);
    });

    it("restores a minimised window", () => {
      const s1 = openWindow(EMPTY_STATE, "send");
      const s2 = minimizeWindow(s1, "send");
      const s3 = toggleFromTaskbar(s2, "send");
      expect(s3.windows[0]!.minimized).toBe(false);
      expect(topWindowId(s3)).toBe("send");
    });

    it("minimizes the window that is already on top", () => {
      const s1 = openWindow(EMPTY_STATE, "send");
      const s2 = toggleFromTaskbar(s1, "send");
      expect(s2.windows[0]!.minimized).toBe(true);
    });

    it("focuses a window that is open but not on top", () => {
      const s1 = openWindow(EMPTY_STATE, "send");
      const s2 = openWindow(s1, "mcp");
      const s3 = toggleFromTaskbar(s2, "send");
      expect(topWindowId(s3)).toBe("send");
    });
  });

  describe("reduceWindows", () => {
    it("dispatches open", () => {
      const s = reduceWindows(EMPTY_STATE, { type: "open", id: "send" });
      expect(s.windows).toHaveLength(1);
    });

    it("dispatches close", () => {
      const s1 = openWindow(EMPTY_STATE, "send");
      const s2 = reduceWindows(s1, { type: "close", id: "send" });
      expect(s2.windows).toHaveLength(0);
    });

    it("dispatches focus", () => {
      const s1 = openWindow(openWindow(EMPTY_STATE, "send"), "mcp");
      const s2 = reduceWindows(s1, { type: "focus", id: "send" });
      expect(topWindowId(s2)).toBe("send");
    });

    it("dispatches minimize", () => {
      const s1 = openWindow(EMPTY_STATE, "send");
      const s2 = reduceWindows(s1, { type: "minimize", id: "send" });
      expect(s2.windows[0]!.minimized).toBe(true);
    });

    it("dispatches restore", () => {
      const s1 = minimizeWindow(openWindow(EMPTY_STATE, "send"), "send");
      const s2 = reduceWindows(s1, { type: "restore", id: "send" });
      expect(s2.windows[0]!.minimized).toBe(false);
    });

    it("dispatches toggleFromTaskbar", () => {
      const s1 = openWindow(EMPTY_STATE, "send");
      const s2 = reduceWindows(s1, { type: "toggleFromTaskbar", id: "send" });
      expect(s2.windows[0]!.minimized).toBe(true);
    });

    it("dispatches minimizeAll", () => {
      const s1 = openWindow(EMPTY_STATE, "send");
      const s2 = reduceWindows(s1, { type: "minimizeAll" });
      expect(s2.windows[0]!.minimized).toBe(true);
    });

    it("dispatches move", () => {
      const s1 = openWindow(EMPTY_STATE, "send");
      const s2 = reduceWindows(s1, { type: "move", id: "send", x: 7, y: 8 });
      expect(s2.windows[0]!).toMatchObject({ x: 7, y: 8 });
    });

    it("dispatches resize", () => {
      const s1 = openWindow(EMPTY_STATE, "send");
      const s2 = reduceWindows(s1, { type: "resize", id: "send", width: 500, height: 400 });
      expect(s2.windows[0]!).toMatchObject({ width: 500, height: 400 });
    });
  });
});
