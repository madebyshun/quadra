/**
 * EIP-55, pinned against two authorities.
 *
 * ── Where every vector below came from ───────────────────────────────────────
 * The eight canonical spellings are EIP-55's own published test vectors, and every
 * one of them was re-derived on this machine before being written down:
 *
 *     cast to-check-sum-address 0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed
 *     cast to-check-sum-address 0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359
 *     cast to-check-sum-address 0xdbf03b407c01e7cd3cbea99509d93f8dddc8c6fb
 *     cast to-check-sum-address 0xd1220a0cf47c7b9be7a2e6ba89f429762e7b9adb
 *     cast to-check-sum-address 0x52908400098527886e0f7030069857d2e4169ee7
 *     cast to-check-sum-address 0x8617e340b3d01fa5f11f306f4090fd50e238070d
 *     cast to-check-sum-address 0xde709f2102306220921060314715629080e2fb77
 *     cast to-check-sum-address 0x27b1fdb04752bbc536007a920d24acb045561c26
 *
 * and the digest assertion from:
 *
 *     cast keccak $(cast from-utf8 "5aaeb6053f3e94c9b9a09f33669435e7ef1beaed")
 *
 * 🔴 **If one of these ever looks wrong, re-derive it with `cast`. Do NOT run this
 * repo's code and paste the answer back.** That converts the test into a restatement
 * of whatever the implementation currently does, which stays green with every bit
 * wrong. It is the same trap documented at the top of `tests/keccak.test.ts`, and it
 * is worth repeating here because a checksum *looks* self-evidently checkable.
 *
 * ── Why two authorities and not one ──────────────────────────────────────────
 * `cast to-check-sum-address` pins the whole function end to end. `cast keccak` pins
 * the one step inside it that a reasonable person gets wrong — hashing the 40 text
 * characters rather than the 20 address bytes. The end-to-end vectors would catch that
 * too, but they would not *say* what broke, and the digest assertion names it.
 *
 * ── Two vectors that are not from the spec, and why they are here ─────────────
 * `AAPLC` and `USDC_BASE` are the real addresses this app ships in `src/config/`.
 * They are the product-tying vectors: the checksum machinery working on EIP-55's
 * examples and failing on the token the pool actually pays in would be a passing
 * suite and a broken app.
 */

import { describe, expect, it } from "vitest";
import {
  ADDRESS_HEX_CHARS,
  ZERO_ADDRESS,
  addressToUint,
  assertChecksummedAddress,
  checkAddress,
  checksumDigestHex,
  describeChecksum,
  hasAddressShape,
  sameAddress,
  toChecksumAddress,
} from "@/lib/address";
import { AAPL_BASE } from "@/config/pair";
import { USDC } from "@/config/chain";

/** EIP-55's four ordinary examples: mixed case, correct checksum. */
const CANONICAL = [
  "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
  "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
  "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
] as const;

/**
 * EIP-55's two examples whose canonical spelling is entirely uppercase, and its two
 * whose canonical spelling is entirely lowercase.
 *
 * ⚠️ These are the interesting ones for this module, not the ordinary ones. Their
 * canonical form carries no *mixed* case, so `checkAddress` must classify them
 * `unchecked` — even though they are, by the spec, correctly checksummed. See
 * `carriesChecksum`'s comment: the question is whether a checksum is present, and in
 * an all-one-case string it is not, however the digest happens to land.
 */
const CANONICAL_ALL_CAPS = [
  "0x52908400098527886E0F7030069857D2E4169EE7",
  "0x8617E340B3D01FA5F11F306F4090FD50E238070D",
] as const;

const CANONICAL_ALL_LOWER = [
  "0xde709f2102306220921060314715629080e2fb77",
  "0x27b1fdb04752bbc536007a920d24acb045561c26",
] as const;

/** From `src/config/pair.ts` and `src/config/chain.ts`. Both mixed case in the repo. */
const AAPLC_ADDRESS: string = AAPL_BASE.address;
const USDC_ADDRESS: string = USDC.address;

/** A vector with no letters at all: simultaneously all-lower and all-upper. */
const NO_LETTERS = "0x1234567890123456789012345678901234567890";

describe("hasAddressShape", () => {
  it("accepts 0x and forty hex digits in any case", () => {
    expect(hasAddressShape(CANONICAL[0])).toBe(true);
    expect(hasAddressShape(CANONICAL[0].toLowerCase())).toBe(true);
    expect(hasAddressShape(CANONICAL[0].toUpperCase().replace("0X", "0x"))).toBe(true);
  });

  it("trims, because a pasted address arrives with whitespace", () => {
    expect(hasAddressShape(`  ${CANONICAL[0]}\n`)).toBe(true);
  });

  it("refuses the wrong length, either way", () => {
    expect(hasAddressShape(`0x${"a".repeat(39)}`)).toBe(false);
    expect(hasAddressShape(`0x${"a".repeat(41)}`)).toBe(false);
  });

  it("refuses a missing prefix and a non-hex digit", () => {
    expect(hasAddressShape("a".repeat(40))).toBe(false);
    expect(hasAddressShape(`0x${"g".repeat(40)}`)).toBe(false);
  });

  it("refuses a transaction hash, which is the paste people actually make", () => {
    expect(hasAddressShape(`0x${"a".repeat(64)}`)).toBe(false);
  });

  it("refuses empty", () => {
    expect(hasAddressShape("")).toBe(false);
  });

  /**
   * ⚠️ The documented bypass, asserted so that it is a decision rather than an
   * oversight. A caller reaching for this on a payment path is the hazard the header
   * warns about; a caller reaching for it in `verify.ts` is why it exists.
   */
  it("says nothing about the checksum, deliberately", () => {
    const broken = `0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed`;
    expect(hasAddressShape(broken)).toBe(true);
    expect(checkAddress(broken).kind).toBe("mismatch");
  });

  it("names the width rather than hiding it in a regex", () => {
    expect(ADDRESS_HEX_CHARS).toBe(40);
  });
});

describe("toChecksumAddress", () => {
  it("reproduces EIP-55's four ordinary vectors from their lowercase form", () => {
    for (const address of CANONICAL) {
      expect(toChecksumAddress(address.toLowerCase())).toBe(address);
    }
  });

  it("reproduces the two vectors whose canonical spelling is all uppercase", () => {
    for (const address of CANONICAL_ALL_CAPS) {
      expect(toChecksumAddress(address.toLowerCase())).toBe(address);
    }
  });

  it("reproduces the two whose canonical spelling is all lowercase", () => {
    for (const address of CANONICAL_ALL_LOWER) {
      expect(toChecksumAddress(address)).toBe(address);
    }
  });

  it("is idempotent, so a checksummed address survives a round trip", () => {
    for (const address of CANONICAL) {
      expect(toChecksumAddress(toChecksumAddress(address))).toBe(address);
    }
  });

  it("ignores the input's case entirely and derives the answer", () => {
    const shouted = CANONICAL[0].toUpperCase().replace("0X", "0x");
    expect(toChecksumAddress(shouted)).toBe(CANONICAL[0]);
  });

  /**
   * The point of this one is that it fails loudly for a mangled address instead of
   * returning a confident-looking casing of it. `toChecksumAddress` of nonsense would
   * be a string that looks exactly as authoritative as a real answer.
   */
  it("throws rather than checksumming something that is not an address", () => {
    expect(() => toChecksumAddress("0xnope")).toThrow("not a 20-byte hex address");
    expect(() => toChecksumAddress("")).toThrow("not a 20-byte hex address");
  });

  it("leaves digits alone, since only a-f can carry a bit", () => {
    expect(toChecksumAddress(NO_LETTERS)).toBe(NO_LETTERS);
  });

  it("returns the zero address unchanged, for the same reason", () => {
    expect(toChecksumAddress(ZERO_ADDRESS)).toBe(ZERO_ADDRESS);
    expect(ZERO_ADDRESS).toBe(`0x${"0".repeat(40)}`);
  });

  it("checksums the tokens this app actually ships", () => {
    expect(toChecksumAddress(AAPLC_ADDRESS)).toBe(AAPLC_ADDRESS);
    expect(toChecksumAddress(USDC_ADDRESS)).toBe(USDC_ADDRESS);
  });
});

describe("the digest EIP-55 hashes", () => {
  /**
   * The step worth naming. Hashing the 20 address bytes rather than the 40 characters
   * of text gives a different digest and therefore a different-but-stable casing, and
   * the end-to-end vectors would report it as a generic failure. This says what broke.
   *
   * From `cast keccak $(cast from-utf8 "5aaeb6053f3e94c9b9a09f33669435e7ef1beaed")`.
   */
  it("hashes the lowercased hex TEXT, not the twenty address bytes", () => {
    expect(checksumDigestHex(CANONICAL[0])).toBe(
      "0xd385650ce8fdc6db7ee3a091d34814dbc4ce18219ffae52182efff4034d707e5",
    );
  });

  it("does not depend on the case it was handed", () => {
    expect(checksumDigestHex(CANONICAL[0].toLowerCase())).toBe(checksumDigestHex(CANONICAL[0]));
  });

  it("refuses a non-address, so it cannot be used as a general hasher", () => {
    expect(() => checksumDigestHex("0xnope")).toThrow("not a 20-byte hex address");
  });

  /**
   * The first nibble of that digest is `0xd` = 13, which is ≥ 8, so character 0 of the
   * address is uppercased if it is a letter. It is `5`, a digit, so it is not — and
   * character 1, `a`, is governed by the second nibble `0x3` = 3, which is < 8, so it
   * stays lowercase. `0x5aA…` agrees. Spelled out because an off-by-one in the nibble
   * order is right half the time and this is the cheapest place to catch it.
   */
  it("places nibbles high-then-low within each byte", () => {
    expect(CANONICAL[0].slice(2, 5)).toBe("5aA");
  });
});

describe("checkAddress", () => {
  it("calls a mixed-case address with a matching checksum checksummed", () => {
    const checked = checkAddress(CANONICAL[0]);
    expect(checked.kind).toBe("checksummed");
    if (checked.kind !== "checksummed") throw new Error("unreachable");
    expect(checked.address).toBe(CANONICAL[0].toLowerCase());
  });

  it("calls an all-lowercase address unchecked, not verified", () => {
    const checked = checkAddress(CANONICAL[0].toLowerCase());
    expect(checked.kind).toBe("unchecked");
  });

  it("calls an all-uppercase address unchecked too", () => {
    const checked = checkAddress(CANONICAL[0].toUpperCase().replace("0X", "0x"));
    expect(checked.kind).toBe("unchecked");
    if (checked.kind !== "unchecked") throw new Error("unreachable");
    expect(checked.address).toBe(CANONICAL[0].toLowerCase());
  });

  it("calls a digits-only address unchecked, having no letters to carry a bit", () => {
    expect(checkAddress(NO_LETTERS).kind).toBe("unchecked");
    expect(checkAddress(ZERO_ADDRESS).kind).toBe("unchecked");
  });

  /**
   * ⚠️ **The vector that pins the design.** EIP-55 publishes `0xde709f…` as a correct
   * checksummed address, and its canonical spelling happens to be all lowercase. It
   * would be tempting to report it `checksummed` — the digest does agree. That would
   * be wrong: every address has a lowercase spelling that agrees the same way, so
   * agreement carries no information. Reporting it `checksummed` would mean any
   * attacker could earn the strongest verdict by lowercasing.
   */
  it("calls EIP-55's own all-lowercase vectors unchecked, not checksummed", () => {
    for (const address of CANONICAL_ALL_LOWER) {
      expect(toChecksumAddress(address)).toBe(address);
      expect(checkAddress(address).kind).toBe("unchecked");
    }
  });

  it("calls EIP-55's all-uppercase vectors unchecked for the mirror reason", () => {
    for (const address of CANONICAL_ALL_CAPS) {
      expect(toChecksumAddress(address)).toBe(address);
      expect(checkAddress(address).kind).toBe("unchecked");
    }
  });

  it("catches a single flipped case as a mismatch", () => {
    // `0x5aAeb…` with character 1 shouted: one bit of the checksum contradicted.
    const flipped = `0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed`;
    const checked = checkAddress(flipped);
    expect(checked.kind).toBe("mismatch");
    if (checked.kind !== "mismatch") throw new Error("unreachable");
    expect(checked.why).toContain("does not match");
  });

  it("catches a wrong hex digit in an otherwise checksummed address", () => {
    const typo = CANONICAL[0].replace("Aed", "Aee");
    expect(checkAddress(typo).kind).toBe("mismatch");
  });

  /**
   * 🔴 The trap the header forbids, asserted so nobody adds it back. `mismatch` must
   * not hand out a suggestion, because the only suggestion available is the typo with
   * its capitalisation repaired — a string that then passes every check in this file
   * and still points at the wrong account.
   */
  it("offers no corrected spelling on a mismatch", () => {
    const checked = checkAddress(`0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed`);
    if (checked.kind !== "mismatch") throw new Error("unreachable");
    expect(Object.keys(checked).sort()).toEqual(["kind", "why"]);
    expect(checked.why).toContain("Copy it again");
    expect(checked.why).not.toContain("did you mean");
  });

  it("calls a non-address malformed and says so in the user's words", () => {
    const checked = checkAddress("not-an-address");
    expect(checked.kind).toBe("malformed");
    if (checked.kind !== "malformed") throw new Error("unreachable");
    expect(checked.why).toContain("not a 20-byte hex address");
    expect(checked.why).toContain("a name or a ticker never does");
  });

  it("never throws, because every caller has something to render", () => {
    for (const input of ["", "0x", "nope", `0x${"a".repeat(64)}`, NO_LETTERS, CANONICAL[0]]) {
      expect(() => checkAddress(input)).not.toThrow();
    }
  });

  it("trims before deciding, so a pasted address is not malformed", () => {
    expect(checkAddress(`  ${CANONICAL[0]}  `).kind).toBe("checksummed");
  });

  it("agrees with the repo's own shipped addresses", () => {
    expect(checkAddress(AAPLC_ADDRESS).kind).toBe("checksummed");
    expect(checkAddress(USDC_ADDRESS).kind).toBe("checksummed");
  });
});

describe("assertChecksummedAddress", () => {
  it("returns the canonical lowercase spelling for a checksummed address", () => {
    expect(assertChecksummedAddress(CANONICAL[0], "recipient")).toBe(CANONICAL[0].toLowerCase());
  });

  it("accepts a lowercase address, because the ecosystem hands those out", () => {
    expect(assertChecksummedAddress(CANONICAL[0].toLowerCase(), "recipient")).toBe(
      CANONICAL[0].toLowerCase(),
    );
  });

  it("refuses a contradicted checksum, and names the field", () => {
    expect(() =>
      assertChecksummedAddress(`0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed`, "recipient"),
    ).toThrow("recipient");
  });

  it("refuses a malformed address, and names the field", () => {
    expect(() => assertChecksummedAddress("nope", "relayer")).toThrow("relayer");
  });

  /**
   * 🔴 The ordering assertion. If the lowercasing happened before the checksum check,
   * this input would come back as a clean lowercase address — well-formed, canonically
   * encodable, provable, and pointing somewhere nobody chose. The throw is the whole
   * reason this function exists instead of `.toLowerCase()` at four call sites.
   */
  it("checks the checksum BEFORE lowercasing, so a typo cannot be laundered", () => {
    const typo = CANONICAL[0].replace("Aed", "Aee");
    expect(hasAddressShape(typo)).toBe(true);
    expect(() => assertChecksummedAddress(typo, "recipient")).toThrow("does not match");
  });
});

describe("addressToUint", () => {
  it("reads the twenty bytes big-endian, as the ABI does", () => {
    expect(addressToUint(ZERO_ADDRESS, "token")).toBe(0n);
    expect(addressToUint(NO_LETTERS, "token")).toBe(0x1234567890123456789012345678901234567890n);
  });

  it("does not depend on the spelling it was handed", () => {
    expect(addressToUint(CANONICAL[0], "token")).toBe(
      addressToUint(CANONICAL[0].toLowerCase(), "token"),
    );
  });

  it("stays inside uint160", () => {
    expect(addressToUint(`0x${"f".repeat(40)}`, "token")).toBe((1n << 160n) - 1n);
  });

  it("refuses a bad checksum rather than encoding it", () => {
    expect(() =>
      addressToUint(`0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed`, "token"),
    ).toThrow("token");
  });
});

describe("sameAddress", () => {
  it("ignores spelling", () => {
    expect(sameAddress(CANONICAL[0], CANONICAL[0].toLowerCase())).toBe(true);
  });

  it("separates two different accounts", () => {
    expect(sameAddress(CANONICAL[0], CANONICAL[1])).toBe(false);
  });

  /**
   * ⚠️ Throwing rather than answering `false` is deliberate. A call site about to
   * branch on "is this the zero address" must not read "you passed me a ticker" as
   * "no".
   */
  it("throws on a malformed input instead of calling it different", () => {
    expect(() => sameAddress("nope", ZERO_ADDRESS)).toThrow("first address");
    expect(() => sameAddress(ZERO_ADDRESS, "nope")).toThrow("second address");
  });
});

describe("describeChecksum", () => {
  it("reports a match plainly", () => {
    expect(describeChecksum(checkAddress(CANONICAL[0]))).toBe("EIP-55 checksum matches.");
  });

  /**
   * ⚠️ The silence-is-approval test. An unchecked address must say that it was not
   * checked; returning an empty string here, or the same sentence as a match, would
   * be the failure the header warns about.
   */
  it("says out loud that a lowercase address was not checked", () => {
    const line = describeChecksum(checkAddress(CANONICAL[0].toLowerCase()));
    expect(line).toContain("no EIP-55 checksum to verify");
    expect(line).not.toBe("EIP-55 checksum matches.");
  });

  /**
   * ⚠️ The line said "Lowercase address:" until this test was written, which was false
   * for two of the three shapes that reach `unchecked`. All-caps is one of EIP-55's own
   * vectors, and a digits-only address has no case to speak of. A sentence that
   * misdescribes what the user is looking at gets skipped, and this is the one line in
   * the send flow whose whole job is to be read.
   */
  it("does not call an all-caps or digits-only address lowercase", () => {
    for (const input of [CANONICAL_ALL_CAPS[0], CANONICAL_ALL_CAPS[1], NO_LETTERS]) {
      expect(checkAddress(input).kind, input).toBe("unchecked");
      const line = describeChecksum(checkAddress(input));
      expect(line, input).toContain("no EIP-55 checksum to verify");
      expect(line.toLowerCase(), input).not.toContain("lowercase");
    }
  });

  it("passes the mismatch and malformed sentences straight through", () => {
    const mismatch = checkAddress(`0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed`);
    const malformed = checkAddress("nope");
    if (mismatch.kind !== "mismatch") throw new Error("unreachable");
    if (malformed.kind !== "malformed") throw new Error("unreachable");
    expect(describeChecksum(mismatch)).toBe(mismatch.why);
    expect(describeChecksum(malformed)).toBe(malformed.why);
  });

  it("gives every verdict a distinct line, so the four are never conflated", () => {
    const lines = [
      describeChecksum(checkAddress(CANONICAL[0])),
      describeChecksum(checkAddress(CANONICAL[0].toLowerCase())),
      describeChecksum(checkAddress(`0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed`)),
      describeChecksum(checkAddress("nope")),
    ];
    expect(new Set(lines).size).toBe(4);
  });
});
