/**
 * The browser's field arithmetic, and the one test in this repo that reads Solidity.
 *
 * ── Why this file opens a `.sol` ─────────────────────────────────────────────
 * `FIELD_MODULUS` and `MAX_NOTE_VALUE` exist twice: once in `src/lib/field.ts` and
 * once in `contracts/src/`. A copied constant drifts, and this particular drift is
 * silent — both halves keep working alone and only disagree at the boundary where
 * a commitment built in the browser meets a tree that rejects it, or worse, accepts
 * it and can never prove it.
 *
 * So the expectation is EXTRACTED from the contract, not typed in here. The header
 * of `lib/field.ts` says not to "simplify" this into a hard-coded number, and that
 * is the whole point: a hard-coded 2188… on both sides is two copies again, with a
 * test that agrees with whichever one it was written against.
 *
 * ── The trap this file is itself shaped to avoid ─────────────────────────────
 * A regex that matches nothing reads exactly like a regex that matches and agrees.
 * `contracts/foundry.toml` has the same lesson written on it about ignore globs
 * (`test/**` matched nothing while looking like a working exemption). So every
 * extraction below asserts the match exists BEFORE comparing values, and the
 * failure message names the file that moved.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  FIELD_MODULUS,
  MAX_NOTE_VALUE,
  assertNoteValue,
  fromFieldHex,
  intoField,
  isInField,
  randomFieldElement,
  toFieldHex,
} from "@/lib/field";

/**
 * Read a constant out of a contract, or fail naming the file.
 *
 * The throw is the point. An extraction that quietly yields `undefined` and a
 * comparison against `undefined` would both be reported as a value mismatch, which
 * reads as "the constants disagree" when the truth is "the regex no longer matches" —
 * two very different repairs. So a miss says so, in the file's own name.
 */
/**
 * Where the contracts are, resolved without the obvious idiom.
 *
 * 🔴 **Do not write `new URL("../contracts/src/x", import.meta.url)` here.** MEASURED
 * 2026-09-27: Vite treats that exact expression as its static-asset reference pattern
 * and rewrites it, so the result is `http://localhost:3000/contracts/src/x` — a URL
 * resolved against the dev server, not against this file. `import.meta.url` itself is
 * correct (`file:///…/tests/field.test.ts`); it is the `new URL(…, base)` wrapper that
 * is transformed away. The symptom is an ENOENT for a path like `/contracts/src/x`
 * with the project directory missing from the front, which reads as a wrong relative
 * path rather than as a rewritten expression.
 *
 * `fileURLToPath(import.meta.url)` on its own is an ordinary call and is left alone,
 * so taking the directory first and joining with `path.resolve` gets the real answer
 * and stays independent of `process.cwd()`.
 */
const CONTRACTS_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../contracts/src");

function extract(file: string, what: string, pattern: RegExp): (group: number) => string {
  const source = readFileSync(resolve(CONTRACTS_SRC, file), "utf8");
  const match = source.match(pattern);
  if (!match) {
    throw new Error(
      `${what} no longer parses out of contracts/src/${file} — it was renamed, moved, or ` +
        `reformatted, so this test can no longer check the copy in src/lib/field.ts. ` +
        `Read the header of that file before changing either side.`,
    );
  }
  /**
   * Returns an accessor rather than the array so an absent group is a named error
   * too, instead of the `undefined` that `noUncheckedIndexedAccess` would otherwise
   * push into `BigInt()` for a confusing "Cannot convert undefined" at the call site.
   */
  return (group: number): string => {
    const value = match[group];
    if (value === undefined) {
      throw new Error(`${what}: capture group ${group} is empty in contracts/src/${file}.`);
    }
    return value;
  };
}

describe("the constants agree with the contracts", () => {
  it("mirrors FIELD_SIZE from MerkleTreeWithHistory.sol", () => {
    /** The declaration wraps onto a second line, hence `\s+` rather than a space. */
    const group = extract(
      "MerkleTreeWithHistory.sol",
      "FIELD_SIZE",
      /uint256\s+internal\s+constant\s+FIELD_SIZE\s*=\s*(\d+);/,
    );
    expect(BigInt(group(1))).toBe(FIELD_MODULUS);
  });

  /**
   * Extracted as a shift, not as a decimal. Solidity writes `1 << 248` and
   * TypeScript writes `1n << 248n`; comparing the computed values is what proves
   * the two agree, and reading the exponent out means a change from 248 to 250
   * fails here rather than being copied by hand.
   */
  it("mirrors MAX_NOTE_VALUE from ShieldedPool.sol", () => {
    const group = extract(
      "ShieldedPool.sol",
      "MAX_NOTE_VALUE",
      /uint256\s+public\s+constant\s+MAX_NOTE_VALUE\s*=\s*(\d+)\s*<<\s*(\d+);/,
    );
    expect(BigInt(group(1)) << BigInt(group(2))).toBe(MAX_NOTE_VALUE);
  });

  /**
   * The extractor's own failure path, exercised — otherwise the branch that produces
   * the "names the file that moved" message is itself untested, and a typo in it
   * surfaces only on the day the constants drift, which is the worst day for it.
   */
  it("fails by naming the file when a constant stops parsing", () => {
    expect(() => extract("ShieldedPool.sol", "NOT_A_CONSTANT", /uint256 NOT_A_CONSTANT = (\d+);/))
      .toThrow("contracts/src/ShieldedPool.sol");
  });

  it("fails when a group matched but captured nothing", () => {
    /**
     * `(?:(x)|=)` matches through the `=` branch, so group 1 participated in no
     * match and is `undefined` — present in the array, absent in value. Without the
     * accessor's check that `undefined` reaches `BigInt()`.
     */
    const group = extract("ShieldedPool.sol", "MAX_NOTE_VALUE", /MAX_NOTE_VALUE\s*(?:(x)|=)/);
    expect(() => group(1)).toThrow("capture group 1 is empty");
  });

  /**
   * The relationship that makes the bound do its job, stated as the number it
   * actually is rather than as "plenty".
   *
   * MEASURED: `FIELD_MODULUS / MAX_NOTE_VALUE` is **48**. So 48 notes each holding
   * the maximum can be summed before the field wraps, and 49 cannot. The contract
   * comment says the bound leaves "no room to reach the modulus by adding a handful
   * of notes" — 48 is comfortably more than a handful and far more than any join-split
   * arity, so the claim holds. Worth pinning as an equality: the headroom is a
   * consequence of two constants that live in different files, and if either moves
   * this is the assertion that says by how much.
   *
   * (Written after getting it wrong: the first version of this test asserted
   * `MAX_NOTE_VALUE * 64n < FIELD_MODULUS`, which is FALSE — 2^248 × 64 is 2^254 and
   * the modulus is just under that. An over-confident inequality in a test about
   * overflow is precisely the wrong place to guess.)
   */
  it("leaves room for 48 maximum notes to be summed, and no more", () => {
    expect(FIELD_MODULUS / MAX_NOTE_VALUE).toBe(48n);
    expect(MAX_NOTE_VALUE * 48n).toBeLessThan(FIELD_MODULUS);
    expect(MAX_NOTE_VALUE * 49n).toBeGreaterThan(FIELD_MODULUS);
  });
});

describe("isInField", () => {
  it("accepts zero and the largest element, rejects the modulus itself", () => {
    expect(isInField(0n)).toBe(true);
    expect(isInField(FIELD_MODULUS - 1n)).toBe(true);
    expect(isInField(FIELD_MODULUS)).toBe(false);
    expect(isInField(FIELD_MODULUS + 1n)).toBe(false);
  });

  it("rejects negatives", () => {
    expect(isInField(-1n)).toBe(false);
  });
});

describe("intoField", () => {
  it("leaves an element that is already in range alone", () => {
    expect(intoField(7n)).toBe(7n);
    expect(intoField(FIELD_MODULUS - 1n)).toBe(FIELD_MODULUS - 1n);
  });

  it("reduces the modulus to zero and wraps just above it", () => {
    expect(intoField(FIELD_MODULUS)).toBe(0n);
    expect(intoField(FIELD_MODULUS + 5n)).toBe(5n);
  });

  it("folds a full 256-bit value into the field", () => {
    const big = (1n << 256n) - 1n;
    expect(isInField(intoField(big))).toBe(true);
  });

  it("refuses a negative rather than returning a negative residue", () => {
    /**
     * JavaScript's `%` keeps the sign of the dividend, so `-1n % FIELD_MODULUS`
     * is `-1n` — not an element. Throwing is the only safe answer: silently
     * returning `FIELD_MODULUS - 1n` would hide wherever the negative came from.
     */
    expect(() => intoField(-1n)).toThrow("negative");
  });
});

describe("toFieldHex / fromFieldHex", () => {
  it("always writes 32 bytes, however small the number", () => {
    expect(toFieldHex(0n)).toBe(`0x${"0".repeat(64)}`);
    expect(toFieldHex(1n)).toBe(`0x${"0".repeat(63)}1`);
    expect(toFieldHex(255n)).toBe(`0x${"0".repeat(62)}ff`);
  });

  it("round-trips the largest element", () => {
    const max = FIELD_MODULUS - 1n;
    expect(fromFieldHex(toFieldHex(max))).toBe(max);
  });

  it("refuses to render something that is not an element", () => {
    expect(() => toFieldHex(FIELD_MODULUS)).toThrow("not a field element");
  });

  it("refuses hex that is the wrong length, uppercase, or unprefixed", () => {
    for (const bad of ["0x1", "1".repeat(64), `0x${"A".repeat(64)}`, `0x${"0".repeat(65)}`]) {
      expect(() => fromFieldHex(bad), bad).toThrow("32-byte lowercase hex");
    }
  });

  /**
   * Well-formed hex that decodes above the modulus. Distinct from the shape check
   * above: this one is 64 valid lowercase digits, so only the value is wrong, and
   * the message has to say so or a caller will keep checking the format.
   */
  it("refuses well-formed hex that decodes above the modulus", () => {
    expect(() => fromFieldHex(`0x${"f".repeat(64)}`)).toThrow("at or above the field modulus");
  });
});

describe("assertNoteValue", () => {
  it("accepts one base unit and the maximum", () => {
    expect(() => assertNoteValue(1n)).not.toThrow();
    expect(() => assertNoteValue(MAX_NOTE_VALUE)).not.toThrow();
  });

  it("refuses zero and negatives with the amount in the message", () => {
    expect(() => assertNoteValue(0n)).toThrow("more than zero, got 0");
    expect(() => assertNoteValue(-5n)).toThrow("more than zero, got -5");
  });

  it("refuses one base unit over the maximum", () => {
    expect(() => assertNoteValue(MAX_NOTE_VALUE + 1n)).toThrow("2^248");
  });

  /**
   * The failure `intoField` exists to not commit. 2^248 + 1 folded into the field
   * is still 2^248 + 1 (it is in range), but the general shape — a quantity quietly
   * reduced — is what this pair of functions is split to prevent, so the bound is
   * asserted on the amount and folding is never reached.
   */
  it("is the checked path, not the folding path", () => {
    const over = MAX_NOTE_VALUE + 1n;
    expect(isInField(over)).toBe(true);
    expect(() => assertNoteValue(over)).toThrow();
  });
});

/**
 * Replace randomness with a script, for the length of one call.
 *
 * 🔴 **Do not write this as a spy that delegates to the original for some calls.**
 * MEASURED 2026-09-27: `const real = crypto.getRandomValues.bind(crypto)` and then
 * `return real(buf)` inside `mockImplementation` RE-ENTERS the spy — a single
 * `randomFieldElement()` that draws once was counted **5 times**. So a
 * passthrough spy cannot count draws, and a test that asserts a call count against
 * one is measuring the spy, not the function. (Confirmed by the control: a mock that
 * never delegates counted exactly 1.)
 *
 * Every call therefore gets its bytes from the script and nothing delegates. Each
 * entry fills all 32 bytes with one value, which is enough to sit either side of the
 * modulus and keeps the expected result readable.
 */
function withScriptedBytes<T>(fills: readonly number[], body: (draws: () => number) => T): T {
  let call = 0;
  const spy = vi.spyOn(crypto, "getRandomValues").mockImplementation((buf) => {
    const fill = fills[call];
    call += 1;
    if (fill === undefined) {
      throw new Error(
        `randomFieldElement asked for draw ${call} but the script only has ${fills.length}. ` +
          "Either it is looping when it should have accepted a value, or the script is short.",
      );
    }
    (buf as Uint8Array).fill(fill);
    return buf;
  });
  try {
    return body(() => call);
  } finally {
    spy.mockRestore();
  }
}

describe("randomFieldElement", () => {
  it("returns elements, and different ones each time", () => {
    const drawn = Array.from({ length: 32 }, () => randomFieldElement());
    for (const value of drawn) expect(isInField(value)).toBe(true);
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  /**
   * The rejection branch, forced.
   *
   * This is the half of the function that matters and the half that real randomness
   * will never exercise — the retry probability is under 2^-127, so a test that just
   * calls it a thousand times covers only the happy path and proves nothing about
   * what happens on a draw that is out of range. Feeding it all-`0xff` bytes once
   * (a value above the modulus) asserts it draws AGAIN rather than folding, which is
   * the entire reason this function is not `intoField(random)`.
   */
  it("draws again instead of folding when a draw lands out of field", () => {
    const value = withScriptedBytes(
      [
        /** 32 bytes of 0xff = 2^256 - 1, comfortably above the modulus. Must be rejected. */
        0xff,
        /** A second out-of-range draw, to prove it keeps going rather than retrying once. */
        0xff,
        /** In range: a 32-byte word of 0x01 is far below the modulus. Must be returned. */
        0x01,
      ],
      (draws) => {
        const drawn = randomFieldElement();
        expect(draws()).toBe(3);
        return drawn;
      },
    );

    /**
     * The returned value is the third draw verbatim, NOT the first folded. This is
     * the assertion that separates rejection sampling from `intoField(random)`:
     * folding would have returned `(2^256 - 1) mod FIELD_MODULUS` on the first draw.
     */
    expect(value).toBe(BigInt(`0x${"01".repeat(32)}`));
    expect(intoField((1n << 256n) - 1n)).not.toBe(value);
  });
});
