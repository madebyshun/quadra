// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IB20} from "base-std/interfaces/IB20.sol";
import {IB20Factory} from "base-std/interfaces/IB20Factory.sol";
import {StdPrecompiles} from "base-std/StdPrecompiles.sol";
import {B20FactoryLib} from "base-std/lib/B20FactoryLib.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LaunchFactoryV3} from "../src/LaunchFactoryV3.sol";
import {HookSalt} from "../script/HookSalt.sol";
import {Backstop, IBackstopLaunchpad} from "../src/Backstop.sol";
import {FeeRouter, IRouterLaunchpad} from "../src/FeeRouter.sol";
import {OddToken3, LateTaker3} from "./LaunchFactoryV3.t.sol";

/// @dev Stage C against the REAL B20 precompile, a REAL v4 PoolManager and the real v3 factory and hook:
///      a coin launched on ETH, real buys and sells, a Backstop band on its own pool and the FeeRouter as the
///      factory's protocol recipient.
contract StageCTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    int24 internal constant START = 191_200;
    int24 internal constant STOCK_START = 382_000;
    uint24 internal constant ONE = 10_000;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    int24 internal constant SPACING = 200;
    /// where Backstop's `_locked` lives: after lower|upper|liquidity (one slot), lastPoke, movedUpAt, burned
    uint256 internal constant BACKSTOP_LOCK = 4;
    /// where FeeRouter's `_locked` lives: after pendingMove, moveAnnouncedAt
    uint256 internal constant ROUTER_LOCK = 2;

    IPoolManager internal manager;
    PoolSwapTest internal router;
    LaunchFactoryV3 internal factory;
    IB20 internal stock;

    address internal protocol = makeAddr("protocol");
    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        vm.warp(1_760_000_000);
        manager = new PoolManager(address(this));
        router = new PoolSwapTest(manager);
        address next = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        (bytes32 salt,) = HookSalt.find(next, HookSalt.initCodeHash(manager, 500_000, 15));
        factory = new LaunchFactoryV3(manager, protocol, admin, START, 500_000, 15, salt);
        vm.deal(alice, 1_000 ether);
        vm.deal(bob, 1_000 ether);
        bytes[] memory init = new bytes[](1);
        init[0] = abi.encodeCall(IB20.mint, (alice, 1_000e8));
        stock = IB20(
            StdPrecompiles.B20_FACTORY.createB20(
                IB20Factory.B20Variant.ASSET, bytes32(uint256(77)), B20FactoryLib.encodeAssetCreateParams("AAPLc", "AAPLc", address(this), 8), init
            )
        );
        vm.prank(admin);
        factory.setQuote(address(stock), true, STOCK_START);
    }

    // ───────────────────────────────────────────────────────────── helpers

    function _launch(address quote) internal returns (address token) {
        bytes32 salt = bytes32(uint256(1));
        // a stock pair whose coin sorts ABOVE the stock: currency0 is then the stock, not ETH
        if (quote != address(0)) {
            for (uint256 i = 1; ; i++) {
                salt = bytes32(i);
                if (factory.predictToken(alice, salt) > quote) break;
            }
        }
        vm.prank(alice);
        token = factory.launch("Quadra", "QUADRA", "", salt, quote, 0, ONE, address(0));
    }

    function _swap(address who, address token, bool buy, uint256 amountIn) internal {
        PoolKey memory key = factory.launches(token).key;
        vm.startPrank(who);
        if (!buy) IB20(token).approve(address(router), amountIn);
        router.swap{value: buy ? amountIn : 0}(
            key,
            SwapParams({zeroForOne: buy, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: buy ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
    }

    function _tick(address token) internal view returns (int24 tick) {
        (, tick,,) = manager.getSlot0(factory.launches(token).key.toId());
    }

    /// An ETH coin past its opening window, with a buy in its pool so there is ETH to sell back into.
    function _tradedCoin() internal returns (address token) {
        token = _launch(address(0));
        vm.warp(block.timestamp + 60);
        _swap(bob, token, true, 10 ether);
    }

    function _backstop(address token, uint256 eth) internal returns (Backstop b) {
        b = new Backstop(IBackstopLaunchpad(address(factory)), manager, token);
        vm.deal(address(b), eth);
    }

    // ───────────────────────────────────────────────────────────── Backstop

    function test_backstop_refusesACoinNotLaunchedOrNotPairedWithEth() public {
        vm.expectRevert(Backstop.NotLaunched.selector);
        new Backstop(IBackstopLaunchpad(address(factory)), manager, makeAddr("nothing"));
        address stockCoin = _launch(address(stock));
        vm.expectRevert(Backstop.NotEthPair.selector);
        new Backstop(IBackstopLaunchpad(address(factory)), manager, stockCoin);
    }

    /// The band sits just under the coin's price (above the tick, ETH only), and holds all the ETH.
    function test_backstop_placesAllItsEthJustUnderThePrice() public {
        address token = _tradedCoin();
        Backstop b = _backstop(token, 1 ether);
        int24 tick = _tick(token);
        b.poke();
        int24 above = tick - (((tick % SPACING) + SPACING) % SPACING) + SPACING;
        assertEq(b.lower(), above + SPACING);
        assertEq(b.upper(), above + 2 * SPACING);
        assertGt(b.liquidity(), 0);
        assertLt(address(b).balance, 1e6, "only rounding dust stays out");
        assertEq(b.lastPoke(), block.timestamp);
        // the next poke waits for its interval while a band is placed
        vm.expectRevert(abi.encodeWithSelector(Backstop.TooSoon.selector, block.timestamp + 30 minutes));
        b.poke();
    }

    /// A seller of the coin fills the band; the next poke burns every coin it bought and places the rest again.
    function test_backstop_aSellerFillsItAndThePokeBurnsWhatItBought() public {
        address token = _tradedCoin();
        Backstop b = _backstop(token, 1 ether);
        b.poke();
        uint256 held = IB20(token).balanceOf(bob);
        _swap(bob, token, false, held);
        assertGt(_tick(token), b.lower(), "the sale went through the band");
        vm.warp(block.timestamp + 30 minutes);
        uint256 deadBefore = IB20(token).balanceOf(DEAD);
        b.poke();
        assertGt(b.burned(), 0);
        assertEq(IB20(token).balanceOf(DEAD) - deadBefore, b.burned());
        assertEq(IB20(token).balanceOf(address(b)), 0, "nothing bought is kept");
        // the whole band was bought through: no ETH left to place
        assertEq(b.liquidity(), 0);
        assertLt(address(b).balance, 0.001 ether);
        // new ETH (the router's next share) is placed under the NEW price at once: no band, no interval
        vm.deal(address(b), 1 ether);
        b.poke();
        assertGt(b.liquidity(), 0);
        assertGt(b.lower(), _tick(token), "placed again under the new price");
    }

    /// The band is anchored where the price was at deployment: a pump does not move it before DRAG_PERIOD, and
    /// then by one spacing — a first band is never placed right under a price someone just pumped.
    function test_backstop_followsARisingPriceByOneStepPerDay() public {
        address token = _tradedCoin();
        Backstop b = _backstop(token, 1 ether);
        int24 anchor = b.lower();
        _swap(alice, token, true, 300 ether);
        assertLt(_tick(token) + 4 * SPACING, anchor, "a pump far past one step");
        b.poke();
        assertEq(b.lower(), anchor, "held at the anchor, even for the first band");
        vm.warp(block.timestamp + 23 hours);
        b.poke();
        assertEq(b.lower(), anchor, "not yet a day");
        vm.warp(block.timestamp + 1 hours);
        b.poke();
        assertEq(b.lower(), anchor - SPACING, "one step after a day");
        assertEq(b.movedUpAt(), block.timestamp);
        vm.warp(block.timestamp + 2 days);
        b.poke();
        assertEq(b.lower(), anchor - 2 * SPACING, "still one step, however long it waited");
    }

    /// Too little ETH is kept, not placed — and a band of exactly the minimum, taken out again, leaves rounding
    /// short of the minimum, so its ETH is taken back rather than placed.
    function test_backstop_keepsTooLittleEthAndTakesItBack() public {
        address token = _tradedCoin();
        Backstop small = _backstop(token, 0.0005 ether);
        small.poke();
        assertEq(small.liquidity(), 0);
        small.poke(); // no band: no interval to wait for
        Backstop edge = _backstop(token, 0.001 ether);
        edge.poke();
        assertGt(edge.liquidity(), 0);
        vm.warp(block.timestamp + 30 minutes);
        edge.poke();
        assertEq(edge.liquidity(), 0, "short of the minimum once rounded");
        assertGt(address(edge).balance, 0.000999 ether, "the ETH came back");
    }

    function test_backstop_refusesAPoolInsideItsOpeningWindow() public {
        address token = _launch(address(0));
        Backstop b = _backstop(token, 1 ether);
        vm.expectRevert();
        b.poke();
    }

    function test_backstop_takesCallsOnlyFromThePoolManagerAndRefusesReentry() public {
        address token = _tradedCoin();
        Backstop b = _backstop(token, 1 ether);
        vm.expectRevert(Backstop.NotPoolManager.selector);
        b.unlockCallback("");
        assertEq(uint256(vm.load(address(b), bytes32(BACKSTOP_LOCK))), 1, "the lock's slot");
        vm.store(address(b), bytes32(BACKSTOP_LOCK), bytes32(uint256(2)));
        vm.expectRevert(Backstop.Reentrancy.selector);
        b.poke();
        // anyone may send it ETH
        vm.prank(bob);
        (bool ok,) = address(b).call{value: 1 ether}("");
        assertTrue(ok);
    }

    // ───────────────────────────────────────────────────────────── FeeRouter

    function _router(address backstop) internal returns (FeeRouter r) {
        r = new FeeRouter(IRouterLaunchpad(address(factory)), treasury, backstop);
        vm.prank(protocol);
        factory.proposeProtocolRecipient(address(r));
        r.accept();
    }

    function test_router_refusesAZeroAddress() public {
        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        new FeeRouter(IRouterLaunchpad(address(0)), treasury, alice);
        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        new FeeRouter(IRouterLaunchpad(address(factory)), address(0), alice);
        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        new FeeRouter(IRouterLaunchpad(address(factory)), treasury, address(0));
    }

    /// Every coin's protocol share reaches the router; ETH is split half to the Backstop, the coin goes to the treasury.
    function test_router_splitsEveryCoinsProtocolShare() public {
        address backstop = makeAddr("backstop");
        FeeRouter r = _router(backstop);
        assertEq(factory.protocolRecipient(), address(r));
        address token = _tradedCoin();
        _swap(bob, token, false, IB20(token).balanceOf(bob) / 2);
        factory.collect(token);
        uint256 eth = address(r).balance;
        uint256 coins = IB20(token).balanceOf(address(r));
        assertGt(eth, 0);
        assertGt(coins, 0);
        address[] memory both = new address[](2);
        both[1] = token;
        r.distribute(both);
        assertEq(backstop.balance, eth / 2);
        assertEq(treasury.balance, eth - eth / 2);
        assertEq(IB20(token).balanceOf(treasury), coins);
        assertEq(address(r).balance, 0);
    }

    function test_router_forwardsReferrersForTheTreasuryAlone() public {
        FeeRouter r = _router(makeAddr("backstop"));
        vm.prank(treasury);
        r.setReferrer(bob, true);
        assertTrue(factory.approvedReferrers(bob));
        vm.expectRevert(FeeRouter.NotTreasury.selector);
        r.setReferrer(bob, false);
    }

    /// The escape: announced in public, possible only seven days later, and cancellable until then.
    function test_router_movesTheRecipientOnlyAfterAPublicDelay() public {
        FeeRouter r = _router(makeAddr("backstop"));
        address next = makeAddr("next");
        vm.startPrank(treasury);
        vm.expectRevert(FeeRouter.NoMove.selector);
        r.executeMove();
        vm.expectRevert(FeeRouter.NoMove.selector);
        r.cancelMove();
        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        r.announceMove(address(0));
        r.announceMove(next);
        vm.expectRevert(abi.encodeWithSelector(FeeRouter.TooEarly.selector, block.timestamp + 7 days));
        r.executeMove();
        r.cancelMove();
        assertEq(r.pendingMove(), address(0));
        r.announceMove(next);
        vm.warp(block.timestamp + 7 days);
        r.executeMove();
        vm.stopPrank();
        assertEq(factory.pendingProtocolRecipient(), next);
        assertEq(r.pendingMove(), address(0));
        // nobody else holds these powers
        vm.startPrank(bob);
        vm.expectRevert(FeeRouter.NotTreasury.selector);
        r.announceMove(next);
        vm.expectRevert(FeeRouter.NotTreasury.selector);
        r.cancelMove();
        vm.expectRevert(FeeRouter.NotTreasury.selector);
        r.executeMove();
        vm.stopPrank();
    }

    function test_router_pullsWhatTheFactoryKeptForIt() public {
        FeeRouter r = _router(makeAddr("backstop"));
        // nothing kept: the factory's own refusal comes through
        vm.expectRevert(LaunchFactoryV3.NothingOwed.selector);
        r.pullOwed(Currency.wrap(address(0)));
    }

    /// A refused ETH payout, a token answering false or reverting, are refusals; one answering nothing is paid.
    function test_router_refusesAFailedPayoutAndPaysATokenThatReturnsNothing() public {
        LateTaker3 closed = new LateTaker3();
        FeeRouter r = new FeeRouter(IRouterLaunchpad(address(factory)), treasury, address(closed));
        vm.deal(address(r), 1 ether);
        address[] memory eth = new address[](1);
        vm.expectRevert(FeeRouter.TransferFailed.selector);
        r.distribute(eth);
        OddToken3 odd = new OddToken3();
        odd.mint(address(r), 100);
        address[] memory tok = new address[](1);
        tok[0] = address(odd);
        odd.setMode(OddToken3.Mode.ReturnsFalse);
        vm.expectRevert(FeeRouter.TransferFailed.selector);
        r.distribute(tok);
        odd.setMode(OddToken3.Mode.NoReturn);
        r.distribute(tok);
        assertEq(odd.balanceOf(treasury), 100);
        // a token that reverts (no balance to move but a claim of one) is a refusal too
        odd.setMode(OddToken3.Mode.Normal);
        odd.mint(address(r), 1);
        vm.mockCallRevert(address(odd), abi.encodeWithSignature("transfer(address,uint256)", treasury, 1), "nope");
        vm.expectRevert(FeeRouter.TransferFailed.selector);
        r.distribute(tok);
    }

    function test_router_refusesReentry() public {
        FeeRouter r = new FeeRouter(IRouterLaunchpad(address(factory)), treasury, alice);
        assertEq(uint256(vm.load(address(r), bytes32(ROUTER_LOCK))), 1, "the lock's slot");
        vm.store(address(r), bytes32(ROUTER_LOCK), bytes32(uint256(2)));
        vm.expectRevert(FeeRouter.Reentrancy.selector);
        r.distribute(new address[](0));
    }

    /// REVIEW 2026-11-26 B1 (PoC): an EMPTY poke after a day resets the drag clock without moving the band.
    function test_review_emptyPokeResetsTheDragClock() public {
        address token = _tradedCoin();
        Backstop b = _backstop(token, 0);
        int24 anchor = b.lower();
        _swap(alice, token, true, 300 ether);
        for (uint256 d; d < 5; ++d) {
            vm.warp(block.timestamp + 1 days);
            b.poke(); // anyone, no ETH: nothing placed
        }
        assertEq(b.lower(), anchor, "never moved");
        vm.deal(address(b), 1 ether);
        b.poke();
        assertEq(b.lower(), anchor, "five days later the first funded band is still at the deploy anchor");
    }
}
