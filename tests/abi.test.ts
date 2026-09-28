import { describe, expect, it } from "vitest";
import { WORD_BYTES, encodeWords, wordFromBytes32 } from "@/lib/abi";

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

describe("laying out static words", () => {
  it("gives 32 bytes per word and nothing else", () => {
    expect(encodeWords([]).length).toBe(0);
    expect(encodeWords([0n]).length).toBe(WORD_BYTES);
    expect(encodeWords([1n, 2n, 3n]).length).toBe(3 * WORD_BYTES);
  });

  /**
   * Big-endian, which is the half of this that a byte-reversed implementation gets
   * wrong while still producing a well-formed 32-byte word. Asserted as the position of
   * the significant byte rather than as a whole hex string, so the failure names the
   * end it landed on.
   */
  it("writes a word big-endian, so the value is at the high-index end", () => {
    const one = encodeWords([1n]);
    expect(one[31]).toBe(1);
    expect(one[0]).toBe(0);
  });

  it("left-pads a small value with zeros", () => {
    expect(hex(encodeWords([0xabn]))).toBe(`${"00".repeat(31)}ab`);
  });

  it("fills every byte of the largest word", () => {
    expect(hex(encodeWords([(1n << 256n) - 1n]))).toBe("ff".repeat(32));
  });

  it("keeps the caller's order", () => {
    expect(hex(encodeWords([1n, 2n]))).toBe(
      `${"00".repeat(31)}01${"00".repeat(31)}02`,
    );
  });

  /**
   * 🔴 The reason this function throws instead of masking. `2^256` masks to zero, and a
   * zero `value` word is a *free* authorization — a wrong number that reads as a
   * deliberate one. The old private `writeWord` in `transaction.ts` masked, because a
   * byte-at-a-time loop simply stops caring past 32 bytes.
   */
  it("refuses a word that does not fit, rather than masking it to something plausible", () => {
    expect(() => encodeWords([1n << 256n])).toThrow(/does not fit a 256-bit ABI word/);
    expect(() => encodeWords([1n << 256n])).toThrow(/Nothing was truncated/);
    expect(() => encodeWords([-1n])).toThrow(/does not fit a 256-bit ABI word/);
  });

  it("names which word was out of range, so a seven-member struct is debuggable", () => {
    expect(() => encodeWords([0n, 0n, 1n << 300n])).toThrow(/Word 2 /);
  });

  it("accepts the largest legal word and rejects the next one", () => {
    const max = (1n << 256n) - 1n;
    expect(() => encodeWords([max])).not.toThrow();
    expect(() => encodeWords([max + 1n])).toThrow(/does not fit/);
  });
});

describe("a bytes32 as a word", () => {
  it("reads 32 bytes big-endian", () => {
    const bytes = new Uint8Array(32);
    bytes[31] = 1;
    expect(wordFromBytes32(bytes, "nonce")).toBe(1n);
    bytes[31] = 0;
    bytes[0] = 1;
    expect(wordFromBytes32(bytes, "nonce")).toBe(1n << 248n);
  });

  it("round-trips through encodeWords", () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    expect(hex(encodeWords([wordFromBytes32(bytes, "nonce")]))).toBe(hex(bytes));
  });

  /**
   * ⚠️ The check that matters. A 31-byte nonce left-padded to 32 is a *different*
   * nonce that encodes without complaint, so an authorization would commit to a label
   * the caller never generated.
   */
  it.each([0, 31, 33, 64])("refuses a %i-byte value instead of padding it", (length) => {
    expect(() => wordFromBytes32(new Uint8Array(length), "nonce")).toThrow(
      /must be exactly 32 bytes/,
    );
    expect(() => wordFromBytes32(new Uint8Array(length), "nonce")).toThrow(
      /Nothing was padded/,
    );
  });

  it("names the field, because a struct has more than one bytes32 in it", () => {
    expect(() => wordFromBytes32(new Uint8Array(4), "nonce")).toThrow(/^nonce must be/);
  });
});
