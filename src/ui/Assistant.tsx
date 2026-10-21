import { useEffect, useState } from "react";
import { useRunCommand } from "@/features/openWindow";
import { GREETING, onTip, say, setQOn, type Tip } from "@/lib/assistant";
import { play } from "@/lib/sound";

/** How long after the desktop appears Q says hello. */
export const HELLO_MS = 2500;

/** The little Macintosh Q lives in — the same pixel machine as the boot icon, with a face. */
function QFace() {
  return (
    <svg viewBox="0 0 16 16" width="44" height="44" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="2" y="1" width="12" height="12" fill="#000" />
      <rect x="3" y="2" width="10" height="8" fill="#0052ff" />
      <rect x="5" y="4" width="2" height="2" fill="#fff" />
      <rect x="9" y="4" width="2" height="2" fill="#fff" />
      <rect x="5" y="7" width="6" height="1" fill="#fff" />
      <rect x="3" y="11" width="10" height="1" fill="#d7d1c0" />
      <rect x="4" y="13" width="8" height="2" fill="#000" />
    </svg>
  );
}

/**
 * Q's speech bubble. Says one tip at a time, offers its one action, and can be told to go away for
 * good. `greet` is false where the intro is still playing or for a test that wants silence.
 */
export function Assistant({ greet = true }: { greet?: boolean }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [gone, setGone] = useState(false);
  const run = useRunCommand();

  useEffect(
    () =>
      onTip((t) => {
        setTip(t);
        play(t.tone === "bad" ? "error" : "open");
      }),
    [],
  );
  useEffect(() => {
    if (!greet) return;
    const id = setTimeout(() => say(GREETING), HELLO_MS);
    return () => clearTimeout(id);
  }, [greet]);

  if (gone || !tip) return null;
  return (
    <aside className={`q ${tip.tone ? `q--${tip.tone}` : ""}`} aria-label="Q, the assistant" role="status">
      <QFace />
      <div className="q__bubble">
        <p>{tip.text}</p>
        <div className="row">
          {tip.action && run && (
            <button
              type="button"
              className="q__go"
              onClick={() => {
                run(tip.action!.command);
                setTip(null);
              }}
            >
              {tip.action.label}
            </button>
          )}
          <button type="button" className="q__close" onClick={() => setTip(null)}>
            Thanks
          </button>
          <button
            type="button"
            className="q__off"
            onClick={() => {
              setQOn(false);
              setGone(true);
            }}
          >
            Don't show Q again
          </button>
        </div>
      </div>
    </aside>
  );
}
