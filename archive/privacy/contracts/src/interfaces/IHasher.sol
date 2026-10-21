// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * The hash the Merkle tree is built from.
 *
 * ── Why this is an address and not a function ────────────────────────────────
 * The tree's hash and the circuit's hash have to be the same function, or a
 * proof about the tree proves nothing about the tree. That makes the choice a
 * property of the circuit, and the circuit is not in this repo (see
 * `IVerifier`). Writing `keccak256` into the tree here would quietly decide it,
 * and decide it badly: keccak is cheap on chain and brutal inside a circuit —
 * tens of thousands of constraints per hash against a couple of hundred for a
 * Poseidon built for the same field. A 20-level tree hashes 20 times per
 * insert, so that choice is the difference between a proof that takes a second
 * and one that takes minutes in a browser.
 *
 * So the pool takes a deployed hasher, the same way Tornado takes a deployed
 * MiMC. Deploy the one the circuit was compiled against, and nothing else.
 *
 * ── The contract an implementation has to keep ───────────────────────────────
 * Both arguments and the result are elements of the BN254 scalar field — every
 * value strictly below `FIELD_SIZE` in `MerkleTreeWithHistory`. That is not a
 * convention, it is what a Groth16 proof over that curve can talk about at all.
 * An implementation returning a full 256-bit digest puts values in the tree that
 * no circuit can reason about, and the failure arrives as unprovable notes
 * rather than as a revert: the money goes in and no proof can ever get it out.
 *
 * `pure` is deliberate. A hasher that could read state could return a different
 * answer for the same pair once a subtree was already built, which makes every
 * root computed before that moment unprovable.
 */
interface IHasher {
    function hash(bytes32 left, bytes32 right) external pure returns (bytes32);
}
