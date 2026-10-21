import { afterEach, describe, expect, it, vi } from "vitest";
import { GREETING, Q_KEY, forgetTips, onTip, qOn, say, setQOn, type Tip } from "@/lib/assistant";
import { ACHIEVEMENTS_KEY, count, counts, onCounts } from "@/lib/achievements";

afterEach(() => {
  forgetTips();
  vi.restoreAllMocks();
});

const refuseStorage = () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
};

describe("Q", () => {
  it("is on by default and remembers off", () => {
    expect(qOn()).toBe(true);
    setQOn(false);
    expect(localStorage.getItem(Q_KEY)).toBe("off");
    expect(qOn()).toBe(false);
    setQOn(true);
    expect(localStorage.getItem(Q_KEY)).toBe("on");
    expect(qOn()).toBe(true);
  });

  it("is on when storage cannot be read, and a refused write is harmless", () => {
    refuseStorage();
    expect(qOn()).toBe(true);
    expect(() => setQOn(false)).not.toThrow();
  });

  it("is on with no localStorage at all", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(qOn()).toBe(true);
    setQOn(false);
    vi.unstubAllGlobals();
  });

  it("says each tip once per session, only while on, to every listener until it leaves", () => {
    const heard: Tip[] = [];
    const off = onTip((t) => heard.push(t));
    say(GREETING);
    say(GREETING);
    expect(heard).toEqual([GREETING]);
    setQOn(false);
    say({ id: "quiet", text: "x" });
    expect(heard).toHaveLength(1);
    setQOn(true);
    say({ id: "quiet", text: "x" });
    expect(heard).toHaveLength(2);
    forgetTips();
    off();
    say(GREETING);
    expect(heard).toHaveLength(2);
  });

  it("greets with radar", () => {
    expect(GREETING.action).toEqual({ label: "Run radar", command: "radar" });
  });
});

describe("achievements' counters", () => {
  it("start at zero and count up, telling listeners", () => {
    expect(counts()).toEqual({ verdicts: 0, sweeps: 0, sweepWins: 0, binVisits: 0, taskmgr: 0 });
    const seen: number[] = [];
    const off = onCounts((c) => seen.push(c.verdicts));
    count("verdicts");
    expect(count("verdicts").verdicts).toBe(2);
    off();
    count("verdicts");
    expect(seen).toEqual([1, 2]);
    expect(JSON.parse(localStorage.getItem(ACHIEVEMENTS_KEY)!).verdicts).toBe(3);
  });

  it("read a corrupt record as zeros", () => {
    localStorage.setItem(ACHIEVEMENTS_KEY, "{not json");
    expect(counts().sweeps).toBe(0);
    for (const raw of ["null", "7", '"s"']) {
      localStorage.setItem(ACHIEVEMENTS_KEY, raw);
      expect(counts().sweeps).toBe(0);
    }
  });

  it("keep only whole, non-negative numbers", () => {
    localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify({ verdicts: -1, sweeps: 2.5, sweepWins: "3", binVisits: 4, taskmgr: 0 }));
    expect(counts()).toEqual({ verdicts: 0, sweeps: 0, sweepWins: 0, binVisits: 4, taskmgr: 0 });
  });

  it("survive storage that refuses — a count for this visit only", () => {
    refuseStorage();
    expect(counts().taskmgr).toBe(0);
    expect(count("taskmgr").taskmgr).toBe(1);
  });

  it("read zeros with no localStorage at all", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(counts().binVisits).toBe(0);
    expect(count("binVisits").binVisits).toBe(1);
    vi.unstubAllGlobals();
  });
});
