// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IB20} from "base-std/interfaces/IB20.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LaunchFactoryV3} from "../src/LaunchFactoryV3.sol";
import {QuadraFurnace} from "../src/QuadraFurnace.sol";
import {BasketRouter} from "../src/BasketRouter.sol";
import {QuadraFurnaceBase} from "./QuadraFurnace.t.sol";
import {BasketRouterBase, TestUSDC, TestToken, TestRelayProxy} from "./BasketRouter.t.sol";

// ───────────────────────────────────────────────────────────── QuadraFurnace

/// @dev Random trades, harvests, gifts and the treasury's buybacks on an ETH-paired coin whose creator share
///      goes to the furnace. After every call the furnace must hold exactly what it owes and has set aside.
contract FurnaceHandler is Test {
    PoolSwapTest internal swapper;
    LaunchFactoryV3 internal factory;
    QuadraFurnace public furnace;
    address public token;
    address public treasury;
    address internal trader = makeAddr("furnace-trader");

    uint256 public coinsKept;
    uint256 public ethShort;
    uint256 public setAsideIn;
    uint256 public treasuryEthIn;

    constructor(PoolSwapTest s, LaunchFactoryV3 f, QuadraFurnace fu, address t, address tr) {
        swapper = s;
        factory = f;
        furnace = fu;
        token = t;
        treasury = tr;
        vm.deal(trader, 10_000 ether);
    }

    function buy(uint256 amount) external {
        _swap(true, bound(amount, 0.001 ether, 20 ether));
    }

    function sell(uint256 share) external {
        uint256 held = IB20(token).balanceOf(trader);
        if (held > 0) _swap(false, held * bound(share, 1, 100) / 100);
    }

    function _swap(bool isBuy, uint256 amountIn) internal {
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
        _check();
    }

    function harvest() external {
        uint256 toBuy0 = furnace.toBuy();
        uint256 t0 = treasury.balance;
        furnace.harvest();
        setAsideIn += furnace.toBuy() - toBuy0;
        treasuryEthIn += treasury.balance - t0;
        _check();
    }

    function gift(uint256 amount) external {
        amount = bound(amount, 0, 1 ether);
        uint256 toBuy0 = furnace.toBuy();
        uint256 t0 = treasury.balance;
        vm.deal(address(furnace), address(furnace).balance + amount);
        furnace.distribute();
        setAsideIn += furnace.toBuy() - toBuy0;
        treasuryEthIn += treasury.balance - t0;
        _check();
    }

    function buyBack(uint256 share) external {
        uint256 amount = furnace.toBuy() * bound(share, 1, 100) / 100;
        if (amount == 0) return;
        uint256 t0 = treasury.balance;
        uint256 toBuy0 = furnace.toBuy();
        vm.prank(treasury);
        furnace.buyAndBurn(amount, 0);
        // buyAndBurn distributes first: count what that split added before the spend
        setAsideIn += furnace.toBuy() + amount - toBuy0;
        treasuryEthIn += treasury.balance - t0;
        _check();
    }

    function wait(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1 minutes, 2 days));
    }

    /// The furnace keeps no coin but what the treasury refused, and holds at least the ETH it set aside.
    function _check() internal {
        if (IB20(token).balanceOf(address(furnace)) != furnace.treasuryOwed(Currency.wrap(token))) coinsKept++;
        if (address(furnace).balance < furnace.toBuy() + furnace.treasuryOwed(CurrencyLibrary.ADDRESS_ZERO)) ethShort++;
    }
}

contract FurnaceInvariants is QuadraFurnaceBase {
    FurnaceHandler internal h;
    address internal coin;

    function setUp() public override {
        super.setUp();
        coin = _launch(address(0), true);
        QuadraFurnace f = _furnace(coin, treasury, 5_000);
        vm.warp(block.timestamp + 60);
        h = new FurnaceHandler(router, factory, f, coin, treasury);
        targetContract(address(h));
    }

    function invariant_furnaceHoldsWhatItOwesAndNothingMore() public view {
        assertEq(h.coinsKept(), 0, "a coin was kept, not burnt or paid");
        assertEq(h.ethShort(), 0, "less ETH than set aside");
    }

    /// Half of every ETH arrival is set aside, half goes to the treasury (to the wei of rounding per call).
    function invariant_furnaceSplitsEthHalfAndHalf() public view {
        uint256 a = h.setAsideIn();
        uint256 b = h.treasuryEthIn();
        assertLe(a > b ? a - b : b - a, 1_000, "only rounding wei apart");
    }

    function invariant_furnaceBurnsAreAtTheDeadAddress() public view {
        QuadraFurnace f = h.furnace();
        assertGe(IB20(coin).balanceOf(DEAD), f.burnedFromFees() + f.burnedFromBuybacks());
    }

    function invariant_furnaceSpendsOnlyWhatItSetAside() public view {
        QuadraFurnace f = h.furnace();
        assertEq(f.quoteSpent() + f.toBuy(), h.setAsideIn());
    }
}

// ───────────────────────────────────────────────────────────── BasketRouter

/// @dev A victim with a standing (max) approval to the router never calls it; an attacker and a buyer send
///      random baskets, some that fail. Nobody may spend the victim's USDC, and the router keeps nothing.
contract BasketHandler is Test {
    TestUSDC internal usdc;
    TestToken internal out;
    TestRelayProxy internal proxy;
    BasketRouter internal router;
    address public victim = makeAddr("victim");
    address internal attacker = makeAddr("attacker");
    uint256 public pulledByProxy;
    uint256 public spentByCallers;

    constructor(TestUSDC u, TestToken o, TestRelayProxy p, BasketRouter r) {
        usdc = u;
        out = o;
        proxy = p;
        router = r;
        usdc.mint(victim, 1_000_000e6);
        vm.prank(victim);
        usdc.approve(address(router), type(uint256).max);
        usdc.mint(attacker, 1_000_000e6);
    }

    function basket(uint256 amountIn, uint256 pull, uint256 delivered, uint256 minOut, address to) external {
        amountIn = bound(amountIn, 1, 10_000e6);
        pull = bound(pull, 0, amountIn);
        delivered = bound(delivered, 0, 1e12);
        minOut = bound(minOut, 0, 1e12);
        BasketRouter.Leg[] memory legs = new BasketRouter.Leg[](1);
        // the attacker may even ask Relay to deliver to someone else, or pull from the victim's name
        legs[0] = BasketRouter.Leg({
            target: address(proxy),
            amountIn: amountIn,
            tokenOut: address(out),
            minOut: minOut,
            data: abi.encodeCall(TestRelayProxy.swap, (pull, out, to == address(0) ? attacker : to, delivered))
        });
        uint256 before = usdc.balanceOf(attacker);
        vm.startPrank(attacker);
        usdc.approve(address(router), amountIn);
        try router.buy(legs, type(uint256).max) {
            pulledByProxy += pull;
            spentByCallers += before - usdc.balanceOf(attacker);
        } catch {}
        usdc.approve(address(router), 0);
        vm.stopPrank();
    }
}

contract BasketInvariants is BasketRouterBase {
    BasketHandler internal h;

    function setUp() public override {
        super.setUp();
        h = new BasketHandler(usdc, nvda, proxyA, router);
        targetContract(address(h));
    }

    function invariant_aStandingApprovalIsNeverSpentByAnother() public view {
        assertEq(usdc.balanceOf(h.victim()), 1_000_000e6);
    }

    function invariant_theRouterKeepsNothing() public view {
        assertEq(usdc.balanceOf(address(router)), 0);
        assertEq(usdc.allowance(address(router), address(proxyA)), 0);
    }

    /// A caller pays exactly what the legs used; the unused part came back in the same transaction.
    function invariant_aBuyerPaysOnlyWhatTheLegsUsed() public view {
        assertEq(h.spentByCallers(), h.pulledByProxy());
    }
}
