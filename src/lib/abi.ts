/**
 * `abi.encode` for the one case this app needs: a struct whose every member is a
 * static type.
 *
 * ── Why this is written out rather than pulled from a library ─────────────────
 * For static members there is nothing to it — no offsets, no length prefixes, no
 * tail. The encoding *is* the 32-byte words concatenated, in order. That is small
 * enough to write from the specification and pin against the compiler, which
 * `contracts/test/ShieldedPool.t.sol` does with a checked-in 128-byte literal that
 * `tests/transaction.test.ts` reads back out.
 *
 * ── Why it is its own file ───────────────────────────────────────────────────
 * `writeWord` was a private helper in `lib/transaction.ts`, and the EIP-712 work
 * needed the identical loop. Two copies of a byte-layout routine is the same smell
 * as the four copies of the address regex that `lib/address.ts` was written to fold
 * together, and worse in one respect: both copies sit on a path where the bytes are
 * hashed and the hash is what a signature or a proof commits to. Two layouts that
 * agree today and diverge later do not produce an error — they produce a valid
 * signature over a different transaction.
 *
 * ── Status: NOT IN THE PRODUCTION BUNDLE ─────────────────────────────────────
 * ⚠️ Measured 2026-09-28: both importers — `lib/transaction.ts` and `lib/eip712.ts` —
 * are themselves unreached from `src/`, so this file is tree-shaken out. Confirmed by
 * `grep -cF 'does not fit a 256-bit' dist/assets/*.js` → 0. Recorded because the usual
 * signals say the opposite: 100% coverage plus a vector the Solidity suite asserts is
 * what a wired-up module looks like. Re-grep rather than trusting this paragraph.
 *
 * ── 🔴 An out-of-range word throws; it is NOT masked ─────────────────────────
 * The version this replaced masked, one byte at a time, because that is what falls
 * out of writing the loop the obvious way — `out[i] = Number(v & 0xffn); v >>= 8n`
 * simply stops caring once it has taken 32 bytes. Nothing in the repo could ever
 * reach it, and it must still throw, because of what silence would mean *here*: a
 * value too large for a word is an upstream bug, and masking it produces a
 * well-formed encoding of a number nobody chose. Downstream that becomes a struct
 * hash, then a digest, then a signature. The user reads `value` off a screen and
 * signs `value mod 2^256`. Refusing is the only behaviour that keeps the bytes and
 * the screen describing the same thing.
 */

/** The width of one ABI word. Named because a bare `32` next to a `bytes32` is ambiguous. */
export const WORD_BYTES = 32;

/** One more than the largest value a 256-bit word holds. */
const WORD_MODULUS = 1n << 256n;

/**
 * `abi.encode(...)` of static members: `words.length * 32` bytes, big-endian.
 *
 * Takes already-encoded `uint256` words, so the *interpretation* of each member
 * stays with the caller who knows its type — `int256` arrives two's-complemented,
 * an `address` arrives left-padded by `addressToUint`, a `bytes32` arrives through
 * `wordFromBytes32`. This function's entire job is the layout, and keeping the
 * type conversions out of it is what makes it reusable without becoming a
 * mini-ABI-coder with its own set of mistakes to make.
 */
export function encodeWords(words: readonly bigint[]): Uint8Array {
  const out = new Uint8Array(words.length * WORD_BYTES);
  for (const [index, word] of words.entries()) {
    if (word < 0n || word >= WORD_MODULUS) {
      throw new Error(
        `Word ${index} does not fit a 256-bit ABI word: ${word}. Nothing was truncated — ` +
          "a value this size means the caller encoded the wrong type, and a masked word " +
          "would be hashed and signed as if it were the value on screen.",
      );
    }
    let remaining = word;
    for (let byte = WORD_BYTES - 1; byte >= 0; byte--) {
      out[index * WORD_BYTES + byte] = Number(remaining & 0xffn);
      remaining >>= 8n;
    }
  }
  return out;
}

/**
 * 32 raw bytes as the word the ABI encodes them to.
 *
 * ⚠️ **The length check is the point, not the conversion.** A `bytes32` shorter than
 * 32 bytes has no natural encoding: left-padding it — which is what a big-endian read
 * silently does — turns `0xabcd` into `0x00…00abcd`, a *different* 32-byte value that
 * encodes without complaint. For an EIP-3009 nonce that means an authorization
 * committed to a nonce the caller never generated, so the one guarantee a nonce
 * provides (this authorization is spendable once) is attached to the wrong label.
 */
export function wordFromBytes32(bytes: Uint8Array, label: string): bigint {
  if (bytes.length !== WORD_BYTES) {
    throw new Error(
      `${label} must be exactly ${WORD_BYTES} bytes, got ${bytes.length}. ` +
        "Nothing was padded: a shorter value left-padded to 32 bytes is a different value.",
    );
  }
  let word = 0n;
  for (const byte of bytes) word = (word << 8n) | BigInt(byte);
  return word;
}
