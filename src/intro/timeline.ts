/**
 * The intro's timeline: the early-nineties Macintosh this app is named after, on a desk, switches itself on, boots, and the camera
 * flies into its screen until the screen IS the page — then the real desktop takes over.
 *
 * Everything here is arithmetic on a clock, so the whole sequence is testable without WebGL:
 * which phase a moment falls in, how far through it is, and where the camera is. The scene
 * (`scene.ts`) only draws what this says.
 */

/**
 * The phases, in order, with how long each lasts (ms). Slowed down and made interactive on the
 * owner's call of 2026-10-02 ("display it slowly, and let people interact"): two phases now WAIT
 * for the visitor — `idle`, the machine off on the desk until it is clicked (or Enter), and `ready`,
 * the welcome box until the screen is clicked — each for at most its `ms`, after which the intro
 * carries on by itself. It is a welcome, never a gate.
 */
// Faster since 2026-10-21 (owner: "the intro needs to be quicker"): ~29 s → ~6.4 s end to end (twice: "faster still");
// the two waits still wait for a click, they just carry on sooner by themselves.
export const PHASES = [
  /** the room fades up; the machine is off */
  { id: "dark", ms: 300 },
  /** the machine off on the desk: look around it, click it to switch it on */
  { id: "idle", ms: 1200 },
  /** power: the LED lights, the tube warms to grey */
  { id: "warm", ms: 400 },
  /** the boot icon on a dithered grey desktop */
  { id: "icon", ms: 600 },
  /** the welcome box and its progress bar */
  { id: "welcome", ms: 800 },
  /** the welcome box, finished: click the screen to go in */
  { id: "ready", ms: 1500 },
  /** the camera flies into the screen; the screen turns into the desktop */
  { id: "zoom", ms: 1200 },
  /** the overlay fades and the real page is underneath */
  { id: "fade", ms: 400 },
] as const;

/** The phases that wait for the visitor, and what ends the wait. */
export const HOLDS: Readonly<Partial<Record<(typeof PHASES)[number]["id"], "power" | "enter">>> = { idle: "power", ready: "enter" };

export type PhaseId = (typeof PHASES)[number]["id"];

export const TOTAL_MS = PHASES.reduce((sum, p) => sum + p.ms, 0);

/** When each phase starts. */
export function startOf(id: PhaseId): number {
  const i = PHASES.findIndex((p) => p.id === id);
  return PHASES.slice(0, i).reduce((sum, p) => sum + p.ms, 0);
}

const ZOOM_MS = PHASES.find((p) => p.id === "zoom")!.ms;

/**
 * Where a visitor's action moves the clock to: from a waiting phase (or the dark before the first
 * one), to the end of that wait. `null` when there is nothing to move on from — the machine is
 * already booting, or the fly-in has begun.
 */
export function advanceFrom(ms: number): number | null {
  const { id } = phaseAt(ms);
  if (id === "dark") return startOf("warm");
  if (id === "idle" || id === "ready") {
    const i = PHASES.findIndex((p) => p.id === id);
    return startOf(id) + PHASES[i]!.ms;
  }
  return null;
}

/** The visitor's view, set by dragging and scrolling: a turn around the machine, a tilt, a distance. */
export type Orbit = { readonly yaw: number; readonly pitch: number; readonly zoom: number };
export const REST: Orbit = { yaw: 0, pitch: 0, zoom: 1 };
/** How far a visitor may turn, tilt and lean in or out — enough to see the side, never the back. */
export const ORBIT_LIMITS = { yaw: 1.1, pitchDown: -0.12, pitchUp: 0.55, zoomIn: 0.7, zoomOut: 1.25 } as const;

export function clampOrbit(o: Orbit): Orbit {
  const c = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    yaw: c(o.yaw, -ORBIT_LIMITS.yaw, ORBIT_LIMITS.yaw),
    pitch: c(o.pitch, ORBIT_LIMITS.pitchDown, ORBIT_LIMITS.pitchUp),
    zoom: c(o.zoom, ORBIT_LIMITS.zoomIn, ORBIT_LIMITS.zoomOut),
  };
}

/** The camera's slow drift across the front of the machine takes this long, whatever the visitor does. */
export const DRIFT_MS = 1200;

/** The phase a moment falls in, and how far through it (0..1). Past the end is `done`. */
export function phaseAt(ms: number): { id: PhaseId | "done"; progress: number } {
  let t = 0;
  for (const p of PHASES) {
    if (ms < t + p.ms) return { id: p.id, progress: Math.max(0, (ms - t) / p.ms) };
    t += p.ms;
  }
  return { id: "done", progress: 1 };
}

/** Smooth in and out — the camera never starts or stops with a jolt. */
export function ease(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export type Vec3 = { readonly x: number; readonly y: number; readonly z: number };

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixV = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), z: mix(a.z, b.z, t) });

/** Where the screen is in the world, and how big — the scene's geometry and the camera agree on this. */
export type ScreenFrame = { readonly center: Vec3; readonly width: number; readonly height: number };

/**
 * How far in front of the screen the camera must be for the screen to COVER a viewport of this
 * aspect (width / height) at this vertical field of view — the last frame of the zoom, where the
 * edges of the tube have left the picture.
 */
export function coverDistance(screen: ScreenFrame, aspect: number, fovDeg: number): number {
  const half = Math.tan(((fovDeg * Math.PI) / 180) / 2);
  const byHeight = screen.height / 2 / half;
  const byWidth = screen.width / 2 / (half * aspect);
  // a little closer than exact, so the rounded corners and the tube's darker rim are past the edge
  return Math.min(byHeight, byWidth) * OVERSHOOT;
}

/** MEASURED in a real render: at the exact cover distance the tube's surround still showed as a 20px band. */
export const OVERSHOOT = 0.9;

/** Half the width the wide shot must hold: the keyboard and the mouse beside it, with a margin. */
export const WIDE_HALF_WIDTH = 4.1;

/**
 * How far back the camera stands to see the whole machine at this aspect. Never closer than the
 * desktop framing; on an upright phone, far enough that the keyboard and the mouse fit across.
 * MEASURED at 390 × 844: a rule of thumb (11 + a little per unit of aspect) cut the mouse off.
 */
export function wideDistance(aspect: number, fovDeg: number): number {
  const half = Math.tan(((fovDeg * Math.PI) / 180) / 2);
  return Math.max(14.5, WIDE_HALF_WIDTH / (half * aspect));
}

export type Shot = { readonly position: Vec3; readonly target: Vec3 };

/**
 * The camera at a moment: a slow drift from the left towards the front of the machine while it
 * boots, then a fly-in that ends square on the screen at `coverDistance`. `pointer` (−1..1 each
 * way) leans the shot a little while the machine is still being looked at, and `orbit` is where the
 * visitor has dragged the view; neither applies by the end of the fly-in, which is always square.
 */
export function cameraAt(ms: number, screen: ScreenFrame, aspect: number, fovDeg: number, pointer = { x: 0, y: 0 }, orbit: Orbit = REST): Shot {
  const back = wideDistance(aspect, fovDeg);
  // the sideways part of the drift shrinks on a narrow screen, where the machine fills the width
  const side = Math.min(1, aspect / 1.2);
  const start: Vec3 = { x: -5.5 * side, y: screen.center.y + 3.2, z: screen.center.z + back + 1 };
  const front: Vec3 = { x: 1.2 * side, y: screen.center.y + 2.2, z: screen.center.z + back - 1.5 };
  const zoomAt = startOf("zoom");
  const drift = ease(Math.min(1, ms / DRIFT_MS));
  const lean = 1 - ease((ms - zoomAt) / ZOOM_MS);
  const wide = mixV(start, front, drift);
  const lookWide: Vec3 = { x: screen.center.x, y: screen.center.y - 1.1, z: screen.center.z + 0.8 };
  // the visitor's turn, tilt and distance, around what the camera looks at — unwound by the fly-in
  const o = clampOrbit(orbit);
  const off = { x: wide.x - lookWide.x, y: wide.y - lookWide.y, z: wide.z - lookWide.z };
  const yaw = o.yaw * lean;
  const turned = { x: off.x * Math.cos(yaw) + off.z * Math.sin(yaw), z: -off.x * Math.sin(yaw) + off.z * Math.cos(yaw) };
  const flat = Math.hypot(turned.x, turned.z);
  const tilt = Math.atan2(off.y, flat) + o.pitch * lean;
  const dist = Math.hypot(off.y, flat) * mix(1, o.zoom, lean);
  const around: Vec3 = {
    x: lookWide.x + (turned.x / flat) * Math.cos(tilt) * dist,
    y: lookWide.y + Math.sin(tilt) * dist,
    z: lookWide.z + (turned.z / flat) * Math.cos(tilt) * dist,
  };
  const leaned = { x: around.x + pointer.x * 0.5 * lean, y: around.y + pointer.y * 0.3 * lean, z: around.z };
  if (ms < zoomAt) return { position: leaned, target: lookWide };
  const t = ease((ms - zoomAt) / ZOOM_MS);
  const close: Vec3 = { x: screen.center.x, y: screen.center.y, z: screen.center.z + coverDistance(screen, aspect, fovDeg) };
  return { position: mixV(leaned, close, t), target: mixV(lookWide, screen.center, t) };
}

/**
 * Whether the intro plays. Not for a link that opens a window (`?do=`) — that person came for the
 * window. Not when the system asks for less motion. Not without WebGL, and not where the page
 * cannot even ask (`matchMedia` missing — a test environment, an old embed).
 */
export function shouldPlayIntro(env: { search: string; matchMedia: ((q: string) => { matches: boolean }) | undefined; webgl: () => boolean }): boolean {
  if (new URLSearchParams(env.search).has("do")) return false;
  if (typeof env.matchMedia !== "function") return false;
  if (env.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  return env.webgl();
}

/** Whether this browser can make a WebGL context at all. */
export function hasWebGL(doc: Document): boolean {
  try {
    const probe = doc.createElement("canvas");
    return Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
  } catch {
    return false;
  }
}
