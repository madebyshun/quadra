// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Harness} from "./Harness.sol";
import {MerkleTreeWithHistory} from "../src/MerkleTreeWithHistory.sol";
import {IHasher} from "../src/interfaces/IHasher.sol";
import {TestHasher, UnreducedHasher} from "./doubles/TestHasher.sol";

/**
 * `MerkleTreeWithHistory` is abstract and `_insert` is internal — deliberately, so
 * nobody can pad the tree from outside. This exposes both for testing without
 * loosening the real contract, which is the only legitimate reason to write a
 * wrapper like this.
 */
contract TreeUnderTest is MerkleTreeWithHistory {
    constructor(uint32 _levels, IHasher _hasher) MerkleTreeWithHistory(_levels, _hasher) {}

    function insert(bytes32 leaf) external returns (uint32) {
        return _insert(leaf);
    }
}

contract MerkleTreeWithHistoryTest is Harness {
    uint256 private constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    TestHasher internal hasher;

    function setUp() public {
        hasher = new TestHasher();
    }

    function _tree(uint32 levels) internal returns (TreeUnderTest) {
        return new TreeUnderTest(levels, hasher);
    }

    function _leaf(uint256 n) internal pure returns (bytes32) {
        return bytes32(uint256(keccak256(abi.encode("leaf", n))) % FIELD_SIZE);
    }

    /* ── construction ───────────────────────────────────────────────────────── */

    function test_rejectsZeroLevels() public {
        vm.expectRevert(
            abi.encodeWithSelector(MerkleTreeWithHistory.LevelsOutOfRange.selector, uint32(0))
        );
        new TreeUnderTest(0, hasher);
    }

    /**
     * 33 levels is the first size at which a leaf index no longer fits the
     * `uint32` the insert path counts with. Without this bound the tree would
     * wrap and start overwriting leaves that already hold money, silently.
     */
    function test_rejectsMoreThan32Levels() public {
        vm.expectRevert(
            abi.encodeWithSelector(MerkleTreeWithHistory.LevelsOutOfRange.selector, uint32(33))
        );
        new TreeUnderTest(33, hasher);
    }

    function test_acceptsTheBoundsThemselves() public {
        assertEq(_tree(1).levels(), 1, "one level is a legal tree");
        assertEq(_tree(32).levels(), 32, "32 levels is the documented maximum");
    }

    function test_rejectsZeroHasher() public {
        vm.expectRevert(MerkleTreeWithHistory.HasherNotSet.selector);
        new TreeUnderTest(20, IHasher(address(0)));
    }

    /**
     * The failure this catches does not revert on its own. A hasher returning a
     * full 256-bit digest fills the tree with values no Groth16 proof over BN254
     * can reference, so deposits succeed and no withdrawal is ever provable. The
     * constructor has to be the thing that notices.
     */
    function test_rejectsAHasherThatLeavesTheField() public {
        UnreducedHasher bad = new UnreducedHasher();
        // Level 1 is the first hash the constructor takes, so that is where it
        // trips. Asserting the *value* too would pin keccak's output, which is
        // not the property under test.
        vm.expectRevert();
        new TreeUnderTest(20, bad);
    }

    /**
     * A one-level tree never enters the `zeros` loop, so the loop's field check
     * cannot be what catches a bad hasher at that size.
     *
     * This test found a real hole rather than confirming a guess: it originally
     * asserted the hole existed — `new TreeUnderTest(1, bad)` succeeded and
     * produced an out-of-field root. The constructor now checks the empty root it
     * computes as well as each level, so every legal size is covered. Kept at
     * `levels == 1` specifically, because that is the only size where the two
     * checks are not redundant.
     */
    function test_aOneLevelTreeStillChecksItsHasher() public {
        UnreducedHasher bad = new UnreducedHasher();
        vm.expectRevert();
        new TreeUnderTest(1, bad);
    }

    function test_everyLegalSizeChecksItsHasher() public {
        UnreducedHasher bad = new UnreducedHasher();
        uint32[5] memory sizes = [uint32(1), 2, 3, 20, 32];
        for (uint256 i = 0; i < sizes.length; i++) {
            vm.expectRevert();
            new TreeUnderTest(sizes[i], bad);
        }
    }

    function test_emptyLeafIsDomainSeparatedAndInField() public {
        TreeUnderTest tree = _tree(20);
        bytes32 zero = tree.zeros(0);
        assertEq(
            zero,
            bytes32(uint256(keccak256("quadra.shielded-pool.empty-leaf")) % FIELD_SIZE),
            "empty leaf is the documented constant"
        );
        assertNotEq(zero, bytes32(0), "an all-zero calldata blob must not be a valid empty leaf");
        assertTrue(uint256(zero) < FIELD_SIZE, "empty leaf is a field element");
    }

    function test_zerosAreTheRootsOfEmptySubtrees() public {
        TreeUnderTest tree = _tree(8);
        for (uint32 i = 1; i < 8; i++) {
            assertEq(
                tree.zeros(i),
                hasher.hash(tree.zeros(i - 1), tree.zeros(i - 1)),
                "zeros(i) is the root of an empty subtree of height i"
            );
        }
    }

    function test_initialRootIsTheEmptyTree() public {
        TreeUnderTest tree = _tree(8);
        assertEq(
            tree.getLastRoot(),
            hasher.hash(tree.zeros(7), tree.zeros(7)),
            "root of a tree with no leaves"
        );
        assertEq(tree.nextIndex(), 0, "no leaves yet");
        assertEq(tree.remainingCapacity(), 256, "2^8 leaves available");
    }

    /* ── inserting ──────────────────────────────────────────────────────────── */

    function test_rejectsALeafOutsideTheField() public {
        TreeUnderTest tree = _tree(20);
        bytes32 tooBig = bytes32(FIELD_SIZE);
        vm.expectRevert(
            abi.encodeWithSelector(MerkleTreeWithHistory.NotInField.selector, tooBig)
        );
        tree.insert(tooBig);
    }

    function test_acceptsTheLargestLegalLeaf() public {
        TreeUnderTest tree = _tree(20);
        assertEq(tree.insert(bytes32(FIELD_SIZE - 1)), 0, "FIELD_SIZE - 1 is in the field");
    }

    function test_returnsSequentialIndices() public {
        TreeUnderTest tree = _tree(8);
        for (uint32 i = 0; i < 5; i++) {
            assertEq(tree.insert(_leaf(i)), i, "leaf lands at the next free index");
            assertEq(tree.nextIndex(), i + 1, "nextIndex tracks the inserts");
        }
        assertEq(tree.remainingCapacity(), 251, "capacity falls by one per insert");
    }

    function test_rootChangesOnEveryInsert() public {
        TreeUnderTest tree = _tree(8);
        bytes32 before = tree.getLastRoot();
        for (uint32 i = 0; i < 6; i++) {
            tree.insert(_leaf(i));
            bytes32 next = tree.getLastRoot();
            assertNotEq(next, before, "a new leaf must move the root");
            before = next;
        }
    }

    /**
     * The subtree cache is the only reason an insert costs `levels` hashes instead
     * of a million. If it is wrong, the tree is still internally consistent — it
     * just computes roots that no independently-built tree agrees with, and the
     * symptom is every proof failing. So check against a root computed the slow,
     * obvious way.
     */
    function test_rootMatchesANaivelyRebuiltTree() public {
        uint32 levels = 4;
        TreeUnderTest tree = _tree(levels);

        bytes32[] memory leaves = new bytes32[](16);
        for (uint256 i = 0; i < 16; i++) leaves[i] = tree.zeros(0);

        for (uint256 n = 0; n < 7; n++) {
            bytes32 leaf = _leaf(n);
            tree.insert(leaf);
            leaves[n] = leaf;
            assertEq(
                tree.getLastRoot(),
                _rootOf(leaves, levels),
                "cached root matches a full rebuild"
            );
        }
    }

    function _rootOf(bytes32[] memory leaves, uint32 levels) internal view returns (bytes32) {
        bytes32[] memory layer = leaves;
        for (uint32 level = 0; level < levels; level++) {
            bytes32[] memory next = new bytes32[](layer.length / 2);
            for (uint256 i = 0; i < next.length; i++) {
                next[i] = hasher.hash(layer[2 * i], layer[2 * i + 1]);
            }
            layer = next;
        }
        return layer[0];
    }

    function test_fillsAndThenRefuses() public {
        TreeUnderTest tree = _tree(2);
        for (uint32 i = 0; i < 4; i++) tree.insert(_leaf(i));
        assertEq(tree.remainingCapacity(), 0, "a 2-level tree holds exactly 4 leaves");

        vm.expectRevert(MerkleTreeWithHistory.TreeIsFull.selector);
        tree.insert(_leaf(99));
    }

    /**
     * Reverting rather than wrapping is the entire reason `levels` is capped at 32.
     * A wrapped index overwrites a leaf somebody's money depends on, and nothing
     * anywhere reports it.
     */
    function test_aFullTreeDoesNotWrapAndOverwrite() public {
        TreeUnderTest tree = _tree(1);
        tree.insert(_leaf(0));
        tree.insert(_leaf(1));
        bytes32 rootWhenFull = tree.getLastRoot();

        vm.expectRevert(MerkleTreeWithHistory.TreeIsFull.selector);
        tree.insert(_leaf(2));

        assertEq(tree.getLastRoot(), rootWhenFull, "the refused insert changed nothing");
        assertEq(tree.nextIndex(), 2, "and did not advance the index");
    }

    /* ── root history ───────────────────────────────────────────────────────── */

    /**
     * The zero check in `isKnownRoot` is load-bearing. Unwritten slots in the
     * circular buffer read as zero, so without it a proof naming root zero would
     * verify against every tree younger than 30 deposits — and "an unset thing
     * equals the default" is exactly the shape that slips past review.
     */
    function test_rootZeroIsNeverKnown() public {
        TreeUnderTest tree = _tree(20);
        assertFalse(tree.isKnownRoot(bytes32(0)), "fresh tree");
        tree.insert(_leaf(1));
        assertFalse(tree.isKnownRoot(bytes32(0)), "after an insert, with slots still unwritten");
    }

    function test_remembersExactlyThirtyRoots() public {
        TreeUnderTest tree = _tree(8);
        uint32 size = tree.ROOT_HISTORY_SIZE();
        assertEq(size, 30, "the documented window");

        bytes32[] memory seen = new bytes32[](size + 2);
        seen[0] = tree.getLastRoot();
        for (uint32 i = 1; i <= size + 1; i++) {
            tree.insert(_leaf(i));
            seen[i] = tree.getLastRoot();
        }

        // The newest 30 roots are the buffer's contents: indices 2..31 of `seen`.
        for (uint32 i = 2; i <= size + 1; i++) {
            assertTrue(tree.isKnownRoot(seen[i]), "a root inside the window stays valid");
        }
        // The two oldest have been overwritten and must no longer be accepted.
        assertFalse(tree.isKnownRoot(seen[0]), "the empty-tree root has aged out");
        assertFalse(tree.isKnownRoot(seen[1]), "the root after one insert has aged out");
    }

    function test_rejectsARootThatNeverExisted() public {
        TreeUnderTest tree = _tree(8);
        tree.insert(_leaf(1));
        assertFalse(tree.isKnownRoot(_leaf(777)), "an arbitrary value is not a root");
    }

    function test_theCurrentRootIsAlwaysKnown() public {
        TreeUnderTest tree = _tree(8);
        assertTrue(tree.isKnownRoot(tree.getLastRoot()), "before any insert");
        for (uint32 i = 0; i < 12; i++) {
            tree.insert(_leaf(i));
            assertTrue(tree.isKnownRoot(tree.getLastRoot()), "after each insert");
        }
    }

    /* ── fuzz ───────────────────────────────────────────────────────────────── */

    function testFuzz_everyLeafInFieldIsAccepted(uint256 raw) public {
        TreeUnderTest tree = _tree(20);
        bytes32 leaf = bytes32(raw % FIELD_SIZE);
        assertEq(tree.insert(leaf), 0, "any field element is a legal leaf");
        assertTrue(tree.isKnownRoot(tree.getLastRoot()), "and produces a known root");
    }

    function testFuzz_everyLeafOutsideFieldIsRefused(uint256 raw) public {
        vm.assume(raw >= FIELD_SIZE);
        TreeUnderTest tree = _tree(20);
        vm.expectRevert(
            abi.encodeWithSelector(MerkleTreeWithHistory.NotInField.selector, bytes32(raw))
        );
        tree.insert(bytes32(raw));
    }

    /**
     * Distinct leaves must produce distinct roots. A collision here would let two
     * different sets of notes share a root, which breaks the one thing a Merkle
     * proof is for.
     */
    function testFuzz_distinctLeavesGiveDistinctRoots(uint256 a, uint256 b) public {
        bytes32 first = bytes32(a % FIELD_SIZE);
        bytes32 second = bytes32(b % FIELD_SIZE);
        vm.assume(first != second);

        TreeUnderTest one = _tree(8);
        TreeUnderTest two = _tree(8);
        one.insert(first);
        two.insert(second);
        assertNotEq(one.getLastRoot(), two.getLastRoot(), "different leaf, different root");
    }

    /**
     * Order matters, and it should. Two trees holding the same two leaves in
     * opposite positions are different trees — a proof is a statement about a leaf
     * at an index, not about set membership.
     */
    function testFuzz_insertOrderChangesTheRoot(uint256 a, uint256 b) public {
        bytes32 first = bytes32(a % FIELD_SIZE);
        bytes32 second = bytes32(b % FIELD_SIZE);
        vm.assume(first != second);

        TreeUnderTest forward = _tree(8);
        forward.insert(first);
        forward.insert(second);

        TreeUnderTest backward = _tree(8);
        backward.insert(second);
        backward.insert(first);

        assertNotEq(forward.getLastRoot(), backward.getLastRoot(), "position is part of the claim");
    }
}
