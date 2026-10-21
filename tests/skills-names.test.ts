import { describe, expect, it } from "vitest";
import { addressOf, fullName, nameOf } from "@/skills/names";
import { resolveTarget } from "@/skills/target";
import { ADDR } from "./fixtures/base";
import { basenames, ethCalls, net, useNet, type NameBook } from "./net";

useNet();

/**
 * jesse.base.eth ↔ 0x2211…7DA9 through the L2 resolver: MEASURED with `cast` against
 * mainnet.base.org on 2026-09-30 (see `BASENAMES` in config/chain.ts). The fake answers the
 * registry and resolver with those values; the ABI encoding is viem's, the same library
 * the skill decodes with, so what is under test is the lookup logic, not the encoding.
 */
const JESSE: NameBook = {
  forward: { "jesse.base.eth": ADDR.jesse },
  reverse: { [ADDR.jesse]: "jesse.base.eth" },
  resolver: ADDR.l2Resolver,
};

const OTHER = "0x1111111111111111111111111111111111111111";

function chain(book: NameBook) {
  return net({ rpc: ethCalls(basenames(book)) });
}

describe("fullName", () => {
  it("reads a bare word as a .base.eth name", () => {
    expect(fullName("jesse")).toBe("jesse.base.eth");
  });

  it("takes a name with a dot as written, normalised", () => {
    expect(fullName("  Jesse.Base.ETH ")).toBe("jesse.base.eth");
    expect(fullName("vitalik.eth")).toBe("vitalik.eth");
  });

  it("refuses a name ENS normalisation rejects", () => {
    expect(() => fullName("bad name")).toThrow();
  });
});

describe("addressOf", () => {
  it("resolves a registered name through the resolver the registry names", async () => {
    chain(JESSE);
    expect(await addressOf("jesse")).toBe(ADDR.jesse);
  });

  it("is null for a name with no resolver", async () => {
    chain(JESSE);
    expect(await addressOf("nobody-registered-this")).toBeNull();
  });

  it("is null for a name whose resolver has no address set", async () => {
    chain({ forward: { "empty.base.eth": null }, resolver: ADDR.l2Resolver });
    expect(await addressOf("empty")).toBeNull();
  });
});

describe("nameOf", () => {
  it("reports a primary name that resolves back to the address as verified", async () => {
    chain(JESSE);
    expect(await nameOf(ADDR.jesse)).toEqual({ kind: "verified", name: "jesse.base.eth" });
  });

  it("finds it from a lowercased address too", async () => {
    chain(JESSE);
    expect(await nameOf(ADDR.jesse.toLowerCase())).toEqual({ kind: "verified", name: "jesse.base.eth" });
  });

  it("reports no name when there is no reverse record", async () => {
    chain(JESSE);
    expect(await nameOf(OTHER)).toEqual({ kind: "none" });
  });

  it("reports no name when the reverse record is empty", async () => {
    chain({ reverse: { [OTHER]: "" }, resolver: ADDR.l2Resolver });
    expect(await nameOf(OTHER)).toEqual({ kind: "none" });
  });

  /** 🔴 Anyone can put any name in their own reverse record. */
  it("refuses to verify a claimed name that points somewhere else", async () => {
    chain({ ...JESSE, reverse: { [OTHER]: "jesse.base.eth" } });
    expect(await nameOf(OTHER)).toEqual({ kind: "unverified", name: "jesse.base.eth", pointsTo: ADDR.jesse });
  });

  it("refuses to verify a claimed name that points nowhere", async () => {
    chain({ reverse: { [OTHER]: "ghost.base.eth" }, resolver: ADDR.l2Resolver });
    expect(await nameOf(OTHER)).toEqual({ kind: "unverified", name: "ghost.base.eth", pointsTo: null });
  });
});

describe("resolveTarget", () => {
  it("takes an address as an address, checksummed", async () => {
    expect(await resolveTarget(`  ${ADDR.jesse.toLowerCase()} `, "Wallet")).toEqual({ address: ADDR.jesse, via: null });
  });

  /** A contradicted checksum is a typo, never a cue to try it as a name instead. */
  it("refuses a bad checksum rather than resolving it as a name", async () => {
    const typo = ADDR.jesse.replace("d1D0", "d1d0");
    await expect(resolveTarget(typo, "Wallet")).rejects.toThrow(/Wallet/);
  });

  it("refuses something 0x-prefixed that is not an address", async () => {
    await expect(resolveTarget("0x1234", "Wallet")).rejects.toThrow(/Wallet/);
  });

  it("resolves a Basename and says where it came from", async () => {
    chain(JESSE);
    expect(await resolveTarget("jesse", "Wallet")).toEqual({ address: ADDR.jesse, via: "jesse.base.eth" });
  });

  it("names the Basename that points nowhere", async () => {
    chain(JESSE);
    await expect(resolveTarget("nobody-registered-this", "Wallet")).rejects.toThrow(
      "Wallet: no Basename called nobody-registered-this.base.eth points to an address.",
    );
  });

  it("asks for input when there is none", async () => {
    await expect(resolveTarget("   ", "Wallet")).rejects.toThrow("Wallet: type an address or a Basename.");
  });
});
