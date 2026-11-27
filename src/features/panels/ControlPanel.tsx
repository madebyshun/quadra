import { useEffect, useState } from "react";
import { onSoundChange, play, setSoundOn, soundOn } from "@/lib/sound";
import { setWelcomeOn, welcomeOn } from "@/lib/welcome";
import {
  DOT_SHAPES,
  SAVER_MINUTES,
  WALLPAPERS,
  WALLPAPER_SCENES,
  customWallpaperImage,
  saverMinutes,
  saverOn,
  setCustomWallpaperImage,
  setSaverMinutes,
  setSaverOn,
  setWallpaper,
  setWallpaperScene,
  setWallpaperShape,
  wallpaper,
  wallpaperScene,
  wallpaperShape,
} from "@/lib/settings";
import { PlatinumSelect } from "@/ui/Select";
import { useSetting } from "@/ui/useSettings";

/**
 * The Control Panel (2026-10-21): the machine's own preferences, each applied the moment it is
 * changed and remembered in this browser only. Sound is the same switch as the tray's speaker.
 */
export function ControlPanel() {
  const paper = useSetting(wallpaper);
  const scene = useSetting(wallpaperScene);
  const shape = useSetting(wallpaperShape);
  const custom = useSetting(customWallpaperImage);
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
        {paper === "motion" ? (
          <div className="stack">
            <div className="control__row">
              <span>Scene</span>
              <div className="coins__seg" role="group" aria-label="Wallpaper scene">
                {WALLPAPER_SCENES.map((sc) => (
                  <button
                    key={sc.id}
                    type="button"
                    className="coins__seg-btn"
                    aria-pressed={!custom && scene === sc.id}
                    onClick={() => {
                      setCustomWallpaperImage(null);
                      setWallpaperScene(sc.id);
                    }}
                  >
                    {sc.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="control__row">
              <span>Photo</span>
              <label className="chip">
                Upload image…
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      if (typeof reader.result === "string") setCustomWallpaperImage(reader.result);
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              {custom ? (
                <button type="button" className="chip" onClick={() => setCustomWallpaperImage(null)}>
                  Clear photo
                </button>
              ) : null}
            </div>
            <div className="control__row">
              <span>Dot shape</span>
              <div className="coins__seg" role="group" aria-label="Wallpaper dot shape">
                {DOT_SHAPES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="coins__seg-btn"
                    aria-pressed={shape === s.id}
                    onClick={() => setWallpaperShape(s.id)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
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
          <PlatinumSelect
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
