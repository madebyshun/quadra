// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

/// @notice What the Backstop reads from this app's launchpad: the coin's pool key.
interface IBackstopLaunchpad {
    struct Launch {
        address creator;
        address creatorRecipient;
        PoolKey key;
    }

    function launches(address token) external view returns (Launch memory);
}

/// @title Backstop
///
/// @notice Stage C (2026-11-25, docs/BACKSTOP.md): ETH that buys $QUADRA back and burns it, with no oracle and no
///         one pressing a button. The ETH is kept as ONE single-sided position on the coin's own Uniswap v4 pool,
///         just under the coin's price — with ETH as currency0, an ETH-only position sits ABOVE the current tick.
///         A seller of the coin pushes the tick up into it and the position turns ETH into the coin: a buyback at
///         or below the market, filled by the seller's own trade. Nothing here ever sends a swap.
///
///         `poke()` — anyone, at most once per `MIN_INTERVAL` — takes the position out (ETH, coins and the fees it
///         earned), sends every coin it holds to the dead address, and places all of its ETH again in a band of
///         `WIDTH` starting `GAP` above the current tick.
///
/// @dev    The one attack left: pump the coin, poke so the band follows the price, then sell into it at the
///         pumped price. The band is anchored at deployment and follows a rising price by one spacing (~2%) per
///         `DRAG_PERIOD` at most, while the attacker holds the pump and pays the pool fee both ways — MEASURED on
///         the real pool by scripts/simulate-backstop.ts. No owner, no upgrade, no pause, no way for anyone to
///         take the ETH out but a seller of the coin.
contract Backstop is IUnlockCallback {
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @notice Where burnt coins go. The coin is a B20 with no admin, so nothing can bring them back.
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    /// @notice The band, in pool tick spacings: its distance above the current tick and its width.
    int24 public constant GAP_SPACINGS = 1;
    int24 public constant WIDTH_SPACINGS = 1;
    /// @notice A band may follow a RISING coin price by one spacing (~2%) per this much time, and no faster.
    ///         MEASURED 2026-11-25 (scripts/simulate-backstop.ts, the real pool): at one spacing per 30-minute poke,
    ///         pump 1 ETH, poke 12 times over 6 h and dump into a 0.2 ETH band netted the attacker +0.013 ETH; at one
    ///         spacing per 6 h the same took 72 h. At 24 h it takes twelve days of holding the pump, alone, exposed.
    uint256 public constant DRAG_PERIOD = 24 hours;
    /// @notice The least time between two pokes once a band is placed.
    uint256 public constant MIN_INTERVAL = 30 minutes;
    /// @notice Less ETH than this is kept, not placed.
    uint256 public constant MIN_ETH = 0.001 ether;

    IPoolManager public immutable poolManager;
    /// @notice The coin bought back and burnt.
    address public immutable token;

    uint24 internal immutable _fee;
    int24 internal immutable _spacing;
    address internal immutable _hooks;

    /// @notice The band placed now (or, with no liquidity, the last one — the anchor a new band is held to), its
    ///         liquidity, when the last poke ran, and when the band last moved up to a higher coin price.
    int24 public lower;
    int24 public upper;
    uint128 public liquidity;
    uint256 public lastPoke;
    uint256 public movedUpAt;
    /// @notice Coins this contract has burnt, ever.
    uint256 public burned;

    uint256 private _locked = 1;

    event Burned(uint256 amount);
    event Placed(int24 lower, int24 upper, uint128 liquidity, uint256 eth);

    error NotLaunched();
    error NotEthPair();
    error NotPoolManager();
    error TooSoon(uint256 possibleAt);
    error Reentrancy();

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(IBackstopLaunchpad launchpad_, IPoolManager poolManager_, address token_) {
        IBackstopLaunchpad.Launch memory l = launchpad_.launches(token_);
        if (l.creator == address(0)) revert NotLaunched();
        // ETH is always currency0 in an ETH pair (the zero address sorts first); anything else is not this design
        if (!l.key.currency0.isAddressZero()) revert NotEthPair();
        poolManager = poolManager_;
        token = token_;
        _fee = l.key.fee;
        _spacing = l.key.tickSpacing;
        _hooks = address(l.key.hooks);
        // anchored at deployment: MEASURED, a first band placed right under a pumped price was the attack —
        // buy 1 ETH, poke, dump into a 0.2 ETH band netted the buyer +0.033 ETH
        (, int24 tick,,) = poolManager_.getSlot0(l.key.toId());
        lower = _above(tick, l.key.tickSpacing) + GAP_SPACINGS * l.key.tickSpacing;
        upper = lower + WIDTH_SPACINGS * l.key.tickSpacing;
        movedUpAt = block.timestamp;
    }

    /// @dev The first spacing boundary strictly above `tick` (floor division, right for negative ticks too).
    function _above(int24 tick, int24 s) private pure returns (int24) {
        return tick - (((tick % s) + s) % s) + s;
    }

    /// @notice ETH from the FeeRouter, from anyone, and from the PoolManager when a band comes out.
    receive() external payable {}

    /// @notice Take the band out, burn every coin held, and place all the ETH under the current price again.
    function poke() external nonReentrant {
        if (liquidity > 0 && block.timestamp < lastPoke + MIN_INTERVAL) revert TooSoon(lastPoke + MIN_INTERVAL);
        lastPoke = block.timestamp;
        poolManager.unlock("");
        uint256 coins = Currency.wrap(token).balanceOfSelf();
        if (coins > 0) {
            burned += coins;
            Currency.wrap(token).transfer(DEAD, coins);
            emit Burned(coins);
        }
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        PoolKey memory key = _key();
        int256 eth;
        int256 coins;
        if (liquidity > 0) {
            // casting to int256 is safe: a uint128 always fits
            // forge-lint: disable-next-line(unsafe-typecast)
            (BalanceDelta out,) = poolManager.modifyLiquidity(key, ModifyLiquidityParams(lower, upper, -int256(uint256(liquidity)), 0), "");
            eth += out.amount0();
            coins += out.amount1();
        }
        (, int24 tick,,) = poolManager.getSlot0(key.toId());
        int24 s = _spacing;
        int24 next = _above(tick, s) + GAP_SPACINGS * s;
        // a lower coin price (a higher tick) is followed at once; a higher one by one spacing per DRAG_PERIOD,
        // held to the last band even when it is empty — never to a price an attacker just pumped
        if (next < lower) {
            uint256 periods = (block.timestamp - movedUpAt) / DRAG_PERIOD;
            int24 floorTick = periods == 0 ? lower : lower - s;
            if (next < floorTick) next = floorTick;
            if (next < lower) movedUpAt = block.timestamp;
        }
        // casting to int256 is safe: a balance is far below 2^255
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 available = address(this).balance + uint256(eth);
        uint128 placed;
        if (available >= MIN_ETH) {
            int24 top = next + WIDTH_SPACINGS * s;
            placed = LiquidityAmounts.getLiquidityForAmount0(TickMath.getSqrtPriceAtTick(next), TickMath.getSqrtPriceAtTick(top), available);
            // casting to int256 is safe: a uint128 always fits
            // forge-lint: disable-next-line(unsafe-typecast)
            (BalanceDelta added,) = poolManager.modifyLiquidity(key, ModifyLiquidityParams(next, top, int256(uint256(placed)), 0), "");
            eth += added.amount0();
            lower = next;
            upper = top;
            // casting to uint256 is safe: adding a band only ever takes ETH in, so its amount0 is at most zero
            // forge-lint: disable-next-line(unsafe-typecast)
            emit Placed(next, top, placed, uint256(-int256(added.amount0())));
        }
        liquidity = placed;
        // ETH: the band out minus the band in — pay the difference, or take it back
        if (eth < 0) {
            // casting to uint256 is safe: `eth` is negative here
            // forge-lint: disable-next-line(unsafe-typecast)
            poolManager.settle{value: uint256(-eth)}();
        } else if (eth > 0) {
            // casting to uint256 is safe: `eth` is positive here
            // forge-lint: disable-next-line(unsafe-typecast)
            poolManager.take(CurrencyLibrary.ADDRESS_ZERO, address(this), uint256(eth));
        }
        // casting to uint256 is safe: coins only ever come OUT of a band
        // forge-lint: disable-next-line(unsafe-typecast)
        if (coins > 0) poolManager.take(Currency.wrap(token), address(this), uint256(coins));
        return "";
    }

    function _key() internal view returns (PoolKey memory) {
        return PoolKey(CurrencyLibrary.ADDRESS_ZERO, Currency.wrap(token), _fee, _spacing, IHooks(_hooks));
    }
}
