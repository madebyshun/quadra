/**
 * The seam between the UI and the two things this product does not have yet:
 * a deployed shielded pool, and a real TEE.
 *
 * The UI is built against these interfaces only. A local implementation makes
 * the whole app runnable and testable now; the on-chain implementation drops in
 * later without the UI changing.
 *
 * ── The one rule that shapes every type below ──────────────────────────────
 * A stub that emits a plausible-looking proof is WORSE than no stub, because it
 * cannot be told apart from the real thing by looking at the output. So `kind`
 * is a discriminant, not a label: the local variants have no `txHash`, no
 * `quote`, and no `measurement` FIELD AT ALL. Faking a proof is not something a
 * developer must remember not to do — it does not typecheck.
 */

import type { Commitment, TreeRoot } from "@/lib/note";

export type TokenRef = {
  address: string;
  symbol: string;
  decimals: number;
};

/** Where a fact was anchored, if anywhere. */
export type Anchoring =
  | { kind: "onchain"; txHash: string; block: number }
  | { kind: "local"; why: string };

/**
 * A note is the money. The secret lives in the browser and nowhere else: losing
 * it loses the funds, and leaking it hands them over. Never log a whole note,
 * never put one in a url, never send one to a server.
 *
 * ── Why `commitment` is a type and not a string ──────────────────────────────
 * It used to be `commitment: string`, and the local pool filled it with a random
 * 32 bytes. That typechecked, it read as correct, and it committed to nothing: no
 * secret's knowledge was provable from it, so no circuit could ever be written
 * against those notes. `Commitment` in `lib/note.ts` is a discriminated union
 * carrying the hash scheme that produced it, so a value hashed with the stand-in
 * cannot reach the chain boundary without the difference being handled. Same
 * device as `Anchoring` above, and for the same reason.
 */
export type Note = {
  id: string;
  /** public: what goes on chain, derived from `amount` and `secret` */
  commitment: Commitment;
  /**
   * Which leaf of the commitment tree this note is, counted from zero.
   *
   * Part of the note rather than derivable from it, because the tree assigns it:
   * `MerkleTreeWithHistory._insert` returns `nextIndex` and increments. It is here
   * because the nullifier's preimage includes it — without it the same secret at two
   * positions would produce one nullifier, and spending either would mark both.
   *
   * Public. It identifies a position in a tree everyone can read, not an owner.
   */
  leafIndex: number;
  /**
   * PRIVATE: never leaves the browser.
   *
   * A field element rather than a hex string. The scheme's inputs are field
   * elements, so carrying it in the arithmetic type it is actually used as means
   * there is no parse step to get wrong and no place for a 33-byte "field element"
   * to hide.
   */
  secret: bigint;
  token: TokenRef;
  /** base units, per token.decimals */
  amount: bigint;
  createdAt: string;
  /**
   * When this note was spent, for display. **Not the authority on whether it was.**
   *
   * The pool refuses a double-spend from its nullifier set, the way the contract
   * does (`ShieldedPool.isSpent`), because that is the rule that will still be true
   * on chain — a timestamp is a local convenience that no verifier can check. The
   * two are written in one place so they cannot disagree; `tests/adapters.test.ts`
   * asserts the invariant rather than trusting it.
   */
  spentAt: string | null;
  anchoring: Anchoring;
};

export type Receipt = {
  /** what happened, in the second person, for the CRT panel */
  summary: string;
  anchoring: Anchoring;
};

/**
 * Everything a proof needs about one note's place in the tree.
 *
 * This is the input a circuit consumes: it proves "I know the secret behind a leaf
 * that is in the tree with this root" without saying which leaf. So the shape is
 * `lib/tree.ts`'s `MerklePath`, with the two ends **tagged** — see `TaggedField` in
 * `lib/note.ts`.
 *
 * ── Why the ends are tagged and the middle is not ────────────────────────────
 * `root` and `leaf` are the two values that leave this browser: the root is what a
 * contract checks against `isKnownRoot`, the leaf is what was inserted. A root
 * computed from the stand-in hash matches no deployed pool, so shipping it as a bare
 * bigint would let an unprovable number reach a chain boundary looking exactly like a
 * provable one — the hazard the header of this file is about.
 *
 * The `siblings` stay bare bigints on purpose. They are interior nodes, meaningless
 * except under a root that is already tagged, and tagging each of twenty of them
 * would be twenty copies of one fact about the whole witness. Tag the boundary, not
 * every node behind it.
 */
export type NoteWitness = {
  readonly root: TreeRoot;
  readonly leaf: Commitment;
  readonly leafIndex: number;
  /** Sibling at each level, leaf upward. `siblings.length === levels`. */
  readonly siblings: readonly bigint[];
  /** True where the path node is the RIGHT child, so the sibling hashes first. */
  readonly isRight: readonly boolean[];
};

export interface ShieldedPool {
  /** Put money in. Returns the note you must keep. */
  deposit(token: TokenRef, amount: bigint): Promise<Note>;
  /** Notes this browser is holding, newest first. Unspent only unless asked. */
  notes(opts?: { includeSpent?: boolean }): Promise<Note[]>;
  /** Spend a note to pay an address. The pool pays, not you. */
  send(noteId: string, to: string, amount: bigint): Promise<Receipt>;
  /** Take money back out to an address you control. */
  withdraw(noteId: string, to: string): Promise<Receipt>;
  /**
   * The nullifiers this pool has seen, as hex. Mirrors `ShieldedPool.isSpent`.
   *
   * Part of the interface because it is public on chain — anyone can read that
   * mapping, so hiding it here would make the local pool look more private than the
   * real one rather than less, which is the wrong direction for every seam in this
   * file. It leaks nothing: a nullifier is unlinkable to its commitment without the
   * secret, which is the entire reason the scheme uses one.
   */
  nullifiers(): Promise<string[]>;
  /**
   * The current commitment-tree root.
   *
   * On the interface rather than only on the local pool, because a pool that cannot
   * say what its root is cannot be proven against — every proof is a statement about
   * one root, and `MerkleTreeWithHistory.isKnownRoot` is what the contract checks it
   * with. The on-chain adapter reads `ShieldedPool.getLastRoot()`; the local one
   * computes it. Neither can forget to have one.
   *
   * Tagged, so a root the stand-in hash produced cannot be mistaken for a root a
   * deployed pool would recognise.
   */
  root(): Promise<TreeRoot>;
  /**
   * The Merkle witness for a note this browser holds.
   *
   * Here for the same reason as `root()`: it is the other half of what a proof needs,
   * and the local pool can serve it today. **Not** on the contract — the chain stores
   * only `filledSubtrees` and cannot reconstruct a path for an arbitrary leaf, which
   * is why a client keeps its own copy of the tree. So the on-chain adapter will build
   * this from its own tree too, and the interface is what makes that obligation
   * visible instead of a surprise on deployment day.
   */
  witness(noteId: string): Promise<NoteWitness>;
  /**
   * Hand the notes out as a file, and take them back from one. See `lib/backup.ts`.
   *
   * On the interface for the same reason as `witness()`, and the reason is easy to get
   * backwards: a live pool does **not** make these unnecessary. The chain holds
   * commitments and nullifiers; it holds no secret, so it cannot reconstruct a note and
   * cannot restore anybody. A deployed pool's user is in exactly the same position as a
   * local one's — the notes are the money, the notes are in the browser, and a cleared
   * site-data dialog ends them. Putting these here means an on-chain adapter cannot be
   * written without answering "and how does its user get their notes back?", which is
   * otherwise the question that only comes up after someone has lost some.
   *
   * ⚠️ `importBackup` is a pool operation and not a store operation, even though the
   * file format work happens in `lib/backup.ts`. A restore replaces the state the live
   * object has already cached; doing it around the pool means the next write puts the
   * old notes back over the restored ones. The note on `LocalShieldedPool.importBackup`
   * has the measurement.
   */
  exportBackup(): Promise<{ filename: string; body: string }>;
  importBackup(text: string): Promise<{ notes: number }>;
  /** True when this is backed by a deployed pool rather than local state. */
  readonly isLive: boolean;
}

/**
 * Proof that inference ran inside an enclave.
 *
 * Note what the `local-dev` variant lacks: any field a verifier would check.
 * There is deliberately no `verified: boolean`, because `verified: false` is a
 * field that gets ignored, whereas a missing `quote` is a type error.
 */
export type Attestation =
  | { kind: "enclave"; quote: string; measurement: string; attestedAt: string }
  | { kind: "local-dev"; why: string };

export type Model = {
  id: string;
  label: string;
  /** USDC base units (6 dp) per request */
  priceBaseUnits: bigint;
};

export type Completion = {
  text: string;
  model: string;
  attestation: Attestation;
};

export interface Enclave {
  models(): Promise<Model[]>;
  infer(modelId: string, prompt: string): Promise<Completion>;
  /** True when answers come from a real enclave with a checkable quote. */
  readonly isLive: boolean;
}

/**
 * One field a tool declares, and whether it may be left out.
 *
 * `required` is not decoration. Measured against the live catalog on 2026-09-27:
 * 66 of the 115 tools declare at least one optional field, so treating every
 * declared field as mandatory would make most of the catalog unrunnable — the
 * caller would have to invent a `limit` to get an answer that never needed one.
 */
export type ToolField = {
  name: string;
  required: boolean;
};

/** A tool upstream offers: what it costs and what it wants. */
export type Tool = {
  id: string;
  title: string;
  /** one line, as upstream words it */
  summary: string;
  /** what upstream declares, in its order */
  inputs: readonly ToolField[];
};

/**
 * What a tool costs, read off a live 402 rather than assembled here.
 *
 * `free` is a real case, not an absence: some ids answer 200 with no payment at
 * all, and a `price: 0n` would have let the router build an authorization for
 * zero and charge gas to prove nothing.
 */
export type Price =
  | { kind: "paid"; payTo: string; amountBaseUnits: bigint; asset: TokenRef; network: string }
  | { kind: "free"; why: string };

export type Quote = {
  toolId: string;
  price: Price;
};

/**
 * Whether money actually moved. Same rule as `Anchoring`: only the variant that
 * really settled carries a `txHash`, so a local run cannot render as paid.
 */
export type Settlement =
  | { kind: "settled"; txHash: string; payTo: string; amountBaseUnits: bigint }
  | { kind: "free"; why: string }
  | { kind: "unsettled"; why: string };

export type ToolRun = {
  toolId: string;
  /** upstream's answer, already text */
  output: string;
  settlement: Settlement;
};

export interface Catalog {
  tools(): Promise<Tool[]>;
  /** Read the price without paying it. Free upstream, so free here too. */
  quote(toolId: string): Promise<Quote>;
  run(toolId: string, input: Record<string, string>): Promise<ToolRun>;
  /**
   * Why THIS price cannot be run, or `null` when it can.
   *
   * This exists so the button can be disabled with the reason next to it. The
   * alternative — a button that reads "Run for 0.01 USDC" and throws every time —
   * makes the panel promise something it knows it will not do, which is the one
   * wording this whole surface is built to avoid. A run that fails for a reason
   * known only at click time still throws; this is for the ones known up front.
   *
   * It takes the price because runnability is per tool, not per adapter. This was a
   * flat `readonly cannotRun: string | null` until the forwarder was measured: with a
   * same-origin path to upstream, the six ids that answer 200 without payment really
   * do run, while the other 109 need an authorization signed by a wallet this build
   * has no signing code for. One flag for both had to pick a lie — either the free
   * tools were refused for a wallet they never wanted, or the paid ones offered a run
   * that could only throw.
   */
  whyNot(price: Price): string | null;
  /** True when runs reach the real catalog and settle real USDC. */
  readonly isLive: boolean;
}

export type Adapters = {
  pool: ShieldedPool;
  enclave: Enclave;
  catalog: Catalog;
};
