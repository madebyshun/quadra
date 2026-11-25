// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

/// @notice What the router calls on LaunchFactoryV3 as its protocol recipient.
interface IRouterLaunchpad {
    function acceptProtocolRecipient() external;
    function proposeProtocolRecipient(address recipient) external;
    function setReferrer(address referrer, bool approved) external;
    function withdraw(Currency currency) external;
}

/// @title FeeRouter
///
/// @notice Stage C (2026-11-25, docs/BACKSTOP.md): LaunchFactoryV3's protocol recipient. Every coin's protocol
///         share arrives here, in both currencies of its pool, and leaves by a fixed rule anyone may run:
///           - ETH: `ETH_BPS` (half) to the Backstop, which buys $QUADRA back and burns it; the rest to the treasury;
///           - every other token — a quote (USDC, a stock, AERO) or the coin itself: all to the treasury, never
///             sold here (selling a creator's coin would push down the coin that paid the fee).
///         Never all of the revenue is burnt (the owner's rule).
///
///         The treasury keeps two powers and no more: approving referrers (the factory lets only its protocol
///         recipient do that), and moving the protocol recipient to another contract — an escape from a bug —
///         announced publicly and possible only `MOVE_DELAY` (7 days) later. It can never take the Backstop's share
///         out of this contract, change the split, or touch a fee already distributed.
contract FeeRouter {
    /// @notice The Backstop's share of ETH, in basis points, fixed for good.
    uint16 public constant ETH_BPS = 5_000;
    /// @notice How long a move of the protocol recipient must be announced before it can happen.
    uint256 public constant MOVE_DELAY = 7 days;

    IRouterLaunchpad public immutable launchpad;
    address public immutable treasury;
    address public immutable backstop;

    /// @notice A move the treasury announced, and when; zero when none is pending.
    address public pendingMove;
    uint256 public moveAnnouncedAt;

    uint256 private _locked = 1;

    event Distributed(address indexed currency, uint256 toBackstop, uint256 toTreasury);
    event MoveAnnounced(address indexed next, uint256 possibleAt);
    event MoveCancelled(address indexed next);
    event MoveExecuted(address indexed next);

    error NotTreasury();
    error ZeroAddress();
    error TransferFailed();
    error NoMove();
    error TooEarly(uint256 possibleAt);
    error Reentrancy();

    modifier onlyTreasury() {
        if (msg.sender != treasury) revert NotTreasury();
        _;
    }

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(IRouterLaunchpad launchpad_, address treasury_, address backstop_) {
        if (address(launchpad_) == address(0) || treasury_ == address(0) || backstop_ == address(0)) revert ZeroAddress();
        launchpad = launchpad_;
        treasury = treasury_;
        backstop = backstop_;
    }

    /// @notice The factory pays ETH with a plain call.
    receive() external payable {}

    // ───────────────────────────────────────────────────────────── the split, anyone

    /// @notice Pay out everything this router holds in `currencies` (the zero address is ETH) by the fixed rule.
    function distribute(address[] calldata currencies) external nonReentrant {
        for (uint256 i; i < currencies.length; ++i) {
            address c = currencies[i];
            if (c == address(0)) {
                uint256 all = address(this).balance;
                uint256 toBackstop = all * ETH_BPS / 10_000;
                _sendEth(backstop, toBackstop);
                _sendEth(treasury, all - toBackstop);
                emit Distributed(c, toBackstop, all - toBackstop);
            } else {
                uint256 all = Currency.wrap(c).balanceOfSelf();
                _sendToken(c, treasury, all);
                emit Distributed(c, 0, all);
            }
        }
    }

    /// @notice Ask the factory for what it kept for this router (a payout it could not push).
    function pullOwed(Currency currency) external {
        launchpad.withdraw(currency);
    }

    /// @notice Take up the protocol recipient's role, once the treasury has proposed this router.
    function accept() external {
        launchpad.acceptProtocolRecipient();
    }

    // ───────────────────────────────────────────────────────────── the treasury's two powers

    /// @notice Approve (or stop approving) a referrer for new launches, as the factory's protocol recipient.
    function setReferrer(address referrer, bool approved) external onlyTreasury {
        launchpad.setReferrer(referrer, approved);
    }

    /// @notice Announce a move of the protocol recipient to `next`; possible `MOVE_DELAY` from now.
    function announceMove(address next) external onlyTreasury {
        if (next == address(0)) revert ZeroAddress();
        pendingMove = next;
        moveAnnouncedAt = block.timestamp;
        emit MoveAnnounced(next, block.timestamp + MOVE_DELAY);
    }

    function cancelMove() external onlyTreasury {
        address next = pendingMove;
        if (next == address(0)) revert NoMove();
        pendingMove = address(0);
        moveAnnouncedAt = 0;
        emit MoveCancelled(next);
    }

    /// @notice Propose the announced recipient to the factory, once the delay is over; it must then accept.
    function executeMove() external onlyTreasury {
        address next = pendingMove;
        if (next == address(0)) revert NoMove();
        uint256 possibleAt = moveAnnouncedAt + MOVE_DELAY;
        if (block.timestamp < possibleAt) revert TooEarly(possibleAt);
        pendingMove = address(0);
        moveAnnouncedAt = 0;
        launchpad.proposeProtocolRecipient(next);
        emit MoveExecuted(next);
    }

    // ───────────────────────────────────────────────────────────── transfers

    function _sendEth(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @dev Accepts a token that returns nothing; refuses one that returns false or reverts.
    function _sendToken(address token, address to, uint256 amount) private {
        (bool ok, bytes memory answer) = token.call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
        if (!ok || (answer.length != 0 && !abi.decode(answer, (bool)))) revert TransferFailed();
    }
}
