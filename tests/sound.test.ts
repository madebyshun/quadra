import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SOUND_KEY, SOUNDS, onSoundChange, play, resetAudio, setSoundOn, soundOn } from "@/lib/sound";

type Osc = { type: string; frequency: { value: number }; started: number; stopped: number; connect: (g: unknown) => unknown };

/** An AudioContext that records what it was asked to play. */
function fakeAudio(opts: { throwOn?: boolean } = {}) {
  const oscs: Osc[] = [];
  const gains: { set: [number, number][]; ramp: [number, number][] }[] = [];
  let made = 0;
  class FakeContext {
    currentTime = 10;
    destination = { id: "speaker" };
    constructor() {
      made += 1;
    }
    createOscillator() {
      if (opts.throwOn) throw new Error("no device");
      const o: Osc = {
        type: "",
        frequency: { value: 0 },
        started: -1,
        stopped: -1,
        connect: (g) => g,
      };
      (o as unknown as { start: (t: number) => void }).start = (t) => void (o.started = t);
      (o as unknown as { stop: (t: number) => void }).stop = (t) => void (o.stopped = t);
      oscs.push(o);
      return o;
    }
    createGain() {
      const rec = { set: [] as [number, number][], ramp: [] as [number, number][] };
      gains.push(rec);
      return {
        gain: {
          setValueAtTime: (v: number, t: number) => void rec.set.push([v, t]),
          exponentialRampToValueAtTime: (v: number, t: number) => void rec.ramp.push([v, t]),
        },
        connect: (d: unknown) => d,
      };
    }
  }
  vi.stubGlobal("AudioContext", FakeContext);
  return { oscs, gains, made: () => made };
}

beforeEach(() => resetAudio());
afterEach(() => resetAudio());

describe("soundOn / setSoundOn", () => {
  it("is off until turned on, and remembers the choice", () => {
    expect(soundOn()).toBe(false);
    setSoundOn(true);
    expect(localStorage.getItem(SOUND_KEY)).toBe("on");
    expect(soundOn()).toBe(true);
    setSoundOn(false);
    expect(localStorage.getItem(SOUND_KEY)).toBe("off");
    expect(soundOn()).toBe(false);
  });

  it("reads unreadable storage as off, and a refused write still tells listeners", () => {
    const heard: boolean[] = [];
    const off = onSoundChange((on) => heard.push(on));
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(soundOn()).toBe(false);
    setSoundOn(true);
    expect(heard).toEqual([true]);
    get.mockRestore();
    set.mockRestore();
    off();
    setSoundOn(false);
    expect(heard).toEqual([true]);
  });

  it("treats a missing or throwing localStorage as no storage", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(soundOn()).toBe(false);
    setSoundOn(true);
    vi.unstubAllGlobals();
    const desc = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("SecurityError");
      },
    });
    try {
      expect(soundOn()).toBe(false);
      setSoundOn(true);
    } finally {
      Object.defineProperty(globalThis, "localStorage", desc);
    }
  });
});

describe("play", () => {
  it("stays silent while sound is off — no audio context is even made", () => {
    const a = fakeAudio();
    play("boot");
    expect(a.made()).toBe(0);
  });

  it("plays each note of the sound at its time, and reuses one context", () => {
    setSoundOn(true);
    const a = fakeAudio();
    play("ok");
    play("click");
    expect(a.made()).toBe(1);
    expect(a.oscs.map((o) => [o.type, o.frequency.value, o.started])).toEqual([
      ["triangle", 784, 10],
      ["triangle", 1046.5, 10.09],
      ["square", 1800, 10],
    ]);
    const n = SOUNDS.ok[1]!;
    expect(a.oscs[1]!.stopped).toBeCloseTo(10 + n.at + n.len + 0.02);
    expect(a.gains[1]!.set).toEqual([[n.gain, 10 + n.at]]);
    expect(a.gains[1]!.ramp[0]![0]).toBe(0.0001);
  });

  it("is silence without WebAudio", () => {
    setSoundOn(true);
    vi.stubGlobal("AudioContext", undefined);
    expect(() => play("error")).not.toThrow();
  });

  it("swallows a device that refuses", () => {
    setSoundOn(true);
    fakeAudio({ throwOn: true });
    expect(() => play("boom")).not.toThrow();
  });

  it("every sound has notes", () => {
    for (const notes of Object.values(SOUNDS)) expect(notes.length).toBeGreaterThan(0);
  });
});
