// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @title LaunchHook
///
/// @notice The Uniswap v4 hook every LaunchFactoryV3 pool uses, and nothing else. It does two things:
///         sets each swap's LP fee — the coin's chosen fee (1% or 3%), except during the first
///         `window` seconds after the pool opens, when it falls in a straight line from `startFee`
///         to the chosen fee (the anti-sniper opening) — and refuses any pool its factory did not open.
///
/// @dev What it CANNOT do, by construction:
///      - take anything: its address grants no return-delta permission, so it cannot move a single
///        wei of a swap or a liquidity change (the fee it sets is an LP fee, paid to the pool's
///        liquidity — the factory's locked position — never to the hook);
///      - touch liquidity: it never calls the pool manager, and it has no remove-liquidity permission,
///        so it can neither add, remove, nor block removing liquidity;
///      - change a fee: it has no owner and no setter. `startFee` and `window` are immutable, and a
///        pool's chosen fee and opening time are written once, by the factory, before the pool exists.
///
///      Its permissions are the bits of its own address (mined with a CREATE2 salt — see
///      script/DeployLaunchFactoryV3.s.sol): beforeInitialize, beforeAddLiquidity, beforeSwap — and the
///      constructor refuses any address whose bits say otherwise.
contract LaunchHook {
    using PoolIdLibrary for PoolKey;

    /// @notice The two fees a launcher may choose, in hundredths of a basis point: 1% and 3%.
    uint24 public constant FEE_LOW = 10_000;
    uint24 public constant FEE_HIGH = 30_000;

    IPoolManager public immutable poolManager;
    /// @notice The only contract that may open a pool with this hook — the one that deployed it.
    address public immutable factory;
    /// @notice The LP fee at the second the pool opens.
    uint24 public immutable startFee;
    /// @notice How long, in seconds, the fee takes to fall from `startFee` to the coin's chosen fee.
    uint32 public immutable window;

    struct Schedule {
        /// @notice the coin's chosen fee (FEE_LOW or FEE_HIGH); 0 for a pool this hook never opened
        uint24 fee;
        /// @notice the block timestamp the pool opened at
        uint40 openedAt;
    }

    mapping(PoolId id => Schedule) public schedules;

    error NotPoolManager();
    error NotFactory();
    error BadSchedule();
    error Opening();

    constructor(IPoolManager manager, uint24 startFee_, uint32 window_) {
        // the opening fee must be a valid LP fee and at least the highest chosen fee, so it only ever falls
        if (startFee_ > LPFeeLibrary.MAX_LP_FEE || startFee_ < FEE_HIGH || window_ == 0) revert BadSchedule();
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: true,
                afterInitialize: false,
                beforeAddLiquidity: true,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: false,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: false,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
        poolManager = manager;
        factory = msg.sender;
        startFee = startFee_;
        window = window_;
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    /// @notice Written by the factory once, just before it opens the pool: the chosen fee, and now.
    function register(PoolId id, uint24 fee) external {
        if (msg.sender != factory) revert NotFactory();
        schedules[id] = Schedule({fee: fee, openedAt: uint40(block.timestamp)});
    }

    /// @notice The LP fee a swap on this pool pays now (anyone's but the factory's own first buy).
    function currentFee(PoolId id) public view returns (uint24) {
        Schedule memory s = schedules[id];
        uint256 elapsed = block.timestamp - s.openedAt;
        if (elapsed >= window) return s.fee;
        // a straight line from startFee at 0 s down to the chosen fee at `window` s, rounded down
        // casting to uint24 is safe: the result lies between s.fee and startFee, both at most MAX_LP_FEE
        // forge-lint: disable-next-line(unsafe-typecast)
        return s.fee + uint24(uint256(startFee - s.fee) * (window - elapsed) / window);
    }

    // ───────────────────────────────────────────────────────────── the pool manager's calls

    /// @notice Only the factory opens pools with this hook.
    function beforeInitialize(address sender, PoolKey calldata, uint160) external view onlyPoolManager returns (bytes4) {
        if (sender != factory) revert NotFactory();
        return IHooks.beforeInitialize.selector;
    }

    /// @notice Nobody but the factory adds liquidity while the opening fee is falling — the opening
    ///         fee is the launch's, not something to be skimmed by liquidity added in front of it.
    function beforeAddLiquidity(address sender, PoolKey calldata key, ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4)
    {
        if (sender != factory && block.timestamp < uint256(schedules[key.toId()].openedAt) + window) revert Opening();
        return IHooks.beforeAddLiquidity.selector;
    }

    /// @notice The fee, overriding the pool's stored one. The factory's own swap — the launcher's
    ///         first buy, inside the launch transaction — pays the chosen fee, not the opening one.
    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        uint24 fee = sender == factory ? schedules[id].fee : currentFee(id);
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }
}
