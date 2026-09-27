/**
 * The client half of `transact`, checked against the compiler's own numbers.
 *
 * ── Why this file reads a `.sol` too ─────────────────────────────────────────
 * `src/lib/transaction.ts` writes `abi.encode(ExtData)` out by hand, because a
 * zero-dependency frontend has no ABI coder. A wrong byte there changes
 * `extDataHash`, which is `input[2]`, which is the slot binding *who gets paid* — so
 * the failure mode is a proof about a different recipient, with nothing reverting.
 *
 * So the expected bytes are EXTRACTED from `contracts/test/ShieldedPool.t.sol`, where
 * the compiler asserts them, exactly as `tests/field.test.ts` extracts `FIELD_SIZE`.
 * Typing the same literals in here as well would be two copies that agree with
 * whichever side they were written against, which is the bug rather than the check.
 *
 * ── What this file honestly cannot check ─────────────────────────────────────
 * 🔴 **There is no keccak-256 in this build**, so nothing here recomputes the digest.
 * The digest arrives as a pinned vector and the test asserts the *fold* of it. That
 * is the same discipline `lib/hash.ts` demands of Poseidon — a hash you cannot
 * compute is supplied as checked-in vectors, never approximated with a different
 * function that happens to be available. Substituting SHA-256 to make this file look
 * more complete would produce a green suite and an unprovable pool.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIELD_MODULUS, MAX_NOTE_VALUE } from "@/lib/field";
import { standInHash } from "@/lib/hash";
import type { Commitment, Nullifier, TaggedField } from "@/lib/note";
import {
  type ExtData,
  type ExtDataHash,
  PUBLIC_INPUT_COUNT,
  abiEncodeExtData,
  assertAddress,
  buildPublicInputs,
  derivePaddingOutput,
  describeExtDataProblems,
  extDataHash,
  fieldEncodeAmount,
  messageOf,
  newPaddingNote,
  publicAmountFor,
} from "@/lib/transaction";

/**
 * `dirname(fileURLToPath(...))` then `resolve`, not `new URL(path, import.meta.url)`.
 * See the 🔴 in `tests/field.test.ts` — Vite rewrites the second form into a dev-server
 * URL and the symptom reads as a wrong relative path. Same trap, same avoidance.
 */
const SUITE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../contracts/test/ShieldedPool.t.sol",
);

const SOURCE = readFileSync(SUITE, "utf8");

/**
 * Pull one capture out of the suite, or fail naming the file.
 *
 * The throw matters for the same reason it does in `tests/field.test.ts`: a regex that
 * stopped matching and a value that genuinely disagrees are two completely different
 * repairs, and a silent `undefined` compared against bytes reports the second when the
 * truth is the first.
 */
function fromSuite(what: string, pattern: RegExp): string {
  const match = SOURCE.match(pattern);
  const value = match?.[1];
  if (value === undefined) {
    throw new Error(
      `${what} no longer parses out of contracts/test/ShieldedPool.t.sol — it was ` +
        "renamed, moved, or reformatted, so this test can no longer check the hand-written " +
        "encoder in src/lib/transaction.ts against the compiler. Read the pinned-vector " +
        "section of that suite before changing either side.",
    );
  }
  return value;
}

/** `address internal constant ALICE = address(0xA11CE);` → a full 20-byte address. */
function addressFromSuite(name: string): string {
  const short = fromSuite(name, new RegExp(`constant\\s+${name}\\s*=\\s*address\\((0x[0-9a-fA-F]+)\\)`));
  /**
   * Padded here rather than in the Solidity, because the suite writes these the way
   * Solidity wants them (a short literal, no checksum) and the browser needs the
   * 40-digit form. The padding is the same left-padding `abi.encode` does to reach a
   * 32-byte word, so doing it explicitly is also the thing under test.
   */
  return `0x${BigInt(short).toString(16).padStart(40, "0")}`;
}

/** Four `hex"…"` fragments concatenated by the Solidity lexer, joined back here. */
const PINNED_ENCODING = fromSuite(
  "PINNED_ENCODING",
  /bytes internal constant PINNED_ENCODING\s*=\s*((?:\s*hex"[0-9a-fA-F]*")+)\s*;/,
)
  .split(/hex"/)
  .slice(1)
  .map((chunk) => chunk.slice(0, chunk.indexOf('"')))
  .join("");

const PINNED_DIGEST = fromSuite(
  "PINNED_DIGEST",
  /bytes32 internal constant PINNED_DIGEST\s*=\s*(0x[0-9a-fA-F]{64});/,
);

const PINNED_FIELD = BigInt(
  fromSuite("PINNED_FIELD", /uint256 internal constant PINNED_FIELD\s*=\s*(\d+);/),
);

/** `-75e8` / `25e8` in the suite; `e` notation is the same in both languages. */
function scientific(name: string): bigint {
  const raw = fromSuite(name, new RegExp(`constant\\s+${name}\\s*=\\s*(-?\\d+e\\d+);`));
  const [mantissa = "", exponent = ""] = raw.split("e");
  return BigInt(mantissa) * 10n ** BigInt(exponent);
}

/** The exact `ExtData` the suite pins, rebuilt from the suite's own members. */
const PINNED: ExtData = {
  recipient: addressFromSuite("ALICE"),
  relayer: addressFromSuite("RELAYER"),
  extAmount: scientific("PINNED_EXT_AMOUNT"),
  fee: scientific("PINNED_EXT_FEE"),
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const SOMEWHERE = "0x00000000000000000000000000000000000000ff";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The `extAmount` word as hex.
 *
 * Written as a helper after getting it wrong by hand: a 32-byte word is **64** hex
 * characters, so word 2 is `slice(128, 192)`, and `slice(64, 128)` silently reads the
 * relayer instead. Both wrong slices produce a plausible-looking 64-character string,
 * which is exactly the kind of off-by-one an encoder test must not contain.
 */
function word2(extData: ExtData): string {
  const words = hex(abiEncodeExtData(extData)).match(/.{64}/g) ?? [];
  const word = words[2];
  if (word === undefined) throw new Error("the encoding is not four words long");
  return word;
}

/** The pinned digest as the 32 bytes a real keccak would have returned. */
function pinnedKeccak(): Uint8Array {
  const body = PINNED_DIGEST.slice(2);
  return Uint8Array.from({ length: 32 }, (_, i) => Number.parseInt(body.slice(i * 2, i * 2 + 2), 16));
}

function field(value: bigint): TaggedField {
  return { scheme: "poseidon", value };
}

function standIn(value: bigint): TaggedField {
  return { scheme: "stand-in", value, why: "produced by a stand-in hash" };
}

const KECCAK_OK: ExtDataHash = { kind: "keccak256", value: PINNED_FIELD };

function vector(overrides: {
  readonly root?: TaggedField;
  readonly nullifiers?: readonly [Nullifier, Nullifier];
  readonly commitments?: readonly [Commitment, Commitment];
  readonly extData?: ExtData;
  readonly hash?: ExtDataHash;
}) {
  return buildPublicInputs({
    root: overrides.root ?? field(11n),
    inputNullifiers: overrides.nullifiers ?? [field(22n), field(33n)],
    outputCommitments: overrides.commitments ?? [field(44n), field(55n)],
    extData: overrides.extData ?? PINNED,
    extDataHash: overrides.hash ?? KECCAK_OK,
  });
}

describe("the pinned vector is the compiler's, not this file's", () => {
  /**
   * The extractor's failure path, exercised. Otherwise the branch that produces the
   * "names the file" message is itself untested and a typo in it surfaces only on the
   * day the two sides drift — the worst possible day for a confusing error.
   */
  it("fails by naming the suite when a literal stops parsing", () => {
    expect(() => fromSuite("NOT_PINNED", /constant NOT_PINNED = (\d+);/)).toThrow(
      "contracts/test/ShieldedPool.t.sol",
    );
  });

  it("reads a vector whose shape says the fold is real work", () => {
    expect(PINNED_ENCODING).toHaveLength(256);
    expect(PINNED.extAmount).toBeLessThan(0n);
    expect(PINNED.fee).toBeGreaterThan(0n);
    expect(PINNED.recipient).not.toBe(PINNED.relayer);
    /**
     * The property the Solidity side also asserts: the digest is at or above the
     * modulus, so `% FIELD_SIZE` genuinely reduces. A digest that happened to land
     * below it would make the fold a no-op and let a broken fold pass on both sides.
     */
    expect(BigInt(PINNED_DIGEST)).toBeGreaterThanOrEqual(FIELD_MODULUS);
  });
});

describe("abiEncodeExtData", () => {
  it("reproduces the compiler's 128 bytes exactly", () => {
    const encoded = abiEncodeExtData(PINNED);
    expect(encoded).toHaveLength(128);
    expect(hex(encoded)).toBe(PINNED_ENCODING);
  });

  /**
   * The two encodings that must not be confused, asserted as a difference rather than
   * described in a comment. `abi.encode` writes `int256` as two's complement; the
   * public amount is field-negated. Mixing them yields a proof that verifies for the
   * wrong transaction, so the fact that word 2 is the `f…` pattern and NOT the field
   * encoding is worth holding down.
   */
  it("writes a negative extAmount as two's complement, not as field negation", () => {
    const word = word2(PINNED);
    expect(word.startsWith("ffff")).toBe(true);

    const fieldEncoded = fieldEncodeAmount(PINNED.extAmount).toString(16).padStart(64, "0");
    expect(word).not.toBe(fieldEncoded);
  });

  it("left-pads both addresses into the low 20 bytes", () => {
    const words = hex(abiEncodeExtData(PINNED)).match(/.{64}/g) ?? [];
    expect(words[0]).toBe(BigInt(PINNED.recipient).toString(16).padStart(64, "0"));
    expect(words[1]).toBe(BigInt(PINNED.relayer).toString(16).padStart(64, "0"));
    expect(words[3]).toBe(PINNED.fee.toString(16).padStart(64, "0"));
  });

  it("encodes a deposit's positive amount without the sign pattern", () => {
    expect(word2({ ...PINNED, extAmount: 5n })).toBe("5".padStart(64, "0"));
    expect(word2({ ...PINNED, extAmount: 0n })).toBe("0".repeat(64));
  });

  it("refuses a bad address before encoding anything", () => {
    expect(() => abiEncodeExtData({ ...PINNED, recipient: "0xnope" })).toThrow("recipient");
    expect(() => abiEncodeExtData({ ...PINNED, relayer: "0xnope" })).toThrow("relayer");
  });

  it("refuses an out-of-range amount rather than wrapping it into a word", () => {
    expect(() => abiEncodeExtData({ ...PINNED, fee: MAX_NOTE_VALUE + 1n })).toThrow("AmountTooLarge");
  });
});

describe("assertAddress", () => {
  it("lowercases so one address cannot produce two encodings", () => {
    const mixed = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
    expect(assertAddress(mixed, "recipient")).toBe(mixed.toLowerCase());
    expect(hex(abiEncodeExtData({ ...PINNED, recipient: mixed }))).toBe(
      hex(abiEncodeExtData({ ...PINNED, recipient: mixed.toLowerCase() })),
    );
  });

  it("refuses anything that is not 20 hex bytes, and says what identifies a token", () => {
    for (const bad of ["", "0x", "AAPLc", ZERO_ADDRESS.slice(0, -1), `${ZERO_ADDRESS}00`]) {
      expect(() => assertAddress(bad, "recipient"), bad).toThrow("not a 20-byte hex address");
    }
    expect(() => assertAddress("AAPLc", "recipient")).toThrow("ticker never does");
  });

  it("accepts the zero address, because the pool's rule is about direction", () => {
    expect(assertAddress(ZERO_ADDRESS, "recipient")).toBe(ZERO_ADDRESS);
  });
});

describe("publicAmountFor", () => {
  it("subtracts the fee in all three directions", () => {
    expect(publicAmountFor({ ...PINNED, extAmount: 100n, fee: 25n })).toBe(75n);
    expect(publicAmountFor({ ...PINNED, extAmount: -100n, fee: 25n })).toBe(-125n);
    expect(publicAmountFor({ ...PINNED, extAmount: 0n, fee: 25n })).toBe(-25n);
  });

  /**
   * The insolvency this shape exists to prevent, stated as arithmetic: a fee is
   * charged on TOP of a withdrawal, never carved out of it, so withdrawing 75 with a
   * fee of 25 must cost the pool 100 — not 75 with the relayer paid out of the user's
   * payout. The pinned vector is exactly that case.
   */
  it("charges a fee against the pool on a withdrawal, not against the payout", () => {
    expect(publicAmountFor(PINNED)).toBe(PINNED.extAmount - PINNED.fee);
    expect(publicAmountFor(PINNED)).toBe(-100n * 10n ** 8n);
  });

  it("refuses a negative fee, which the contract's uint256 cannot express", () => {
    expect(() => publicAmountFor({ ...PINNED, fee: -1n })).toThrow("cannot be negative");
  });

  it("bounds each term the way the contract does", () => {
    expect(() => publicAmountFor({ ...PINNED, fee: MAX_NOTE_VALUE + 1n })).toThrow("2^248");
    expect(() => publicAmountFor({ ...PINNED, extAmount: MAX_NOTE_VALUE + 1n })).toThrow("2^248");
    expect(() => publicAmountFor({ ...PINNED, extAmount: -(MAX_NOTE_VALUE + 1n) })).toThrow("2^248");
    expect(() => publicAmountFor({ ...PINNED, extAmount: MAX_NOTE_VALUE, fee: 0n })).not.toThrow();
  });
});

describe("fieldEncodeAmount", () => {
  it("encodes a deposit as itself and zero as zero", () => {
    expect(fieldEncodeAmount(1000n)).toBe(1000n);
    expect(fieldEncodeAmount(0n)).toBe(0n);
    expect(fieldEncodeAmount(MAX_NOTE_VALUE)).toBe(MAX_NOTE_VALUE);
  });

  it("encodes a withdrawal as a field subtraction, not a sign bit", () => {
    expect(fieldEncodeAmount(-1000n)).toBe(FIELD_MODULUS - 1000n);
    /**
     * The check that separates this from two's complement: the top bit of a 256-bit
     * two's-complement −1000 is set, and a field-negated −1000 is below the modulus.
     */
    expect(fieldEncodeAmount(-1000n)).toBeLessThan(FIELD_MODULUS);
    expect(fieldEncodeAmount(-1000n)).not.toBe((1n << 256n) - 1000n);
  });

  /**
   * The bound this function re-applies rather than inheriting, and the exact case that
   * makes the duplication necessary: both terms are legal on their own, and their
   * difference is not.
   */
  it("bounds the derived element even when both inputs were legal", () => {
    const both: ExtData = { ...PINNED, extAmount: -MAX_NOTE_VALUE, fee: MAX_NOTE_VALUE };
    expect(() => publicAmountFor(both)).not.toThrow();
    expect(() => fieldEncodeAmount(publicAmountFor(both))).toThrow("Both extAmount and fee");
  });
});

describe("extDataHash", () => {
  /**
   * The honest state of this build. `unavailable` is not a transient error and the
   * message has to say why no substitute would do, because "just use SHA-256" is the
   * obvious next thought and it produces a pool no proof can satisfy.
   */
  it("reports the missing keccak rather than inventing a number", () => {
    const result = extDataHash(PINNED, null);
    expect(result.kind).toBe("unavailable");
    if (result.kind !== "unavailable") throw new Error("unreachable");
    expect(result.why).toContain("keccak-256");
    expect(result.why).toContain("SHA-3-256");
  });

  it("folds the pinned digest into the field element the contract returns", () => {
    const result = extDataHash(PINNED, pinnedKeccak);
    expect(result).toEqual({ kind: "keccak256", value: PINNED_FIELD });
  });

  /**
   * The injected keccak is handed the bytes this module built, not the struct — so a
   * test can assert the message as well as the result, which is the only way to catch
   * an encoder that is right about length and wrong about content.
   */
  it("hashes exactly the 128 bytes it encoded", () => {
    let seen: Uint8Array | null = null;
    extDataHash(PINNED, (message) => {
      seen = message;
      return pinnedKeccak();
    });
    expect(seen).not.toBeNull();
    expect(hex(seen ?? new Uint8Array())).toBe(PINNED_ENCODING);
  });

  it("refuses a digest that is not 32 bytes rather than folding it", () => {
    expect(() => extDataHash(PINNED, () => new Uint8Array(20))).toThrow("must be 32 bytes");
  });

  it("propagates an encoding failure instead of hashing a broken struct", () => {
    expect(() => extDataHash({ ...PINNED, relayer: "nope" }, pinnedKeccak)).toThrow("relayer");
  });
});

describe("newPaddingNote", () => {
  it("is worth zero", () => {
    expect(newPaddingNote().amount).toBe(0n);
  });

  /**
   * 🔴 The assertion this function exists for. A fixed secret gives a fixed nullifier,
   * the first transaction that spends one burns it on chain forever, and every later
   * transaction needing a padding input reverts `AlreadySpent` — for everybody. So
   * this is not a "randomness looks random" test; it is the regression test for a
   * permanent denial-of-service on the whole pool.
   */
  it("draws a fresh secret every call, because a constant would brick the pool", () => {
    const secrets = new Set(Array.from({ length: 32 }, () => newPaddingNote().secret));
    expect(secrets.size).toBe(32);
    expect(secrets.has(0n)).toBe(false);
  });

  it("commits to zero through the padding path, which the normal path refuses", async () => {
    const commitment = await derivePaddingOutput(standInHash);
    expect(commitment.scheme).toBe("stand-in");
    expect(commitment.value).toBeLessThan(FIELD_MODULUS);
  });

  it("gives two padding outputs different commitments", async () => {
    const [a, b] = await Promise.all([
      derivePaddingOutput(standInHash),
      derivePaddingOutput(standInHash),
    ]);
    expect(a.value).not.toBe(b.value);
  });
});

describe("buildPublicInputs", () => {
  it("lays the seven inputs out in the contract's order", () => {
    const built = vector({});
    expect(built.kind).toBe("complete");
    if (built.kind !== "complete") throw new Error("unreachable");

    expect(built.input).toHaveLength(PUBLIC_INPUT_COUNT);
    expect(built.input).toEqual([
      11n,
      fieldEncodeAmount(publicAmountFor(PINNED)),
      PINNED_FIELD,
      22n,
      33n,
      44n,
      55n,
    ]);
  });

  /**
   * Positional, and load-bearing. The circuit indexes this array by number, so a
   * vector with `input[3]` and `input[5]` swapped is well-formed, in-field and about
   * a transaction that does not exist. Asserting that a nullifier and a commitment do
   * not land in each other's slots is the only check available on this side.
   */
  it("does not put a commitment where a nullifier goes", () => {
    const built = vector({
      nullifiers: [field(1n), field(2n)],
      commitments: [field(3n), field(4n)],
    });
    if (built.kind !== "complete") throw new Error("unreachable");
    expect(built.input.slice(3)).toEqual([1n, 2n, 3n, 4n]);
  });

  it("refuses a vector with an unavailable extDataHash", () => {
    const built = vector({ hash: { kind: "unavailable", why: "no keccak in this build" } });
    expect(built).toEqual({ kind: "incomplete", why: ["extDataHash: no keccak in this build"] });
  });

  /**
   * A keccak and every field in place, and the amount alone is the blocker — which is
   * what makes the `encodedAmount === null` guard something a test can decide rather
   * than a line that only exists for the type checker.
   */
  it("refuses a vector whose derived amount is out of range", () => {
    const built = vector({
      extData: { ...PINNED, extAmount: -MAX_NOTE_VALUE, fee: MAX_NOTE_VALUE },
    });
    expect(built.kind).toBe("incomplete");
    if (built.kind !== "incomplete") throw new Error("unreachable");
    expect(built.why).toHaveLength(1);
    expect(built.why[0]).toContain("publicAmount:");
    expect(built.why[0]).toContain("2^248");
  });

  it("refuses a stand-in field even when every number is in range", () => {
    const built = vector({ root: standIn(11n) });
    expect(built.kind).toBe("incomplete");
    if (built.kind !== "incomplete") throw new Error("unreachable");
    expect(built.why).toEqual(["root: produced by a stand-in hash"]);
  });

  /**
   * One unusable element makes the whole vector unusable, and every blocker is
   * reported at once. A panel that showed them one at a time would make a user fix
   * them one round-trip each, and in this build the keccak one is always present.
   */
  it("names every blocker, not the first", () => {
    const built = vector({
      root: standIn(11n),
      nullifiers: [standIn(22n), field(FIELD_MODULUS)],
      commitments: [field(44n), standIn(55n)],
      hash: { kind: "unavailable", why: "no keccak" },
    });
    if (built.kind !== "incomplete") throw new Error("unreachable");
    expect(built.why).toEqual([
      "root: produced by a stand-in hash",
      "inputNullifier[0]: produced by a stand-in hash",
      "inputNullifier[1] is not a field element " +
        `(${FIELD_MODULUS}) and no circuit can reference it`,
      "outputCommitment[1]: produced by a stand-in hash",
      "extDataHash: no keccak",
    ]);
  });

  it("rejects an out-of-field value from a hash that claims to be real", () => {
    const built = vector({ commitments: [field(44n), field(FIELD_MODULUS + 1n)] });
    if (built.kind !== "incomplete") throw new Error("unreachable");
    expect(built.why).toEqual([
      `outputCommitment[1] is not a field element (${FIELD_MODULUS + 1n}) and no circuit can reference it`,
    ]);
  });

  /**
   * A stand-in value that is ALSO out of field reports both reasons, because they are
   * different repairs: one waits for Poseidon, the other is a bug upstream.
   */
  it("reports both reasons when a field is stand-in and out of range", () => {
    const built = vector({ root: standIn(FIELD_MODULUS) });
    if (built.kind !== "incomplete") throw new Error("unreachable");
    expect(built.why).toHaveLength(2);
  });

});

/**
 * The defensive arm, tested where it lives rather than through a contrived caller.
 *
 * See the comment on `messageOf`: nothing in `lib/transaction.ts` throws a non-`Error`,
 * so reaching that arm through `buildPublicInputs` requires an object with a throwing
 * getter — a test that asserts the behaviour of its own fixture and breaks the moment
 * the function reads the field twice. Two lines here are the same coverage and an
 * honest claim.
 */
describe("messageOf", () => {
  it("unwraps an Error to its message", () => {
    expect(messageOf(new Error("the fee cannot be negative"))).toBe("the fee cannot be negative");
  });

  it("stringifies anything else rather than rendering undefined", () => {
    expect(messageOf("a string, not an Error")).toBe("a string, not an Error");
    expect(messageOf(undefined)).toBe("undefined");
  });
});

describe("describeExtDataProblems", () => {
  it("says nothing about a well-formed transaction", () => {
    expect(describeExtDataProblems(PINNED)).toEqual([]);
  });

  it("names RecipientIsZero only when money is actually leaving", () => {
    const [problem] = describeExtDataProblems({ ...PINNED, recipient: ZERO_ADDRESS });
    expect(problem).toContain("RecipientIsZero");

    // A deposit ignores `recipient`, so a zero there is not a problem.
    expect(
      describeExtDataProblems({ ...PINNED, recipient: ZERO_ADDRESS, extAmount: 5n }),
    ).toEqual([]);
    expect(describeExtDataProblems({ ...PINNED, recipient: SOMEWHERE })).toEqual([]);
  });

  it("names RelayerIsZero only when a fee is actually charged", () => {
    const [problem] = describeExtDataProblems({ ...PINNED, relayer: ZERO_ADDRESS });
    expect(problem).toContain("RelayerIsZero");

    expect(describeExtDataProblems({ ...PINNED, relayer: ZERO_ADDRESS, fee: 0n })).toEqual([]);
    expect(describeExtDataProblems({ ...PINNED, relayer: SOMEWHERE })).toEqual([]);
  });

  it("reports a bound failure alongside the zero-address ones", () => {
    const problems = describeExtDataProblems({
      ...PINNED,
      recipient: ZERO_ADDRESS,
      relayer: ZERO_ADDRESS,
      fee: MAX_NOTE_VALUE + 1n,
    });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain("2^248");
  });
});
