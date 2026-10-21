import { describe, expect, it } from "vitest";
import { FIELD_MODULUS } from "@/lib/field";
import type { FieldHash } from "@/lib/hash";
import { standInHash } from "@/lib/hash";
import type { MerklePath } from "@/lib/tree";
import {
  IncrementalMerkleTree,
  MAX_LEVELS,
  ROOT_HISTORY_SIZE,
  TREE_NODE_DOMAIN,
} from "@/lib/tree";

/**
 * The empty leaf is a parameter of the tree, so these pick small recognisable numbers
 * on purpose — the class must be correct for whatever it is handed, and a test that
 * only ever passes one realistic-looking constant cannot tell "uses the argument" from
 * "hard-codes the same thing". One test below passes a full-width field element to
 * confirm nothing depends on the value being small.
 */
const EMPTY = 11n;
const OTHER_EMPTY = 22n;

async function tree(levels: number, emptyLeaf = EMPTY): Promise<IncrementalMerkleTree> {
  return IncrementalMerkleTree.create({ levels, hash: standInHash, emptyLeaf });
}

/**
 * The verifier's half of the bargain, written independently of `pathFor`.
 *
 * This is the only thing a circuit is given: a leaf, the siblings, and which side each
 * one goes on. If folding those does not reach the root, the proof does not verify —
 * so this function, not `pathFor`'s own return value, is what the round-trip tests
 * compare against.
 */
async function foldPath(path: MerklePath, hash: FieldHash = standInHash): Promise<bigint> {
  let node = path.leaf;
  for (const [i, sibling] of path.siblings.entries()) {
    node =
      path.isRight[i] === true
        ? await hash.hash(TREE_NODE_DOMAIN, [sibling, node])
        : await hash.hash(TREE_NODE_DOMAIN, [node, sibling]);
  }
  return node;
}

describe("IncrementalMerkleTree.create", () => {
  it("refuses a level count the contract would refuse", async () => {
    for (const levels of [0, -1, 33, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(tree(levels)).rejects.toThrow(`between 1 and ${MAX_LEVELS} levels`);
    }
  });

  it("accepts both ends of the range", async () => {
    expect((await tree(1)).levels).toBe(1);
    expect((await tree(MAX_LEVELS)).levels).toBe(MAX_LEVELS);
  });

  it("refuses an empty leaf that is not a field element", async () => {
    await expect(tree(4, FIELD_MODULUS)).rejects.toThrow("must be a field element");
    await expect(tree(4, -1n)).rejects.toThrow("must be a field element");
  });

  it("accepts a full-width field element as the empty leaf", async () => {
    const t = await tree(4, FIELD_MODULUS - 1n);
    expect(t.emptyLeaf).toBe(FIELD_MODULUS - 1n);
    expect(t.root()).not.toBe(0n);
  });

  it("starts empty, with the empty-tree root already acceptable", async () => {
    const t = await tree(5);
    expect(t.nextIndex).toBe(0);
    expect(t.remainingCapacity).toBe(32);
    expect(t.isKnownRoot(t.root())).toBe(true);
  });

  /**
   * The empty-tree root sits one level above the last `zeros` entry, so for a 1-level
   * tree it is `H(emptyLeaf, emptyLeaf)`. Pinned at the smallest size because that is
   * where an off-by-one in the zeros loop is visible — at 20 levels every wrong answer
   * still looks like a 32-byte number.
   */
  it("seeds the empty root one level above the last empty subtree", async () => {
    const t = await tree(1);
    expect(t.root()).toBe(await standInHash.hash(TREE_NODE_DOMAIN, [EMPTY, EMPTY]));
  });

  it("uses the empty leaf it was given, so two trees differing only in it differ", async () => {
    const a = await tree(4, EMPTY);
    const b = await tree(4, OTHER_EMPTY);
    expect(a.root()).not.toBe(b.root());

    await a.insert(99n);
    await b.insert(99n);
    expect(a.root()).not.toBe(b.root());
  });
});

describe("IncrementalMerkleTree.insert", () => {
  it("returns the index the leaf landed at, counting from zero", async () => {
    const t = await tree(5);
    expect(await t.insert(1n)).toBe(0);
    expect(await t.insert(2n)).toBe(1);
    expect(await t.insert(3n)).toBe(2);
  });

  /**
   * The off-by-one the method's own comment warns about: a caller that reads
   * `nextIndex` after inserting gets the position of the NEXT leaf. A nullifier derived
   * from that number is a nullifier for a position this note is not at, and the note is
   * unspendable with nothing to point at.
   */
  it("returns a different number than nextIndex reads afterwards", async () => {
    const t = await tree(5);
    const index = await t.insert(1n);
    expect(index).toBe(0);
    expect(t.nextIndex).toBe(1);
  });

  it("moves the root on every insert, and keeps the old one acceptable", async () => {
    const t = await tree(5);
    const empty = t.root();
    await t.insert(1n);
    const one = t.root();
    await t.insert(2n);

    expect(one).not.toBe(empty);
    expect(t.root()).not.toBe(one);
    for (const root of [empty, one, t.root()]) expect(t.isKnownRoot(root)).toBe(true);
  });

  it("spends capacity as it fills, and refuses the leaf past the end", async () => {
    const t = await tree(1);
    expect(t.remainingCapacity).toBe(2);
    await t.insert(1n);
    await t.insert(2n);
    expect(t.remainingCapacity).toBe(0);
    await expect(t.insert(3n)).rejects.toThrow("This tree is full at 2 leaves");
  });

  it("refuses a leaf that is not a field element", async () => {
    const t = await tree(4);
    await expect(t.insert(FIELD_MODULUS)).rejects.toThrow("must be a field element");
    await expect(t.insert(-1n)).rejects.toThrow("must be a field element");
    expect(t.nextIndex).toBe(0);
  });

  it("is deterministic: same leaves in, same root out", async () => {
    const a = await tree(6);
    const b = await tree(6);
    for (const leaf of [5n, 6n, 7n, 8n, 9n]) {
      await a.insert(leaf);
      await b.insert(leaf);
    }
    expect(a.root()).toBe(b.root());
  });

  it("depends on order, because a tree is a sequence and not a set", async () => {
    const a = await tree(6);
    const b = await tree(6);
    await a.insert(5n);
    await a.insert(6n);
    await b.insert(6n);
    await b.insert(5n);
    expect(a.root()).not.toBe(b.root());
  });

  /**
   * `1 << 32` is **1** in JavaScript — `<<` coerces to int32 — so a capacity check
   * written with a shift reports a 32-level tree as full at its second leaf. Pinned as
   * an assertion rather than a comment because the wrong answer is a small plausible
   * number, not an obvious error.
   */
  it("counts capacity at 32 levels without the shift-operator overflow", async () => {
    expect(1 << MAX_LEVELS).toBe(1);
    const t = await tree(MAX_LEVELS);
    expect(t.remainingCapacity).toBe(2 ** 32);
    await t.insert(7n);
    expect(t.remainingCapacity).toBe(2 ** 32 - 1);
  });
});

/**
 * The reason this class exists rather than a `nextIndex` counter.
 *
 * A path whose siblings do not fold to the tree's root is a proof that will not verify,
 * and nothing about the values says so — they are field elements either way. So this
 * checks every leaf after every insert, at the sizes where the empty-subtree padding
 * changes: odd counts, even counts, and a level that is exactly full.
 */
describe("IncrementalMerkleTree.pathFor", () => {
  it("folds to the current root for every leaf, after every insert", async () => {
    const t = await tree(4);
    for (let n = 1; n <= 9; n++) {
      await t.insert(BigInt(100 + n));
      for (let leaf = 0; leaf < n; leaf++) {
        const path = await t.pathFor(leaf);
        expect(path.root).toBe(t.root());
        expect(await foldPath(path)).toBe(t.root());
      }
    }
  });

  it("folds to the root when the tree is exactly full", async () => {
    const t = await tree(3);
    for (let n = 0; n < 8; n++) await t.insert(BigInt(200 + n));
    expect(t.remainingCapacity).toBe(0);
    for (let leaf = 0; leaf < 8; leaf++) {
      expect(await foldPath(await t.pathFor(leaf))).toBe(t.root());
    }
  });

  it("carries one sibling and one side per level, and names the leaf it is for", async () => {
    const t = await tree(7);
    await t.insert(1n);
    await t.insert(2n);
    const path = await t.pathFor(1);

    expect(path.siblings).toHaveLength(7);
    expect(path.isRight).toHaveLength(7);
    expect(path.leaf).toBe(2n);
    expect(path.leafIndex).toBe(1);
  });

  /**
   * Index 0 is a left child, index 1 is a right child, and the sibling of each is the
   * other. Spelled out at the bottom level because `isRight` is the field a verifier
   * gets wrong silently: hashing the pair the other way round returns a different
   * number that is still a valid field element.
   */
  it("says which side the path node is on", async () => {
    const t = await tree(4);
    await t.insert(1n);
    await t.insert(2n);

    const left = await t.pathFor(0);
    const right = await t.pathFor(1);
    expect(left.isRight[0]).toBe(false);
    expect(left.siblings[0]).toBe(2n);
    expect(right.isRight[0]).toBe(true);
    expect(right.siblings[0]).toBe(1n);
  });

  it("stands in the empty subtree for a sibling that does not exist yet", async () => {
    const t = await tree(4);
    await t.insert(1n);
    const path = await t.pathFor(0);
    expect(path.siblings[0]).toBe(EMPTY);
    expect(await foldPath(path)).toBe(t.root());
  });

  /**
   * Folding with the sides inverted must NOT reach the root. Without this, every
   * round-trip above would also pass for an implementation that ignored `isRight` and
   * always hashed `(node, sibling)` — which is correct for exactly the left-child case
   * and silently wrong for the other half.
   */
  it("does not fold to the root if the sides are flipped", async () => {
    const t = await tree(4);
    for (const leaf of [1n, 2n, 3n]) await t.insert(leaf);
    const path = await t.pathFor(1);

    const flipped: MerklePath = { ...path, isRight: path.isRight.map((b) => !b) };
    expect(await foldPath(flipped)).not.toBe(t.root());
  });

  it("refuses an index the tree has no leaf at", async () => {
    const empty = await tree(4);
    await expect(empty.pathFor(0)).rejects.toThrow("has 0 leaves");

    const t = await tree(4);
    await t.insert(1n);
    for (const bad of [-1, 1, 2.5, Number.NaN]) {
      await expect(t.pathFor(bad)).rejects.toThrow("no path for index");
    }
  });
});

describe("IncrementalMerkleTree.isKnownRoot", () => {
  /**
   * The guard that looks like dead code.
   *
   * A fresh tree has written one slot of thirty, so twenty-nine of them hold `0n` —
   * modelled that way because on chain they genuinely do. Without the explicit refusal,
   * `roots.includes(0n)` is true and a proof naming root zero is accepted against every
   * tree younger than thirty deposits.
   */
  it("refuses root zero even though the buffer is full of zeros", async () => {
    const t = await tree(6);
    expect(t.isKnownRoot(0n)).toBe(false);
    await t.insert(1n);
    expect(t.isKnownRoot(0n)).toBe(false);
  });

  it("refuses a root this tree never held", async () => {
    const t = await tree(6);
    await t.insert(1n);
    expect(t.isKnownRoot(123456789n)).toBe(false);
  });

  /**
   * The window, counted exactly. Slot 0 holds the empty root, so insert `k` writes slot
   * `k % 30`: the root after insert 1 survives until insert 31 overwrites its slot, and
   * the empty root is the first to go, at insert 30.
   */
  it("keeps exactly ROOT_HISTORY_SIZE roots, oldest out first", async () => {
    expect(ROOT_HISTORY_SIZE).toBe(30);
    const t = await tree(6);
    const emptyRoot = t.root();

    await t.insert(1n);
    const afterFirst = t.root();

    for (let n = 2; n <= 29; n++) await t.insert(BigInt(n));
    expect(t.isKnownRoot(emptyRoot)).toBe(true);
    expect(t.isKnownRoot(afterFirst)).toBe(true);

    await t.insert(30n);
    expect(t.isKnownRoot(emptyRoot)).toBe(false);
    expect(t.isKnownRoot(afterFirst)).toBe(true);

    await t.insert(31n);
    expect(t.isKnownRoot(afterFirst)).toBe(false);
    expect(t.isKnownRoot(t.root())).toBe(true);
  });
});

describe("IncrementalMerkleTree: the hash it is handed", () => {
  /**
   * Every node is tagged, so a commitment cannot be presented as an interior node. This
   * pins the tag AND the argument order in one assertion, by recomputing the only hash a
   * 1-level tree with one leaf performs.
   */
  it("hashes nodes under the tree-node domain, left argument first", async () => {
    const t = await tree(1);
    await t.insert(5n);
    expect(t.root()).toBe(await standInHash.hash(TREE_NODE_DOMAIN, [5n, EMPTY]));
    expect(t.root()).not.toBe(await standInHash.hash(TREE_NODE_DOMAIN, [EMPTY, 5n]));
    expect(t.root()).not.toBe(await standInHash.hash("note.commitment", [5n, EMPTY]));
  });

  /**
   * `IHasher`'s warning, enforced on the browser side: a hasher returning full 256-bit
   * digests builds a tree whose roots no circuit can reason about, and it does not
   * announce itself — deposits succeed and no withdrawal is ever provable.
   */
  it("throws rather than build a tree from out-of-field hashes", async () => {
    const rogue: FieldHash = {
      scheme: "stand-in",
      whyNotCircuitReady: "returns raw digests, for this test",
      async hash() {
        return FIELD_MODULUS + 1n;
      },
    };
    await expect(
      IncrementalMerkleTree.create({ levels: 4, hash: rogue, emptyLeaf: EMPTY }),
    ).rejects.toThrow("not below");
  });

  it("throws on an out-of-field hash discovered during an insert", async () => {
    let calls = 0;
    const turnsRogue: FieldHash = {
      scheme: "stand-in",
      whyNotCircuitReady: "goes out of field after construction, for this test",
      async hash(domain, inputs) {
        calls += 1;
        if (calls > 4) return FIELD_MODULUS;
        return standInHash.hash(domain, inputs);
      },
    };
    const t = await IncrementalMerkleTree.create({
      levels: 4,
      hash: turnsRogue,
      emptyLeaf: EMPTY,
    });
    await expect(t.insert(1n)).rejects.toThrow("no circuit can reason about");
    /** The failed insert recorded no leaf, so it shifted no later index. */
    expect(t.nextIndex).toBe(0);
  });

  it("works with any hash that keeps the contract, not only the stand-in", async () => {
    const doubler: FieldHash = {
      scheme: "poseidon",
      whyNotCircuitReady: null,
      async hash(_domain, inputs) {
        return inputs.reduce((a, b) => (a * 31n + b) % FIELD_MODULUS, 7n);
      },
    };
    const t = await IncrementalMerkleTree.create({ levels: 3, hash: doubler, emptyLeaf: EMPTY });
    await t.insert(1n);
    await t.insert(2n);
    expect(await foldPath(await t.pathFor(0), doubler)).toBe(t.root());
    expect(await foldPath(await t.pathFor(1), doubler)).toBe(t.root());
  });
});
