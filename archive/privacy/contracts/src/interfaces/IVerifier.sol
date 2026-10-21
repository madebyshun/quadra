// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * The zero-knowledge verifier, which this repo does NOT contain.
 *
 * ── Why there is no implementation here, and why that is the point ───────────
 * A verifier is not hand-written. It is generated from a proving key, which is
 * generated from a circuit, by a trusted setup. An implementation in this
 * directory could therefore only be one of two things: a real one copied from a
 * ceremony nobody in this repo ran, or a `return true` that makes every test
 * pass and every withdrawal free.
 *
 * The second one is the danger, and it does not look dangerous. It compiles, the
 * suite goes green, the pool "works", and the only symptom is that anybody can
 * drain it. So this file holds the interface and nothing else, and
 * `ShieldedPool`'s constructor refuses `address(0)` — there is no configuration
 * in which the pool runs without something answering this call.
 *
 * The same rule as `Anchoring` and `Attestation` in `src/adapters/types.ts`, one
 * layer down: a missing proof must be a compile error or a revert, never a
 * default that reads like success.
 *
 * ── The spec a circuit author has to hit ─────────────────────────────────────
 * `input` is the public-input vector, in this exact order, every element already
 * reduced into the BN254 scalar field:
 *
 *   [0] root               the Merkle root the input notes were proven against
 *   [1] publicAmount       net value entering the pool, in field arithmetic —
 *                          `extAmount - fee`, encoded by `ShieldedPool.fieldEncode`
 *   [2] extDataHash        keccak256(extData) % FIELD_SIZE, binding recipient,
 *                          relayer, extAmount and fee to this proof
 *   [3] inputNullifier[0]
 *   [4] inputNullifier[1]
 *   [5] outputCommitment[0]
 *   [6] outputCommitment[1]
 *
 * Two in, two out. Two inputs is what makes a note joinable with another rather
 * than only spendable alone; two outputs is what makes change possible. A pool
 * that could not produce change would force every payment to be for the exact
 * value of a note somebody already held.
 *
 * The circuit must also prove, and this contract cannot check any of it:
 *   - each input commitment is a leaf under `root`, or has zero value
 *   - each nullifier is derived from its input note and the spender's key
 *   - sum(inputs) + publicAmount == sum(outputs)
 *   - every output amount fits the range the field allows
 *
 * ── `publicAmount` is not the amount the user typed, and that distinction was
 *    once an insolvency ────────────────────────────────────────────────────────
 * The third bullet is unconditional, and it always was — the version of
 * `ShieldedPool` before this one did not honour it. It took `publicAmount` as a
 * calldata field and then paid the relayer's fee *out of* the payout on a
 * withdrawal but *on top of* it on a deposit or an internal transfer, so the law
 * it actually enforced was `sum(inputs) + publicAmount - (publicAmount < 0 ? 0 :
 * fee) == sum(outputs)`. A circuit written to this file — the correct equation —
 * would have made every relayed deposit skim its fee from other depositors' money,
 * and every relayed internal transfer a repeatable withdrawal against notes that
 * proved nothing left. Nothing reverts in either case; the shortfall surfaces as a
 * failed withdrawal for whoever is last.
 *
 * So the rule is stated once, in one direction: **`publicAmount` is everything the
 * pool's balance changes by, including the fee.** `ShieldedPool` derives it
 * (`publicAmountFor`) rather than accepting it, so no calldata can claim one value
 * while the transfers imply another — if two things must be equal, have one of
 * them. `extAmount` is the recipient's side of the boundary and is what a user
 * names; `fee` is the relayer's; `publicAmount` is their difference and is the only
 * one of the three the circuit does arithmetic with.
 *
 * `extDataHash` earns its slot: without it a relayer could take a valid proof
 * out of the mempool, point the payout at themselves and submit it. The proof
 * would still verify, because the recipient was never part of what was proven.
 * It binds `extAmount` as well as the addresses, which is redundant with `[1]` on
 * purpose — `[1]` is a quantity and this is a destination, and a client may
 * legitimately sign two transactions that differ only in how much they send.
 */
interface IVerifier {
    /**
     * @return true when `proof` is a valid proof for `input`.
     *
     * Must revert or return false on a malformed proof. Must never revert on a
     * merely invalid one — the caller needs to tell "this is not a proof" from
     * "this proof does not hold", and both are refusals rather than errors.
     */
    function verifyProof(bytes calldata proof, uint256[7] calldata input) external view returns (bool);
}
