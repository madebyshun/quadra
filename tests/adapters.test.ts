import { beforeEach, describe, expect, it } from "vitest";
import { adapters, bothDeployed, onchainReady, resolvePool } from "@/adapters";
import { LocalShieldedPool } from "@/adapters/local/pool";
import { LOCAL_MODELS, LocalEnclave } from "@/adapters/local/enclave";
import { LocalCatalog } from "@/adapters/local/catalog";
import { HttpCatalog } from "@/adapters/http/catalog";
import type { Note, NoteWitness } from "@/adapters/types";
import { AAPL_BASE } from "@/config/pair";
import { BLUEAGENT } from "@/config/upstream";
import { CONTRACTS, USDC } from "@/config/chain";
import { formatAmount, parseAmount } from "@/lib/amount";
import { MAX_NOTE_VALUE, isInField } from "@/lib/field";
import { standInHash } from "@/lib/hash";
import { commitmentHex, deriveCommitment, deriveNullifier } from "@/lib/note";
import { IncrementalMerkleTree, TREE_NODE_DOMAIN } from "@/lib/tree";

/** The nullifier the pool must have recorded for a note it spent. */
async function nullifierOf(note: Note): Promise<string> {
  return commitmentHex(await deriveNullifier(standInHash, { secret: note.secret }, note.leafIndex));
}

const usdc = { address: USDC.address, symbol: USDC.symbol, decimals: USDC.decimals };
const aaplc = { address: AAPL_BASE.address, symbol: AAPL_BASE.symbol, decimals: AAPL_BASE.decimals };

/** Every test starts from an empty browser. */
let pool: LocalShieldedPool;
beforeEach(() => {
  pool = new LocalShieldedPool();
});

describe("adapters/types.ts", () => {
  /**
   * The coverage report shows this file as 0% because it has no runtime code to
   * cover — 0 of 0. This asserts that stays true. If a constant or a helper is
   * ever added there, the 0% becomes a real gap that the 100% threshold would
   * NOT catch (v8 cannot divide by zero either way), so the guard has to be a
   * test rather than a number.
   */
  it("is type-only: it compiles to a module with nothing in it", async () => {
    const mod = await import("@/adapters/types");
    expect(Object.keys(mod)).toEqual([]);
  });
});

describe("LocalShieldedPool: what it refuses to claim", () => {
  it("is not live, and cannot be talked into saying it is", () => {
    expect(pool.isLive).toBe(false);
  });

  it("anchors every fact as local, with a reason the UI can show", async () => {
    const note = await pool.deposit(usdc, 1_000_000n);
    expect(note.anchoring).toEqual({
      kind: "local",
      why: "held in this browser only — the pool is not deployed yet",
    });
  });

  it("produces no txHash anywhere, because the local variant has no such field", async () => {
    const note = await pool.deposit(usdc, 1_000_000n);
    const receipt = await pool.withdraw(note.id, "0x1111111111111111111111111111111111111111");
    for (const anchoring of [note.anchoring, receipt.anchoring]) {
      expect(anchoring.kind).toBe("local");
      expect(anchoring).not.toHaveProperty("txHash");
      expect(anchoring).not.toHaveProperty("block");
    }
  });
});

describe("LocalShieldedPool.deposit", () => {
  it("returns a note holding exactly what was put in", async () => {
    const note = await pool.deposit(usdc, 250_000_000n);
    expect(note.amount).toBe(250_000_000n);
    expect(note.token).toEqual(usdc);
    expect(note.spentAt).toBeNull();
  });

  it("gives the note a secret that is a usable field element", async () => {
    const note = await pool.deposit(usdc, 1n);
    expect(typeof note.secret).toBe("bigint");
    expect(isInField(note.secret)).toBe(true);
    expect(note.secret).not.toBe(0n);
  });

  /**
   * The test the old one should have been.
   *
   * Its predecessor asserted only that the commitment was 32 hex bytes and differed
   * from the secret — which a `randomHex(32)` passes, and did, for as long as that
   * was what `deposit` returned. This recomputes the scheme from the note's own
   * amount and secret and demands the same answer, so a commitment that is not a
   * commitment fails here instead of passing quietly.
   */
  it("derives the commitment from the amount and the secret, recomputably", async () => {
    const note = await pool.deposit(usdc, 250_000_000n);
    const again = await deriveCommitment(standInHash, {
      amount: note.amount,
      secret: note.secret,
    });
    expect(note.commitment).toEqual(again);
  });

  it("binds the amount: the same secret at a different amount commits differently", async () => {
    const note = await pool.deposit(usdc, 1n);
    const other = await deriveCommitment(standInHash, { amount: 2n, secret: note.secret });
    expect(other.value).not.toBe(note.commitment.value);
  });

  /**
   * The whole point of the tagged union. A note minted by this pool must carry the
   * stand-in tag and the sentence explaining it, because nothing hashed this way
   * can ever be proven — see lib/hash.ts.
   */
  it("tags the commitment as a stand-in and says why", async () => {
    const note = await pool.deposit(usdc, 1n);
    expect(note.commitment.scheme).toBe("stand-in");
    expect(note.commitment).toHaveProperty("why");
    if (note.commitment.scheme === "stand-in") {
      expect(note.commitment.why).toContain("not the one any circuit");
    }
  });

  it("never issues the same id, commitment or secret twice", async () => {
    const many = await Promise.all(Array.from({ length: 40 }, () => pool.deposit(usdc, 1n)));
    expect(new Set(many.map((n) => n.id)).size).toBe(many.length);
    expect(new Set(many.map((n) => n.secret)).size).toBe(many.length);
    /**
     * Compared by value, not by object identity: every commitment is a distinct
     * object, so a `Set` of them would read 40 unique no matter what the hash did.
     * That is exactly how the previous version of this test would have kept passing
     * after the switch from a string, which is why the loop over three keys is gone.
     */
    expect(new Set(many.map((n) => n.commitment.value)).size).toBe(many.length);
  });

  it("stamps a parseable creation time", async () => {
    const note = await pool.deposit(usdc, 1n);
    expect(Number.isNaN(Date.parse(note.createdAt))).toBe(false);
  });

  it("assigns leaf indices from zero, in the order the notes arrived", async () => {
    const first = await pool.deposit(usdc, 1n);
    const second = await pool.deposit(usdc, 1n);
    const third = await pool.deposit(aaplc, 1n);
    expect([first.leafIndex, second.leafIndex, third.leafIndex]).toEqual([0, 1, 2]);
  });

  /**
   * The tree is append-only — `MerkleTreeWithHistory._insert` only ever increments —
   * so a spent leaf keeps its position forever. If this pool handed index 0 back out
   * after the note at index 0 was spent, the new note could derive a nullifier
   * already in the set and be unspendable from birth, with no error text that could
   * explain why. Asserted across a spend rather than in a straight line, because a
   * straight line is what a naive `store.length` also passes.
   */
  it("never reuses a leaf index, not even one whose note is already spent", async () => {
    const first = await pool.deposit(usdc, 1n);
    await pool.withdraw(first.id, "0x1111111111111111111111111111111111111111");
    const second = await pool.deposit(usdc, 1n);

    expect(first.leafIndex).toBe(0);
    expect(second.leafIndex).toBe(1);
    expect(await pool.notes()).toHaveLength(1);
  });

  /**
   * `deriveCommitment` throws on an out-of-range amount, and it throws before the
   * index is consumed. A hole in the tree would be harmless on its own and is exactly
   * the off-by-one that makes a later reconstruction disagree with the chain.
   */
  it("consumes no leaf index for a deposit that was refused", async () => {
    await expect(pool.deposit(usdc, MAX_NOTE_VALUE + 1n)).rejects.toThrow();
    await expect(pool.deposit(usdc, 0n)).rejects.toThrow();
    expect((await pool.deposit(usdc, 1n)).leafIndex).toBe(0);
  });

  it("refuses zero and negative deposits", async () => {
    await expect(pool.deposit(usdc, 0n)).rejects.toThrow("greater than zero");
    await expect(pool.deposit(usdc, -1n)).rejects.toThrow("greater than zero");
  });

  /**
   * The same bound `ShieldedPool.sol` reverts `AmountTooLarge` for, refused in the
   * browser where the user can read it. Checked here and not only in field.test.ts
   * because the bound is worthless if `deposit` never calls it — that is a wiring
   * fact about this method, not a fact about the helper.
   */
  it("refuses an amount larger than one note can hold", async () => {
    await expect(pool.deposit(usdc, MAX_NOTE_VALUE + 1n)).rejects.toThrow("2^248");
    await expect(pool.deposit(usdc, MAX_NOTE_VALUE)).resolves.toHaveProperty("amount");
  });

  it("keeps an 8-decimal token and a 6-decimal token apart", async () => {
    const a = await pool.deposit(aaplc, parseAmount("1", aaplc.decimals));
    const u = await pool.deposit(usdc, parseAmount("1", usdc.decimals));
    expect(a.amount).toBe(100_000_000n);
    expect(u.amount).toBe(1_000_000n);
    expect(a.token.decimals).toBe(8);
    expect(u.token.decimals).toBe(6);
  });
});

describe("LocalShieldedPool.notes", () => {
  it("is empty in a fresh browser", async () => {
    expect(await pool.notes()).toEqual([]);
  });

  it("lists newest first", async () => {
    const first = await pool.deposit(usdc, 1n);
    const second = await pool.deposit(usdc, 2n);
    expect((await pool.notes()).map((n) => n.id)).toEqual([second.id, first.id]);
  });

  it("hides spent notes by default and shows them when asked", async () => {
    const note = await pool.deposit(usdc, 1_000_000n);
    await pool.withdraw(note.id, "0x1111111111111111111111111111111111111111");

    expect(await pool.notes()).toEqual([]);
    const all = await pool.notes({ includeSpent: true });
    expect(all).toHaveLength(1);
    expect(all[0]?.spentAt).not.toBeNull();
  });

  it("treats includeSpent: false the same as omitting it", async () => {
    const note = await pool.deposit(usdc, 1_000_000n);
    await pool.withdraw(note.id, "0x1111111111111111111111111111111111111111");
    expect(await pool.notes({ includeSpent: false })).toEqual([]);
  });

  it("hands back a copy, so a caller cannot edit the pool's own list", async () => {
    await pool.deposit(usdc, 1n);
    const listed = await pool.notes();
    listed.length = 0;
    expect(await pool.notes()).toHaveLength(1);
  });
});

describe("LocalShieldedPool.send", () => {
  const to = "0x2222222222222222222222222222222222222222";

  it("spends the note and returns change as a new unspent note", async () => {
    const note = await pool.deposit(usdc, parseAmount("10", 6));
    const receipt = await pool.send(note.id, to, parseAmount("3", 6));

    expect(receipt.summary).toContain("You paid 3 USDC");
    expect(receipt.summary).toContain(to);
    expect(receipt.summary).toContain("The remaining 7 came back as a new note.");

    const unspent = await pool.notes();
    expect(unspent).toHaveLength(1);
    expect(unspent[0]?.amount).toBe(parseAmount("7", 6));
    expect(unspent[0]?.id).not.toBe(note.id);
  });

  it("conserves value: change plus payment equals the original note", async () => {
    const note = await pool.deposit(usdc, parseAmount("10", 6));
    await pool.send(note.id, to, parseAmount("3.5", 6));
    const change = (await pool.notes())[0] as Note;
    expect(change.amount + parseAmount("3.5", 6)).toBe(note.amount);
  });

  it("mints no change note when the whole note is spent", async () => {
    const note = await pool.deposit(usdc, parseAmount("10", 6));
    const receipt = await pool.send(note.id, to, parseAmount("10", 6));
    expect(receipt.summary).not.toContain("came back as a new note");
    expect(await pool.notes()).toEqual([]);
  });

  it("says the pool paid, not the user — that is the product", async () => {
    const note = await pool.deposit(usdc, parseAmount("1", 6));
    const receipt = await pool.send(note.id, to, parseAmount("1", 6));
    expect(receipt.summary).toContain("The pool paid it");
    expect(receipt.summary).toContain("never saw which note it came from");
  });

  it("refuses to overspend, and names both amounts in the token's own decimals", async () => {
    const note = await pool.deposit(aaplc, parseAmount("1.5", 8));
    await expect(pool.send(note.id, to, parseAmount("2", 8))).rejects.toThrow(
      "That note holds 1.5 AAPLc, which is less than 2.",
    );
  });

  it("leaves the note unspent when it refuses", async () => {
    const note = await pool.deposit(usdc, parseAmount("1", 6));
    await expect(pool.send(note.id, to, parseAmount("2", 6))).rejects.toThrow();
    expect((await pool.notes())[0]?.spentAt).toBeNull();
  });

  it("refuses zero and negative sends", async () => {
    const note = await pool.deposit(usdc, parseAmount("1", 6));
    await expect(pool.send(note.id, to, 0n)).rejects.toThrow("greater than zero");
    await expect(pool.send(note.id, to, -1n)).rejects.toThrow("greater than zero");
  });

  it("refuses an id this browser does not hold", async () => {
    await expect(pool.send("0xdeadbeef", to, 1n)).rejects.toThrow(
      "No note with id 0xdeadbeef in this browser.",
    );
  });

  it("refuses to spend the same note twice", async () => {
    const note = await pool.deposit(usdc, parseAmount("10", 6));
    await pool.send(note.id, to, parseAmount("1", 6));
    await expect(pool.send(note.id, to, parseAmount("1", 6))).rejects.toThrow(
      "A note spends once.",
    );
  });
});

describe("LocalShieldedPool.withdraw", () => {
  const to = "0x3333333333333333333333333333333333333333";

  it("spends the whole note and says the amount is now public", async () => {
    const note = await pool.deposit(aaplc, parseAmount("2.5", 8));
    const receipt = await pool.withdraw(note.id, to);

    expect(receipt.summary).toBe(
      `You withdrew 2.5 AAPLc to ${to}. That note is spent and the amount is now public.`,
    );
    expect(await pool.notes()).toEqual([]);
  });

  it("refuses an unknown id", async () => {
    await expect(pool.withdraw("0xnope", to)).rejects.toThrow("No note with id 0xnope");
  });

  it("refuses a note that was already spent", async () => {
    const note = await pool.deposit(usdc, 1n);
    await pool.withdraw(note.id, to);
    await expect(pool.withdraw(note.id, to)).rejects.toThrow("A note spends once.");
  });
});

/**
 * The spend rule, tested as the rule the chain enforces rather than the one this
 * browser finds convenient.
 *
 * `spentAt` used to be the authority. It passed every test above, and it would have
 * gone on passing right up to the day the on-chain adapter landed and the two
 * disagreed — because a timestamp is a fact about a mutable local object and
 * `mapping(bytes32 => bool) isSpent` is a fact about a chain. The tests that matter
 * here are the two that force them apart on purpose.
 */
describe("LocalShieldedPool: the nullifier set is the spend authority", () => {
  const to = "0x4444444444444444444444444444444444444444";

  it("has seen no nullifiers in a fresh browser", async () => {
    expect(await pool.nullifiers()).toEqual([]);
  });

  it("records nothing for a deposit — depositing is not spending", async () => {
    await pool.deposit(usdc, 1n);
    await pool.deposit(usdc, 2n);
    expect(await pool.nullifiers()).toEqual([]);
  });

  it("records the nullifier derived from the spent note's own secret and leaf index", async () => {
    const note = await pool.deposit(usdc, 1_000_000n);
    await pool.withdraw(note.id, to);
    expect(await pool.nullifiers()).toEqual([await nullifierOf(note)]);
  });

  it("records one nullifier per spend, including the spend that made change", async () => {
    const a = await pool.deposit(usdc, parseAmount("10", 6));
    await pool.send(a.id, to, parseAmount("3", 6));
    const change = (await pool.notes())[0] as Note;
    await pool.withdraw(change.id, to);

    expect(await pool.nullifiers()).toEqual([await nullifierOf(a), await nullifierOf(change)]);
  });

  /**
   * The demotion, in the direction that could lose money.
   *
   * `notes()` copies the array but not the notes, so `all[0]` is the pool's own
   * object — a caller (or a bug) can clear the timestamp. Under the old rule that
   * re-armed a spent note and the same funds spent twice. Under this one the set has
   * already seen the nullifier and nothing can talk it out of that.
   */
  it("still refuses a spent note after its spentAt is wiped", async () => {
    const note = await pool.deposit(usdc, parseAmount("5", 6));
    await pool.send(note.id, to, parseAmount("1", 6));

    const stored = (await pool.notes({ includeSpent: true })).find((n) => n.id === note.id) as Note;
    expect(stored.spentAt).not.toBeNull();
    stored.spentAt = null;

    await expect(pool.send(note.id, to, parseAmount("1", 6))).rejects.toThrow(
      "A note spends once.",
    );
  });

  /**
   * And the other direction, which is the same demotion seen from the front: a
   * timestamp on a note nobody spent is a display bug, not a lost note. The set has
   * never seen this nullifier, so the chain would accept the spend, so this pool does.
   */
  it("spends a note whose spentAt was stamped without a nullifier behind it", async () => {
    const note = await pool.deposit(usdc, parseAmount("5", 6));
    const stored = (await pool.notes())[0] as Note;
    stored.spentAt = "2026-01-01T00:00:00.000Z";

    const receipt = await pool.withdraw(note.id, to);
    expect(receipt.summary).toContain("You withdrew 5 USDC");
    expect(await pool.nullifiers()).toEqual([await nullifierOf(note)]);
  });

  /**
   * The invariant `adapters/types.ts` promises — both writes happen in `consume` and
   * nowhere else. Asserted over a mixed history rather than a single spend, since one
   * spend cannot tell "written together" from "written in two places that agree once".
   */
  it("keeps spentAt and the set agreeing across a mixed history", async () => {
    const spentWhole = await pool.deposit(usdc, parseAmount("1", 6));
    const spentPartly = await pool.deposit(usdc, parseAmount("10", 6));
    await pool.deposit(aaplc, parseAmount("2", 8));
    await pool.withdraw(spentWhole.id, to);
    await pool.send(spentPartly.id, to, parseAmount("4", 6));

    const set = new Set(await pool.nullifiers());
    const all = await pool.notes({ includeSpent: true });
    expect(all).toHaveLength(4);
    for (const note of all) {
      expect(set.has(await nullifierOf(note))).toBe(note.spentAt !== null);
    }
    expect(set.size).toBe(all.filter((n) => n.spentAt !== null).length);
  });

  /**
   * A nullifier is published; a secret and a commitment are not. If the nullifier
   * leaked either, publishing the spend would deanonymise the note it spent, which is
   * the one thing the scheme exists to prevent. Both guarantees come from the domain
   * tag in `lib/hash.ts`; this asserts the pool actually gets them.
   */
  it("publishes a nullifier that reveals neither the secret nor the commitment", async () => {
    const note = await pool.deposit(usdc, 1_000_000n);
    await pool.withdraw(note.id, to);
    const [nullifier] = await pool.nullifiers();

    expect(nullifier).toMatch(/^0x[0-9a-f]{64}$/);
    expect(nullifier).not.toContain(note.secret.toString(16));
    expect(nullifier).not.toBe(commitmentHex(note.commitment));
  });

  it("hands back a copy, so a caller cannot forge or forget a spend", async () => {
    const note = await pool.deposit(usdc, 1n);
    await pool.withdraw(note.id, to);

    const listed = await pool.nullifiers();
    listed.length = 0;
    listed.push("0xdeadbeef");
    expect(await pool.nullifiers()).toEqual([await nullifierOf(note)]);
  });
});

/**
 * The tree the pool hands out leaf indices from, tested through the pool.
 *
 * `tests/tree.test.ts` already proves the tree is a tree. What is unproven until here
 * is that the POOL's notes are in it — that `leafIndex` names the position where this
 * note's own commitment actually sits, rather than being a number that happens to
 * count up. The fold below is the check, because it fails for any mismatch between
 * the note and the leaf.
 */
describe("LocalShieldedPool: the notes are in a real tree", () => {
  const to = "0x5555555555555555555555555555555555555555";

  /**
   * Fold a witness the way a verifier would, with no help from the pool.
   *
   * Deliberately a second implementation rather than a call into `lib/tree.ts`: a test
   * that folds with the same code that built the path proves the code agrees with
   * itself. This one only knows the scheme.
   */
  async function foldWitness(w: NoteWitness): Promise<bigint> {
    let node = w.leaf.value;
    for (const [i, sibling] of w.siblings.entries()) {
      node =
        w.isRight[i] === true
          ? await standInHash.hash(TREE_NODE_DOMAIN, [sibling, node])
          : await standInHash.hash(TREE_NODE_DOMAIN, [node, sibling]);
    }
    return node;
  }

  it("has a root before anything is deposited, because an empty tree has one", async () => {
    const root = await pool.root();
    expect(root.value).toBeGreaterThan(0n);
    expect(isInField(root.value)).toBe(true);
  });

  it("tags the root as a stand-in and says why, so it cannot pass for a deployed root", async () => {
    const root = await pool.root();
    expect(root.scheme).toBe("stand-in");
    if (root.scheme !== "stand-in") throw new Error("unreachable: asserted above");
    /**
     * Asserted against the hash's own sentence rather than a quoted phrase: the point
     * of `tagWithScheme` is that the reason travels from the hash instead of being
     * retyped at each call site, and a hardcoded substring here would pass even if the
     * pool grew its own reassuring copy of it.
     */
    expect(root.why).toBe(standInHash.whyNotCircuitReady);
  });

  it("moves the root on every deposit", async () => {
    const seen = new Set<bigint>([(await pool.root()).value]);
    for (let i = 0; i < 4; i++) {
      await pool.deposit(usdc, BigInt(i + 1));
      seen.add((await pool.root()).value);
    }
    expect(seen.size).toBe(5);
  });

  it("serves a witness that folds back to the pool's own root", async () => {
    await pool.deposit(usdc, 1n);
    const note = await pool.deposit(usdc, 2n);
    await pool.deposit(usdc, 3n);

    const w = await pool.witness(note.id);
    expect(w.leafIndex).toBe(note.leafIndex);
    expect(w.leaf).toEqual(note.commitment);
    expect(await foldWitness(w)).toBe((await pool.root()).value);
    expect(w.root.value).toBe((await pool.root()).value);
  });

  it("serves a witness for every note it holds, at every size of tree", async () => {
    const notes: Note[] = [];
    for (let n = 1; n <= 6; n++) {
      notes.push(await pool.deposit(usdc, BigInt(n)));
      const root = (await pool.root()).value;
      for (const note of notes) {
        expect(await foldWitness(await pool.witness(note.id))).toBe(root);
      }
    }
  });

  it("gives each note a witness distinct from its neighbour's", async () => {
    const a = await pool.deposit(usdc, 1n);
    const b = await pool.deposit(usdc, 1n);

    const wa = await pool.witness(a.id);
    const wb = await pool.witness(b.id);
    /** Same amount, so only the secret differs — and the leaf must differ with it. */
    expect(wa.leaf.value).not.toBe(wb.leaf.value);
    expect(wa.isRight[0]).toBe(false);
    expect(wb.isRight[0]).toBe(true);
    /** Siblings at level 0 are each other's leaves. */
    expect(wa.siblings[0]).toBe(wb.leaf.value);
    expect(wb.siblings[0]).toBe(wa.leaf.value);
  });

  it("gives the witness one sibling per level of the deployed depth", async () => {
    const note = await pool.deposit(usdc, 1n);
    const w = await pool.witness(note.id);
    expect(w.siblings).toHaveLength(20);
    expect(w.isRight).toHaveLength(20);
  });

  it("still serves a witness for a note that has been spent", async () => {
    const note = await pool.deposit(usdc, parseAmount("5", 6));
    await pool.withdraw(note.id, to);

    const w = await pool.witness(note.id);
    expect(await foldWitness(w)).toBe((await pool.root()).value);
  });

  it("refuses a witness for an id this browser does not hold", async () => {
    await expect(pool.witness("0xnope")).rejects.toThrow("No note with id 0xnope");
  });

  /**
   * The bug this test exists for, and it is not a hypothetical.
   *
   * `IncrementalMerkleTree.insert` awaits `levels` hashes. Two deposits in flight at
   * once interleave inside it, both write `filledSubtrees`, and the tree ends up with a
   * root belonging to neither — **without throwing**. Every note comes back looking
   * correct and every proof fails later, on chain. `Promise.all` over deposits is an
   * ordinary thing to write, so the pool serializes rather than documenting a rule
   * about how it must be called.
   */
  it("survives concurrent deposits: distinct indices, and a tree that agrees", async () => {
    const parallel = await Promise.all(
      Array.from({ length: 8 }, (_, i) => pool.deposit(usdc, BigInt(i + 1))),
    );
    expect([...parallel].map((n) => n.leafIndex).sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);

    const root = (await pool.root()).value;
    for (const note of parallel) {
      expect(await foldWitness(await pool.witness(note.id))).toBe(root);
    }
  });

  it("reaches the same root concurrently as serially, for the same leaves in order", async () => {
    /**
     * Two pools fed identical commitments, one eight-at-a-time and one one-at-a-time.
     * The deposits cannot be reused — each mints a fresh secret — so the leaves come
     * from the concurrent pool's notes, replayed into a bare tree in index order.
     */
    const parallel = await Promise.all(
      Array.from({ length: 8 }, (_, i) => pool.deposit(usdc, BigInt(i + 1))),
    );
    const inOrder = [...parallel].sort((a, b) => a.leafIndex - b.leafIndex);

    const replay = await IncrementalMerkleTree.create({
      levels: 20,
      hash: standInHash,
      emptyLeaf: await standInHash.hash("tree.empty-leaf", [0n]),
    });
    for (const note of inOrder) await replay.insert(note.commitment.value);

    expect(replay.root()).toBe((await pool.root()).value);
  });

  it("keeps a refused deposit out of the tree entirely", async () => {
    const before = (await pool.root()).value;
    await expect(pool.deposit(usdc, 0n)).rejects.toThrow("greater than zero");
    expect((await pool.root()).value).toBe(before);

    /** And the next real deposit still takes leaf zero. */
    const note = await pool.deposit(usdc, 1n);
    expect(note.leafIndex).toBe(0);
  });

  /**
   * A rejection must not take the queue down with it.
   *
   * `serialize` chains on the previous entry, so a naive `this.queue.then(body)` would
   * propagate one caller's rejection into every caller after it — the pool would stop
   * working for good the first time a user typed a bad amount.
   */
  it("keeps working after a refusal, even one queued behind other work", async () => {
    const results = await Promise.allSettled([
      pool.deposit(usdc, 1n),
      pool.deposit(usdc, 0n),
      pool.deposit(usdc, 2n),
      pool.send("0xnope", to, 1n),
      pool.deposit(usdc, 3n),
    ]);
    expect(results.map((r) => r.status)).toEqual([
      "fulfilled",
      "rejected",
      "fulfilled",
      "rejected",
      "fulfilled",
    ]);
    expect((await pool.notes()).map((n) => n.leafIndex).sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it("makes the change note a leaf too, so it can be spent later", async () => {
    const note = await pool.deposit(usdc, parseAmount("5", 6));
    await pool.send(note.id, to, parseAmount("2", 6));

    const change = (await pool.notes())[0] as Note;
    expect(change.leafIndex).toBe(1);
    expect(await foldWitness(await pool.witness(change.id))).toBe((await pool.root()).value);
  });
});

describe("LocalEnclave", () => {
  const enclave = new LocalEnclave();

  it("is not live", () => {
    expect(enclave.isLive).toBe(false);
  });

  it("offers three models, priced in USDC base units", async () => {
    const models = await enclave.models();
    expect(models.map((m) => m.id)).toEqual(["quadra-small", "quadra-medium", "quadra-large"]);
    for (const m of models) expect(m.priceBaseUnits).toBeGreaterThan(0n);
  });

  it("prices them in ascending order, so the labels are not the only signal", async () => {
    const prices = (await enclave.models()).map((m) => m.priceBaseUnits);
    expect(prices).toEqual([...prices].sort((a, b) => (a < b ? -1 : 1)));
  });

  it("quotes prices that format as real USDC amounts", async () => {
    const models = await enclave.models();
    expect(models.map((m) => formatAmount(m.priceBaseUnits, USDC.decimals))).toEqual([
      "0.001",
      "0.01",
      "0.1",
    ]);
  });

  it("hands back a copy of the model list", async () => {
    const models = await enclave.models();
    models.length = 0;
    expect(await enclave.models()).toHaveLength(LOCAL_MODELS.length);
  });

  it("attests nothing, and carries no field a verifier could check", async () => {
    const out = await enclave.infer("quadra-medium", "what is this");
    expect(out.attestation).toEqual({
      kind: "local-dev",
      why: "no enclave is running — this answer was not attested by anything",
    });
    expect(out.attestation).not.toHaveProperty("quote");
    expect(out.attestation).not.toHaveProperty("measurement");
    expect(out.attestation).not.toHaveProperty("verified");
  });

  it("says up front that no model ran, in the first line", async () => {
    const out = await enclave.infer("quadra-small", "hello");
    expect(out.text.split("\n")[0]).toBe("[no model ran]");
  });

  it("carries the prompt back intact, which is all a stub can honestly prove", async () => {
    const prompt = "keep\tthis";
    const out = await enclave.infer("quadra-small", `  ${prompt}  `);
    expect(out.text).toContain(JSON.stringify(prompt));
    // counted after trimming, so the padding is not reported as content
    expect(out.text).toContain(`received ${prompt.length}`);
  });

  it("reports which model was asked for", async () => {
    expect((await enclave.infer("quadra-large", "x")).model).toBe("quadra-large");
  });

  it("refuses an unknown model and lists the real ones", async () => {
    await expect(enclave.infer("gpt-4", "x")).rejects.toThrow(
      'No model called "gpt-4". Available: quadra-small, quadra-medium, quadra-large.',
    );
  });

  it("refuses an empty prompt", async () => {
    await expect(enclave.infer("quadra-small", "")).rejects.toThrow("Enter a prompt.");
    await expect(enclave.infer("quadra-small", "   \n ")).rejects.toThrow("Enter a prompt.");
  });
});

describe("resolver", () => {
  it("reports not ready while the pool and verifier are unset", () => {
    expect(CONTRACTS.shieldedPool).toBeNull();
    expect(CONTRACTS.verifier).toBeNull();
    expect(onchainReady()).toBe(false);
  });

  it("needs BOTH the pool and its verifier, not either one", () => {
    const addr = "0x4444444444444444444444444444444444444444";
    expect(bothDeployed(null, null)).toBe(false);
    expect(bothDeployed(addr, null)).toBe(false);
    expect(bothDeployed(null, addr)).toBe(false);
    expect(bothDeployed(addr, addr)).toBe(true);
  });

  it("returns the local pool when nothing is deployed", () => {
    expect(resolvePool(false)).toBeInstanceOf(LocalShieldedPool);
  });

  /**
   * The branch that matters on deploy day. Tested by passing `ready` directly:
   * `onchainReady` closes over the real CONTRACTS, so this path is unreachable
   * by mocking, and would otherwise first run in production.
   */
  it("throws rather than silently serving local state once a pool is deployed", () => {
    expect(() => resolvePool(true)).toThrow(
      "no on-chain ShieldedPool is implemented yet",
    );
  });

  it("builds both adapters, and neither claims to be live", () => {
    const { pool: p, enclave: e } = adapters();
    expect(p).toBeInstanceOf(LocalShieldedPool);
    expect(e).toBeInstanceOf(LocalEnclave);
    expect(p.isLive).toBe(false);
    expect(e.isLive).toBe(false);
  });

  /**
   * The catalog resolves live while the other two do not, by the same rule: return
   * whatever actually exists. There is no deployed pool and no TEE, but the catalog
   * is a free CORS-open GET that answers today — so handing back the stub would be
   * choosing four invented tools over the 115 real ones.
   */
  it("resolves the real catalog, not the offline stub", () => {
    const { catalog } = adapters();
    expect(catalog).toBeInstanceOf(HttpCatalog);
    expect(catalog).not.toBeInstanceOf(LocalCatalog);
  });

  /**
   * Live reads, and still not live: `isLive` is about settlement, and nothing settles.
   * A free run reaching upstream for real does not change that — it returns an answer
   * nobody paid for, which is the opposite of a settlement.
   */
  it("does not let a live read make the catalog claim it settled anything", () => {
    const { catalog } = adapters();
    expect(catalog.isLive).toBe(false);
    expect(catalog.whyNot({ kind: "free", why: "no payment" })).toBeNull();
    expect(
      catalog.whyNot({
        kind: "paid",
        payTo: BLUEAGENT.knownPayTo,
        amountBaseUnits: 10_000n,
        asset: usdc,
        network: "eip155:8453",
      }),
    ).not.toBeNull();
  });

  it("gives each call its own pool, so one page cannot read another's notes", async () => {
    const a = adapters();
    await a.pool.deposit(usdc, 1n);
    expect(await adapters().pool.notes()).toEqual([]);
  });
});
