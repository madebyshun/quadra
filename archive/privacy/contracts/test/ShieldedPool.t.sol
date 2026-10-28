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
 * the relationship between what moves and what is proven, the ordering of state
 * writes against external calls, and the exact vector handed to the verifier. Each
 * of those can be wrong while every proof verifies perfectly.
 *
 * ── The section worth reading first ──────────────────────────────────────────
 * "what moves must equal what was proven" is not a section of ordinary accounting
 * tests. It is the regression suite for a real insolvency this contract had, in
 * which the fee was charged against the payout on a withdrawal and against the
 * pool on a deposit. Every test there fails against the previous implementation.
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
    event Withdrawal(address indexed recipient, uint256 amount);
    event FeePaid(address indexed relayer, uint256 fee);

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
     *
     * It carries no amount. That used to be a `publicAmount` field here, and moving
     * it into `ExtData` is the fix these tests exist to pin: the number the circuit
     * proves over is now derived from what actually moves, so no calldata can state
     * one value while the transfers imply another.
     *
     * ⚠️ This makes an external call (`pool.getLastRoot`), so it must be hoisted
     * ABOVE any `vm.expectRevert()` — otherwise the root read is the "next call" the
     * cheatcode is waiting on, and every such test fails with "next call did not
     * revert as expected" while pointing at the line that does revert. Eleven tests
     * failed this way at once when the fixture stopped taking an amount and the calls
     * became short enough to inline. `_ext`, `_in` and `_out` are `pure` and safe to
     * inline anywhere.
     */
    function _args(uint256 seed) internal view returns (ShieldedPool.Proof memory) {
        return ShieldedPool.Proof({
            root: pool.getLastRoot(),
            inputNullifiers: [_field("nullifier-a", seed), _field("nullifier-b", seed)],
            outputCommitments: [_field("commitment-a", seed), _field("commitment-b", seed)],
            proof: hex"c0ffee"
        });
    }

    function _ext(address recipient, int256 extAmount, uint256 fee)
        internal
        pure
        returns (ShieldedPool.ExtData memory)
    {
        return ShieldedPool.ExtData({
            recipient: recipient,
            relayer: RELAYER,
            extAmount: extAmount,
            fee: fee
        });
    }

    /** Money in, no payout details to fill, no relayer. */
    function _in(uint256 amount) internal pure returns (ShieldedPool.ExtData memory) {
        return _ext(address(0), int256(amount), 0);
    }

    /** Money out, to a named recipient. */
    function _out(address recipient, uint256 amount)
        internal
        pure
        returns (ShieldedPool.ExtData memory)
    {
        return _ext(recipient, -int256(amount), 0);
    }

    /** A deposit, so later tests have a funded pool and a non-empty tree. */
    function _deposit(uint256 seed, uint256 amount) internal {
        pool.transact(_args(seed), _in(amount));
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

        pool.transact(_args(1), _in(amount));

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
        ShieldedPool.Proof memory args = _args(1);
        pool.transact(args, _in(100e8));

        assertEq(pool.nextIndex(), 2, "exactly two leaves");
        assertTrue(pool.isSpent(args.inputNullifiers[0]), "first nullifier burned");
        assertTrue(pool.isSpent(args.inputNullifiers[1]), "second nullifier burned");
    }

    function test_depositEmitsDepositWithTheFirstLeafIndex() public {
        ShieldedPool.Proof memory args = _args(1);

        vm.expectEmit(address(pool));
        emit Deposit(args.outputCommitments[0], 0, block.timestamp);

        pool.transact(args, _in(100e8));
    }

    function test_depositEmitsBothCommitmentsWithTheirIndices() public {
        _deposit(1, 100e8);
        ShieldedPool.Proof memory args = _args(2);

        vm.expectEmit(address(pool));
        emit NewCommitment(args.outputCommitments[0], 2);
        vm.expectEmit(address(pool));
        emit NewCommitment(args.outputCommitments[1], 3);

        pool.transact(args, _in(100e8));
    }

    /* ── withdrawals ────────────────────────────────────────────────────────── */

    function test_withdrawalPaysTheRecipient() public {
        _deposit(1, 1000e8);
        uint256 amount = 400e8;

        pool.transact(_args(2), _out(ALICE, amount));

        assertEq(token.balanceOf(ALICE), amount, "alice received the withdrawal");
        assertEq(token.balanceOf(address(pool)), 600e8, "the pool is down by exactly that");
    }

    /**
     * 🔴 The recipient gets what the recipient was promised, and the fee is on top.
     *
     * This test asserted the opposite until the fee asymmetry was fixed: the payout
     * used to be `extAmount - fee`, so a user withdrawing 400 with a 25 fee received
     * 375. Two things were wrong with that. The visible one is that a user could not
     * name the amount they wanted to receive without first knowing what the relayer
     * would charge. The expensive one is in the next section.
     */
    function test_aWithdrawalPaysTheRecipientInFullAndTheRelayerOnTop() public {
        _deposit(1, 1000e8);

        pool.transact(_args(2), _ext(ALICE, -int256(400e8), 25e8));

        assertEq(token.balanceOf(ALICE), 400e8, "recipient gets what was asked for");
        assertEq(token.balanceOf(RELAYER), 25e8, "relayer gets the fee");
        assertEq(token.balanceOf(address(pool)), 575e8, "and the pool paid both");
    }

    /**
     * Two events, and each fires only when its own transfer happens.
     *
     * The single `Withdrawal(recipient, amount, fee)` this replaced was emitted with
     * `recipient` set to the relayer and `amount` set to zero for a fee-only
     * transaction, so the indexed field sometimes named the payee and sometimes named
     * the relayer — unfilterable, and unreadable without first knowing which case you
     * were in.
     */
    function test_aWithdrawalWithAFeeEmitsBothEventsSeparately() public {
        _deposit(1, 1000e8);

        vm.expectEmit(address(pool));
        emit Withdrawal(ALICE, 400e8);
        vm.expectEmit(address(pool));
        emit FeePaid(RELAYER, 25e8);

        pool.transact(_args(2), _ext(ALICE, -int256(400e8), 25e8));
    }

    function test_aWithdrawalWithoutAFeeEmitsOnlyTheWithdrawal() public {
        _deposit(1, 1000e8);

        vm.expectEmit(address(pool));
        emit Withdrawal(ALICE, 400e8);

        pool.transact(_args(2), _out(ALICE, 400e8));
    }

    /**
     * A fee larger than the withdrawal is legal now, and `FeeExceedsWithdrawal` is
     * gone.
     *
     * Not a loosening. That error existed because the fee was carved out of the
     * payout, so a fee above it would have underflowed — it was a guard on an
     * implementation detail, not a rule about money. With the two paid
     * independently, `extAmount` and `fee` are simply two amounts leaving the pool,
     * and their sum is what `publicAmount` says left. A user who asks to receive 10
     * and agrees to pay a relayer 50 has made a bad deal, not an invalid one, and
     * the circuit is what refuses it if their notes cannot cover 60.
     */
    function test_allowsAFeeLargerThanTheWithdrawal() public {
        _deposit(1, 1000e8);

        pool.transact(_args(2), _ext(ALICE, -int256(10e8), 50e8));

        assertEq(token.balanceOf(ALICE), 10e8, "the recipient got what they asked for");
        assertEq(token.balanceOf(RELAYER), 50e8, "and the relayer its fee");
        assertEq(token.balanceOf(address(pool)), 940e8, "the pool is down by the sum");
    }

    /**
     * A withdrawal to the zero address is a burn nobody asked for. Refused for the
     * same reason the constructor refuses a zero token: it is a typo that looks like
     * a value.
     */
    function test_refusesAZeroRecipient() public {
        _deposit(1, 1000e8);
        ShieldedPool.Proof memory args = _args(2);

        vm.expectRevert(ShieldedPool.RecipientIsZero.selector);
        pool.transact(args, _out(address(0), 100e8));
    }

    /**
     * And a zero relayer, for a reason that is not symmetry.
     *
     * The pool has already accounted the fee as having left — `publicAmount` includes
     * it and the circuit proved the notes cover it. Sending it to the burn address
     * would leave the remaining notes backed by tokens nobody can move, which is the
     * same shortfall `_pullExactly` refuses a lossy token to avoid.
     */
    function test_refusesAZeroRelayerWhenAFeeIsCharged() public {
        _deposit(1, 1000e8);
        ShieldedPool.Proof memory args = _args(2);

        ShieldedPool.ExtData memory ext = ShieldedPool.ExtData({
            recipient: ALICE,
            relayer: address(0),
            extAmount: -int256(100e8),
            fee: 5e8
        });

        vm.expectRevert(ShieldedPool.RelayerIsZero.selector);
        pool.transact(args, ext);
    }

    /** With no fee there is nothing to send, so a zero relayer is merely unused. */
    function test_allowsAZeroRelayerWhenNoFeeIsCharged() public {
        _deposit(1, 1000e8);

        ShieldedPool.ExtData memory ext = ShieldedPool.ExtData({
            recipient: ALICE,
            relayer: address(0),
            extAmount: -int256(100e8),
            fee: 0
        });

        pool.transact(_args(2), ext);
        assertEq(token.balanceOf(ALICE), 100e8, "the withdrawal went through");
    }

    /* ── the transfer that moves nothing across the boundary ────────────────── */

    /**
     * 🔴 `extAmount == 0` with no fee is NOT a no-op, and refusing it would be a
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

        ShieldedPool.Proof memory args = _args(2);
        pool.transact(args, _ext(address(0), 0, 0));

        assertEq(token.balanceOf(address(pool)), poolBefore, "no money moved");
        assertEq(pool.nextIndex(), 4, "but two new notes exist");
        assertTrue(pool.isSpent(args.inputNullifiers[0]), "and the old ones are spent");
    }

    function test_aRelayerMayBePaidForAnInternalTransfer() public {
        _deposit(1, 1000e8);

        vm.expectEmit(address(pool));
        emit FeePaid(RELAYER, 5e8);

        pool.transact(_args(2), _ext(address(0), 0, 5e8));

        assertEq(token.balanceOf(RELAYER), 5e8, "the fee came out of the pool");
        assertEq(token.balanceOf(address(pool)), 995e8, "which is down by exactly the fee");
    }

    /** A relayed deposit: money in, and the relayer paid out of what just arrived. */
    function test_aRelayerMayBePaidOnADeposit() public {
        pool.transact(_args(1), _ext(address(0), int256(100e8), 3e8));

        assertEq(token.balanceOf(RELAYER), 3e8, "relayer paid");
        assertEq(token.balanceOf(address(pool)), 97e8, "out of the deposit just received");
    }

    /* ── what moves must equal what was proven ──────────────────────────────── */

    /**
     * 🔴 The regression suite for a real insolvency. Every test in this section
     * fails against the implementation that came before it.
     *
     * The old contract took `publicAmount` as a calldata field and then paid the fee
     * out of the payout on a withdrawal but on top of it on a deposit or an internal
     * transfer. So the conservation law it enforced was
     * `sum(inputs) + publicAmount - (publicAmount < 0 ? 0 : fee) == sum(outputs)` —
     * a different equation depending on the sign of one of its own terms — while
     * `IVerifier` documented, and any sane circuit would implement, the
     * unconditional `sum(inputs) + publicAmount == sum(outputs)`.
     *
     * Built against that spec, a relayed deposit of 100 with a fee of 3 created notes
     * worth 100 while the pool kept 97: the fee was silently taken from other
     * depositors. A relayed internal transfer was worse — `publicAmount` was 0, so
     * the notes proved nothing left, and the fee left anyway, repeatably. Nothing
     * reverts in either case. The shortfall lands on whoever withdraws last, who did
     * nothing wrong and cannot tell what happened, which is exactly the failure
     * `_pullExactly` exists to prevent, arriving through the other door.
     *
     * The property that catches all of it is one sentence: **the pool's token balance
     * changes by exactly `publicAmount`.** Stated that way it needs no cases, which
     * is the point — a law with a case analysis in it is a law with somewhere for a
     * bug to live.
     */
    function _assertBalanceMovedBy(uint256 before, int256 publicAmount, string memory what)
        internal
        view
    {
        uint256 now_ = token.balanceOf(address(pool));
        if (publicAmount >= 0) {
            assertEq(now_, before + uint256(publicAmount), what);
        } else {
            assertEq(now_, before - uint256(-publicAmount), what);
        }
    }

    function test_aRelayedDepositLeavesTheProvenAmountBehind() public {
        ShieldedPool.ExtData memory ext = _ext(address(0), int256(100e8), 3e8);
        int256 publicAmount = pool.publicAmountFor(ext);
        assertEqInt(publicAmount, 97e8, "97 is what the notes are allowed to claim");

        pool.transact(_args(1), ext);

        _assertBalanceMovedBy(0, publicAmount, "the pool holds exactly what was proven");
    }

    /**
     * The one that was a free withdrawal. `publicAmount` used to be 0 here while 5e8
     * left the building.
     */
    function test_aRelayedInternalTransferProvesTheFeeItPays() public {
        _deposit(1, 1000e8);
        uint256 before = token.balanceOf(address(pool));

        ShieldedPool.ExtData memory ext = _ext(address(0), 0, 5e8);
        int256 publicAmount = pool.publicAmountFor(ext);
        assertEqInt(publicAmount, -int256(5e8), "the fee is a withdrawal, and is proven as one");

        pool.transact(_args(2), ext);

        _assertBalanceMovedBy(before, publicAmount, "down by exactly the proven amount");
    }

    function test_aRelayedWithdrawalProvesTheSumOfBothPayments() public {
        _deposit(1, 1000e8);
        uint256 before = token.balanceOf(address(pool));

        ShieldedPool.ExtData memory ext = _ext(ALICE, -int256(75e8), 25e8);
        int256 publicAmount = pool.publicAmountFor(ext);
        assertEqInt(publicAmount, -int256(100e8), "recipient plus relayer");

        pool.transact(_args(2), ext);

        assertEq(token.balanceOf(ALICE), 75e8, "recipient side of the boundary");
        assertEq(token.balanceOf(RELAYER), 25e8, "relayer side");
        _assertBalanceMovedBy(before, publicAmount, "and the pool paid the sum, once");
    }

    /**
     * The same law over every combination of direction and fee, which is the form
     * that would have caught the bug without anyone having to think of the internal
     * transfer as a special case.
     */
    function testFuzz_theBalanceAlwaysMovesByExactlyPublicAmount(
        int64 rawAmount,
        uint64 rawFee
    ) public {
        int256 extAmount = int256(rawAmount) % 500e8;
        uint256 fee = uint256(rawFee) % 100e8;
        // a payout needs somewhere to go; a deposit or a merge does not
        address recipient = extAmount < 0 ? ALICE : address(0);

        _deposit(1, 1000e8);
        uint256 before = token.balanceOf(address(pool));

        ShieldedPool.ExtData memory ext = _ext(recipient, extAmount, fee);
        int256 publicAmount = pool.publicAmountFor(ext);

        pool.transact(_args(2), ext);

        _assertBalanceMovedBy(before, publicAmount, "conserved, whatever the shape");
    }

    /**
     * And the arithmetic on its own, so a failure tells you whether the derivation or
     * the transfers are at fault. `% 2` keeps `extAmount` and `fee` well inside the
     * bound so this exercises the subtraction and not the guards around it.
     */
    function testFuzz_publicAmountIsExtAmountMinusFee(int128 rawAmount, uint128 rawFee)
        public
        view
    {
        int256 extAmount = int256(rawAmount) / 2;
        uint256 fee = uint256(rawFee) / 2;
        vm.assume(uint256(extAmount < 0 ? -extAmount : extAmount) <= pool.MAX_NOTE_VALUE());
        vm.assume(fee <= pool.MAX_NOTE_VALUE());

        assertEqInt(
            pool.publicAmountFor(_ext(ALICE, extAmount, fee)),
            extAmount - int256(fee),
            "one subtraction, no cases"
        );
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

        ShieldedPool.Proof memory args = _args(2);
        args.inputNullifiers[1] = args.inputNullifiers[0];

        vm.expectRevert(
            abi.encodeWithSelector(
                ShieldedPool.DuplicateNullifier.selector, args.inputNullifiers[0]
            )
        );
        pool.transact(args, _out(ALICE, 100e8));
    }

    function test_refusesANullifierAlreadySpent() public {
        _deposit(1, 1000e8);

        ShieldedPool.Proof memory first = _args(2);
        pool.transact(first, _out(ALICE, 100e8));

        ShieldedPool.Proof memory second = _args(3);
        second.inputNullifiers[0] = first.inputNullifiers[0];
        second.root = pool.getLastRoot();

        vm.expectRevert(
            abi.encodeWithSelector(
                ShieldedPool.AlreadySpent.selector, first.inputNullifiers[0]
            )
        );
        pool.transact(second, _out(ALICE, 100e8));
    }

    function test_refusesASecondNullifierAlreadySpent() public {
        _deposit(1, 1000e8);

        ShieldedPool.Proof memory first = _args(2);
        pool.transact(first, _out(ALICE, 100e8));

        ShieldedPool.Proof memory second = _args(3);
        second.inputNullifiers[1] = first.inputNullifiers[1];
        second.root = pool.getLastRoot();

        vm.expectRevert(
            abi.encodeWithSelector(
                ShieldedPool.AlreadySpent.selector, first.inputNullifiers[1]
            )
        );
        pool.transact(second, _out(ALICE, 100e8));
    }

    function test_emitsBothNullifiers() public {
        _deposit(1, 1000e8);
        ShieldedPool.Proof memory args = _args(2);

        vm.expectEmit(address(pool));
        emit NewNullifier(args.inputNullifiers[0]);
        vm.expectEmit(address(pool));
        emit NewNullifier(args.inputNullifiers[1]);

        pool.transact(args, _out(ALICE, 100e8));
    }

    /* ── roots ──────────────────────────────────────────────────────────────── */

    function test_refusesAnUnknownRoot() public {
        _deposit(1, 1000e8);
        bytes32 fake = _field("not-a-root", 0);
        ShieldedPool.Proof memory args = _args(2);
        args.root = fake;

        vm.expectRevert(abi.encodeWithSelector(ShieldedPool.UnknownRoot.selector, fake));
        pool.transact(args, _out(ALICE, 100e8));
    }

    /**
     * Root zero is the specific unknown root that matters: unwritten slots in the
     * history buffer read as zero, so a pool that did not reject it explicitly would
     * accept a proof naming it against any young tree.
     */
    function test_refusesRootZero() public {
        _deposit(1, 1000e8);
        ShieldedPool.Proof memory args = _args(2);
        args.root = bytes32(0);

        vm.expectRevert(abi.encodeWithSelector(ShieldedPool.UnknownRoot.selector, bytes32(0)));
        pool.transact(args, _out(ALICE, 100e8));
    }

    /**
     * A proof built against a root that has since moved must still work. This is the
     * entire reason the history exists — otherwise every withdrawal races every
     * deposit, and on a busy block nobody ever wins.
     */
    function test_acceptsAProofAgainstAStaleButRememberedRoot() public {
        _deposit(1, 1000e8);
        bytes32 staleRoot = pool.getLastRoot();

        ShieldedPool.Proof memory args = _args(2);
        args.root = staleRoot;

        // Somebody else deposits in between, moving the root twice.
        _deposit(3, 50e8);
        assertNotEq(pool.getLastRoot(), staleRoot, "the root really did move");

        pool.transact(args, _out(ALICE, 100e8));
        assertEq(token.balanceOf(ALICE), 100e8, "the older proof was still honoured");
    }

    /* ── amount bounds ──────────────────────────────────────────────────────── */

    function test_acceptsTheLargestPermittedMagnitude() public view {
        uint256 max = pool.MAX_NOTE_VALUE();
        assertEq(pool.fieldEncode(int256(max)), max, "the bound itself is allowed");
    }

    function test_refusesAnAmountAboveTheBound() public {
        uint256 tooBig = pool.MAX_NOTE_VALUE() + 1;
        ShieldedPool.Proof memory args = _args(1);

        vm.expectRevert(
            abi.encodeWithSelector(ShieldedPool.AmountTooLarge.selector, tooBig)
        );
        pool.transact(args, _in(tooBig));
    }

    /**
     * The bound is symmetric. A withdrawal large enough to wrap the field would be
     * just as exploitable as a deposit, and the sign is chosen by the caller.
     */
    function test_refusesANegativeAmountBelowTheBound() public {
        uint256 tooBig = pool.MAX_NOTE_VALUE() + 1;
        ShieldedPool.Proof memory args = _args(1);

        vm.expectRevert(
            abi.encodeWithSelector(ShieldedPool.AmountTooLarge.selector, tooBig)
        );
        pool.transact(args, _out(ALICE, tooBig));
    }

    /**
     * The fee is bounded too, and separately.
     *
     * Easy to leave out, because a fee is "small" in every case anyone pictures. It
     * is a caller-supplied `uint256` that gets subtracted from a signed value, so
     * without its own check an absurd one would be the way to drive `publicAmount`
     * somewhere the field cannot represent.
     */
    function test_refusesAFeeAboveTheBound() public {
        uint256 tooBig = pool.MAX_NOTE_VALUE() + 1;
        ShieldedPool.Proof memory args = _args(1);

        vm.expectRevert(
            abi.encodeWithSelector(ShieldedPool.AmountTooLarge.selector, tooBig)
        );
        pool.transact(args, _ext(ALICE, 0, tooBig));
    }

    /**
     * 🔴 Both parts within the bound does not make their difference so, and this is
     * the one path where `fieldEncode`'s own check is the only thing standing there.
     *
     * `publicAmountFor` bounds `extAmount` and `fee` individually, so a withdrawal at
     * the ceiling with a fee at the ceiling derives `-2·MAX_NOTE_VALUE` — twice the
     * largest value the circuit can hold, from two inputs that each passed. The
     * alternative design gives `extAmount` and `fee` half the bound each so their sum
     * always fits; that is one more constant for the circuit to agree with, in
     * exchange for forbidding nothing anyone will ever do.
     */
    function test_refusesADerivedAmountAboveTheBoundEvenWhenBothPartsFit() public {
        uint256 max = pool.MAX_NOTE_VALUE();
        ShieldedPool.Proof memory args = _args(1);

        vm.expectRevert(
            abi.encodeWithSelector(ShieldedPool.AmountTooLarge.selector, 2 * max)
        );
        pool.transact(args, _ext(ALICE, -int256(max), max));
    }

    /**
     * 🔴 An oversized amount must be refused BEFORE any money moves.
     *
     * `publicAmountFor` and `fieldEncode` are both reached again from inside
     * `_publicInputs`, which runs after the token pull. If `transact` did not check
     * first, an over-sized deposit would transfer tokens in and then revert — correct
     * only because the revert unwinds it, and fragile the moment any part of this
     * path stops being atomic.
     */
    function test_anOversizedAmountMovesNoMoneyAtAll() public {
        uint256 balanceBefore = token.balanceOf(address(this));
        uint256 tooBig = pool.MAX_NOTE_VALUE() + 1;
        ShieldedPool.Proof memory args = _args(1);

        vm.expectRevert(
            abi.encodeWithSelector(ShieldedPool.AmountTooLarge.selector, tooBig)
        );
        pool.transact(args, _in(tooBig));

        assertEq(token.balanceOf(address(this)), balanceBefore, "no tokens left the caller");
        assertEq(token.balanceOf(address(pool)), 0, "and none reached the pool");
        assertEq(pool.nextIndex(), 0, "and the tree did not grow");
    }

    /* ── field encoding of the public amount ────────────────────────────────── */

    function test_encodesAPositiveAmountAsItself() public view {
        assertEq(pool.fieldEncode(1000), 1000, "a deposit is its own magnitude");
    }

    function test_encodesZeroAsZero() public view {
        assertEq(pool.fieldEncode(0), 0, "nothing crossing the boundary");
    }

    /**
     * A withdrawal is `FIELD_SIZE - magnitude`, which is what subtraction means
     * inside the field. A client that encodes this differently produces proofs that
     * verify locally and revert on chain, which is why the contract exposes the
     * function rather than documenting the convention.
     */
    function test_encodesANegativeAmountAsAFieldSubtraction() public view {
        assertEq(pool.fieldEncode(-1000), FIELD_SIZE - 1000, "a withdrawal wraps");
    }

    /**
     * `fieldEncode` enforces the bound itself, and reaching that revert from a
     * plausible transaction takes the two-at-the-ceiling case above — `transact`
     * checks first, so its own check shields this one everywhere else.
     *
     * Not a redundancy worth removing. This function is public precisely so a client
     * can encode an amount before building a proof, and a client asking it to encode
     * an impossible amount should be told so at that point rather than discovering it
     * from a reverted transaction after paying for a proof.
     */
    function test_theEncoderRefusesAnOversizedAmountOnItsOwn() public {
        uint256 tooBig = pool.MAX_NOTE_VALUE() + 1;

        vm.expectRevert(
            abi.encodeWithSelector(ShieldedPool.AmountTooLarge.selector, tooBig)
        );
        pool.fieldEncode(int256(tooBig));
    }

    function test_theEncoderRefusesAnOversizedWithdrawalOnItsOwn() public {
        uint256 tooBig = pool.MAX_NOTE_VALUE() + 1;

        vm.expectRevert(
            abi.encodeWithSelector(ShieldedPool.AmountTooLarge.selector, tooBig)
        );
        pool.fieldEncode(-int256(tooBig));
    }

    function test_hashesExtDataIntoTheField() public view {
        uint256 hashed = pool.hashExtData(_ext(ALICE, -int256(100e8), 25e8));
        assertTrue(hashed < FIELD_SIZE, "the circuit has to be able to hold it");
    }

    /**
     * `extDataHash` is what binds the payout details to the proof. If two different
     * `ExtData` values hashed alike, a relayer could swap the recipient for their own
     * address and the proof would still verify.
     *
     * `extAmount` is bound here as well as being the source of `input[1]`. That looks
     * redundant and is not: `input[1]` is a quantity the circuit does arithmetic
     * with, and this is a destination. A client may legitimately sign two
     * transactions that differ only in how much they send to the same address, and
     * the hash has to tell them apart.
     */
    function test_differentPayoutDetailsHashDifferently() public view {
        uint256 toAlice = pool.hashExtData(_ext(ALICE, -int256(100e8), 0));
        uint256 toRelayer = pool.hashExtData(_ext(RELAYER, -int256(100e8), 0));
        uint256 withFee = pool.hashExtData(_ext(ALICE, -int256(100e8), 1));
        uint256 otherAmount = pool.hashExtData(_ext(ALICE, -int256(101e8), 0));

        assertTrue(toAlice != toRelayer, "recipient is bound");
        assertTrue(toAlice != withFee, "fee is bound");
        assertTrue(toAlice != otherAmount, "extAmount is bound");
    }

    /**
     * And the sign of `extAmount` is bound, which a magnitude-only field would have
     * lost. Depositing 100 and withdrawing 100 to the same address must not share a
     * hash, or a proof for one is a proof for the other.
     */
    function test_theDirectionOfTheAmountIsBound() public view {
        uint256 inward = pool.hashExtData(_ext(ALICE, int256(100e8), 0));
        uint256 outward = pool.hashExtData(_ext(ALICE, -int256(100e8), 0));

        assertTrue(inward != outward, "a deposit and a withdrawal are different proofs");
    }

    /* ── one pinned vector, for the browser to check itself against ──────────── */

    /**
     * 🔴 The browser has to reproduce `abi.encode(extData)` byte for byte, and it
     * cannot ask the compiler.
     *
     * `src/lib/transaction.ts` writes the encoding out by hand — it has to, because a
     * zero-dependency frontend has no ABI coder — and an encoding that is wrong in any
     * byte produces a different `extDataHash`, which is `input[2]`, which is the slot
     * that binds *who gets paid*. A proof built against a wrong `input[2]` is a proof
     * about a different recipient. Nothing reverts; the transaction simply never
     * verifies, or verifies for someone else.
     *
     * So the vector below is extracted from the **compiler** here and read back out of
     * this file by `tests/transaction.test.ts`, the same way `tests/field.test.ts`
     * reads `FIELD_SIZE` out of `MerkleTreeWithHistory.sol`. One vector, asserted from
     * both sides. Restating these literals in TypeScript instead would be two copies
     * again, agreeing with whichever side they were typed against.
     *
     * ── Why these particular numbers ─────────────────────────────────────────────
     * Not arbitrary. The case is a **relayed withdrawal**, which is the only shape
     * that exercises every interesting part of the encoding at once:
     *   - `recipient` and `relayer` differ, so a swapped-word bug is visible;
     *   - `extAmount` is **negative**, so the `int256` word is two's complement and a
     *     browser that used field negation there (which is correct for `input[1]` and
     *     wrong here) gets a different digest;
     *   - `fee` is non-zero, so the fourth word is not a zero that any bug agrees with;
     *   - and the resulting keccak digest is **above FIELD_SIZE**, asserted below, so
     *     the `% FIELD_SIZE` fold genuinely reduces. A digest that happened to land
     *     under the modulus would make the fold a no-op and let a broken fold pass.
     */
    int256 internal constant PINNED_EXT_AMOUNT = -75e8;
    uint256 internal constant PINNED_EXT_FEE = 25e8;

    /** `abi.encode(ExtData(ALICE, RELAYER, PINNED_EXT_AMOUNT, PINNED_EXT_FEE))`. */
    bytes internal constant PINNED_ENCODING =
        hex"00000000000000000000000000000000000000000000000000000000000a11ce"
        hex"00000000000000000000000000000000000000000000000000000000003e14e3"
        hex"fffffffffffffffffffffffffffffffffffffffffffffffffffffffe40f71500"
        hex"000000000000000000000000000000000000000000000000000000009502f900";

    /** `keccak256(PINNED_ENCODING)`. The one value the browser cannot compute. */
    bytes32 internal constant PINNED_DIGEST =
        0xad526f2d2afa98224a43dda9d78d3fbd5167ea6401fc2ca8de5d2ecf49c8a56f;

    /** `uint256(PINNED_DIGEST) % FIELD_SIZE` — what `hashExtData` returns. */
    uint256 internal constant PINNED_FIELD =
        12731042960267385565968027458327713665880296818808042993315985931762240365932;

    /**
     * Four static 32-byte words, and nothing else.
     *
     * The length assertion is the load-bearing half. Every member of `ExtData` is a
     * static type, so the encoding is the four head words concatenated — no offset
     * word, no length prefix, no tail. That is *why* the browser can write it out in
     * twenty lines, and if a future member were dynamic (a `bytes memo`, say) this
     * assertion would fail first and point at the file that has to change.
     */
    function test_encodesExtDataAsFourStaticWords() public pure {
        bytes memory encoded = abi.encode(_ext(ALICE, PINNED_EXT_AMOUNT, PINNED_EXT_FEE));

        assertEq(encoded.length, 128, "four static words, no offsets and no tail");
        assertEq(keccak256(encoded), keccak256(PINNED_ENCODING), "the pinned encoding drifted");
    }

    /**
     * The pinned digest is the compiler's, and the fold is not a no-op.
     *
     * Both halves matter separately: the first says the digest literal in this file is
     * the real keccak of the real encoding, and the second says the reduction that
     * `src/lib/transaction.ts` performs on that digest is actually reducing something.
     */
    function test_pinsTheExtDataDigestAndItsFold() public view {
        ShieldedPool.ExtData memory ext = _ext(ALICE, PINNED_EXT_AMOUNT, PINNED_EXT_FEE);

        assertEq(keccak256(abi.encode(ext)), PINNED_DIGEST, "the pinned digest drifted");
        assertTrue(uint256(PINNED_DIGEST) >= FIELD_SIZE, "the fold has to reduce something");
        assertEq(pool.hashExtData(ext), PINNED_FIELD, "the pinned field element drifted");
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

        ShieldedPool.ExtData memory ext = _in(100e8);
        ShieldedPool.Proof memory args = ShieldedPool.Proof({
            root: fresh.getLastRoot(),
            inputNullifiers: [_field("nullifier-a", 7), _field("nullifier-b", 7)],
            outputCommitments: [_field("commitment-a", 7), _field("commitment-b", 7)],
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

    /**
     * 🔴 The strongest form of the insolvency regression: the vector and the balance,
     * asserted against each other in one transaction.
     *
     * A relayed deposit of 100 with a fee of 3 must tell the verifier **97**, and
     * must end with 97 in the pool. The old implementation told it 100 and kept 97,
     * and a correct circuit would have minted notes for the difference. Because
     * `ExpectingVerifier` reverts on any vector but the one it was handed, the
     * transaction going through *is* the assertion on `input[1]`, and the balance
     * check after it closes the loop.
     */
    function test_handsTheVerifierTheDerivedAmountAndThenHoldsExactlyIt() public {
        ExpectingVerifier expecting = new ExpectingVerifier();
        ShieldedPool fresh =
            new ShieldedPool(LEVELS, hasher, expecting, IERC20(address(token)));
        token.approve(address(fresh), type(uint256).max);

        ShieldedPool.ExtData memory ext = _ext(address(0), int256(100e8), 3e8);
        ShieldedPool.Proof memory args = ShieldedPool.Proof({
            root: fresh.getLastRoot(),
            inputNullifiers: [_field("nullifier-a", 11), _field("nullifier-b", 11)],
            outputCommitments: [_field("commitment-a", 11), _field("commitment-b", 11)],
            proof: hex"c0ffee"
        });

        uint256[7] memory built;
        built[0] = uint256(args.root);
        built[1] = 97e8; // 100 pulled in, 3 paid straight out to the relayer
        built[2] = uint256(keccak256(abi.encode(ext))) % FIELD_SIZE;
        built[3] = uint256(args.inputNullifiers[0]);
        built[4] = uint256(args.inputNullifiers[1]);
        built[5] = uint256(args.outputCommitments[0]);
        built[6] = uint256(args.outputCommitments[1]);

        expecting.expect(built, hex"c0ffee");
        fresh.transact(args, ext);

        assertEq(token.balanceOf(address(fresh)), 97e8, "and the balance agrees with the vector");
        assertEq(token.balanceOf(RELAYER), 3e8, "the relayer was paid from the deposit");
    }

    function test_thePublicHelperAgreesWithTheSameVector() public view {
        ShieldedPool.ExtData memory ext = _ext(ALICE, -int256(75e8), 25e8);
        ShieldedPool.Proof memory args = _args(9);

        uint256[7] memory got = pool.publicInputs(args, ext);
        assertEq(got[0], uint256(args.root), "root");
        assertEq(got[1], FIELD_SIZE - 100e8, "publicAmount: recipient plus relayer, encoded");
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
            proof: hex"00"
        });

        vm.expectRevert(ShieldedPool.InvalidProof.selector);
        fresh.transact(args, _in(100e8));

        assertEq(fresh.getLastRoot(), rootBefore, "root unchanged");
        assertEq(fresh.nextIndex(), 0, "tree unchanged");
        assertFalse(fresh.isSpent(args.inputNullifiers[0]), "no nullifier burned");
        assertEq(token.balanceOf(address(fresh)), 0, "no tokens held");
        assertEq(token.balanceOf(address(this)), callerBefore, "caller paid nothing");
    }

    /**
     * 🔴 And a rejected proof pays no relayer, which is a different claim.
     *
     * Verification sits between the pull and both payments, so a bad proof on a
     * relayed deposit must leave the relayer with nothing even though the tokens
     * briefly arrived. Worth its own test because "the revert unwinds it" is an
     * argument about ordering, and the fee is the payment most likely to be moved
     * earlier by someone reasoning that the relayer did the work regardless.
     */
    function test_aRejectedProofPaysNoRelayer() public {
        RejectingVerifier rejecting = new RejectingVerifier();
        ShieldedPool fresh =
            new ShieldedPool(LEVELS, hasher, rejecting, IERC20(address(token)));
        token.approve(address(fresh), type(uint256).max);

        ShieldedPool.Proof memory args = ShieldedPool.Proof({
            root: fresh.getLastRoot(),
            inputNullifiers: [_field("nullifier-a", 12), _field("nullifier-b", 12)],
            outputCommitments: [_field("commitment-a", 12), _field("commitment-b", 12)],
            proof: hex"00"
        });

        vm.expectRevert(ShieldedPool.InvalidProof.selector);
        fresh.transact(args, _ext(address(0), int256(100e8), 3e8));

        assertEq(token.balanceOf(RELAYER), 0, "the relayer was not paid for a bad proof");
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
            proof: hex"01"
        });

        // 1% of 100e8 is 1e8, so 99e8 arrives.
        vm.expectRevert(
            abi.encodeWithSelector(
                ShieldedPool.TokenDidNotDeliver.selector, 100e8, 99e8
            )
        );
        fresh.transact(args, _in(100e8));
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
            proof: hex"02"
        });

        vm.expectRevert(
            abi.encodeWithSelector(
                ShieldedPool.TokenDidNotDeliver.selector, 100e8, 100e8 + 1
            )
        );
        fresh.transact(args, _in(100e8));
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
            proof: hex"03"
        });

        vm.expectRevert(
            abi.encodeWithSelector(
                SafeTransfer.TransferFromFailed.selector, address(broken), address(this), 100e8
            )
        );
        fresh.transact(args, _in(100e8));

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
        ShieldedPool.Proof memory args = _args(2);

        vm.expectRevert();
        pool.transact(args, _out(ALICE, 500e8));

        assertEq(token.balanceOf(ALICE), 0, "alice received nothing");
        assertEq(token.balanceOf(address(pool)), 100e8, "the pool is intact");
    }

    /**
     * And a fee the pool cannot cover fails the same way, after the recipient has
     * already been paid inside the same call.
     *
     * The atomicity is the whole defence: `_payOut` runs before `_payFee`, so without
     * the revert unwinding it a relayer could be stiffed on a transaction that
     * nonetheless delivered the withdrawal.
     */
    function test_anUnpayableFeeUndoesThePayoutToo() public {
        _deposit(1, 100e8);
        ShieldedPool.Proof memory args = _args(2);

        vm.expectRevert();
        pool.transact(args, _ext(ALICE, -int256(90e8), 50e8));

        assertEq(token.balanceOf(ALICE), 0, "the payout was undone");
        assertEq(token.balanceOf(RELAYER), 0, "and the fee never happened");
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
                    proof: hex"04"
                }),
                _in(1e8)
            );
        }
        assertEq(small.remainingCapacity(), 0, "four leaves, two transactions");

        ShieldedPool.Proof memory args = ShieldedPool.Proof({
            root: small.getLastRoot(),
            inputNullifiers: [_field("na", 99), _field("nb", 99)],
            outputCommitments: [_field("ca", 99), _field("cb", 99)],
            proof: hex"04"
        });

        vm.expectRevert(MerkleTreeWithHistory.TreeIsFull.selector);
        small.transact(args, _in(1e8));
    }

    /* ── fuzz ───────────────────────────────────────────────────────────────── */

    /**
     * Whatever the amount, the pool's balance moves by exactly it and the tree grows
     * by exactly two. This is the conservation property the accounting rests on.
     */
    function testFuzz_depositConservesTheAmountExactly(uint96 raw) public {
        uint256 amount = uint256(raw);
        vm.assume(amount <= 1_000_000e8);

        pool.transact(_args(1), _in(amount));

        assertEq(token.balanceOf(address(pool)), amount, "pool up by the amount");
        assertEq(token.balanceOf(address(this)), 1_000_000e8 - amount, "caller down by it");
        assertEq(pool.nextIndex(), 2, "two leaves regardless of amount");
    }

    /**
     * The two payments never create or destroy tokens, whatever the split is. An
     * off-by-one here would be a slow leak rather than a visible failure.
     *
     * Note what this now asserts and did not before: the recipient gets `amount` and
     * the relayer gets `fee`, so their sum is `amount + fee` and the pool is down by
     * that. The old version fuzzed a split of a fixed total, which is the shape that
     * hid the bug — it could only ever check that one number was divided correctly,
     * never that the number itself was the one the circuit had proven.
     */
    function testFuzz_bothPaymentsAreExactAndComeFromThePool(uint96 rawAmount, uint96 rawFee)
        public
    {
        uint256 amount = uint256(rawAmount) % 500e8;
        uint256 fee = uint256(rawFee) % 500e8;

        _deposit(1, 1000e8);
        pool.transact(_args(2), _ext(ALICE, -int256(amount), fee));

        assertEq(token.balanceOf(ALICE), amount, "the recipient got exactly the amount");
        assertEq(token.balanceOf(RELAYER), fee, "the relayer got exactly the fee");
        assertEq(
            token.balanceOf(address(pool)), 1000e8 - amount - fee, "and the pool paid both once"
        );
    }

    /**
     * Every legal magnitude round-trips through the field encoding, in both
     * directions. This is the function a client has to reimplement, so it is the one
     * most worth fuzzing.
     */
    function testFuzz_fieldEncodingRoundTrips(uint256 raw) public view {
        uint256 magnitude = raw % (pool.MAX_NOTE_VALUE() + 1);

        assertEq(pool.fieldEncode(int256(magnitude)), magnitude, "deposits are identity");

        uint256 encoded = pool.fieldEncode(-int256(magnitude));
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
        int256 extAmount,
        uint256 fee
    ) public view {
        uint256 hashed = pool.hashExtData(
            ShieldedPool.ExtData({
                recipient: recipient,
                relayer: relayer,
                extAmount: extAmount,
                fee: fee
            })
        );
        assertTrue(hashed < FIELD_SIZE, "always a field element");
    }

    /** Any amount past the bound is refused, not just the one above it. */
    function testFuzz_refusesEveryOversizedAmount(uint256 raw) public {
        uint256 max = pool.MAX_NOTE_VALUE();
        vm.assume(raw > max && raw <= uint256(type(int256).max));
        ShieldedPool.Proof memory args = _args(1);

        vm.expectRevert(abi.encodeWithSelector(ShieldedPool.AmountTooLarge.selector, raw));
        pool.transact(args, _in(raw));
    }

    /** And every oversized fee, which is the check that did not exist before. */
    function testFuzz_refusesEveryOversizedFee(uint256 raw) public {
        uint256 max = pool.MAX_NOTE_VALUE();
        vm.assume(raw > max);
        ShieldedPool.Proof memory args = _args(1);

        vm.expectRevert(abi.encodeWithSelector(ShieldedPool.AmountTooLarge.selector, raw));
        pool.transact(args, _ext(ALICE, 0, raw));
    }
}
