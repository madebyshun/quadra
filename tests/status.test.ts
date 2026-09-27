import { describe, it, expect } from "vitest";
import { badges, poolBadge, countBadge } from "@/lib/status";
import { FEATURES, isEnabled } from "@/features/registry";
import { CONTRACTS } from "@/config/chain";

/**
 * The point of deriving these is that the page cannot claim something that is
 * not true. So the test asserts the arithmetic against the registry rather than
 * against a copy of the expected string — a literal here would rot in the same
 * way the badge would.
 */
describe("desktop badges", () => {
  it("counts switched-on features from the registry", () => {
    const on = FEATURES.filter(isEnabled).length;
    const [count] = badges();
    expect(count?.text).toBe(`${on} of ${FEATURES.length} switched on`);
  });

  it("does not read as fully shipped while anything is off", () => {
    const allOn = FEATURES.every(isEnabled);
    const [count] = badges();
    expect(count?.tone).toBe(allOn ? "ok" : "neutral");
  });

  it("says the pool is not deployed while the address is null", () => {
    const last = badges().at(-1);
    if (CONTRACTS.shieldedPool === null) {
      expect(last?.text).toBe("local pool, not deployed yet");
      expect(last?.tone).toBe("warn");
    } else {
      expect(last?.text).toBe("proofs made in your browser");
      expect(last?.tone).toBe("ok");
    }
  });

  it("never claims browser-made proofs before the pool exists", () => {
    if (CONTRACTS.shieldedPool === null) {
      expect(badges().map((b) => b.text)).not.toContain("proofs made in your browser");
    }
  });

  it("states the custody fact, which is true regardless of deployment", () => {
    expect(badges().map((b) => b.text)).toContain("holds no key");
  });

  it("returns badges with unique text, since text is the react key", () => {
    const text = badges().map((b) => b.text);
    expect(new Set(text).size).toBe(text.length);
  });

  it("only uses tones the desktop knows how to render", () => {
    for (const b of badges()) {
      expect(["ok", "warn", "neutral"]).toContain(b.tone);
    }
  });
});

describe("countBadge", () => {
  it("reads as ok only when everything is on", () => {
    expect(countBadge(10, 10)).toEqual({ text: "10 of 10 switched on", tone: "ok" });
  });

  it("stays neutral while anything is off", () => {
    expect(countBadge(8, 10)).toEqual({ text: "8 of 10 switched on", tone: "neutral" });
    expect(countBadge(0, 10).tone).toBe("neutral");
  });

  it("is what badges() uses, rather than a second copy of the wording", () => {
    const on = FEATURES.filter(isEnabled).length;
    expect(badges()[0]).toEqual(countBadge(on, FEATURES.length));
  });
});

describe("poolBadge", () => {
  it("warns while the pool is only local", () => {
    expect(poolBadge(false)).toEqual({ text: "local pool, not deployed yet", tone: "warn" });
  });

  it("claims browser-made proofs only once deployed", () => {
    expect(poolBadge(true)).toEqual({ text: "proofs made in your browser", tone: "ok" });
  });

  it("says something different in each state, so the badge is informative", () => {
    expect(poolBadge(true).text).not.toBe(poolBadge(false).text);
    expect(poolBadge(true).tone).not.toBe(poolBadge(false).tone);
  });

  it("is what badges() uses, rather than a second copy of the wording", () => {
    expect(badges().at(-1)).toEqual(poolBadge(CONTRACTS.shieldedPool !== null));
  });
});
