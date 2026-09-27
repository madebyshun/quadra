/**
 * Keccak-256 against an authority, plus the two structural facts a digest cannot name.
 *
 * ── Where these vectors come from ────────────────────────────────────────────
 * Every digest below was produced by `cast keccak` (Foundry) on this machine, not
 * recalled and not copied from a web page. That distinction is the whole reason
 * `src/lib/keccak.ts` is allowed to exist as hand-written code at all — see its
 * header, and hard rule 9. The commands were:
 *
 *     cast keccak 0x                                   # the empty message
 *     cast keccak 0x616263                             # "abc"
 *     cast keccak 0x00
 *     cast keccak "$(python3 -c "print('0x'+''.join('%02x'%(i%256) for i in range(N)))")"
 *
 * for N in 135, 136, 137, 272, 273 — the counting-bytes message built by `counting()`
 * below. Regenerate with those exact commands if a vector is ever doubted; do not
 * "fix" one by running this code and pasting its answer back, which would turn the
 * test into a tautology.
 *
 * ── Why these particular lengths ─────────────────────────────────────────────
 * The sponge absorbs 136 bytes at a time, so the padding is where a correct-looking
 * implementation goes wrong:
 *
 *   - **0** — the pad is the whole block, and `keccak256("")` is the one Keccak vector
 *     most likely to be remembered rather than measured, so it is also the one worth
 *     having from a tool.
 *   - **135** — one byte short of the rate. The first pad byte and the last pad bit
 *     land in the **same byte**, which must come out `0x81`. An implementation that
 *     writes `0x01` and then overwrites it with `0x80` gives a wrong digest here and a
 *     right one everywhere else.
 *   - **136** — exactly the rate, so the padding needs an **entire extra block**. The
 *     natural off-by-one is to emit no pad block at all.
 *   - **137** — one past the rate: two blocks, the second nearly all padding.
 *   - **272 / 273** — twice the rate and one past it, so the absorb loop runs more
 *     than twice. A loop that only ever handled two blocks would pass 137 and fail
 *     here.
 */

import { describe, expect, it } from "vitest";

import {
  DIGEST_BYTES,
  keccak256,
  keccak256Uint,
  roundConstants,
  rhoPi,
  toHex,
  utf8,
} from "@/lib/keccak";

/**
 * The message `cast` was given: byte `i` is `i % 256`.
 *
 * A counting sequence rather than zeros or random bytes. Zeros would hide a lane that
 * is never written, because the state starts at zero too — an absorb loop that skipped
 * every eighth byte would produce the right digest for an all-zero message and the
 * wrong one for everything else. Random bytes could not be regenerated to re-run
 * `cast`.
 */
function counting(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = i % 256;
  return out;
}

describe("keccak256 against cast", () => {
  it("hashes the empty message", () => {
    expect(toHex(keccak256(new Uint8Array(0)))).toBe(
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
  });

  it("hashes a single zero byte, which is not the empty message", () => {
    const empty = toHex(keccak256(new Uint8Array(0)));
    const oneZero = toHex(keccak256(new Uint8Array([0])));
    expect(oneZero).toBe("0xbc36789e7a1e281436464229828f817d6612f7b477d66591ff96a9e064bcc98a");
    /**
     * Asserted against each other as well as against `cast`, because "the length is
     * absorbed" is the property at stake and a padding scheme that ignored a trailing
     * zero byte would make these two equal.
     */
    expect(oneZero).not.toBe(empty);
  });

  it("hashes utf-8 text", () => {
    expect(toHex(keccak256(utf8("abc")))).toBe(
      "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
    );
  });

  it("hashes 135 bytes, where both pad bits share one byte", () => {
    expect(toHex(keccak256(counting(135)))).toBe(
      "0xcbdfd9dee5faad3818d6b06f95a219fd290b0e1706f6a82e5a595b9ce9faca62",
    );
  });

  it("hashes exactly one rate of bytes, which needs a whole pad block", () => {
    expect(toHex(keccak256(counting(136)))).toBe(
      "0x7ce759f1ab7f9ce437719970c26b0a66ff11fe3e38e17df89cf5d29c7d7f807e",
    );
  });

  it("hashes one byte past the rate", () => {
    expect(toHex(keccak256(counting(137)))).toBe(
      "0xac73d4fae68b8453f764007c1a20ce95994187861f0c3227a3a8e99a73a3b1db",
    );
  });

  it("hashes two full rates, so the absorb loop runs more than twice", () => {
    expect(toHex(keccak256(counting(272)))).toBe(
      "0xfdf2ec49e749960d3c8521a0219af8d03e30e2b3bf19bd16150ee0eaf133d66e",
    );
  });

  it("hashes one byte past two full rates", () => {
    expect(toHex(keccak256(counting(273)))).toBe(
      "0x4f707289a9c3ccd0c4a51f2f17339f5dd171d371c04ff7783b735b5b22682eaf",
    );
  });

  /**
   * 🔴 The one vector that makes this file part of the product rather than a
   * standalone hash test.
   *
   * `contracts/src/MerkleTreeWithHistory.sol` derives its empty leaf from
   * `keccak256("quadra.shielded-pool.empty-leaf")`, and until now the browser could
   * not compute that number — which is the whole of TASKS.md step 1d, and why
   * `LocalShieldedPool` derives its own empty leaf from the stand-in hash instead and
   * therefore computes roots the deployed pool does not recognise.
   *
   * This asserts the browser can now reach the contract's value. It deliberately does
   * **not** change what the local pool uses: interior nodes still go through the
   * stand-in hash, so matching the empty leaf alone would move every local root
   * without making any of them provable, and would invalidate every saved pool file
   * for no gain. The leaf becomes the contract's when Poseidon does.
   */
  it("reproduces the contract's empty-leaf preimage", () => {
    expect(toHex(keccak256(utf8("quadra.shielded-pool.empty-leaf")))).toBe(
      "0x4e6929872d193f60a3c3410cec013eb078cf2b655cfa5121a7d92d8cb266c043",
    );
  });

  it("always returns 32 bytes", () => {
    expect(keccak256(new Uint8Array(0))).toHaveLength(DIGEST_BYTES);
    expect(keccak256(counting(1000))).toHaveLength(DIGEST_BYTES);
  });
});

describe("keccak256Uint", () => {
  /**
   * Big-endian, matching `uint256(bytes32)` in Solidity, while the sponge's own lanes
   * are little-endian. Both are correct and conflating them yields a byte-reversed
   * field element that is in range and wrong — so this pins the direction against a
   * digest whose first and last bytes differ, which `0xc5d2…a470` does.
   */
  it("reads the digest big-endian, the way the EVM does", () => {
    const digest = keccak256(new Uint8Array(0));
    expect(keccak256Uint(new Uint8Array(0))).toBe(BigInt(toHex(digest)));
  });

  it("puts the digest's leading byte in the most significant position", () => {
    const value = keccak256Uint(new Uint8Array(0));
    expect(value >> 248n).toBe(0xc5n);
    expect(value & 0xffn).toBe(0x70n);
  });
});

/**
 * The two facts a vector cannot localise.
 *
 * A wrong digest says "something below is wrong". These two say which thing, and they
 * are the assertions `keccak.ts` promises in its comments on `rhoPi` and
 * `roundConstants` — written here rather than left as prose, because a claimed
 * invariant with no check behind it is how a warning ages into a false alarm.
 */
describe("the derived tables, which no digest can name", () => {
  it("makes π a permutation of all 25 lanes", () => {
    const { pi } = rhoPi();
    expect(pi).toHaveLength(25);
    /**
     * Sorted-and-compared rather than "every value is in range", which a table that
     * wrote lane 7 twice and never wrote lane 12 would also satisfy. A duplicate
     * destination would drop a lane's contribution entirely and make Keccak-f
     * non-invertible.
     *
     * ⚠️ **This does not pin the walk's coefficients, and MEASURED it is weaker than it
     * looks.** Mutating `2x + 3y` to `2x + 2y` in `rhoPi` leaves this test green — that
     * map happens to permute the 24 non-centre lanes too — and only the `cast` vectors
     * above catch it (9 of them went red). Mutating `nextX = y` to `nextX = x` does trip
     * this one, because that walk revisits lanes.
     *
     * So the division of labour is: the vectors pin *which* permutation, this pins that
     * it **is** one. Worth writing down, because the obvious reading is that a test named
     * "is a permutation" guards the walk, and it does not.
     */
    expect([...pi].sort((a, b) => a - b)).toEqual([...Array(25).keys()]);
  });

  it("leaves the centre lane alone in both ρ and π", () => {
    const { rho, pi } = rhoPi();
    expect(pi[0]).toBe(0);
    expect(rho[0]).toBe(0);
  });

  it("keeps every ρ offset inside a 64-bit lane", () => {
    const { rho } = rhoPi();
    expect(rho).toHaveLength(25);
    for (const offset of rho) {
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(64);
    }
    /**
     * And not all zero, which is the shape a walk that never advanced would produce —
     * every offset in range, every digest wrong.
     */
    expect(rho.filter((r) => r !== 0)).toHaveLength(24);
  });

  it("runs one LFSR across all 24 rounds rather than restarting it", () => {
    const constants = roundConstants();
    expect(constants).toHaveLength(24);
    /**
     * Re-seeding the register inside the round loop — the natural way to write it, and
     * the mistake the comment in `keccak.ts` warns about — yields 24 *identical*
     * constants, which leaves ι contributing the same value every round. Every digest
     * would be wrong and no digest would say why, so the continuity is asserted here.
     *
     * MEASURED by moving the `let register = 1` inside the loop: 12 tests go red, all 24
     * constants come out `1n` — and note which test stays **green** through it, because it
     * is the reason there are two. `rc(0) = 1` below passes, since round 0 is the one round
     * a restart cannot corrupt. A suite holding only that assertion would report healthy.
     *
     * ⚠️ This test first asserted all 24 were **distinct** and failed at 22, while all
     * nine `cast` vectors above passed. The vectors are the authority, so the test was
     * wrong, not the code: Keccak's round constants genuinely collide twice. MEASURED
     * from this implementation and pinned below, because "the constants are distinct"
     * is an assumption the next person to write this test will also make.
     */
    expect(new Set(constants).size).toBe(22);
  });

  it("collides exactly where a 255-periodic register consumed 7 bits a round must", () => {
    const constants = roundConstants();
    /**
     * A far stronger pin than the count, and the reason the count above is safe to
     * state as 22 rather than as "fewer than 24": these two pairs are where the
     * register's sampled bits repeat, and any mis-stepping moves them. Asserting the
     * positions rather than the values keeps this independent of the table itself.
     */
    expect(constants[5]).toBe(constants[22]);
    expect(constants[6]).toBe(constants[20]);
    /** And nothing else repeats — 24 entries, 2 collisions, 22 distinct. */
    expect(constants.filter((c, i) => constants.indexOf(c) !== i)).toHaveLength(2);
  });

  it("starts at the spec's rc(0) = 1", () => {
    /**
     * Independently known: the spec defines `rc(t) = 1` for `t % 255 == 0`, so round 0
     * bit 0 is the seed itself. A register sampled *after* stepping instead of before
     * gives 0 here, which is an off-by-one no property above would catch.
     */
    expect(roundConstants()[0]).toBe(1n);
  });

  it("keeps every round constant inside a 64-bit lane", () => {
    for (const constant of roundConstants()) {
      expect(constant).toBeGreaterThanOrEqual(0n);
      expect(constant).toBeLessThan(1n << 64n);
    }
  });
});
