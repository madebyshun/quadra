import type { Pulse, PulseState, pulseStore } from "@/lib/pulse";

/** A pulse store a test drives by hand: `set` replaces the state and tells every subscriber. */
export function fakePulse(initial: PulseState = { kind: "waiting" }) {
  let state = initial;
  const subs = new Set<() => void>();
  const store = {
    subscribe: (cb: () => void) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    get: () => state,
  } as unknown as ReturnType<typeof pulseStore>;
  return {
    store,
    set(next: PulseState) {
      state = next;
      subs.forEach((s) => s());
    },
  };
}

export const pulse = (block: number, over: Partial<Pulse> = {}): Pulse =>
  ({ block, txs: 100, fullness: 0.5, baseFeeGwei: 0.005, time: 1_760_000_000 + block * 2, ...over });
