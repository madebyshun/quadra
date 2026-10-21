// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "../../src/interfaces/IERC20.sol";

/**
 * The token shapes `SafeTransfer` and `ShieldedPool._pullExactly` exist to handle.
 * FOR TESTS ONLY.
 *
 * Each of these is a real pattern that shipped on Ethereum or Base, not an
 * invented adversary. That is the point of testing against them: every one of
 * them is a token somebody might plausibly point this pool at, and the pool has to
 * either work correctly or refuse loudly. "Silently wrong" is the outcome none of
 * them are allowed to produce.
 *
 * Decimals are 8 throughout — neither USDC's 6 nor the 18 that gets assumed, so a
 * hard-coded exponent of either shows up here. A double that lies about its decimals would let
 * an off-by-10^10 bug pass here and surface in production.
 */

/**
 * A well-behaved ERC-20. The control case.
 *
 * `mint` is unguarded because it is a test fixture; that is the one thing in this
 * file that must never be copied anywhere near `src/`.
 */
contract GoodToken is IERC20 {
    string public name = "Good";
    string public symbol = "GOOD";
    uint8 public constant DECIMALS = 8;

    mapping(address => uint256) public balances;
    mapping(address => mapping(address => uint256)) public allowance;

    error InsufficientBalance(address from, uint256 have, uint256 want);
    error InsufficientAllowance(address owner, address spender, uint256 have, uint256 want);

    function decimals() external pure returns (uint8) {
        return DECIMALS;
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    function mint(address to, uint256 amount) external {
        balances[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external virtual returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount)
        external
        virtual
        returns (bool)
    {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert InsufficientAllowance(from, msg.sender, allowed, amount);
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        uint256 have = balances[from];
        if (have < amount) revert InsufficientBalance(from, have, amount);
        balances[from] = have - amount;
        balances[to] += amount;
    }
}

/**
 * Returns nothing from `transfer` / `transferFrom`. USDT's shape.
 *
 * This is the case a high-level `IERC20(token).transfer(...)` call gets WRONG in
 * the safe direction: Solidity tries to decode 32 bytes of return data, finds
 * none, and reverts a transfer that actually succeeded. Annoying, visible, not
 * dangerous. `SafeTransfer` must accept it.
 */
contract NoReturnToken is GoodToken {
    function transfer(address to, uint256 amount) external override returns (bool) {
        _move(msg.sender, to, amount);
        assembly {
            return(0, 0)
        }
    }

    function transferFrom(address from, address to, uint256 amount)
        external
        override
        returns (bool)
    {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert InsufficientAllowance(from, msg.sender, allowed, amount);
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
        assembly {
            return(0, 0)
        }
    }
}

/**
 * 🔴 Returns `false` instead of reverting, and moves nothing. The dangerous one.
 *
 * Old ZRX and a handful of others behave like this on failure. Code that ignores
 * the return value reads it as success, so for this pool the sequence would be:
 * verify the proof, burn the nullifiers, append the commitments, "pay" the
 * recipient, emit `Withdrawal`. The note is spent, the money never left, and there
 * is no error anywhere for the user to point at.
 *
 * `SafeTransfer` must treat this as failure and revert. This double is the only
 * way to prove it does.
 */
contract FalseReturnToken is GoodToken {
    function transfer(address, uint256) external pure override returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure override returns (bool) {
        return false;
    }
}

/**
 * Returns 32 bytes that are not a bool — a non-zero word that is neither 0 nor 1.
 *
 * `abi.decode(data, (bool))` reverts on this in 0.8.x, which is the correct
 * outcome and is reached by a different path than an explicit `false`. Here so
 * that path is actually exercised rather than assumed.
 */
contract GarbageReturnToken is GoodToken {
    function transfer(address to, uint256 amount) external override returns (bool) {
        _move(msg.sender, to, amount);
        assembly {
            mstore(0, 42)
            return(0, 32)
        }
    }

    function transferFrom(address, address, uint256) external pure override returns (bool) {
        assembly {
            mstore(0, 42)
            return(0, 32)
        }
    }
}

/**
 * Returns more than 32 bytes.
 *
 * `SafeTransfer._accepted` rejects any non-empty return of the wrong length rather
 * than decoding the first word and hoping. A token returning a struct or an
 * unexpected tuple is not a token this pool understands, and guessing at its
 * meaning is how you end up trusting the second field of something.
 */
contract OversizedReturnToken is GoodToken {
    function transfer(address to, uint256 amount) external override returns (bool) {
        _move(msg.sender, to, amount);
        assembly {
            mstore(0, 1)
            mstore(32, 1)
            return(0, 64)
        }
    }

    function transferFrom(address, address, uint256) external pure override returns (bool) {
        assembly {
            mstore(0, 1)
            mstore(32, 1)
            return(0, 64)
        }
    }
}

/**
 * Takes a cut on every transfer. The pool must REFUSE this, not cope with it.
 *
 * A note records the amount that was proven. A token delivering less than was sent
 * makes that number a fiction the moment it is written, and the shortfall does not
 * land on the depositor — it lands on whoever withdraws last, who did nothing
 * wrong and cannot tell what happened. `_pullExactly` measures the balance before
 * and after and reverts `TokenDidNotDeliver`.
 *
 * Refusing is the honest answer here. Supporting fee-on-transfer would mean
 * either a pool that is quietly short or notes that cannot all be redeemed.
 */
contract FeeOnTransferToken is GoodToken {
    uint256 public feeBps = 100;

    function transferFrom(address from, address to, uint256 amount)
        external
        override
        returns (bool)
    {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert InsufficientAllowance(from, msg.sender, allowed, amount);
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;

        uint256 fee = (amount * feeBps) / 10_000;
        _move(from, to, amount - fee);
        _move(from, address(this), fee);
        return true;
    }
}

/**
 * Delivers MORE than was asked for. Also refused, and the asymmetry is the point.
 *
 * A rebasing token mid-rebase, or a token with a transfer bonus, hands the pool a
 * surplus. Accepting it is tempting — the pool is up, nobody is short. But the
 * note still records the requested amount, so the surplus belongs to nobody and
 * accumulates as an unaccounted balance, and any later reasoning about whether the
 * pool is solvent has to special-case it. `_pullExactly` requires exactness in
 * both directions, which is why the check is `!=` and not `<`.
 */
contract SurplusToken is GoodToken {
    function transferFrom(address from, address to, uint256 amount)
        external
        override
        returns (bool)
    {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert InsufficientAllowance(from, msg.sender, allowed, amount);
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;

        _move(from, to, amount);
        balances[to] += 1;
        return true;
    }
}

/**
 * Reverts on every transfer. The plain unhappy path.
 *
 * Distinct from `FalseReturnToken` because it exercises the `!ok` branch rather
 * than the return-data branch, and because it is what a paused or blacklisting
 * token does to a real user.
 */
contract RevertingToken is GoodToken {
    error Nope();

    function transfer(address, uint256) external pure override returns (bool) {
        revert Nope();
    }

    function transferFrom(address, address, uint256) external pure override returns (bool) {
        revert Nope();
    }
}
