import { useEffect, useRef, useState } from "react";
import { BRAND } from "@/brand";
import { resolveFeature, type WindowId } from "@/features/registry";
import { useOpenWindow } from "@/features/openWindow";
import { Gel } from "@/ui/Gel";
import { usePulse } from "@/ui/usePulse";
import { launchActivity, type Activity } from "@/skills/activity";
import { recycleBin, type Bin } from "@/skills/rugs";
import { setWelcomeOn, tipsFor, welcomeOn } from "@/lib/welcome";
import { WHATS_NEW } from "@/lib/whatsnew";

/** The Base card's window — `card` once it exists, the profile (where the card began) until then. */
export function cardWindow(resolve: (id: string) => unknown = resolveFeature): WindowId {
  return (resolve("card") ? "card" : "profile") as WindowId;
}

/** A pixel lightbulb over an open book — the era's "Did you know…" glyph. */
function TipIcon() {
  return (
    <svg viewBox="0 0 16 16" width="40" height="40" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="6" y="0" width="4" height="1" fill="#000" />
      <rect x="5" y="1" width="6" height="4" fill="#ffd400" />
      <rect x="4" y="1" width="1" height="4" fill="#000" />
      <rect x="11" y="1" width="1" height="4" fill="#000" />
      <rect x="6" y="2" width="1" height="1" fill="#fff" />
      <rect x="6" y="5" width="4" height="1" fill="#7a7a7a" />
      <rect x="6" y="6" width="4" height="1" fill="#000" />
      <rect x="1" y="8" width="7" height="6" fill="#fff" />
      <rect x="8" y="8" width="7" height="6" fill="#fff" />
      <rect x="0" y="8" width="1" height="7" fill="#0052ff" />
      <rect x="15" y="8" width="1" height="7" fill="#0052ff" />
      <rect x="0" y="14" width="16" height="1" fill="#0052ff" />
      <rect x="7" y="8" width="2" height="7" fill="#0052ff" />
      <rect x="2" y="10" width="4" height="1" fill="#9a9a9a" />
      <rect x="2" y="12" width="4" height="1" fill="#9a9a9a" />
      <rect x="10" y="10" width="4" height="1" fill="#9a9a9a" />
      <rect x="10" y="12" width="4" height="1" fill="#9a9a9a" />
    </svg>
  );
}

/**
 * The Welcome screen, after the intro (or on a bare desktop load): a Platinum alert-style welcome in
 * this app's own chrome. A tip box with live facts read from the chain and fixed ones, the doors
 * worth opening first, What's New, and the checkbox that turns it off for next time.
 */
export function Welcome({ onClose }: { onClose: () => void }) {
  const open = useOpenWindow();
  const pulse = usePulse();
  const first = useRef<number | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [bin, setBin] = useState<Bin | null>(null);
  const binAsked = useRef(false);
  const [at, setAt] = useState(0);
  const [news, setNews] = useState(false);
  const [again, setAgain] = useState(welcomeOn);

  useEffect(() => {
    let live = true;
    launchActivity().then((a) => live && setActivity(a), () => {});
    return () => {
      live = false;
    };
  }, []);

  const latest = pulse.kind === "waiting" ? null : pulse.pulse;
  if (latest && first.current === null) first.current = latest.block;
  const blocks = latest ? { first: first.current!, latest: latest.block } : null;
  const tips = tipsFor({ blocks, activity, bin });
  const tip = tips[at % tips.length];

  // Esc dismisses the dialog first, before it reaches the window underneath
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      if (news) setNews(false);
      else latestClose.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [news]);

  const next = () => {
    setAt((i) => i + 1);
    // the Trash is many reads: asked for only once somebody is reading tips
    if (!binAsked.current) {
      binAsked.current = true;
      recycleBin().then(setBin, () => {});
    }
  };
  const go = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <div className="welcome" role="presentation">
      <section className="win welcome__win" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <div className="win__bar">
          <button type="button" className="light light--close" onClick={onClose} aria-label="Close Welcome" title="Close" />
          <h2 className="win__title">
            <span>Welcome</span>
          </h2>
        </div>
        <div className="win__body welcome__body">
          <h1 id="welcome-title" className="welcome__head">
            Welcome to <b>{BRAND.name}</b>
          </h1>
          <div className="welcome__main">
            <div className="welcome__tip" aria-live="polite">
              <TipIcon />
              <div>
                <p className="welcome__did">Did you know…</p>
                <p className="welcome__text">{tip}</p>
              </div>
            </div>
            <div className="welcome__buttons">
              <Gel onClick={go(() => open!("explore"))}>Explore Base</Gel>
              <Gel quiet onClick={go(() => open!(cardWindow()))}>
                Make my Base card
              </Gel>
              <Gel quiet onClick={go(() => open!("launch"))}>
                Launch a coin
              </Gel>
              <Gel quiet onClick={() => setNews(true)}>
                What's New
              </Gel>
              <Gel quiet onClick={next}>
                Next Tip
              </Gel>
              <Gel quiet onClick={onClose}>
                Close
              </Gel>
            </div>
          </div>
          <label className="welcome__again">
            <input
              type="checkbox"
              checked={again}
              onChange={(e) => {
                setAgain(e.target.checked);
                setWelcomeOn(e.target.checked);
              }}
            />
            Show this Welcome Screen next time you start {BRAND.name}
          </label>
        </div>
      </section>
      {news && (
        <section className="win welcome__news" role="dialog" aria-modal="true" aria-label="What's New">
          <div className="win__bar">
            <button type="button" className="light light--close" onClick={() => setNews(false)} aria-label="Close What's New" />
            <h2 className="win__title">
              <span>What's New</span>
            </h2>
          </div>
          <div className="win__body">
            <p className="welcome__did">New in {BRAND.name}!</p>
            <ul className="welcome__list">
              {WHATS_NEW.map((item) => (
                <li key={item.title}>
                  <b>NEW:</b> {item.title} — {item.text}
                </li>
              ))}
            </ul>
            <div className="row welcome__row">
              <Gel onClick={go(() => open!(WHATS_NEW[0]!.window as WindowId))}>Show me</Gel>
              <Gel quiet onClick={() => setNews(false)}>
                Later
              </Gel>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
