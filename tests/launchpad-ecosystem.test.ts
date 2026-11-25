import { describe, expect, it, vi } from "vitest";

/** The ecosystem pair is this app's own token: offered only once its address is set (hard rule 1). */
describe("ECOSYSTEM_QUOTES", () => {
  it("names the brand token at its checksummed address, and is empty while the token is unset", async () => {
    const { ECOSYSTEM_QUOTES } = await import("@/adapters/http/launchpad");
    const { BRAND } = await import("@/brand");
    expect(ECOSYSTEM_QUOTES).toEqual([{ address: "0xB200000000000000000000bdb78b7B145fB15d7F", symbol: BRAND.ticker.replace("$", ""), name: BRAND.name, decimals: 18 }]);
    vi.resetModules();
    vi.doMock("@/config/chain", async (orig) => {
      const real = await orig<typeof import("@/config/chain")>();
      return { ...real, CONTRACTS: { ...real.CONTRACTS, token: null } };
    });
    expect((await import("@/adapters/http/launchpad")).ECOSYSTEM_QUOTES).toEqual([]);
    vi.doUnmock("@/config/chain");
    vi.resetModules();
  });
});
