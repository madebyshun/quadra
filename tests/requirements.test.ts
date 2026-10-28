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
  SETTLEMENT_SLACK_SECONDS,
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

const checked = () => checkRequirements("token-price", BLUEAGENT.origin, LIVE);

describe("what is kept for the payment header", () => {
  /** Echoed verbatim — see `PaymentRequirements.accepted` for why rebuilding it breaks payments. */
  it("keeps the chosen entry itself, extra fields and all", () => {
    const extraFields = { ...LIVE.accepts[0], currency: LIVE.accepts[0].asset, extra: { name: "USD Coin", version: "2", credentialTypes: ["authorization"] } };
    const r = checkRequirements("block-number", BLUEAGENT.origin, withEnvelope({ accepts: [extraFields] }));
    expect(r.accepted).toBe(extraFields);
    expect(r.passedOver).toBe(0);
  });

  it("keeps the 402's resource block, and nothing when it is absent or not an object", () => {
    expect(checked().resource).toBe(LIVE.resource);
    expect(checkRequirements("t", BLUEAGENT.origin, withEnvelope({ resource: undefined })).resource).toBeNull();
    expect(checkRequirements("t", BLUEAGENT.origin, withEnvelope({ resource: ["x"] })).resource).toBeNull();
    expect(checkRequirements("t", BLUEAGENT.origin, withEnvelope({ resource: null })).resource).toBeNull();
  });

  /** The x402 window passes a lookup that also knows the payees its user confirmed. */
  it("asks the lookup it is given, not only the built-in pins", () => {
    const origin = "https://elsewhere.example";
    const r = checkRequirements("t", origin, LIVE, (o) => (o === origin ? BLUEAGENT.knownPayTo : null));
    expect(r.payee.kind).toBe("known");
  });
});

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
    expect(checkRequirements("wallet-risk", BLUEAGENT.origin, withAccept({ amount: "50000" })).toolId).toBe(
      "wallet-risk",
    );
  });

  it("reads the settlement window upstream asks for rather than defaulting one", () => {
    // 120, not the 600 `DEFAULT_AUTHORIZATION_SECONDS` guesses. See the header.
    expect(checked().askedSeconds).toBe(120n);
  });

  it("signs a window past the ask, wide enough for a facilitator to settle", () => {
    // 120 + SETTLEMENT_SLACK_SECONDS (60). See the header on `assertWindow`.
    expect(checked().lifetimeSeconds).toBe(180n);
  });

  it("recognises the payee", () => {
    expect(checked().payee).toEqual({ kind: "known", address: BLUEAGENT.knownPayTo });
  });

  it("reads the other two measured prices too", () => {
    expect(checkRequirements("wallet-risk", BLUEAGENT.origin, withAccept({ amount: "50000" })).value).toBe(50_000n);
    expect(checkRequirements("blue-audit", BLUEAGENT.origin, withAccept({ amount: "1000000" })).value).toBe(
      1_000_000n,
    );
  });

  it("refuses a body that is not an object at all", () => {
    for (const body of [null, "402", 7, [LIVE]]) {
      expect(() => checkRequirements("token-price", BLUEAGENT.origin, body)).toThrow(/not a JSON object/);
    }
  });
});

describe("the envelope version", () => {
  it("is the version measured in production", () => {
    expect(SUPPORTED_X402_VERSION).toBe(2);
    expect(LIVE.x402Version).toBe(SUPPORTED_X402_VERSION);
  });

  it("refuses a version it has never read, naming both", () => {
    expect(() => checkRequirements("token-price", BLUEAGENT.origin, withEnvelope({ x402Version: 3 }))).toThrow(
      /x402 version 3, and this build reads version 2/,
    );
  });

  it("refuses a missing version rather than assuming the one it knows", () => {
    const { x402Version: _dropped, ...rest } = LIVE;
    expect(() => checkRequirements("token-price", BLUEAGENT.origin, rest)).toThrow(/x402 version undefined/);
  });

  it("refuses a version sent as a string, because 2 and \"2\" are different claims", () => {
    expect(() => checkRequirements("token-price", BLUEAGENT.origin, withEnvelope({ x402Version: "2" }))).toThrow(
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
    expect(() => checkRequirements("token-price", BLUEAGENT.origin, body)).toThrow(/x402 version 99/);
  });
});

describe("choosing how to pay", () => {
  it("refuses a 402 that names no way to pay it", () => {
    for (const accepts of [[], undefined, "exact", {}]) {
      expect(() => checkRequirements("token-price", BLUEAGENT.origin, withEnvelope({ accepts }))).toThrow(
        /named no way to pay it/,
      );
    }
  });

  it("⚠️ refuses to choose when upstream offers more than one, and says how many", () => {
    const second = { ...LIVE.accepts[0], amount: "20000" };
    expect(() =>
      checkRequirements("token-price", BLUEAGENT.origin, withEnvelope({ accepts: [LIVE.accepts[0], second] })),
    ).toThrow(/offered 2 ways to pay/);
  });

  /**
   * MEASURED 2026-09-29 from x402.ottoai.services (listed on Coinbase's Bazaar), with the
   * payee swapped for BlueAgent's so the pin applies: exact/EIP-3009 on Base, exact/permit2
   * on Base, exact on Solana. The real ecosystem offers several; the old "exactly one" rule
   * refused this whole server.
   */
  const OTTO_SHAPE = [
    { ...LIVE.accepts[0], amount: "1000", maxTimeoutSeconds: 300 },
    {
      ...LIVE.accepts[0],
      amount: "1000",
      maxTimeoutSeconds: 300,
      extra: { name: "USD Coin", version: "2", assetTransferMethod: "permit2" },
    },
    {
      scheme: "exact",
      network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      amount: "1000",
      asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      payTo: "6XcSfqJHr9vNW2vbiRaMqUYVm7shDgLepca54wUTDPN5",
      maxTimeoutSeconds: 300,
      extra: { feePayer: "D6ZhtNQ5nT9ZnTHUbqXZsTx5MH2rPFiBBggX4hY1WePM" },
    },
  ];

  it("takes the one offer this build can sign, and counts the ones it passed over", () => {
    const r = checkRequirements("crypto-news", BLUEAGENT.origin, withEnvelope({ accepts: OTTO_SHAPE }));
    expect(r.value).toBe(1000n);
    expect(r.passedOver).toBe(2);
    expect(r.accepted).toBe(OTTO_SHAPE[0]);
  });

  /** Position is not the rule: the signable entry wins wherever it sits, junk before it included. */
  it("finds the signable offer wherever it is in the list, not by taking the first", () => {
    const shuffled = [OTTO_SHAPE[2], { junk: 1 }, OTTO_SHAPE[1], OTTO_SHAPE[0]];
    const r = checkRequirements("crypto-news", BLUEAGENT.origin, withEnvelope({ accepts: shuffled }));
    expect(r.accepted).toBe(OTTO_SHAPE[0]);
    expect(r.passedOver).toBe(3);
  });

  it("refuses when several are offered and none can be signed, naming what was offered", () => {
    expect(() =>
      checkRequirements(
        "crypto-news", BLUEAGENT.origin,
        withEnvelope({ accepts: [OTTO_SHAPE[1], OTTO_SHAPE[2], null, { scheme: 7 }] }),
      ),
    ).toThrow(/offered 4 ways to pay and this build can sign none of them.*exact on eip155:8453, exact on solana:.*\? on \?, \? on \?/);
  });

  it("does not silently take the first of two it COULD sign", () => {
    // The first entry is the verbatim live one. Accepting it would be the bug.
    expect(() =>
      checkRequirements(
        "token-price", BLUEAGENT.origin,
        withEnvelope({ accepts: [LIVE.accepts[0], { ...LIVE.accepts[0], payTo: "0x1111111111111111111111111111111111111111" }] }),
      ),
    ).toThrow(/2 ways to pay that this build could sign.*will not choose between them for you/);
  });

  /** A lone permit2 entry goes through the field checks, so the refusal names the method. */
  it("refuses a single permit2 offer by name rather than signing EIP-3009 against it", () => {
    expect(() => checkRequirements("crypto-news", BLUEAGENT.origin, withEnvelope({ accepts: [OTTO_SHAPE[1]] }))).toThrow(
      /through "permit2".*signs only EIP-3009/,
    );
  });

  it("accepts an explicit eip3009 method as the same as saying nothing", () => {
    const r = checkRequirements(
      "token-price", BLUEAGENT.origin,
      withAccept({ extra: { name: "USD Coin", version: "2", assetTransferMethod: "eip3009" } }),
    );
    expect(r.value).toBe(10_000n);
  });

  it("refuses a requirement that is not an object", () => {
    expect(() => checkRequirements("token-price", BLUEAGENT.origin, withEnvelope({ accepts: [null] }))).toThrow(
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
    expect(() => checkRequirements("token-price", BLUEAGENT.origin, withAccept({ scheme: "upto" }))).toThrow(
      /"upto" scheme, and this build only signs "exact"/,
    );
  });

  it("refuses a missing scheme", () => {
    expect(() => checkRequirements("token-price", BLUEAGENT.origin, withAccept({ scheme: undefined }))).toThrow(
      /no payment scheme/,
    );
  });

  it("refuses an empty scheme, which is not the same as `exact`", () => {
    expect(() => checkRequirements("token-price", BLUEAGENT.origin, withAccept({ scheme: "" }))).toThrow(
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
    expect(() => checkRequirements("token-price", BLUEAGENT.origin, withAccept({ network: "eip155:1" }))).toThrow(
      /payment on chain 1, and this build signs only for Base \(8453\)/,
    );
  });

  it("refuses a bare chain id rather than guessing it means eip155", () => {
    expect(() => checkRequirements("token-price", BLUEAGENT.origin, withAccept({ network: "8453" }))).toThrow(
      /not the CAIP-2 form/,
    );
  });

  it("refuses a friendly chain name, even the right one", () => {
    // "base" is unambiguous to a human and is not a chain id. A lenient parse here
    // would be a guess about the one field that prevents cross-chain replay.
    expect(() => checkRequirements("token-price", BLUEAGENT.origin, withAccept({ network: "base" }))).toThrow(
      /not the CAIP-2 form/,
    );
  });

  it("refuses a namespace that is not eip155", () => {
    expect(() =>
      checkRequirements("token-price", BLUEAGENT.origin, withAccept({ network: "solana:8453" })),
    ).toThrow(/not the CAIP-2 form/);
  });

  it("refuses a missing network", () => {
    expect(() => checkRequirements("token-price", BLUEAGENT.origin, withAccept({ network: undefined }))).toThrow(
      /no network/,
    );
  });

  it("refuses a chain id with anything around it", () => {
    for (const network of ["eip155:8453 ", " eip155:8453", "eip155:8453:1", "eip155:"]) {
      expect(() => checkRequirements("token-price", BLUEAGENT.origin, withAccept({ network }))).toThrow(
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
      expect(checkRequirements("token-price", BLUEAGENT.origin, withAccept({ asset })).asset).toBe(USDC);
    }
  });

  it("🔴 refuses an asset whose decimals nothing here has verified", () => {
    expect(() =>
      checkRequirements(
        "token-price", BLUEAGENT.origin,
        withAccept({ asset: "0x4200000000000000000000000000000000000006" }),
      ),
    ).toThrow(/nothing to divide by/);
  });

  it("names the one asset it does know, so the refusal is actionable", () => {
    expect(() =>
      checkRequirements("token-price", BLUEAGENT.origin, withAccept({ asset: "0x" + "11".repeat(20) })),
    ).toThrow(new RegExp(`USDC at ${USDC.address}`));
  });

  it("refuses a missing asset", () => {
    expect(() => checkRequirements("token-price", BLUEAGENT.origin, withAccept({ asset: undefined }))).toThrow(
      /no asset address/,
    );
  });

  it("refuses something that is not an address, rather than answering \"different asset\"", () => {
    expect(() => checkRequirements("token-price", BLUEAGENT.origin, withAccept({ asset: "USDC" }))).toThrow();
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
      checkRequirements("token-price", BLUEAGENT.origin, withAccept({ extra: { name: "USD Coin", version: "3" } })),
    ).toThrow(/domain "USD Coin" version "3"/);
  });

  it("refuses a different name", () => {
    expect(() =>
      checkRequirements("token-price", BLUEAGENT.origin, withAccept({ extra: { name: "USDC", version: "2" } })),
    ).toThrow(/domain "USDC" version "2"/);
  });

  it("names what it expected, so a stale config can be told from a wrong upstream", () => {
    expect(() =>
      checkRequirements("token-price", BLUEAGENT.origin, withAccept({ extra: { name: "USDC", version: "2" } })),
    ).toThrow(/this build has "USD Coin" version "2" verified/);
  });

  it("refuses a missing extra block", () => {
    expect(() => checkRequirements("token-price", BLUEAGENT.origin, withAccept({ extra: undefined }))).toThrow(
      /EIP-712 domain fields that is not a JSON object/,
    );
  });

  it("refuses a missing name or version", () => {
    expect(() =>
      checkRequirements("token-price", BLUEAGENT.origin, withAccept({ extra: { version: "2" } })),
    ).toThrow(/no EIP-712 domain name/);
    expect(() =>
      checkRequirements("token-price", BLUEAGENT.origin, withAccept({ extra: { name: "USD Coin" } })),
    ).toThrow(/no EIP-712 domain version/);
  });
});

describe("the amount", () => {
  it("refuses anything that is not a whole number of base units", () => {
    for (const amount of ["1e4", " 10000", "10000 ", "0.01", "-10000", "10_000", ""]) {
      expect(() => checkRequirements("token-price", BLUEAGENT.origin, withAccept({ amount }))).toThrow();
    }
  });

  it("refuses a number, because upstream sends a string and a float would round", () => {
    expect(() => checkRequirements("token-price", BLUEAGENT.origin, withAccept({ amount: 10_000 }))).toThrow(
      /no amount/,
    );
  });

  it("🔴 refuses a price of zero rather than treating it as free", () => {
    expect(() => checkRequirements("token-price", BLUEAGENT.origin, withAccept({ amount: "0" }))).toThrow(
      /spend gas to move no money/,
    );
  });

  it("accepts exactly the cap", () => {
    expect(
      checkRequirements("token-price", BLUEAGENT.origin, withAccept({ amount: `${MAX_TOOL_PRICE_BASE_UNITS}` }))
        .value,
    ).toBe(MAX_TOOL_PRICE_BASE_UNITS);
  });

  it("🔴 refuses one base unit over the cap, and does not reduce it to fit", () => {
    expect(() =>
      checkRequirements("token-price", BLUEAGENT.origin, withAccept({ amount: `${MAX_TOOL_PRICE_BASE_UNITS + 1n}` })),
    ).toThrow(/Nothing was reduced to fit/);
  });

  it("sits comfortably above the most expensive tool measured", () => {
    // blue-audit, $1.00. The cap is anchored to that measurement, not picked.
    expect(MAX_TOOL_PRICE_BASE_UNITS).toBeGreaterThan(1_000_000n);
  });

  it("names the asset in the refusal, so 5000000 is not read as dollars", () => {
    expect(() =>
      checkRequirements("token-price", BLUEAGENT.origin, withAccept({ amount: "9999999999" })),
    ).toThrow(/base units of USDC/);
  });
});

describe("the settlement window", () => {
  it("refuses a window that is not a whole number of seconds", () => {
    for (const maxTimeoutSeconds of [undefined, "120", 120.5, 0, -120, Number.NaN, Infinity]) {
      expect(() => checkRequirements("token-price", BLUEAGENT.origin, withAccept({ maxTimeoutSeconds }))).toThrow(
        /not a whole number of seconds/,
      );
    }
  });

  it("accepts an ask that lands exactly on the cap once slack is added", () => {
    const askedSeconds = MAX_AUTHORIZATION_SECONDS - SETTLEMENT_SLACK_SECONDS;
    expect(
      checkRequirements(
        "token-price", BLUEAGENT.origin,
        withAccept({ maxTimeoutSeconds: Number(askedSeconds) }),
      ).lifetimeSeconds,
    ).toBe(MAX_AUTHORIZATION_SECONDS);
  });

  it("🔴 refuses an ask whose signed window lands past the cap", () => {
    const askedSeconds = MAX_AUTHORIZATION_SECONDS - SETTLEMENT_SLACK_SECONDS + 1n;
    expect(() =>
      checkRequirements("token-price", BLUEAGENT.origin, withAccept({ maxTimeoutSeconds: Number(askedSeconds) })),
    ).toThrow(/standing withdrawal permission rather than a payment/);
  });

  it("does not clamp a long window down to the cap", () => {
    // Clamping would sign a window that expires before upstream can settle, which
    // then reads as a bug in this app rather than as upstream asking for too much.
    expect(() =>
      checkRequirements("token-price", BLUEAGENT.origin, withAccept({ maxTimeoutSeconds: 86_400 })),
    ).toThrow();
  });
});

describe("the payee", () => {
  it("matches the known payee in any capitalisation", () => {
    const upper = `0x${BLUEAGENT.knownPayTo.slice(2).toUpperCase()}`;
    expect(checkRequirements("token-price", BLUEAGENT.origin, withAccept({ payTo: upper })).payee.kind).toBe("known");
  });

  it("⚠️ carries an unrecognised payee as a value, so the price still reads", () => {
    const other = "0x1111111111111111111111111111111111111111";
    const requirements = checkRequirements("token-price", BLUEAGENT.origin, withAccept({ payTo: other }));
    expect(requirements.payee.kind).toBe("unrecognised");
    // Everything else parsed, which is the point: this is readable, just not signable.
    expect(requirements.value).toBe(10_000n);
    expect(requirements.asset).toBe(USDC);
  });

  it("names both addresses, so a rotation can be told from a stale constant", () => {
    const other = "0x1111111111111111111111111111111111111111";
    const { payee } = checkRequirements("token-price", BLUEAGENT.origin, withAccept({ payTo: other }));
    expect(payee.kind === "unrecognised" && payee.why).toContain(other);
    expect(payee.kind === "unrecognised" && payee.why).toContain(BLUEAGENT.knownPayTo);
  });

  /**
   * The pin belongs to the ORIGIN that sent the 402, not to the payee address or to a
   * directory name. The same payee, answered from a different origin, is not "known":
   * this build has no record of who that origin is paid to. That is the property that
   * lets the checker serve any x402 endpoint without trusting any of them by default.
   */
  it("calls a payee unpinned when its origin has no pin, even if the address is familiar", () => {
    const { payee } = checkRequirements("token-price", "https://elsewhere.example", LIVE);
    expect(payee.kind).toBe("unpinned");
    expect(payee.kind === "unpinned" && payee.why).toContain("https://elsewhere.example");
    expect(payee.kind === "unpinned" && payee.why).toContain(BLUEAGENT.knownPayTo);
  });

  it("names the pinned payee's origin when the address has changed", () => {
    const { payee } = checkRequirements(
      "token-price", BLUEAGENT.origin,
      withAccept({ payTo: "0x1111111111111111111111111111111111111111" }),
    );
    expect(payee.kind === "unrecognised" && payee.why).toContain(BLUEAGENT.origin);
  });

  it("refuses a missing payee", () => {
    expect(() => checkRequirements("token-price", BLUEAGENT.origin, withAccept({ payTo: undefined }))).toThrow(
      /no payee/,
    );
  });

  it("refuses a malformed payee rather than calling it unrecognised", () => {
    // "not an address" and "a different account" must not look the same here.
    expect(() => checkRequirements("token-price", BLUEAGENT.origin, withAccept({ payTo: "0xdeadbeef" }))).toThrow();
  });

  it("is classified last, so a wrong chain is reported ahead of a rotation", () => {
    expect(() =>
      checkRequirements(
        "token-price", BLUEAGENT.origin,
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
      "token-price", BLUEAGENT.origin,
      withAccept({ payTo: "0x1111111111111111111111111111111111111111" }),
    );
    expect(whyNotSign(requirements)).toBe(
      requirements.payee.kind === "unrecognised" ? requirements.payee.why : null,
    );
  });
});

describe("an origin nobody pinned", () => {
  const unpinned = () => checkRequirements("token-price", "https://elsewhere.example", LIVE);

  it("reads the price but will not sign it", () => {
    expect(unpinned().value).toBe(10_000n);
    expect(whyNotSign(unpinned())).toMatch(/no record of who https:\/\/elsewhere\.example gets paid to/);
  });

  it("refuses to build an authorization for it at all", () => {
    expect(() => authorizationFor(unpinned(), FROM, NOW, NONCE)).toThrow(/Nothing was signed/);
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

  it("closes the window past upstream's own maxTimeoutSeconds, with slack added", () => {
    expect(signable().authorization.validBefore).toBe(NOW + 120n + SETTLEMENT_SLACK_SECONDS);
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
      "token-price", BLUEAGENT.origin,
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
