import type { Anchoring, Note, NoteWitness, Receipt, ShieldedPool, TokenRef } from "@/adapters/types";
import { formatAmount } from "@/lib/amount";
import { assertNoteValue } from "@/lib/field";
import type { FieldHash } from "@/lib/hash";
import { standInHash } from "@/lib/hash";
import type { TreeRoot } from "@/lib/note";
import {
  commitmentHex,
  deriveCommitment,
  deriveNullifier,
  newNoteSecret,
  tagWithScheme,
} from "@/lib/note";
import { IncrementalMerkleTree } from "@/lib/tree";

/**
 * A shielded pool that keeps its notes in this browser and nothing else.
 *
 * This is the whole app's money model, running for real, minus the one thing it
 * cannot do without a deployed contract: prove any of it to anyone. So every
 * fact it produces is anchored `local`, and the `why` says so in the words the
 * UI shows the user. Nothing here ever returns a txHash, because the type has
 * no field for one — see the header of adapters/types.ts.
 *
 * The balance arithmetic, the spend rules, the change note, the refusal to
 * overspend: all of that is real and all of it is what the on-chain version
 * will also have to do. Only the proof is missing.
 *
 * ── Commitments are derived here, not invented ───────────────────────────────
 * `deposit` used to set `commitment: randomHex(32)`. A random commitment commits
 * to nothing, which made the note unprovable by construction rather than merely
 * unproven — see the header of `lib/note.ts`. It now runs the real scheme over the
 * real amount and secret. The hash underneath is a stand-in and says so in every
 * value it produces, which is the honest version of the same gap.
 *
 * ── A note is spent when its nullifier is in the set ─────────────────────────
 * The double-spend rule used to be `if (note.spentAt !== null)`. That worked, and it
 * worked for a reason the chain cannot check: a timestamp this browser wrote about
 * its own mutable object. On chain the rule is `mapping(bytes32 => bool) isSpent`,
 * and nothing else counts. So the rule here is the same one — derive the nullifier
 * from `(secret, leafIndex)`, refuse it if the set already holds it — and `spentAt`
 * is demoted to what it always really was: something to render.
 *
 * This is why `leafIndex` had to become part of a note. The nullifier's preimage
 * includes it, so without it two notes sharing a secret would nullify as one.
 *
 * What is mirrored is the RULE, not the arity. `ShieldedPool.transact` takes
 * `bytes32[2] inputNullifiers` and retires two notes per transaction; this spends
 * exactly one. So the contract's `DuplicateNullifier` guard — the two inputs of a
 * single transaction being equal — has no counterpart here, because with one input
 * the case cannot arise. Whether the browser should join and split notes the same way
 * is an open product decision, not an oversight; see TASKS.md.
 */

const WHY_LOCAL = "held in this browser only — the pool is not deployed yet";

function local(): Anchoring {
  return { kind: "local", why: WHY_LOCAL };
}

/**
 * The depth the pool is meant to be deployed at: 2^20 notes, Tornado's number.
 *
 * It has to equal the deployed `levels` or every root the browser computes is a root for
 * a different tree. Kept here rather than in `config/chain.ts` because it is a parameter
 * of the pool instance, and the day a second pool exists at a different depth this
 * becomes a constructor argument rather than a constant to edit.
 */
const TREE_LEVELS = 20;

/**
 * The domain tag for this browser's empty leaf.
 *
 * `IncrementalMerkleTree` takes `emptyLeaf` as a required argument precisely so this
 * choice is made here, visibly, by whoever knows whether there is a deployment to read
 * it from. There is not, so the local pool derives one from its own hash: recomputable
 * here, which is the property the contract's
 * `keccak256("quadra.shielded-pool.empty-leaf")` does not have in a browser with no
 * keccak.
 *
 * 🔴 **So local roots do not match the deployed contract's, and will not until the two
 * agree on one derivation.** That is why `root()` returns a tagged value rather than a
 * bare bigint — the mismatch travels with the number. See TASKS.md step 1d; it is
 * resolved as part of the circuit, not by hard-coding a constant here (hard rule 9).
 */
const EMPTY_LEAF_DOMAIN = "tree.empty-leaf";

/**
 * Random, not sequential. Note ids leak nothing on their own, but a counter
 * would tell anyone reading one how many notes exist, and that is a fact about
 * the user rather than about the note.
 */
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return `0x${Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export class LocalShieldedPool implements ShieldedPool {
  /** Never true here. A local pool that claimed to be live would be the lie. */
  readonly isLive = false;

  private readonly store: Note[] = [];

  /**
   * Spent nullifiers, keyed by hex so lookup is by value.
   *
   * A `Set<bigint>` would work too; hex is what `nullifiers()` returns and what a
   * chain would show, so keeping one representation means no conversion step that
   * could disagree with itself.
   */
  private readonly spent = new Set<string>();

  /**
   * The commitment tree, built on first use.
   *
   * Lazy because `create` hashes `levels` times and a pool the user never deposits into
   * should not pay for that. Not because it is optional — every leaf index this pool
   * hands out comes from here, since the tree is what actually assigns them. The
   * counter this replaced was monotonic for the right reason and still only a promise
   * that a tree somewhere agreed.
   */
  private tree: IncrementalMerkleTree | null = null;

  /**
   * Operations touching the tree run one at a time.
   *
   * `insert` awaits `levels` hashes, so two concurrent deposits interleave inside it,
   * both write `filledSubtrees`, and the tree ends up with a root that belongs to
   * neither. **Nothing throws** — both notes come back looking correct and every proof
   * against that root fails later, on chain. `Promise.all` over deposits is an ordinary
   * thing for a caller to do, and `tests/adapters.test.ts` does exactly that.
   */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * The hash is injected so a test can pin the scheme, and so the day Poseidon
   * exists this class does not need editing to use it. Defaulted rather than
   * required because every current caller wants the same one, and a required
   * argument here would put the choice of hash function in the UI layer.
   */
  constructor(private readonly hash: FieldHash = standInHash) {}

  /**
   * Run `body` after everything already queued, whatever happened to it.
   *
   * The whole trick is the second line: the queue is advanced with a copy whose
   * rejection has been swallowed, so `this.queue` is a **sequencing token and never a
   * result channel**. Without it one caller's rejection propagates into every caller
   * queued behind it, and the pool stops working permanently the first time a user types
   * a bad amount. The rejection still reaches the caller who earned it, because that is
   * `run`, which is what gets returned.
   *
   * ⚠️ This was written as `this.queue.then(body, body)` — `body` as the rejection
   * handler as well — *plus* the swallow below, with a comment calling both load-bearing.
   * They are **alternatives, not layers**: mutating away either one on its own broke no
   * test, and only removing both turned four red. Two mechanisms for one job is worse
   * than one, because each makes the other look necessary and so neither gets read.
   * Kept the one that states its intent; `then(body)` can never take a rejection arm
   * anyway, since the line below guarantees `this.queue` always fulfils.
   */
  private serialize<T>(body: () => Promise<T>): Promise<T> {
    const run = this.queue.then(body);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async getTree(): Promise<IncrementalMerkleTree> {
    this.tree ??= await IncrementalMerkleTree.create({
      levels: TREE_LEVELS,
      hash: this.hash,
      emptyLeaf: await this.hash.hash(EMPTY_LEAF_DOMAIN, [0n]),
    });
    return this.tree;
  }

  /**
   * ── Why the three money operations are wrappers ──────────────────────────────
   * Each public method is one queue entry, and the work happens in a private
   * `*Now` that never touches the queue itself. That split is not stylistic: `send`
   * makes a change note by calling `depositNow`, and if the inner call went through
   * `serialize` it would wait on a queue its own caller is holding — a deadlock with
   * no error message, just a promise that never settles.
   */
  async deposit(token: TokenRef, amount: bigint): Promise<Note> {
    return this.serialize(() => this.depositNow(token, amount));
  }

  private async depositNow(token: TokenRef, amount: bigint): Promise<Note> {
    if (amount <= 0n) throw new Error("Deposit an amount greater than zero.");
    /**
     * The same bound the contract enforces, applied before a note exists rather
     * than after a revert. The line above already refuses zero with wording aimed
     * at someone who left the field blank; this catches the other end, where the
     * number is too large for any note to hold.
     */
    assertNoteValue(amount);

    const secret = newNoteSecret();
    const commitment = await deriveCommitment(this.hash, { amount, secret });
    /**
     * The tree assigns the index, and it does it by actually inserting the leaf.
     *
     * This replaced a `nextIndex` counter that was monotonic for the right reason and
     * still only a promise that some tree somewhere agreed with it. Now the index and
     * the tree cannot disagree, because there is one of them: if `insert` throws — an
     * out-of-field commitment, a full tree — no index was consumed and no note exists,
     * which is the same ordering the counter needed a comment to explain.
     */
    const tree = await this.getTree();
    const leafIndex = await tree.insert(commitment.value);

    const note: Note = {
      id: randomHex(8),
      commitment,
      leafIndex,
      secret,
      token,
      amount,
      createdAt: new Date().toISOString(),
      spentAt: null,
      anchoring: local(),
    };
    this.store.unshift(note);
    return note;
  }

  async notes(opts?: { includeSpent?: boolean }): Promise<Note[]> {
    const all = [...this.store];
    return opts?.includeSpent ? all : all.filter((n) => n.spentAt === null);
  }

  async nullifiers(): Promise<string[]> {
    return [...this.spent];
  }

  /**
   * The root every witness from this pool is a statement about.
   *
   * Serialized with the writes, so a caller that awaits a deposit and then reads the
   * root cannot observe a tree halfway through an insert.
   */
  async root(): Promise<TreeRoot> {
    return this.serialize(async () => tagWithScheme(this.hash, (await this.getTree()).root()));
  }

  /**
   * The Merkle witness for a note, for the proof this pool cannot yet produce.
   *
   * Works for spent notes too, and deliberately so: the witness is a fact about the
   * tree, which is append-only, and a spent note's leaf is still in it at the same
   * index forever. Refusing here would be inventing a rule the contract does not have.
   * What stops a spent note being spent again is the nullifier set, in `spendable`.
   */
  async witness(noteId: string): Promise<NoteWitness> {
    return this.serialize(async () => {
      const note = this.store.find((n) => n.id === noteId);
      if (!note) throw new Error(`No note with id ${noteId} in this browser.`);

      const path = await (await this.getTree()).pathFor(note.leafIndex);
      return {
        root: tagWithScheme(this.hash, path.root),
        leaf: note.commitment,
        leafIndex: path.leafIndex,
        siblings: path.siblings,
        isRight: path.isRight,
      };
    });
  }

  async send(noteId: string, to: string, amount: bigint): Promise<Receipt> {
    return this.serialize(() => this.sendNow(noteId, to, amount));
  }

  private async sendNow(noteId: string, to: string, amount: bigint): Promise<Receipt> {
    const { note, nullifier } = await this.spendable(noteId);
    if (amount <= 0n) throw new Error("Send an amount greater than zero.");
    if (amount > note.amount) {
      throw new Error(
        `That note holds ${formatAmount(note.amount, note.token.decimals)} ${note.token.symbol}, which is less than ${formatAmount(amount, note.token.decimals)}.`,
      );
    }

    this.consume(note, nullifier);
    const change = note.amount - amount;
    if (change > 0n) await this.depositNow(note.token, change);

    const paid = `${formatAmount(amount, note.token.decimals)} ${note.token.symbol}`;
    const tail = change > 0n
      ? ` The remaining ${formatAmount(change, note.token.decimals)} came back as a new note.`
      : "";
    return {
      summary: `You paid ${paid} to ${to}. The pool paid it, so ${to} never saw which note it came from.${tail}`,
      anchoring: local(),
    };
  }

  async withdraw(noteId: string, to: string): Promise<Receipt> {
    return this.serialize(() => this.withdrawNow(noteId, to));
  }

  private async withdrawNow(noteId: string, to: string): Promise<Receipt> {
    const { note, nullifier } = await this.spendable(noteId);
    this.consume(note, nullifier);

    const amount = `${formatAmount(note.amount, note.token.decimals)} ${note.token.symbol}`;
    return {
      summary: `You withdrew ${amount} to ${to}. That note is spent and the amount is now public.`,
      anchoring: local(),
    };
  }

  /**
   * One place to look a note up, so "unknown id" and "already spent" can never
   * drift into different messages in different methods.
   *
   * Returns the nullifier alongside the note because it is derived here and must be
   * the same value `consume` records. Deriving it twice would be two chances to
   * disagree, and the derivation that decides "already spent" has to be the one that
   * gets stored — otherwise the set could refuse a note whose nullifier it never held.
   */
  private async spendable(noteId: string): Promise<{ note: Note; nullifier: string }> {
    const note = this.store.find((n) => n.id === noteId);
    if (!note) throw new Error(`No note with id ${noteId} in this browser.`);

    const nullifier = commitmentHex(
      await deriveNullifier(this.hash, { secret: note.secret }, note.leafIndex),
    );
    /**
     * The set is the authority, not `note.spentAt`. This is the check the contract
     * makes — `ShieldedPool.isSpent`, via `_checkNullifiers` — so a note this pool
     * refuses is a note the chain would also refuse, for the same reason.
     *
     * The timestamp is deliberately not in this message. It is display, and quoting
     * it in the refusal would read as though it were what did the refusing.
     */
    if (this.spent.has(nullifier)) {
      throw new Error("That note is already spent. A note spends once.");
    }
    return { note, nullifier };
  }

  /**
   * The single place a note is retired. Both writes live here so the nullifier set
   * and `spentAt` cannot disagree about whether a note was spent — the invariant
   * `adapters/types.ts` promises and `tests/adapters.test.ts` asserts.
   */
  private consume(note: Note, nullifier: string): void {
    this.spent.add(nullifier);
    note.spentAt = new Date().toISOString();
  }
}
