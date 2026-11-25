// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice The ERC-20 surface the router needs from USDC, including EIP-2612 `permit` (USDC on Base
///         is Circle's FiatToken v2.2, which implements it).
interface IUSDC {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
}

interface IBalance {
    function balanceOf(address account) external view returns (uint256);
}

/// @title BasketRouter
///
/// @notice Treasury Basket in ONE transaction for any wallet (2026-11-25, the owner: "chỉ muốn user ký
///         1 lần, 1 tx"). The buyer's USDC is pulled once, split across legs, and each leg is a Relay
///         swap whose output Relay delivers STRAIGHT to the buyer — this contract never holds an asset
///         the buyer bought (a Coinbase stock's transfer policy could refuse a contract as holder).
///
///         Per leg: an EXACT approval of that leg's USDC to one of Relay's two PINNED approval proxies,
///         the Relay call, the approval set back to zero, and the buyer's balance of the leg's token
///         checked to have risen by at least `minOut` — Relay's calldata is not decoded here (the app
///         cannot decode it either), so what arrived is the check. Any USDC a leg did not use goes
///         back to the buyer in the same transaction.
///
/// @dev    Why it is safe to approve this contract: it only ever moves USDC FROM `msg.sender`, and only
///         calls the two Relay approval proxies fixed at deployment. A leg cannot name USDC, a token,
///         or any other contract as its target, so no calldata can spend another user's allowance.
///         No owner, no upgrade, no pause, no fee, nothing held between transactions.
contract BasketRouter {
    struct Leg {
        /// @notice one of the two Relay approval proxies
        address target;
        /// @notice the USDC this leg spends
        uint256 amountIn;
        /// @notice the token the buyer receives
        address tokenOut;
        /// @notice the least of `tokenOut` that must reach the buyer, or the whole basket reverts
        uint256 minOut;
        /// @notice Relay's swap calldata for this leg, quoted with this contract as the sender and the buyer as recipient
        bytes data;
    }

    IUSDC public immutable usdc;
    address public immutable relayProxyA;
    address public immutable relayProxyB;
    /// @notice The most legs a basket takes (the app's MAX_LEGS).
    uint256 public constant MAX_LEGS = 10;

    uint256 private _lock = 1;

    event BasketBought(address indexed buyer, uint256 usdcIn, uint256 usdcRefunded, uint256 legs);

    error NoLegs();
    error TooManyLegs();
    error Expired();
    error NotRelay(address target);
    error LegFailed(uint256 index, bytes reason);
    error TooLittle(uint256 index, uint256 got, uint256 minOut);
    error TransferFailed();
    error Reentrant();
    error ZeroAddress();

    constructor(IUSDC usdc_, address relayProxyA_, address relayProxyB_) {
        if (address(usdc_) == address(0) || relayProxyA_ == address(0) || relayProxyB_ == address(0)) revert ZeroAddress();
        usdc = usdc_;
        relayProxyA = relayProxyA_;
        relayProxyB = relayProxyB_;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrant();
        _lock = 2;
        _;
        _lock = 1;
    }

    /// @notice Buy every leg with USDC this contract may already move for the buyer (an approval for
    ///         at least the basket's total). `deadline` is a unix time after which nothing runs.
    function buy(Leg[] calldata legs, uint256 deadline) external nonReentrant returns (uint256 refunded) {
        return _buy(legs, deadline);
    }

    /// @notice The same, with the buyer's EIP-2612 signature for exactly the basket's total — one
    ///         signature and one transaction, no standing approval. A permit already used (someone
    ///         submitted the signature first) is not an error as long as the allowance is there.
    function buyWithPermit(Leg[] calldata legs, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external nonReentrant returns (uint256 refunded) {
        try usdc.permit(msg.sender, address(this), _total(legs), deadline, v, r, s) {} catch {}
        return _buy(legs, deadline);
    }

    function _total(Leg[] calldata legs) private pure returns (uint256 total) {
        for (uint256 i; i < legs.length; ++i) total += legs[i].amountIn;
    }

    function _buy(Leg[] calldata legs, uint256 deadline) private returns (uint256 refunded) {
        if (legs.length == 0) revert NoLegs();
        if (legs.length > MAX_LEGS) revert TooManyLegs();
        if (block.timestamp > deadline) revert Expired();
        uint256 total = _total(legs);
        uint256 before = usdc.balanceOf(address(this));
        _pull(msg.sender, total);
        for (uint256 i; i < legs.length; ++i) _leg(i, legs[i]);
        refunded = usdc.balanceOf(address(this)) - before;
        if (refunded > 0 && !usdc.transfer(msg.sender, refunded)) revert TransferFailed();
        emit BasketBought(msg.sender, total, refunded, legs.length);
    }

    function _pull(address from, uint256 amount) private {
        if (!usdc.transferFrom(from, address(this), amount)) revert TransferFailed();
    }

    function _leg(uint256 i, Leg calldata leg) private {
        if (leg.target != relayProxyA && leg.target != relayProxyB) revert NotRelay(leg.target);
        uint256 had = IBalance(leg.tokenOut).balanceOf(msg.sender);
        if (!usdc.approve(leg.target, leg.amountIn)) revert TransferFailed();
        (bool ok, bytes memory reason) = leg.target.call(leg.data);
        if (!ok) revert LegFailed(i, reason);
        if (!usdc.approve(leg.target, 0)) revert TransferFailed();
        uint256 got = IBalance(leg.tokenOut).balanceOf(msg.sender) - had;
        if (got < leg.minOut) revert TooLittle(i, got, leg.minOut);
    }
}
