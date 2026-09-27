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
 */
export type Note = {
  id: string;
  /** public: what goes on chain */
  commitment: string;
  /** PRIVATE: never leaves the browser */
  secret: string;
  token: TokenRef;
  /** base units, per token.decimals */
  amount: bigint;
  createdAt: string;
  spentAt: string | null;
  anchoring: Anchoring;
};

export type Receipt = {
  /** what happened, in the second person, for the CRT panel */
  summary: string;
  anchoring: Anchoring;
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
