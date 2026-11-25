// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IB20} from "base-std/interfaces/IB20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LaunchFactoryV3} from "../src/LaunchFactoryV3.sol";
import {Backstop, IBackstopLaunchpad} from "../src/Backstop.sol";
import {FeeRouter, IRouterLaunchpad} from "../src/FeeRouter.sol";
import {StageCBase} from "./StageC.t.sol";

/// @dev Random traders, pokes, gifts, collects and distributions against the real factory, hook and
///      PoolManager; the handler records anything that breaks a promise, and the invariants read it.
contract StageCHandler is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    int24 internal constant SPACING = 200;

    IPoolManager internal manager;
    PoolSwapTest internal swapper;
    LaunchFactoryV3 internal factory;
    Backstop public backstop;
    FeeRouter public router;
    address public token;
    address public treasury;
    address internal trader = makeAddr("trader");

    int24 public anchor;
    uint256 public deployedAt;
    uint256 public sentToRouter;
    uint256 public routerToBackstop;
    uint256 public routerToTreasury;
    uint256 public bandAtOrOverPrice;
    uint256 public coinsKeptAfterPoke;
    uint256 public pokes;

    constructor(IPoolManager m, PoolSwapTest s, LaunchFactoryV3 f, Backstop b, FeeRouter r, address t, address tr) {
        manager = m;
        swapper = s;
        factory = f;
        backstop = b;
        router = r;
        token = t;
        treasury = tr;
        anchor = b.lower();
        deployedAt = block.timestamp;
        vm.deal(trader, 10_000 ether);
    }

    function _tick() internal view returns (int24 tick) {
        (, tick,,) = manager.getSlot0(factory.launches(token).key.toId());
    }

    function buy(uint256 amount) external {
        _swap(true, bound(amount, 0.001 ether, 20 ether));
    }

    function sell(uint256 share) external {
        uint256 held = IB20(token).balanceOf(trader);
        if (held == 0) return;
        _swap(false, held * bound(share, 1, 100) / 100);
    }

    function _swap(bool isBuy, uint256 amountIn) internal {
        if (amountIn == 0) return;
        PoolKey memory key = factory.launches(token).key;
        vm.startPrank(trader);
        if (!isBuy) IB20(token).approve(address(swapper), amountIn);
        swapper.swap{value: isBuy ? amountIn : 0}(
            key,
            SwapParams({zeroForOne: isBuy, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: isBuy ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
    }

    function wait(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1 minutes, 3 days));
    }

    function gift(uint256 amount) external {
        amount = bound(amount, 0, 2 ether);
        vm.deal(address(backstop), address(backstop).balance + amount);
    }

    function poke() external {
        try backstop.poke() {
            pokes++;
            if (IB20(token).balanceOf(address(backstop)) != 0) coinsKeptAfterPoke++;
            // a freshly placed band is a bid strictly UNDER the coin's price: above the current tick
            if (backstop.liquidity() > 0 && backstop.lower() <= _tick()) bandAtOrOverPrice++;
        } catch {}
    }

    function collectAndSplit() external {
        uint256 before = address(router).balance;
        factory.collect(token);
        sentToRouter += address(router).balance - before;
        uint256 all = address(router).balance;
        uint256 b0 = address(backstop).balance;
        uint256 t0 = treasury.balance;
        address[] memory eth = new address[](1);
        router.distribute(eth);
        routerToBackstop += address(backstop).balance - b0;
        routerToTreasury += treasury.balance - t0;
        // exactly half (rounded down) to the Backstop, the rest to the treasury, nothing left behind
        assertEq(address(backstop).balance - b0, all / 2);
        assertEq(treasury.balance - t0, all - all / 2);
        assertEq(address(router).balance, 0);
    }
}

contract StageCInvariants is StageCBase {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    StageCHandler internal h;
    uint128 internal launchLiquidity;
    address internal coin;

    function setUp() public override {
        super.setUp();
        coin = _tradedCoin();
        Backstop b = _backstop(coin, 1 ether);
        FeeRouter r = new FeeRouter(IRouterLaunchpad(address(factory)), treasury, address(b));
        vm.prank(protocol);
        factory.proposeProtocolRecipient(address(r));
        r.accept();
        launchLiquidity = _launchLiquidity();
        h = new StageCHandler(manager, router, factory, b, r, coin, treasury);
        targetContract(address(h));
    }

    function _launchLiquidity() internal view returns (uint128 liquidity) {
        LaunchFactoryV3.Position memory p = factory.positions(coin);
        (liquidity,,) = manager.getPositionInfo(factory.launches(coin).key.toId(), address(factory), p.tickLower, p.tickUpper, bytes32(0));
    }

    /// The launch's locked liquidity never shrinks: no path in the factory removes it.
    function invariant_launchLiquidityIsLocked() public view {
        assertEq(_launchLiquidity(), launchLiquidity);
    }

    /// Every band is placed under the price, and every poke leaves no coin behind (all burnt).
    function invariant_bandIsABidAndNothingIsKept() public view {
        assertEq(h.bandAtOrOverPrice(), 0);
        assertEq(h.coinsKeptAfterPoke(), 0);
    }

    /// The band follows a rising price by at most one spacing per DRAG_PERIOD since deployment.
    function invariant_bandClimbsNoFasterThanTheDrag() public view {
        uint256 days_ = (block.timestamp - h.deployedAt()) / h.backstop().DRAG_PERIOD();
        assertGe(int256(h.backstop().lower()), int256(h.anchor()) - int256(SPACING) * int256(days_));
    }

    /// The router's ETH split is exactly half and half, summed over every collect.
    function invariant_routerSplitsHalfAndHalf() public view {
        assertEq(h.routerToBackstop() + h.routerToTreasury(), h.sentToRouter());
        assertLe(h.routerToTreasury() - h.routerToBackstop(), 100, "only rounding wei apart");
    }

    /// Burnt coins only ever go up, and they are at the dead address.
    function invariant_burntIsAtTheDeadAddress() public view {
        assertGe(IB20(coin).balanceOf(DEAD), h.backstop().burned());
    }
}
