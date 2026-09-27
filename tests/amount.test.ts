import { describe, expect, it } from "vitest";
import { formatAmount, parseAmount } from "@/lib/amount";
import { AAPL_BASE } from "@/config/pair";

/**
 * The hazard this file exists for: AAPLc has 8 decimals, USDC has 6, WETH has 18.
 * Every case below names its token, because a test that says "decimals = 8" and
 * nothing else would still pass if the constant it is guarding moved to 18.
 */

describe("parseAmount", () => {
  it("reads whole numbers", () => {
    expect(parseAmount("1", 6)).toBe(1_000_000n);
    expect(parseAmount("0", 6)).toBe(0n);
    expect(parseAmount("250", 6)).toBe(250_000_000n);
  });

  it("reads AAPLc at its real 8 decimals", () => {
    expect(AAPL_BASE.decimals).toBe(8);
    expect(parseAmount("1.5", AAPL_BASE.decimals)).toBe(150_000_000n);
    expect(parseAmount("1", AAPL_BASE.decimals)).toBe(100_000_000n);
  });

  it("gives a different answer for the same text at 6, 8 and 18 decimals", () => {
    const one = "1";
    expect(parseAmount(one, 6)).toBe(1_000_000n);
    expect(parseAmount(one, 8)).toBe(100_000_000n);
    expect(parseAmount(one, 18)).toBe(1_000_000_000_000_000_000n);
  });

  it("is exact at 18 decimals, where a float would not be", () => {
    expect(parseAmount("0.1", 18)).toBe(100_000_000_000_000_000n);
    // 15 fraction digits padded to 18, so three zeros follow. A float would have
    // lost the tail entirely: Number("1234.567890123456789") ends in ...6789 no more.
    expect(parseAmount("1234.567890123456789", 18)).toBe(1_234_567_890_123_456_789_000n);
  });

  it("accepts a leading or trailing dot", () => {
    expect(parseAmount(".5", 6)).toBe(500_000n);
    expect(parseAmount("5.", 6)).toBe(5_000_000n);
  });

  it("accepts fewer decimal places than the token has", () => {
    expect(parseAmount("1.5", 6)).toBe(1_500_000n);
    expect(parseAmount("1.000001", 6)).toBe(1_000_001n);
  });

  it("trims surrounding whitespace", () => {
    expect(parseAmount("  2.5  ", 6)).toBe(2_500_000n);
  });

  it("reads amounts past Number.MAX_SAFE_INTEGER without losing digits", () => {
    expect(parseAmount("9007199.254740993", 9)).toBe(9_007_199_254_740_993n);
  });

  it("rejects an empty amount", () => {
    expect(() => parseAmount("", 6)).toThrow("Enter an amount.");
    expect(() => parseAmount("   ", 6)).toThrow("Enter an amount.");
  });

  it("rejects a lone dot rather than reading it as zero", () => {
    expect(() => parseAmount(".", 6)).toThrow("Enter an amount.");
  });

  it("rejects anything that is not a plain decimal", () => {
    for (const bad of ["1e6", "-1", "+1", "1,000", "1.2.3", "abc", "0x10", "1 000"]) {
      expect(() => parseAmount(bad, 6)).toThrow("is not a plain decimal number");
    }
  });

  it("refuses to round, and says nothing was rounded", () => {
    expect(() => parseAmount("1.0000001", 6)).toThrow(
      "This token has 6 decimals, so 7 decimal places cannot be represented. Nothing was rounded.",
    );
  });

  it("refuses over-precision on AAPLc specifically", () => {
    expect(() => parseAmount("1.123456789", 8)).toThrow("This token has 8 decimals");
    expect(parseAmount("1.12345678", 8)).toBe(112_345_678n);
  });

  it("handles a 0-decimal token", () => {
    expect(parseAmount("7", 0)).toBe(7n);
    expect(() => parseAmount("7.5", 0)).toThrow("This token has 0 decimals");
  });

  it("rejects a decimals value that could only come from a bug", () => {
    for (const bad of [-1, 37, 1.5, NaN, Infinity]) {
      expect(() => parseAmount("1", bad)).toThrow("decimals must be an integer in 0..36");
    }
  });
});

describe("formatAmount", () => {
  it("writes whole numbers without a dot", () => {
    expect(formatAmount(1_000_000n, 6)).toBe("1");
    expect(formatAmount(0n, 6)).toBe("0");
    expect(formatAmount(250_000_000n, 6)).toBe("250");
  });

  it("drops trailing zeros but keeps significant ones", () => {
    expect(formatAmount(1_500_000n, 6)).toBe("1.5");
    expect(formatAmount(1_000_001n, 6)).toBe("1.000001");
    expect(formatAmount(1_010_000n, 6)).toBe("1.01");
  });

  it("pads a fraction shorter than the token's decimals", () => {
    expect(formatAmount(1n, 6)).toBe("0.000001");
    expect(formatAmount(1n, 8)).toBe("0.00000001");
  });

  it("writes AAPLc at 8 decimals", () => {
    expect(formatAmount(150_000_000n, 8)).toBe("1.5");
    expect(formatAmount(112_345_678n, 8)).toBe("1.12345678");
  });

  it("writes a 0-decimal token as the integer it is", () => {
    expect(formatAmount(7n, 0)).toBe("7");
    expect(formatAmount(0n, 0)).toBe("0");
  });

  it("round-trips through parseAmount at every decimals this app uses", () => {
    for (const [text, decimals] of [
      ["1.5", 8],
      ["0.000001", 6],
      ["1234.56", 6],
      ["0.1", 18],
      ["99999.99999999", 8],
      ["7", 0],
    ] as const) {
      expect(formatAmount(parseAmount(text, decimals), decimals)).toBe(text);
    }
  });

  it("refuses a negative amount", () => {
    expect(() => formatAmount(-1n, 6)).toThrow("Amount cannot be negative.");
  });

  it("rejects a decimals value that could only come from a bug", () => {
    expect(() => formatAmount(1n, 99)).toThrow("decimals must be an integer in 0..36");
  });
});

describe("the 10^10 hazard the module header names", () => {
  it("shows what getting the exponent wrong costs, so the guard is not abstract", () => {
    const aaplc = parseAmount("1", AAPL_BASE.decimals);
    const asIf18 = parseAmount("1", 18);
    expect(asIf18 / aaplc).toBe(10n ** 10n);
  });

  it("cannot be papered over by a default, because there is no default", () => {
    // @ts-expect-error decimals is required: a caller that forgets it does not compile.
    expect(() => parseAmount("1")).toThrow();
  });
});
