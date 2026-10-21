import { describe, expect, it, vi } from "vitest";
import {
  advanceFrom,
  cameraAt,
  clampOrbit,
  DRIFT_MS,
  HOLDS,
  ORBIT_LIMITS,
  REST,
  coverDistance,
  ease,
  hasWebGL,
  OVERSHOOT,
  PHASES,
  phaseAt,
  shouldPlayIntro,
  startOf,
  TOTAL_MS,
  WIDE_HALF_WIDTH,
  wideDistance,
  type ScreenFrame,
} from "@/intro/timeline";

/**
 * The intro is a clock: these tests pin what the clock says — phase by phase, and where the
 * camera is — so the scene that draws it can be checked without a GPU.
 */

const SCREEN: ScreenFrame = { center: { x: 0, y: 2.6, z: 0.9 }, width: 2.6, height: 1.95 };

describe("the phases", () => {
  it("run in order, back to back, and end", () => {
    expect(PHASES.map((p) => p.id)).toEqual(["dark", "idle", "warm", "icon", "welcome", "ready", "zoom", "fade"]);
    expect(TOTAL_MS).toBe(PHASES.reduce((s, p) => s + p.ms, 0));
    expect(startOf("dark")).toBe(0);
    expect(startOf("idle")).toBe(1400);
    expect(startOf("fade")).toBe(TOTAL_MS - 700);
  });

  /** Slowed down on the owner's call of 2026-10-02: the boot itself, not counting the waits, is seven seconds and more. */
  it("boot slowly, and wait for the visitor at the machine and at the welcome box", () => {
    const boot = ["warm", "icon", "welcome"].map((id) => PHASES.find((p) => p.id === id)!.ms).reduce((a, b) => a + b, 0);
    expect(boot).toBeGreaterThanOrEqual(6_000);
    expect(HOLDS).toEqual({ idle: "power", ready: "enter" });
  });

  it("move on from a wait when the visitor acts — and only from a wait", () => {
    expect(advanceFrom(100)).toBe(startOf("warm"));
    expect(advanceFrom(startOf("idle") + 10)).toBe(startOf("warm"));
    expect(advanceFrom(startOf("ready") + 10)).toBe(startOf("zoom"));
    expect(advanceFrom(startOf("icon"))).toBeNull();
    expect(advanceFrom(startOf("zoom") + 10)).toBeNull();
  });

  it("say which phase a moment is in, and how far through", () => {
    expect(phaseAt(0)).toEqual({ id: "dark", progress: 0 });
    expect(phaseAt(700)).toEqual({ id: "dark", progress: 0.5 });
    expect(phaseAt(1400)).toEqual({ id: "idle", progress: 0 });
    expect(phaseAt(-5)).toEqual({ id: "dark", progress: 0 });
    expect(phaseAt(TOTAL_MS)).toEqual({ id: "done", progress: 1 });
  });

  it("ease from rest to rest, and hold outside 0..1", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5);
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
  });
});

describe("the camera", () => {
  it("stands far enough back for the whole machine, further on an upright phone", () => {
    expect(wideDistance(1.6, 30)).toBe(14.5);
    // at 390 × 844 the keyboard and the mouse fit across the width
    const d = wideDistance(390 / 844, 30);
    expect(d * Math.tan(Math.PI / 12) * (390 / 844)).toBeCloseTo(WIDE_HALF_WIDTH);
  });

  it("ends close enough for the screen to cover the viewport, with a little to spare", () => {
    const half = Math.tan(Math.PI / 12);
    // a wide viewport is limited by width, a tall one by height
    expect(coverDistance(SCREEN, 2, 30)).toBeCloseTo((1.3 / (half * 2)) * OVERSHOOT);
    expect(coverDistance(SCREEN, 1, 30)).toBeCloseTo((0.975 / half) * OVERSHOOT);
  });

  it("drifts while the machine boots, leans with the pointer, then flies square onto the screen", () => {
    const begin = cameraAt(0, SCREEN, 1.6, 30);
    const before = cameraAt(startOf("zoom") - 1, SCREEN, 1.6, 30);
    expect(begin.position.x).toBeLessThan(before.position.x);
    const leaning = cameraAt(1000, SCREEN, 1.6, 30, { x: 1, y: 1 });
    expect(leaning.position.x).toBeGreaterThan(cameraAt(1000, SCREEN, 1.6, 30).position.x);
    expect(leaning.position.y).toBeGreaterThan(cameraAt(1000, SCREEN, 1.6, 30).position.y);

    const end = cameraAt(startOf("fade"), SCREEN, 1.6, 30, { x: 1, y: 1 }, { yaw: 1, pitch: 0.5, zoom: 0.7 });
    // the pointer no longer leans the shot, and the camera looks straight at the screen's centre
    expect(end.position.x).toBeCloseTo(SCREEN.center.x);
    expect(end.position.y).toBeCloseTo(SCREEN.center.y);
    expect(end.position.z).toBeCloseTo(SCREEN.center.z + coverDistance(SCREEN, 1.6, 30));
    expect(end.target).toEqual(SCREEN.center);
  });

  it("turns, tilts and leans in where the visitor drags, within limits, and the drift ends when it should", () => {
    const at = DRIFT_MS + 100;
    const rest = cameraAt(at, SCREEN, 1.6, 30);
    expect(cameraAt(at, SCREEN, 1.6, 30, undefined, REST)).toEqual(rest);
    expect(cameraAt(DRIFT_MS * 2, SCREEN, 1.6, 30)).toEqual(rest);
    const turned = cameraAt(at, SCREEN, 1.6, 30, undefined, { yaw: 0.8, pitch: 0, zoom: 1 });
    expect(turned.position.x).toBeGreaterThan(rest.position.x);
    // a turn keeps the distance to what the camera looks at
    const d = (s: typeof rest) => Math.hypot(s.position.x - s.target.x, s.position.y - s.target.y, s.position.z - s.target.z);
    expect(d(turned)).toBeCloseTo(d(rest));
    expect(cameraAt(at, SCREEN, 1.6, 30, undefined, { yaw: 0, pitch: 0.4, zoom: 1 }).position.y).toBeGreaterThan(rest.position.y);
    expect(d(cameraAt(at, SCREEN, 1.6, 30, undefined, { yaw: 0, pitch: 0, zoom: 0.8 }))).toBeCloseTo(d(rest) * 0.8);
    expect(clampOrbit({ yaw: 9, pitch: -9, zoom: 9 })).toEqual({ yaw: ORBIT_LIMITS.yaw, pitch: ORBIT_LIMITS.pitchDown, zoom: ORBIT_LIMITS.zoomOut });
    expect(clampOrbit({ yaw: -9, pitch: 9, zoom: 0 })).toEqual({ yaw: -ORBIT_LIMITS.yaw, pitch: ORBIT_LIMITS.pitchUp, zoom: ORBIT_LIMITS.zoomIn });
  });
});

describe("whether the intro plays", () => {
  const motion = (reduce: boolean) => (q: string) => ({ matches: reduce && q === "(prefers-reduced-motion: reduce)" });

  it("plays on the bare home page, with motion allowed and a GPU", () => {
    expect(shouldPlayIntro({ search: "", matchMedia: motion(false), webgl: () => true })).toBe(true);
  });

  it("does not play for a window link, less motion, no GPU, or a page that cannot ask", () => {
    expect(shouldPlayIntro({ search: "do=swap", matchMedia: motion(false), webgl: () => true })).toBe(false);
    expect(shouldPlayIntro({ search: "", matchMedia: motion(true), webgl: () => true })).toBe(false);
    expect(shouldPlayIntro({ search: "", matchMedia: motion(false), webgl: () => false })).toBe(false);
    expect(shouldPlayIntro({ search: "", matchMedia: undefined, webgl: () => true })).toBe(false);
  });

  it("asks the browser for a WebGL context, either version, and reads a refusal or a throw as no", () => {
    const doc = (answer: (kind: string) => unknown) => ({ createElement: () => ({ getContext: vi.fn(answer) }) }) as unknown as Document;
    expect(hasWebGL(doc((k) => (k === "webgl2" ? {} : null)))).toBe(true);
    expect(hasWebGL(doc((k) => (k === "webgl" ? {} : null)))).toBe(true);
    expect(hasWebGL(doc(() => null))).toBe(false);
    expect(
      hasWebGL(
        doc(() => {
          throw new Error("blocked");
        }),
      ),
    ).toBe(false);
  });
});
