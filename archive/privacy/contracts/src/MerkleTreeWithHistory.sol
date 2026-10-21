// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IHasher} from "./interfaces/IHasher.sol";

/**
 * An append-only Merkle tree of note commitments, plus a short memory of the
 * roots it used to have.
 *
 * ── Why the history, which is the part that looks like a bug ─────────────────
 * A withdrawal proves "my note is a leaf under root R". The prover has to pick R
 * before they can build the proof, and by the time the transaction lands someone
 * else may have deposited, which moves the root. Accepting only the newest root
 * would mean every proof races every deposit, and on a busy block nobody ever
 * wins — the pool would appear broken precisely when it was being used.
 *
 * So a fixed number of recent roots stay valid. That window is a real privacy
 * parameter, not a convenience: a proof against an old root narrows the set of
 * deposits the note could have come from to those made before it. Too short and
 * withdrawals fail; too long and the pool stores roots nobody can still use. 30
 * is Tornado's number and the reasoning is the same.
 *
 * ── Why the subtree cache ────────────────────────────────────────────────────
 * Rebuilding a 20-level tree from stored leaves would cost a million hashes.
 * Instead each level keeps the one node that is still waiting for a right
 * sibling, so an insert is exactly `levels` hashes. `zeros(i)` is the root of an
 * empty subtree of height i, which is what stands in for the sibling that does
 * not exist yet.
 *
 * Empty subtrees are computed in the constructor from the deployed hasher rather
 * than hard-coded. A hard-coded table is a copy of the answer for one specific
 * hash function, and this contract does not know which one it was given — a
 * table copied from a MiMC deployment into a Poseidon one produces a tree whose
 * roots no circuit agrees with, and nothing reverts. See `IHasher`.
 */
abstract contract MerkleTreeWithHistory {
    /**
     * The BN254 scalar field. Every value in the tree is an element of it.
     *
     * This is not a range check for tidiness. A Groth16 proof over BN254 can only
     * make statements about field elements, so a commitment at or above this
     * number is a leaf no circuit can ever reference. The money would go in and
     * no proof could get it out, with no revert anywhere along the way.
     */
    uint256 internal constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    /** How many past roots stay acceptable. See the note above on the window. */
    uint32 public constant ROOT_HISTORY_SIZE = 30;

    uint32 public immutable levels;
    IHasher public immutable hasher;

    /** The node at each level still waiting for a right sibling. */
    bytes32[] public filledSubtrees;
    /** Root of an empty subtree at each height, index 0 being the empty leaf. */
    bytes32[] public zeros;

    /** Circular buffer of recent roots. `roots[currentRootIndex]` is the newest. */
    mapping(uint256 => bytes32) public roots;
    uint32 public currentRootIndex;
    uint32 public nextIndex;

    error LevelsOutOfRange(uint32 levels);
    error HasherNotSet();
    error TreeIsFull();
    error NotInField(bytes32 value);

    constructor(uint32 _levels, IHasher _hasher) {
        /**
         * Both bounds are real. Zero levels is a tree with one leaf and no proof
         * to make. Above 32 the leaf index no longer fits the `uint32` the insert
         * path counts with, so the tree would wrap and start overwriting leaves
         * that already hold money.
         */
        if (_levels == 0 || _levels > 32) revert LevelsOutOfRange(_levels);
        if (address(_hasher) == address(0)) revert HasherNotSet();

        levels = _levels;
        hasher = _hasher;

        /**
         * The empty leaf is `keccak256("quadra.shielded-pool.empty-leaf")` folded
         * into the field. Any value works as long as it is fixed and the circuit
         * uses the same one; a domain-separated constant is chosen over plain
         * zero so that an all-zero calldata blob is not accidentally a valid
         * empty leaf.
         */
        bytes32 zero = bytes32(uint256(keccak256("quadra.shielded-pool.empty-leaf")) % FIELD_SIZE);
        zeros.push(zero);
        filledSubtrees.push(zero);

        for (uint32 i = 1; i < _levels; i++) {
            bytes32 next = _hasher.hash(zeros[i - 1], zeros[i - 1]);
            if (uint256(next) >= FIELD_SIZE) revert NotInField(next);
            zeros.push(next);
            filledSubtrees.push(next);
        }

        /**
         * Checked again here, and not only inside the loop above.
         *
         * At `_levels == 1` that loop never runs, so this is the *only* hash the
         * constructor takes and skipping the check would let a hasher that returns
         * full 256-bit digests build a tree whose every root is outside the field.
         * Nothing downstream would revert: deposits would succeed and no
         * withdrawal would ever be provable. A bound that holds at every size
         * except the smallest legal one is not a bound.
         */
        bytes32 emptyRoot = _hasher.hash(zeros[_levels - 1], zeros[_levels - 1]);
        if (uint256(emptyRoot) >= FIELD_SIZE) revert NotInField(emptyRoot);
        roots[0] = emptyRoot;
    }

    /**
     * Add a leaf and return the index it landed at.
     *
     * `internal`, so only the pool can grow the tree. A public insert would let
     * anyone pad the tree with commitments nobody holds the secret for, which
     * costs the pool nothing but fills it toward `TreeIsFull` for free.
     */
    function _insert(bytes32 leaf) internal returns (uint32 index) {
        if (uint256(leaf) >= FIELD_SIZE) revert NotInField(leaf);

        uint32 currentIndex = nextIndex;
        /**
         * `1 << levels` is the capacity. Reverting here rather than wrapping is
         * the whole reason `levels` is capped at 32 above: a wrapped index
         * silently overwrites a leaf that somebody's money depends on.
         */
        if (currentIndex == uint32(1) << levels) revert TreeIsFull();

        bytes32 currentHash = leaf;
        bytes32 left;
        bytes32 right;

        for (uint32 i = 0; i < levels; i++) {
            if (currentIndex % 2 == 0) {
                // No right sibling yet: stand in the empty subtree and remember
                // this node, so the next insert at this level can pair with it.
                left = currentHash;
                right = zeros[i];
                filledSubtrees[i] = currentHash;
            } else {
                left = filledSubtrees[i];
                right = currentHash;
            }
            currentHash = hasher.hash(left, right);
            currentIndex /= 2;
        }

        uint32 newRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        currentRootIndex = newRootIndex;
        roots[newRootIndex] = currentHash;

        index = nextIndex;
        nextIndex = index + 1;
    }

    /**
     * Whether a proof built against `root` is still acceptable.
     *
     * The zero check is load-bearing. Unwritten slots in the circular buffer read
     * as zero, so without it a proof naming root zero would be accepted against
     * every tree younger than 30 deposits — and "an unset thing equals the
     * default" is exactly how that slips past review.
     *
     * The walk runs backwards from the newest root because a real withdrawal is
     * almost always proving against a recent one.
     */
    function isKnownRoot(bytes32 root) public view returns (bool) {
        if (root == bytes32(0)) return false;

        uint32 i = currentRootIndex;
        do {
            if (root == roots[i]) return true;
            i = i == 0 ? ROOT_HISTORY_SIZE - 1 : i - 1;
        } while (i != currentRootIndex);

        return false;
    }

    /** The newest root. */
    function getLastRoot() public view returns (bytes32) {
        return roots[currentRootIndex];
    }

    /** How many leaves the tree can still take. */
    function remainingCapacity() public view returns (uint256) {
        return (uint256(1) << levels) - nextIndex;
    }
}
