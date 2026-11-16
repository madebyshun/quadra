import { useEffect, useState } from "react";
import { onSoundChange, play, setSoundOn, soundOn } from "@/lib/sound";
import { usePulse } from "@/ui/usePulse";

/**
 * The tray's two toys. The block clock is the supercomputer's heartbeat: the latest Base block,
 * read from the chain every few seconds, next to the time — click it for Task Manager. The speaker
 * turns the machine's sounds on and off (off until asked).
 */

export function clockText(now: Date): string {
  return now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Module-level, so the default is ONE function: a `() => new Date()` default parameter is a new one every render (CLAUDE.md). */
const NOW = () => new Date();

export function BlockClock({ onOpen, now = NOW }: { onOpen?: (() => void) | undefined; now?: () => Date }) {
  const state = usePulse();
  const [time, setTime] = useState(() => clockText(now()));
  useEffect(() => {
    const id = setInterval(() => setTime(clockText(now())), 15_000);
    return () => clearInterval(id);
  }, [now]);

  const block = state.kind === "waiting" ? null : state.pulse?.block ?? null;
  const stale = state.kind === "stale";
  const label = block === null ? (stale ? "Base not reached" : "reading Base…") : `block ${block.toLocaleString("en-US")}`;
  return (
    <button
      type="button"
      className={`tray__clock ${stale ? "tray__clock--stale" : ""}`}
      title={stale ? `The latest block could not be read: ${state.why}` : "The latest Base block, read from the chain. Click for Task Manager."}
      onClick={onOpen}
      aria-label={`${label}, ${time}. Open Task Manager`}
    >
      <span className="tray__block mono">
        {block !== null && <span className={`tray__beat ${stale ? "" : "tray__beat--live"}`} key={block} aria-hidden="true" />}
        {label}
      </span>
      <span className="tray__time">{time}</span>
    </button>
  );
}

export function SoundToggle() {
  const [on, setOn] = useState(soundOn);
  useEffect(() => onSoundChange(setOn), []);
  return (
    <button
      type="button"
      className="tray__sound"
      aria-pressed={on}
      aria-label={on ? "Sound on — click to mute" : "Sound off — click to turn on"}
      title={on ? "Sound on" : "Sound off"}
      onClick={() => {
        setSoundOn(!on);
        if (!on) play("ok");
      }}
    >
      <span aria-hidden="true">{on ? "snd/on" : "snd/off"}</span>
    </button>
  );
}
