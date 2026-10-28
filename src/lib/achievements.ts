/**
 * What this browser has done on the machine — counted locally, under `ACHIEVEMENTS_KEY`, because
 * running a verdict or winning Rugsweeper leaves nothing on chain. The achievements a WALLET earns
 * (launching, collecting fees, a Basename) are read from the chain instead, in the Achievements
 * window; these counters are only the ones the chain cannot know.
 */

export const ACHIEVEMENTS_KEY = "quadra.achievements.v1";

export type Counter = "verdicts" | "sweeps" | "sweepWins" | "binVisits" | "taskmgr";

export type Counts = Readonly<Record<Counter, number>>;

const ZERO: Counts = { verdicts: 0, sweeps: 0, sweepWins: 0, binVisits: 0, taskmgr: 0 };

/** The counters, or zeros when storage is unreadable — a lost count is a game reset, never a failure. */
export function counts(): Counts {
  try {
    const raw = globalThis.localStorage?.getItem(ACHIEVEMENTS_KEY);
    if (!raw) return ZERO;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return ZERO;
    const out = { ...ZERO };
    for (const k of Object.keys(ZERO) as Counter[]) {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v === "number" && Number.isInteger(v) && v >= 0) out[k] = v;
    }
    return out;
  } catch {
    return ZERO;
  }
}

const listeners = new Set<(c: Counts) => void>();
export function onCounts(l: (c: Counts) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Count one more. */
export function count(what: Counter): Counts {
  const next = { ...counts(), [what]: counts()[what] + 1 };
  try {
    globalThis.localStorage?.setItem(ACHIEVEMENTS_KEY, JSON.stringify(next));
  } catch {
    // storage refused: the count lives for this visit only
  }
  listeners.forEach((l) => l(next));
  return next;
}
