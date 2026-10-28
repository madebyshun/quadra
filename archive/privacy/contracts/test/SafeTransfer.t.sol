// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Harness} from "./Harness.sol";
import {SafeTransfer} from "../src/SafeTransfer.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {
    FalseReturnToken,
    GarbageReturnToken,
    GoodToken,
    NoReturnToken,
    OversizedReturnToken,
    RevertingToken
} from "./doubles/TestTokens.sol";

/**
 * `SafeTransfer` is a library of `internal` functions, so it has no address and
 * cannot be called from a test directly. This gives it one.
 *
 * The wrapper is thin on purpose — it adds no logic, so a failure here is a
 * failure in the library rather than in the scaffolding around it.
 */
contract TransferUnderTest {
    using SafeTransfer for IERC20;

    function send(IERC20 token, address to, uint256 amount) external {
        token.safeTransfer(to, amount);
    }

    function pull(IERC20 token, address from, address to, uint256 amount) external {
        token.safeTransferFrom(from, to, amount);
    }
}

contract SafeTransferTest is Harness {
    TransferUnderTest internal caller;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    function setUp() public {
        caller = new TransferUnderTest();
        vm.label(ALICE, "alice");
        vm.label(BOB, "bob");
    }

    /* ── the shapes that must work ──────────────────────────────────────────── */

    function test_acceptsAStandardToken() public {
        GoodToken token = new GoodToken();
        token.mint(address(caller), 100e8);

        caller.send(IERC20(address(token)), BOB, 40e8);
        assertEq(token.balanceOf(BOB), 40e8, "bob received the transfer");
        assertEq(token.balanceOf(address(caller)), 60e8, "and the caller paid it");
    }

    /**
     * USDT's shape: the transfer works and returns nothing. A high-level call typed
     * `returns (bool)` would revert here on a transfer that actually succeeded, so
     * empty return data has to count as success.
     */
    function test_acceptsATokenThatReturnsNothing() public {
        NoReturnToken token = new NoReturnToken();
        token.mint(address(caller), 100e8);

        caller.send(IERC20(address(token)), BOB, 40e8);
        assertEq(token.balanceOf(BOB), 40e8, "an empty return is still a completed transfer");
    }

    function test_acceptsTransferFromOnAStandardToken() public {
        GoodToken token = new GoodToken();
        token.mint(ALICE, 100e8);
        vm.prank(ALICE);
        token.approve(address(caller), 100e8);

        caller.pull(IERC20(address(token)), ALICE, BOB, 25e8);
        assertEq(token.balanceOf(BOB), 25e8, "pulled from alice to bob");
        assertEq(token.balanceOf(ALICE), 75e8, "alice paid");
    }

    function test_acceptsTransferFromOnANoReturnToken() public {
        NoReturnToken token = new NoReturnToken();
        token.mint(ALICE, 100e8);
        vm.prank(ALICE);
        token.approve(address(caller), 100e8);

        caller.pull(IERC20(address(token)), ALICE, BOB, 25e8);
        assertEq(token.balanceOf(BOB), 25e8, "empty return, real transfer");
    }

    /* ── the shapes that must fail loudly ───────────────────────────────────── */

    /**
     * 🔴 The one that matters most.
     *
     * A token that returns `false` instead of reverting is read as success by any
     * code that ignores the return value. In this pool that means: verify, burn the
     * nullifiers, append the commitments, "pay" the recipient, emit `Withdrawal`.
     * The note is spent, the money never moved, and the user has no note, no funds,
     * and no error to point at.
     */
    function test_refusesATokenThatReturnsFalse() public {
        FalseReturnToken token = new FalseReturnToken();
        token.mint(address(caller), 100e8);

        vm.expectRevert(
            abi.encodeWithSelector(
                SafeTransfer.TransferFailed.selector, address(token), BOB, 40e8
            )
        );
        caller.send(IERC20(address(token)), BOB, 40e8);
        assertEq(token.balanceOf(BOB), 0, "and nothing moved");
    }

    function test_refusesTransferFromThatReturnsFalse() public {
        FalseReturnToken token = new FalseReturnToken();
        token.mint(ALICE, 100e8);

        vm.expectRevert(
            abi.encodeWithSelector(
                SafeTransfer.TransferFromFailed.selector, address(token), ALICE, 25e8
            )
        );
        caller.pull(IERC20(address(token)), ALICE, BOB, 25e8);
    }

    function test_refusesATokenThatReverts() public {
        RevertingToken token = new RevertingToken();
        token.mint(address(caller), 100e8);

        vm.expectRevert(
            abi.encodeWithSelector(
                SafeTransfer.TransferFailed.selector, address(token), BOB, 40e8
            )
        );
        caller.send(IERC20(address(token)), BOB, 40e8);
    }

    function test_refusesTransferFromThatReverts() public {
        RevertingToken token = new RevertingToken();
        vm.expectRevert(
            abi.encodeWithSelector(
                SafeTransfer.TransferFromFailed.selector, address(token), ALICE, 25e8
            )
        );
        caller.pull(IERC20(address(token)), ALICE, BOB, 25e8);
    }

    /**
     * 32 bytes that decode to neither `true` nor `false`. Reaches the failure by a
     * different path than an explicit `false` — `abi.decode` reverting inside the
     * library rather than returning a value it then rejects — so it is worth its
     * own case rather than assuming the two are the same.
     */
    function test_refusesATokenReturningNonBoolean() public {
        GarbageReturnToken token = new GarbageReturnToken();
        token.mint(address(caller), 100e8);

        vm.expectRevert();
        caller.send(IERC20(address(token)), BOB, 40e8);
    }

    function test_refusesTransferFromReturningNonBoolean() public {
        GarbageReturnToken token = new GarbageReturnToken();
        vm.expectRevert();
        caller.pull(IERC20(address(token)), ALICE, BOB, 25e8);
    }

    /**
     * More than 32 bytes back. Rejected on length rather than decoded hopefully:
     * a token returning a struct is not a token this library understands, and
     * reading its first word as a success flag is trusting a field nobody defined.
     */
    function test_refusesATokenReturningTooMuchData() public {
        OversizedReturnToken token = new OversizedReturnToken();
        token.mint(address(caller), 100e8);

        vm.expectRevert(
            abi.encodeWithSelector(
                SafeTransfer.TransferFailed.selector, address(token), BOB, 40e8
            )
        );
        caller.send(IERC20(address(token)), BOB, 40e8);
    }

    function test_refusesTransferFromReturningTooMuchData() public {
        OversizedReturnToken token = new OversizedReturnToken();
        vm.expectRevert(
            abi.encodeWithSelector(
                SafeTransfer.TransferFromFailed.selector, address(token), ALICE, 25e8
            )
        );
        caller.pull(IERC20(address(token)), ALICE, BOB, 25e8);
    }

    /* ── the address that is not a token at all ─────────────────────────────── */

    /**
     * 🔴 Empty return data counts as success above, which is correct for real
     * tokens and catastrophic for an address with no code: a call to such an
     * account succeeds and returns nothing, so without the code check every
     * "transfer" to a mistyped address would read as a completed payment and the
     * pool's books would go quietly wrong.
     */
    function test_refusesAnAddressWithNoCode() public {
        address notAToken = address(0xDEAD);
        vm.expectRevert(
            abi.encodeWithSelector(SafeTransfer.NotAContract.selector, notAToken)
        );
        caller.send(IERC20(notAToken), BOB, 1);
    }

    function test_refusesTransferFromAnAddressWithNoCode() public {
        address notAToken = address(0xDEAD);
        vm.expectRevert(
            abi.encodeWithSelector(SafeTransfer.NotAContract.selector, notAToken)
        );
        caller.pull(IERC20(notAToken), ALICE, BOB, 1);
    }

    /** The zero address is the specific mistyped address people actually hit. */
    function test_refusesTheZeroAddress() public {
        vm.expectRevert(
            abi.encodeWithSelector(SafeTransfer.NotAContract.selector, address(0))
        );
        caller.send(IERC20(address(0)), BOB, 1);
    }

    /* ── fuzz ───────────────────────────────────────────────────────────────── */

    function testFuzz_movesExactlyWhatWasAsked(uint96 amount) public {
        GoodToken token = new GoodToken();
        token.mint(address(caller), amount);

        caller.send(IERC20(address(token)), BOB, amount);
        assertEq(token.balanceOf(BOB), amount, "recipient got exactly the amount");
        assertEq(token.balanceOf(address(caller)), 0, "and the sender has none left");
    }

    /**
     * Any address without code must be refused, not just the two hand-picked ones
     * above. This is the check that stops a plausible-looking typo from reading as
     * a completed payment.
     */
    function testFuzz_refusesEveryCodelessAddress(address candidate) public {
        vm.assume(candidate.code.length == 0);
        vm.expectRevert(
            abi.encodeWithSelector(SafeTransfer.NotAContract.selector, candidate)
        );
        caller.send(IERC20(candidate), BOB, 1);
    }
}
