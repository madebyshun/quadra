import { describe, expect, it } from "vitest";
import { BLOCKSCOUT_SITE, compact, quoteAmountText, quoteWithUsd, quoteWords, SUBSCRIPT_FROM, tinyPrice } from "@/skills/format";

describe("compact — small quote amounts the way a DEX screen writes them", () => {
  it("writes the owner's examples in subscript zeros, never exponent form", () => {
    expect(compact(0.00000299)).toBe("0.0₅299");
    expect(compact(4.09e-8)).toBe("0.0₇409");
    expect(compact(2.39e-6)).toBe("0.0₅239");
    expect(compact(5.98e-7)).toBe("0.0₆598");
    for (const n of [1e-5, 3.3e-9, 7.7e-15, 1e-30]) expect(compact(n)).not.toMatch(/e/);
  });

  it("switches to the subscript at four zeros after the point, and keeps positional digits before it", () => {
    expect(SUBSCRIPT_FROM).toBe(4);
    expect(compact(0.0003)).toBe("0.0003");
    expect(compact(0.000123456)).toBe("0.0001234");
    expect(compact(0.0000123456)).toBe("0.0₄1234");
    expect(compact(0.5)).toBe("0.5");
    expect(compact(0.0274)).toBe("0.0274");
  });

  it("counts a two-digit run of zeros in two subscript digits", () => {
    expect(compact(1.5e-13)).toBe("0.0₁₂15");
  });

  it("truncates, never rounds up — and keeps a value under one under one", () => {
    expect(compact(0.12349)).toBe("0.1234");
    expect(compact(0.999999999)).toBe("0.9999");
    expect(compact(2.999e-6, 3)).toBe("0.0₅299");
  });

  it("groups from one up, with two decimals at most, however large", () => {
    expect(compact(1)).toBe("1");
    expect(compact(1234567.891)).toBe("1,234,567.89");
    expect(compact(1e21)).toBe("1,000,000,000,000,000,000,000");
  });

  it("zero is 0; missing, non-finite and negative are 'not read', never a number", () => {
    expect(compact(0)).toBe("0");
    for (const n of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, -1e-9]) expect(compact(n)).toBe("not read");
  });
});

describe("the quote and dollar halves", () => {
  it("quoteAmountText adds the symbol, or says not read", () => {
    expect(quoteAmountText(0.00000299, "AAPLc")).toBe("0.0₅299 AAPLc");
    expect(quoteAmountText(null, "AAPLc")).toBe("not read");
    expect(quoteAmountText(2, "")).toBe("2");
  });

  it("quoteWithUsd drops the dollar half under a cent (zero included), and keeps it from a cent up", () => {
    expect(quoteWithUsd(0.00000299, "AAPLc", 331)).toBe("0.0₅299 AAPLc");
    expect(quoteWithUsd(0.0003, "AAPLc", 331)).toBe("$0.10 · 0.0003 AAPLc");
    expect(quoteWithUsd(0, "ETH", 2000)).toBe("0 ETH");
    expect(quoteWithUsd(1, "ETH", null)).toBe("1 ETH");
    expect(quoteWithUsd(1, "ETH", Number.NaN)).toBe("1 ETH");
    expect(quoteWithUsd(Number.NaN, "ETH", 2000)).toBe("not read");
  });

  it("tinyPrice: dollars from one up, subscript below, not read when missing", () => {
    expect(tinyPrice(2.5)).toBe("$2.50");
    expect(tinyPrice(0.0000135)).toBe("$0.0₄135");
    expect(tinyPrice(null)).toBe("not read");
  });

  it("quoteWords is the same compact form", () => {
    expect(quoteWords(40.9)).toBe("40.9");
    expect(quoteWords(4.09e-8)).toBe("0.0₇409");
  });

  it("names Blockscout's site for Base", () => {
    expect(BLOCKSCOUT_SITE).toBe("https://base.blockscout.com");
  });
});
