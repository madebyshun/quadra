import { useEffect, useState } from "react";
import { onSoundChange, play, setSoundOn, soundOn } from "@/lib/sound";
import { setWelcomeOn, welcomeOn } from "@/lib/welcome";
import {
  SAVER_MINUTES,
  WALLPAPERS,
  saverMinutes,
  saverOn,
  setSaverMinutes,
  setSaverOn,
  setWallpaper,
  wallpaper,
} from "@/lib/settings";
import { QuadraSelect } from "@/ui/Select";
import { useSetting } from "@/ui/useSettings";

/**
 * The Control Panel (2026-10-21): the machine's own preferences, each applied the moment it is
 * changed and remembered in this browser only. Sound is the same switch as the tray's speaker.
 */
export function ControlPanel() {
  const paper = useSetting(wallpaper);
  const saver = useSetting(saverOn);
  const minutes = useSetting(saverMinutes);
  const [sound, setSound] = useState(soundOn);
  useEffect(() => onSoundChange(setSound), []);
  const [welcome, setWelcome] = useState(welcomeOn);

  return (
    <div className="control stack">
      <fieldset className="control__group">
        <legend>Desktop Pattern</legend>
        <div className="control__papers" role="radiogroup" aria-label="Desktop pattern">
          {WALLPAPERS.map((w) => (
            <label key={w.id} className="control__paper">
              <input type="radio" name="wallpaper" value={w.id} checked={paper === w.id} onChange={() => setWallpaper(w.id)} />
              <span className={`control__swatch wallpaper--${w.id}`} aria-hidden="true" />
              <span>{w.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="control__group">
        <legend>Sounds</legend>
        <label className="control__row">
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => {
              setSoundOn(e.target.checked);
              if (e.target.checked) play("ok");
            }}
          />
          Play the machine's sounds
        </label>
      </fieldset>

      <fieldset className="control__group">
        <legend>Screen Saver</legend>
        <label className="control__row">
          <input type="checkbox" checked={saver} onChange={(e) => setSaverOn(e.target.checked)} />
          Show Base's blocks when the machine is idle
        </label>
        <div className="control__row">
          <span>Wait</span>
          <QuadraSelect
            ariaLabel="Wait minutes"
            value={String(minutes)}
            disabled={!saver}
            onChange={(v) => setSaverMinutes(Number(v))}
            options={SAVER_MINUTES.map((m) => ({ value: String(m), label: String(m) }))}
          />
          <span>minutes</span>
        </div>
      </fieldset>

      <fieldset className="control__group">
        <legend>Welcome screen</legend>
        <label className="control__row">
          <input
            type="checkbox"
            checked={welcome}
            onChange={(e) => {
              setWelcomeOn(e.target.checked);
              setWelcome(e.target.checked);
            }}
          />
          Show the Welcome screen at startup
        </label>
      </fieldset>
    </div>
  );
}
