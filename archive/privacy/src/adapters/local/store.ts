/**
 * Where the money survives a page reload.
 *
 * Until this file existed, `LocalShieldedPool` kept its notes in an array and every
 * one of them vanished on refresh. For a product whose entire premise is *the secret
 * lives in this browser and nowhere else*, that is not a missing feature — it is the
 * premise not being true yet.
 *
 * ── What is NOT stored, and why that is the interesting part ──────────────────
 * **The commitment is not stored. It is re-derived on load.**
 *
 * Storing it would mean storing its `scheme` tag, and a tag read back from disk is a
 * *claim* about how a number was produced. Anyone editing this record by hand could
 * write `scheme: "poseidon"` next to a value the stand-in hash produced, and the pool
 * would hand an unprovable commitment to code that had already checked it was
 * provable. That is exactly the hazard the header of `adapters/types.ts` is about, and
 * hard rule 10's version of it: a field that can be forged is worse than a field that
 * does not exist.
 *
 * A commitment is a pure function of `(amount, secret)` under the pool's hash, so
 * re-deriving costs one hash per note and makes the tag always describe the hash
 * actually in use. The invariant from `lib/note.ts` — *commitments are derived here,
 * not invented* — then keeps holding across a reload, which it would not if the
 * commitment came back from a file.
 *
 * ── What IS stored twice, on purpose ─────────────────────────────────────────
 * The nullifier set, even though it is derivable from the notes marked spent.
 *
 * It looks redundant and it is not. `tests/adapters.test.ts` pins that a note whose
 * `spentAt` has been wiped is *still* refused, because the set is the authority — and
 * if the set were rebuilt from `spentAt` on load, that property would silently stop
 * holding the moment the user refreshed. Storing the set is what makes the guarantee
 * survive. It is also the shape that migrates: the on-chain adapter fills this set
 * from chain events, never from timestamps.
 *
 * ── Every inconsistency is refused, never repaired quietly ───────────────────
 * A partially-written or hand-edited record is refused with a message naming what is
 * wrong. The temptation is to skip the bad note and carry on, which reads as
 * robustness and is how a user ends up with a pool that silently holds less money
 * than it did yesterday. The one exception is spelled out on `SAFE_REPAIR` below,
 * and it only ever moves in the direction of refusing a spend.
 */

import type { Anchoring, Note, TokenRef } from "@/adapters/types";
import { FIELD_MODULUS, MAX_NOTE_VALUE } from "@/lib/field";

/**
 * Bumped whenever the shape below changes incompatibly.
 *
 * An unknown version is refused rather than guessed at. The alternative — best-effort
 * parsing of a record written by a future version — reads notes whose fields mean
 * something else now, and the failure lands on the amounts.
 */
export const STORE_VERSION = 1;

/**
 * The localStorage key. Namespaced so it cannot collide with anything else on the origin.
 *
 * 🔴 A frozen literal, NOT `` `${BRAND.slug}.pool.v1` ``. This key is where existing
 * users' money already is. Derive it from the brand and a rename points the app at a
 * key nobody has ever written: every pool goes invisible, the app reports no notes,
 * and the notes are still sitting on disk under the old name with nothing in the UI
 * that would suggest looking there. `brand.ts` lists the other three strings frozen
 * for this reason; `tests/adapters.test.ts` pins this one against a literal, because
 * every other test in that file imports this constant and so cannot see it move.
 */
export const STORE_KEY = "quadra.pool.v1";

/**
 * A note as it sits on disk: bigints as decimal strings, no commitment.
 *
 * `JSON.stringify` throws on a bigint rather than coercing one, which is the one
 * helpful thing it does here. Decimal strings rather than numbers because
 * `Number(2n ** 60n)` is lossy and would corrupt an amount without any error — the
 * exact class of silent money bug this file is trying not to have.
 */
export type StoredNote = {
  id: string;
  leafIndex: number;
  /** decimal string */
  secret: string;
  token: TokenRef;
  /** decimal string, base units */
  amount: string;
  createdAt: string;
  spentAt: string | null;
  anchoring: Anchoring;
};

export type StoredPool = {
  version: number;
  /** Display order: newest first, matching what the pool hands back. */
  notes: StoredNote[];
  /** Spent nullifiers as hex. The authority on whether a note can be spent. */
  nullifiers: string[];
};

/**
 * The seam, so the pool does not know what a browser is.
 *
 * Async because a real store may not be `localStorage` — IndexedDB, an extension, an
 * encrypted blob behind a passphrase prompt. Writing the interface async now costs
 * nothing and means none of those is a rewrite of the pool.
 */
export interface NoteStore {
  load(): Promise<StoredPool | null>;
  save(pool: StoredPool): Promise<void>;
}

/** Ephemeral. The default the pool falls back to, and what tests use when durability is not the subject. */
export class MemoryNoteStore implements NoteStore {
  private held: StoredPool | null = null;

  async load(): Promise<StoredPool | null> {
    /** Cloned on the way out, so a caller mutating what it read cannot edit the store. */
    return this.held === null ? null : (JSON.parse(JSON.stringify(this.held)) as StoredPool);
  }

  async save(pool: StoredPool): Promise<void> {
    this.held = JSON.parse(JSON.stringify(pool)) as StoredPool;
  }
}

/**
 * The durable one. Wired in `adapters/index.ts`, which is the only place that should
 * know the app runs in a browser.
 *
 * ⚠️ `localStorage` is not a backup. Clearing site data loses every note, and there is
 * no recovery because there is no copy anywhere else — that is what makes the notes
 * private and it is also what makes them fragile. The UI has to say so; a store cannot.
 */
export class LocalStorageNoteStore implements NoteStore {
  constructor(private readonly key: string = STORE_KEY) {}

  async load(): Promise<StoredPool | null> {
    const raw = localStorage.getItem(this.key);
    if (raw === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      /**
       * Deliberately not treated as "no notes yet". A truncated write is the likeliest
       * cause, and answering `null` there would show an empty pool to someone who owns
       * money — who would then reasonably deposit again over the top of it.
       */
      throw new Error(
        `The saved pool at "${this.key}" is not valid JSON, so this browser cannot read its own notes. ` +
          `Nothing has been changed. Do not deposit again until it is recovered or deliberately cleared.`,
      );
    }
    return parsed as StoredPool;
  }

  async save(pool: StoredPool): Promise<void> {
    try {
      localStorage.setItem(this.key, JSON.stringify(pool));
    } catch (cause) {
      /**
       * Thrown on, never swallowed. A swallowed write failure means the note exists in
       * this tab and nowhere else, and the user finds out on their next reload.
       */
      throw new Error(
        `This browser refused to save the pool: ${cause instanceof Error ? cause.message : String(cause)}. ` +
          `The last operation is NOT saved.`,
      );
    }
  }
}

/** Encode for storage. The commitment is dropped on purpose — see the header. */
export function encodeNote(note: Note): StoredNote {
  return {
    id: note.id,
    leafIndex: note.leafIndex,
    secret: note.secret.toString(10),
    token: { ...note.token },
    amount: note.amount.toString(10),
    createdAt: note.createdAt,
    spentAt: note.spentAt,
    anchoring: { ...note.anchoring },
  };
}

/**
 * A decimal string back to a bigint, refusing everything `BigInt()` would accept but
 * this format never writes.
 *
 * `BigInt("0x10")` is 16 and `BigInt(" 5 ")` is 5, so the constructor alone would let a
 * hand-edited record change an amount through a notation the writer never uses. `BigInt("")`
 * is 0, which is the worst of them: an empty amount would read as a zero-value note.
 */
function decodeField(raw: unknown, what: string, noteId: string): bigint {
  if (typeof raw !== "string" || !/^(0|[1-9][0-9]*)$/.test(raw)) {
    throw new Error(
      `The saved note ${noteId} has ${what} "${String(raw)}", which is not a decimal number. ` +
        `The pool will not guess at what a note is worth.`,
    );
  }
  return BigInt(raw);
}

function assertString(raw: unknown, what: string, noteId: string): string {
  if (typeof raw !== "string" || raw === "") {
    throw new Error(`The saved note ${noteId} is missing ${what}.`);
  }
  return raw;
}

function decodeToken(raw: unknown, noteId: string): TokenRef {
  const t = raw as Partial<TokenRef> | null | undefined;
  if (t === null || typeof t !== "object") {
    throw new Error(`The saved note ${noteId} is missing its token.`);
  }
  /**
   * `decimals` is checked because it is the one field that silently rescales money:
   * the amount is base units, so reading 6 as 18 turns 1 USDC into a dust amount and
   * the UI would render the wrong number with no error anywhere.
   */
  if (!Number.isInteger(t.decimals) || (t.decimals as number) < 0 || (t.decimals as number) > 36) {
    throw new Error(
      `The saved note ${noteId} claims its token has ${String(t.decimals)} decimals. ` +
        `An amount is base units, so a wrong scale here misreports the balance rather than failing.`,
    );
  }
  return {
    address: assertString(t.address, "its token address", noteId),
    symbol: assertString(t.symbol, "its token symbol", noteId),
    decimals: t.decimals as number,
  };
}

function decodeAnchoring(raw: unknown, noteId: string): Anchoring {
  const a = raw as Partial<Anchoring> | null | undefined;
  if (a === null || typeof a !== "object") {
    throw new Error(`The saved note ${noteId} is missing its anchoring.`);
  }
  /**
   * Only `local` is accepted. A stored `onchain` anchoring would carry a `txHash` this
   * browser never saw a chain confirm, and reading it back would let a local note
   * render as settled — the one lie the whole adapter layer is shaped to prevent.
   */
  if (a.kind !== "local") {
    throw new Error(
      `The saved note ${noteId} claims to be anchored "${String(a.kind)}". ` +
        `A local store cannot vouch for anything on chain, so it will not load one that says it can.`,
    );
  }
  return { kind: "local", why: assertString(a.why, "its anchoring reason", noteId) };
}

/**
 * One stored note back into everything except its commitment, which the pool derives.
 *
 * Returns the parts rather than a `Note` precisely because it cannot build one: `Note`
 * requires a `Commitment`, and this function has no hash. The type is what stops a
 * half-restored note existing.
 */
export type DecodedNote = {
  id: string;
  leafIndex: number;
  secret: bigint;
  token: TokenRef;
  amount: bigint;
  createdAt: string;
  spentAt: string | null;
  anchoring: Anchoring;
};

export function decodeNote(raw: unknown): DecodedNote {
  const n = raw as Partial<StoredNote> | null | undefined;
  if (n === null || typeof n !== "object") {
    throw new Error("The saved pool holds something that is not a note.");
  }
  const id = assertString(n.id, "its id", "(unnamed)");

  if (!Number.isInteger(n.leafIndex) || (n.leafIndex as number) < 0) {
    throw new Error(
      `The saved note ${id} has leaf index ${String(n.leafIndex)}, which is not a position in a tree.`,
    );
  }

  const secret = decodeField(n.secret, "a secret", id);
  if (secret === 0n || secret >= FIELD_MODULUS) {
    /**
     * The same two refusals `lib/note.ts` makes when a secret is generated, applied
     * again on the way in. A store is an untrusted input even when this browser wrote
     * it, and zero is what an uninitialised variable serialises to.
     */
    throw new Error(
      `The saved note ${id} has a secret that is not a usable field element. ` +
        `A zero or out-of-range secret cannot have produced a real note.`,
    );
  }

  const amount = decodeField(n.amount, "an amount", id);
  if (amount <= 0n || amount >= MAX_NOTE_VALUE) {
    throw new Error(
      `The saved note ${id} holds ${amount} base units, which no note can hold. ` +
        `A note is worth more than nothing and less than 2^248.`,
    );
  }

  const spentAt = n.spentAt === null || n.spentAt === undefined ? null : assertString(n.spentAt, "a spend time", id);

  return {
    id,
    leafIndex: n.leafIndex as number,
    secret,
    token: decodeToken(n.token, id),
    amount,
    createdAt: assertString(n.createdAt, "a creation time", id),
    spentAt,
    anchoring: decodeAnchoring(n.anchoring, id),
  };
}

/**
 * The whole record, validated as a set rather than note by note.
 *
 * The set-level check is the one that catches a lost note: leaf indices must be exactly
 * `0..n-1`. A gap means some note is missing, and every index after the gap then names a
 * tree position that nothing was inserted at — so the rebuilt tree has a different root
 * than the one those notes were created under, and every witness it serves is wrong.
 * That failure produces no error on its own; it produces proofs that are rejected later,
 * on chain, which is the worst place to find out.
 */
export function decodePool(raw: StoredPool | null): { notes: DecodedNote[]; nullifiers: string[] } | null {
  if (raw === null) return null;

  if (raw.version !== STORE_VERSION) {
    throw new Error(
      `The saved pool is version ${String(raw.version)} and this build reads version ${STORE_VERSION}. ` +
        `Refusing to guess at a record written by a different version rather than misread the amounts.`,
    );
  }
  if (!Array.isArray(raw.notes) || !Array.isArray(raw.nullifiers)) {
    throw new Error("The saved pool is missing its notes or its nullifier list.");
  }

  const notes = raw.notes.map(decodeNote);
  const byIndex = [...notes].sort((a, b) => a.leafIndex - b.leafIndex);
  for (const [position, note] of byIndex.entries()) {
    if (note.leafIndex !== position) {
      throw new Error(
        `The saved pool jumps from leaf ${position === 0 ? "none" : String(position - 1)} to leaf ${note.leafIndex}. ` +
          `A missing leaf shifts the tree, so every note after it would get a witness that proves nothing.`,
      );
    }
  }

  const nullifiers = raw.nullifiers.map((n, i) => {
    if (typeof n !== "string" || !/^0x[0-9a-f]{64}$/.test(n)) {
      throw new Error(
        `The saved pool holds "${String(n)}" at nullifier ${i}, which is not a 32-byte hex value. ` +
          `A malformed entry here would fail to match a real nullifier and let a spent note spend again.`,
      );
    }
    return n;
  });

  return { notes: byIndex, nullifiers };
}

/**
 * Why a disagreement between the set and `spentAt` resolves toward refusing.
 *
 * The two directions are not symmetric. If the set says spent and `spentAt` is null,
 * believing the set refuses a spend that may already have happened: nothing is lost.
 * If `spentAt` is stamped and the set has no nullifier for it, believing the set allows
 * a second spend of a note that is already gone — locally it succeeds, on chain it is
 * rejected, and the user has been shown money that does not exist.
 *
 * So the pool takes the UNION: the stored set, plus a derived nullifier for every note
 * stamped spent. Erring toward refusing a spend cannot lose money. Erring the other way
 * is the only bug in this file that could.
 */
export const SAFE_REPAIR = "union: stored nullifiers plus one derived per note stamped spent";
