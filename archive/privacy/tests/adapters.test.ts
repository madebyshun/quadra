import { beforeEach, describe, expect, it } from "vitest";
import { adapters, bothDeployed, onchainReady, resolvePool } from "@/adapters";
import { LocalShieldedPool } from "@/adapters/local/pool";
import { LOCAL_MODELS, LocalEnclave } from "@/adapters/local/enclave";
import { LOCAL_TOOLS, LocalCatalog, priceOf } from "@/adapters/local/catalog";
import { HttpCatalog } from "@/adapters/http/catalog";
import type { Note, NoteWitness } from "@/adapters/types";
import type { NoteStore, StoredNote, StoredPool } from "@/adapters/local/store";
import { LocalStorageNoteStore, MemoryNoteStore, STORE_KEY, STORE_VERSION } from "@/adapters/local/store";
import { BACKUP_FORMAT } from "@/lib/backup";
import { CONTRACTS, USDC, WETH } from "@/config/chain";
import { formatAmount, parseAmount } from "@/lib/amount";
import { FIELD_MODULUS, MAX_NOTE_VALUE, isInField } from "@/lib/field";
import { standInHash } from "@/lib/hash";
import { commitmentHex, deriveCommitment, deriveNullifier } from "@/lib/note";
import { IncrementalMerkleTree, TREE_NODE_DOMAIN } from "@/lib/tree";

/** The nullifier the pool must have recorded for a note it spent. */
async function nullifierOf(note: Note): Promise<string> {
  return commitmentHex(await deriveNullifier(standInHash, { secret: note.secret }, note.leafIndex));
}

/**
 * Fold a witness the way a verifier would, with no help from the pool.
 *
 * Deliberately a second implementation rather than a call into `lib/tree.ts`: a test that
 * folds with the same code that built the path proves the code agrees with itself. This
 * one only knows the scheme.
 *
 * At module scope because two blocks need it — the tree tests and the reload tests. A
 * witness that folds to the same root after a reload is the strongest single statement
 * this suite makes, since it is the one thing a proof will actually consume.
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

const usdc = { address: USDC.address, symbol: USDC.symbol, decimals: USDC.decimals };
const weth = { address: WETH.address, symbol: WETH.symbol, decimals: WETH.decimals };

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
    const third = await pool.deposit(weth, 1n);
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

  it("keeps an 18-decimal token and a 6-decimal token apart", async () => {
    const a = await pool.deposit(weth, parseAmount("1", weth.decimals));
    const u = await pool.deposit(usdc, parseAmount("1", usdc.decimals));
    expect(a.amount).toBe(10n ** 18n);
    expect(u.amount).toBe(1_000_000n);
    expect(a.token.decimals).toBe(18);
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
    expect(receipt.summary).toContain("The remaining 7 stays in your private balance.");

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
    expect(receipt.summary).not.toContain("stays in your private balance");
    expect(await pool.notes()).toEqual([]);
  });

  it("says the pool paid, not the user — that is the product", async () => {
    const note = await pool.deposit(usdc, parseAmount("1", 6));
    const receipt = await pool.send(note.id, to, parseAmount("1", 6));
    expect(receipt.summary).toContain("The pool paid it");
    expect(receipt.summary).toContain("cannot see where it came from");
  });

  it("refuses to overspend, and names both amounts in the token's own decimals", async () => {
    const note = await pool.deposit(weth, parseAmount("1.5", 18));
    await expect(pool.send(note.id, to, parseAmount("2", 18))).rejects.toThrow(
      "That note holds 1.5 WETH, which is less than 2.",
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

describe("LocalShieldedPool.swap", () => {
  it("spends the input note and mints a note in the output token", async () => {
    const note = await pool.deposit(usdc, parseAmount("10", 6));
    const receipt = await pool.swap(note.id, weth, parseAmount("3", 6), parseAmount("1", 18));

    expect(receipt.summary).toContain("You swapped 3 USDC for 1 WETH");
    expect(receipt.summary).toContain("not a fill from any real market");

    const unspent = await pool.notes();
    expect(unspent).toHaveLength(2);
    const bySymbol = Object.fromEntries(unspent.map((n) => [n.token.symbol, n]));
    expect(bySymbol.WETH?.amount).toBe(parseAmount("1", 18));
    expect(bySymbol.USDC?.amount).toBe(parseAmount("7", 6));
  });

  it("mints no change note when the whole note is spent", async () => {
    const note = await pool.deposit(usdc, parseAmount("10", 6));
    const receipt = await pool.swap(note.id, weth, parseAmount("10", 6), parseAmount("3", 18));
    expect(receipt.summary).not.toContain("came back as a new note");
    const unspent = await pool.notes();
    expect(unspent).toHaveLength(1);
    expect(unspent[0]?.token.symbol).toBe("WETH");
  });

  it("refuses to overspend, and names both amounts in the token's own decimals", async () => {
    const note = await pool.deposit(weth, parseAmount("1.5", 18));
    await expect(
      pool.swap(note.id, usdc, parseAmount("2", 18), parseAmount("600", 6)),
    ).rejects.toThrow("That note holds 1.5 WETH, which is less than 2.");
  });

  it("leaves the note unspent when it refuses", async () => {
    const note = await pool.deposit(usdc, parseAmount("1", 6));
    await expect(
      pool.swap(note.id, weth, parseAmount("2", 6), parseAmount("1", 18)),
    ).rejects.toThrow();
    expect((await pool.notes())[0]?.spentAt).toBeNull();
  });

  it("refuses zero and negative amounts", async () => {
    const note = await pool.deposit(usdc, parseAmount("1", 6));
    await expect(pool.swap(note.id, weth, 0n, parseAmount("1", 18))).rejects.toThrow(
      "greater than zero",
    );
    await expect(pool.swap(note.id, weth, -1n, parseAmount("1", 18))).rejects.toThrow(
      "greater than zero",
    );
  });

  it("refuses a quote that came back at zero", async () => {
    const note = await pool.deposit(usdc, parseAmount("1", 6));
    await expect(pool.swap(note.id, weth, parseAmount("1", 6), 0n)).rejects.toThrow(
      "quote came back at zero",
    );
  });

  it("refuses an id this browser does not hold", async () => {
    await expect(pool.swap("0xdeadbeef", weth, 1n, 1n)).rejects.toThrow(
      "No note with id 0xdeadbeef in this browser.",
    );
  });

  it("refuses to spend the same note twice", async () => {
    const note = await pool.deposit(usdc, parseAmount("10", 6));
    await pool.swap(note.id, weth, parseAmount("1", 6), parseAmount("1", 18));
    await expect(
      pool.swap(note.id, weth, parseAmount("1", 6), parseAmount("1", 18)),
    ).rejects.toThrow("A note spends once.");
  });
});

describe("LocalShieldedPool.withdraw", () => {
  const to = "0x3333333333333333333333333333333333333333";

  it("spends the whole note and says the amount is now public", async () => {
    const note = await pool.deposit(weth, parseAmount("2.5", 18));
    const receipt = await pool.withdraw(note.id, to);

    expect(receipt.summary).toBe(
      `You withdrew 2.5 WETH to ${to}. That note is spent and the amount is now public.`,
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
    await pool.deposit(weth, parseAmount("2", 18));
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

/**
 * Reloading the page is the test. Everything else in this file runs against one pool
 * object; a user runs against a new one every time they refresh, and until this block
 * existed nothing checked that the second one could find the money.
 *
 * `reopen` is the whole device: same store, new pool, exactly what a refresh does.
 */
describe("LocalShieldedPool: the money survives a reload", () => {
  const to = "0x6666666666666666666666666666666666666666";
  let disk: MemoryNoteStore;

  beforeEach(() => {
    disk = new MemoryNoteStore();
    pool = new LocalShieldedPool(standInHash, disk);
  });

  /** A fresh pool over the same store — a page reload, with nothing carried in memory. */
  function reopen(): LocalShieldedPool {
    return new LocalShieldedPool(standInHash, disk);
  }

  it("writes nothing until there is something to write", async () => {
    expect(await disk.load()).toBeNull();
    /** A read must not create a record — an empty pool that saves has invented a fact. */
    expect(await pool.notes()).toEqual([]);
    expect(await disk.load()).toBeNull();
  });

  it("brings back the notes, with their amounts intact", async () => {
    await pool.deposit(usdc, parseAmount("2.5", 6));
    await pool.deposit(weth, parseAmount("1.25", 18));

    const after = await reopen().notes();
    expect(after.map((n) => [n.token.symbol, n.amount])).toEqual([
      ["WETH", parseAmount("1.25", 18)],
      ["USDC", parseAmount("2.5", 6)],
    ]);
  });

  it("brings back amounts too large for a double, exactly", async () => {
    /**
     * The trap this pins: `JSON.stringify` throws on a bigint rather than coercing it,
     * so the encoding has to be explicit — and the obvious explicit choice, a number,
     * is lossy. `Number(2n ** 200n)` round-trips to a different integer with no error.
     */
    const huge = 2n ** 200n + 12345n;
    await pool.deposit(usdc, huge);
    expect(((await reopen().notes())[0] as Note).amount).toBe(huge);
  });

  it("brings back the secret exactly, because the money is the secret", async () => {
    const note = await pool.deposit(usdc, 7n);
    expect(((await reopen().notes())[0] as Note).secret).toBe(note.secret);
  });

  it("re-derives the commitment rather than trusting a stored one", async () => {
    const note = await pool.deposit(usdc, 7n);
    const back = (await reopen().notes())[0] as Note;

    expect(back.commitment).toEqual(note.commitment);
    expect(back.commitment).toEqual(await deriveCommitment(standInHash, { amount: 7n, secret: note.secret }));
    /** Nothing on disk claims a scheme, so nothing on disk can claim the wrong one. */
    expect(JSON.stringify(await disk.load())).not.toContain("poseidon");
    expect(JSON.stringify(await disk.load())).not.toContain("scheme");
  });

  it("rebuilds the same tree: same root, and witnesses that still fold", async () => {
    for (let i = 1; i <= 5; i++) await pool.deposit(usdc, BigInt(i));
    const before = await pool.root();
    const notes = await pool.notes();

    const back = reopen();
    expect((await back.root()).value).toBe(before.value);
    for (const note of notes) {
      const w = await back.witness(note.id);
      expect(w.leafIndex).toBe(note.leafIndex);
      expect(w.root.value).toBe(before.value);
    }
  });

  /**
   * ⚠️ The test above looks like it covers this and does not, which is why both exist.
   *
   * It reaches `witness` through `back.root()` and a `notes()` call that already ran, so
   * the pool was hydrated before the witness was ever asked for. Mutation-checked: with
   * hydration removed from the lookup, that test still passed and only the three *spend*
   * tests went red — the witness path was being carried by its neighbours' side effects.
   *
   * A witness is the first thing a proof needs, so it is exactly the call a real client
   * makes first on a fresh page. Asked here with nothing run before it.
   */
  it("serves a witness as the very first call on a reopened pool", async () => {
    const note = await pool.deposit(usdc, parseAmount("3", 6));
    const expected = (await pool.root()).value;

    const w = await reopen().witness(note.id);
    expect(w.leafIndex).toBe(note.leafIndex);
    expect(w.leaf.value).toBe(note.commitment.value);
    expect(await foldWitness(w)).toBe(expected);
  });

  it("rebuilds the tree from leaf order, not the order the file happens to list", async () => {
    for (let i = 1; i <= 4; i++) await pool.deposit(usdc, BigInt(i));
    const expected = (await pool.root()).value;

    /**
     * The file is written newest-first, so a rebuild that trusted array order would
     * insert leaf 3 at position 0 and produce a root belonging to no one — silently,
     * since every note would still look correct. Shuffling proves the order on disk is
     * not load-bearing.
     */
    const saved = (await disk.load()) as StoredPool;
    await disk.save({ ...saved, notes: [...saved.notes].reverse() });
    expect((await reopen().root()).value).toBe(expected);
  });

  it("still refuses a note that was spent before the reload", async () => {
    const note = await pool.deposit(usdc, parseAmount("5", 6));
    await pool.send(note.id, to, parseAmount("2", 6));

    const back = reopen();
    await expect(back.send(note.id, to, parseAmount("1", 6))).rejects.toThrow("A note spends once.");
    expect(await back.nullifiers()).toEqual([await nullifierOf(note)]);
  });

  it("brings the change note back spendable", async () => {
    const note = await pool.deposit(usdc, parseAmount("5", 6));
    await pool.send(note.id, to, parseAmount("2", 6));

    const back = reopen();
    const change = (await back.notes())[0] as Note;
    expect(change.amount).toBe(parseAmount("3", 6));
    const receipt = await back.withdraw(change.id, to);
    expect(receipt.summary).toContain("You withdrew 3 USDC");
  });

  /**
   * The security case, and the reason the nullifier set is stored rather than rebuilt
   * from `spentAt`. `tests/adapters.test.ts` already pins that a wiped `spentAt` does not
   * un-spend a note **in memory**; this pins that the guarantee survives a refresh,
   * which it would not if the set were derived from the timestamps on load.
   */
  it("keeps refusing a spent note whose spentAt was wiped on disk", async () => {
    const note = await pool.deposit(usdc, parseAmount("5", 6));
    await pool.withdraw(note.id, to);

    const saved = (await disk.load()) as StoredPool;
    await disk.save({
      ...saved,
      notes: saved.notes.map((n) => ({ ...n, spentAt: null })),
    });

    const back = reopen();
    await expect(back.withdraw(note.id, to)).rejects.toThrow("A note spends once.");
  });

  /**
   * The mirror image, and it resolves the other way on purpose — see `SAFE_REPAIR`.
   * Believing the stripped set would allow a second spend of a note that is already
   * gone: locally it succeeds, on chain it is rejected, and the user has been shown
   * money that does not exist. So the union wins and the spend stays refused.
   */
  it("refuses a note stamped spent even when its nullifier was stripped from the set", async () => {
    const note = await pool.deposit(usdc, parseAmount("5", 6));
    await pool.withdraw(note.id, to);

    const saved = (await disk.load()) as StoredPool;
    await disk.save({ ...saved, nullifiers: [] });

    const back = reopen();
    await expect(back.withdraw(note.id, to)).rejects.toThrow("A note spends once.");
    /** And the derived nullifier is back in the set, so the next reload needs no repair. */
    expect(await back.nullifiers()).toEqual([await nullifierOf(note)]);
  });

  it("keeps spending across several reloads without drifting", async () => {
    for (let i = 0; i < 3; i++) {
      const p = reopen();
      const note = await p.deposit(usdc, parseAmount("1", 6));
      await p.withdraw(note.id, to);
    }

    const back = reopen();
    expect(await back.notes()).toEqual([]);
    expect(await back.notes({ includeSpent: true })).toHaveLength(3);
    expect(await back.nullifiers()).toHaveLength(3);
    expect((await back.notes({ includeSpent: true })).map((n) => n.leafIndex)).toEqual([2, 1, 0]);
  });

  it("surfaces a failed write instead of pretending the deposit happened", async () => {
    const failing: NoteStore = {
      load: async () => null,
      save: async () => {
        throw new Error("QuotaExceededError");
      },
    };
    const p = new LocalShieldedPool(standInHash, failing);
    await expect(p.deposit(usdc, 1n)).rejects.toThrow("QuotaExceededError");
  });
});

/**
 * Restoring into a pool that is already awake.
 *
 * `tests/backup.test.ts` covers the file format against a bare store. This block covers
 * the thing a store cannot see: a `LocalShieldedPool` object that has already hydrated
 * holds the *old* notes in `this.store`, the old nullifiers in `this.spent`, and a built
 * `this.tree` — and `ready()` short-circuits on that tree, so it will never read the disk
 * again on its own.
 *
 * 🔴 So the failure mode here is not a bad restore, it is a restore that WORKS and is
 * then thrown away. Import outside the pool and the file on disk is right while the live
 * object is wrong; the next deposit calls `persist()`, which writes `this.store` — the
 * pre-restore notes — back over the restored file. The user restored their money, saw a
 * success message, did one more thing, and lost it, with the backup file possibly already
 * deleted. Nothing throws at any point.
 *
 * Every test below fails if the cache-drop in `importBackup` is removed. That was checked
 * by removing it, not assumed: see the mutation table in TASKS.md step 1g.
 */
describe("LocalShieldedPool: restoring into a live object", () => {
  const to = "0x6666666666666666666666666666666666666666";

  /** A filled pool, its backup text, and a second empty browser to restore it into. */
  async function backedUp(): Promise<{ text: string; source: LocalShieldedPool; notes: Note[] }> {
    const disk = new MemoryNoteStore();
    const source = new LocalShieldedPool(standInHash, disk);
    await source.deposit(usdc, parseAmount("2.5", 6));
    await source.deposit(weth, parseAmount("1.25", 18));
    const { body } = await source.exportBackup();
    return { text: body, source, notes: await source.notes() };
  }

  it("exports through the pool with the same bytes the module would write", async () => {
    const { text } = await backedUp();
    expect(JSON.parse(text)).toMatchObject({ format: BACKUP_FORMAT });
  });

  it("refuses to export a pool with nothing in it", async () => {
    const empty = new LocalShieldedPool(standInHash, new MemoryNoteStore());
    await expect(empty.exportBackup()).rejects.toThrow("nothing to back up");
  });

  /**
   * The plain case, and the weakest of these: this one passes even with the cache-drop
   * removed, because a pool that has never been asked anything has no cache to be wrong.
   * It is here to prove the restore works at all, so that the tests below are testing
   * staleness rather than a broken import.
   */
  it("restores into a pool that has not been touched yet", async () => {
    const { text, notes } = await backedUp();
    const fresh = new LocalShieldedPool(standInHash, new MemoryNoteStore());

    expect(await fresh.importBackup(text)).toEqual({ notes: 2 });
    expect((await fresh.notes()).map((n) => [n.token.symbol, n.amount])).toEqual(
      notes.map((n) => [n.token.symbol, n.amount]),
    );
  });

  it("serves the restored notes from a pool that had already hydrated as empty", async () => {
    const { text, notes, source } = await backedUp();
    const fresh = new LocalShieldedPool(standInHash, new MemoryNoteStore());

    /** The whole point: this call builds the tree and latches "no notes here". */
    expect(await fresh.notes()).toEqual([]);
    await fresh.importBackup(text);

    expect((await fresh.notes()).map((n) => n.id)).toEqual(notes.map((n) => n.id));
    /**
     * Compared against the pool the file came from — the same object, not a second
     * `backedUp()`, whose notes would carry freshly drawn secrets and so a different
     * root for entirely uninteresting reasons.
     */
    expect((await fresh.root()).value).toBe((await source.root()).value);
  });

  /**
   * 🔴 The data-loss test. Everything above could pass while this one fails, because the
   * others only ask the pool to *read* — and a stale cache reads as a cosmetic bug right
   * up to the first write, which is where it eats the file.
   */
  it("does not put the pre-restore notes back on the next deposit", async () => {
    const { text, notes } = await backedUp();
    const target = new MemoryNoteStore();
    const fresh = new LocalShieldedPool(standInHash, target);
    await fresh.notes();

    await fresh.importBackup(text);
    await fresh.deposit(usdc, parseAmount("9", 6));

    /** Read the disk, not the object: the object is what would be lying. */
    const saved = (await target.load()) as StoredPool;
    expect(saved.notes).toHaveLength(3);
    expect(saved.notes.map((n) => n.id)).toEqual(expect.arrayContaining(notes.map((n) => n.id)));
    /** And reopening that file finds all three, in one contiguous tree. */
    expect(await new LocalShieldedPool(standInHash, target).notes()).toHaveLength(3);
  });

  /**
   * The same hazard through the other cache. `this.spent` is the spend authority, so a
   * stale one is worse than stale notes: it either un-spends a note that is spent, or
   * blocks one that is not.
   */
  it("restores the spend authority, not just the notes", async () => {
    const disk = new MemoryNoteStore();
    const source = new LocalShieldedPool(standInHash, disk);
    const spend = await source.deposit(usdc, parseAmount("5", 6));
    const keep = await source.deposit(usdc, parseAmount("3", 6));
    await source.withdraw(spend.id, to);
    const { body } = await source.exportBackup();

    const fresh = new LocalShieldedPool(standInHash, new MemoryNoteStore());
    await fresh.notes();
    await fresh.importBackup(body);

    /** Spent stays spent across the restore — a backup that un-spends is a double-spend. */
    await expect(fresh.withdraw(spend.id, to)).rejects.toThrow("A note spends once.");
    /**
     * And the note that was never spent is still spendable. Asserted on the amount in the
     * summary rather than on "it resolved": a restore that mixed the two notes up would
     * resolve just as happily while paying out the wrong one.
     */
    await expect(fresh.withdraw(keep.id, to)).resolves.toMatchObject({
      summary: expect.stringContaining("3 USDC"),
    });
  });

  it("appends after a restore at the right leaf index, so witnesses still fold", async () => {
    const { text } = await backedUp();
    const fresh = new LocalShieldedPool(standInHash, new MemoryNoteStore());
    await fresh.notes();
    await fresh.importBackup(text);

    const added = await fresh.deposit(usdc, parseAmount("9", 6));
    /** Two restored leaves occupy 0 and 1; a stale tree would hand this one 0. */
    expect(added.leafIndex).toBe(2);

    const w = await fresh.witness(added.id);
    expect(await foldWitness(w)).toBe((await fresh.root()).value);
  });

  /**
   * A refusal must be inert. `importBackup` checks the file before it writes, so a
   * rejected import has to leave the live object exactly as it was — if it cleared the
   * caches first and then threw, a user who picked the wrong file would watch their notes
   * disappear from a pool that is still perfectly intact on disk.
   */
  it("leaves a live pool untouched when the file is refused", async () => {
    const disk = new MemoryNoteStore();
    const pool = new LocalShieldedPool(standInHash, disk);
    const note = await pool.deposit(usdc, parseAmount("4", 6));
    const before = await pool.root();

    await expect(pool.importBackup("not json at all")).rejects.toThrow("not even JSON");
    await expect(pool.importBackup('{"format":"something.else"}')).rejects.toThrow(
      "not a Quadra backup",
    );

    expect((await pool.notes()).map((n) => n.id)).toEqual([note.id]);
    expect((await pool.root()).value).toBe(before.value);
    /** Still usable, which is the claim: an inert refusal, not a half-cleared pool. */
    await expect(pool.withdraw(note.id, to)).resolves.toMatchObject({
      summary: expect.stringContaining("4 USDC"),
    });
  });

  /**
   * A store that hands its record over exactly once, then refuses.
   *
   * Not a contrived failure: `LocalStorageNoteStore.load` throws rather than answering
   * `null` when it finds a record it cannot parse, precisely so a user who owns money is
   * never shown an empty pool. So "the first read worked and the next one will not" is a
   * state this app already builds for.
   */
  function readableOnce(inner: NoteStore): NoteStore {
    let reads = 0;
    return {
      load: async () => {
        reads += 1;
        if (reads > 1) throw new Error("This browser refused to read the pool again.");
        return inner.load();
      },
      save: (pool) => inner.save(pool),
    };
  }

  /**
   * 🔴 The only test here that can tell the two cache-drop orderings apart, and it exists
   * because the obvious ones cannot.
   *
   * Moving the `tree = null` block above `readBackup` leaves all the other tests green:
   * a refusal does not write the disk, so `tree = null` just sends the next `ready()` back
   * to a file that is still correct and the object silently repairs itself. That repair is
   * a second disk read — and a store is allowed to refuse one. Here the first read
   * succeeds and the next does not, so the early order turns "you picked the wrong file"
   * into "your notes are gone", while the shipped order needs no repair at all.
   *
   * Written after the mutation survived, not before. A test where both orders agree proves
   * only that the code agrees with itself.
   */
  it("keeps serving notes after a refusal even if the disk cannot be read again", async () => {
    const inner = new MemoryNoteStore();
    const seed = new LocalShieldedPool(standInHash, inner);
    const note = await seed.deposit(usdc, parseAmount("6", 6));

    const pool = new LocalShieldedPool(standInHash, readableOnce(inner));
    /** The one read this store allows, spent on hydration. */
    expect((await pool.notes()).map((n) => n.id)).toEqual([note.id]);

    await expect(pool.importBackup("not json at all")).rejects.toThrow("not even JSON");

    /** Served from the cache the refusal did not touch. A re-read here would throw. */
    expect((await pool.notes()).map((n) => n.id)).toEqual([note.id]);
    expect((await pool.witness(note.id)).leafIndex).toBe(0);
  });

  it("refuses to restore over notes this browser already holds", async () => {
    const { text } = await backedUp();
    const occupied = new LocalShieldedPool(standInHash, new MemoryNoteStore());
    const mine = await occupied.deposit(usdc, parseAmount("7", 6));

    await expect(occupied.importBackup(text)).rejects.toThrow("already holds a balance");
    /** Refused, and nothing of mine moved. */
    expect((await occupied.notes()).map((n) => n.id)).toEqual([mine.id]);
  });

  /**
   * Serialized with everything else, which is not decoration: a restore that interleaved
   * with a deposit would write one pool's notes into the other's tree. Fired without
   * awaiting in between, so both are on the queue at once.
   */
  it("does not interleave with a concurrent deposit", async () => {
    const { text } = await backedUp();
    const fresh = new LocalShieldedPool(standInHash, new MemoryNoteStore());

    const [imported, deposited] = await Promise.all([
      fresh.importBackup(text),
      fresh.deposit(usdc, parseAmount("9", 6)),
    ]);

    expect(imported).toEqual({ notes: 2 });
    /** Whichever order the queue picked, the result is three notes and no gap. */
    const indices = (await fresh.notes()).map((n) => n.leafIndex).sort((a, b) => a - b);
    expect(indices).toEqual([0, 1, 2]);
    expect(await fresh.witness(deposited.id)).toMatchObject({ leafIndex: deposited.leafIndex });
  });

  /** A round trip through the pool, ending where it started. */
  it("exports what it imported, byte for byte", async () => {
    const { text } = await backedUp();
    const fresh = new LocalShieldedPool(standInHash, new MemoryNoteStore());
    await fresh.importBackup(text);

    const again = await fresh.exportBackup();
    expect(JSON.parse(again.body).pool).toEqual(JSON.parse(text).pool);
  });
});

/**
 * Every way a saved record can be wrong, and the refusal it earns.
 *
 * These matter more than they look. The alternative to refusing is skipping the bad
 * entry, which reads as robustness and is how a pool comes back holding less money than
 * it did yesterday with nothing in the UI to say so.
 */
describe("the saved pool refuses to be misread", () => {
  let disk: MemoryNoteStore;

  /** One good note on disk, to mutate one field of at a time. */
  async function saved(): Promise<StoredPool> {
    const seed = new MemoryNoteStore();
    const p = new LocalShieldedPool(standInHash, seed);
    await p.deposit(usdc, parseAmount("4", 6));
    return (await seed.load()) as StoredPool;
  }

  /**
   * ⚠️ Deliberately NOT an `async function`, and the tests here are worthless if anyone
   * makes it one. An async function flattens a promise it returns, so
   * `async () => pool.notes()` awaits the load itself — the rejection lands on
   * `loading(...)` and every `rejects.toThrow` below sees an already-settled value
   * instead. That was the first shape of this helper: **21 of these tests passed on a
   * pool that threw, and passed just as happily on one that did not.** Chaining off
   * `save` keeps the seeding asynchronous while handing back one unsettled promise.
   */
  function loading(record: unknown): Promise<unknown> {
    disk = new MemoryNoteStore();
    const loaded = new LocalShieldedPool(standInHash, disk);
    return disk.save(record as StoredPool).then(() => loaded.notes());
  }

  it("reads a record it wrote itself", async () => {
    await expect(loading(await saved())).resolves.toHaveLength(1);
  });

  it("refuses a version it does not know", async () => {
    await expect(loading({ ...(await saved()), version: 2 })).rejects.toThrow(
      "version 2 and this build reads version 1",
    );
  });

  it("refuses a record with no notes array", async () => {
    await expect(loading({ version: STORE_VERSION, nullifiers: [] })).rejects.toThrow(
      "missing its notes",
    );
  });

  it("refuses a record with no nullifier array", async () => {
    await expect(loading({ version: STORE_VERSION, notes: [] })).rejects.toThrow(
      "missing its notes or its nullifier list",
    );
  });

  it("refuses something that is not a note", async () => {
    const rec = await saved();
    await expect(loading({ ...rec, notes: [null] })).rejects.toThrow("is not a note");
  });

  it("refuses an amount that is not a decimal string", async () => {
    for (const amount of ["0x10", " 4 ", "", "4.0", "-4", "1e6"]) {
      const rec = await saved();
      await expect(
        loading({ ...rec, notes: rec.notes.map((n) => ({ ...n, amount })) }),
      ).rejects.toThrow("is not a decimal number");
    }
  });

  it("refuses a zero amount, which is what an empty field decodes to elsewhere", async () => {
    const rec = await saved();
    await expect(
      loading({ ...rec, notes: rec.notes.map((n) => ({ ...n, amount: "0" })) }),
    ).rejects.toThrow("which no note can hold");
  });

  it("refuses an amount at or above the note ceiling", async () => {
    const rec = await saved();
    await expect(
      loading({
        ...rec,
        notes: rec.notes.map((n) => ({ ...n, amount: MAX_NOTE_VALUE.toString(10) })),
      }),
    ).rejects.toThrow("which no note can hold");
  });

  it("refuses a zero secret, which is what an uninitialised one looks like", async () => {
    const rec = await saved();
    await expect(
      loading({ ...rec, notes: rec.notes.map((n) => ({ ...n, secret: "0" })) }),
    ).rejects.toThrow("not a usable field element");
  });

  it("refuses a secret outside the field", async () => {
    const rec = await saved();
    await expect(
      loading({
        ...rec,
        notes: rec.notes.map((n) => ({ ...n, secret: FIELD_MODULUS.toString(10) })),
      }),
    ).rejects.toThrow("not a usable field element");
  });

  it("refuses a secret that is not a decimal string", async () => {
    const rec = await saved();
    await expect(
      loading({ ...rec, notes: rec.notes.map((n) => ({ ...n, secret: "0xdead" })) }),
    ).rejects.toThrow("is not a decimal number");
  });

  it("refuses a leaf index that is not a tree position", async () => {
    for (const leafIndex of [-1, 1.5, Number.NaN, "0"]) {
      const rec = await saved();
      await expect(
        loading({ ...rec, notes: rec.notes.map((n) => ({ ...n, leafIndex })) }),
      ).rejects.toThrow("not a position in a tree");
    }
  });

  it("refuses a gap in the leaf indices, because it shifts every note after it", async () => {
    const rec = await saved();
    await expect(
      loading({ ...rec, notes: rec.notes.map((n) => ({ ...n, leafIndex: 1 })) }),
    ).rejects.toThrow("jumps from leaf none to leaf 1");
  });

  it("names the leaf it jumped from when the gap is not at the start", async () => {
    const seed = new MemoryNoteStore();
    const p = new LocalShieldedPool(standInHash, seed);
    await p.deposit(usdc, 1n);
    await p.deposit(usdc, 2n);
    const rec = (await seed.load()) as StoredPool;

    /**
     * Notes are newest-first, so index 0 of the file is leaf 1. Push it to leaf 2.
     *
     * The assertion is `from leaf 0`, not `from leaf none` — which is the only reason
     * this test earns its place next to the one above. Both cases are a gap; only the
     * message tells them apart, and a gap in the middle has a real predecessor to name.
     */
    const notes = rec.notes.map((n) => (n.leafIndex === 1 ? { ...n, leafIndex: 2 } : n));
    await expect(loading({ ...rec, notes })).rejects.toThrow("jumps from leaf 0 to leaf 2");
  });

  it("refuses a missing id, creation time or anchoring reason", async () => {
    const cases: [string, Partial<StoredNote>][] = [
      ["its id", { id: "" }],
      ["a creation time", { createdAt: "" }],
      ["its anchoring reason", { anchoring: { kind: "local", why: "" } }],
      ["a spend time", { spentAt: "" }],
    ];
    for (const [what, patch] of cases) {
      const rec = await saved();
      await expect(
        loading({ ...rec, notes: rec.notes.map((n) => ({ ...n, ...patch })) }),
      ).rejects.toThrow(what);
    }
  });

  it("refuses an anchoring that claims to be on chain", async () => {
    const rec = await saved();
    await expect(
      loading({
        ...rec,
        notes: rec.notes.map((n) => ({
          ...n,
          anchoring: { kind: "onchain", txHash: "0xabc", block: 1 },
        })),
      }),
    ).rejects.toThrow("cannot vouch for anything on chain");
  });

  it("refuses a missing anchoring outright", async () => {
    const rec = await saved();
    await expect(
      loading({ ...rec, notes: rec.notes.map((n) => ({ ...n, anchoring: null })) }),
    ).rejects.toThrow("missing its anchoring");
  });

  it("refuses a missing token, or one with no address or symbol", async () => {
    const cases: [string, unknown][] = [
      ["missing its token", null],
      ["its token address", { address: "", symbol: "USDC", decimals: 6 }],
      ["its token symbol", { address: "0x1", symbol: "", decimals: 6 }],
    ];
    for (const [what, token] of cases) {
      const rec = await saved();
      await expect(
        loading({ ...rec, notes: rec.notes.map((n) => ({ ...n, token })) }),
      ).rejects.toThrow(what);
    }
  });

  it("refuses a token whose decimals would rescale the money", async () => {
    for (const decimals of [-1, 1.5, 37, "6", undefined]) {
      const rec = await saved();
      await expect(
        loading({
          ...rec,
          notes: rec.notes.map((n) => ({ ...n, token: { ...n.token, decimals } })),
        }),
      ).rejects.toThrow("decimals");
    }
  });

  it("refuses a nullifier that is not 32 bytes of lowercase hex", async () => {
    for (const bad of ["0xABC", "deadbeef", `0x${"f".repeat(63)}`, 1, null]) {
      const rec = await saved();
      await expect(loading({ ...rec, nullifiers: [bad] })).rejects.toThrow(
        "not a 32-byte hex value",
      );
    }
  });

  it("keeps failing on every retry instead of settling into an empty pool", async () => {
    const p = new LocalShieldedPool(standInHash, {
      load: async () => ({ version: 99, notes: [], nullifiers: [] }),
      save: async () => undefined,
    });
    await expect(p.notes()).rejects.toThrow("version 99");
    /**
     * The failure mode this guards: assigning the tree before hydrating means the second
     * call finds a built tree, skips the load, and reports an empty pool. The money would
     * be on disk and invisible, with no error the second time.
     */
    await expect(p.notes()).rejects.toThrow("version 99");
    await expect(p.root()).rejects.toThrow("version 99");
  });
});

describe("LocalStorageNoteStore", () => {
  it("round-trips a record through localStorage", async () => {
    const store = new LocalStorageNoteStore();
    const record: StoredPool = { version: STORE_VERSION, notes: [], nullifiers: [] };
    await store.save(record);
    expect(await store.load()).toEqual(record);
  });

  it("answers null for a browser that has never saved anything", async () => {
    expect(await new LocalStorageNoteStore().load()).toBeNull();
  });

  it("uses a key that can be pointed somewhere else, so two pools can coexist in tests", async () => {
    const a = new LocalStorageNoteStore("quadra.test.a");
    await a.save({ version: STORE_VERSION, notes: [], nullifiers: [] });
    expect(await new LocalStorageNoteStore("quadra.test.b").load()).toBeNull();
  });

  /**
   * 🔴 The key, as a literal. Every other assertion in this file imports `STORE_KEY`,
   * which means all of them would keep passing if its value changed — they would just
   * be checking a different key, consistently.
   *
   * What that blindness costs: `brand.ts` warns against templating this from
   * `BRAND.slug`, because a rename would then point the app at a key nobody has ever
   * written. Existing users' notes stay on disk under `quadra.pool.v1` while the app
   * reports an empty pool, and "empty pool" is the state someone reasonably responds
   * to by depositing again. This line is what makes that edit go red.
   *
   * Spelled out rather than built from parts for the same reason — a `.includes("v1")`
   * would pass for any prefix, which is precisely the half that must not move.
   */
  it("is stored under exactly the key already on users' disks", () => {
    expect(STORE_KEY).toBe("quadra.pool.v1");
  });

  /**
   * A truncated write must not read as "no notes yet". Answering null there shows an
   * empty pool to someone who owns money, who would then reasonably deposit over it.
   */
  it("refuses unreadable JSON rather than reporting an empty pool", async () => {
    localStorage.setItem(STORE_KEY, "{not json");
    await expect(new LocalStorageNoteStore().load()).rejects.toThrow("not valid JSON");
  });

  /**
   * ⚠️ Patched on `Storage.prototype`, NOT on `localStorage` — and the difference is not
   * style. `Storage` has a named-property setter, so `localStorage.setItem = fn` is
   * **reinterpreted as storing data**: jsdom writes a real entry under the key
   * `"setItem"` whose value is the function's source text, leaves the method untouched,
   * and throws nothing. Measured: after that assignment `hasOwnProperty("setItem")` is
   * still `false` and `getItem("setItem")` returns `"() => { throw ... }"`.
   *
   * That is how the first version of these two tests failed — `save` quietly succeeded
   * and `rejects` was handed a fulfilled promise. It is also the more dangerous half: the
   * `finally` that "restored" the method wrote the same junk key a second time, so a
   * patch that never applied still left state behind for whatever ran next.
   */
  function failingSetItem(thrown: unknown): () => void {
    const proto = Object.getPrototypeOf(localStorage) as Storage;
    const real = proto.setItem;
    proto.setItem = () => {
      throw thrown;
    };
    return () => {
      proto.setItem = real;
    };
  }

  it("reports a refused write, naming what the browser said", async () => {
    const store = new LocalStorageNoteStore();
    const restore = failingSetItem(new Error("QuotaExceededError"));
    try {
      await expect(store.save({ version: STORE_VERSION, notes: [], nullifiers: [] })).rejects.toThrow(
        "refused to save the pool: QuotaExceededError",
      );
    } finally {
      restore();
    }
  });

  /** A browser that throws a bare string still has to produce a sentence a user can read. */
  it("reports a non-Error thrown by the browser too", async () => {
    const store = new LocalStorageNoteStore();
    const restore = failingSetItem("out of space");
    try {
      await expect(store.save({ version: STORE_VERSION, notes: [], nullifiers: [] })).rejects.toThrow(
        "out of space",
      );
    } finally {
      restore();
    }
  });

  /** The patch above must leave nothing behind — see the note on why it could. */
  it("leaves no stray key behind when a write is refused", async () => {
    failingSetItem(new Error("QuotaExceededError"))();
    expect(Object.keys(localStorage)).toEqual([]);
    await new LocalStorageNoteStore().save({ version: STORE_VERSION, notes: [], nullifiers: [] });
    expect(Object.keys(localStorage)).toEqual([STORE_KEY]);
  });
});

describe("MemoryNoteStore", () => {
  it("holds nothing until something is saved", async () => {
    expect(await new MemoryNoteStore().load()).toBeNull();
  });

  it("hands back a copy, so a caller editing what it read cannot edit the store", async () => {
    const store = new MemoryNoteStore();
    await store.save({ version: STORE_VERSION, notes: [], nullifiers: ["0x" + "1".repeat(64)] });

    const first = (await store.load()) as StoredPool;
    first.nullifiers.length = 0;
    expect(((await store.load()) as StoredPool).nullifiers).toHaveLength(1);
  });

  it("takes a copy on the way in, so a caller mutating its own record cannot edit the store", async () => {
    const store = new MemoryNoteStore();
    const record: StoredPool = { version: STORE_VERSION, notes: [], nullifiers: [] };
    await store.save(record);
    record.version = 99;
    expect(((await store.load()) as StoredPool).version).toBe(STORE_VERSION);
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
  /**
   * The paid price comes from `priceOf`, not from a literal written here.
   *
   * `Price`'s paid variant now holds a `PaymentRequirements`, and the only way to get
   * one is through `checkRequirements` — which is the point of the type. Writing a
   * fixture for it in this file would mean writing a second opinion about upstream's
   * envelope into a test about adapter WIRING, so this borrows the stub's price
   * instead. It is a real checked price, and this test only needs it to be paid.
   */
  it("does not let a live read make the catalog claim it settled anything", () => {
    const { catalog } = adapters();
    expect(catalog.isLive).toBe(false);
    expect(catalog.whyNot({ kind: "free", why: "no payment" })).toBeNull();
    /**
     * `whyNot` is about the price alone now — a recognised payee at a known price is
     * runnable, and the stub's payee is BlueAgent's real published one (see
     * `priceOf`'s own header), so this is `null` rather than a wallet complaint. Wallet
     * readiness moved to the panel's own `Wallet` state; see `X402Panel`.
     */
    const paid = priceOf(LOCAL_TOOLS.find((t) => t.priceBaseUnits > 0n)!);
    expect(paid.kind).toBe("paid");
    expect(catalog.whyNot(paid)).toBeNull();
  });

  /**
   * ⚠️ This replaced a test asserting the OPPOSITE — that a second `adapters()` call
   * sees no notes, "so one page cannot read another's notes". That was ephemerality
   * written down as if it were a guarantee, and it was wrong twice over: there is no
   * boundary between pages of one origin to defend (same browser, same user, same
   * `localStorage`), and a user who deposits, navigates, and finds an empty pool has
   * lost their money as far as they can tell. The old test would have blocked
   * persistence while reading like a privacy property.
   */
  it("wires a durable pool, so notes survive the next call and the next page load", async () => {
    const note = await adapters().pool.deposit(usdc, parseAmount("3", 6));

    const reloaded = await adapters().pool.notes();
    expect(reloaded).toHaveLength(1);
    expect((reloaded[0] as Note).id).toBe(note.id);
    expect((reloaded[0] as Note).amount).toBe(parseAmount("3", 6));
  });

  it("hands out a distinct pool object each call, so neither holds the other's memory", async () => {
    expect(adapters().pool).not.toBe(adapters().pool);
  });

  it("persists under the namespaced key and nowhere else", async () => {
    expect(localStorage.getItem(STORE_KEY)).toBeNull();
    await adapters().pool.deposit(usdc, 1n);
    expect(localStorage.getItem(STORE_KEY)).not.toBeNull();
    expect(Object.keys(localStorage)).toEqual([STORE_KEY]);
  });
});
