import { describe, expect, it } from "vitest";
import { START, buildBoard, neighbours, reveal, toggleFlag, type Board } from "@/lib/rugsweeper";

const L = (mine: boolean, i: number) => ({ token: `0x${i}`, symbol: `T${i}`, mine, why: mine ? "red" : null });

describe("neighbours", () => {
  it("a corner has three, an edge five, the middle eight", () => {
    expect(neighbours(0, 3).sort()).toEqual([1, 3, 4]);
    expect(neighbours(8, 3).sort()).toEqual([4, 5, 7]);
    expect(neighbours(1, 3).sort()).toEqual([0, 2, 3, 4, 5]);
    expect(neighbours(4, 3)).toHaveLength(8);
    expect(neighbours(0, 1)).toEqual([]);
  });
});

describe("buildBoard", () => {
  it("fills squares past the last launch with safe, empty ones and counts mines near each", () => {
    const b = buildBoard([L(true, 0), L(false, 1)], 2);
    expect(b.mines).toBe(1);
    expect(b.cells.map((c) => [c.token, c.mine, c.near])).toEqual([
      ["0x0", true, 0],
      ["0x1", false, 1],
      [null, false, 1],
      [null, false, 1],
    ]);
    expect(b.cells[2]).toMatchObject({ symbol: "", why: null, index: 2 });
  });
});

/** 3×3, one mine in the corner (8). */
const corner: Board = buildBoard([...Array.from({ length: 8 }, (_, i) => L(false, i)), L(true, 8)], 3);

describe("reveal", () => {
  it("floods from a square with no mines near it, and wins when every safe square is open", () => {
    const p = reveal(corner, START, 0);
    expect(p.state).toBe("won");
    expect([...p.open].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("opens only the square when a mine is near", () => {
    const p = reveal(corner, START, 4);
    expect([...p.open]).toEqual([4]);
    expect(p.state).toBe("playing");
  });

  it("a flag blocks the flood", () => {
    const flagged = toggleFlag(START, 1);
    const p = reveal(corner, flagged, 0);
    expect(p.open.has(1)).toBe(false);
    expect(p.state).toBe("playing");
    // and a flagged square cannot be opened itself
    expect(reveal(corner, flagged, 1)).toBe(flagged);
  });

  it("a mine loses, and nothing moves after the end", () => {
    const lost = reveal(corner, START, 8);
    expect(lost).toMatchObject({ state: "lost", hit: 8 });
    expect(lost.open.has(8)).toBe(true);
    expect(reveal(corner, lost, 0)).toBe(lost);
    expect(toggleFlag(lost, 0)).toBe(lost);
  });

  it("an open square is a no-op, and a flag cannot go on one", () => {
    const p = reveal(corner, START, 4);
    expect(reveal(corner, p, 4)).toBe(p);
    expect(toggleFlag(p, 4)).toBe(p);
  });

  it("a flood does not revisit a square queued twice", () => {
    // empty 3x3 with no mines: every square is pushed by several neighbours
    const empty = buildBoard([], 3);
    expect(reveal(empty, START, 4).state).toBe("won");
  });
});

describe("toggleFlag", () => {
  it("puts a flag on and takes it off", () => {
    const on = toggleFlag(START, 3);
    expect(on.flags.has(3)).toBe(true);
    expect(toggleFlag(on, 3).flags.has(3)).toBe(false);
  });
});
