import { describe, expect, it } from "vitest";
import { blockAt, blocksAgo, FAST_BLOCK, FAST_TIME, minutesBetween, timeOf } from "@/skills/blocktime";

// Timestamps read from mainnet.base.org on 2026-11-11 (eth_getBlockByNumber), not computed here
const MEASURED: readonly (readonly [number, number])[] = [
  [53_550_000, 1_793_889_347],
  [53_556_127, 1_793_901_601],
  [53_556_128, 1_793_901_601],
  [53_556_131, 1_793_901_601],
  [53_556_132, 1_793_901_602],
  [53_556_136, 1_793_901_602],
  [53_556_137, 1_793_901_603],
];

describe("Base's block clock", () => {
  it("gives each measured block the chain's own timestamp, on both sides of the change", () => {
    for (const [block, time] of MEASURED) expect(timeOf(block)).toBe(time);
  });

  it("finds the first block at or after a time", () => {
    expect(blockAt(FAST_TIME)).toBe(FAST_BLOCK);
    expect(blockAt(FAST_TIME + 1)).toBe(53_556_132);
    expect(blockAt(1_793_889_347)).toBe(53_550_000);
    expect(blockAt(1_793_889_348)).toBe(53_550_001);
    for (const b of [53_000_000, 53_556_100, 53_556_132, 54_000_000]) expect(timeOf(blockAt(timeOf(b)))).toBe(timeOf(b));
  });

  it("counts an hour as 18,000 blocks now and 1,800 before", () => {
    // 54,000,002 is the first block of its second; a block mid-second goes back to its second's first
    expect(54_000_002 - blocksAgo(54_000_002, 60)).toBe(18_000);
    expect(54_000_000 - blocksAgo(54_000_000, 60)).toBe(18_003);
    expect(53_000_000 - blocksAgo(53_000_000, 60)).toBe(1_800);
    expect(blocksAgo(100, 60)).toBe(0);
    expect(blocksAgo(FAST_BLOCK + 100, 60)).toBe(FAST_BLOCK - 1_790) // 20 s after the change, then 3,580 s of 2 s blocks;
  });

  it("says minutes from the timestamps, not from a block count", () => {
    expect(minutesBetween(53_982_000, 54_000_000)).toBe(60);
    expect(minutesBetween(53_000_000, 53_001_800)).toBe(60);
    expect(minutesBetween(54_000_000, 54_000_000)).toBe(0);
  });
});
