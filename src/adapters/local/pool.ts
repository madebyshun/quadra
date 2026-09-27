import type { Anchoring, Note, Receipt, ShieldedPool, TokenRef } from "@/adapters/types";
import { formatAmount } from "@/lib/amount";
import { assertNoteValue } from "@/lib/field";
import type { FieldHash } from "@/lib/hash";
import { standInHash } from "@/lib/hash";
import { commitmentHex, deriveCommitment, deriveNullifier, newNoteSecret } from "@/lib/note";

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
   * The next leaf index, counted the way the tree counts.
   *
   * Monotonic and never reused, including across spends: `MerkleTreeWithHistory` is
   * append-only, so a spent leaf still occupies its position forever. Reusing an
   * index here would let two different notes derive the same nullifier and make the
   * second one unspendable for a reason no error message could explain.
   */
  private nextIndex = 0;

  /**
   * The hash is injected so a test can pin the scheme, and so the day Poseidon
   * exists this class does not need editing to use it. Defaulted rather than
   * required because every current caller wants the same one, and a required
   * argument here would put the choice of hash function in the UI layer.
   */
  constructor(private readonly hash: FieldHash = standInHash) {}

  async deposit(token: TokenRef, amount: bigint): Promise<Note> {
    if (amount <= 0n) throw new Error("Deposit an amount greater than zero.");
    /**
     * The same bound the contract enforces, applied before a note exists rather
     * than after a revert. The line above already refuses zero with wording aimed
     * at someone who left the field blank; this catches the other end, where the
     * number is too large for any note to hold.
     */
    assertNoteValue(amount);

    const secret = newNoteSecret();
    const note: Note = {
      id: randomHex(8),
      commitment: await deriveCommitment(this.hash, { amount, secret }),
      leafIndex: this.nextIndex,
      secret,
      token,
      amount,
      createdAt: new Date().toISOString(),
      spentAt: null,
      anchoring: local(),
    };
    /**
     * Incremented only once the note is fully built. `deriveCommitment` can throw —
     * on an out-of-range amount or a bad secret — and a leaf index consumed by a
     * deposit that never happened would leave a permanent hole, which is harmless
     * on its own and is exactly the kind of off-by-one that makes a later tree
     * reconstruction disagree with the chain for no visible reason.
     */
    this.nextIndex += 1;
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

  async send(noteId: string, to: string, amount: bigint): Promise<Receipt> {
    const { note, nullifier } = await this.spendable(noteId);
    if (amount <= 0n) throw new Error("Send an amount greater than zero.");
    if (amount > note.amount) {
      throw new Error(
        `That note holds ${formatAmount(note.amount, note.token.decimals)} ${note.token.symbol}, which is less than ${formatAmount(amount, note.token.decimals)}.`,
      );
    }

    this.consume(note, nullifier);
    const change = note.amount - amount;
    if (change > 0n) await this.deposit(note.token, change);

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
