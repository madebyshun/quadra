// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Harness} from "./Harness.sol";
import {MerkleTreeWithHistory} from "../src/MerkleTreeWithHistory.sol";
import {SafeTransfer} from "../src/SafeTransfer.sol";
import {ShieldedPool} from "../src/ShieldedPool.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IHasher} from "../src/interfaces/IHasher.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {TestHasher} from "./doubles/TestHasher.sol";
import {
    AcceptingVerifier,
    ExpectingVerifier,
    RejectingVerifier
} from "./doubles/TestVerifier.sol";
import {
    FeeOnTransferToken,
    GoodToken,
    RevertingToken,
    SurplusToken
} from "./doubles/TestTokens.sol";

/**
 * Everything in `ShieldedPool` that is not the proof itself.
 *
 * ── What these tests can and cannot establish ────────────────────────────────
 * The verifier is a double that returns whatever the test needs, so nothing here
 * says anything about whether the real circuit is sound. That is not a gap in the
 * suite — it is the boundary. The circuit is a separate artifact and is not in this
 * repo (see `IVerifier`).
 *
 * What IS testable, and is where the bugs in a pool like this actually live: the
 * nullifier bookkeeping, the root window, the field bounds, the token accounting,
 * the payout and fee split, the ordering of state writes against external calls,
 * and the exact vector handed to the verifier. Each of those can be wrong while
 * every proof verifies perfectly.
 */
contract ShieldedPoolTest is Harness {
    uint256 private constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint32 private constant LEVELS = 8;

    ShieldedPool internal pool;
    TestHasher internal hasher;
    AcceptingVerifier internal verifier;
    GoodToken internal token;

    address internal constant ALICE = address(0xA11CE);
    address internal constant RELAYER = address(0x3E14E3);

    event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp);
    event NewCommitment(bytes32 indexed commitment, uint32 leafIndex);
    event NewNullifier(bytes32 indexed nullifier);
    event Withdrawal(address indexed recipient, uint256 amount, uint256 fee);

    function setUp() public {
        hasher = new TestHasher();
        verifier = new AcceptingVerifier();
        token = new GoodToken();
        pool = new ShieldedPool(LEVELS, hasher, verifier, IERC20(address(token)));

        token.mint(address(this), 1_000_000e8);
        token.approve(address(pool), type(uint256).max);

        vm.label(ALICE, "alice");
        vm.label(RELAYER, "relayer");
    }

    /* ── fixtures ───────────────────────────────────────────────────────────── */

    function _field(string memory tag, uint256 n) internal pure returns (bytes32) {
        return bytes32(uint256(keccak256(abi.encode(tag, n))) % FIELD_SIZE);
    }

    /**
     * A proof struct that will be accepted, with distinct nullifiers and
     * commitments derived from `seed`. The `proof` bytes are arbitrary because the
     * double ignores them — that is exactly what the double is for.
     */
    function _args(uint256 seed, int256 publicAmount)
        internal
        view
        returns (ShieldedPool.Proof memory)
    {
        return ShieldedPool.Proof({
            root: pool.getLastRoot(),
            inputNullifiers: [_field("nullifier-a", seed), _field("nullifier-b", seed)],
            outputCommitments: [_field("commitment-a", seed), _field("commitment-b", seed)],
            publicAmount: publicAmount,
            proof: hex"c0ffee"
        });
    }

    function _ext(address recipient, uint256 fee)
        internal
        pure
        returns (ShieldedPool.ExtData memory)
    {
        return ShieldedPool.ExtData({recipient: recipient, relayer: RELAYER, fee: fee});
    }

    /** A deposit, so later tests have a funded pool and a non-empty tree. */
    function _deposit(uint256 seed, uint256 amount) internal {
        pool.transact(_args(seed, int256(amount)), _ext(address(0), 0));
    }

    /* ── construction ───────────────────────────────────────────────────────── */

    /**
     * The same rule as `CONTRACTS.shieldedPool` being `null` in
     * `src/config/chain.ts`: a zero address is not an unset value, it is a
     * plausible-looking one that fails later and quietly.
     */
    function test_refusesAZeroVerifier() public {
        vm.expectRevert(ShieldedPool.VerifierNotSet.selector);
        new ShieldedPool(LEVELS, hasher, IVerifier(address(0)), IERC20(address(token)));
    }

    function test_refusesAZeroToken() public {
        vm.expectRevert(ShieldedPool.TokenNotSet.selector);
        new ShieldedPool(LEVELS, hasher, verifier, IERC20(address(0)));
    }

    function test_inheritsTheTreeBoundsIntact() public {
        vm.expectRevert(
            abi.encodeWithSelector(MerkleTreeWithHistory.LevelsOutOfRange.selector, uint32(0))
        );
        new ShieldedPool(0, hasher, verifier, IERC20(address(token)));
    }

    function test_holdsTheAddressesItWasGiven() public view {
        assertEq(address(pool.token()), address(token), "token");
        assertEq(address(pool.verifier()), address(verifier), "verifier");
        assertEq(address(pool.hasher()), address(hasher), "hasher");
        assertEq(pool.levels(), LEVELS, "levels");
    }

    /* ── deposits ───────────────────────────────────────────────────────────── */

    function test_depositPullsExactlyAndGrowsTheTree() public {
        uint256 amount = 500e8;
        bytes32 rootBefore = pool.getLastRoot();

        pool.transact(_args(1, int256(amount)), _ext(address(0), 0));

        assertEq(token.balanceOf(address(pool)), amount, "pool holds the deposit");
        assertEq(token.balanceOf(address(this)), 1_000_000e8 - amount, "depositor paid it");
        assertEq(pool.nextIndex(), 2, "two output commitments were appended");
        assertNotEq(pool.getLastRoot(), rootBefore, "and the root moved");
    }

    /**
     * Two commitments per transaction, always — including a deposit, where one of
     * them is usually an empty change note. A fixed shape is what stops the number
     * of outputs from leaking what kind of transaction this was.
     */
    function test_depositAppendsBothCommitments() public {
        ShieldedPool.Proof memory args = _args(1, 100e8);
        pool.transact(args, _ext(address(0), 0));

        assertEq(pool.nextIndex(), 2, "exactly two leaves");
        assertTrue(pool.isSpent(args.inputNullifiers[0]), "first nullifier burned");
        assertTrue(pool.isSpent(args.inputNullifiers[1]), "second nullifier burned");
    }

    function test_depositEmitsDepositWithTheFirstLeafIndex() public {
        ShieldedPool.Proof memory args = _args(1, 100e8);

        vm.expectEmit(address(pool));
        emit Deposit(args.outputCommitments[0], 0, block.timestamp);

        pool.transact(args, _ext(address(0), 0));
    }

    function test_depositEmitsBothCommitmentsWithTheirIndices() public {
        _deposit(1, 100e8);
        ShieldedPool.Proof memory args = _args(2, 100e8);

        vm.expectEmit(address(pool));
        emit NewCommitment(args.outputCommitments[0], 2);
        vm.expectEmit(address(pool));
        emit NewCommitment(args.outputCommitments[1], 3);

        pool.transact(args, _ext(address(0), 0));
    }

    /* ── withdrawals ────────────────────────────────────────────────────────── */

    function test_withdrawalPaysTheRecipient() public {
        _deposit(1, 1000e8);
        uint256 amount = 400e8;

        pool.transact(_args(2, -int256(amount)), _ext(ALICE, 0));

        assertEq(token.balanceOf(ALICE), amount, "alice received the withdrawal");
        assertEq(token.balanceOf(address(pool)), 600e8, "the pool is down by exactly that");
    }

    function test_withdrawalSplitsTheRelayerFee() public {
        _deposit(1, 1000e8);
        uint256 amount = 400e8;
        uint256 fee = 25e8;

        pool.transact(_args(2, -int256(amount)), _ext(ALICE, fee));

        assertEq(token.balanceOf(ALICE), amount - fee, "recipient gets the net");
        assertEq(token.balanceOf(RELAYER), fee, "relayer gets the fee");
        assertEq(token.balanceOf(address(pool)), 600e8, "total leaving the pool is unchanged");
    }

    function test_withdrawalEmitsTheNetAndTheFeeSeparately() public {
        _deposit(1, 1000e8);

        vm.expectEmit(address(pool));
        emit Withdrawal(ALICE, 375e8, 25e8);

        pool.transact(_args(2, -int256(400e8)), _ext(ALICE, 25e8));
    }

    /** A fee equal to the whole withdrawal is legal; the recipient simply gets zero. */
    function test_aFeeMayConsumeTheEntireWithdrawal() public {
        _deposit(1, 1000e8);
        pool.transact(_args(2, -int256(100e8)), _ext(ALICE, 100e8));

        assertEq(token.balanceOf(ALICE), 0, "nothing left for the recipient");
        assertEq(token.balanceOf(RELAYER), 100e8, "the relayer took all of it");
    }

    function test_refusesAFeeLargerThanTheWithdrawal() public {
        _deposit(1, 1000e8);
        ShieldedPool.Proof memory args = _args(2, -int256(100e8));

        vm.expectRevert(
            abi.encodeWithSelector(
                ShieldedPool.FeeExceedsWithdrawal.selector, 101e8, 100e8
            )
        );
        pool.transact(args, _ext(ALICE, 101e8));
    }

    /**
     * A withdrawal to the zero address is a burn nobody asked for. Refused for the
     * same reason the constructor refuses a zero token: it is a typo that looks like
     * a value.
     */
    function test_refusesAZeroRecipient() public {
        _deposit(1, 1000e8);
        ShieldedPool.Proof memory args = _args(2, -int256(100e8));

        vm.expectRevert(ShieldedPool.RecipientIsZero.selector);
        pool.transact(args, _ext(address(0), 0));
    }

    /* ── the transfer that moves nothing across the boundary ────────────────── */

    /**
     * 🔴 `publicAmount == 0` with no fee is NOT a no-op, and refusing it would be a
     * real bug.
     *
     * It is two notes in, two notes out, nothing crossing the boundary — a merge or
     * a re-split. That is how a wallet consolidates dust, and it is the one move a
     * user has for repairing the amount correlation this pool's shape otherwise
     * leaks. An early version of `transact` rejected it as "nothing to do".
     */
    function test_allowsANoteMergeThatMovesNoMoney() public {
        _deposit(1, 1000e8);
        uint256 poolBefore = token.balanceOf(address(pool));

        ShieldedPool.Proof memory args = _args(2, 0);
        pool.transact(args, _ext(address(0), 0));

        assertEq(token.balanceOf(address(pool)), poolBefore, "no money moved");
        assertEq(pool.nextIndex(), 4, "but two new notes exist");
        assertTrue(pool.isSpent(args.inputNullifiers[0]), "and the old ones are spent");
    }

    function test_aRelayerMayBePaidForAnInternalTransfer() public {
        _deposit(1, 1000e8);

        vm.expectEmit(address(pool));
        emit Withdrawal(RELAYER, 0, 5e8);

        pool.transact(_args(2, 0), _ext(address(0), 5e8));

        assertEq(token.balanceOf(RELAYER), 5e8, "the fee came out of the pool");
        assertEq(token.balanceOf(address(pool)), 995e8, "which is down by exactly the fee");
    }

    /** A relayed deposit: money in, and the relayer paid from the pool's balance. */
    function test_aRelayerMayBePaidOnADeposit() public {
        pool.transact(_args(1, int256(100e8)), _ext(address(0), 3e8));

        assertEq(token.balanceOf(RELAYER), 3e8, "relayer paid");
        assertEq(token.balanceOf(address(pool)), 97e8, "out of the deposit just received");
    }

    /* ── nullifiers ─────────────────────────────────────────────────────────── */

    /**
     * 🔴 The check that is easiest to leave out.
     *
     * Spending one note twice inside a single transaction writes the same `isSpent`
     * slot twice, so a loop consulting only the pre-transaction state sees both as
     * unspent. The circuit proves each input independently, so it has no reason to
     * object either. Without this, a note is worth double.
     */
    function test_refusesTheSameNullifierTwiceInOneTransaction() public {
        _deposit(1, 1000e8);

        ShieldedPool.Proof memory args = _args(2, -int256(100e8));
        args.inputNullifiers[1] = args.inputNullifiers[0];

        vm.expectRevert(
            abi.encodeWithSelector(
                ShieldedPool.DuplicateNullifier.selector, args.inputNullifiers[0]
            )
        );
        pool.transact(args, _ext(ALICE, 0));
    }

    function test_refusesANullifierAlreadySpent() public {
        _deposit(1, 1000e8);

        ShieldedPool.Proof memory first = _args(2, -int256(100e8));
        pool.transact(first, _ext(ALICE, 0));

        ShieldedPool.Proof memory second = _args(3, -int256(100e8));
        second.inputNullifiers[0] = first.inputNullifiers[0];
        second.root = pool.getLastRoot();

        vm.expectRevert(
            abi.encodeWithSelector(
                ShieldedPool.AlreadySpent.selector, first.inputNullifiers[0]
            )
        );
        pool.transact(second, _ext(ALICE, 0));
    }

    function test_refusesASecondNullifierAlreadySpent() public {
        _deposit(1, 1000e8);

        ShieldedPool.Proof memory first = _args(2, -int256(100e8));
        pool.transact(first, _ext(ALICE, 0));

        ShieldedPool.Proof memory second = _args(3, -int256(100e8));
        second.inputNullifiers[1] = first.inputNullifiers[1];
        second.root = pool.getLastRoot();

        vm.expectRevert(
            abi.encodeWithSelector(
                ShieldedPool.AlreadySpent.selector, first.inputNullifiers[1]
            )
        );
        pool.transact(second, _ext(ALICE, 0));
    }

    function test_emitsBothNullifiers() public {
        _deposit(1, 1000e8);
        ShieldedPool.Proof memory args = _args(2, -int256(100e8));

        vm.expectEmit(address(pool));
        emit NewNullifier(args.inputNullifiers[0]);
        vm.expectEmit(address(pool));
        emit NewNullifier(args.inputNullifiers[1]);

        pool.transact(args, _ext(ALICE, 0));
    }

    /* ── roots ──────────────────────────────────────────────────────────────── */

    function test_refusesAnUnknownRoot() public {
        _deposit(1, 1000e8);
        bytes32 fake = _field("not-a-root", 0);
        ShieldedPool.Proof memory args = _args(2, -int256(100e8));
        args.root = fake;

        vm.expectRevert(abi.encodeWithSelector(ShieldedPool.UnknownRoot.selector, fake));
        pool.transact(args, _ext(ALICE, 0));
    }

    /**
     * Root zero is the specific unknown root that matters: unwritten slots in the
     * history buffer read as zero, so a pool that did not reject it explicitly would
     * accept a proof naming it against any young tree.
     */
    function test_refusesRootZero() public {
        _deposit(1, 1000e8);
        ShieldedPool.Proof memory args = _args(2, -int256(100e8));
        args.root = bytes32(0);

        vm.expectRevert(abi.encodeWithSelector(ShieldedPool.UnknownRoot.selector, bytes32(0)));
        pool.transact(args, _ext(ALICE, 0));
    }

    /**
     * A proof built against a root that has since moved must still work. This is the
     * entire reason the history exists — otherwise every withdrawal races every
     * deposit, and on a busy block nobody ever wins.
     */
    function test_acceptsAProofAgainstAStaleButRememberedRoot() public {
        _deposit(1, 1000e8);
        bytes32 staleRoot = pool.getLastRoot();

        ShieldedPool.Proof memory args = _args(2, -int256(100e8));
        args.root = staleRoot;

        // Somebody else deposits in between, moving the root twice.
        _deposit(3, 50e8);
        assertNotEq(pool.getLastRoot(), staleRoot, "the root really did move");

        pool.transact(args, _ext(ALICE, 0));
        assertEq(token.balanceOf(ALICE), 100e8, "the older proof was still honoured");
    }

    /* ── amount bounds ──────────────────────────────────────────────────────── */

    function test_acceptsTheLargestPermittedMagnitude() public view {
        uint256 max = pool.MAX_NOTE_VALUE();
        assertEq(pool.publicAmountFor(int256(max)), max, "the bound itself is allowed");
    }

    function test_refusesAnAmountAboveTheBound() public {
        uint256 tooBig = pool.MAX_NOTE_VALUE() + 1;
        ShieldedPool.Proof memory args = _args(1, int256(tooBig));

        vm.expectRevert(
            abi.encodeWithSelector(ShieldedPool.AmountTooLarge.selector, tooBig)
        );
        pool.transact(args, _ext(address(0), 0));
    }

    /**
     * The bound is symmetric. A withdrawal large enough to wrap the field would be
     * just as exploitable as a deposit, and the sign is chosen by the caller.
     */
    function test_refusesANegativeAmountBelowTheBound() public {
        uint256 tooBig = pool.MAX_NOTE_VALUE() + 1;
        ShieldedPool.Proof memory args = _args(1, -int256(tooBig));

        vm.expectRevert(
            abi.encodeWithSelector(ShieldedPool.AmountTooLarge.selector, tooBig)
        );
        pool.transact(args, _ext(ALICE, 0));
    }

    /**
     * 🔴 An oversized amount must be refused BEFORE any money moves.
     *
     * `publicAmountFor` applies the same bound, but it runs inside `_publicInputs`,
     * which is called after the token pull. If `transact` did not check first, an
     * over-sized deposit would transfer tokens in and then revert — correct only
     * because the revert unwinds it, and fragile the moment any part of this path
     * stops being atomic.
     */
    function test_anOversizedAmountMovesNoMoneyAtAll() public {
        uint256 balanceBefore = token.balanceOf(address(this));
        uint256 tooBig = pool.MAX_NOTE_VALUE() + 1;
        ShieldedPool.Proof memory args = _args(1, int256(tooBig));

        vm.expectRevert(
            abi.encodeWithSelector(ShieldedPool.AmountTooLarge.selector, tooBig)
        );
        pool.transact(args, _ext(address(0), 0));

        assertEq(token.balanceOf(address(this)), balanceBefore, "no tokens left the caller");
        assertEq(token.balanceOf(address(pool)), 0, "and none reached the pool");
        assertEq(pool.nextIndex(), 0, "and the tree did not grow");
    }

    /* ── field encoding of the public amount ────────────────────────────────── */

    function test_encodesAPositiveAmountAsItself() public view {
        assertEq(pool.publicAmountFor(1000), 1000, "a deposit is its own magnitude");
    }

    function test_encodesZeroAsZero() public view {
        assertEq(pool.publicAmountFor(0), 0, "nothing crossing the boundary");
    }

    /**
     * A withdrawal is `FIELD_SIZE - magnitude`, which is what subtraction means
     * inside the field. A client that encodes this differently produces proofs that
     * verify locally and revert on chain, which is why the contract exposes the
     * function rather than documenting the convention.
     */
    function test_encodesANegativeAmountAsAFieldSubtraction() public view {
        assertEq(pool.publicAmountFor(-1000), FIELD_SIZE - 1000, "a withdrawal wraps");
    }

    /**
     * `publicAmountFor` enforces the bound itself, and reaching that revert takes a
     * direct call — `transact` checks first, so its own check shields this one.
     *
     * Not a redundancy worth removing. This function is public precisely so a client
     * can encode an amount before building a proof, and a client asking it to encode
     * an impossible amount should be told so at that point rather than discovering it
     * from a reverted transaction after paying for a proof. It was also the last
     * uncovered branch in the contract, which is how it got noticed: a bound that
     * only the caller-of-last-resort can trip is still a bound somebody trips.
     */
    function test_theEncoderRefusesAnOversizedAmountOnItsOwn() public {
        uint256 tooBig = pool.MAX_NOTE_VALUE() + 1;

        vm.expectRevert(
            abi.encodeWithSelector(ShieldedPool.AmountTooLarge.selector, tooBig)
        );
        pool.publicAmountFor(int256(tooBig));
    }

    function test_theEncoderRefusesAnOversizedWithdrawalOnItsOwn() public {
        uint256 tooBig = pool.MAX_NOTE_VALUE() + 1;

        vm.expectRevert(
            abi.encodeWithSelector(ShieldedPool.AmountTooLarge.selector, tooBig)
        );
        pool.publicAmountFor(-int256(tooBig));
    }

    function test_hashesExtDataIntoTheField() public view {
        uint256 hashed = pool.hashExtData(_ext(ALICE, 25e8));
        assertTrue(hashed < FIELD_SIZE, "the circuit has to be able to hold it");
    }

    /**
     * `extDataHash` is what binds the payout details to the proof. If two different
     * `ExtData` values hashed alike, a relayer could swap the recipient for their own
     * address and the proof would still verify.
     */
    function test_differentPayoutDetailsHashDifferently() public view {
        uint256 toAlice = pool.hashExtData(_ext(ALICE, 0));
        uint256 toRelayer = pool.hashExtData(_ext(RELAYER, 0));
        uint256 withFee = pool.hashExtData(_ext(ALICE, 1));

        assertTrue(toAlice != toRelayer, "recipient is bound");
        assertTrue(toAlice != withFee, "fee is bound");
    }

    /* ── the vector handed to the verifier ──────────────────────────────────── */

    /**
     * 🔴 The contract and the circuit have to agree on the order of the public
     * inputs, and neither side can see a mismatch alone.
     *
     * Checking `pool.publicInputs(...)` against a hand-built vector is not enough —
     * that only proves the public helper agrees with the test, not that `transact`
     * feeds the verifier the same thing. So this builds the vector independently,
     * tells a comparing verifier to expect exactly it, and lets a real `transact`
     * call be the assertion.
     */
    function test_handsTheVerifierTheDocumentedVector() public {
        ExpectingVerifier expecting = new ExpectingVerifier();
        ShieldedPool fresh =
            new ShieldedPool(LEVELS, hasher, expecting, IERC20(address(token)));
        token.approve(address(fresh), type(uint256).max);

        ShieldedPool.ExtData memory ext = _ext(address(0), 0);
        ShieldedPool.Proof memory args = ShieldedPool.Proof({
            root: fresh.getLastRoot(),
            inputNullifiers: [_field("nullifier-a", 7), _field("nullifier-b", 7)],
            outputCommitments: [_field("commitment-a", 7), _field("commitment-b", 7)],
            publicAmount: 100e8,
            proof: hex"c0ffee"
        });

        uint256[7] memory built;
        built[0] = uint256(args.root);
        built[1] = 100e8;
        built[2] = uint256(keccak256(abi.encode(ext))) % FIELD_SIZE;
        built[3] = uint256(args.inputNullifiers[0]);
        built[4] = uint256(args.inputNullifiers[1]);
        built[5] = uint256(args.outputCommitments[0]);
        built[6] = uint256(args.outputCommitments[1]);

        expecting.expect(built, hex"c0ffee");
        fresh.transact(args, ext);

        assertEq(fresh.nextIndex(), 2, "the transaction went through, so the vector matched");
    }

    function test_thePublicHelperAgreesWithTheSameVector() public view {
        ShieldedPool.ExtData memory ext = _ext(ALICE, 25e8);
        ShieldedPool.Proof memory args = _args(9, -int256(100e8));

        uint256[7] memory got = pool.publicInputs(args, ext);
        assertEq(got[0], uint256(args.root), "root");
        assertEq(got[1], FIELD_SIZE - 100e8, "publicAmount, field-encoded");
        assertEq(got[2], pool.hashExtData(ext), "extDataHash");
        assertEq(got[3], uint256(args.inputNullifiers[0]), "nullifier 0");
        assertEq(got[4], uint256(args.inputNullifiers[1]), "nullifier 1");
        assertEq(got[5], uint256(args.outputCommitments[0]), "commitment 0");
        assertEq(got[6], uint256(args.outputCommitments[1]), "commitment 1");
    }

    /* ── a rejected proof ───────────────────────────────────────────────────── */

    /**
     * A failed verification must leave nothing behind: no nullifier marked spent, no
     * commitment appended, no root advanced, no tokens moved. The revert does that
     * here, and asserting it is what would catch a future refactor that split
     * `transact` across two transactions or added a `try`.
     */
    function test_aRejectedProofChangesNothing() public {
        RejectingVerifier rejecting = new RejectingVerifier();
        ShieldedPool fresh =
            new ShieldedPool(LEVELS, hasher, rejecting, IERC20(address(token)));
        token.approve(address(fresh), type(uint256).max);

        bytes32 rootBefore = fresh.getLastRoot();
        uint256 callerBefore = token.balanceOf(address(this));

        ShieldedPool.Proof memory args = ShieldedPool.Proof({
            root: rootBefore,
            inputNullifiers: [_field("nullifier-a", 5), _field("nullifier-b", 5)],
            outputCommitments: [_field("commitment-a", 5), _field("commitment-b", 5)],
            publicAmount: 100e8,
            proof: hex"00"
        });

        vm.expectRevert(ShieldedPool.InvalidProof.selector);
        fresh.transact(args, _ext(address(0), 0));

        assertEq(fresh.getLastRoot(), rootBefore, "root unchanged");
        assertEq(fresh.nextIndex(), 0, "tree unchanged");
        assertFalse(fresh.isSpent(args.inputNullifiers[0]), "no nullifier burned");
        assertEq(token.balanceOf(address(fresh)), 0, "no tokens held");
        assertEq(token.balanceOf(address(this)), callerBefore, "caller paid nothing");
    }

    /* ── tokens that do not deliver ─────────────────────────────────────────── */

    /**
     * 🔴 A fee-on-transfer token must be refused, not accommodated.
     *
     * The note records the amount that was proven. A token delivering less makes
     * that number a fiction the moment it is written, and the shortfall does not land
     * on the depositor — it lands on whoever withdraws last, who did nothing wrong
     * and cannot tell what happened.
     */
    function test_refusesATokenThatTakesACut() public {
        FeeOnTransferToken lossy = new FeeOnTransferToken();
        ShieldedPool fresh =
            new ShieldedPool(LEVELS, hasher, verifier, IERC20(address(lossy)));
        lossy.mint(address(this), 1000e8);
        lossy.approve(address(fresh), type(uint256).max);

        ShieldedPool.Proof memory args = ShieldedPool.Proof({
            root: fresh.getLastRoot(),
            inputNullifiers: [_field("nullifier-a", 4), _field("nullifier-b", 4)],
            outputCommitments: [_field("commitment-a", 4), _field("commitment-b", 4)],
            publicAmount: 100e8,
            proof: hex"01"
        });

        // 1% of 100e8 is 1e8, so 99e8 arrives.
        vm.expectRevert(
            abi.encodeWithSelector(
                ShieldedPool.TokenDidNotDeliver.selector, 100e8, 99e8
            )
        );
        fresh.transact(args, _ext(address(0), 0));
    }

    /**
     * And a token that delivers MORE is refused too, which is the half people leave
     * out. A surplus belongs to nobody: the note still records the requested amount,
     * so the extra accumulates as an unaccounted balance that every later solvency
     * argument has to special-case. The check is `!=`, not `<`.
     */
    function test_refusesATokenThatDeliversASurplus() public {
        SurplusToken generous = new SurplusToken();
        ShieldedPool fresh =
            new ShieldedPool(LEVELS, hasher, verifier, IERC20(address(generous)));
        generous.mint(address(this), 1000e8);
        generous.approve(address(fresh), type(uint256).max);

        ShieldedPool.Proof memory args = ShieldedPool.Proof({
            root: fresh.getLastRoot(),
            inputNullifiers: [_field("nullifier-a", 6), _field("nullifier-b", 6)],
            outputCommitments: [_field("commitment-a", 6), _field("commitment-b", 6)],
            publicAmount: 100e8,
            proof: hex"02"
        });

        vm.expectRevert(
            abi.encodeWithSelector(
                ShieldedPool.TokenDidNotDeliver.selector, 100e8, 100e8 + 1
            )
        );
        fresh.transact(args, _ext(address(0), 0));
    }

    /**
     * 🔴 The ordering guarantee, stated as a test.
     *
     * `transact` pulls before it proves, precisely so that a token transfer which
     * reverts has spent no nullifiers and grown no tree. This asserts the property
     * the ordering buys — that a failed pull is indistinguishable from never having
     * been attempted.
     */
    function test_aFailedPullBurnsNoNullifiers() public {
        RevertingToken broken = new RevertingToken();
        ShieldedPool fresh =
            new ShieldedPool(LEVELS, hasher, verifier, IERC20(address(broken)));
        broken.mint(address(this), 1000e8);

        ShieldedPool.Proof memory args = ShieldedPool.Proof({
            root: fresh.getLastRoot(),
            inputNullifiers: [_field("nullifier-a", 8), _field("nullifier-b", 8)],
            outputCommitments: [_field("commitment-a", 8), _field("commitment-b", 8)],
            publicAmount: 100e8,
            proof: hex"03"
        });

        vm.expectRevert(
            abi.encodeWithSelector(
                SafeTransfer.TransferFromFailed.selector, address(broken), address(this), 100e8
            )
        );
        fresh.transact(args, _ext(address(0), 0));

        assertFalse(fresh.isSpent(args.inputNullifiers[0]), "nullifier still unspent");
        assertEq(fresh.nextIndex(), 0, "tree did not grow");
    }

    /**
     * A withdrawal larger than the pool holds fails on the token transfer rather
     * than on an accounting check. The contract has no view of how much the notes
     * are collectively worth — that is the circuit's job — so the token is the
     * backstop, and it has to be a loud one.
     */
    function test_anUnderfundedWithdrawalFailsLoudly() public {
        _deposit(1, 100e8);
        ShieldedPool.Proof memory args = _args(2, -int256(500e8));

        vm.expectRevert();
        pool.transact(args, _ext(ALICE, 0));

        assertEq(token.balanceOf(ALICE), 0, "alice received nothing");
        assertEq(token.balanceOf(address(pool)), 100e8, "the pool is intact");
    }

    /* ── capacity ───────────────────────────────────────────────────────────── */

    /**
     * Two leaves per transaction means capacity runs out twice as fast as the leaf
     * count suggests. A 2-level tree holds four leaves, so it takes exactly two
     * transactions.
     */
    function test_fillsTwoLeavesAtATimeAndThenRefuses() public {
        ShieldedPool small = new ShieldedPool(2, hasher, verifier, IERC20(address(token)));
        token.approve(address(small), type(uint256).max);

        for (uint256 i = 0; i < 2; i++) {
            small.transact(
                ShieldedPool.Proof({
                    root: small.getLastRoot(),
                    inputNullifiers: [_field("na", i), _field("nb", i)],
                    outputCommitments: [_field("ca", i), _field("cb", i)],
                    publicAmount: 1e8,
                    proof: hex"04"
                }),
                _ext(address(0), 0)
            );
        }
        assertEq(small.remainingCapacity(), 0, "four leaves, two transactions");

        ShieldedPool.Proof memory args = ShieldedPool.Proof({
            root: small.getLastRoot(),
            inputNullifiers: [_field("na", 99), _field("nb", 99)],
            outputCommitments: [_field("ca", 99), _field("cb", 99)],
            publicAmount: 1e8,
            proof: hex"04"
        });

        vm.expectRevert(MerkleTreeWithHistory.TreeIsFull.selector);
        small.transact(args, _ext(address(0), 0));
    }

    /* ── fuzz ───────────────────────────────────────────────────────────────── */

    /**
     * Whatever the amount, the pool's balance moves by exactly it and the tree grows
     * by exactly two. This is the conservation property the accounting rests on.
     */
    function testFuzz_depositConservesTheAmountExactly(uint96 raw) public {
        uint256 amount = uint256(raw);
        vm.assume(amount <= 1_000_000e8);

        pool.transact(_args(1, int256(amount)), _ext(address(0), 0));

        assertEq(token.balanceOf(address(pool)), amount, "pool up by the amount");
        assertEq(token.balanceOf(address(this)), 1_000_000e8 - amount, "caller down by it");
        assertEq(pool.nextIndex(), 2, "two leaves regardless of amount");
    }

    /**
     * The fee split never creates or destroys tokens, whatever the split is. An
     * off-by-one here would be a slow leak rather than a visible failure.
     */
    function testFuzz_theFeeSplitConservesTheWithdrawal(uint96 rawAmount, uint96 rawFee)
        public
    {
        uint256 amount = uint256(rawAmount) % 1000e8 + 1;
        uint256 fee = uint256(rawFee) % (amount + 1);

        _deposit(1, 1000e8);
        pool.transact(_args(2, -int256(amount)), _ext(ALICE, fee));

        assertEq(token.balanceOf(ALICE) + token.balanceOf(RELAYER), amount, "nothing vanished");
        assertEq(token.balanceOf(RELAYER), fee, "the relayer got exactly the fee");
        assertEq(token.balanceOf(address(pool)), 1000e8 - amount, "the pool paid exactly once");
    }

    /**
     * Every legal magnitude round-trips through the field encoding, in both
     * directions. This is the function a client has to reimplement, so it is the one
     * most worth fuzzing.
     */
    function testFuzz_fieldEncodingRoundTrips(uint256 raw) public view {
        uint256 magnitude = raw % (pool.MAX_NOTE_VALUE() + 1);

        assertEq(pool.publicAmountFor(int256(magnitude)), magnitude, "deposits are identity");

        uint256 encoded = pool.publicAmountFor(-int256(magnitude));
        if (magnitude == 0) {
            assertEq(encoded, 0, "zero has no sign");
        } else {
            assertEq(encoded, FIELD_SIZE - magnitude, "withdrawals wrap");
            assertTrue(encoded < FIELD_SIZE, "and stay in the field");
        }
    }

    function testFuzz_extDataHashAlwaysLandsInTheField(
        address recipient,
        address relayer,
        uint256 fee
    ) public view {
        uint256 hashed = pool.hashExtData(
            ShieldedPool.ExtData({recipient: recipient, relayer: relayer, fee: fee})
        );
        assertTrue(hashed < FIELD_SIZE, "always a field element");
    }

    /** Any amount past the bound is refused, not just the one above it. */
    function testFuzz_refusesEveryOversizedAmount(uint256 raw) public {
        uint256 max = pool.MAX_NOTE_VALUE();
        vm.assume(raw > max && raw <= uint256(type(int256).max));
        ShieldedPool.Proof memory args = _args(1, int256(raw));

        vm.expectRevert(abi.encodeWithSelector(ShieldedPool.AmountTooLarge.selector, raw));
        pool.transact(args, _ext(address(0), 0));
    }
}
