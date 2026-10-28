/**
 * Keccak-256, in the browser, with no dependency and no tabulated constants.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * The pool binds every payout to `uint256(keccak256(abi.encode(extData))) %
 * FIELD_SIZE`. Until this file existed the browser could not compute that number, so
 * `lib/transaction.ts` had to return "unavailable" for the one public input that says
 * who gets paid, and `assertAddress` could check an address's shape but not its EIP-55
 * checksum — meaning a mistyped recipient was an irreversible payment to nobody and
 * nothing here could tell.
 *
 * `crypto.subtle` cannot help. It offers SHA-1 and the SHA-2 family, and Ethereum's
 * keccak-256 is **not** SHA-3-256 even though both are Keccak: SHA-3 appends the
 * domain-separation bits `01` before the pad, so the two functions disagree on every
 * input. Substituting SHA-256 would have produced a number that is deterministic,
 * in-field, collision-resistant, accepted by every test — and wrong, which is the
 * failure mode hard rule 9 exists about.
 *
 * ── Why writing it by hand is allowed here, and is NOT a rule-9 violation ─────
 * Hard rule 9 forbids writing Poseidon's constants from memory. The reason is not
 * that hand-written cryptography is sinful; it is that a wrong Poseidon is
 * **unfalsifiable locally** — it hashes, it is deterministic, it is collision-free,
 * it passes every test anybody can write in this repo, and it matches no circuit. The
 * error surfaces only against a generated verifier nobody has yet.
 *
 * Keccak is the opposite case in the one way that matters: a reference
 * implementation is on this machine. `tests/keccak.test.ts` pins digests taken from
 * `cast keccak`, and a single wrong bit anywhere below — one rotation offset, one
 * round constant, one padding byte — changes every digest it produces. There is no
 * "passes locally but disagrees with the chain" middle ground, because the chain's
 * answer is the thing being compared against. The discipline rule 9 demands is
 * "arrives with checked-in vectors from an authority, or does not arrive", and that
 * is satisfied. It is the *unverifiable* constant that is forbidden, not the
 * hand-written function.
 *
 * ── No tables, at all, on purpose ────────────────────────────────────────────
 * Keccak is usually shipped with three constant tables: 24 round constants, 25
 * rotation offsets, and a lane permutation. Every one of them is **derived** below
 * from the definition instead — the round constants from the LFSR that generates
 * them, the rotation offsets from the triangular-number walk, the permutation from
 * that same walk. A transcribed table is a rule-9 hazard in miniature: nobody
 * reviewing a wall of hex can tell a typo from a constant, and a typo in it would be
 * caught here only by the vectors. Generating them means the code states the reason
 * each number has the value it has, and the walk is additionally checked for the
 * property it must have (see `rhoPi`).
 *
 * ── What this is NOT ─────────────────────────────────────────────────────────
 * 🔴 **Not a replacement for Poseidon, and it must never become one.** It is
 * tempting, because `contracts/test/TestHasher` is keccak-based, so a keccak-backed
 * `FieldHash` would make the browser agree with the Solidity suite's own deployment.
 * It would still be a hash no circuit can cheaply prove, so every commitment and
 * every root it produced would be unprovable — the `scheme: "stand-in"` tag in
 * `lib/hash.ts` stays, and `assertCircuitReady` keeps refusing. Agreeing with a test
 * double is not the same as being correct.
 */

/** A 256-bit digest is 32 bytes. Named because a short digest folded into the field is a valid-looking wrong answer. */
export const DIGEST_BYTES = 32;

/**
 * How many bytes are absorbed per permutation: `(1600 - 2 * 256) / 8`.
 *
 * Derived rather than written as 136 so the relationship to the digest size is
 * visible. A rate that disagrees with the capacity is not a performance bug — it is a
 * different hash function that looks like this one.
 */
const RATE = (1600 - 2 * DIGEST_BYTES * 8) / 8;

/** Lanes in the state: a 5x5 grid of 64-bit words. */
const LANES = 25;

/** 12 + 2 * log2(1600 / 25) = 24, for every Keccak-f[1600] instance. */
const ROUNDS = 24;

const MASK64 = (1n << 64n) - 1n;

/**
 * The first pad byte, and the entire difference between this and SHA-3-256.
 *
 * Original Keccak pads `10*1`; SHA-3 prepends the domain bits `01`, making its first
 * pad byte `0x06`. Ethereum uses the original, so this is `0x01`. Written as a named
 * constant with this comment because the two differ by one bit in one byte, and the
 * resulting function passes every structural test while disagreeing with every
 * contract.
 */
const PAD_FIRST = 0x01;

/** The final pad bit, set in the last byte of the block. */
const PAD_LAST = 0x80;

/**
 * Rotate a 64-bit lane left.
 *
 * No `by === 0` special case, deliberately: at `by === 0` the expression is
 * `value << 0n | value >> 64n`, and `value >> 64n` is `0n`, so it already returns
 * `value`. A guard would be an unreachable branch sitting against the 100% coverage
 * requirement forever — the same reason `SendPanel`'s null-ref check was removed.
 */
function rotl(value: bigint, by: number): bigint {
  return ((value << BigInt(by)) | (value >> BigInt(64 - by))) & MASK64;
}

/**
 * The ρ rotation offsets and the π lane permutation, from the single walk that
 * defines both.
 *
 * Keccak's ρ and π are two views of one traversal: starting at lane (1, 0), the map
 * `(x, y) -> (y, 2x + 3y mod 5)` visits all 24 non-centre lanes exactly once before
 * returning to its start. The rotation applied at the `t`-th stop is the `t`-th
 * triangular number mod 64, and the lane at each stop moves to the next stop. So both
 * tables fall out of one loop, and neither has to be transcribed.
 *
 * The centre lane (0, 0) is outside the walk: it rotates by zero and π maps it to
 * itself.
 *
 * ⚠️ That "visits all 24 exactly once" claim is the file's one silent assumption — if
 * the walk revisited a lane, π would write one destination twice and leave another
 * unwritten, and Keccak-f would stop being invertible. `tests/keccak.test.ts` asserts
 * the permutation property directly rather than inferring it from a digest, because a
 * digest test says only "something is wrong somewhere".
 *
 * Exported for that test alone, which is why it returns the tables rather than reading
 * module-level ones — same reasoning as `messageOf` in `lib/transaction.ts`: a property
 * no output can reveal is worth reaching directly rather than approximating with a
 * contrived input.
 */
export function rhoPi(): { rho: readonly number[]; pi: readonly number[] } {
  const rho = new Array<number>(LANES).fill(0);
  const pi = new Array<number>(LANES).fill(0);

  let x = 1;
  let y = 0;
  for (let t = 0; t < LANES - 1; t++) {
    const from = x + 5 * y;
    rho[from] = (((t + 1) * (t + 2)) / 2) % 64;
    const nextX = y;
    const nextY = (2 * x + 3 * y) % 5;
    pi[from] = nextX + 5 * nextY;
    x = nextX;
    y = nextY;
  }

  return { rho, pi };
}

/**
 * The 24 round constants, from the LFSR that defines them.
 *
 * Each constant has at most 7 bits set, at positions `2^j - 1`, and bit `j` of round
 * `i` is the `(7i + j)`-th output of the 8-bit register `x^8 + x^6 + x^5 + x^4 + 1`.
 * The register runs continuously across rounds, which is why it is seeded once
 * outside the loop — restarting it per round is a plausible-looking mistake that
 * yields 24 identical constants and a hash whose rounds are all the same.
 *
 * Sampled before stepping, so round 0 bit 0 reads the seed and `roundConstants()[0]`
 * is `1n`, matching the spec's `rc(0) = 1`.
 *
 * Exported for the same reason as `rhoPi`: the restart mistake produces 24 *identical*
 * constants, and a test asserting they are distinct names that cause directly, where a
 * failing digest would only say the hash is wrong somewhere.
 */
export function roundConstants(): readonly bigint[] {
  const constants: bigint[] = [];
  let register = 1;

  for (let round = 0; round < ROUNDS; round++) {
    let constant = 0n;
    for (let j = 0; j < 7; j++) {
      if ((register & 1) !== 0) constant |= 1n << BigInt((1 << j) - 1);
      register <<= 1;
      // Reduce modulo the generator polynomial: 0x171 clears bit 8 and folds the taps back in.
      if ((register & 0x100) !== 0) register ^= 0x171;
    }
    constants.push(constant);
  }

  return constants;
}

const { rho: RHO, pi: PI } = rhoPi();
const RC = roundConstants();

/**
 * Read a lane. `noUncheckedIndexedAccess` is on, so every index yields `bigint |
 * undefined`; this is the same `as` idiom `lib/tree.ts` uses for the same reason.
 * Every index in this file is a loop bound or a value out of `RHO`/`PI`, all of which
 * are in `0..24` by construction.
 */
function lane(state: readonly bigint[], index: number): bigint {
  return state[index] as bigint;
}

/** Keccak-f[1600], in place: θ, ρ, π, χ, ι, twenty-four times. */
function permute(state: bigint[]): void {
  for (let round = 0; round < ROUNDS; round++) {
    // θ — fold each column's parity into every lane of the neighbouring columns.
    const parity: bigint[] = [];
    for (let x = 0; x < 5; x++) {
      parity.push(
        lane(state, x) ^
          lane(state, x + 5) ^
          lane(state, x + 10) ^
          lane(state, x + 15) ^
          lane(state, x + 20),
      );
    }
    for (let x = 0; x < 5; x++) {
      const delta = lane(parity, (x + 4) % 5) ^ rotl(lane(parity, (x + 1) % 5), 1);
      for (let y = 0; y < 5; y++) state[x + 5 * y] = lane(state, x + 5 * y) ^ delta;
    }

    // ρ and π together — rotate each lane, then move it to its destination. Written
    // into a fresh array because π is a permutation, not a shift: writing in place
    // would overwrite lanes that have not been read yet.
    const moved = new Array<bigint>(LANES).fill(0n);
    for (let i = 0; i < LANES; i++) {
      moved[PI[i] as number] = rotl(lane(state, i), RHO[i] as number);
    }

    // χ — the only non-linear step.
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const next = lane(moved, ((x + 1) % 5) + 5 * y);
        const after = lane(moved, ((x + 2) % 5) + 5 * y);
        state[x + 5 * y] = lane(moved, x + 5 * y) ^ (~next & after & MASK64);
      }
    }

    // ι — break the symmetry that the other four steps preserve.
    state[0] = lane(state, 0) ^ (RC[round] as bigint);
  }
}

/**
 * The digest of `message`.
 *
 * Sponge construction: absorb `RATE` bytes at a time into the low lanes, permuting
 * after each full block, then squeeze the first `DIGEST_BYTES` bytes back out. Lanes
 * are little-endian, which is a real decision and not an implementation detail — a
 * big-endian reading produces a well-formed digest for every input and the wrong one
 * for all of them.
 *
 * ── Why `bigint` lanes rather than pairs of 32-bit words ─────────────────────
 * The fast implementations split each 64-bit lane in two because JavaScript numbers
 * cannot hold one. That doubles the index arithmetic in the step that is hardest to
 * get right, to buy speed this repo has no use for: keccak is reached a handful of
 * times per transaction, never in a loop over notes, and never in a render. Clarity
 * is the right trade here, and if that ever stops being true the vectors already pin
 * the answer a faster version has to reproduce.
 */
export function keccak256(message: Uint8Array): Uint8Array {
  const state = new Array<bigint>(LANES).fill(0n);

  /**
   * The padded message, built as one buffer rather than absorbed in a streaming loop
   * with a tail case afterwards. Padding always adds at least one byte and fills to a
   * whole number of blocks, so `RATE - (length % RATE)` is in `1..RATE` and the two
   * pad bytes land in the same byte when it is 1 — which is the case a tail branch
   * gets wrong. `tests/keccak.test.ts` pins lengths 135, 136 and 137 for exactly this.
   */
  const padding = RATE - (message.length % RATE);
  const padded = new Uint8Array(message.length + padding);
  padded.set(message, 0);
  padded[message.length] = PAD_FIRST;
  padded[padded.length - 1] = (padded[padded.length - 1] as number) | PAD_LAST;

  for (let offset = 0; offset < padded.length; offset += RATE) {
    for (let i = 0; i < RATE; i++) {
      const laneIndex = Math.floor(i / 8);
      const byteInLane = BigInt((i % 8) * 8);
      state[laneIndex] =
        lane(state, laneIndex) ^ (BigInt(padded[offset + i] as number) << byteInLane);
    }
    permute(state);
  }

  const out = new Uint8Array(DIGEST_BYTES);
  for (let i = 0; i < DIGEST_BYTES; i++) {
    out[i] = Number((lane(state, Math.floor(i / 8)) >> BigInt((i % 8) * 8)) & 0xffn);
  }
  return out;
}

/**
 * UTF-8 bytes of a string.
 *
 * Here rather than at each call site so that "the bytes of a domain tag" means one
 * thing everywhere. `TextEncoder` is UTF-8 by specification and takes no encoding
 * argument, so there is no configuration to get wrong.
 */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** A digest as `0x` + 64 lowercase hex characters, the form an explorer shows. */
export function toHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A digest as the big-endian integer the EVM reads it as.
 *
 * Big-endian **here**, little-endian inside the sponge, and both are correct: the
 * sponge's lanes are little-endian by Keccak's definition, while `uint256(bytes32)`
 * in Solidity reads the 32 output bytes big-endian. Conflating the two gives a
 * byte-reversed field element that is in range and wrong, so the conversion lives in
 * one named function rather than being written out wherever it is needed.
 */
export function keccak256Uint(message: Uint8Array): bigint {
  let value = 0n;
  for (const byte of keccak256(message)) value = (value << 8n) | BigInt(byte);
  return value;
}
