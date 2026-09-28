import { describe, expect, it } from "vitest";
import { BASE, USDC } from "@/config/chain";
import { encodeWords } from "@/lib/abi";
import {
  AUTHORIZATION_TYPE,
  AUTHORIZATION_TYPEHASH,
  DEFAULT_AUTHORIZATION_SECONDS,
  DOMAIN_TYPE,
  DOMAIN_TYPEHASH,
  MAX_AUTHORIZATION_SECONDS,
  USDC_DOMAIN,
  authorizationDigest,
  authorizationStructHash,
  domainSeparator,
  encodeAuthorization,
  encodeDomain,
  randomNonce,
  typeHash,
  validityWindow,
  type Authorization,
  type Eip712Domain,
} from "@/lib/eip712";
import { toHex } from "@/lib/keccak";

/** A 256-bit value as the `0x` + 64 hex characters `cast` prints. */
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;

const bytesFromHex = (hex: string) =>
  Uint8Array.from(
    (hex.replace(/^0x/, "").match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16)),
  );

/**
 * ── Every literal below came out of `cast` on 2026-09-27. ─────────────────────
 *
 * Not one of them is recalled, and none is a hex constant the source also contains:
 * `lib/eip712.ts` derives its typehashes from the type strings at module load, so these
 * are an independent second opinion rather than a copy of the same number twice.
 * Hard rule 9 is about exactly this — a constant nobody can check is worse than no
 * constant, and keccak's oracle is a shell command away.
 */
const CAST = {
  /** cast keccak $(cast from-utf8 'EIP712Domain(string name,…)') */
  domainTypehash: "0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f",
  /** cast keccak $(cast from-utf8 'TransferWithAuthorization(address from,…)') */
  authorizationTypehash:
    "0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267",
  /** cast keccak $(cast from-utf8 'USD Coin') */
  nameHash: "0x52878b207aaddbfc15ea7bebcda681eb8ccd306e2227b61cef68505c8c056341",
  /** cast keccak $(cast from-utf8 '2') */
  versionHash: "0xad7c5bef027816a800da1736444fb58a807ef4c9603b7848673f7e3a68eb14a5",
  /** cast abi-encode 'f(bytes32,bytes32,bytes32,uint256,address)' … 8453 <usdc> */
  domainEncoding:
    "0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f" +
    "52878b207aaddbfc15ea7bebcda681eb8ccd306e2227b61cef68505c8c056341" +
    "ad7c5bef027816a800da1736444fb58a807ef4c9603b7848673f7e3a68eb14a5" +
    "0000000000000000000000000000000000000000000000000000000000002105" +
    "000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  /**
   * 🔴 The closed loop, and the single most valuable assertion in this file:
   *
   *   cast call 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
   *     'DOMAIN_SEPARATOR()(bytes32)' --rpc-url https://mainnet.base.org
   *
   * returns this, and so does `domainSeparator(USDC_DOMAIN)` computed from
   * `src/config/chain.ts`. One equality verifying the struct shape, the string
   * hashing, the name, the version, the chain id and the token address — against a
   * contract nobody in this repo controls.
   */
  usdcSeparator: "0x02fa7265e7c5d81118673727957699e4d68f74cd74b7db77da710fe8a2c7834f",
  /** The same domain with chainId 1. Included to show the separator is chain-bound. */
  separatorOnChainId1:
    "0x694129c9b89b1537857edfc2b9fdde704cbbbc502a56579e7881168cafa69df0",
  /** cast abi-encode of the seven authorization words, for AUTH below. */
  authorizationEncoding:
    "0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267" +
    "0000000000000000000000005aaeb6053f3e94c9b9a09f33669435e7ef1beaed" +
    "000000000000000000000000fb6916095ca1df60bb79ce92ce3ea74c37c5d359" +
    "000000000000000000000000000000000000000000000000000000000000c350" +
    "0000000000000000000000000000000000000000000000000000000000000000" +
    "000000000000000000000000000000000000000000000000000000006b49d200" +
    "d3b07384d113edec49eaa6238ad5ff00d3b07384d113edec49eaa6238ad5ff00",
  /** cast keccak of the line above. */
  structHash: "0x0cec5a31a4d8836ff14d6e9df27ba0545527db4bad1d1e0f2d25eb5df93c6854",
  /** cast keccak 0x1901 ‖ usdcSeparator ‖ structHash */
  digest: "0x770c97d34f47a55aaeddc858d2ce51d998edce2c5a93855154cde3ff3e7b18ea",
  /** The same authorization under chainId 1 — a different digest, from a different domain. */
  digestOnChainId1: "0xf5f8ffa0204b1548c4cf241165e4e8e5ca67d5cccf940c967328b257e1a67bc8",
} as const;

/**
 * The authorization every vector above was measured against.
 *
 * Both addresses are EIP-55 vectors, so they are checksummed rather than merely
 * well-shaped — `addressToUint` would refuse a contradicted one, and a fixture that
 * dodged that check would leave the integration untested.
 *
 * `value` is 50000, which is 0.05 USDC at six decimals: the price of a real cheap
 * x402 call, so the vector is about the transaction this app actually makes.
 */
const AUTH: Authorization = {
  from: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  to: "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
  value: 50_000n,
  validAfter: 0n,
  validBefore: 1_800_000_000n,
  nonce: bytesFromHex("d3b07384d113edec49eaa6238ad5ff00d3b07384d113edec49eaa6238ad5ff00"),
};

describe("the type strings, and the hashes derived from them", () => {
  it("hashes the domain type to what cast says", () => {
    expect(word(DOMAIN_TYPEHASH)).toBe(CAST.domainTypehash);
  });

  it("hashes the authorization type to what cast says", () => {
    expect(word(AUTHORIZATION_TYPEHASH)).toBe(CAST.authorizationTypehash);
  });

  /**
   * ⚠️ The type strings are pinned as text as well as by their hashes. A typehash
   * assertion alone cannot say *which* character moved, and this is the one place a
   * plausible-looking edit — `uint256 chainID`, or a space after a comma — changes
   * everything downstream while reading correctly to a human.
   */
  it("spells the member lists exactly, with no spaces after the commas", () => {
    expect(DOMAIN_TYPE).toBe(
      "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
    );
    expect(AUTHORIZATION_TYPE).toBe(
      "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter," +
        "uint256 validBefore,bytes32 nonce)",
    );
    expect(DOMAIN_TYPE).not.toContain(", ");
    expect(AUTHORIZATION_TYPE).not.toContain(", ");
  });

  /**
   * That whitespace sensitivity, asserted rather than described. One extra space is
   * the difference between a signature a contract accepts and one it does not, and
   * nothing about the two strings looks different at a glance.
   */
  it("gives a different typehash for a member list with one space added", () => {
    expect(typeHash(AUTHORIZATION_TYPE.replaceAll(",", ", "))).not.toBe(
      AUTHORIZATION_TYPEHASH,
    );
  });

  it("derives the typehashes rather than tabulating them", () => {
    expect(typeHash(DOMAIN_TYPE)).toBe(DOMAIN_TYPEHASH);
    expect(typeHash(AUTHORIZATION_TYPE)).toBe(AUTHORIZATION_TYPEHASH);
  });
});

describe("encoding the domain", () => {
  it("is 160 bytes: five static words", () => {
    expect(encodeDomain(USDC_DOMAIN).length).toBe(160);
  });

  /**
   * ⚠️ `name` and `version` are hashed, not inlined. The length above already rules
   * inlining out — "USD Coin" cannot fit a word — and this pins the two hashes
   * individually so a failure says which string is wrong.
   */
  it("hashes the strings instead of writing them inline", () => {
    const encoded = toHex(encodeDomain(USDC_DOMAIN));
    expect(encoded.slice(2 + 64, 2 + 128)).toBe(CAST.nameHash.slice(2));
    expect(encoded.slice(2 + 128, 2 + 192)).toBe(CAST.versionHash.slice(2));
  });

  it("matches cast's abi-encode byte for byte", () => {
    expect(toHex(encodeDomain(USDC_DOMAIN))).toBe(CAST.domainEncoding);
  });

  it("puts the chain id in the fourth word and the contract in the fifth", () => {
    const encoded = toHex(encodeDomain(USDC_DOMAIN));
    expect(encoded.slice(2 + 192, 2 + 256)).toBe(word(8453n).slice(2));
    expect(encoded.slice(2 + 256)).toBe(USDC.address.toLowerCase().slice(2).padStart(64, "0"));
  });
});

describe("the USDC domain separator", () => {
  /**
   * 🔴 This is the test the whole file exists for. `USDC_DOMAIN` is assembled from
   * `src/config/chain.ts`, so this compares the repo's own configuration against the
   * deployed contract's answer. Change `USDC.address`, `USDC.eip712.name`,
   * `USDC.eip712.version` or `BASE.id` and this fails — which is correct, because
   * every one of those edits changes what a signature authorizes.
   *
   * Re-measure with:
   *   cast call 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
   *     'DOMAIN_SEPARATOR()(bytes32)' --rpc-url https://mainnet.base.org
   */
  it("equals the DOMAIN_SEPARATOR the deployed contract on Base reports", () => {
    expect(word(domainSeparator(USDC_DOMAIN))).toBe(CAST.usdcSeparator);
  });

  it("is built from the config rather than written out again", () => {
    expect(USDC_DOMAIN).toEqual({
      name: USDC.eip712.name,
      version: USDC.eip712.version,
      chainId: BASE.id,
      verifyingContract: USDC.address,
    });
    expect(USDC_DOMAIN.chainId).toBe(8453);
  });

  /**
   * 🔴 The replay property, as an assertion. The only difference between these two
   * domains is the chain id, and a signature made over one is worthless against the
   * other — which is what EIP-712's domain is for. Pinned against a `cast`-measured
   * value rather than merely asserted to differ, so it also proves the chain id lands
   * in the word the standard puts it in.
   */
  it("changes completely when only the chain id changes", () => {
    const elsewhere: Eip712Domain = { ...USDC_DOMAIN, chainId: 1 };
    expect(word(domainSeparator(elsewhere))).toBe(CAST.separatorOnChainId1);
    expect(domainSeparator(elsewhere)).not.toBe(domainSeparator(USDC_DOMAIN));
  });

  it("changes when the verifying contract changes", () => {
    const other: Eip712Domain = {
      ...USDC_DOMAIN,
      verifyingContract: "0x4200000000000000000000000000000000000006",
    };
    expect(domainSeparator(other)).not.toBe(domainSeparator(USDC_DOMAIN));
  });

  it.each([
    ["name", { name: "USD coin" }],
    ["version", { version: "1" }],
  ])("changes when the %s changes by one character", (_label, patch) => {
    expect(domainSeparator({ ...USDC_DOMAIN, ...patch })).not.toBe(
      domainSeparator(USDC_DOMAIN),
    );
  });

  it("refuses a chain id that is not a positive integer", () => {
    for (const chainId of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => domainSeparator({ ...USDC_DOMAIN, chainId }), `${chainId}`).toThrow(
        /is not a chain id/,
      );
    }
  });

  it("says why a chain id matters when it refuses one", () => {
    expect(() => domainSeparator({ ...USDC_DOMAIN, chainId: 0 })).toThrow(/replayed/);
  });
});

describe("encoding the authorization", () => {
  it("is 224 bytes: the typehash plus six members", () => {
    expect(encodeAuthorization(AUTH).length).toBe(224);
  });

  it("matches cast's abi-encode byte for byte", () => {
    expect(toHex(encodeAuthorization(AUTH))).toBe(CAST.authorizationEncoding);
  });

  it("hashes to what cast hashes that encoding to", () => {
    expect(word(authorizationStructHash(AUTH))).toBe(CAST.structHash);
  });

  /**
   * The member order is the standard's, and swapping two same-typed members is the
   * mistake that produces a well-formed authorization for the wrong direction of
   * payment. `from` and `to` are both addresses, so nothing but this catches it.
   */
  it("distinguishes paying from A to B from paying B to A", () => {
    const reversed: Authorization = { ...AUTH, from: AUTH.to, to: AUTH.from };
    expect(authorizationStructHash(reversed)).not.toBe(authorizationStructHash(AUTH));
  });

  it("puts the nonce in the last word, unpadded and unaltered", () => {
    expect(toHex(encodeAuthorization(AUTH)).slice(2 + 6 * 64)).toBe(
      toHex(AUTH.nonce).slice(2),
    );
  });

  it("refuses a nonce that is not 32 bytes", () => {
    expect(() =>
      encodeAuthorization({ ...AUTH, nonce: new Uint8Array(31) }),
    ).toThrow(/nonce must be exactly 32 bytes/);
  });

  it.each(["value", "validAfter", "validBefore"] as const)(
    "refuses a negative %s, which has no uint256 encoding",
    (field) => {
      expect(() => encodeAuthorization({ ...AUTH, [field]: -1n })).toThrow(
        new RegExp(`^${field} is -1`),
      );
    },
  );

  /**
   * The EIP-55 check reaches this far: a contradicted checksum in either address
   * throws before anything is hashed. Without it, a mistyped recipient would produce
   * a perfectly valid signature paying a stranger.
   */
  it.each(["from", "to"] as const)("refuses a contradicted checksum in %s", (field) => {
    const typo = "0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
    expect(() => encodeAuthorization({ ...AUTH, [field]: typo })).toThrow(
      /EIP-55 checksum/,
    );
  });

  it("accepts a lowercase address, because that is what explorers hand out", () => {
    expect(() =>
      encodeAuthorization({ ...AUTH, to: AUTH.to.toLowerCase() }),
    ).not.toThrow();
    expect(authorizationStructHash({ ...AUTH, to: AUTH.to.toLowerCase() })).toBe(
      authorizationStructHash(AUTH),
    );
  });
});

describe("the digest a wallet signs", () => {
  it("matches the digest cast builds from the same three pieces", () => {
    expect(word(authorizationDigest(USDC_DOMAIN, AUTH))).toBe(CAST.digest);
  });

  /**
   * ⚠️ 66 bytes: two prefix bytes and two words. Asserted by rebuilding the preimage
   * here, because the mistake this guards is concatenating hex *strings* — which gives
   * a 130-byte preimage and a digest that is stable, plausible and accepted by nothing.
   */
  it("hashes exactly 66 bytes, prefixed with 0x1901", () => {
    const body = encodeWords([
      domainSeparator(USDC_DOMAIN),
      authorizationStructHash(AUTH),
    ]);
    const preimage = new Uint8Array(2 + body.length);
    preimage[0] = 0x19;
    preimage[1] = 0x01;
    preimage.set(body, 2);
    expect(preimage.length).toBe(66);
    expect(toHex(preimage)).toBe(
      `0x1901${CAST.usdcSeparator.slice(2)}${CAST.structHash.slice(2)}`,
    );
  });

  /**
   * 🔴 The domain is not decoration. The same authorization, byte for byte, yields a
   * different digest on a different chain — so a signature cannot be lifted from Base
   * onto anywhere else. Both values are `cast`-measured.
   */
  it("is different on another chain, from the same authorization", () => {
    const digest = authorizationDigest({ ...USDC_DOMAIN, chainId: 1 }, AUTH);
    expect(word(digest)).toBe(CAST.digestOnChainId1);
    expect(digest).not.toBe(authorizationDigest(USDC_DOMAIN, AUTH));
  });

  it.each([
    ["value", { value: 50_001n }],
    ["validBefore", { validBefore: 1_800_000_001n }],
    ["validAfter", { validAfter: 1n }],
  ])("changes when %s moves by one", (_label, patch) => {
    expect(authorizationDigest(USDC_DOMAIN, { ...AUTH, ...patch })).not.toBe(
      authorizationDigest(USDC_DOMAIN, AUTH),
    );
  });

  it("changes when the nonce changes, so one authorization is one slip", () => {
    expect(
      authorizationDigest(USDC_DOMAIN, { ...AUTH, nonce: randomNonce() }),
    ).not.toBe(authorizationDigest(USDC_DOMAIN, AUTH));
  });

  it("is deterministic for the same inputs", () => {
    expect(authorizationDigest(USDC_DOMAIN, AUTH)).toBe(
      authorizationDigest(USDC_DOMAIN, AUTH),
    );
  });

  it("fits 256 bits", () => {
    expect(authorizationDigest(USDC_DOMAIN, AUTH)).toBeLessThan(1n << 256n);
  });
});

describe("drawing a nonce", () => {
  it("is 32 bytes", () => {
    expect(randomNonce().length).toBe(32);
  });

  /**
   * ⚠️ This is a smoke test, not a test of randomness — a unit test cannot assert
   * that. What it can catch is the failure that matters here: a nonce generator that
   * returns a constant, a zero buffer, or a counter. Any of those makes the second
   * authorization of a session silently unspendable.
   */
  it("does not return the same bytes twice", () => {
    const draws = new Set(Array.from({ length: 64 }, () => toHex(randomNonce())));
    expect(draws.size).toBe(64);
  });

  it("is never all zeros across many draws", () => {
    const zero = toHex(new Uint8Array(32));
    for (let i = 0; i < 64; i++) expect(toHex(randomNonce())).not.toBe(zero);
  });

  it("produces something encodeAuthorization accepts", () => {
    expect(() => encodeAuthorization({ ...AUTH, nonce: randomNonce() })).not.toThrow();
  });
});

describe("the validity window", () => {
  const NOW = 1_800_000_000n;

  it("opens at zero and closes ten minutes out by default", () => {
    expect(validityWindow(NOW)).toEqual({
      validAfter: 0n,
      validBefore: NOW + DEFAULT_AUTHORIZATION_SECONDS,
    });
    expect(DEFAULT_AUTHORIZATION_SECONDS).toBe(600n);
  });

  /**
   * ⚠️ `validAfter` is 0 on purpose. A lower bound taken from the browser's clock buys
   * nothing — `validBefore` already closes the window — and costs a real failure: a
   * clock a few seconds fast produces an authorization the chain rejects as being from
   * the future. Pinned so nobody "tightens" it later.
   */
  it("never sets validAfter from the caller's clock", () => {
    for (const now of [0n, 1n, NOW, NOW * 2n]) {
      expect(validityWindow(now).validAfter, `${now}`).toBe(0n);
    }
  });

  it("honours a shorter lifetime", () => {
    expect(validityWindow(NOW, 60n).validBefore).toBe(NOW + 60n);
  });

  it("allows exactly the maximum and refuses one second more", () => {
    expect(validityWindow(NOW, MAX_AUTHORIZATION_SECONDS).validBefore).toBe(
      NOW + MAX_AUTHORIZATION_SECONDS,
    );
    expect(() => validityWindow(NOW, MAX_AUTHORIZATION_SECONDS + 1n)).toThrow(
      /longer than the 3600/,
    );
  });

  /**
   * 🔴 The reason there is a cap at all. An EIP-3009 authorization is a bearer
   * instrument, so a far-future `validBefore` is not "a payment with no expiry" — it
   * is a standing permission to withdraw `value`, valid in any log or clipboard it
   * ever lands in. The error says so, because a caller who hits this limit is about to
   * consider raising it.
   */
  it("explains that a long window is a standing withdrawal permission", () => {
    expect(() => validityWindow(NOW, 1n << 200n)).toThrow(/bearer instrument/);
    expect(() => validityWindow(NOW, 1n << 200n)).toThrow(/standing withdrawal/);
  });

  it.each([0n, -1n, -600n])("refuses a lifetime of %s seconds", (lifetime) => {
    expect(() => validityWindow(NOW, lifetime)).toThrow(/positive lifetime/);
  });

  it("refuses a negative now", () => {
    expect(() => validityWindow(-1n)).toThrow(/cannot be negative/);
  });

  /**
   * ⚠️ Milliseconds are the likely mistake, because `Date.now()` returns them and
   * `BigInt(Date.now())` is the obvious thing to write. Caught by unit rather than by
   * calendar: the bound is the year 10000, so this check never expires.
   */
  it("catches a millisecond timestamp instead of signing a 50,000-year window", () => {
    expect(() => validityWindow(BigInt(Date.now()) * 1000n)).toThrow(/looks like/);
    expect(() => validityWindow(BigInt(Date.now()) * 1000n)).toThrow(/milliseconds/);
  });

  it("accepts a real Unix time in seconds", () => {
    expect(() => validityWindow(BigInt(Math.floor(Date.now() / 1000)))).not.toThrow();
  });

  /** The window feeds straight into an authorization, so it has to encode. */
  it("produces bounds an authorization accepts", () => {
    const { validAfter, validBefore } = validityWindow(NOW);
    expect(() =>
      authorizationDigest(USDC_DOMAIN, { ...AUTH, validAfter, validBefore }),
    ).not.toThrow();
  });
});
