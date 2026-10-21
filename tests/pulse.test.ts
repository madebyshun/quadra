import { afterEach, describe, expect, it, vi } from "vitest";
import { HISTORY, PULSE_MS, parsePulse, pulseStore, readPulse, tps, type Pulse, type PulseState } from "@/lib/pulse";
import { PX } from "./fixtures/pulse";
import { DOWN, net, useNet } from "./net";
import { pulse } from "./pulseFake";

useNet();

describe("parsePulse", () => {
  it("reads a real block", () => {
    expect(parsePulse(PX.block)).toEqual({
      block: 0x3226b08,
      time: 0x6acf32f3,
      txs: 4,
      baseFeeGwei: 0x4c4b40 / 1e9,
      fullness: 0x1d3fce4 / 0x17d78400,
    });
  });

  it("is not a block without every field", () => {
    expect(parsePulse(null)).toBeNull();
    expect(parsePulse("0x1")).toBeNull();
    for (const k of ["number", "timestamp", "gasUsed", "gasLimit", "baseFeePerGas"]) {
      expect(parsePulse({ ...PX.block, [k]: undefined })).toBeNull();
      expect(parsePulse({ ...PX.block, [k]: "12" })).toBeNull();
    }
    expect(parsePulse({ ...PX.block, transactions: undefined })).toBeNull();
  });

  it("calls a zero gas limit empty, not a division by zero", () => {
    expect(parsePulse({ ...PX.block, gasLimit: "0x0" })!.fullness).toBe(0);
  });
});

describe("readPulse", () => {
  it("asks for the latest block", async () => {
    let asked: unknown;
    net({ rpc: (m, p) => (m === "eth_getBlockByNumber" ? ((asked = p), PX.block) : undefined) });
    expect((await readPulse()).block).toBe(0x3226b08);
    expect(asked).toEqual(["latest", false]);
  });

  it("refuses an answer that is not a block", async () => {
    net({ rpc: () => null });
    await expect(readPulse()).rejects.toThrow("Base answered with something that is not a block.");
  });
});

describe("tps", () => {
  it("is null until two blocks apart in time", () => {
    expect(tps([])).toBeNull();
    expect(tps([pulse(1)])).toBeNull();
    expect(tps([pulse(1), pulse(2, { time: pulse(1).time })])).toBeNull();
  });

  it("leaves the first block's transactions out", () => {
    expect(tps([pulse(1, { txs: 999 }), pulse(2, { txs: 10 }), pulse(3, { txs: 30 })])).toBe(40 / 4);
  });
});

/** A store with a hand-driven read and timer. */
function rig() {
  let next: () => Promise<Pulse> = () => new Promise(() => {});
  const timer = { fn: null as (() => void) | null, ms: 0, cleared: [] as unknown[] };
  const store = pulseStore(
    () => next(),
    {
      set: (fn, ms) => ((timer.fn = fn), (timer.ms = ms), "T"),
      clear: (id) => void timer.cleared.push(id),
    },
  );
  const seen: PulseState[] = [];
  return {
    store,
    timer,
    seen,
    answer: (p: Pulse | Error) => (next = () => (p instanceof Error ? Promise.reject(p) : Promise.resolve(p))),
    tick: async () => {
      timer.fn!();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("pulseStore", () => {
  it("waits, then goes live on the first read, polling every PULSE_MS", async () => {
    const r = rig();
    expect(r.store.get()).toEqual({ kind: "waiting" });
    r.answer(pulse(10));
    r.store.subscribe((s) => r.seen.push(s));
    await flush();
    expect(r.timer.ms).toBe(PULSE_MS);
    expect(r.store.get()).toEqual({ kind: "live", pulse: pulse(10), history: [pulse(10)] });
    expect(r.seen).toHaveLength(1);
  });

  it("keeps the same block once, and caps the history", async () => {
    const r = rig();
    r.answer(pulse(1));
    r.store.subscribe(() => {});
    await flush();
    await r.tick();
    expect((r.store.get() as { history: readonly Pulse[] }).history).toEqual([pulse(1)]);
    for (let b = 2; b <= HISTORY + 5; b++) {
      r.answer(pulse(b));
      await r.tick();
    }
    const h = (r.store.get() as { history: readonly Pulse[] }).history;
    expect(h).toHaveLength(HISTORY);
    expect(h[h.length - 1]!.block).toBe(HISTORY + 5);
  });

  it("a failed first read is stale with no pulse — never an invented block", async () => {
    const r = rig();
    r.answer(new Error("down"));
    r.store.subscribe(() => {});
    await flush();
    expect(r.store.get()).toEqual({ kind: "stale", pulse: null, history: [], why: "down" });
  });

  it("stale after live keeps what it had; a non-Error is said as text; stale → live resumes the history", async () => {
    let next: () => Promise<Pulse> = () => Promise.resolve(pulse(5));
    let fire: () => void = () => {};
    const store = pulseStore(() => next(), { set: (fn) => ((fire = fn), 1), clear: () => {} });
    store.subscribe(() => {});
    await flush();
    next = () => Promise.reject("rate limited");
    fire();
    await flush();
    expect(store.get()).toEqual({ kind: "stale", pulse: pulse(5), history: [pulse(5)], why: "rate limited" });
    next = () => Promise.resolve(pulse(6));
    fire();
    await flush();
    expect(store.get()).toEqual({ kind: "live", pulse: pulse(6), history: [pulse(5), pulse(6)] });
  });

  it("starts one timer for many listeners and stops it when the last one leaves", async () => {
    const r = rig();
    const a = r.store.subscribe(() => {});
    const b = r.store.subscribe(() => {});
    a();
    expect(r.timer.cleared).toEqual([]);
    b();
    expect(r.timer.cleared).toEqual(["T"]);
    b();
    expect(r.timer.cleared).toEqual(["T"]);
    // a new listener starts it again
    r.store.subscribe(() => {})();
    expect(r.timer.cleared).toEqual(["T", "T"]);
  });
});

describe("pulseStore's defaults", () => {
  afterEach(() => vi.useRealTimers());

  it("reads the chain on a real interval and clears it", async () => {
    vi.useFakeTimers();
    let n = 0;
    net({ rpc: () => ((n += 1), n === 1 ? PX.block : DOWN) });
    const store = pulseStore();
    const off = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get().kind).toBe("live");
    expect(vi.getTimerCount()).toBe(1);
    off();
    expect(vi.getTimerCount()).toBe(0);
  });
});
