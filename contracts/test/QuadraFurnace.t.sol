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
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LaunchFactoryV3} from "../src/LaunchFactoryV3.sol";
import {HookSalt} from "../script/HookSalt.sol";
import {QuadraFurnace, IFurnaceLaunchpad} from "../src/QuadraFurnace.sol";
import {OddToken3, LateTaker3} from "./LaunchFactoryV3.t.sol";

/// @dev Against the REAL B20 precompile, a REAL v4 PoolManager and the real v3 factory and hook, as
///      the v3 suite: a coin launched on a stock pair or on ETH, its creator share pointed at a furnace,
///      real buys and sells making real fees.
contract QuadraFurnaceTest is Test {
    int24 internal constant START = 191_200;
    int24 internal constant STOCK_START = 382_000;
    uint24 internal constant ONE = 10_000;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    /// where `_locked` lives: after toBuy, burnedFromFees, burnedFromBuybacks, quoteSpent, treasuryOwed
    uint256 internal constant LOCK_SLOT = 5;

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
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        bytes[] memory init = new bytes[](2);
        init[0] = abi.encodeCall(IB20.mint, (alice, 1_000e8));
        init[1] = abi.encodeCall(IB20.mint, (bob, 1_000e8));
        stock = IB20(
            StdPrecompiles.B20_FACTORY.createB20(
                IB20Factory.B20Variant.ASSET, bytes32(uint256(77)), B20FactoryLib.encodeAssetCreateParams("AAPLc", "AAPLc", address(this), 8), init
            )
        );
        vm.prank(admin);
        factory.setQuote(address(stock), true, STOCK_START);
    }

    // ───────────────────────────────────────────────────────────── helpers

    function _saltFor(address quote, bool tokenAbove) internal view returns (bytes32 salt) {
        for (uint256 i = 1; ; i++) {
            salt = bytes32(i);
            if ((factory.predictToken(alice, salt) > quote) == tokenAbove) return salt;
        }
    }

    function _launch(address quote, bool tokenAbove) internal returns (address token) {
        // the salt is read BEFORE the prank: `vm.prank` binds to the next call, arguments included
        bytes32 salt = _saltFor(quote, tokenAbove);
        vm.prank(alice);
        token = factory.launch("Quadra", "QUADRA", "", salt, quote, 0, ONE, address(0));
    }

    function _furnace(address token, address to, uint16 bps) internal returns (QuadraFurnace f) {
        f = new QuadraFurnace(IFurnaceLaunchpad(address(factory)), manager, token, to, bps);
        vm.prank(alice);
        factory.setCreatorRecipient(token, address(f));
    }

    function _swap(address who, address token, bool buy, uint256 amountIn) internal {
        PoolKey memory key = factory.launches(token).key;
        bool tokenIs1 = Currency.unwrap(key.currency1) == token;
        address quote = Currency.unwrap(tokenIs1 ? key.currency0 : key.currency1);
        bool zeroForOne = buy ? tokenIs1 : !tokenIs1;
        vm.startPrank(who);
        if (buy && quote != address(0)) IB20(quote).approve(address(router), amountIn);
        if (!buy) IB20(token).approve(address(router), amountIn);
        router.swap{value: buy && quote == address(0) ? amountIn : 0}(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
    }

    /// A buy, then a sell of half of it: fees in both currencies, after the opening window.
    function _trade(address token, uint256 quoteIn) internal {
        vm.warp(block.timestamp + 60);
        uint256 before = IB20(token).balanceOf(bob);
        _swap(bob, token, true, quoteIn);
        _swap(bob, token, false, (IB20(token).balanceOf(bob) - before) / 2);
    }

    // ───────────────────────────────────────────────────────────── tests

    function test_refusesACoinNotLaunchedOrABadSplit() public {
        address token = _launch(address(stock), true);
        vm.expectRevert(QuadraFurnace.NotLaunched.selector);
        new QuadraFurnace(IFurnaceLaunchpad(address(factory)), manager, makeAddr("nothing"), treasury, 5_000);
        vm.expectRevert(QuadraFurnace.BadSplit.selector);
        new QuadraFurnace(IFurnaceLaunchpad(address(factory)), manager, token, treasury, 10_001);
        vm.expectRevert(QuadraFurnace.BadSplit.selector);
        new QuadraFurnace(IFurnaceLaunchpad(address(factory)), manager, token, address(0), 5_000);
    }

    /// The coin side is burnt at once; the stock side is set aside for buybacks; the rest is the treasury's.
    function test_splitsAStockPairsFees_coinAboveTheStock() public {
        _splitsAndBuysBack(address(stock), true, 50 ether / 1e10);
    }

    function test_splitsAStockPairsFees_coinBelowTheStock() public {
        _splitsAndBuysBack(address(stock), false, 50 ether / 1e10);
    }

    function test_splitsAnEthPairsFees() public {
        _splitsAndBuysBack(address(0), true, 1 ether);
    }

    function _splitsAndBuysBack(address quote, bool tokenAbove, uint256 quoteIn) internal {
        address token = _launch(quote, tokenAbove);
        QuadraFurnace f = _furnace(token, treasury, 6_000);
        assertTrue(f.isActive());
        _trade(token, quoteIn);
        f.harvest();

        uint256 burnt = f.burnedFromFees();
        assertGt(burnt, 0, "coin-side fees burnt");
        assertEq(IB20(token).balanceOf(DEAD) >= burnt, true);
        uint256 coinToTreasury = IB20(token).balanceOf(treasury);
        assertEq(burnt, (burnt + coinToTreasury) * 6_000 / 10_000, "60% of the coin side burnt");
        uint256 set = f.toBuy();
        uint256 quoteToTreasury = quote == address(0) ? treasury.balance : IB20(quote).balanceOf(treasury);
        assertGt(set, 0);
        assertEq(set, (set + quoteToTreasury) * 6_000 / 10_000, "60% of the quote side set aside");

        // only the treasury buys back, within what is set aside, above its own floor
        vm.expectRevert(QuadraFurnace.NotTreasury.selector);
        f.buyAndBurn(set, 0);
        vm.startPrank(treasury);
        vm.expectRevert(QuadraFurnace.BadAmount.selector);
        f.buyAndBurn(0, 0);
        vm.expectRevert(QuadraFurnace.BadAmount.selector);
        f.buyAndBurn(set + 1, 0);
        vm.expectRevert();
        f.buyAndBurn(set, type(uint256).max);
        uint256 deadBefore = IB20(token).balanceOf(DEAD);
        uint256 got = f.buyAndBurn(set, 1);
        vm.stopPrank();
        assertGt(got, 0);
        assertEq(IB20(token).balanceOf(DEAD) - deadBefore, got, "every coin bought is burnt");
        assertEq(f.toBuy(), 0);
        assertEq(f.quoteSpent(), set);
        assertEq(f.burnedFromBuybacks(), got);
        assertEq(IB20(token).balanceOf(address(f)), 0, "the furnace keeps no coin");
    }

    function test_burnsAllOrNothing_atTheEdgesOfTheSplit() public {
        address token = _launch(address(stock), true);
        QuadraFurnace all = _furnace(token, treasury, 10_000);
        _trade(token, 50 ether / 1e10);
        all.harvest();
        assertEq(IB20(token).balanceOf(treasury), 0);
        assertEq(stock.balanceOf(treasury), 0);
        assertGt(all.toBuy(), 0);

        address other = _launch(address(stock), false);
        QuadraFurnace none = _furnace(other, treasury, 0);
        _trade(other, 50 ether / 1e10);
        none.harvest();
        assertEq(none.burnedFromFees(), 0);
        assertEq(none.toBuy(), 0);
        assertGt(IB20(other).balanceOf(treasury), 0);
        // nothing new: a second split moves nothing
        none.distribute();
    }

    /// A treasury that refuses ETH is owed it, and paid on a retry once it accepts; burns go on regardless.
    function test_keepsWhatTheTreasuryRefuses() public {
        LateTaker3 late = new LateTaker3();
        address token = _launch(address(0), true);
        QuadraFurnace f = _furnace(token, address(late), 5_000);
        _trade(token, 1 ether);
        f.harvest();
        uint256 owed = f.treasuryOwed(Currency.wrap(address(0)));
        assertGt(owed, 0);
        assertGt(f.burnedFromFees(), 0);
        f.distribute();
        assertEq(f.treasuryOwed(Currency.wrap(address(0))), owed, "owed is not split twice");
        late.openUp();
        f.payTreasury(Currency.wrap(address(0)));
        assertEq(address(late).balance, owed);
        assertEq(f.treasuryOwed(Currency.wrap(address(0))), 0);
    }

    /// A quote that returns nothing is paid; one that returns false is owed, never lost. The quote
    /// arrives as a gift here: the launchpad's own collect is the v3 suite's to test with odd tokens.
    function test_paysAQuoteThatReturnsNothing_andOwesOneThatReturnsFalse() public {
        OddToken3 odd = new OddToken3();
        vm.prank(admin);
        factory.setQuote(address(odd), true, START);
        address token = _launch(address(odd), true);
        QuadraFurnace f = _furnace(token, treasury, 5_000);
        odd.mint(address(f), 100);
        odd.setMode(OddToken3.Mode.NoReturn);
        f.distribute();
        assertEq(odd.balanceOf(treasury), 50);
        assertEq(f.toBuy(), 50);
        odd.mint(address(f), 100);
        odd.setMode(OddToken3.Mode.ReturnsFalse);
        f.distribute();
        assertEq(f.treasuryOwed(Currency.wrap(address(odd))), 50);
        assertEq(f.toBuy(), 100);
    }

    /// A push from the launchpad the quote refuses is kept there as `owed`; the furnace pulls and splits it.
    function test_pullsWhatTheLaunchpadKeptForIt() public {
        OddToken3 odd = new OddToken3();
        odd.mint(bob, 100e18);
        vm.prank(admin);
        factory.setQuote(address(odd), true, START);
        address token = _launch(address(odd), true);
        QuadraFurnace f = _furnace(token, treasury, 5_000);
        _trade(token, 10e18);
        odd.refuse(address(f), true);
        f.harvest();
        uint256 kept = factory.owed(address(f), Currency.wrap(address(odd)));
        assertGt(kept, 0);
        odd.refuse(address(f), false);
        f.pullOwed(Currency.wrap(address(odd)));
        assertEq(factory.owed(address(f), Currency.wrap(address(odd))), 0);
        assertEq(f.toBuy(), kept / 2);
    }

    function test_pullsWhatTheLaunchpadKept_andGuardsItsEntries() public {
        address token = _launch(address(0), true);
        QuadraFurnace f = _furnace(token, treasury, 5_000);
        // nothing is owed to the furnace: the launchpad refuses, and so does the call
        vm.expectRevert(LaunchFactoryV3.NothingOwed.selector);
        f.pullOwed(Currency.wrap(address(0)));
        vm.expectRevert(QuadraFurnace.NotPoolManager.selector);
        f.unlockCallback(abi.encode(uint256(1)));
        // a gift is split like a fee
        (bool ok,) = address(f).call{value: 1 ether}("");
        assertTrue(ok);
        f.distribute();
        assertEq(f.toBuy(), 0.5 ether);
        assertEq(uint256(vm.load(address(f), bytes32(LOCK_SLOT))), 1, "the slot holds the lock");
        vm.store(address(f), bytes32(LOCK_SLOT), bytes32(uint256(2)));
        vm.expectRevert(QuadraFurnace.Reentrancy.selector);
        f.distribute();
        vm.expectRevert(QuadraFurnace.Reentrancy.selector);
        f.harvest();
        vm.expectRevert(QuadraFurnace.Reentrancy.selector);
        f.pullOwed(Currency.wrap(address(0)));
        vm.expectRevert(QuadraFurnace.Reentrancy.selector);
        f.payTreasury(Currency.wrap(address(0)));
        vm.prank(treasury);
        vm.expectRevert(QuadraFurnace.Reentrancy.selector);
        f.buyAndBurn(1, 0);
    }

    function test_isNotActiveUntilTheShareIsPointedAtIt() public {
        address token = _launch(address(0), true);
        QuadraFurnace f = new QuadraFurnace(IFurnaceLaunchpad(address(factory)), manager, token, treasury, 5_000);
        assertFalse(f.isActive());
    }
}
