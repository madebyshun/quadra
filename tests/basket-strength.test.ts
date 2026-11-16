import { describe, expect, it, vi } from "vitest";
import { measureStrength } from "@/lib/basketStrength";
const legs = [60, 40].map((weight, i) => ({ weight, asset: { address: `0x${String(i).padStart(40, "0")}`, symbol: `A${i}`, decimals: 8, kind: "stock" as const } }));
describe("sampled basket Strength", () => {
  it("measures every weighted leg and returns a lower bound at the largest tested size", async () => {
    const quote = vi.fn(async () => ({ impact: "-2" }));
    const progress = vi.fn();
    expect(await measureStrength(legs, quote, progress)).toEqual({ passed: 100_000, tested: 100_000, limiting: null, problem: null });
    expect(quote).toHaveBeenCalledTimes(8);
    expect(quote).toHaveBeenNthCalledWith(1, legs[0], 60_000_000n);
    expect(quote).toHaveBeenNthCalledWith(2, legs[1], 40_000_000n);
    expect(progress).toHaveBeenLastCalledWith(100_000, "A1");
  });
  it("stops at the first limiting leg while retaining the last passing size", async () => {
    const quote = vi.fn(async () => ({ impact: "0.2" })).mockResolvedValueOnce({ impact: "0.2" }).mockResolvedValueOnce({ impact: "0.2" }).mockResolvedValueOnce({ impact: "-3" });
    expect(await measureStrength(legs, quote, () => {})).toEqual({ passed: 100, tested: 1000, limiting: "A0", problem: null });
    const refused = async () => { throw Error("Swap impact is too high: -45.2%."); };
    expect(await measureStrength(legs, refused, () => {})).toEqual({ passed: 0, tested: 100, limiting: "A0", problem: null });
  });
  it("never turns missing impacts or upstream outages into a depth claim", async () => {
    for (const impact of [null, "unknown"]) expect((await measureStrength(legs, async () => ({ impact }), () => {})).problem).toContain("did not give");
    expect((await measureStrength(legs, async () => { throw Error("offline"); }, () => {})).problem).toBe("offline");
  });
});
