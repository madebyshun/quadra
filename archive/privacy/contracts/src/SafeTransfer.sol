// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "./interfaces/IERC20.sol";

/**
 * ERC-20 moves that fail loudly, including against tokens that do not follow
 * ERC-20.
 *
 * ── The bug this exists to prevent ───────────────────────────────────────────
 * The standard says `transfer` returns `bool`. Several widely-held tokens return
 * nothing. Solidity decodes a call typed `returns (bool)` by reading 32 bytes of
 * return data, so against one of those tokens the high-level call reverts on a
 * transfer that actually succeeded — and, worse in the other direction, a token
 * that returns `false` instead of reverting gets read as success by code that
 * ignores the return value.
 *
 * The second one is the dangerous shape for a pool: a withdrawal whose payout
 * silently failed still burns the nullifier, so the note is spent and the money
 * never left. The user has no note and no funds and no error to point at.
 *
 * So: accept empty return data as success, accept `true` as success, treat
 * everything else — including `false` — as failure, and revert.
 *
 * ── What this deliberately does NOT try to survive ───────────────────────────
 * Fee-on-transfer and rebasing tokens. A pool note records the amount that was
 * proven, and a token that delivers less than was sent makes that number a
 * fiction the moment it is written. `ShieldedPool._pullExactly` therefore
 * measures the balance before and after and rejects any token that did not
 * deliver exactly what was asked for, rather than trying to cope. (There is no
 * `deposit` function to point at — a deposit is `transact` with a positive
 * `publicAmount`, so that the two are indistinguishable by selector.) Coping
 * here means
 * either a pool that is quietly short or notes that cannot all be redeemed —
 * and the shortfall lands on whoever withdraws last, who did nothing wrong.
 */
library SafeTransfer {
    error TransferFailed(address token, address to, uint256 amount);
    error TransferFromFailed(address token, address from, uint256 amount);
    error NotAContract(address token);

    function safeTransfer(IERC20 token, address to, uint256 amount) internal {
        _mustBeContract(address(token));
        (bool ok, bytes memory data) = address(token).call(
            abi.encodeCall(IERC20.transfer, (to, amount))
        );
        if (!_accepted(ok, data)) revert TransferFailed(address(token), to, amount);
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 amount) internal {
        _mustBeContract(address(token));
        (bool ok, bytes memory data) = address(token).call(
            abi.encodeCall(IERC20.transferFrom, (from, to, amount))
        );
        if (!_accepted(ok, data)) revert TransferFromFailed(address(token), from, amount);
    }

    /**
     * Empty return data counts as success below, which is correct for the real
     * tokens that return nothing — and catastrophic for an address that is not a
     * token at all. A call to an account with no code succeeds and returns
     * nothing, so without this check every "transfer" to a mistyped address
     * reads as a completed payment and the pool's books go quietly wrong.
     *
     * Checked here rather than inside `_accepted` because `_accepted` is pure and
     * this is a state read. Keeping it out of there is what lets the return-value
     * rules stay a function of the return value alone.
     */
    function _mustBeContract(address token) private view {
        if (token.code.length == 0) revert NotAContract(token);
    }

    function _accepted(bool ok, bytes memory data) private pure returns (bool) {
        if (!ok) return false;
        if (data.length == 0) return true;
        if (data.length != 32) return false;
        return abi.decode(data, (bool));
    }
}
