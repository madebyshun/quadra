import { describe, it, expect } from "vitest";
import { BASE } from "@/config/chain";
import { BRAND } from "@/brand";
import {
  AAPL_BASE,
  AAPL_REFERENCE_POOL,
  B20_FACTORY,
  LAUNCH_TOKEN,
  LAUNCH_PAIR,
} from "@/config/pair";

/**
 * The decimals case is the one that matters. AAPLc has 8 decimals and every
 * other ERC-20 this app touches has 6 or 18, so a copy-paste of the USDC path
 * misprices it by 10^10. That does not look like a bug in output, it looks like
 * a 10-billion-x price move, so nothing downstream would reject it.
 */

describe("AAPLc, the other side of the pair", () => {
  it("has 8 decimals", () => {
    expect(AAPL_BASE.decimals).toBe(8);
  });

  it("is not 18 — the assumption that would misprice it by 10^10", () => {
    expect(AAPL_BASE.decimals).not.toBe(18);
    expect(10 ** (18 - AAPL_BASE.decimals)).toBe(10_000_000_000);
  });

  it("keeps the address and the explorer link in agreement", () => {
    expect(AAPL_BASE.explorer).toContain(AAPL_BASE.address);
    expect(AAPL_BASE.explorer.startsWith(BASE.explorer)).toBe(true);
  });

  it("is on Base 8453, the chain its explorer link points at", () => {
    expect(AAPL_BASE.chainId).toBe(8453);
    expect(AAPL_BASE.chainId).toBe(BASE.id);
  });

  it("follows the B20 share-token symbol form", () => {
    expect(AAPL_BASE.symbol).toBe("AAPLc");
    expect(AAPL_BASE.symbol).toMatch(/^[A-Z]+c$/);
  });

  it("is flagged as a precompile, so nothing tries to fetch its source", () => {
    expect(AAPL_BASE.isNativeB20).toBe(true);
  });

  it("sits in the b2 address space B20 tokens are minted into", () => {
    expect(AAPL_BASE.address.toLowerCase().startsWith("0xb2")).toBe(true);
  });
});

describe("the reference pool", () => {
  it("carries the date it was measured, because these numbers move", () => {
    expect(AAPL_REFERENCE_POOL.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("was liquid when measured", () => {
    expect(AAPL_REFERENCE_POOL.tvlUsd).toBeGreaterThan(1_000_000);
    expect(AAPL_REFERENCE_POOL.volume24hUsd).toBeGreaterThan(0);
  });

  it("recorded oracle and dex separately rather than one blended price", () => {
    const drift =
      Math.abs(AAPL_REFERENCE_POOL.dexUsd - AAPL_REFERENCE_POOL.oracleUsd) /
      AAPL_REFERENCE_POOL.oracleUsd;
    expect(drift).toBeLessThan(0.01);
  });
});

describe("the B20 factory", () => {
  it("is a separate address from the token", () => {
    expect(B20_FACTORY).not.toBe(AAPL_BASE.address);
  });

  it("is where isB20 lives — the token has no such method", () => {
    expect(B20_FACTORY).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});

describe("the product token, which does not exist yet", () => {
  it("has no address", () => {
    expect(LAUNCH_TOKEN).toBeNull();
  });

  it("has no pool either", () => {
    expect(LAUNCH_PAIR.pool).toBeNull();
  });

  it("knows what it will quote against", () => {
    expect(LAUNCH_PAIR.quote).toBe(AAPL_BASE.symbol);
  });

  it("takes its own side from brand.ts rather than a literal", () => {
    expect(LAUNCH_PAIR.base).toBe(BRAND.ticker.replace("$", ""));
    expect(LAUNCH_PAIR.base).not.toContain("$");
  });

  it("does not quote itself", () => {
    expect(LAUNCH_PAIR.base).not.toBe(LAUNCH_PAIR.quote);
  });
});
