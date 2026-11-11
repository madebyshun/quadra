/**
 * Base's block clock. Blocks were 2 s apart until the chain moved to 200 ms blocks; from then on
 * five blocks share each whole second of `timestamp`.
 *
 * 🔴 MEASURED 2026-11-11 on mainnet.base.org by bisection: block 53,556,127 (timestamp
 * 1,793,901,601) is the last 2 s block — every block before it is exactly 2 s after its parent —
 * and blocks 53,556,128–53,556,131 carry the same timestamp, 53,556,132 the next second. A
 * constant "2 s a block" made every window after it ten times too long (a "60-minute" radar read
 * ten hours' worth of blocks' time span as one, then called a 6-minute-old launch "60 min ago").
 */

/** The last block made 2 s after its parent. */
export const FAST_BLOCK = 53_556_127;
/** Its timestamp, in seconds. */
export const FAST_TIME = 1_793_901_601;
/** Seconds between blocks before `FAST_BLOCK`. */
export const SLOW_SECONDS = 2;
/** Blocks per second after `FAST_BLOCK`. */
export const FAST_PER_SECOND = 5;

/** A block's timestamp in seconds, as the chain sets it (exact on both sides of the change). */
export function timeOf(block: number): number {
  return block <= FAST_BLOCK
    ? FAST_TIME - (FAST_BLOCK - block) * SLOW_SECONDS
    : FAST_TIME + Math.floor((block - FAST_BLOCK) / FAST_PER_SECOND);
}

/** The first block whose timestamp is at or after `seconds`. */
export function blockAt(seconds: number): number {
  return seconds <= FAST_TIME
    ? FAST_BLOCK - Math.floor((FAST_TIME - seconds) / SLOW_SECONDS)
    : FAST_BLOCK + Math.ceil((seconds - FAST_TIME) * FAST_PER_SECOND);
}

/** The block `minutes` before `latest`, never below 0. */
export function blocksAgo(latest: number, minutes: number): number {
  return Math.max(0, Math.min(latest, blockAt(timeOf(latest) - minutes * 60)));
}

/** Whole minutes between two blocks, as their timestamps say. */
export function minutesBetween(from: number, to: number): number {
  return Math.round((timeOf(to) - timeOf(from)) / 60);
}
