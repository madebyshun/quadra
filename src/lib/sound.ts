/**
 * The machine's sounds, synthesised with WebAudio — no audio files, so nothing to fetch and nothing
 * to license. OFF until the visitor turns it on (a page that beeps unasked is a page people close),
 * and the choice is remembered under `SOUND_KEY`. Every sound is a short chord of square/triangle
 * tones: the era's speaker, not a sample of anybody's startup chime.
 */

export const SOUND_KEY = "quadra.sound.v1";

export type SoundName = "boot" | "click" | "open" | "ok" | "error" | "trash" | "boom";

type Note = { readonly hz: number; readonly at: number; readonly len: number; readonly wave: OscillatorType; readonly gain: number };

/** Each sound as notes: when it starts (s), how long (s), what wave, how loud. */
export const SOUNDS: Readonly<Record<SoundName, readonly Note[]>> = {
  // a rising major chord, the machine saying hello
  boot: [
    { hz: 261.63, at: 0, len: 0.9, wave: "triangle", gain: 0.18 },
    { hz: 329.63, at: 0.08, len: 0.82, wave: "triangle", gain: 0.15 },
    { hz: 392.0, at: 0.16, len: 0.74, wave: "triangle", gain: 0.13 },
    { hz: 523.25, at: 0.24, len: 0.66, wave: "triangle", gain: 0.11 },
  ],
  click: [{ hz: 1800, at: 0, len: 0.02, wave: "square", gain: 0.04 }],
  open: [
    { hz: 660, at: 0, len: 0.05, wave: "square", gain: 0.05 },
    { hz: 990, at: 0.05, len: 0.06, wave: "square", gain: 0.05 },
  ],
  ok: [
    { hz: 784, at: 0, len: 0.08, wave: "triangle", gain: 0.12 },
    { hz: 1046.5, at: 0.09, len: 0.16, wave: "triangle", gain: 0.12 },
  ],
  // the "ding" of a dialog that has bad news
  error: [
    { hz: 440, at: 0, len: 0.18, wave: "square", gain: 0.08 },
    { hz: 330, at: 0.16, len: 0.28, wave: "square", gain: 0.08 },
  ],
  trash: [
    { hz: 220, at: 0, len: 0.06, wave: "square", gain: 0.06 },
    { hz: 140, at: 0.05, len: 0.12, wave: "square", gain: 0.06 },
  ],
  boom: [
    { hz: 110, at: 0, len: 0.35, wave: "square", gain: 0.12 },
    { hz: 55, at: 0.05, len: 0.5, wave: "triangle", gain: 0.12 },
  ],
};

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Whether sound is on. Unreadable storage reads as off — silence is the safe default. */
export function soundOn(): boolean {
  try {
    return storage()?.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

export function setSoundOn(on: boolean): void {
  try {
    storage()?.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // a browser that refuses storage just forgets the choice; the toggle still works this visit
  }
  listeners.forEach((l) => l(on));
}

const listeners = new Set<(on: boolean) => void>();
export function onSoundChange(l: (on: boolean) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

type AudioCtor = new () => AudioContext;
let ctx: AudioContext | null = null;

/** The audio context, made on first use (browsers allow it only after a gesture), or null without WebAudio. */
function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = (globalThis as { AudioContext?: AudioCtor }).AudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

/** Play a sound — only when sound is on. Never throws: a sound that cannot play is simply not heard. */
export function play(name: SoundName): void {
  if (!soundOn()) return;
  try {
    const ac = audio();
    if (!ac) return;
    const t0 = ac.currentTime;
    for (const n of SOUNDS[name]) {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = n.wave;
      osc.frequency.value = n.hz;
      g.gain.setValueAtTime(n.gain, t0 + n.at);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.len);
      osc.connect(g).connect(ac.destination);
      osc.start(t0 + n.at);
      osc.stop(t0 + n.at + n.len + 0.02);
    }
  } catch {
    // an audio device that refuses is silence, not an error
  }
}

/** For tests: forget the audio context. */
export function resetAudio(): void {
  ctx = null;
}
