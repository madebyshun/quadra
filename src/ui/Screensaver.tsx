import { useEffect, useState } from "react";
import { usePulse } from "@/ui/usePulse";
import { useSetting } from "@/ui/useSettings";
import { saverMinutes, saverOn } from "@/lib/settings";

/**
 * The screensaver: after `IDLE_MS` without a key, a click or a mouse move, the newest Base blocks
 * drift across a dark screen — the real block numbers and transaction counts, read from the chain.
 * Any input wakes the machine. Not shown to somebody who asked for less motion, nor once it is
 * switched off in the Control Panel, which also sets the idle minutes (`idleMs` overrides them).
 */
export const IDLE_MS = 120_000;
const WAKE = ["mousemove", "mousedown", "keydown", "touchstart", "wheel"] as const;

export function Screensaver({ idleMs: forced }: { idleMs?: number }) {
  const [on, setOn] = useState(false);
  const enabled = useSetting(saverOn);
  const minutes = useSetting(saverMinutes);
  const idleMs = forced ?? minutes * 60_000;
  const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    setOn(false);
    if (reduced || !enabled) return;
    let id = setTimeout(() => setOn(true), idleMs);
    const wake = () => {
      setOn(false);
      clearTimeout(id);
      id = setTimeout(() => setOn(true), idleMs);
    };
    WAKE.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    return () => {
      clearTimeout(id);
      WAKE.forEach((e) => window.removeEventListener(e, wake));
    };
  }, [idleMs, reduced, enabled]);

  return on ? <Blocks /> : null;
}

/** The blocks themselves — only mounted while the saver runs, so the pulse is read only then. */
function Blocks() {
  const state = usePulse();
  const history = state.kind === "waiting" ? [] : state.history;
  return (
    <div className="saver" aria-label="Screensaver: Base blocks. Move the mouse to wake." role="img">
      {history.slice(-12).map((p, i) => (
        <span key={p.block} className="saver__block mono" style={{ top: `${(i * 37) % 85}%`, animationDelay: `${(i % 6) * -2}s` }}>
          #{p.block.toLocaleString("en-US")} · {p.txs} txs
        </span>
      ))}
      <p className="saver__name">Base 8453 — still making blocks</p>
    </div>
  );
}
