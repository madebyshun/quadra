// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IHasher} from "../../src/interfaces/IHasher.sol";

/**
 * A keccak-based hasher, folded into the BN254 scalar field. FOR TESTS ONLY.
 *
 * ── Do not deploy this, and do not let it become the default ─────────────────
 * It satisfies every property `MerkleTreeWithHistory` needs — deterministic,
 * pure, collision-resistant, and its output is always a field element — so the
 * tree built on it is a correct tree and the tests that use it are meaningful
 * tests. That is precisely what makes it dangerous: nothing in the tree will ever
 * complain about it.
 *
 * What it is useless for is the actual product. A ZK circuit proving a Merkle
 * path over keccak costs tens of thousands of constraints per level, so a
 * 20-level path is a proof a browser cannot produce in reasonable time. The real
 * deployment needs a Poseidon (or equivalent) built for this field, and it needs
 * to be the *same one the circuit was compiled against* — see `IHasher`.
 *
 * The failure mode if this ships is not a revert. It is a pool whose deposits
 * work, whose tree is valid, and whose withdrawals nobody can afford to prove.
 *
 * ── Why the modulo is not a truncation ───────────────────────────────────────
 * `% FIELD_SIZE` keeps every input bit contributing to the output, where masking
 * off the high bits would throw them away and shrink the effective domain. The
 * reduction is very slightly non-uniform — values below `2^256 % FIELD_SIZE` are
 * marginally more likely — which is irrelevant at this margin and worth naming
 * anyway, because "it's only a mod" is how a real bias gets waved through
 * somewhere it matters.
 */
contract TestHasher is IHasher {
    uint256 private constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    function hash(bytes32 left, bytes32 right) external pure returns (bytes32) {
        return bytes32(uint256(keccak256(abi.encode(left, right))) % FIELD_SIZE);
    }
}

/**
 * A hasher that returns a full 256-bit digest, unreduced. FOR TESTS ONLY.
 *
 * Exists to prove that `MerkleTreeWithHistory`'s constructor rejects it rather
 * than building a tree full of values no circuit can reference. This is not a
 * hypothetical mistake: it is what you get by writing the obvious one-liner and
 * forgetting the field, and the resulting pool accepts deposits it can never let
 * out.
 */
contract UnreducedHasher is IHasher {
    function hash(bytes32 left, bytes32 right) external pure returns (bytes32) {
        return keccak256(abi.encode(left, right));
    }
}
