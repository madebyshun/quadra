import { rpc } from "@/skills/http";
import { isObj, strOf } from "@/skills/json";

/**
 * Base's pulse: the latest block, read from the chain. One poller for the whole page, shared by
 * whatever is listening — the taskbar's block clock, Task Manager, the screensaver — so three
 * surfaces showing the block number cost one request every `PULSE_MS`, and none while nobody
 * listens. A read that fails keeps the last pulse and says it is stale; it never invents a block.
 */

export type Pulse = {
  readonly block: number;
  /** the block's own timestamp, seconds */
  readonly time: number;
  readonly txs: number;
  /** base fee, in gwei */
  readonly baseFeeGwei: number;
  /** gas used as a share of the block's gas limit, 0..1 */
  readonly fullness: number;
};

export type PulseState =
  | { readonly kind: "waiting" }
  | { readonly kind: "live"; readonly pulse: Pulse; readonly history: readonly Pulse[] }
  | { readonly kind: "stale"; readonly pulse: Pulse | null; readonly history: readonly Pulse[]; readonly why: string };

/** Base makes five blocks a second (blocktime.ts); polling faster would only measure the RPC. */
export const PULSE_MS = 4000;
/** How many pulses Task Manager's graphs keep. */
export const HISTORY = 30;

const hexNum = (v: unknown): number | null => {
  const s = strOf(v);
  return s && /^0x[0-9a-f]+$/i.test(s) ? Number(BigInt(s)) : null;
};

/** A block from `eth_getBlockByNumber(latest, false)` as a pulse, or null when it is not one. */
export function parsePulse(body: unknown): Pulse | null {
  if (!isObj(body)) return null;
  const block = hexNum(body.number);
  const time = hexNum(body.timestamp);
  const used = hexNum(body.gasUsed);
  const limit = hexNum(body.gasLimit);
  const fee = hexNum(body.baseFeePerGas);
  if (block === null || time === null || used === null || limit === null || fee === null || !Array.isArray(body.transactions)) return null;
  return { block, time, txs: body.transactions.length, baseFeeGwei: fee / 1e9, fullness: limit === 0 ? 0 : used / limit };
}

export async function readPulse(): Promise<Pulse> {
  const pulse = parsePulse(await rpc("eth_getBlockByNumber", ["latest", false]));
  if (!pulse) throw new Error("Base answered with something that is not a block.");
  return pulse;
}

/** Transactions per second over the history, from the blocks' own timestamps; null until two blocks apart. */
export function tps(history: readonly Pulse[]): number | null {
  const first = history[0];
  const last = history[history.length - 1];
  if (!first || !last || last.time <= first.time) return null;
  // the first block's txs happened before the window opened, so they are left out
  const txs = history.slice(1).reduce((n, p) => n + p.txs, 0);
  return txs / (last.time - first.time);
}

type Listener = (state: PulseState) => void;

/** The poller, as a small store. `read` and the timer functions are injected so it is tested without a clock. */
export function pulseStore(
  read: () => Promise<Pulse> = readPulse,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void } = {
    set: (fn, ms) => setInterval(fn, ms),
    clear: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  },
) {
  let state: PulseState = { kind: "waiting" };
  const listeners = new Set<Listener>();
  let timer: unknown = null;

  const emit = () => listeners.forEach((l) => l(state));
  const tick = async () => {
    try {
      const pulse = await read();
      const prev = state.kind === "waiting" ? [] : state.history;
      // the same block read twice is one block, not two
      const history = prev.length && prev[prev.length - 1]!.block === pulse.block ? prev : [...prev, pulse].slice(-HISTORY);
      state = { kind: "live", pulse, history };
    } catch (e) {
      const last = state.kind === "waiting" ? null : state.pulse;
      const history = state.kind === "waiting" ? [] : state.history;
      state = { kind: "stale", pulse: last, history, why: e instanceof Error ? e.message : String(e) };
    }
    emit();
  };

  return {
    get: () => state,
    subscribe(l: Listener): () => void {
      listeners.add(l);
      if (timer === null) {
        void tick();
        timer = timers.set(() => void tick(), PULSE_MS);
      }
      return () => {
        listeners.delete(l);
        if (listeners.size === 0 && timer !== null) {
          timers.clear(timer);
          timer = null;
        }
      };
    },
  };
}

export const PULSE = pulseStore();
