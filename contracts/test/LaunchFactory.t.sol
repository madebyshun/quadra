// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IB20} from "base-std/interfaces/IB20.sol";
import {IB20Factory} from "base-std/interfaces/IB20Factory.sol";
import {B20Constants} from "base-std/lib/B20Constants.sol";
import {StdPrecompiles} from "base-std/StdPrecompiles.sol";
import {B20FactoryLib} from "base-std/lib/B20FactoryLib.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LaunchFactory} from "../src/LaunchFactory.sol";

/// @dev Refuses ETH — the recipient a push must survive.
contract Refuser {
    function withdrawFrom(LaunchFactory f, Currency c) external {
        f.withdraw(c);
    }
}

/// @dev Accepts ETH once it has been told to, so a refused payment can later be withdrawn.
contract LateTaker {
    bool public open;

    function openUp() external {
        open = true;
    }

    function withdrawFrom(LaunchFactory f, Currency c) external {
        f.withdraw(c);
    }

    receive() external payable {
        require(open, "closed");
    }
}

/// @dev Tries to collect again from inside the payment it receives.
contract Reenterer {
    LaunchFactory public f;
    address public token;

    function arm(LaunchFactory factory, address t) external {
        f = factory;
        token = t;
    }

    receive() external payable {
        f.collect(token);
    }
}

/// @dev A minimal ERC-20 whose `transfer`/`transferFrom` can be made to return nothing or false —
///      the two non-standard answers `_push` and `_pull` have to read correctly.
contract OddToken {
    enum Mode {
        Normal,
        NoReturn,
        ReturnsFalse
    }

    Mode public mode;
    /// recipients this token refuses, like an issuer's blocklist on one wallet
    mapping(address => bool) public refuses;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function setMode(Mode m) external {
        mode = m;
    }

    function refuse(address to, bool yes) external {
        refuses[to] = yes;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _move(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        return _move(from, to, amount);
    }

    function _move(address from, address to, uint256 amount) private returns (bool) {
        if (mode == Mode.ReturnsFalse || refuses[to]) return false;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        if (mode == Mode.NoReturn) {
            assembly {
                return(0, 0)
            }
        }
        return true;
    }
}

/// @dev Against the REAL B20 precompile (Base Foundry registers it locally) and a REAL Uniswap v4
///      PoolManager deployed from v4-core's own source — no stand-in for either. Stock-like quotes
///      are real B20 Assets with 8 decimals, like Coinbase's stocks on Base.
contract LaunchFactoryTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// opening price ≈ 2×10^8 tokens per ETH: the whole billion is worth about 5 ETH at the start
    int24 internal constant START = 191_200;
    /// a stock at ~$180 with 8 decimals: ≈ 7.5×10^6 tokens per share ⇒ ≈ 7.5×10^16 raw per raw
    int24 internal constant STOCK_START = 382_000;
    /// where `_locked` lives (`base-forge inspect LaunchFactory storage-layout`)
    uint256 internal constant LOCK_SLOT = 8;

    IPoolManager internal manager;
    PoolSwapTest internal router;
    LaunchFactory internal factory;
    IB20 internal stock;

    address internal protocol = makeAddr("protocol");
    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    event Launched(address indexed token, address indexed creator, PoolId indexed poolId, uint256 devBuyIn, uint256 devBuyTokens);
    event QuoteSet(address indexed quote, bool enabled, int24 startTick);

    function setUp() public {
        manager = new PoolManager(address(this));
        router = new PoolSwapTest(manager);
        factory = new LaunchFactory(manager, protocol, admin, START);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        stock = _stock("NVDAc", bytes32(uint256(77)));
        vm.prank(admin);
        factory.setQuote(address(stock), true, STOCK_START);
    }

    /// A B20 Asset with 8 decimals this test administers, holding 1,000 shares for alice and bob.
    function _stock(string memory symbol, bytes32 salt) internal returns (IB20 s) {
        bytes[] memory init = new bytes[](2);
        init[0] = abi.encodeCall(IB20.mint, (alice, 1_000e8));
        init[1] = abi.encodeCall(IB20.mint, (bob, 1_000e8));
        s = IB20(
            StdPrecompiles.B20_FACTORY.createB20(
                IB20Factory.B20Variant.ASSET, salt, B20FactoryLib.encodeAssetCreateParams(symbol, symbol, address(this), 8), init
            )
        );
    }

    function _launch(address who, uint256 eth, bytes32 salt) internal returns (address token) {
        vm.prank(who);
        token = factory.launch{value: eth}("Moon Cat", "MCAT", "data:application/json,{\"name\":\"Moon Cat\"}", salt, address(0), eth);
    }

    /// A salt that gives `who` a token on the wanted side of `quote` in the pool's ordering.
    function _saltFor(address who, address quote, bool tokenAbove) internal view returns (bytes32 salt) {
        for (uint256 i = 1; ; i++) {
            salt = bytes32(i);
            if ((factory.predictToken(who, salt) > quote) == tokenAbove) return salt;
        }
    }

    function _launchOnStock(address who, uint256 shares, bool tokenAbove) internal returns (address token) {
        bytes32 salt = _saltFor(who, address(stock), tokenAbove);
        vm.startPrank(who);
        stock.approve(address(factory), shares);
        token = factory.launch("Stock Cat", "SCAT", "", salt, address(stock), shares);
        vm.stopPrank();
    }

    function _key(address token) internal view returns (PoolKey memory) {
        return factory.launches(token).key;
    }

    /// Buy `token` with `amountIn` of its quote, through the v4 test router.
    function _buy(address who, address token, uint256 amountIn) internal returns (uint256 got) {
        PoolKey memory key = _key(token);
        bool tokenIs1 = Currency.unwrap(key.currency1) == token;
        address quote = Currency.unwrap(tokenIs1 ? key.currency0 : key.currency1);
        uint256 before = IB20(token).balanceOf(who);
        vm.startPrank(who);
        if (quote != address(0)) IB20(quote).approve(address(router), amountIn);
        router.swap{value: quote == address(0) ? amountIn : 0}(
            key,
            SwapParams({
                zeroForOne: tokenIs1,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: tokenIs1 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
        got = IB20(token).balanceOf(who) - before;
    }

    function _sell(address who, address token, uint256 amount) internal {
        PoolKey memory key = _key(token);
        bool tokenIs1 = Currency.unwrap(key.currency1) == token;
        vm.startPrank(who);
        IB20(token).approve(address(router), amount);
        router.swap(
            key,
            SwapParams({
                zeroForOne: !tokenIs1,
                amountSpecified: -int256(amount),
                sqrtPriceLimitX96: tokenIs1 ? TickMath.MAX_SQRT_PRICE - 1 : TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
    }

    // ───────────────────────────────────────────── deployment and quotes

    function test_refusesAZeroManagerProtocolOrAdmin() public {
        vm.expectRevert(LaunchFactory.ZeroAddress.selector);
        new LaunchFactory(IPoolManager(address(0)), protocol, admin, START);
        vm.expectRevert(LaunchFactory.ZeroAddress.selector);
        new LaunchFactory(manager, address(0), admin, START);
        vm.expectRevert(LaunchFactory.ZeroAddress.selector);
        new LaunchFactory(manager, protocol, address(0), START);
    }

    function test_refusesAnOpeningTickOffTheSpacingOrWithoutRoomOnEitherSide() public {
        vm.expectRevert(LaunchFactory.BadStartTick.selector);
        new LaunchFactory(manager, protocol, admin, START + 1);
        vm.expectRevert(LaunchFactory.BadStartTick.selector);
        new LaunchFactory(manager, protocol, admin, TickMath.minUsableTick(200));
        vm.expectRevert(LaunchFactory.BadStartTick.selector);
        new LaunchFactory(manager, protocol, admin, TickMath.maxUsableTick(200));
    }

    function test_opensWithETHEnabledAndTheRolesSet() public {
        vm.expectEmit(true, false, false, true);
        emit QuoteSet(address(0), true, START);
        LaunchFactory f = new LaunchFactory(manager, protocol, admin, START);
        (bool enabled, int24 tick) = f.quotes(address(0));
        assertTrue(enabled);
        assertEq(tick, START);
        assertEq(f.quoteAdmin(), admin);
        assertEq(f.protocolRecipient(), protocol);
    }

    function test_letsOnlyTheQuoteAdminEnableAQuoteAtAValidPrice() public {
        vm.prank(bob);
        vm.expectRevert(LaunchFactory.NotAllowed.selector);
        factory.setQuote(address(0xbeef), true, START);
        vm.prank(admin);
        vm.expectRevert(LaunchFactory.BadStartTick.selector);
        factory.setQuote(address(0xbeef), true, START + 7);
        // disabling needs no valid price
        vm.prank(admin);
        factory.setQuote(address(stock), false, 7);
        (bool enabled,) = factory.quotes(address(stock));
        assertFalse(enabled);
    }

    function test_changesTheQuoteAdminOnlyInTwoSteps() public {
        vm.prank(bob);
        vm.expectRevert(LaunchFactory.NotAllowed.selector);
        factory.proposeQuoteAdmin(bob);
        vm.prank(bob);
        vm.expectRevert(LaunchFactory.NotAllowed.selector);
        factory.acceptQuoteAdmin();
        vm.prank(admin);
        factory.proposeQuoteAdmin(bob);
        assertEq(factory.quoteAdmin(), admin);
        vm.prank(bob);
        factory.acceptQuoteAdmin();
        assertEq(factory.quoteAdmin(), bob);
        assertEq(factory.pendingQuoteAdmin(), address(0));
    }

    function test_changesTheProtocolRecipientOnlyInTwoSteps() public {
        vm.prank(bob);
        vm.expectRevert(LaunchFactory.NotAllowed.selector);
        factory.proposeProtocolRecipient(bob);
        vm.prank(bob);
        vm.expectRevert(LaunchFactory.NotAllowed.selector);
        factory.acceptProtocolRecipient();
        vm.prank(protocol);
        factory.proposeProtocolRecipient(bob);
        assertEq(factory.protocolRecipient(), protocol);
        vm.prank(bob);
        factory.acceptProtocolRecipient();
        assertEq(factory.protocolRecipient(), bob);
        assertEq(factory.pendingProtocolRecipient(), address(0));
    }

    function test_refusesAQuoteThatIsNotEnabledAndAValueThatDoesNotMatch() public {
        vm.prank(alice);
        vm.expectRevert(LaunchFactory.QuoteNotEnabled.selector);
        factory.launch("X", "X", "", bytes32(uint256(1)), address(0xbeef), 0);
        vm.prank(alice);
        vm.expectRevert(LaunchFactory.WrongValue.selector);
        factory.launch{value: 1 ether}("X", "X", "", bytes32(uint256(1)), address(0), 2 ether);
        vm.prank(alice);
        vm.expectRevert(LaunchFactory.WrongValue.selector);
        factory.launch{value: 1}("X", "X", "", bytes32(uint256(1)), address(stock), 0);
    }

    // ───────────────────────────────────────────── the token, against ETH

    function test_createsAFixedSupplyTokenNobodyAdministers() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        IB20 t = IB20(token);
        assertEq(t.name(), "Moon Cat");
        assertEq(t.symbol(), "MCAT");
        assertEq(t.decimals(), 18);
        assertEq(t.totalSupply(), factory.TOTAL_SUPPLY());
        assertEq(t.contractURI(), "data:application/json,{\"name\":\"Moon Cat\"}");
        address[3] memory who = [alice, address(factory), admin];
        bytes32[4] memory roles = [bytes32(0), B20Constants.MINT_ROLE, B20Constants.PAUSE_ROLE, B20Constants.METADATA_ROLE];
        for (uint256 i; i < who.length; i++) {
            for (uint256 r; r < roles.length; r++) assertFalse(t.hasRole(roles[r], who[i]));
        }
        vm.prank(address(factory));
        vm.expectRevert();
        t.mint(address(factory), 1);
    }

    function test_putsTheWholeSupplyInThePoolAndKeepsNothing() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        assertEq(IB20(token).balanceOf(address(factory)), 0);
        uint256 dust = IB20(token).balanceOf(factory.DEAD());
        assertEq(IB20(token).balanceOf(address(manager)) + dust, factory.TOTAL_SUPPLY());
        assertLt(dust, 1e9);
    }

    function test_opensAnETHPoolAtTheStartingPriceWithTheTokenAboveIt() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        PoolKey memory key = _key(token);
        (uint160 sqrtPrice, int24 tick,, uint24 fee) = manager.getSlot0(key.toId());
        assertEq(tick, START);
        assertEq(sqrtPrice, TickMath.getSqrtPriceAtTick(START));
        assertEq(fee, factory.LP_FEE());
        assertEq(Currency.unwrap(key.currency0), address(0));
        assertEq(Currency.unwrap(key.currency1), token);
        LaunchFactory.Position memory p = factory.positions(token);
        assertEq(p.tickLower, TickMath.minUsableTick(200));
        assertEq(p.tickUpper, START);
    }

    function test_recordsTheLaunchAndAnnouncesIt() public {
        bytes32 salt = bytes32(uint256(7));
        address predicted = factory.predictToken(alice, salt);
        PoolKey memory key = PoolKey(Currency.wrap(address(0)), Currency.wrap(predicted), 10_000, 200, factory.launches(address(1)).key.hooks);
        vm.expectEmit(true, true, true, true);
        emit Launched(predicted, alice, key.toId(), 0, 0);
        address token = _launch(alice, 0, salt);
        assertEq(token, predicted);
        assertEq(factory.launches(token).creator, alice);
        assertEq(factory.launches(token).creatorRecipient, alice);
    }

    function test_bindsTheAddressToTheCallerSoASaltCannotBeStolen() public {
        bytes32 salt = bytes32(uint256(9));
        address a = _launch(alice, 0, salt);
        address b = _launch(bob, 0, salt);
        assertTrue(a != b);
        assertEq(factory.launchSalt(alice, salt), keccak256(abi.encode(alice, salt)));
        vm.prank(alice);
        vm.expectRevert();
        factory.launch("Again", "AGN", "", salt, address(0), 0);
    }

    function test_letsTheLauncherBuyFirstWithETH() public {
        uint256 before = alice.balance;
        address token = _launch(alice, 1 ether, bytes32(uint256(1)));
        assertGt(IB20(token).balanceOf(alice), 0);
        assertEq(before - alice.balance, 1 ether);
        assertEq(address(factory).balance, 0);
    }

    // ───────────────────────────────────────────── the token, against a stock

    function test_pairsWithAStockOnEitherSideOfThePool() public {
        for (uint256 side; side < 2; side++) {
            bool above = side == 0;
            address token = _launchOnStock(alice, 0, above);
            PoolKey memory key = _key(token);
            assertEq(Currency.unwrap(above ? key.currency1 : key.currency0), token);
            assertEq(Currency.unwrap(above ? key.currency0 : key.currency1), address(stock));
            (, int24 tick,,) = manager.getSlot0(key.toId());
            LaunchFactory.Position memory p = factory.positions(token);
            if (above) {
                assertEq(tick, STOCK_START);
                assertEq(p.tickUpper, STOCK_START);
            } else {
                assertEq(tick, -STOCK_START);
                assertEq(p.tickLower, -STOCK_START);
                assertEq(p.tickUpper, TickMath.maxUsableTick(200));
            }
            // the whole supply went into the pool on either side
            assertEq(IB20(token).balanceOf(address(manager)) + IB20(token).balanceOf(factory.DEAD()), factory.TOTAL_SUPPLY());
        }
    }

    function test_letsTheLauncherBuyFirstWithAStockOnEitherSide() public {
        for (uint256 side; side < 2; side++) {
            uint256 before = stock.balanceOf(alice);
            address token = _launchOnStock(alice, 2e8, side == 0);
            assertEq(before - stock.balanceOf(alice), 2e8, "two shares, pulled exactly");
            assertGt(IB20(token).balanceOf(alice), 0);
            assertEq(stock.balanceOf(address(factory)), 0);
        }
    }

    function test_refusesAFirstBuyItCannotPull() public {
        bytes32 salt = _saltFor(alice, address(stock), true);
        vm.prank(alice);
        vm.expectRevert(LaunchFactory.TransferFailed.selector);
        factory.launch("No Approval", "NA", "", salt, address(stock), 1e8);

        OddToken odd = new OddToken();
        odd.mint(alice, 10e18);
        odd.setMode(OddToken.Mode.ReturnsFalse);
        vm.prank(admin);
        factory.setQuote(address(odd), true, STOCK_START);
        vm.startPrank(alice);
        odd.approve(address(factory), 1e18);
        vm.expectRevert(LaunchFactory.TransferFailed.selector);
        factory.launch("False", "F", "", bytes32(uint256(3)), address(odd), 1e18);
        vm.stopPrank();
    }

    function test_acceptsAQuoteThatReturnsNothing() public {
        OddToken odd = new OddToken();
        odd.mint(alice, 10e18);
        odd.setMode(OddToken.Mode.NoReturn);
        vm.prank(admin);
        factory.setQuote(address(odd), true, START);
        vm.startPrank(alice);
        odd.approve(address(factory), 1e18);
        address token = factory.launch("Quiet", "Q", "", bytes32(uint256(3)), address(odd), 1e18);
        vm.stopPrank();
        assertEq(odd.balanceOf(alice), 9e18);
        assertGt(IB20(token).balanceOf(alice), 0);
    }

    // ───────────────────────────────────────────── trading and fees

    function test_paysOnePercentOfEveryETHTradeEightyTwenty() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        uint256 got = _buy(bob, token, 10 ether);
        _sell(bob, token, got / 2);
        uint256 aliceEth = alice.balance;
        (uint256 eth, uint256 tokens) = factory.collect(token);
        assertApproxEqAbs(eth, 0.1 ether, 2);
        assertApproxEqAbs(tokens, got / 2 / 100, 2);
        assertEq(alice.balance - aliceEth, eth * 8_000 / 10_000);
        assertEq(protocol.balance, eth - eth * 8_000 / 10_000);
        assertEq(IB20(token).balanceOf(protocol), tokens - tokens * 8_000 / 10_000);
        assertEq(address(factory).balance, 0);
    }

    function test_paysTheFeesOfAStockPairInTheStockAndTheTokenOnEitherSide() public {
        for (uint256 side; side < 2; side++) {
            address token = _launchOnStock(alice, 0, side == 0);
            PoolKey memory key = _key(token);
            uint256 got = _buy(bob, token, 10e8);
            _sell(bob, token, got / 2);
            uint256 aliceStock = stock.balanceOf(alice);
            uint256 protocolStock = stock.balanceOf(protocol);
            (uint256 amount0, uint256 amount1) = factory.collect(token);
            uint256 inStock = Currency.unwrap(key.currency0) == address(stock) ? amount0 : amount1;
            assertApproxEqAbs(inStock, 10e8 / 100, 2, "1% of the ten shares bought with");
            assertEq(stock.balanceOf(alice) - aliceStock, inStock * 8_000 / 10_000);
            assertEq(stock.balanceOf(protocol) - protocolStock, inStock - inStock * 8_000 / 10_000);
            assertEq(stock.balanceOf(address(factory)), 0);
        }
    }

    function test_collectsOnlyWhatIsNewAndNothingTwice() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        (uint256 a, uint256 b) = factory.collect(token);
        assertEq(a + b, 0);
        _buy(bob, token, 1 ether);
        (a, b) = factory.collect(token);
        assertGt(a, 0);
        assertEq(b, 0);
        (a, b) = factory.collect(token);
        assertEq(a + b, 0);
    }

    function test_neverTakesTheLiquidityOut() public {
        address token = _launchOnStock(alice, 0, false);
        PoolKey memory key = _key(token);
        LaunchFactory.Position memory p = factory.positions(token);
        (uint128 opening,,) = manager.getPositionInfo(key.toId(), address(factory), p.tickLower, p.tickUpper, bytes32(0));
        assertGt(opening, 0);
        uint256 got = _buy(bob, token, 50e8);
        _sell(bob, token, got);
        factory.collect(token);
        (uint128 after_,,) = manager.getPositionInfo(key.toId(), address(factory), p.tickLower, p.tickUpper, bytes32(0));
        assertEq(after_, opening);
    }

    function testFuzz_splitsEveryCollectionExactly(uint96 buyIn) public {
        uint256 eth = bound(uint256(buyIn), 0.001 ether, 50 ether);
        address token = _launch(alice, 0, bytes32(uint256(1)));
        vm.deal(bob, eth);
        _buy(bob, token, eth);
        uint256 a = alice.balance;
        uint256 p = protocol.balance;
        (uint256 fee,) = factory.collect(token);
        assertEq((alice.balance - a) + (protocol.balance - p), fee);
    }

    function test_refusesToCollectForATokenItDidNotLaunch() public {
        vm.expectRevert(LaunchFactory.NotLaunched.selector);
        factory.collect(address(0xbeef));
    }

    // ───────────────────────────────────────────── recipients

    function test_letsOnlyTheRecipientHandTheLaunchersShareOn() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        vm.prank(bob);
        vm.expectRevert(LaunchFactory.NotAllowed.selector);
        factory.setCreatorRecipient(token, bob);
        vm.prank(alice);
        vm.expectRevert(LaunchFactory.ZeroAddress.selector);
        factory.setCreatorRecipient(token, address(0));
        vm.expectRevert(LaunchFactory.NotLaunched.selector);
        factory.setCreatorRecipient(address(0xbeef), bob);
        vm.prank(alice);
        factory.setCreatorRecipient(token, bob);
        assertEq(factory.launches(token).creatorRecipient, bob);
        assertEq(factory.launches(token).creator, alice);
        _buy(alice, token, 1 ether);
        uint256 b = bob.balance;
        (uint256 eth,) = factory.collect(token);
        assertEq(bob.balance - b, eth * 8_000 / 10_000);
    }

    // ───────────────────────────────────────────── payouts that bounce

    function test_keepsETHARecipientRefusesAndPaysEveryoneElse() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        Refuser refuser = new Refuser();
        vm.prank(alice);
        factory.setCreatorRecipient(token, address(refuser));
        _buy(bob, token, 1 ether);
        (uint256 eth,) = factory.collect(token);
        uint256 share = eth * 8_000 / 10_000;
        assertEq(factory.owed(address(refuser), Currency.wrap(address(0))), share);
        assertEq(protocol.balance, eth - share);
        vm.expectRevert(LaunchFactory.TransferFailed.selector);
        refuser.withdrawFrom(factory, Currency.wrap(address(0)));
    }

    function test_keepsAnAssetTheQuoteRefusesToMove() public {
        OddToken odd = new OddToken();
        odd.mint(bob, 100e18);
        vm.prank(admin);
        factory.setQuote(address(odd), true, START);
        vm.prank(alice);
        address token = factory.launch("Odd", "ODD", "", bytes32(uint256(5)), address(odd), 0);
        _buy(bob, token, 10e18);
        // the quote's issuer blocks the launcher: her share is kept, the protocol's is still paid
        odd.refuse(alice, true);
        (uint256 amount0, uint256 amount1) = factory.collect(token);
        uint256 inOdd = Currency.unwrap(_key(token).currency0) == address(odd) ? amount0 : amount1;
        assertGt(inOdd, 0);
        assertEq(factory.owed(alice, Currency.wrap(address(odd))), inOdd * 8_000 / 10_000);
        assertEq(odd.balanceOf(protocol), inOdd - inOdd * 8_000 / 10_000);
        vm.prank(alice);
        vm.expectRevert(LaunchFactory.TransferFailed.selector);
        factory.withdraw(Currency.wrap(address(odd)));
        // and once she is unblocked, the payout is withdrawn
        odd.refuse(alice, false);
        vm.prank(alice);
        factory.withdraw(Currency.wrap(address(odd)));
        assertEq(odd.balanceOf(alice), inOdd * 8_000 / 10_000);
    }

    function test_paysOutWhatWasOwedOnceTheRecipientCanTakeIt() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        LateTaker late = new LateTaker();
        vm.prank(alice);
        factory.setCreatorRecipient(token, address(late));
        _buy(bob, token, 1 ether);
        factory.collect(token);
        Currency eth = Currency.wrap(address(0));
        uint256 owed = factory.owed(address(late), eth);
        assertGt(owed, 0);
        late.openUp();
        late.withdrawFrom(factory, eth);
        assertEq(address(late).balance, owed);
        vm.expectRevert(LaunchFactory.NothingOwed.selector);
        late.withdrawFrom(factory, eth);
    }

    function test_cannotBeReenteredFromAPayment() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        Reenterer r = new Reenterer();
        r.arm(factory, token);
        vm.prank(alice);
        factory.setCreatorRecipient(token, address(r));
        _buy(bob, token, 1 ether);
        (uint256 eth,) = factory.collect(token);
        assertEq(factory.owed(address(r), Currency.wrap(address(0))), eth * 8_000 / 10_000);
    }

    function test_refusesAnyEntryWhileACallIsInProgress() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        assertEq(uint256(vm.load(address(factory), bytes32(LOCK_SLOT))), 1, "the slot holds the lock");
        vm.store(address(factory), bytes32(LOCK_SLOT), bytes32(uint256(2)));
        vm.expectRevert(LaunchFactory.Reentrancy.selector);
        factory.collect(token);
        vm.expectRevert(LaunchFactory.Reentrancy.selector);
        factory.withdraw(Currency.wrap(address(0)));
        vm.expectRevert(LaunchFactory.Reentrancy.selector);
        factory.launch("X", "X", "", bytes32(uint256(2)), address(0), 0);
    }

    function test_acceptsCallbacksAndETHOnlyFromThePoolManager() public {
        vm.expectRevert(LaunchFactory.NotPoolManager.selector);
        factory.unlockCallback("");
        vm.prank(alice);
        (bool ok,) = address(factory).call{value: 1}("");
        assertFalse(ok);
    }
}
