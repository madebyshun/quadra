import type { Anchoring, Note, Receipt, ShieldedPool, TokenRef } from "@/adapters/types";
import { formatAmount } from "@/lib/amount";

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

  async deposit(token: TokenRef, amount: bigint): Promise<Note> {
    if (amount <= 0n) throw new Error("Deposit an amount greater than zero.");

    const note: Note = {
      id: randomHex(8),
      commitment: randomHex(32),
      secret: randomHex(32),
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

  async send(noteId: string, to: string, amount: bigint): Promise<Receipt> {
    const note = this.spendable(noteId);
    if (amount <= 0n) throw new Error("Send an amount greater than zero.");
    if (amount > note.amount) {
      throw new Error(
        `That note holds ${formatAmount(note.amount, note.token.decimals)} ${note.token.symbol}, which is less than ${formatAmount(amount, note.token.decimals)}.`,
      );
    }

    this.consume(note);
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
    const note = this.spendable(noteId);
    this.consume(note);

    const amount = `${formatAmount(note.amount, note.token.decimals)} ${note.token.symbol}`;
    return {
      summary: `You withdrew ${amount} to ${to}. That note is spent and the amount is now public.`,
      anchoring: local(),
    };
  }

  /**
   * One place to look a note up, so "unknown id" and "already spent" can never
   * drift into different messages in different methods.
   */
  private spendable(noteId: string): Note {
    const note = this.store.find((n) => n.id === noteId);
    if (!note) throw new Error(`No note with id ${noteId} in this browser.`);
    if (note.spentAt !== null) {
      throw new Error(`That note was already spent at ${note.spentAt}. A note spends once.`);
    }
    return note;
  }

  private consume(note: Note): void {
    note.spentAt = new Date().toISOString();
  }
}
