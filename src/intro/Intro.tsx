import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BRAND } from "@/brand";
import { BASE } from "@/config/chain";
import type { IntroScene, Pointer } from "@/intro/scene";
import { startScene } from "@/intro/start";
import { advanceFrom, clampOrbit, phaseAt, REST, startOf, type Orbit, type PhaseId } from "@/intro/timeline";
import { quantity, rpc } from "@/skills/http";

/**
 * The home page's first seconds: the Macintosh this app is named after sits on a desk, switches on,
 * boots into this app, and the camera flies into its screen until the screen is the page — then the
 * real desktop, which has been loading underneath all along, is what is left.
 *
 * Interactive since 2026-10-02 (the owner: slower, and something to do): drag to look around the
 * machine, scroll to lean in or out, click the machine (or Enter) to switch it on, click the screen
 * (or Enter) to go in. Each wait carries on by itself after a few seconds. Esc or the Skip button
 * ends it; a click no longer does, because a click is now how the visitor plays. If three.js cannot
 * load or there is no GPU, the intro ends at once: it is a welcome, never a gate.
 *
 * The welcome box says one thing that is measured, not decorative: the latest block on Base, read
 * from the chain while the machine boots. If the chain cannot be reached, it says that.
 */

export type BlockLine = { readonly kind: "reading" } | { readonly kind: "read"; readonly number: bigint } | { readonly kind: "unreached" };

export function blockText(b: BlockLine): string {
  if (b.kind === "reading") return `${BASE.name} ${BASE.id} · reading the latest block…`;
  if (b.kind === "unreached") return `${BASE.name} ${BASE.id} · not reached — look-ups will try again`;
  return `${BASE.name} ${BASE.id} · block ${b.number.toLocaleString("en-US")}`;
}

type Phase = PhaseId | "done" | "loading";

/** This app's own boot icon: a small monitor in Base blue with the app's initial. */
function BootIcon() {
  return (
    <img className="boot__icon" src="/brand/icon.svg" width="64" height="64" alt="" aria-hidden="true" />
  );
}

export function BootScreen({ phase, block }: { phase: Phase; block: BlockLine }) {
  return (
    <div className={`boot__tube boot--${phase}`}>
      {phase === "icon" && <BootIcon />}
      {(phase === "welcome" || phase === "ready") && (
        <div className="boot__dialog">
          <p className="boot__welcome">welcome to {BRAND.slug}</p>
          <p className="boot__line">a personal computer for base</p>
          <div className="boot__bar">
            <span />
          </div>
          <p className="boot__block">{blockText(block)}</p>
          {phase === "ready" && <p className="boot__go">open desktop /</p>}
        </div>
      )}
      {(phase === "zoom" || phase === "fade" || phase === "done") && (
        <div className="boot__desk">
          <span>{BRAND.name}</span>
        </div>
      )}
    </div>
  );
}

/** The line under the machine: what the visitor can do right now, or nothing. */
export function hintFor(phase: Phase): string | null {
  if (phase === "dark" || phase === "idle") return "drag to explore / scroll to zoom / click to start";
  if (phase === "ready") return "click the screen / open desktop";
  return null;
}

/**
 * The loading screen's steps (2026-11-04, after c-na.dev's "100% · The desk is ready."): each one is a
 * step that really finished — three.js downloaded, the room built, the first frame drawn — never a
 * timer pretending to count. The percentage is steps done of three.
 */
export const LOAD_STEPS = ["Loading the machine…", "Building the desk…", "Warming up the tube…", "The machine is ready."] as const;
export const loadPercent = (done: number) => `${Math.round((Math.min(done, 3) / 3) * 100)}%`;

/** How far a drag of one pixel turns and tilts the view (radians), and a scroll notch leans in. */
export const DRAG = { yaw: 0.006, pitch: 0.004, zoom: 0.0008 } as const;
/** A press that moves less than this many pixels is a click, not a drag. */
export const CLICK_PX = 6;

export type IntroProps = {
  onDone(): void;
  explore?: boolean;
  /** where three.js and the scene come from — a test hands in its own */
  start?: typeof startScene;
  /** milliseconds, monotonic */
  clock?: () => number;
};

const FADE_AT = startOf("fade");
/** One function for the life of the module: a new one per render would restart the scene on every phase. */
const now = () => performance.now();

export function Intro({ onDone, explore = false, start = startScene, clock = now }: IntroProps) {
  const stage = useRef<HTMLDivElement>(null);
  const [screenEl] = useState(() => {
    const el = document.createElement("div");
    el.className = "boot";
    return el;
  });
  const [phase, setPhase] = useState<Phase>("loading");
  const [block, setBlock] = useState<BlockLine>({ kind: "reading" });
  const finish = useRef(onDone);
  finish.current = onDone;
  /** the moment a skip or a visitor's action asked to jump to, read by the next frame */
  const jump = useRef<number | null>(null);
  /** the intro's clock as of the last frame, for an action to move on from */
  const at = useRef(0);
  const phaseNow = useRef<Phase>("loading");
  phaseNow.current = phase;
  const orbit = useRef<Orbit>(REST);
  const sceneRef = useRef<IntroScene | null>(null);
  const [hover, setHover] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const exploreDone = useRef(false);

  useEffect(() => {
    let alive = true;
    rpc("eth_blockNumber").then(
      (v) => alive && setBlock({ kind: "read", number: quantity(v, "the latest block") }),
      () => alive && setBlock({ kind: "unreached" }),
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let frame = 0;
    let scene: IntroScene | null = null;
    const pointer: Pointer = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = 1 - (e.clientY / window.innerHeight) * 2;
    };
    const onResize = () => scene?.resize(window.innerWidth, window.innerHeight);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("resize", onResize);

    start(stage.current!, screenEl, { width: window.innerWidth, height: window.innerHeight, pixelRatio: Math.min(window.devicePixelRatio, 2) }, (done) => alive && setLoaded(done)).then(
      (s) => {
        if (!alive) return s.dispose();
        scene = s;
        sceneRef.current = s;
        // the first frame compiles every shader — on a slow GPU, most of a second. Pay for it
        // before the clock starts, or the room's fade-up happens while nothing is on screen.
        s.frame(0, pointer);
        setLoaded(3);
        let t0 = clock();
        let last: Phase = "loading";
        const tick = () => {
          if (jump.current !== null) {
            t0 = clock() - jump.current;
            jump.current = null;
          }
          const elapsed = clock() - t0;
          const ms = explore && !exploreDone.current ? Math.min(elapsed, startOf("zoom") - 1) : elapsed;
          at.current = ms;
          const { id } = phaseAt(ms);
          if (id !== last) {
            last = id;
            setPhase(id);
          }
          if (id === "done") return finish.current();
          s.frame(ms, pointer, orbit.current);
          frame = requestAnimationFrame(tick);
        };
        tick();
      },
      () => {
        // no three.js, no GPU: there is no intro, there is the desktop
        if (alive) finish.current();
      },
    );

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
      sceneRef.current = null;
      scene?.dispose();
    };
  }, [start, clock, screenEl, explore]);

  const skip = useCallback(() => {
    exploreDone.current = true;
    if (phaseNow.current === "loading") return finish.current();
    if (phaseNow.current !== "fade" && phaseNow.current !== "done") jump.current = FADE_AT;
  }, []);

  /** Switch the machine on, or go in: the visitor's one action, wherever the intro is waiting. */
  const advance = useCallback(() => {
    if (phaseNow.current === "ready") exploreDone.current = true;
    const to = advanceFrom(at.current);
    if (to !== null) jump.current = to;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") skip();
      else if (e.key === "Enter" || e.key === " ") advance();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [skip, advance]);

  /** The pointer in −1..1 each way, as the scene's hit test reads it. */
  const ndc = (e: { clientX: number; clientY: number }) => ({ x: (e.clientX / window.innerWidth) * 2 - 1, y: 1 - (e.clientY / window.innerHeight) * 2 });
  const press = useRef<{ x: number; y: number; moved: number; orbit: Orbit } | null>(null);
  /** What a click on this spot does now: switch on (the machine, while it waits), go in (the screen, when ready). */
  const actionAt = (e: { clientX: number; clientY: number }) => {
    const p = phaseNow.current;
    if (p !== "dark" && p !== "idle" && p !== "ready") return false;
    const { x, y } = ndc(e);
    const hit = sceneRef.current?.hit(x, y) ?? null;
    return p === "ready" ? hit === "screen" : hit !== null;
  };

  return (
    <div
      className={`intro intro--${phase}${hover ? " intro--hover" : ""}`}
      onPointerDown={(e) => {
        press.current = { x: e.clientX, y: e.clientY, moved: 0, orbit: orbit.current };
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (p) {
          const dx = e.clientX - p.x;
          const dy = e.clientY - p.y;
          p.moved = Math.max(p.moved, Math.hypot(dx, dy));
          orbit.current = clampOrbit({ yaw: p.orbit.yaw - dx * DRAG.yaw, pitch: p.orbit.pitch + dy * DRAG.pitch, zoom: p.orbit.zoom });
        } else setHover(actionAt(e));
      }}
      onPointerUp={(e) => {
        const p = press.current;
        press.current = null;
        if (p && p.moved < CLICK_PX && actionAt(e)) advance();
      }}
      onPointerLeave={() => {
        press.current = null;
        setHover(false);
      }}
      onWheel={(e) => {
        orbit.current = clampOrbit({ ...orbit.current, zoom: orbit.current.zoom + e.deltaY * DRAG.zoom });
      }}
    >
      <div className="intro__stage" ref={stage} aria-hidden="true" />
      {createPortal(<BootScreen phase={phase} block={block} />, screenEl)}
      {phase === "loading" && (
        <div className="intro__loading" role="status" aria-label="Loading the intro">
          <p className="intro__percent">{loadPercent(loaded)}</p>
          <p className="intro__step">{LOAD_STEPS[Math.min(loaded, 3)]}</p>
          <div className="intro__meter" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span key={i} className={i < loaded ? "intro__cell intro__cell--on" : "intro__cell"} />
            ))}
          </div>
        </div>
      )}
      {hintFor(phase) ? <p className="intro__hint">{hintFor(phase)}</p> : null}
      {phase === "ready" && <button type="button" className="intro__enter" onClick={advance}>open desktop</button>}
      <button
        type="button"
        className="intro__skip"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          skip();
        }}
      >
        Skip intro
      </button>
    </div>
  );
}
