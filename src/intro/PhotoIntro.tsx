import { HalftoneField } from "@/ui/HalftoneField";
import { useEffect, useRef, useState } from "react";
import { AT, blockLine, loaded, phaseAt, ZOOM_MS, type Phase } from "@/intro/photo";
import { usePulse } from "@/ui/usePulse";
import introPhoto from "@/assets/quadra-machine.jpg";
import "./PhotoIntro.css";

/**
 * The intro (src/intro/photo.ts): the workstation on a sunlit green hill, its CRT live.
 * Plays the power-on, icon, and welcome loading bar, then automatically zooms into the CRT and
 * opens the desktop. Clicking anywhere or pressing Esc/Skip enters the desktop immediately.
 */

const now = () => performance.now();
const pct = (x: number) => `${(x * 100).toFixed(3)}%`;

/** Where the glass sits in the photograph, as fractions of it. */
const PHOTO_SCREEN = { left: 0.401, top: 0.271, width: 0.196, height: 0.273 } as const;

export function PhotoIntro({ onDone, clock = now }: { onDone(open: string | null): void; clock?: () => number }) {
  const [ms, setMs] = useState(0);
  const [zoom, setZoom] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  const start = useRef(clock());
  const pulse = usePulse();
  const block = pulse.kind === "live" ? pulse.pulse.block : null;

  const choose = (open: string | null) => {
    setZoom((z) => {
      if (z) return z;
      setTimeout(() => done.current(open), ZOOM_MS);
      return true;
    });
  };

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = clock() - start.current;
      setMs(t);
      if (t >= AT.menu) {
        choose(null);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clock]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") choose(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const phase: Phase = zoom ? "zoom" : phaseAt(ms);
  const s = PHOTO_SCREEN;

  return (
    <div
      className={`pintro pintro--${phase} pintro--photo`}
      role="dialog"
      aria-label="quadra is starting"
      onClick={() => choose(null)}
    >
      <div className="pintro__hill" aria-hidden="true" />
      <div className="pintro__stage" style={{ transformOrigin: `${pct(s.left + s.width / 2)} ${pct(s.top + s.height / 2)}` }}>
        {/* the photograph ships in the bundle; if it still cannot load, the intro steps aside */}
        <img
          className="pintro__photo"
          src={introPhoto}
          alt="a beige early-nineties workstation seen straight on, resting on a sunlit green hill"
          onError={() => done.current(null)}
        />
        <HalftoneField variant="intro" />
        <div className="pintro__screen" style={{ left: pct(s.left), top: pct(s.top), width: pct(s.width), height: pct(s.height) }}>
          <div className="pintro__glass-effects" aria-hidden="true" />
          {phase === "icon" ? (
            <img className="pintro__icon" src="/brand/icon.svg" alt="" aria-hidden="true" />
          ) : (
            <div className="pintro__dialog">
              <p className="pintro__welcome">welcome to quadra</p>
              <p className="pintro__line">a personal computer for base</p>
              <div className="pintro__bar" role="progressbar" aria-valuenow={Math.round(loaded(ms) * 100)} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: pct(loaded(ms)) }} />
              </div>
              <p className="pintro__block">{blockLine(block)}</p>
            </div>
          )}
        </div>
      </div>
      <button
        type="button"
        className="pintro__skip"
        onClick={(e) => {
          e.stopPropagation();
          choose(null);
        }}
      >
        skip
      </button>
    </div>
  );
}
