/**
 * The note scheme: what a commitment binds, what a nullifier identifies, and what
 * the tagged types refuse to let through.
 *
 * ── The test this file replaces ──────────────────────────────────────────────
 * The old assertion about commitments lived in `adapters.test.ts` and read, in
 * full: the commitment is 32 hex bytes and differs from the secret. `randomHex(32)`
 * satisfies both, which is why it passed for as long as that was what `deposit`
 * returned. The lesson is not "write more tests" — it is that a test asserting the
 * SHAPE of a cryptographic value asserts nothing about it. Everything below
 * recomputes or varies an input and checks the output moves accordingly.
 */

import { describe, expect, it } from "vitest";
import { FIELD_MODULUS, isInField, toFieldHex } from "@/lib/field";
import { standInHash } from "@/lib/hash";
import type { FieldHash } from "@/lib/hash";
import {
  commitmentHex,
  deriveCommitment,
  deriveNullifier,
  derivePaddingCommitment,
  newNoteSecret,
} from "@/lib/note";

const SECRET = 12345678901234567890n;

describe("newNoteSecret", () => {
  it("is a non-zero field element", () => {
    for (let i = 0; i < 16; i++) {
      const secret = newNoteSecret();
      expect(isInField(secret)).toBe(true);
      expect(secret).not.toBe(0n);
    }
  });

  it("is different every time", () => {
    const drawn = Array.from({ length: 32 }, () => newNoteSecret());
    expect(new Set(drawn).size).toBe(drawn.length);
  });
});

describe("deriveCommitment", () => {
  it("is deterministic for the same amount and secret", async () => {
    const a = await deriveCommitment(standInHash, { amount: 100n, secret: SECRET });
    const b = await deriveCommitment(standInHash, { amount: 100n, secret: SECRET });
    expect(a).toEqual(b);
  });

  /**
   * The binding property, stated as the two things it must separately depend on.
   * A commitment that ignored the amount would let a note be spent as any value;
   * one that ignored the secret would be recomputable by anybody who knew the
   * amount, which is public.
   */
  it("changes when the amount changes", async () => {
    const one = await deriveCommitment(standInHash, { amount: 100n, secret: SECRET });
    const two = await deriveCommitment(standInHash, { amount: 101n, secret: SECRET });
    expect(one.value).not.toBe(two.value);
  });

  it("changes when the secret changes", async () => {
    const one = await deriveCommitment(standInHash, { amount: 100n, secret: SECRET });
    const two = await deriveCommitment(standInHash, { amount: 100n, secret: SECRET + 1n });
    expect(one.value).not.toBe(two.value);
  });

  it("carries the scheme tag and the reason through", async () => {
    const commitment = await deriveCommitment(standInHash, { amount: 1n, secret: SECRET });
    expect(commitment.scheme).toBe("stand-in");
    if (commitment.scheme === "stand-in") {
      expect(commitment.why).toBe(standInHash.whyNotCircuitReady);
    }
  });

  /**
   * The amount is CHECKED, never folded — `intoField` on an amount would turn
   * 2^248 + 1 tokens into 1 token and the receipt would read as normal. So the
   * bound arrives here as a thrown sentence rather than as a quietly smaller note.
   */
  it("refuses an amount outside what a note may hold", async () => {
    const max = 1n << 248n;
    await expect(deriveCommitment(standInHash, { amount: 0n, secret: SECRET })).rejects.toThrow(
      "more than zero",
    );
    await expect(
      deriveCommitment(standInHash, { amount: max + 1n, secret: SECRET }),
    ).rejects.toThrow("2^248");
  });

  it("refuses a secret that is not a field element", async () => {
    await expect(
      deriveCommitment(standInHash, { amount: 1n, secret: FIELD_MODULUS }),
    ).rejects.toThrow("must be a field element");
  });

  /**
   * Zero is in the field and is what an uninitialised variable holds, so a bug that
   * forgets to call `newNoteSecret()` produces a note whose commitment anybody can
   * recompute. The message says so rather than saying "invalid secret".
   */
  it("refuses a zero secret, and says what a zero secret means", async () => {
    await expect(deriveCommitment(standInHash, { amount: 1n, secret: 0n })).rejects.toThrow(
      "uninitialised variable",
    );
  });
});

/**
 * The second door, and what it does NOT relax.
 *
 * `derivePaddingCommitment` exists only so a 2-in/2-out transaction can fill an unused
 * output slot with a real commitment to a note worth zero — see the header on that
 * function. The risk of a second entry point is that it quietly becomes the lenient
 * one everybody uses, so these tests pin what stays strict: the ceiling, the field
 * bound on the secret, and the refusal of a zero secret. Only the "more than zero"
 * floor is dropped, and only on the amount.
 */
describe("derivePaddingCommitment", () => {
  it("commits to a zero amount, which deriveCommitment refuses", async () => {
    const padding = await derivePaddingCommitment(standInHash, { amount: 0n, secret: SECRET });
    expect(isInField(padding.value)).toBe(true);

    await expect(deriveCommitment(standInHash, { amount: 0n, secret: SECRET })).rejects.toThrow(
      "more than zero",
    );
  });

  /**
   * A zero-value commitment is not a magic constant — it still binds the secret, which
   * is the whole reason the padding note needs a fresh one. If this returned the same
   * number for every padding note, its nullifier would be fixed too, and the first
   * spend would burn it on chain for everybody. See `newPaddingNote`.
   */
  it("still binds the secret, so two padding notes differ", async () => {
    const one = await derivePaddingCommitment(standInHash, { amount: 0n, secret: SECRET });
    const two = await derivePaddingCommitment(standInHash, { amount: 0n, secret: SECRET + 1n });
    expect(one.value).not.toBe(two.value);
  });

  it("agrees with deriveCommitment wherever both are allowed", async () => {
    const strict = await deriveCommitment(standInHash, { amount: 7n, secret: SECRET });
    const lenient = await derivePaddingCommitment(standInHash, { amount: 7n, secret: SECRET });
    expect(lenient).toEqual(strict);
  });

  it("keeps the ceiling and both secret checks", async () => {
    await expect(
      derivePaddingCommitment(standInHash, { amount: (1n << 248n) + 1n, secret: SECRET }),
    ).rejects.toThrow("2^248");
    await expect(
      derivePaddingCommitment(standInHash, { amount: 0n, secret: FIELD_MODULUS }),
    ).rejects.toThrow("must be a field element");
    await expect(
      derivePaddingCommitment(standInHash, { amount: 0n, secret: 0n }),
    ).rejects.toThrow("uninitialised variable");
  });

  it("refuses a negative amount, which is a bug rather than padding", async () => {
    await expect(
      derivePaddingCommitment(standInHash, { amount: -1n, secret: SECRET }),
    ).rejects.toThrow("cannot hold a negative amount");
  });
});

describe("deriveNullifier", () => {
  it("is deterministic for the same secret and leaf index", async () => {
    const a = await deriveNullifier(standInHash, { secret: SECRET }, 3);
    const b = await deriveNullifier(standInHash, { secret: SECRET }, 3);
    expect(a).toEqual(b);
  });

  /**
   * The leaf index is in the preimage so that one secret sitting at two positions
   * cannot produce a single nullifier — otherwise spending one would mark both
   * spent, or worse, let the same note be spent twice depending on which way the
   * pool resolved it.
   */
  it("differs per leaf index for the same secret", async () => {
    const at0 = await deriveNullifier(standInHash, { secret: SECRET }, 0);
    const at1 = await deriveNullifier(standInHash, { secret: SECRET }, 1);
    expect(at0.value).not.toBe(at1.value);
  });

  it("differs per secret at the same leaf index", async () => {
    const a = await deriveNullifier(standInHash, { secret: SECRET }, 0);
    const b = await deriveNullifier(standInHash, { secret: SECRET + 1n }, 0);
    expect(a.value).not.toBe(b.value);
  });

  /**
   * The collision the domain tags exist to prevent, asserted across the two
   * functions that share a secret in their preimage.
   */
  it("cannot collide with a commitment over the same numbers", async () => {
    const commitment = await deriveCommitment(standInHash, { amount: 5n, secret: SECRET });
    const nullifier = await deriveNullifier(standInHash, { secret: SECRET }, 5);
    expect(commitment.value).not.toBe(nullifier.value);
  });

  it("refuses a negative or fractional leaf index", async () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        deriveNullifier(standInHash, { secret: SECRET }, bad),
        String(bad),
      ).rejects.toThrow("non-negative integer");
    }
  });

  it("refuses a zero secret for the same reason a commitment does", async () => {
    await expect(deriveNullifier(standInHash, { secret: 0n }, 0)).rejects.toThrow(
      "uninitialised variable",
    );
  });

  it("carries the scheme tag through", async () => {
    const nullifier = await deriveNullifier(standInHash, { secret: SECRET }, 0);
    expect(nullifier.scheme).toBe("stand-in");
  });
});

describe("the poseidon tag cannot be claimed and disclaimed at once", () => {
  /**
   * A hash that tags itself `poseidon` while still carrying a reason it is not
   * circuit-ready is the exact combination that would sail through
   * `assertCircuitReady` at the chain boundary — the guard reads the reason, and
   * everything downstream reads the tag. `tagged()` refuses rather than picking one.
   *
   * Reachable only through a hand-made `FieldHash`, which is why the fixture is
   * local to this test: there is no real Poseidon to get it from, and a shared
   * fixture that claims to be one is how a fake scheme escapes a test file.
   */
  const contradictory: FieldHash = {
    scheme: "poseidon",
    whyNotCircuitReady: "actually it is a stand-in",
    hash: async () => 42n,
  };

  it("throws for a commitment", async () => {
    await expect(deriveCommitment(contradictory, { amount: 1n, secret: SECRET })).rejects.toThrow(
      "cannot also say why it is not circuit-ready",
    );
  });

  it("throws for a nullifier", async () => {
    await expect(deriveNullifier(contradictory, { secret: SECRET }, 0)).rejects.toThrow(
      "cannot also say why it is not circuit-ready",
    );
  });

  it("quotes the contradictory reason so the caller can find it", async () => {
    await expect(deriveCommitment(contradictory, { amount: 1n, secret: SECRET })).rejects.toThrow(
      "actually it is a stand-in",
    );
  });
});

describe("a poseidon-tagged value has no why to ignore", () => {
  /** The honest side of the same union: no reason, no `why` field at all. */
  const honest: FieldHash = {
    scheme: "poseidon",
    whyNotCircuitReady: null,
    hash: async () => 42n,
  };

  it("tags without a why", async () => {
    const commitment = await deriveCommitment(honest, { amount: 1n, secret: SECRET });
    expect(commitment).toEqual({ scheme: "poseidon", value: 42n });
    expect(commitment).not.toHaveProperty("why");
  });

  /**
   * The stand-in's default. `tagged` falls back to a generic sentence when a
   * stand-in hash declares no reason of its own, so a `why` is never empty — an
   * empty `why` renders as a blank space in the UI where an explanation should be.
   */
  it("falls back to a generic reason rather than an empty one", async () => {
    const silent: FieldHash = { scheme: "stand-in", whyNotCircuitReady: null, hash: async () => 7n };
    const commitment = await deriveCommitment(silent, { amount: 1n, secret: SECRET });
    expect(commitment.scheme).toBe("stand-in");
    if (commitment.scheme === "stand-in") {
      expect(commitment.why).toBe("produced by a stand-in hash");
    }
  });
});

describe("commitmentHex", () => {
  it("renders a commitment as fixed-width hex", async () => {
    const commitment = await deriveCommitment(standInHash, { amount: 1n, secret: SECRET });
    const hex = commitmentHex(commitment);
    expect(hex).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hex).toBe(toFieldHex(commitment.value));
  });

  it("renders a nullifier too, since both are field elements", async () => {
    const nullifier = await deriveNullifier(standInHash, { secret: SECRET }, 0);
    expect(commitmentHex(nullifier)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  /**
   * Fixed width, not "however many digits the number happened to need". A small
   * value must still render 64 digits or it hashes differently downstream — the
   * "proofs fail about 1 time in 256" class of bug.
   */
  it("pads a small value to the full 32 bytes", async () => {
    const tiny: FieldHash = { scheme: "stand-in", whyNotCircuitReady: null, hash: async () => 1n };
    const commitment = await deriveCommitment(tiny, { amount: 1n, secret: SECRET });
    expect(commitmentHex(commitment)).toBe(`0x${"0".repeat(63)}1`);
  });
});
