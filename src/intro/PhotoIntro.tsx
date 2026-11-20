import { useEffect, useRef, useState } from "react";
import { AT, blockLine, loaded, MACHINE, phaseAt, ZOOM_MS, type Phase } from "@/intro/photo";
import { Machine } from "@/intro/Machine";
import { usePulse } from "@/ui/usePulse";
import introPhoto from "@/assets/quadra-machine.jpg";
import "./PhotoIntro.css";

/**
 * The intro (src/intro/photo.ts): the Quadra workstation on a sunlit green hill, its CRT live.
 * Plays the power-on, icon, and welcome loading bar, then automatically zooms into the CRT and
 * opens the desktop. Clicking anywhere or pressing Esc/Skip enters the desktop immediately.
 */

const now = () => performance.now();
const pct = (x: number) => `${(x * 100).toFixed(3)}%`;

const PHOTO_CANDIDATES = [introPhoto, "/brand/quadra-machine.jpg", "/brand/quadra-machine.png", "/brand/quadra-machine.webp"] as const;
const PHOTO_SCREEN = { left: 0.404, top: 0.272, width: 0.192, height: 0.254 } as const;

export function PhotoIntro({ onDone, clock = now }: { onDone(open: string | null): void; clock?: () => number }) {
  const [ms, setMs] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
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
  const photoSrc = photoIndex < PHOTO_CANDIDATES.length ? PHOTO_CANDIDATES[photoIndex] : null;
  const s = photoSrc ? PHOTO_SCREEN : MACHINE.screen;

  return (
    <div
      className={`pintro pintro--${phase}${photoSrc ? " pintro--photo" : ""}`}
      role="dialog"
      aria-label="quadra is starting"
      onClick={() => choose(null)}
    >
      <div className="pintro__hill" aria-hidden="true" />
      <div className="pintro__stage" style={{ transformOrigin: `${pct(s.left + s.width / 2)} ${pct(s.top + s.height / 2)}` }}>
        {photoSrc ? (
          <img
            className="pintro__photo"
            src={photoSrc}
            alt="a beige Macintosh Quadra workstation seen straight on, resting on a sunlit green hill"
            onError={() => setPhotoIndex((i) => i + 1)}
          />
        ) : (
          <Machine />
        )}
        <div className="pintro__screen" style={{ left: pct(s.left), top: pct(s.top), width: pct(s.width), height: pct(s.height) }}>
          {phase === "icon" ? (
            <img className="pintro__icon" src="/brand/icon.svg" alt="" aria-hidden="true" />
          ) : phase === "welcome" || phase === "menu" || phase === "zoom" ? (
            <div className="pintro__dialog">
              <p className="pintro__welcome">welcome to quadra</p>
              <p className="pintro__line">a personal computer for base</p>
              <div className="pintro__bar" role="progressbar" aria-valuenow={Math.round(loaded(ms) * 100)} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: pct(loaded(ms)) }} />
              </div>
              <p className="pintro__block">{blockLine(block)}</p>
            </div>
          ) : null}
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
