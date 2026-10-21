import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  DEFAULT_LIMITS,
  loadSpend,
  parseLimits,
  resetSpend,
  saveSpend,
  signedInLastDay,
  SPEND_KEY,
  whyNotSpend,
  type SignedPayment,
} from "@/lib/spendGuard";
import { MAX_TOOL_PRICE_BASE_UNITS } from "@/lib/requirements";

const NOW = 1_800_000_000_000;
const paid = (value: bigint, agoMs: number): SignedPayment => ({ at: NOW - agoMs, value, payee: "0xabc", resource: "https://a.example/x" });

describe("the defaults", () => {
  /** Anchored to the dearest measured tool ($1.00), not picked out of the air. */
  it("allow one dollar a payment and five a day", () => {
    expect(DEFAULT_LIMITS).toEqual({ perPayment: 1_000_000n, perDay: 5_000_000n });
  });
});

describe("what counts toward today", () => {
  it("adds what was signed in the last 24 hours and nothing older", () => {
    const ledger = [paid(1000n, 1000), paid(2000n, DAY_MS - 1), paid(9_000_000n, DAY_MS), paid(5n, DAY_MS + 1)];
    expect(signedInLastDay(ledger, NOW)).toBe(3000n);
  });
});

describe("whether a payment may be signed", () => {
  it("allows one inside both limits", () => {
    expect(whyNotSpend(DEFAULT_LIMITS, [], 1000n, NOW)).toBeNull();
  });

  it("allows one that lands exactly on each limit", () => {
    expect(whyNotSpend(DEFAULT_LIMITS, [paid(4_000_000n, 1)], 1_000_000n, NOW)).toBeNull();
  });

  it("refuses one above the per-payment limit, naming both numbers", () => {
    expect(whyNotSpend(DEFAULT_LIMITS, [], 1_000_001n, NOW)).toBe(
      "This asks for 1.000001 USDC, above your limit of 1 USDC per payment. Raise the limit if you mean it.",
    );
  });

  it("refuses one that would pass the daily limit, saying what was already signed", () => {
    expect(whyNotSpend(DEFAULT_LIMITS, [paid(4_999_999n, 1)], 2n, NOW)).toBe(
      "You have signed 4.999999 USDC in the last 24 hours, and this would take it past your daily limit of 5 USDC.",
    );
  });

  it("forgets yesterday", () => {
    expect(whyNotSpend(DEFAULT_LIMITS, [paid(5_000_000n, DAY_MS)], 1_000_000n, NOW)).toBeNull();
  });
});

describe("limits typed by a person", () => {
  it("reads them in USDC", () => {
    expect(parseLimits("0.5", "2")).toEqual({ perPayment: 500_000n, perDay: 2_000_000n });
  });

  it("refuses zero", () => {
    expect(() => parseLimits("0", "1")).toThrow(/above zero/);
    expect(() => parseLimits("1", "0")).toThrow(/above zero/);
  });

  it("refuses a per-payment limit above what this build will sign at all", () => {
    expect(MAX_TOOL_PRICE_BASE_UNITS).toBe(5_000_000n);
    expect(() => parseLimits("5.000001", "10")).toThrow(/No single payment above 5 USDC/);
  });

  it("refuses a daily limit below the per-payment one", () => {
    expect(() => parseLimits("2", "1")).toThrow(/below the per-payment limit/);
  });

  it("refuses what parseAmount refuses, in its words", () => {
    expect(() => parseLimits("one", "2")).toThrow(/not a plain decimal number/);
  });
});

describe("keeping it in the browser", () => {
  it("starts at the defaults with nothing signed", () => {
    expect(loadSpend(localStorage)).toEqual({ limits: DEFAULT_LIMITS, ledger: [] });
  });

  it("round-trips, and drops entries older than a week", () => {
    const ledger = [paid(1000n, 1), paid(2000n, 8 * DAY_MS)];
    const kept = saveSpend(localStorage, { perPayment: 2n, perDay: 3n }, ledger, NOW);
    expect(kept).toEqual([ledger[0]]);
    expect(loadSpend(localStorage)).toEqual({ limits: { perPayment: 2n, perDay: 3n }, ledger: [ledger[0]] });
  });

  /** 🔴 Unknown is not zero: an unreadable record refuses rather than resets. */
  it("fails closed on anything it cannot read", () => {
    const good = { limits: { perPayment: "1", perDay: "2" }, ledger: [{ at: 1, value: "3", payee: "p", resource: "r" }] };
    const bad = [
      "not json",
      "null",
      JSON.stringify({ ...good, limits: null }),
      JSON.stringify({ ...good, ledger: {} }),
      JSON.stringify({ ...good, limits: { perPayment: 1, perDay: "2" } }),
      JSON.stringify({ ...good, limits: { perPayment: "1", perDay: "-2" } }),
      JSON.stringify({ ...good, ledger: [null] }),
      JSON.stringify({ ...good, ledger: [{ ...good.ledger[0], at: "1" }] }),
      JSON.stringify({ ...good, ledger: [{ ...good.ledger[0], value: 3 }] }),
      JSON.stringify({ ...good, ledger: [{ ...good.ledger[0], value: "1.5" }] }),
      JSON.stringify({ ...good, ledger: [{ ...good.ledger[0], payee: 1 }] }),
      JSON.stringify({ ...good, ledger: [{ ...good.ledger[0], resource: null }] }),
    ];
    for (const raw of bad) {
      localStorage.setItem(SPEND_KEY, raw);
      expect(() => loadSpend(localStorage), raw).toThrow(/today's total is unknown and nothing will be signed/);
    }
    localStorage.setItem(SPEND_KEY, JSON.stringify(good));
    expect(loadSpend(localStorage).ledger[0]?.value).toBe(3n);
  });

  it("resets only when asked, back to the defaults", () => {
    localStorage.setItem(SPEND_KEY, "not json");
    resetSpend(localStorage);
    expect(loadSpend(localStorage)).toEqual({ limits: DEFAULT_LIMITS, ledger: [] });
  });

  it("uses the frozen key", () => {
    expect(SPEND_KEY).toBe("quadra.spend.v1");
  });
});
