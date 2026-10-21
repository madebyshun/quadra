import type { WindowId } from "@/features/registry";

/**
 * State for the multi-window desktop: every open window's position, size,
 * stacking order and minimised flag. Pure — no DOM, no React — so every
 * transition is a plain function from one state to the next and is testable
 * without mounting anything.
 */
export type OpenWindow = {
  id: WindowId;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  /** stacking order: the window with the highest z among the un-minimised ones is on top */
  z: number;
};

export type WindowManagerState = {
  windows: readonly OpenWindow[];
  /** the z the next raised window gets, then increments */
  nextZ: number;
};

export const MIN_WIDTH = 300;
export const MIN_HEIGHT = 200;
export const DEFAULT_WIDTH = 460;
/**
 * 380 until the Send panel was measured in a browser: even after being cut down
 * to two blocks, it opened with the backup row below the fold — and a backup
 * control somebody has to scroll to find is one the people who most need it
 * never see. Raised to the height the tallest built panel actually needs rather
 * than trimming the panel further, since what was left to cut was the warnings.
 *
 * MEASURED 2026-09-28, which is the only reason it is 480 and not a round 500:
 * `.win__body`'s client height is this number minus 31 (title bar plus padding),
 * and Send's resting content measured 439 with a couple of notes in the list.
 * What must never scroll out of sight is the backup row, which is why it sits
 * inside the balance fieldset rather than below a third border. (The note list
 * itself is gone since — Send shows one balance — so the panel no longer grows
 * with the number of deposits.)
 *
 * MEASURED AGAIN 2026-09-29 and raised 480 → 568 by the money-form rebuild.
 * Send's resting content came back 537 against a client height of 449, which put
 * the Send button itself 152px below the fold — the control the window exists
 * for, unreachable without scrolling, and invisible to 1238 green tests because
 * jsdom has no layout. Trimming the row padding and folding the Network row into
 * the Token row brought the button back into view, but left the CRT output box
 * cut off, and a result box nobody can see is a payment that reports success by
 * silence. 537 + 31 is 568, so that is the number.
 */
export const DEFAULT_HEIGHT = 568;
/**
 * Prose opens taller than an input panel: at `DEFAULT_HEIGHT` every doc page
 * opened straight into a vertical scrollbar. Clamped to the viewport by
 * `pageHeight`, so a short screen gets the biggest box that fits rather than one
 * taller than the window it is drawn in.
 */
export const PAGE_HEIGHT = 660;
/** Fallback origin for a caller with no viewport to measure — every test in this file. */
const CASCADE_ORIGIN_X = 300;
const CASCADE_ORIGIN_Y = 90;
const CASCADE_STEP = 28;
/** wrap the cascade rather than walking new windows off the screen forever */
const CASCADE_WRAP = 10;
/** left edge no window may start before, so it never lands under the icon column */
const MIN_LEFT = 260;
/** top edge no window may start before, so it never touches the taskbar or top edge */
const MIN_TOP = 40;
/**
 * Gap kept between a window and the left and right edges of a viewport too narrow
 * for `MIN_LEFT`: enough that the frame's shadow and rounded corners read as a
 * window lying on the desktop rather than one cut off by the screen.
 */
export const EDGE_MARGIN = 8;
const TASKBAR_H = 40;

export const EMPTY_STATE: WindowManagerState = { windows: [], nextZ: 1 };

export type Origin = {
  x: number;
  y: number;
  /** the width the window opens at; `DEFAULT_WIDTH` when a caller has no viewport to fit */
  width?: number;
  /** the furthest right the cascade may push this origin, so a stack of windows stays on screen */
  maxX?: number;
};

/**
 * The width a window opens at in a viewport this wide: `DEFAULT_WIDTH`, or less when
 * that would not fit between the two edge margins. Deliberately NOT floored at
 * `MIN_WIDTH` — that floor is for a resize gesture, and a window wider than the
 * screen it opens on is the defect this exists to prevent.
 */
export function windowWidth(viewportWidth: number): number {
  return Math.min(DEFAULT_WIDTH, viewportWidth - 2 * EDGE_MARGIN);
}

/**
 * Where a window should land for a given viewport, centred rather than
 * pinned to a fixed pixel offset.
 *
 * MEASURED 2026-09-28: a fixed `(300, 90)` origin reads as centred on a
 * laptop-width viewport and as pinned-to-the-left on anything wider — the
 * gap on the right grows with the screen because the number never moves.
 * `openWindow` has no access to `window.innerWidth` (it is a pure function,
 * tested without a DOM), so the caller measures and hands the origin in;
 * this is the one function that turns a measurement into a position, and it
 * is exported so that measuring is the only thing `App.tsx` has to do.
 *
 * `height` defaults to `DEFAULT_HEIGHT` so every existing caller centres a
 * window of the usual size unchanged; `Page.tsx` passes its own taller
 * height so a content page centres around the box it is actually getting,
 * not the panel-sized box every other window opens at.
 *
 * MEASURED 2026-10-02 over CDP at a true 390x844 layout: every window opened at
 * x=260 with width 460, so its right edge sat at 720 — 330px off a 390px screen.
 * `MIN_LEFT` keeps a window clear of the icon column, but below 600px that column
 * wraps into rows above the shell and there is nothing at x<260 to avoid; the
 * floor was pushing the window off-screen to dodge icons that were not there.
 * And because the window is `position: fixed` it adds nothing to `scrollWidth`,
 * so the overflow check every other narrow-layout bug was caught by passed.
 * Being on screen now outranks being clear of the icons: `MIN_LEFT` still holds
 * wherever the window fits beside it (1120px is unchanged at x=330), and where it
 * does not, the window slides left — over the icons if it must — until its right
 * edge is inside the margin. The returned `width` and `maxX` carry the same fit
 * through `openWindow`'s cascade, which would otherwise walk a second window back
 * off the right edge 28px at a time.
 */
export function centeredOrigin(
  viewportWidth: number,
  viewportHeight: number,
  height: number = DEFAULT_HEIGHT,
): Origin {
  const width = windowWidth(viewportWidth);
  const maxX = viewportWidth - EDGE_MARGIN - width;
  const centred = Math.max(MIN_LEFT, Math.round((viewportWidth - width) / 2));
  const x = Math.max(EDGE_MARGIN, Math.min(centred, maxX));
  const y = Math.max(MIN_TOP, Math.round((viewportHeight - TASKBAR_H - height) / 2));
  return { x, y, width, maxX };
}

/** The height a prose window opens at in a viewport of this height. */
export function pageHeight(viewportHeight: number): number {
  return Math.max(MIN_HEIGHT, Math.min(PAGE_HEIGHT, viewportHeight - 120));
}

function cascadePosition(openCount: number, origin: Origin): { x: number; y: number } {
  const slot = openCount % CASCADE_WRAP;
  const x = origin.x + slot * CASCADE_STEP;
  return { x: origin.maxX === undefined ? x : Math.min(x, origin.maxX), y: origin.y + slot * CASCADE_STEP };
}

/** The un-minimised window with the highest z, or null with nothing showing. */
export function topWindowId(state: WindowManagerState): WindowId | null {
  const visible = state.windows.filter((w) => !w.minimized);
  if (visible.length === 0) return null;
  return visible.reduce((top, w) => (w.z > top.z ? w : top)).id;
}

/** Bring a window to the front. No-op if it is not open; does not un-minimise it. */
export function focusWindow(state: WindowManagerState, id: WindowId): WindowManagerState {
  if (!state.windows.some((w) => w.id === id)) return state;
  return {
    windows: state.windows.map((w) => (w.id === id ? { ...w, z: state.nextZ } : w)),
    nextZ: state.nextZ + 1,
  };
}

/**
 * Open a window. Already-open (including minimised) means "bring it back and
 * focus it" rather than a second copy — a `WindowId` has exactly one window.
 */
export function openWindow(
  state: WindowManagerState,
  id: WindowId,
  origin: Origin = { x: CASCADE_ORIGIN_X, y: CASCADE_ORIGIN_Y },
  height: number = DEFAULT_HEIGHT,
): WindowManagerState {
  const existing = state.windows.find((w) => w.id === id);
  if (existing) {
    return focusWindow(
      { ...state, windows: state.windows.map((w) => (w.id === id ? { ...w, minimized: false } : w)) },
      id,
    );
  }
  const { x, y } = cascadePosition(state.windows.length, origin);
  const created: OpenWindow = {
    id,
    x,
    y,
    width: origin.width ?? DEFAULT_WIDTH,
    height,
    minimized: false,
    z: state.nextZ,
  };
  return { windows: [...state.windows, created], nextZ: state.nextZ + 1 };
}

export function closeWindow(state: WindowManagerState, id: WindowId): WindowManagerState {
  return { ...state, windows: state.windows.filter((w) => w.id !== id) };
}

export function minimizeWindow(state: WindowManagerState, id: WindowId): WindowManagerState {
  return { ...state, windows: state.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w)) };
}

export function restoreWindow(state: WindowManagerState, id: WindowId): WindowManagerState {
  return focusWindow(
    { ...state, windows: state.windows.map((w) => (w.id === id ? { ...w, minimized: false } : w)) },
    id,
  );
}

/** All open windows, hidden from view but not closed — "show desktop". */
export function minimizeAll(state: WindowManagerState): WindowManagerState {
  return { ...state, windows: state.windows.map((w) => ({ ...w, minimized: true })) };
}

export function moveWindow(state: WindowManagerState, id: WindowId, x: number, y: number): WindowManagerState {
  return { ...state, windows: state.windows.map((w) => (w.id === id ? { ...w, x, y } : w)) };
}

/** Floors a resize at the same minimum every window on the desktop respects, single-window pages included. */
export function clampWindowSize(width: number, height: number): { width: number; height: number } {
  return { width: Math.max(MIN_WIDTH, width), height: Math.max(MIN_HEIGHT, height) };
}

export function resizeWindow(
  state: WindowManagerState,
  id: WindowId,
  width: number,
  height: number,
): WindowManagerState {
  const { width: w, height: h } = clampWindowSize(width, height);
  return {
    ...state,
    windows: state.windows.map((win) => (win.id === id ? { ...win, width: w, height: h } : win)),
  };
}

/**
 * A taskbar chip's click is one gesture standing in for three different intents,
 * same as any real taskbar: bring back a minimised window, step in front of an
 * unfocused one, or — clicking the window that is already on top — get it out of
 * the way. Kept here rather than in the component so the three-way branch is
 * covered by a state test, not a pointer simulation.
 */
export function toggleFromTaskbar(state: WindowManagerState, id: WindowId): WindowManagerState {
  const target = state.windows.find((w) => w.id === id);
  if (!target) return state;
  if (target.minimized) return restoreWindow(state, id);
  if (topWindowId(state) === id) return minimizeWindow(state, id);
  return focusWindow(state, id);
}

export type WindowAction =
  | { type: "open"; id: WindowId; origin?: Origin; height?: number }
  | { type: "close"; id: WindowId }
  | { type: "focus"; id: WindowId }
  | { type: "minimize"; id: WindowId }
  | { type: "restore"; id: WindowId }
  | { type: "toggleFromTaskbar"; id: WindowId }
  | { type: "minimizeAll" }
  | { type: "move"; id: WindowId; x: number; y: number }
  | { type: "resize"; id: WindowId; width: number; height: number };

/** The one reducer `useReducer` in `App.tsx` is given — every action above, dispatched. */
export function reduceWindows(state: WindowManagerState, action: WindowAction): WindowManagerState {
  switch (action.type) {
    case "open":
      return openWindow(state, action.id, action.origin, action.height);
    case "close":
      return closeWindow(state, action.id);
    case "focus":
      return focusWindow(state, action.id);
    case "minimize":
      return minimizeWindow(state, action.id);
    case "restore":
      return restoreWindow(state, action.id);
    case "toggleFromTaskbar":
      return toggleFromTaskbar(state, action.id);
    case "minimizeAll":
      return minimizeAll(state);
    case "move":
      return moveWindow(state, action.id, action.x, action.y);
    case "resize":
      return resizeWindow(state, action.id, action.width, action.height);
  }
}
