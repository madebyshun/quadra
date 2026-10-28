import { FIELD_MODULUS, isInField } from "@/lib/field";
import type { FieldHash } from "@/lib/hash";

/**
 * The commitment tree, in the browser, computing the same roots the contract does.
 *
 * `contracts/src/MerkleTreeWithHistory.sol` is the authority on the shape and this
 * mirrors it deliberately: same insert order, same empty-subtree stand-ins, same
 * 30-root circular history, same refusal of root zero. A tree that computed roots
 * its own way would let the browser build a proof against a root the pool has never
 * held — which fails at withdrawal time, on chain, after the deposit.
 *
 * ── What this has that the contract does not ─────────────────────────────────
 * Paths. The contract keeps only `filledSubtrees` — one node per level — because
 * storing a million leaves to serve a proof nobody asked for is not what block space
 * is for. Somebody still has to produce the path, and in this design that somebody is
 * the browser. So this keeps every leaf and derives paths on demand.
 *
 * That makes `pathFor` the load-bearing method in the file: a path whose recomputed
 * root disagrees with the incremental root is a proof that will not verify, and the
 * disagreement is invisible until it does. `tests/tree.test.ts` asserts the two agree
 * after every single insert, not just at the end.
 *
 * ── Two places this deliberately does NOT decide ─────────────────────────────
 * `emptyLeaf` is a required argument with no default, and the node hash is domain
 * tagged. Both are explained where they are declared. Neither is a placeholder — they
 * are the two values that must equal what a deployed pool uses, and the point of
 * making them explicit is that a mismatch is a missing argument rather than a wrong
 * root.
 */

/**
 * The domain tag every interior node is hashed under.
 *
 * `IHasher.hash(left, right)` takes no tag, so a deployed hasher has to bake this one
 * in for its output to match what this computes. That is a real requirement on the
 * deployment, written here because this is the side that can be read by whoever
 * compiles the circuit.
 *
 * Tagging it at all is not decoration. Without a tag, a node hash and a two-input
 * note commitment are the same function of the same pair, so a commitment could be
 * presented as an interior node and vice versa. See the header of `lib/hash.ts`.
 */
export const TREE_NODE_DOMAIN = "tree.node";

/**
 * How many past roots stay acceptable, mirroring `ROOT_HISTORY_SIZE`.
 *
 * A withdrawal proves membership under a root chosen before the proof was built, and
 * any deposit in the meantime moves the root. Accept only the newest and every proof
 * races every deposit. The window is also a privacy parameter: proving against an old
 * root narrows the note to deposits made before it.
 */
export const ROOT_HISTORY_SIZE = 30;

/**
 * The contract counts leaves in a `uint32` and reverts above 32 levels.
 *
 * Kept as a named bound rather than inlined because the JS reason differs from the
 * Solidity one and is worse: `1 << 32` evaluates to **1** in JavaScript, since `<<`
 * coerces to int32. A capacity check written that way would report a 32-level tree as
 * full at its second leaf. Capacity here is computed with `2 **`, and a test pins it.
 */
export const MAX_LEVELS = 32;

/**
 * Everything a prover needs to show a leaf is under a root, and nothing else.
 *
 * `siblings[i]` is the node adjacent to the path at level `i`; `isRight[i]` says
 * whether the path node was the RIGHT child there, which is what decides the argument
 * order when the verifier re-hashes. Both are needed: the sibling alone does not say
 * which side it goes on, and hashing a pair in the wrong order gives a different
 * answer that is still a perfectly valid field element.
 */
export type MerklePath = {
  readonly root: bigint;
  readonly leaf: bigint;
  readonly leafIndex: number;
  readonly siblings: readonly bigint[];
  readonly isRight: readonly boolean[];
};

export class IncrementalMerkleTree {
  /** Root of an empty subtree at each height, index 0 being the empty leaf. */
  private readonly zeros: bigint[] = [];

  /** The node at each level still waiting for a right sibling. */
  private readonly filledSubtrees: bigint[] = [];

  /**
   * Every leaf, in insert order. This is the part the contract does not keep.
   *
   * Commitments, not secrets. A commitment is public — it is what goes on chain — so
   * this array is not a place a note's secret could leak from. The secrets live on the
   * notes in the pool and are never handed to the tree.
   */
  private readonly leaves: bigint[] = [];

  /**
   * Circular buffer of recent roots, modelled with the contract's own zero-filled
   * slots rather than a growable list.
   *
   * A `bigint[]` that only ever held real roots would be the more natural TypeScript,
   * and it would make `isKnownRoot`'s refusal of zero look like dead code worth
   * deleting. It is not dead: on chain the unwritten slots genuinely read as zero, so
   * the refusal is what stops a proof naming root zero from being accepted against
   * every tree younger than 30 deposits. Modelling the slots keeps the browser's
   * answer equal to the chain's for the same input, which is the only reason this
   * class exists.
   */
  private readonly roots: bigint[] = new Array<bigint>(ROOT_HISTORY_SIZE).fill(0n);
  private currentRootIndex = 0;

  private constructor(
    readonly levels: number,
    private readonly hash: FieldHash,
  ) {}

  /**
   * Build an empty tree of `levels` levels.
   *
   * Async because the empty-subtree roots are hashed, not tabulated — the same
   * decision the contract's constructor makes, and for the reason its comment gives: a
   * hard-coded table is the answer for one specific hash function, and this class does
   * not know which one it was handed.
   *
   * `emptyLeaf` has no default ON PURPOSE. The contract derives it from
   * `keccak256("quadra.shielded-pool.empty-leaf")`, so the caller supplies it: from the
   * deployed pool's own `zeros(0)` when there is a deployment, and from a declared local
   * constant when there is not. A wrong value then surfaces as a wrong root in a test,
   * while a missing one will not compile — neither can hide.
   *
   * ⚠️ **This comment used to justify that with "there is no keccak here", and that
   * stopped being true on 2026-09-28** — `lib/keccak.ts` exists and
   * `tests/keccak.test.ts` pins the contract's own empty-leaf preimage. The argument was
   * replaced rather than the parameter, because the parameter is still right for a
   * different reason: this class does not know which hash it was handed, and a leaf from
   * keccak sitting above 19 empty subtrees from some other hash is two hash functions in
   * one root. **Do not now pass the contract's keccak leaf here** — interior nodes still
   * go through the stand-in hash, so it would move every local root without making one
   * of them provable, and invalidate every backup already written. It changes when
   * Poseidon lands, in one change. See TASKS.md step 1d.
   */
  static async create(opts: {
    levels: number;
    hash: FieldHash;
    emptyLeaf: bigint;
  }): Promise<IncrementalMerkleTree> {
    const { levels, hash, emptyLeaf } = opts;

    if (!Number.isInteger(levels) || levels < 1 || levels > MAX_LEVELS) {
      throw new Error(
        `A tree needs between 1 and ${MAX_LEVELS} levels, got ${levels}. Zero levels is one leaf with no proof to make; above ${MAX_LEVELS} the leaf index stops fitting the uint32 the contract counts with.`,
      );
    }
    if (!isInField(emptyLeaf)) {
      throw new Error(
        `The empty leaf must be a field element below ${FIELD_MODULUS}, got ${emptyLeaf}. A leaf at or above it is one no circuit can reference.`,
      );
    }

    const tree = new IncrementalMerkleTree(levels, hash);
    tree.zeros.push(emptyLeaf);
    tree.filledSubtrees.push(emptyLeaf);

    for (let i = 1; i < levels; i++) {
      const below = tree.zeros[i - 1] as bigint;
      const next = await tree.node(below, below);
      tree.zeros.push(next);
      tree.filledSubtrees.push(next);
    }

    /**
     * The empty-tree root, seeded at slot 0 exactly as the constructor does — so a
     * proof against a tree nobody has deposited into is accepted here too.
     *
     * Hashed separately rather than read out of `zeros`, because `zeros` has `levels`
     * entries and the root sits one level above the last of them.
     */
    const top = tree.zeros[levels - 1] as bigint;
    tree.roots[0] = await tree.node(top, top);
    return tree;
  }

  /** How many leaves are in the tree. Mirrors the contract's `nextIndex`. */
  get nextIndex(): number {
    return this.leaves.length;
  }

  /**
   * How many leaves the tree can still take.
   *
   * `2 **`, not `1 <<`. See `MAX_LEVELS` — the shift operator would make this wrong by
   * a factor of four billion at the top of the range and right everywhere else, which
   * is the shape of bug that ships.
   */
  get remainingCapacity(): number {
    return 2 ** this.levels - this.leaves.length;
  }

  /** The newest root. */
  root(): bigint {
    return this.roots[this.currentRootIndex] as bigint;
  }

  /** The empty leaf this tree was built with, for a caller that needs to pass it on. */
  get emptyLeaf(): bigint {
    return this.zeros[0] as bigint;
  }

  /**
   * Whether a proof built against `root` is still acceptable.
   *
   * Refuses zero. In this class the buffer's unwritten slots are zero because the
   * contract's are, and the contract's refusal is what stops the default value from
   * being a universally valid root. Dropping it here would make the browser accept a
   * root the chain rejects, which is worse than either behaviour on its own: the proof
   * would build fine and fail on settlement.
   */
  isKnownRoot(root: bigint): boolean {
    if (root === 0n) return false;
    return this.roots.includes(root);
  }

  /**
   * Add a leaf and return the index it landed at.
   *
   * Hash for hash, this is `_insert`. The index is returned rather than read back
   * afterwards because the contract returns it, and because a caller that reads
   * `nextIndex` after inserting gets the NEXT one — an off-by-one that produces a
   * nullifier for a leaf position the note is not at, and so an unspendable note.
   */
  async insert(leaf: bigint): Promise<number> {
    if (!isInField(leaf)) {
      throw new Error(
        `A leaf must be a field element below ${FIELD_MODULUS}, got ${leaf}. The money would go in and no proof could get it out.`,
      );
    }
    if (this.leaves.length === 2 ** this.levels) {
      throw new Error(
        `This tree is full at ${2 ** this.levels} leaves. Reusing a position would overwrite a leaf somebody's money depends on.`,
      );
    }

    const index = this.leaves.length;
    let currentIndex = index;
    let currentHash = leaf;

    for (let i = 0; i < this.levels; i++) {
      let left: bigint;
      let right: bigint;
      if (currentIndex % 2 === 0) {
        // No right sibling yet: stand in the empty subtree and remember this node so
        // the next insert at this level can pair with it.
        left = currentHash;
        right = this.zeros[i] as bigint;
        this.filledSubtrees[i] = currentHash;
      } else {
        left = this.filledSubtrees[i] as bigint;
        right = currentHash;
      }
      currentHash = await this.node(left, right);
      currentIndex = Math.floor(currentIndex / 2);
    }

    this.currentRootIndex = (this.currentRootIndex + 1) % ROOT_HISTORY_SIZE;
    this.roots[this.currentRootIndex] = currentHash;
    /**
     * Pushed last. `node` awaits a hash that can throw, and a leaf recorded for an
     * insert that never finished would shift every later index by one — every
     * subsequent nullifier derived for the wrong position, every path wrong, and
     * nothing to point at.
     */
    this.leaves.push(leaf);
    return index;
  }

  /**
   * The path proving the leaf at `leafIndex` is under the current root.
   *
   * Rebuilt from the stored leaves rather than cached during insert. Caching would
   * mean maintaining every interior node through every insert and would still be
   * rebuilt from scratch on reload, since none of this is persisted yet; rebuilding is
   * `O(leaves)` hashes for a wallet that holds tens of them.
   *
   * The returned `root` is recomputed along the way, NOT copied from the history. A
   * path that does not re-hash to the tree's root is the one failure mode that matters
   * here, and copying the root would hide it — the field would agree because it was
   * assigned, not because the path was right.
   */
  async pathFor(leafIndex: number): Promise<MerklePath> {
    if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error(
        `This tree has ${this.leaves.length} leaves, so there is no path for index ${leafIndex}.`,
      );
    }

    const siblings: bigint[] = [];
    const isRight: boolean[] = [];

    let level = [...this.leaves];
    let index = leafIndex;
    let currentHash = this.leaves[leafIndex] as bigint;

    for (let i = 0; i < this.levels; i++) {
      const onTheRight = index % 2 === 1;
      /**
       * A sibling position past the end of the level is an empty subtree, which is
       * exactly the `zeros[i]` the insert path stands in. This is where the two
       * algorithms have to agree, and the reason the round-trip test exists.
       */
      const siblingIndex = onTheRight ? index - 1 : index + 1;
      const sibling = level[siblingIndex] ?? (this.zeros[i] as bigint);

      siblings.push(sibling);
      isRight.push(onTheRight);
      currentHash = onTheRight
        ? await this.node(sibling, currentHash)
        : await this.node(currentHash, sibling);

      level = await this.levelAbove(level, i);
      index = Math.floor(index / 2);
    }

    return {
      root: currentHash,
      leaf: this.leaves[leafIndex] as bigint,
      leafIndex,
      siblings,
      isRight,
    };
  }

  /** Pair up one level into the next, padding a missing right sibling with `zeros[i]`. */
  private async levelAbove(level: readonly bigint[], i: number): Promise<bigint[]> {
    const above: bigint[] = [];
    for (let k = 0; k < level.length; k += 2) {
      const left = level[k] as bigint;
      const right = level[k + 1] ?? (this.zeros[i] as bigint);
      above.push(await this.node(left, right));
    }
    return above;
  }

  /**
   * One interior node. Every hash in this class goes through here, so the domain tag
   * and the in-field check cannot be applied in some places and not others.
   */
  private async node(left: bigint, right: bigint): Promise<bigint> {
    const value = await this.hash.hash(TREE_NODE_DOMAIN, [left, right]);
    /**
     * Checked even though `FieldHash` is documented to return field elements. A hasher
     * returning full 256-bit digests is the failure `IHasher` warns about, and it does
     * not announce itself: deposits succeed, roots look like numbers, and no withdrawal
     * is ever provable. One comparison per hash to turn that into a throw.
     */
    if (!isInField(value)) {
      throw new Error(
        `The hash returned ${value}, which is not below ${FIELD_MODULUS}. A tree built from it has roots no circuit can reason about, and nothing downstream would complain.`,
      );
    }
    return value;
  }
}
