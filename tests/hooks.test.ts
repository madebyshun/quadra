import { describe, expect, it } from "vitest";
import {
  ALL_HOOK_BITS,
  HOOK_PERMISSIONS,
  isHookAddress,
  NOT_AN_ADDRESS,
  readHookAddress,
} from "@/lib/hooks";

/** Build an address whose low bits are exactly `bits`, so each flag can be isolated. */
const at = (bits: number) => `0x${bits.toString(16).padStart(40, "0")}`;

const named = (name: string) => {
  const found = HOOK_PERMISSIONS.find((p) => p.name === name);
  if (!found) throw new Error(`no permission called ${name}`);
  return found;
};

describe("the flag table", () => {
  it("covers all 14 bits v4 reserves, with no gaps and no repeats", () => {
    expect(HOOK_PERMISSIONS).toHaveLength(ALL_HOOK_BITS);
    const bits = HOOK_PERMISSIONS.map((p) => p.bit).sort((a, b) => a - b);
    expect(bits).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it("names each callback once", () => {
    const names = new Set(HOOK_PERMISSIONS.map((p) => p.name));
    expect(names.size).toBe(HOOK_PERMISSIONS.length);
  });

  /**
   * The positions are v4-core's, and getting one wrong would report the wrong
   * power over someone's swap. Pinned individually rather than as a list, so a
   * failure names the flag that moved.
   */
  it("puts each flag where v4-core puts it", () => {
    expect(named("beforeInitialize").bit).toBe(13);
    expect(named("afterInitialize").bit).toBe(12);
    expect(named("beforeAddLiquidity").bit).toBe(11);
    expect(named("afterAddLiquidity").bit).toBe(10);
    expect(named("beforeRemoveLiquidity").bit).toBe(9);
    expect(named("afterRemoveLiquidity").bit).toBe(8);
    expect(named("beforeSwap").bit).toBe(7);
    expect(named("afterSwap").bit).toBe(6);
    expect(named("beforeDonate").bit).toBe(5);
    expect(named("afterDonate").bit).toBe(4);
    expect(named("beforeSwapReturnsDelta").bit).toBe(3);
    expect(named("afterSwapReturnsDelta").bit).toBe(2);
    expect(named("afterAddLiquidityReturnsDelta").bit).toBe(1);
    expect(named("afterRemoveLiquidityReturnsDelta").bit).toBe(0);
  });

  it("explains each one in second person, without the callback name", () => {
    for (const p of HOOK_PERMISSIONS) {
      expect(p.means.length, p.name).toBeGreaterThan(10);
      expect(p.means, p.name).not.toContain(p.name);
    }
  });
});

describe("reading an address", () => {
  it("reports no permissions for the zero address", () => {
    const reading = readHookAddress(`0x${"0".repeat(40)}`);
    expect(reading.inert).toBe(true);
    expect(reading.granted).toHaveLength(0);
    expect(reading.permissions).toHaveLength(ALL_HOOK_BITS);
  });

  it("lists every permission even when none is granted", () => {
    const reading = readHookAddress(`0x${"0".repeat(40)}`);
    expect(reading.permissions.every((p) => !p.granted)).toBe(true);
  });

  it("isolates each flag: one bit set grants exactly one permission", () => {
    for (const p of HOOK_PERMISSIONS) {
      const reading = readHookAddress(at(1 << p.bit));
      expect(reading.granted.map((g) => g.name), p.name).toEqual([p.name]);
      expect(reading.inert, p.name).toBe(false);
    }
  });

  it("grants all fourteen when all fourteen bits are set", () => {
    const reading = readHookAddress(at((1 << ALL_HOOK_BITS) - 1));
    expect(reading.granted).toHaveLength(ALL_HOOK_BITS);
    expect(reading.inert).toBe(false);
  });

  /**
   * The bit that would break this silently. Only the low 14 bits are permissions;
   * everything above is just address. An address with bit 14 set and nothing below
   * it is inert, and reading it as a permission would invent a power.
   */
  it("ignores bits above the fourteenth, which are not permissions", () => {
    const reading = readHookAddress(at(1 << ALL_HOOK_BITS));
    expect(reading.inert).toBe(true);
    expect(reading.granted).toHaveLength(0);
  });

  /**
   * A real hook address is 20 bytes of mined salt with the flags in the tail. The
   * leading `f`s are there to prove the high bits are ignored: a first draft of
   * this test used 37 of them and read bits 13 and 12 as permissions, because
   * `0xf080 & 0x3fff` is not `0x0080`.
   */
  it("reads the low bits of a full-length address, not just a short one", () => {
    const reading = readHookAddress(`0x${"f".repeat(36)}0080`);
    expect(reading.granted.map((g) => g.name)).toEqual(["beforeSwap"]);
  });

  it("keeps v4's own order, so beforeSwap is listed before afterSwap", () => {
    const reading = readHookAddress(at((1 << 7) | (1 << 6)));
    expect(reading.granted.map((g) => g.name)).toEqual(["beforeSwap", "afterSwap"]);
  });

  it("returns the address it read, trimmed", () => {
    const reading = readHookAddress(`  ${at(0)}  `);
    expect(reading.address).toBe(at(0));
  });

  it("accepts mixed case without treating it as a different address", () => {
    const upper = readHookAddress(`0x${"A".repeat(36)}0080`);
    const lower = readHookAddress(`0x${"a".repeat(36)}0080`);
    expect(upper.granted.map((g) => g.name)).toEqual(["beforeSwap"]);
    expect(lower.granted.map((g) => g.name)).toEqual(upper.granted.map((g) => g.name));
  });
});

describe("refusing what is not an address", () => {
  /**
   * These must throw rather than read as inert. "No permissions" is reassuring and
   * "you pasted the wrong thing" is not, and a 32-byte tx hash silently reporting
   * a safe hook is the failure this guards.
   */
  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["no 0x", "f".repeat(40)],
    ["too short", `0x${"f".repeat(39)}`],
    ["too long", `0x${"f".repeat(41)}`],
    ["a tx hash", `0x${"f".repeat(64)}`],
    ["not hex", `0x${"g".repeat(40)}`],
    ["a name", "vitalik.eth"],
  ])("refuses %s", (_label, raw) => {
    expect(isHookAddress(raw)).toBe(false);
    expect(() => readHookAddress(raw)).toThrow(NOT_AN_ADDRESS);
  });

  /**
   * The check and the throw have to agree, because the panel trusts the check and
   * then calls the reader. If `isHookAddress` ever said yes where
   * `readHookAddress` throws, that throw would reach the user as a blank screen.
   */
  it("accepts exactly what it will read", () => {
    for (const raw of [`0x${"0".repeat(40)}`, `0x${"F".repeat(40)}`, `  0x${"a".repeat(40)}  `]) {
      expect(isHookAddress(raw), raw).toBe(true);
      expect(() => readHookAddress(raw), raw).not.toThrow();
    }
  });
});
