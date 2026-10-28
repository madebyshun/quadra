import { describe, expect, it } from "vitest";
import { BASE, USDC } from "@/config/chain";
import { BLUEAGENT } from "@/config/upstream";
import {
  AUTHORIZATION_TYPE,
  DOMAIN_TYPE,
  USDC_DOMAIN,
  type Authorization,
} from "@/lib/eip712";
import { toHex } from "@/lib/keccak";
import {
  paymentHeader,
  parseSignature,
  SCHEME,
  signAuthorization,
  signingSummary,
  SIGNATURE_HEX_LENGTH,
  typedDataFor,
  typedDataType,
  X402_VERSION,
} from "@/lib/payment";
import { authorizationFor, checkRequirements } from "@/lib/requirements";
import type { Eip1193Provider, Eip1193Request } from "@/lib/wallet";

/**
 * `paymentHeader` and `signingSummary` in terms of one real 402, the same body
 * `tests/requirements.test.ts` uses — verbatim from production, not invented here.
 */
const LIVE = {
  x402Version: 2,
  error: "Payment Required",
  resource: {
    url: "https://blueagent.dev/api/x402/token-price",
    description: "Live price, mcap, volume and liquidity for any Base token (DexScreener).",
    mimeType: "application/json",
    serviceName: "Blue Hub",
    tags: ["base", "ai", "defi", "agents"],
    iconUrl: "https://blueagent.dev/icon.png",
  },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      amount: "10000",
      payTo: "0x02950ad38ada1d599375bd447e080cd404809205",
      maxTimeoutSeconds: 120,
      extra: { name: "USD Coin", version: "2" },
    },
  ],
};

function withAccept(patch: Record<string, unknown>): unknown {
  return { ...LIVE, accepts: [{ ...LIVE.accepts[0], ...patch }] };
}

const requirements = () => checkRequirements("token-price", BLUEAGENT.origin, LIVE);

/** An EIP-55 vector, so it is checksummed rather than merely well-shaped. */
const FROM = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const NONCE = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
/** 2027-01-15T08:00:00Z, in seconds. */
const NOW = 1_800_000_000n;

const signable = () => authorizationFor(requirements(), FROM, NOW, NONCE);

/** 65 bytes, well-formed. */
const SIGNATURE = `0x${"a".repeat(130)}`;

describe("typedDataType", () => {
  it("splits a struct name from its members", () => {
    expect(typedDataType("Foo(address a,uint256 b)")).toEqual({
      name: "Foo",
      fields: [
        { type: "address", name: "a" },
        { type: "uint256", name: "b" },
      ],
    });
  });

  it("parses the real domain and authorization type strings", () => {
    expect(typedDataType(DOMAIN_TYPE).name).toBe("EIP712Domain");
    expect(typedDataType(AUTHORIZATION_TYPE).name).toBe("TransferWithAuthorization");
    expect(typedDataType(AUTHORIZATION_TYPE).fields).toHaveLength(6);
  });

  it("refuses a string with no parentheses", () => {
    expect(() => typedDataType("NotAType")).toThrow(/Not an EIP-712 type string/);
  });

  it("refuses a member that is not a \"<type> <name>\" pair", () => {
    expect(() => typedDataType("Foo(address)")).toThrow(/is not a "<type> <name>" pair/);
  });
});

describe("typedDataFor", () => {
  it("carries the domain, primary type and every authorization field as the wallet expects it", () => {
    const { authorization } = signable();
    const typedData = typedDataFor(USDC_DOMAIN, authorization);
    expect(typedData.primaryType).toBe("TransferWithAuthorization");
    expect(typedData.types.EIP712Domain).toBeDefined();
    expect(typedData.types.TransferWithAuthorization).toBeDefined();
    expect(typedData.domain).toEqual({
      name: USDC_DOMAIN.name,
      version: USDC_DOMAIN.version,
      chainId: USDC_DOMAIN.chainId,
      verifyingContract: USDC_DOMAIN.verifyingContract,
    });
    expect(typedData.message).toEqual({
      from: authorization.from,
      to: authorization.to,
      value: authorization.value.toString(10),
      validAfter: authorization.validAfter.toString(10),
      validBefore: authorization.validBefore.toString(10),
      nonce: toHex(authorization.nonce),
    });
  });

  it("writes every uint256 as a decimal string, never a JSON number", () => {
    const { authorization } = signable();
    const typedData = typedDataFor(USDC_DOMAIN, authorization);
    for (const field of ["value", "validAfter", "validBefore"] as const) {
      expect(typeof typedData.message[field]).toBe("string");
    }
  });
});

describe("parseSignature", () => {
  it("accepts a well-formed 65-byte signature", () => {
    expect(parseSignature(SIGNATURE)).toBe(SIGNATURE);
  });

  it("is exactly SIGNATURE_HEX_LENGTH characters", () => {
    expect(SIGNATURE).toHaveLength(SIGNATURE_HEX_LENGTH);
  });

  it("refuses a non-string answer, naming its type", () => {
    expect(() => parseSignature(null)).toThrow(/object where a 65-byte signature/);
    expect(() => parseSignature(undefined)).toThrow(/undefined where a 65-byte signature/);
  });

  it("refuses a string of the wrong length, naming its length", () => {
    expect(() => parseSignature("0x1234")).toThrow(/6 characters where a 65-byte signature/);
  });

  it("refuses a string missing the recovery byte", () => {
    expect(() => parseSignature(`0x${"a".repeat(128)}`)).toThrow(/65-byte signature/);
  });

  it("refuses non-hex characters", () => {
    expect(() => parseSignature(`0x${"g".repeat(130)}`)).toThrow(/65-byte signature/);
  });
});

/** A fake EIP-1193 provider, driven by a method → answer map. */
function fakeProvider(answer: (() => unknown) | unknown): {
  provider: Eip1193Provider;
  calls: Eip1193Request[];
} {
  const calls: Eip1193Request[] = [];
  return {
    calls,
    provider: {
      request(args) {
        calls.push(args);
        if (typeof answer === "function") {
          return (answer as () => unknown)() as Promise<unknown>;
        }
        return Promise.resolve(answer);
      },
    },
  };
}

describe("signAuthorization", () => {
  it("asks eth_signTypedData_v4 for the signer in auth.from, and returns the checked signature", async () => {
    const { authorization } = signable();
    const { provider, calls } = fakeProvider(SIGNATURE);
    const signature = await signAuthorization(provider, USDC_DOMAIN, authorization);
    expect(signature).toBe(SIGNATURE);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("eth_signTypedData_v4");
    expect(calls[0]?.params?.[0]).toBe(authorization.from);
    expect(JSON.parse(calls[0]?.params?.[1] as string)).toEqual(
      typedDataFor(USDC_DOMAIN, authorization),
    );
  });

  it("reports a decline distinctly from any other failure", async () => {
    const { authorization } = signable();
    const { provider } = fakeProvider(() =>
      Promise.reject(Object.assign(new Error("nope"), { code: 4001 })),
    );
    await expect(signAuthorization(provider, USDC_DOMAIN, authorization)).rejects.toThrow(
      /You declined the signature/,
    );
  });

  it("recognises a decline reported as the string form of the code", async () => {
    const { authorization } = signable();
    const { provider } = fakeProvider(() =>
      Promise.reject(Object.assign(new Error("nope"), { code: "4001" })),
    );
    await expect(signAuthorization(provider, USDC_DOMAIN, authorization)).rejects.toThrow(
      /You declined the signature/,
    );
  });

  it("names the wallet's own message on any other failure", async () => {
    const { authorization } = signable();
    const { provider } = fakeProvider(() => Promise.reject(new Error("wallet is locked")));
    await expect(signAuthorization(provider, USDC_DOMAIN, authorization)).rejects.toThrow(
      /Your wallet did not sign the payment \(wallet is locked\)/,
    );
  });

  it("still reports a failure when the thrown value carries no message", async () => {
    const { authorization } = signable();
    const { provider } = fakeProvider(() => Promise.reject("nope"));
    await expect(signAuthorization(provider, USDC_DOMAIN, authorization)).rejects.toThrow(
      /Your wallet did not sign the payment\. Nothing was charged/,
    );
  });

  it("still checks the shape of whatever the wallet returns", async () => {
    const { authorization } = signable();
    const { provider } = fakeProvider(null);
    await expect(signAuthorization(provider, USDC_DOMAIN, authorization)).rejects.toThrow(
      /65-byte signature/,
    );
  });
});

describe("paymentHeader", () => {
  it("refuses to build a header for an unrecognised payee", () => {
    const other = "0x1111111111111111111111111111111111111111";
    const unrecognised = checkRequirements("token-price", BLUEAGENT.origin, withAccept({ payTo: other }));
    const auth: Authorization = {
      from: FROM,
      to: other,
      value: 10_000n,
      validAfter: 0n,
      validBefore: NOW + 180n,
      nonce: NONCE,
    };
    expect(() => paymentHeader(unrecognised, auth, SIGNATURE)).toThrow(/Nothing was paid/);
  });

  it("encodes a base64 envelope that mirrors the 402 and carries the signed authorization", () => {
    const reqs = requirements();
    const { authorization } = signable();
    const header = paymentHeader(reqs, authorization, SIGNATURE);
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf-8"));

    expect(decoded.x402Version).toBe(X402_VERSION);
    expect(decoded.scheme).toBe(SCHEME);
    expect(decoded.network).toBe(`eip155:${BASE.id}`);
    expect(decoded.accepted).toEqual({
      scheme: SCHEME,
      network: `eip155:${BASE.id}`,
      asset: USDC.address,
      amount: "10000",
      payTo: BLUEAGENT.knownPayTo,
      maxTimeoutSeconds: 120,
      extra: { name: "USD Coin", version: "2" },
    });
    expect(decoded.payload.signature).toBe(SIGNATURE);
    expect(decoded.payload.authorization).toEqual({
      from: authorization.from,
      to: authorization.to,
      value: "10000",
      validAfter: "0",
      validBefore: authorization.validBefore.toString(10),
      nonce: toHex(authorization.nonce),
    });
  });

  it("carries auth.to, not the requirements' payee address, so header and signature cannot diverge", () => {
    const reqs = requirements();
    const signedTo: Authorization = {
      from: FROM,
      to: BLUEAGENT.knownPayTo,
      value: 10_000n,
      validAfter: 0n,
      validBefore: NOW + 180n,
      nonce: NONCE,
    };
    const header = paymentHeader(reqs, signedTo, SIGNATURE);
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf-8"));
    expect(decoded.payload.authorization.to).toBe(signedTo.to);
  });
});

describe("signingSummary", () => {
  it("states the amount, the payee comparison, and the spendable window as plain sentences", () => {
    const reqs = requirements();
    const { authorization } = signable();
    const lines = signingSummary(reqs, authorization);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/Paying 0\.01 USDC on Base — 10000 base units exactly\./);
    expect(lines[1]).toContain(authorization.to);
    expect(lines[1]).toContain("token-price");
    expect(lines[2]).toMatch(/Spendable for 180 seconds, worthless after that\./);
  });

  it("reads the window off requirements.lifetimeSeconds, not validBefore - validAfter", () => {
    // validAfter is always 0, so validBefore - validAfter is the absolute epoch second —
    // about 1.8 billion here — not a duration. The summary must not compute it that way.
    const reqs = requirements();
    const { authorization } = signable();
    const lines = signingSummary(reqs, authorization);
    expect(lines[2]).not.toContain(authorization.validBefore.toString(10));
  });
});
