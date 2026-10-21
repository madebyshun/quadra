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
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {LaunchFactoryV3} from "../src/LaunchFactoryV3.sol";
import {LaunchHook} from "../src/LaunchHook.sol";
import {HookSalt} from "../script/HookSalt.sol";

/// @dev Refuses ETH — the recipient a push must survive.
contract Refuser3 {
    function withdrawFrom(LaunchFactoryV3 f, Currency c) external {
        f.withdraw(c);
    }
}

/// @dev Accepts ETH once it has been told to, so a refused payment can later be withdrawn.
contract LateTaker3 {
    bool public open;

    function openUp() external {
        open = true;
    }

    function withdrawFrom(LaunchFactoryV3 f, Currency c) external {
        f.withdraw(c);
    }

    receive() external payable {
        require(open, "closed");
    }
}

/// @dev Tries to collect again from inside the payment it receives.
contract Reenterer3 {
    LaunchFactoryV3 public f;
    address public token;

    function arm(LaunchFactoryV3 factory, address t) external {
        f = factory;
        token = t;
    }

    receive() external payable {
        f.collect(token);
    }
}

/// @dev A minimal ERC-20 whose `transfer`/`transferFrom` can return nothing or false.
contract OddToken3 {
    enum Mode {
        Normal,
        NoReturn,
        ReturnsFalse
    }

    Mode public mode;
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

/// @dev Against the REAL B20 precompile and a REAL Uniswap v4 PoolManager, like the v2 suite. The
///      hook is deployed by the factory at a mined address, exactly as on mainnet.
contract LaunchFactoryV3Test is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    int24 internal constant START = 191_200;
    int24 internal constant STOCK_START = 382_000;
    uint24 internal constant OPENING = 500_000;
    uint32 internal constant WINDOW = 15;
    uint24 internal constant ONE = 10_000;
    uint24 internal constant THREE = 30_000;
    /// where `_locked` lives (`base-forge inspect LaunchFactoryV3 storage-layout`)
    uint256 internal constant LOCK_SLOT = 8;

    IPoolManager internal manager;
    PoolSwapTest internal router;
    PoolModifyLiquidityTest internal lpRouter;
    LaunchFactoryV3 internal factory;
    LaunchHook internal hook;
    IB20 internal stock;

    address internal protocol = makeAddr("protocol");
    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    event Launched(address indexed token, address indexed creator, PoolId indexed poolId, uint256 devBuyIn, uint256 devBuyTokens);
    event LaunchFee(address indexed token, uint24 fee);
    event QuoteSet(address indexed quote, bool enabled, int24 startTick);

    function setUp() public {
        vm.warp(1_760_000_000);
        manager = new PoolManager(address(this));
        router = new PoolSwapTest(manager);
        lpRouter = new PoolModifyLiquidityTest(manager);
        factory = _deploy(OPENING, WINDOW);
        hook = factory.hook();
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        stock = _stock("NVDAc", bytes32(uint256(77)));
        vm.prank(admin);
        factory.setQuote(address(stock), true, STOCK_START);
    }

    /// The factory deployed from this test, its hook's salt mined against the factory's own address.
    function _deploy(uint24 startFee, uint32 window) internal returns (LaunchFactoryV3) {
        address next = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        (bytes32 salt,) = HookSalt.find(next, HookSalt.initCodeHash(manager, startFee, window));
        return new LaunchFactoryV3(manager, protocol, admin, START, startFee, window, salt);
    }

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

    function _launchFee(LaunchFactoryV3 f, address who, uint256 eth, bytes32 salt, uint24 fee) internal returns (address token) {
        vm.prank(who);
        token = f.launch{value: eth}("Moon Cat", "MCAT", "data:application/json,{\"name\":\"Moon Cat\"}", salt, address(0), eth, fee);
    }

    function _launch(address who, uint256 eth, bytes32 salt) internal returns (address) {
        return _launchFee(factory, who, eth, salt, ONE);
    }

    function _saltFor(address who, address quote, bool tokenAbove) internal view returns (bytes32 salt) {
        for (uint256 i = 1; ; i++) {
            salt = bytes32(i);
            if ((factory.predictToken(who, salt) > quote) == tokenAbove) return salt;
        }
    }

    function _launchOnStock(address who, uint256 shares, bool tokenAbove, uint24 fee) internal returns (address token) {
        bytes32 salt = _saltFor(who, address(stock), tokenAbove);
        vm.startPrank(who);
        stock.approve(address(factory), shares);
        token = factory.launch("Stock Cat", "SCAT", "", salt, address(stock), shares, fee);
        vm.stopPrank();
    }

    function _key(LaunchFactoryV3 f, address token) internal view returns (PoolKey memory) {
        return f.launches(token).key;
    }

    function _key(address token) internal view returns (PoolKey memory) {
        return _key(factory, token);
    }

    function _buyOn(LaunchFactoryV3 f, address who, address token, uint256 amountIn) internal returns (uint256 got) {
        PoolKey memory key = _key(f, token);
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

    function _buy(address who, address token, uint256 amountIn) internal returns (uint256) {
        return _buyOn(factory, who, token, amountIn);
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

    /// The fee a buy of `amountIn` ETH actually paid, read back as what `collect` took for it.
    function _feePaidOn(LaunchFactoryV3 f, address token, uint256 amountIn) internal returns (uint256 fee) {
        f.collect(token);
        _buyOn(f, bob, token, amountIn);
        (fee,) = f.collect(token);
    }

    function _feePaid(address token, uint256 amountIn) internal returns (uint256) {
        return _feePaidOn(factory, token, amountIn);
    }

    // ───────────────────────────────────────────── deployment, the hook and quotes

    function test_refusesAZeroManagerProtocolOrAdmin() public {
        vm.expectRevert(LaunchFactoryV3.ZeroAddress.selector);
        new LaunchFactoryV3(IPoolManager(address(0)), protocol, admin, START, OPENING, WINDOW, 0);
        vm.expectRevert(LaunchFactoryV3.ZeroAddress.selector);
        new LaunchFactoryV3(manager, address(0), admin, START, OPENING, WINDOW, 0);
        vm.expectRevert(LaunchFactoryV3.ZeroAddress.selector);
        new LaunchFactoryV3(manager, protocol, address(0), START, OPENING, WINDOW, 0);
    }

    function test_refusesAnOpeningTickOffTheSpacingOrWithoutRoomOnEitherSide() public {
        vm.expectRevert(LaunchFactoryV3.BadStartTick.selector);
        new LaunchFactoryV3(manager, protocol, admin, START + 1, OPENING, WINDOW, 0);
        vm.expectRevert(LaunchFactoryV3.BadStartTick.selector);
        new LaunchFactoryV3(manager, protocol, admin, TickMath.minUsableTick(200), OPENING, WINDOW, 0);
        vm.expectRevert(LaunchFactoryV3.BadStartTick.selector);
        new LaunchFactoryV3(manager, protocol, admin, TickMath.maxUsableTick(200), OPENING, WINDOW, 0);
    }

    function test_refusesAnOpeningScheduleThatIsNotAFallFromAValidFee() public {
        // above 100%, below the highest chosen fee (it would have to rise), or no window at all
        vm.expectRevert(LaunchHook.BadSchedule.selector);
        new LaunchFactoryV3(manager, protocol, admin, START, 1_000_001, WINDOW, 0);
        vm.expectRevert(LaunchHook.BadSchedule.selector);
        new LaunchFactoryV3(manager, protocol, admin, START, THREE - 1, WINDOW, 0);
        vm.expectRevert(LaunchHook.BadSchedule.selector);
        new LaunchFactoryV3(manager, protocol, admin, START, OPENING, 0, 0);
        // the bounds themselves are accepted: 3% flat, and 100%
        assertEq(_deploy(THREE, 1).hook().startFee(), THREE);
        assertEq(_deploy(1_000_000, 1).hook().startFee(), 1_000_000);
    }

    function test_refusesAHookSaltThatDoesNotGiveExactlyTheHooksPermissions() public {
        address next = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        bytes32 codeHash = HookSalt.initCodeHash(manager, OPENING, WINDOW);
        for (uint256 i; ; i++) {
            address at = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), next, bytes32(i), codeHash)))));
            if (uint160(at) & Hooks.ALL_HOOK_MASK != HookSalt.FLAGS) {
                vm.expectRevert(abi.encodeWithSelector(Hooks.HookAddressNotValid.selector, at));
                new LaunchFactoryV3(manager, protocol, admin, START, OPENING, WINDOW, bytes32(i));
                return;
            }
        }
    }

    function test_deploysItsOwnHookWithExactlyThreePermissionsAndNoWayToTakeAnything() public view {
        assertEq(hook.factory(), address(factory));
        assertEq(address(hook.poolManager()), address(manager));
        assertEq(hook.startFee(), OPENING);
        assertEq(hook.window(), WINDOW);
        uint160 bits = uint160(address(hook)) & Hooks.ALL_HOOK_MASK;
        assertEq(bits, Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG);
        // no return-delta permission, no remove-liquidity permission, no after-hooks at all
        IHooks h = IHooks(address(hook));
        assertFalse(Hooks.hasPermission(h, Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG));
        assertFalse(Hooks.hasPermission(h, Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG));
        assertFalse(Hooks.hasPermission(h, Hooks.AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG));
        assertFalse(Hooks.hasPermission(h, Hooks.AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG));
        assertFalse(Hooks.hasPermission(h, Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG));
        assertFalse(Hooks.hasPermission(h, Hooks.AFTER_SWAP_FLAG));
        assertEq(factory.FEE_LOW(), hook.FEE_LOW());
        assertEq(factory.FEE_HIGH(), hook.FEE_HIGH());
    }

    function test_opensWithETHEnabledAndTheRolesSet() public {
        vm.expectEmit(true, false, false, true);
        emit QuoteSet(address(0), true, START);
        LaunchFactoryV3 f = _deploy(OPENING, WINDOW);
        (bool enabled, int24 tick) = f.quotes(address(0));
        assertTrue(enabled);
        assertEq(tick, START);
        assertEq(f.quoteAdmin(), admin);
        assertEq(f.protocolRecipient(), protocol);
    }

    function test_letsOnlyTheQuoteAdminEnableAQuoteAtAValidPrice() public {
        vm.prank(bob);
        vm.expectRevert(LaunchFactoryV3.NotAllowed.selector);
        factory.setQuote(address(0xbeef), true, START);
        vm.prank(admin);
        vm.expectRevert(LaunchFactoryV3.BadStartTick.selector);
        factory.setQuote(address(0xbeef), true, START + 7);
        vm.prank(admin);
        factory.setQuote(address(stock), false, 7);
        (bool enabled,) = factory.quotes(address(stock));
        assertFalse(enabled);
    }

    function test_changesTheQuoteAdminOnlyInTwoSteps() public {
        vm.prank(bob);
        vm.expectRevert(LaunchFactoryV3.NotAllowed.selector);
        factory.proposeQuoteAdmin(bob);
        vm.prank(bob);
        vm.expectRevert(LaunchFactoryV3.NotAllowed.selector);
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
        vm.expectRevert(LaunchFactoryV3.NotAllowed.selector);
        factory.proposeProtocolRecipient(bob);
        vm.prank(bob);
        vm.expectRevert(LaunchFactoryV3.NotAllowed.selector);
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
        vm.expectRevert(LaunchFactoryV3.QuoteNotEnabled.selector);
        factory.launch("X", "X", "", bytes32(uint256(1)), address(0xbeef), 0, ONE);
        vm.prank(alice);
        vm.expectRevert(LaunchFactoryV3.WrongValue.selector);
        factory.launch{value: 1 ether}("X", "X", "", bytes32(uint256(1)), address(0), 2 ether, ONE);
        vm.prank(alice);
        vm.expectRevert(LaunchFactoryV3.WrongValue.selector);
        factory.launch{value: 1}("X", "X", "", bytes32(uint256(1)), address(stock), 0, ONE);
    }

    // ───────────────────────────────────────────── the fee: 1% or 3%, nothing else

    function test_acceptsOnePercentAndThreePercentAndNothingElse() public {
        uint24[7] memory bad = [uint24(0), 100, 3_000, 9_999, 10_001, 30_001, LPFeeLibrary.DYNAMIC_FEE_FLAG];
        for (uint256 i; i < bad.length; i++) {
            vm.prank(alice);
            vm.expectRevert(LaunchFactoryV3.BadFee.selector);
            factory.launch("X", "X", "", bytes32(uint256(1)), address(0), 0, bad[i]);
        }
        address one = _launchFee(factory, alice, 0, bytes32(uint256(1)), ONE);
        address three = _launchFee(factory, alice, 0, bytes32(uint256(2)), THREE);
        (uint24 f1,) = hook.schedules(_key(one).toId());
        (uint24 f3,) = hook.schedules(_key(three).toId());
        assertEq(f1, ONE);
        assertEq(f3, THREE);
    }

    function testFuzz_refusesEveryOtherFee(uint24 fee) public {
        vm.assume(fee != ONE && fee != THREE);
        vm.prank(alice);
        vm.expectRevert(LaunchFactoryV3.BadFee.selector);
        factory.launch("X", "X", "", bytes32(uint256(1)), address(0), 0, fee);
    }

    function test_chargesTheChosenFeeOnceTheOpeningIsOver() public {
        address one = _launchFee(factory, alice, 0, bytes32(uint256(1)), ONE);
        address three = _launchFee(factory, alice, 0, bytes32(uint256(2)), THREE);
        vm.warp(block.timestamp + WINDOW);
        assertApproxEqAbs(_feePaid(one, 10 ether), 0.1 ether, 4, "1% after the window");
        assertApproxEqAbs(_feePaid(three, 10 ether), 0.3 ether, 4, "3% after the window");
        vm.warp(block.timestamp + 365 days);
        assertApproxEqAbs(_feePaid(three, 1 ether), 0.03 ether, 4, "3% forever after");
    }

    // ───────────────────────────────────────────── the anti-sniper opening

    function test_opensAtTheStartFee() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        PoolId id = _key(token).toId();
        assertEq(hook.currentFee(id), OPENING);
        assertApproxEqAbs(_feePaid(token, 1 ether), 0.5 ether, 4, "50% in the launch block");
    }

    function test_fallsHalfwayAtHalfTheWindow() public {
        // an even window, so half of it is a whole second
        LaunchFactoryV3 f = _deploy(OPENING, 20);
        address token = _launchFee(f, alice, 0, bytes32(uint256(1)), ONE);
        PoolId id = _key(f, token).toId();
        vm.warp(block.timestamp + 10);
        uint24 half = ONE + (OPENING - ONE) / 2;
        assertEq(f.hook().currentFee(id), half);
        assertApproxEqAbs(_feePaidOn(f, token, 1 ether), 1 ether * uint256(half) / 1e6, 4);
    }

    function test_fallsInAStraightLineEverySecondOfTheDefaultWindow() public {
        address one = _launchFee(factory, alice, 0, bytes32(uint256(1)), ONE);
        address three = _launchFee(factory, alice, 0, bytes32(uint256(2)), THREE);
        PoolId id1 = _key(one).toId();
        PoolId id3 = _key(three).toId();
        uint256 t0 = block.timestamp;
        for (uint256 s; s <= WINDOW + 1; s++) {
            vm.warp(t0 + s);
            uint256 left = s >= WINDOW ? 0 : WINDOW - s;
            assertEq(hook.currentFee(id1), ONE + (OPENING - ONE) * left / WINDOW);
            assertEq(hook.currentFee(id3), THREE + (OPENING - THREE) * left / WINDOW);
        }
        // the sniper one second in pays ~46.7%; the window's end, exactly the chosen fee
        vm.warp(t0 + 1);
        assertEq(hook.currentFee(id1), 467_333);
        vm.warp(t0 + WINDOW);
        assertEq(hook.currentFee(id1), ONE);
        assertEq(hook.currentFee(id3), THREE);
    }

    function test_chargesTheOpeningFeeOnSellsToo() public {
        address token = _launch(alice, 1 ether, bytes32(uint256(1)));
        uint256 held = IB20(token).balanceOf(alice);
        factory.collect(token);
        _sell(alice, token, held);
        (, uint256 inToken) = factory.collect(token);
        assertApproxEqAbs(inToken, held / 2, 4, "half of what the launcher dumped in the launch block");
    }

    function test_letsTheLaunchersFirstBuyPayTheChosenFeeNotTheOpeningOne() public {
        address one = _launchFee(factory, alice, 1 ether, bytes32(uint256(1)), ONE);
        address three = _launchFee(factory, alice, 1 ether, bytes32(uint256(2)), THREE);
        // same block as the launch: anyone else would pay 50% right now
        assertEq(hook.currentFee(_key(one).toId()), OPENING);
        (uint256 fee1,) = factory.collect(one);
        (uint256 fee3,) = factory.collect(three);
        assertApproxEqAbs(fee1, 0.01 ether, 4, "the first buy paid 1%");
        assertApproxEqAbs(fee3, 0.03 ether, 4, "the first buy paid 3%");
    }

    function test_letsTheLaunchersFirstStockBuyPayTheChosenFee() public {
        address token = _launchOnStock(alice, 10e8, true, THREE);
        PoolKey memory key = _key(token);
        (uint256 a0, uint256 a1) = factory.collect(token);
        uint256 inStock = Currency.unwrap(key.currency0) == address(stock) ? a0 : a1;
        assertApproxEqAbs(inStock, 10e8 * 3 / 100, 2);
    }

    // ───────────────────────────────────────────── only the factory's pools

    function test_refusesAPoolTheFactoryDidNotOpen() public {
        // a token the factory will create, its exact pool key, opened first by somebody else
        address predicted = factory.predictToken(alice, bytes32(uint256(1)));
        PoolKey memory key = PoolKey(Currency.wrap(address(0)), Currency.wrap(predicted), LPFeeLibrary.DYNAMIC_FEE_FLAG, 200, IHooks(address(hook)));
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                IHooks.beforeInitialize.selector,
                abi.encodeWithSelector(LaunchHook.NotFactory.selector),
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));
        // nor any other pool — a static fee, any pair
        key = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(stock)), 10_000, 200, IHooks(address(hook)));
        vm.expectRevert();
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));
        // and the factory's own launch with that salt still goes through
        assertEq(_launch(alice, 0, bytes32(uint256(1))), predicted);
    }

    function test_answersOnlyThePoolManagerAndRegistersOnlyForTheFactory() public {
        PoolKey memory key = _key(_launch(alice, 0, bytes32(uint256(1))));
        vm.expectRevert(LaunchHook.NotPoolManager.selector);
        hook.beforeInitialize(address(factory), key, 0);
        vm.expectRevert(LaunchHook.NotPoolManager.selector);
        hook.beforeAddLiquidity(address(factory), key, ModifyLiquidityParams(0, 200, 1, bytes32(0)), "");
        vm.expectRevert(LaunchHook.NotPoolManager.selector);
        hook.beforeSwap(address(factory), key, SwapParams(true, -1, 0), "");
        vm.prank(bob);
        vm.expectRevert(LaunchHook.NotFactory.selector);
        hook.register(key.toId(), 1);
        (uint24 fee,) = hook.schedules(key.toId());
        assertEq(fee, ONE, "unchanged");
    }

    function test_keepsOtherLiquidityOutUntilTheOpeningIsOverAndNeverTrapsIt() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        PoolKey memory key = _key(token);
        // ETH-only liquidity just above the opening price (the token is currency1)
        ModifyLiquidityParams memory add = ModifyLiquidityParams(START + 200, START + 400, 1e18, bytes32(0));
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                IHooks.beforeAddLiquidity.selector,
                abi.encodeWithSelector(LaunchHook.Opening.selector),
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
        lpRouter.modifyLiquidity{value: 10 ether}(key, add, "");
        vm.warp(block.timestamp + WINDOW - 1);
        vm.prank(bob);
        vm.expectRevert();
        lpRouter.modifyLiquidity{value: 10 ether}(key, add, "");
        vm.warp(block.timestamp + 1);
        vm.prank(bob);
        lpRouter.modifyLiquidity{value: 10 ether}(key, add, "");
        // and whoever adds can always take theirs back out: the hook has no say over removals
        vm.prank(bob);
        lpRouter.modifyLiquidity(key, ModifyLiquidityParams(START + 200, START + 400, -1e18, bytes32(0)), "");
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
        address[4] memory who = [alice, address(factory), admin, address(hook)];
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
        assertEq(IB20(token).balanceOf(address(hook)), 0);
        uint256 dust = IB20(token).balanceOf(factory.DEAD());
        assertEq(IB20(token).balanceOf(address(manager)) + dust, factory.TOTAL_SUPPLY());
        assertLt(dust, 1e9);
    }

    function test_opensAnETHPoolAtTheStartingPriceWithTheHookAndADynamicFee() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        PoolKey memory key = _key(token);
        (uint160 sqrtPrice, int24 tick,,) = manager.getSlot0(key.toId());
        assertEq(tick, START);
        assertEq(sqrtPrice, TickMath.getSqrtPriceAtTick(START));
        assertEq(key.fee, LPFeeLibrary.DYNAMIC_FEE_FLAG);
        assertEq(address(key.hooks), address(hook));
        assertEq(key.tickSpacing, 200);
        assertEq(Currency.unwrap(key.currency0), address(0));
        assertEq(Currency.unwrap(key.currency1), token);
        LaunchFactoryV3.Position memory p = factory.positions(token);
        assertEq(p.tickLower, TickMath.minUsableTick(200));
        assertEq(p.tickUpper, START);
        (uint24 fee, uint40 openedAt) = hook.schedules(key.toId());
        assertEq(fee, ONE);
        assertEq(openedAt, block.timestamp);
    }

    function test_recordsTheLaunchAndAnnouncesItTheWayV2Did() public {
        bytes32 salt = bytes32(uint256(7));
        address predicted = factory.predictToken(alice, salt);
        PoolKey memory key = PoolKey(Currency.wrap(address(0)), Currency.wrap(predicted), LPFeeLibrary.DYNAMIC_FEE_FLAG, 200, IHooks(address(hook)));
        vm.expectEmit(true, false, false, true);
        emit LaunchFee(predicted, THREE);
        vm.expectEmit(true, true, true, true);
        emit Launched(predicted, alice, key.toId(), 0, 0);
        address token = _launchFee(factory, alice, 0, salt, THREE);
        assertEq(token, predicted);
        assertEq(factory.launches(token).creator, alice);
        assertEq(factory.launches(token).creatorRecipient, alice);
        // v1/v2's topic: the same signature, so one log reader serves every factory
        assertEq(LaunchFactoryV3.Launched.selector, keccak256("Launched(address,address,bytes32,uint256,uint256)"));
    }

    function test_bindsTheAddressToTheCallerSoASaltCannotBeStolen() public {
        bytes32 salt = bytes32(uint256(9));
        address a = _launch(alice, 0, salt);
        address b = _launch(bob, 0, salt);
        assertTrue(a != b);
        assertEq(factory.launchSalt(alice, salt), keccak256(abi.encode(alice, salt)));
        vm.prank(alice);
        vm.expectRevert();
        factory.launch("Again", "AGN", "", salt, address(0), 0, ONE);
    }

    function test_letsTheLauncherBuyFirstWithETH() public {
        uint256 before = alice.balance;
        address token = _launch(alice, 1 ether, bytes32(uint256(1)));
        assertGt(IB20(token).balanceOf(alice), 0);
        assertEq(before - alice.balance, 1 ether);
        assertEq(address(factory).balance, 0);
        assertEq(address(hook).balance, 0);
    }

    // ───────────────────────────────────────────── the token, against a stock

    function test_pairsWithAStockOnEitherSideOfThePool() public {
        for (uint256 side; side < 2; side++) {
            bool above = side == 0;
            address token = _launchOnStock(alice, 0, above, side == 0 ? ONE : THREE);
            PoolKey memory key = _key(token);
            assertEq(Currency.unwrap(above ? key.currency1 : key.currency0), token);
            assertEq(Currency.unwrap(above ? key.currency0 : key.currency1), address(stock));
            (, int24 tick,,) = manager.getSlot0(key.toId());
            LaunchFactoryV3.Position memory p = factory.positions(token);
            if (above) {
                assertEq(tick, STOCK_START);
                assertEq(p.tickUpper, STOCK_START);
            } else {
                assertEq(tick, -STOCK_START);
                assertEq(p.tickLower, -STOCK_START);
                assertEq(p.tickUpper, TickMath.maxUsableTick(200));
            }
            assertEq(IB20(token).balanceOf(address(manager)) + IB20(token).balanceOf(factory.DEAD()), factory.TOTAL_SUPPLY());
        }
    }

    function test_letsTheLauncherBuyFirstWithAStockOnEitherSide() public {
        for (uint256 side; side < 2; side++) {
            uint256 before = stock.balanceOf(alice);
            address token = _launchOnStock(alice, 2e8, side == 0, ONE);
            assertEq(before - stock.balanceOf(alice), 2e8, "two shares, pulled exactly");
            assertGt(IB20(token).balanceOf(alice), 0);
            assertEq(stock.balanceOf(address(factory)), 0);
        }
    }

    function test_refusesAFirstBuyItCannotPull() public {
        bytes32 salt = _saltFor(alice, address(stock), true);
        vm.prank(alice);
        vm.expectRevert(LaunchFactoryV3.TransferFailed.selector);
        factory.launch("No Approval", "NA", "", salt, address(stock), 1e8, ONE);

        OddToken3 odd = new OddToken3();
        odd.mint(alice, 10e18);
        odd.setMode(OddToken3.Mode.ReturnsFalse);
        vm.prank(admin);
        factory.setQuote(address(odd), true, STOCK_START);
        vm.startPrank(alice);
        odd.approve(address(factory), 1e18);
        vm.expectRevert(LaunchFactoryV3.TransferFailed.selector);
        factory.launch("False", "F", "", bytes32(uint256(3)), address(odd), 1e18, ONE);
        vm.stopPrank();
    }

    function test_acceptsAQuoteThatReturnsNothing() public {
        OddToken3 odd = new OddToken3();
        odd.mint(alice, 10e18);
        odd.setMode(OddToken3.Mode.NoReturn);
        vm.prank(admin);
        factory.setQuote(address(odd), true, START);
        vm.startPrank(alice);
        odd.approve(address(factory), 1e18);
        address token = factory.launch("Quiet", "Q", "", bytes32(uint256(3)), address(odd), 1e18, ONE);
        vm.stopPrank();
        assertEq(odd.balanceOf(alice), 9e18);
        assertGt(IB20(token).balanceOf(alice), 0);
    }

    // ───────────────────────────────────────────── trading and fees

    function test_paysEveryETHTradesFeeEightyTwenty() public {
        address token = _launchFee(factory, alice, 0, bytes32(uint256(1)), THREE);
        vm.warp(block.timestamp + WINDOW);
        uint256 got = _buy(bob, token, 10 ether);
        _sell(bob, token, got / 2);
        uint256 aliceEth = alice.balance;
        (uint256 eth, uint256 tokens) = factory.collect(token);
        assertApproxEqAbs(eth, 0.3 ether, 4);
        assertApproxEqAbs(tokens, got / 2 * 3 / 100, 4);
        assertEq(alice.balance - aliceEth, eth * 8_000 / 10_000);
        assertEq(protocol.balance, eth - eth * 8_000 / 10_000);
        assertEq(IB20(token).balanceOf(protocol), tokens - tokens * 8_000 / 10_000);
        assertEq(address(factory).balance, 0);
    }

    function test_paysTheOpeningFeeToTheLauncherAndProtocolEightyTwenty() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        _buy(bob, token, 2 ether);
        uint256 aliceEth = alice.balance;
        (uint256 eth,) = factory.collect(token);
        assertApproxEqAbs(eth, 1 ether, 4, "the sniper's 50% is the launch's");
        assertEq(alice.balance - aliceEth, eth * 8_000 / 10_000);
        assertEq(protocol.balance, eth - eth * 8_000 / 10_000);
        assertEq(address(hook).balance, 0);
    }

    function test_paysTheFeesOfAStockPairInTheStockAndTheTokenOnEitherSide() public {
        for (uint256 side; side < 2; side++) {
            address token = _launchOnStock(alice, 0, side == 0, ONE);
            vm.warp(block.timestamp + WINDOW);
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

    function testFuzz_splitsEveryCollectionExactly(uint96 buyIn, uint8 secondsIn) public {
        uint256 eth = bound(uint256(buyIn), 0.001 ether, 50 ether);
        address token = _launch(alice, 0, bytes32(uint256(1)));
        vm.warp(block.timestamp + bound(uint256(secondsIn), 0, 40));
        vm.deal(bob, eth);
        _buy(bob, token, eth);
        uint256 a = alice.balance;
        uint256 p = protocol.balance;
        (uint256 fee,) = factory.collect(token);
        assertEq((alice.balance - a) + (protocol.balance - p), fee);
        assertLe(fee, eth / 2 + 4, "never more than the opening fee");
        assertGe(fee + 4, eth / 100, "never less than the chosen fee");
    }

    function test_refusesToCollectForATokenItDidNotLaunch() public {
        vm.expectRevert(LaunchFactoryV3.NotLaunched.selector);
        factory.collect(address(0xbeef));
    }

    // ───────────────────────────────────────────── the liquidity never comes out

    function test_neverTakesTheLiquidityOut() public {
        address token = _launchOnStock(alice, 0, false, THREE);
        PoolKey memory key = _key(token);
        LaunchFactoryV3.Position memory p = factory.positions(token);
        (uint128 opening,,) = manager.getPositionInfo(key.toId(), address(factory), p.tickLower, p.tickUpper, bytes32(0));
        assertGt(opening, 0);
        uint256 got = _buy(bob, token, 50e8);
        _sell(bob, token, got);
        vm.warp(block.timestamp + 1 days);
        got = _buy(bob, token, 50e8);
        _sell(bob, token, got);
        vm.prank(bob);
        factory.collect(token);
        factory.collect(token);
        (uint128 after_,,) = manager.getPositionInfo(key.toId(), address(factory), p.tickLower, p.tickUpper, bytes32(0));
        assertEq(after_, opening);
    }

    /// @dev The structural half of "no function removes liquidity": the factory reaches
    ///      `modifyLiquidity` in exactly two places, one adding the supply and one poking with zero,
    ///      and the hook never calls the pool manager at all. Comments are stripped first, so a
    ///      comment naming the pattern cannot satisfy or trip the check.
    function test_hasNoCodePathThatRemovesLiquidity() public view {
        string memory f = _code(vm.readFile("src/LaunchFactoryV3.sol"));
        string memory h = _code(vm.readFile("src/LaunchHook.sol"));
        assertEq(_count(f, "modifyLiquidity("), 2);
        assertEq(_count(f, "_params(token,int256(uint256(liquidity)))"), 1);
        assertEq(_count(f, "_params(token,0)"), 1);
        assertEq(_count(f, "_params("), 3, "the two calls and the definition");
        assertEq(_count(f, "-int"), 1, "the only negation: the first buy's exact-input amount");
        assertEq(_count(f, "liquidityDelta:liquidityDelta"), 1);
        assertEq(_count(h, "poolManager."), 0);
        assertEq(_count(h, "modifyLiquidity"), 0);
        assertEq(_count(h, "unlock"), 0);
    }

    /// Source without comments or whitespace.
    function _code(string memory src) internal pure returns (string memory) {
        bytes memory s = bytes(src);
        bytes memory out = new bytes(s.length);
        uint256 n;
        for (uint256 i; i < s.length; i++) {
            if (s[i] == "/" && i + 1 < s.length && s[i + 1] == "/") {
                while (i < s.length && s[i] != "\n") i++;
                continue;
            }
            if (s[i] == "/" && i + 1 < s.length && s[i + 1] == "*") {
                i += 2;
                while (!(s[i] == "*" && s[i + 1] == "/")) i++;
                i++;
                continue;
            }
            if (s[i] == " " || s[i] == "\n" || s[i] == "\t" || s[i] == "\r") continue;
            out[n++] = s[i];
        }
        assembly {
            mstore(out, n)
        }
        return string(out);
    }

    function _count(string memory hay, string memory needle) internal pure returns (uint256 c) {
        bytes memory h = bytes(hay);
        bytes memory nd = bytes(needle);
        for (uint256 i; i + nd.length <= h.length; i++) {
            bool hit = true;
            for (uint256 j; j < nd.length; j++) {
                if (h[i + j] != nd[j]) {
                    hit = false;
                    break;
                }
            }
            if (hit) c++;
        }
    }

    // ───────────────────────────────────────────── recipients

    function test_letsOnlyTheRecipientHandTheLaunchersShareOn() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        vm.prank(bob);
        vm.expectRevert(LaunchFactoryV3.NotAllowed.selector);
        factory.setCreatorRecipient(token, bob);
        vm.prank(alice);
        vm.expectRevert(LaunchFactoryV3.ZeroAddress.selector);
        factory.setCreatorRecipient(token, address(0));
        vm.expectRevert(LaunchFactoryV3.NotLaunched.selector);
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
        Refuser3 refuser = new Refuser3();
        vm.prank(alice);
        factory.setCreatorRecipient(token, address(refuser));
        _buy(bob, token, 1 ether);
        (uint256 eth,) = factory.collect(token);
        uint256 share = eth * 8_000 / 10_000;
        assertEq(factory.owed(address(refuser), Currency.wrap(address(0))), share);
        assertEq(protocol.balance, eth - share);
        vm.expectRevert(LaunchFactoryV3.TransferFailed.selector);
        refuser.withdrawFrom(factory, Currency.wrap(address(0)));
    }

    function test_keepsAnAssetTheQuoteRefusesToMove() public {
        OddToken3 odd = new OddToken3();
        odd.mint(bob, 100e18);
        vm.prank(admin);
        factory.setQuote(address(odd), true, START);
        vm.prank(alice);
        address token = factory.launch("Odd", "ODD", "", bytes32(uint256(5)), address(odd), 0, ONE);
        _buy(bob, token, 10e18);
        odd.refuse(alice, true);
        (uint256 amount0, uint256 amount1) = factory.collect(token);
        uint256 inOdd = Currency.unwrap(_key(token).currency0) == address(odd) ? amount0 : amount1;
        assertGt(inOdd, 0);
        assertEq(factory.owed(alice, Currency.wrap(address(odd))), inOdd * 8_000 / 10_000);
        assertEq(odd.balanceOf(protocol), inOdd - inOdd * 8_000 / 10_000);
        vm.prank(alice);
        vm.expectRevert(LaunchFactoryV3.TransferFailed.selector);
        factory.withdraw(Currency.wrap(address(odd)));
        odd.refuse(alice, false);
        vm.prank(alice);
        factory.withdraw(Currency.wrap(address(odd)));
        assertEq(odd.balanceOf(alice), inOdd * 8_000 / 10_000);
    }

    function test_paysOutWhatWasOwedOnceTheRecipientCanTakeIt() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        LateTaker3 late = new LateTaker3();
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
        vm.expectRevert(LaunchFactoryV3.NothingOwed.selector);
        late.withdrawFrom(factory, eth);
    }

    function test_cannotBeReenteredFromAPayment() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        Reenterer3 r = new Reenterer3();
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
        vm.expectRevert(LaunchFactoryV3.Reentrancy.selector);
        factory.collect(token);
        vm.expectRevert(LaunchFactoryV3.Reentrancy.selector);
        factory.withdraw(Currency.wrap(address(0)));
        vm.expectRevert(LaunchFactoryV3.Reentrancy.selector);
        factory.launch("X", "X", "", bytes32(uint256(2)), address(0), 0, ONE);
    }

    function test_acceptsCallbacksAndETHOnlyFromThePoolManager() public {
        vm.expectRevert(LaunchFactoryV3.NotPoolManager.selector);
        factory.unlockCallback("");
        vm.prank(alice);
        (bool ok,) = address(factory).call{value: 1}("");
        assertFalse(ok);
    }
}
