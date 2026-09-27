/**
 * The BN254 scalar field, in the browser, agreeing with the contracts.
 *
 * ── Why this file exists at all ──────────────────────────────────────────────
 * A note's commitment is a field element. So is its nullifier, so is every node
 * in the Merkle tree, and so is every public input a Groth16 proof can make a
 * statement about. A value at or above the modulus is not a large number — it is
 * a number no circuit can reference. Put one in the tree as a commitment and the
 * money goes in with no proof able to get it out, and nothing reverts anywhere
 * along the way. `MerkleTreeWithHistory` reverts `NotInField` for exactly this.
 *
 * So the browser has to know the bound too. A commitment built here and rejected
 * on chain is a bad afternoon; a commitment built here, accepted on chain, and
 * unprovable forever is lost money.
 *
 * ── The duplication, and why it is checked rather than trusted ───────────────
 * These constants also live in `contracts/src/`. That is a copy, and a copy of a
 * constant is a thing that drifts — silently, because both halves keep working
 * on their own and only disagree at the boundary where they meet.
 *
 * `tests/field.test.ts` therefore reads the Solidity and extracts the literals,
 * rather than restating them. If either side changes, the suite fails and names
 * the file that moved. **Do not "simplify" that test into a hard-coded
 * expectation** — the hard-coded expectation is the bug it exists to catch.
 */

/**
 * The BN254 scalar field modulus. Mirrors `FIELD_SIZE` in
 * `contracts/src/MerkleTreeWithHistory.sol`.
 */
export const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * The largest value one note may hold. Mirrors `MAX_NOTE_VALUE` in
 * `contracts/src/ShieldedPool.sol`.
 *
 * Not a policy limit, and the reasoning is worth repeating here because a reader
 * in the frontend will not have the contract open: the circuit proves
 * `sum(in) + public == sum(out)` in field arithmetic, which **wraps**. Without a
 * bound well below the modulus, an attacker picks amounts whose sum overflows
 * into a valid-looking equation and mints value out of nothing. 2^248 leaves room
 * for any real token balance and no room to reach the modulus by adding a handful
 * of notes together.
 */
export const MAX_NOTE_VALUE = 1n << 248n;

/** How many bytes a field element is written as. */
const FIELD_BYTES = 32;

const HEX32 = /^0x[0-9a-f]{64}$/;

export function isInField(value: bigint): boolean {
  return value >= 0n && value < FIELD_MODULUS;
}

/**
 * Fold an arbitrary non-negative integer into the field.
 *
 * Deliberately **not** applied to amounts or to anything a user typed. Reducing a
 * quantity changes it, and a silently changed amount is the worst failure this
 * codebase has: 2^248 + 1 tokens would become 1 token and the receipt would read
 * as normal. This is for hash output, where every result is equally meaningless
 * and folding is the standard move.
 *
 * ⚠️ Folding by `%` is very slightly non-uniform — the residues below
 * `2^256 mod FIELD_MODULUS` are reachable one extra way. The bias is around
 * 2^-127 and irrelevant at this size, but it is written down because "it's only a
 * mod" is how a real bias gets waved through somewhere it matters.
 */
export function intoField(value: bigint): bigint {
  if (value < 0n) {
    throw new Error(`Cannot fold a negative value into the field: ${value}.`);
  }
  return value % FIELD_MODULUS;
}

/**
 * A field element as a 32-byte lowercase hex string.
 *
 * Fixed width, always. A variable-width encoding would hash differently for the
 * same number depending on how many leading zeros it happened to have, which is
 * the sort of bug that shows up as "proofs fail about 1 time in 256".
 */
export function toFieldHex(value: bigint): string {
  if (!isInField(value)) {
    throw new Error(`${value} is not a field element — it is not in 0..FIELD_MODULUS-1.`);
  }
  return `0x${value.toString(16).padStart(FIELD_BYTES * 2, "0")}`;
}

export function fromFieldHex(hex: string): bigint {
  if (!HEX32.test(hex)) {
    throw new Error(
      `"${hex}" is not a 32-byte lowercase hex field element (expected 0x + 64 hex digits).`,
    );
  }
  const value = BigInt(hex);
  if (!isInField(value)) {
    throw new Error(`${hex} decodes to a value at or above the field modulus.`);
  }
  return value;
}

/**
 * Refuse an amount the pool would refuse, here, where the user can read it.
 *
 * The contract reverts `AmountTooLarge` for the same bound. Checking in the
 * browser as well is not redundant: a revert costs gas and arrives as a hex error
 * selector, whereas this arrives as a sentence before anything is signed.
 */
export function assertNoteValue(amount: bigint): void {
  if (amount <= 0n) {
    throw new Error(`A note must hold more than zero, got ${amount}.`);
  }
  if (amount > MAX_NOTE_VALUE) {
    throw new Error(
      `${amount} is larger than one note can hold (the limit is 2^248, which the pool enforces too).`,
    );
  }
}

/**
 * A random field element, drawn by rejection rather than by folding.
 *
 * Rejection sampling instead of `intoField(random)` because this one **is** used
 * for a secret. The folding bias is negligible at 2^-127, but a blinding factor is
 * precisely the value where an attacker gets unlimited attempts to exploit any
 * structure, and "negligible" is a claim about an adversary rather than about
 * arithmetic. Drawing again costs nothing: the retry probability is under 2^-127
 * per attempt, so the loop body effectively never runs twice.
 */
export function randomFieldElement(): bigint {
  for (;;) {
    const buf = new Uint8Array(FIELD_BYTES);
    crypto.getRandomValues(buf);
    let value = 0n;
    for (const byte of buf) value = (value << 8n) | BigInt(byte);
    if (isInField(value)) return value;
  }
}
