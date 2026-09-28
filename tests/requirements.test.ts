import { describe, expect, it } from "vitest";
import {
  authorizationFor,
  checkRequirements,
  MAX_TOOL_PRICE_BASE_UNITS,
  SUPPORTED_SCHEME,
  SUPPORTED_X402_VERSION,
  whyNotSign,
  type PaymentRequirements,
} from "@/lib/requirements";
import {
  authorizationDigest,
  encodeAuthorization,
  MAX_AUTHORIZATION_SECONDS,
  USDC_DOMAIN,
} from "@/lib/eip712";
import { BASE, USDC } from "@/config/chain";
import { BLUEAGENT } from "@/config/upstream";

/**
 * The 402 requirements check, against the bodies production actually sends.
 *
 * `LIVE` below is a **verbatim** copy of `GET https://blueagent.dev/api/x402/token-price`
 * measured on 2026-09-28 — not a shape invented to match the parser. That matters more
 * here than anywhere else in this repo: every field in it is an input to a signature
 * over real money, so a fixture that drifted from what upstream sends would let this
 * whole file pass while the production path signed something else.
 *
 * Two other paid ids (`wallet-risk` at 50000, `blue-audit` at 1000000) were measured the
 * same day and differ only in `amount`, which is why the fixture is one body plus
 * overrides rather than three copies.
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
} as const;

/** The live body with one requirement field replaced. Keeps every other field verbatim. */
function withAccept(patch: Record<string, unknown>): unknown {
  return { ...LIVE, accepts: [{ ...LIVE.accepts[0], ...patch }] };
}

/** The live body with a top-level envelope field replaced. */
function withEnvelope(patch: Record<string, unknown>): unknown {
  return { ...LIVE, ...patch };
}

const checked = () => checkRequirements("token-price", LIVE);

/** A signer address. An EIP-55 vector, so it is checksummed rather than merely well-shaped. */
const FROM = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

const NONCE = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

/** 2027-01-15T08:00:00Z, in seconds. A real instant, not a round number. */
const NOW = 1_800_000_000n;

describe("reading the live 402", () => {
  it("accepts the body production sends", () => {
    expect(() => checked()).not.toThrow();
  });

  it("carries the price as exact base units", () => {
    expect(checked().value).toBe(10_000n);
  });

  it("carries USDC with the decimals this repo verified, not any from upstream", () => {
    // The 402 has no `decimals` field at all — measured. So this can only have come
    // from config, which is the whole point of resolving the asset rather than reading it.
    expect(checked().asset).toBe(USDC);
    expect(checked().asset.decimals).toBe(6);
  });

  it("carries the tool id it was asked about, so a refusal can name it", () => {
    expect(checkRequirements("wallet-risk", withAccept({ amount: "50000" })).toolId).toBe(
      "wallet-risk",
    );
  });

  it("reads the settlement window upstream asks for rather than defaulting one", () => {
    // 120, not the 600 `DEFAULT_AUTHORIZATION_SECONDS` guesses. See the header.
    expect(checked().lifetimeSeconds).toBe(120n);
  });

  it("recognises the payee", () => {
    expect(checked().payee).toEqual({ kind: "known", address: BLUEAGENT.knownPayTo });
  });

  it("reads the other two measured prices too", () => {
    expect(checkRequirements("wallet-risk", withAccept({ amount: "50000" })).value).toBe(50_000n);
    expect(checkRequirements("blue-audit", withAccept({ amount: "1000000" })).value).toBe(
      1_000_000n,
    );
  });

  it("refuses a body that is not an object at all", () => {
    for (const body of [null, "402", 7, [LIVE]]) {
      expect(() => checkRequirements("token-price", body)).toThrow(/not a JSON object/);
    }
  });
});

describe("the envelope version", () => {
  it("is the version measured in production", () => {
    expect(SUPPORTED_X402_VERSION).toBe(2);
    expect(LIVE.x402Version).toBe(SUPPORTED_X402_VERSION);
  });

  it("refuses a version it has never read, naming both", () => {
    expect(() => checkRequirements("token-price", withEnvelope({ x402Version: 3 }))).toThrow(
      /x402 version 3, and this build reads version 2/,
    );
  });

  it("refuses a missing version rather than assuming the one it knows", () => {
    const { x402Version: _dropped, ...rest } = LIVE;
    expect(() => checkRequirements("token-price", rest)).toThrow(/x402 version undefined/);
  });

  it("refuses a version sent as a string, because 2 and \"2\" are different claims", () => {
    expect(() => checkRequirements("token-price", withEnvelope({ x402Version: "2" }))).toThrow(
      /x402 version "2"/,
    );
  });

  it("is checked before anything inside the envelope", () => {
    // Both the version and the chain are wrong; the version is what gets reported,
    // because under an unknown version the chain field's meaning is not established.
    const body = {
      ...LIVE,
      x402Version: 99,
      accepts: [{ ...LIVE.accepts[0], network: "eip155:1" }],
    };
    expect(() => checkRequirements("token-price", body)).toThrow(/x402 version 99/);
  });
});

describe("choosing how to pay", () => {
  it("refuses a 402 that names no way to pay it", () => {
    for (const accepts of [[], undefined, "exact", {}]) {
      expect(() => checkRequirements("token-price", withEnvelope({ accepts }))).toThrow(
        /named no way to pay it/,
      );
    }
  });

  it("⚠️ refuses to choose when upstream offers more than one, and says how many", () => {
    const second = { ...LIVE.accepts[0], amount: "20000" };
    expect(() =>
      checkRequirements("token-price", withEnvelope({ accepts: [LIVE.accepts[0], second] })),
    ).toThrow(/offered 2 ways to pay/);
  });

  it("does not silently take the first of several even when the first is fine", () => {
    // The first entry is the verbatim live one. Accepting it would be the bug.
    expect(() =>
      checkRequirements("token-price", withEnvelope({ accepts: [LIVE.accepts[0], { junk: 1 }] })),
    ).toThrow(/will not choose between them for you/);
  });

  it("refuses a requirement that is not an object", () => {
    expect(() => checkRequirements("token-price", withEnvelope({ accepts: [null] }))).toThrow(
      /not a JSON object/,
    );
  });
});

describe("the settlement scheme", () => {
  it("is the scheme measured in production", () => {
    expect(SUPPORTED_SCHEME).toBe("exact");
    expect(LIVE.accepts[0].scheme).toBe(SUPPORTED_SCHEME);
  });

  it("🔴 refuses any other scheme, because the same signature would mean something else", () => {
    expect(() => checkRequirements("token-price", withAccept({ scheme: "upto" }))).toThrow(
      /"upto" scheme, and this build only signs "exact"/,
    );
  });

  it("refuses a missing scheme", () => {
    expect(() => checkRequirements("token-price", withAccept({ scheme: undefined }))).toThrow(
      /no payment scheme/,
    );
  });

  it("refuses an empty scheme, which is not the same as `exact`", () => {
    expect(() => checkRequirements("token-price", withAccept({ scheme: "" }))).toThrow(
      /no payment scheme/,
    );
  });
});

describe("the chain", () => {
  it("reads the CAIP-2 form production sends", () => {
    expect(LIVE.accepts[0].network).toBe(`eip155:${BASE.id}`);
    expect(() => checked()).not.toThrow();
  });

  it("🔴 refuses another chain, naming it", () => {
    expect(() => checkRequirements("token-price", withAccept({ network: "eip155:1" }))).toThrow(
      /payment on chain 1, and this build signs only for Base \(8453\)/,
    );
  });

  it("refuses a bare chain id rather than guessing it means eip155", () => {
    expect(() => checkRequirements("token-price", withAccept({ network: "8453" }))).toThrow(
      /not the CAIP-2 form/,
    );
  });

  it("refuses a friendly chain name, even the right one", () => {
    // "base" is unambiguous to a human and is not a chain id. A lenient parse here
    // would be a guess about the one field that prevents cross-chain replay.
    expect(() => checkRequirements("token-price", withAccept({ network: "base" }))).toThrow(
      /not the CAIP-2 form/,
    );
  });

  it("refuses a namespace that is not eip155", () => {
    expect(() =>
      checkRequirements("token-price", withAccept({ network: "solana:8453" })),
    ).toThrow(/not the CAIP-2 form/);
  });

  it("refuses a missing network", () => {
    expect(() => checkRequirements("token-price", withAccept({ network: undefined }))).toThrow(
      /no network/,
    );
  });

  it("refuses a chain id with anything around it", () => {
    for (const network of ["eip155:8453 ", " eip155:8453", "eip155:8453:1", "eip155:"]) {
      expect(() => checkRequirements("token-price", withAccept({ network }))).toThrow(
        /not the CAIP-2 form/,
      );
    }
  });
});

describe("the asset", () => {
  it("resolves the address upstream sends to this repo's verified entry", () => {
    expect(checked().asset.address).toBe(USDC.address);
  });

  it("accepts the same address in any capitalisation", () => {
    // The constant is the check; a cosmetic case change upstream is not a typo, and
    // refusing it would reject the right token for the wrong reason. See `assertAsset`.
    for (const asset of [USDC.address.toLowerCase(), USDC.address.toUpperCase().replace("0X", "0x")]) {
      expect(checkRequirements("token-price", withAccept({ asset })).asset).toBe(USDC);
    }
  });

  it("🔴 refuses an asset whose decimals nothing here has verified", () => {
    expect(() =>
      checkRequirements(
        "token-price",
        withAccept({ asset: "0x4200000000000000000000000000000000000006" }),
      ),
    ).toThrow(/nothing to divide by/);
  });

  it("names the one asset it does know, so the refusal is actionable", () => {
    expect(() =>
      checkRequirements("token-price", withAccept({ asset: "0x" + "11".repeat(20) })),
    ).toThrow(new RegExp(`USDC at ${USDC.address}`));
  });

  it("refuses a missing asset", () => {
    expect(() => checkRequirements("token-price", withAccept({ asset: undefined }))).toThrow(
      /no asset address/,
    );
  });

  it("refuses something that is not an address, rather than answering \"different asset\"", () => {
    expect(() => checkRequirements("token-price", withAccept({ asset: "USDC" }))).toThrow();
  });
});

describe("the EIP-712 domain", () => {
  it("🔴 returns the domain from config, not one built from upstream's strings", () => {
    // Identity, not equality: nothing assembled a domain out of `extra`.
    expect(checked().domain).toBe(USDC_DOMAIN);
  });

  it("agrees with the values production sends", () => {
    expect(LIVE.accepts[0].extra).toEqual(USDC.eip712);
  });

  it("🔴 refuses a different version, because a deployed token's domain cannot change", () => {
    expect(() =>
      checkRequirements("token-price", withAccept({ extra: { name: "USD Coin", version: "3" } })),
    ).toThrow(/domain "USD Coin" version "3"/);
  });

  it("refuses a different name", () => {
    expect(() =>
      checkRequirements("token-price", withAccept({ extra: { name: "USDC", version: "2" } })),
    ).toThrow(/domain "USDC" version "2"/);
  });

  it("names what it expected, so a stale config can be told from a wrong upstream", () => {
    expect(() =>
      checkRequirements("token-price", withAccept({ extra: { name: "USDC", version: "2" } })),
    ).toThrow(/this build has "USD Coin" version "2" verified/);
  });

  it("refuses a missing extra block", () => {
    expect(() => checkRequirements("token-price", withAccept({ extra: undefined }))).toThrow(
      /EIP-712 domain fields that is not a JSON object/,
    );
  });

  it("refuses a missing name or version", () => {
    expect(() =>
      checkRequirements("token-price", withAccept({ extra: { version: "2" } })),
    ).toThrow(/no EIP-712 domain name/);
    expect(() =>
      checkRequirements("token-price", withAccept({ extra: { name: "USD Coin" } })),
    ).toThrow(/no EIP-712 domain version/);
  });
});

describe("the amount", () => {
  it("refuses anything that is not a whole number of base units", () => {
    for (const amount of ["1e4", " 10000", "10000 ", "0.01", "-10000", "10_000", ""]) {
      expect(() => checkRequirements("token-price", withAccept({ amount }))).toThrow();
    }
  });

  it("refuses a number, because upstream sends a string and a float would round", () => {
    expect(() => checkRequirements("token-price", withAccept({ amount: 10_000 }))).toThrow(
      /no amount/,
    );
  });

  it("🔴 refuses a price of zero rather than treating it as free", () => {
    expect(() => checkRequirements("token-price", withAccept({ amount: "0" }))).toThrow(
      /spend gas to move no money/,
    );
  });

  it("accepts exactly the cap", () => {
    expect(
      checkRequirements("token-price", withAccept({ amount: `${MAX_TOOL_PRICE_BASE_UNITS}` }))
        .value,
    ).toBe(MAX_TOOL_PRICE_BASE_UNITS);
  });

  it("🔴 refuses one base unit over the cap, and does not reduce it to fit", () => {
    expect(() =>
      checkRequirements("token-price", withAccept({ amount: `${MAX_TOOL_PRICE_BASE_UNITS + 1n}` })),
    ).toThrow(/Nothing was reduced to fit/);
  });

  it("sits comfortably above the most expensive tool measured", () => {
    // blue-audit, $1.00. The cap is anchored to that measurement, not picked.
    expect(MAX_TOOL_PRICE_BASE_UNITS).toBeGreaterThan(1_000_000n);
  });

  it("names the asset in the refusal, so 5000000 is not read as dollars", () => {
    expect(() =>
      checkRequirements("token-price", withAccept({ amount: "9999999999" })),
    ).toThrow(/base units of USDC/);
  });
});

describe("the settlement window", () => {
  it("refuses a window that is not a whole number of seconds", () => {
    for (const maxTimeoutSeconds of [undefined, "120", 120.5, 0, -120, Number.NaN, Infinity]) {
      expect(() => checkRequirements("token-price", withAccept({ maxTimeoutSeconds }))).toThrow(
        /not a whole number of seconds/,
      );
    }
  });

  it("accepts exactly the cap", () => {
    expect(
      checkRequirements(
        "token-price",
        withAccept({ maxTimeoutSeconds: Number(MAX_AUTHORIZATION_SECONDS) }),
      ).lifetimeSeconds,
    ).toBe(MAX_AUTHORIZATION_SECONDS);
  });

  it("🔴 refuses a longer window with the bearer-instrument reason", () => {
    expect(() =>
      checkRequirements(
        "token-price",
        withAccept({ maxTimeoutSeconds: Number(MAX_AUTHORIZATION_SECONDS) + 1 }),
      ),
    ).toThrow(/standing withdrawal permission rather than a payment/);
  });

  it("does not clamp a long window down to the cap", () => {
    // Clamping would sign a window that expires before upstream can settle, which
    // then reads as a bug in this app rather than as upstream asking for too much.
    expect(() =>
      checkRequirements("token-price", withAccept({ maxTimeoutSeconds: 86_400 })),
    ).toThrow();
  });
});

describe("the payee", () => {
  it("matches the known payee in any capitalisation", () => {
    const upper = `0x${BLUEAGENT.knownPayTo.slice(2).toUpperCase()}`;
    expect(checkRequirements("token-price", withAccept({ payTo: upper })).payee.kind).toBe("known");
  });

  it("⚠️ carries an unrecognised payee as a value, so the price still reads", () => {
    const other = "0x1111111111111111111111111111111111111111";
    const requirements = checkRequirements("token-price", withAccept({ payTo: other }));
    expect(requirements.payee.kind).toBe("unrecognised");
    // Everything else parsed, which is the point: this is readable, just not signable.
    expect(requirements.value).toBe(10_000n);
    expect(requirements.asset).toBe(USDC);
  });

  it("names both addresses, so a rotation can be told from a stale constant", () => {
    const other = "0x1111111111111111111111111111111111111111";
    const { payee } = checkRequirements("token-price", withAccept({ payTo: other }));
    expect(payee.kind === "unrecognised" && payee.why).toContain(other);
    expect(payee.kind === "unrecognised" && payee.why).toContain(BLUEAGENT.knownPayTo);
  });

  it("refuses a missing payee", () => {
    expect(() => checkRequirements("token-price", withAccept({ payTo: undefined }))).toThrow(
      /no payee/,
    );
  });

  it("refuses a malformed payee rather than calling it unrecognised", () => {
    // "not an address" and "a different account" must not look the same here.
    expect(() => checkRequirements("token-price", withAccept({ payTo: "0xdeadbeef" }))).toThrow();
  });

  it("is classified last, so a wrong chain is reported ahead of a rotation", () => {
    expect(() =>
      checkRequirements(
        "token-price",
        withAccept({ payTo: "0x1111111111111111111111111111111111111111", network: "eip155:1" }),
      ),
    ).toThrow(/payment on chain 1/);
  });
});

describe("whether it will be signed", () => {
  it("has nothing to say about the live requirements", () => {
    expect(whyNotSign(checked())).toBeNull();
  });

  it("refuses an unrecognised payee with the payee's own reason", () => {
    const requirements = checkRequirements(
      "token-price",
      withAccept({ payTo: "0x1111111111111111111111111111111111111111" }),
    );
    expect(whyNotSign(requirements)).toBe(
      requirements.payee.kind === "unrecognised" ? requirements.payee.why : null,
    );
  });
});

describe("the authorization and the digest", () => {
  const signable = () => authorizationFor(checked(), FROM, NOW, NONCE);

  it("pays the amount upstream asked for, to the payee upstream named", () => {
    const { authorization } = signable();
    expect(authorization.value).toBe(10_000n);
    expect(authorization.to).toBe(BLUEAGENT.knownPayTo);
    expect(authorization.from).toBe(FROM);
  });

  it("⚠️ signs validAfter 0, never the browser's clock", () => {
    expect(signable().authorization.validAfter).toBe(0n);
  });

  it("closes the window at upstream's own maxTimeoutSeconds past now", () => {
    expect(signable().authorization.validBefore).toBe(NOW + 120n);
  });

  it("uses the nonce it was given", () => {
    expect(signable().authorization.nonce).toBe(NONCE);
  });

  it("🔴 returns a digest over the authorization it returned, not a separate one", () => {
    const { authorization, digest } = signable();
    expect(digest).toBe(authorizationDigest(USDC_DOMAIN, authorization));
  });

  it("digests under the config domain, so the chain id is Base's", () => {
    const { authorization, digest } = signable();
    expect(digest).not.toBe(
      authorizationDigest({ ...USDC_DOMAIN, chainId: 1 }, authorization),
    );
  });

  it("encodes to the 224 bytes an EIP-3009 struct hash is taken over", () => {
    expect(encodeAuthorization(signable().authorization)).toHaveLength(224);
  });

  it("draws a fresh nonce when none is given, and a different one each time", () => {
    const first = authorizationFor(checked(), FROM, NOW).authorization.nonce;
    const second = authorizationFor(checked(), FROM, NOW).authorization.nonce;
    expect(first).toHaveLength(32);
    expect(Array.from(first)).not.toEqual(Array.from(second));
  });

  it("changes the digest when the nonce changes and nothing else does", () => {
    const other = Uint8Array.from({ length: 32 }, (_, i) => i + 2);
    expect(authorizationFor(checked(), FROM, NOW, other).digest).not.toBe(signable().digest);
  });

  it("🔴 refuses to sign to an unrecognised payee even when asked directly", () => {
    const requirements = checkRequirements(
      "token-price",
      withAccept({ payTo: "0x1111111111111111111111111111111111111111" }),
    );
    expect(() => authorizationFor(requirements, FROM, NOW, NONCE)).toThrow(/Nothing was signed/);
  });

  it("refuses a malformed signer, because `from` is hashed into the digest", () => {
    expect(() => authorizationFor(checked(), "0xnope", NOW, NONCE)).toThrow();
  });

  it("refuses a nonce that is not 32 bytes", () => {
    expect(() => authorizationFor(checked(), FROM, NOW, new Uint8Array(31))).toThrow(
      /exactly 32 bytes/,
    );
  });

  it("passes a millisecond clock through to the check that catches it", () => {
    expect(() => authorizationFor(checked(), FROM, BigInt(Date.now()) * 1000n, NONCE)).toThrow(
      /looks like milliseconds/,
    );
  });

  it("signs a window inside the cap even when upstream asks for the maximum", () => {
    const requirements: PaymentRequirements = {
      ...checked(),
      lifetimeSeconds: MAX_AUTHORIZATION_SECONDS,
    };
    expect(authorizationFor(requirements, FROM, NOW, NONCE).authorization.validBefore).toBe(
      NOW + MAX_AUTHORIZATION_SECONDS,
    );
  });
});
