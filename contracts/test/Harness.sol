// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * The few pieces of forge-std this suite actually uses, written out.
 *
 * ── Why not just install forge-std ───────────────────────────────────────────
 * The rest of this repo can be tested from a bare clone with nothing installed,
 * and that property is worth keeping on the half that holds money. `forge-std`
 * arrives as a git submodule, so `forge test` on a fresh checkout without
 * `--recurse-submodules` fails with a missing-import error that looks like a code
 * problem and is not. The cloud session this repo exists to be handed to would
 * hit exactly that.
 *
 * What is needed here is small: four assertions, one `expectRevert`, and a way to
 * label a run. That is cheaper to write than to explain.
 *
 * ── The one real cost, stated plainly ────────────────────────────────────────
 * `assertEq` on unequal values reverts with a message instead of collecting a
 * failure and continuing, so a failing test reports its first bad assertion and
 * stops. forge-std would show you all of them. That is a worse debugging
 * experience and a deliberate trade — it does not change which tests pass.
 */

/**
 * The cheatcode interface, trimmed to what is used.
 *
 * Foundry injects this at the fixed address below. The signatures must match
 * Foundry's exactly or the call reverts with no useful message, so they are
 * copied rather than paraphrased.
 */
interface Vm {
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert() external;
    function expectEmit(address emitter) external;
    function prank(address msgSender) external;
    function label(address account, string calldata newLabel) external;
    function assume(bool condition) external pure;
    function warp(uint256 newTimestamp) external;
}

contract Harness {
    /**
     * `address(uint160(uint256(keccak256("hevm cheat code"))))`, which is where
     * Foundry has always answered. Written as a literal because computing it
     * needs the very cast the linter is configured to object to, and a constant
     * that has never changed does not need to be derived at runtime.
     */
    Vm internal constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    error AssertFailed(string what);
    error AssertEqFailedUint(string what, uint256 expected, uint256 actual);
    error AssertEqFailedInt(string what, int256 expected, int256 actual);
    error AssertEqFailedBytes32(string what, bytes32 expected, bytes32 actual);
    error AssertEqFailedAddress(string what, address expected, address actual);

    function assertTrue(bool condition, string memory what) internal pure {
        if (!condition) revert AssertFailed(what);
    }

    function assertFalse(bool condition, string memory what) internal pure {
        if (condition) revert AssertFailed(what);
    }

    function assertEq(uint256 actual, uint256 expected, string memory what) internal pure {
        if (actual != expected) revert AssertEqFailedUint(what, expected, actual);
    }

    /**
     * Deliberately NOT an `assertEq` overload.
     *
     * Solidity allows an implicit `uintN → int256` widening, so adding
     * `assertEq(int256, int256, string)` beside the `uint256` one makes every
     * existing `assertEq(pool.nextIndex(), 2, ...)` ambiguous and the whole suite
     * stops compiling. A separate name costs four characters at each call site and
     * has no blast radius.
     *
     * Worth having at all because `publicAmountFor` returns a signed value whose
     * sign is the entire point: casting it to compare against the `uint256`
     * overload would turn a sign error — the exact bug this contract just had — into
     * a passing test.
     */
    function assertEqInt(int256 actual, int256 expected, string memory what) internal pure {
        if (actual != expected) revert AssertEqFailedInt(what, expected, actual);
    }

    function assertEq(bytes32 actual, bytes32 expected, string memory what) internal pure {
        if (actual != expected) revert AssertEqFailedBytes32(what, expected, actual);
    }

    function assertEq(address actual, address expected, string memory what) internal pure {
        if (actual != expected) revert AssertEqFailedAddress(what, expected, actual);
    }

    function assertNotEq(bytes32 actual, bytes32 unwanted, string memory what) internal pure {
        if (actual == unwanted) revert AssertFailed(what);
    }
}
