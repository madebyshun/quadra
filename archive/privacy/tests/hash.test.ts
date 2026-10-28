/**
 * The stand-in hash, tested for the properties a note scheme actually leans on.
 *
 * ── What is deliberately NOT tested here ─────────────────────────────────────
 * There is no test vector. A test vector pins an implementation to a reference,
 * and the reference for this file does not exist yet: the real hash is whatever a
 * generated circuit computes, and `standInHash` is explicitly not that — see the
 * 🔴 block in `lib/hash.ts`. Checking SHA-256 against a known digest here would
 * assert that the browser's `crypto.subtle` works, which is not in doubt, and
 * would read as evidence the hash is circuit-ready, which is the one impression
 * this whole module is shaped to prevent.
 *
 * What IS tested: determinism, domain separation, encoding unambiguity, the fold
 * target, and — most importantly — that the `scheme` tag and its `why` sentence
 * travel with every value. Those are the properties the note scheme depends on and
 * the ones that would still have to hold for a real Poseidon.
 */

import { describe, expect, it } from "vitest";
import { FIELD_MODULUS, isInField } from "@/lib/field";
import { HASH_FOLD_MODULUS, assertCircuitReady, standInHash } from "@/lib/hash";
import type { FieldHash } from "@/lib/hash";

describe("standInHash: what it says about itself", () => {
  it("is tagged stand-in and carries the reason, not a boolean", () => {
    expect(standInHash.scheme).toBe("stand-in");
    expect(standInHash.whyNotCircuitReady).toContain("not the one any circuit");
  });

  /**
   * The wording is asserted because it is shown to a user. A reassuring sentence
   * here ("using a temporary hash") would be technically true and would let someone
   * read the gap as a detail; it has to say that nothing hashed this way can be
   * proven, which is the consequence rather than the mechanism.
   */
  it("explains the consequence, not just the mechanism", () => {
    expect(standInHash.whyNotCircuitReady).toContain("can ever be proven");
  });
});

describe("standInHash.hash", () => {
  it("is deterministic", async () => {
    const a = await standInHash.hash("note.commitment", [1n, 2n]);
    const b = await standInHash.hash("note.commitment", [1n, 2n]);
    expect(a).toBe(b);
  });

  it("always lands in the field", async () => {
    for (const inputs of [[0n], [1n], [FIELD_MODULUS - 1n], [1n, 2n, 3n, 4n]]) {
      expect(isInField(await standInHash.hash("t", inputs))).toBe(true);
    }
  });

  /**
   * The property `encodeDomain` exists for. A commitment and a nullifier are both
   * `H` of a tuple containing the same secret; without the tag one could equal the
   * other and the pool could not tell a spend from a deposit.
   */
  it("separates domains: the same inputs hash differently under different tags", async () => {
    const commitment = await standInHash.hash("note.commitment", [7n, 9n]);
    const nullifier = await standInHash.hash("note.nullifier", [7n, 9n]);
    expect(commitment).not.toBe(nullifier);
  });

  it("requires a domain tag rather than defaulting to none", async () => {
    await expect(standInHash.hash("", [1n])).rejects.toThrow("domain tag is required");
  });

  /**
   * The fixed-width encoding, tested through the behaviour it buys. With a
   * variable-width encoding `H(1, 256)` and `H(256, 1)` can serialise to the same
   * bytes; this is the assertion that catches that if anyone "optimises"
   * `encodeInputs` to trim leading zeros.
   */
  it("does not confuse H(1, 256) with H(256, 1)", async () => {
    const forward = await standInHash.hash("t", [1n, 256n]);
    const reverse = await standInHash.hash("t", [256n, 1n]);
    expect(forward).not.toBe(reverse);
  });

  /**
   * Arity is part of the preimage. `[1n]` and `[1n, 1n]` differ only in how many
   * 32-byte words follow the tag, so this is the assertion that a one-input hash
   * cannot be mistaken for a two-input one — the case that matters when a scheme
   * grows a field (an owner public key, say) and old and new notes coexist.
   */
  it("distinguishes one input from two", async () => {
    const one = await standInHash.hash("t", [1n]);
    const two = await standInHash.hash("t", [1n, 1n]);
    expect(one).not.toBe(two);
  });

  /**
   * And zero is a real input, not a missing one. `[1n, 0n]` must not collapse onto
   * `[1n]`, which it would under any encoding that skipped empty words.
   */
  it("treats a zero input as present, not absent", async () => {
    const withZero = await standInHash.hash("t", [1n, 0n]);
    const without = await standInHash.hash("t", [1n]);
    expect(withZero).not.toBe(without);
  });

  it("refuses an empty input list", async () => {
    await expect(standInHash.hash("t", [])).rejects.toThrow("empty input list");
  });

  /**
   * An out-of-field input is a caller bug, and the message has to name the index
   * and say "do not fold an amount" — because folding is exactly the wrong repair
   * when the out-of-range value turns out to be a quantity.
   */
  it("refuses an out-of-field input, naming which one", async () => {
    await expect(standInHash.hash("t", [1n, FIELD_MODULUS])).rejects.toThrow("Input 1");
    await expect(standInHash.hash("t", [FIELD_MODULUS])).rejects.toThrow("do not fold an amount");
  });

  it("refuses a negative input", async () => {
    await expect(standInHash.hash("t", [-1n])).rejects.toThrow("not a field element");
  });
});

/**
 * The only tests in this file that are not property tests.
 *
 * Every other assertion here is relational — `a === a`, `a !== b`, `isInField(a)`.
 * All of them hold for *any* deterministic hash, so all of them survive a change to
 * the function itself: the commitment for a note becomes a different number, notes
 * already in the tree become unreachable, and the suite stays green. These vectors
 * are what make the output itself load-bearing. They are not "the right answer" in
 * any deep sense — they are *this build's* answer, which is what a note already on
 * someone's disk was hashed with. Recomputed independently in node rather than
 * printed from this module, so a vector is a second opinion and not an echo.
 *
 * 🔴 **What these do NOT catch, MEASURED — do not mistake them for the guard against
 * templating the domain tag.** `encodeDomain` prefixes a frozen `"quadra.v1."`, and
 * `brand.ts` explains why it must never become `` `${BRAND.slug}.v1.` ``. The obvious
 * conclusion is that these vectors enforce that. They do not: the mutation was
 * applied and **all 722 tests passed**, because `BRAND.slug` is `"quadra"` today, so
 * the template produces a byte-identical string and the hash does not move. The bug
 * is *dormant* — it detonates at the rename, long after the commit that introduced
 * it, and no output-based test can see it before then. A textual check is the only
 * shape that works, and it lives in `tests/brand.test.ts`.
 *
 * Worth keeping anyway, and MEASURED to be: encoding field elements little-endian
 * instead of big-endian — a plausible one-character slip, and a silent one — fails
 * **these three tests and nothing else**, with the other 727 green. Every property
 * above survives it, because a byte-swapped hash is still deterministic, still in
 * field, still collision-free, and still distinguishes `H(1, 256)` from `H(256, 1)`.
 * A change to the fold or to whether the tag is mixed in at all lands here too.
 *
 * ⚠️ Deliberately the opposite shape from `tests/field.test.ts`, which forbids a
 * hard-coded expectation and reads the Solidity instead. Not a contradiction: the
 * field modulus has a second source of truth to cross-check against, so restating
 * it by hand would hide drift. The stand-in hash has none — there is no circuit yet —
 * so a literal is the only option. When a real Poseidon lands these numbers change,
 * and that is expected; what must never change silently is the hash a shipped build
 * already committed people's money under.
 */
describe("the stand-in hash is pinned, not merely deterministic", () => {
  it("reproduces a checked-in commitment vector", async () => {
    expect(await standInHash.hash("note.commitment", [1n, 2n])).toBe(
      15651940423848809792688220238560112134862758184330509773191514973302489237587n,
    );
  });

  /** A second domain, so the pin covers the tag and not just the input encoding. */
  it("reproduces a checked-in nullifier vector, including a zero leaf index", async () => {
    expect(await standInHash.hash("note.nullifier", [1n, 0n])).toBe(
      15521506200110996857438823717691969871331755065588542143695186727693646330160n,
    );
  });

  /**
   * The same inputs under a different tag, pinned to a third literal. Without this
   * the two vectors above would still pass if `encodeDomain` stopped mixing the tag
   * in at all — both would be hashes of their inputs alone, each still stable.
   */
  it("reproduces a vector that differs from the commitment only by its tag", async () => {
    expect(await standInHash.hash("note.nullifier", [1n, 2n])).toBe(
      19856055577956189897130104373621973836771656583806586693548944844123648239767n,
    );
  });
});

describe("the fold target", () => {
  /**
   * Exported purely so this can be asserted. A masked fold (`digest & mask`) would
   * also produce in-field values and pass every test above, while making the top
   * bits unable to affect the result — two digests differing only up there would
   * collide. Pinning the modulus is how that stays a mod and not a mask.
   */
  it("is the field modulus, not a bit mask", () => {
    expect(HASH_FOLD_MODULUS).toBe(FIELD_MODULUS);
    /** A mask would be a power of two; the modulus is not one. */
    expect(HASH_FOLD_MODULUS & (HASH_FOLD_MODULUS - 1n)).not.toBe(0n);
  });
});

describe("assertCircuitReady", () => {
  it("throws for the stand-in, quoting its own reason", () => {
    expect(() => assertCircuitReady(standInHash)).toThrow("cannot produce a provable note");
    expect(() => assertCircuitReady(standInHash)).toThrow("not the one any circuit");
  });

  it("points at the file that has to change", () => {
    expect(() => assertCircuitReady(standInHash)).toThrow("lib/hash.ts");
  });

  /**
   * The passing side, exercised with a hand-made hash rather than a real Poseidon
   * because there is no real Poseidon. This is the only place in the suite that
   * fabricates a `poseidon`-tagged hash, and it stays inside this test: a fixture
   * like this in a shared helper is how a fake scheme reaches production code.
   */
  it("lets a hash through once it declares no reason", () => {
    const pretend: FieldHash = {
      scheme: "poseidon",
      whyNotCircuitReady: null,
      hash: async () => 1n,
    };
    expect(() => assertCircuitReady(pretend)).not.toThrow();
  });
});
