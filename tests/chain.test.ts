import { describe, it, expect } from "vitest";
import { BASE, USDC, WETH, CONTRACTS, FLAGS, requireContract, assertDeployed } from "@/config/chain";

/**
 * These guard the rule that outranks every other rule in this repo: no address
 * is ever invented. A test that only checked "the address is a hex string"
 * would pass on a fabricated one, so each case below pins a specific value
 * that was read off chain, and the unset ones are asserted to still be unset.
 */

const HEX40 = /^0x[0-9a-fA-F]{40}$/;

describe("Base chain constants", () => {
  it("is Base mainnet and nothing else", () => {
    expect(BASE.id).toBe(8453);
    expect(parseInt(BASE.idHex, 16)).toBe(BASE.id);
    expect(BASE.explorer).toBe("https://basescan.org");
  });

  it("points at a Base rpc, never an Ethereum one", () => {
    for (const url of [BASE.rpc, BASE.rpcFallback]) {
      expect(url.startsWith("https://")).toBe(true);
      expect(url).not.toMatch(/mainnet\.infura|eth-mainnet|ethereum/i);
    }
  });
});

describe("token constants", () => {
  it("USDC is the Circle-issued Base address with 6 decimals", () => {
    expect(USDC.address).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(USDC.decimals).toBe(6);
  });

  it("carries the EIP-3009 domain, since a wrong one silently voids every signature", () => {
    expect(USDC.eip712.name).toBe("USD Coin");
    expect(USDC.eip712.version).toBe("2");
  });

  it("WETH is the canonical predeploy with 18 decimals", () => {
    expect(WETH.address).toBe("0x4200000000000000000000000000000000000006");
    expect(WETH.decimals).toBe(18);
  });

  it("every declared address is a full 20-byte address", () => {
    for (const addr of [USDC.address, WETH.address]) {
      expect(addr).toMatch(HEX40);
    }
  });
});

describe("our own contracts", () => {
  it("are all still unset", () => {
    for (const [name, addr] of Object.entries(CONTRACTS)) {
      expect(addr, `CONTRACTS.${name} was set — deploy and verify it first`).toBeNull();
    }
  });

  it("throws naming the constant rather than returning a zero address", () => {
    expect(() => requireContract("shieldedPool")).toThrowError(/CONTRACTS\.shieldedPool/);
    expect(() => requireContract("treasury")).toThrowError(/not deployed yet/);
  });

  it("names the explorer in the error, so the fix is in the message", () => {
    expect(() => requireContract("verifier")).toThrowError(/basescan\.org/);
  });

  it("never hands back a plausible-looking placeholder", () => {
    for (const name of Object.keys(CONTRACTS) as Array<keyof typeof CONTRACTS>) {
      let returned: string | null = null;
      try {
        returned = requireContract(name);
      } catch {
        // expected while unset
      }
      expect(returned).toBeNull();
    }
  });
});

/**
 * The path that will run the first time money moves. Tested now, against the
 * pure helper, rather than being exercised for the first time in production.
 */
describe("assertDeployed, the once-deployed path", () => {
  it("hands back the address it was given", () => {
    expect(assertDeployed("shieldedPool", USDC.address)).toBe(USDC.address);
  });

  it("does not normalize or reformat the address it returns", () => {
    const mixed = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    expect(assertDeployed("treasury", mixed)).toBe(mixed);
  });

  it("throws on null", () => {
    expect(() => assertDeployed("verifier", null)).toThrowError(/CONTRACTS\.verifier/);
  });

  it("throws on an empty string rather than returning it", () => {
    expect(() => assertDeployed("verifier", "")).toThrowError(/not deployed yet/);
  });
});

describe("flags", () => {
  it("only switches on what has something behind it", () => {
    expect(FLAGS.bridge).toBe(false);
    expect(FLAGS.launch).toBe(false);
    expect(FLAGS.webhooks).toBe(false);
  });

  it("is all booleans", () => {
    for (const [name, v] of Object.entries(FLAGS)) {
      expect(typeof v, `FLAGS.${name}`).toBe("boolean");
    }
  });
});
