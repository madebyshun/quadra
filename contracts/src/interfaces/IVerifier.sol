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
 *                          see `ShieldedPool.publicAmountFor`
 *   [2] extDataHash        keccak256(extData) % FIELD_SIZE, binding recipient,
 *                          relayer and fee to this proof
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
 * `extDataHash` earns its slot: without it a relayer could take a valid proof
 * out of the mempool, point the payout at themselves and submit it. The proof
 * would still verify, because the recipient was never part of what was proven.
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
