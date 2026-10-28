// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IB20} from "base-std/interfaces/IB20.sol";
import {IB20Factory} from "base-std/interfaces/IB20Factory.sol";
import {B20Constants} from "base-std/lib/B20Constants.sol";
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
    function setRecipient(LaunchFactory f, address token, address to) external {
        f.setCreatorRecipient(token, to);
    }

    function withdrawFrom(LaunchFactory f) external {
        f.withdraw();
    }
}

/// @dev Accepts ETH once it has been told to, so a refused payment can later be withdrawn.
contract LateTaker {
    bool public open;

    function openUp() external {
        open = true;
    }

    function withdrawFrom(LaunchFactory f) external {
        f.withdraw();
    }

    receive() external payable {
        require(open, "closed");
    }
}

/// @dev Tries to collect again from inside the payment it receives.
contract Reenterer {
    LaunchFactory public f;
    address public token;
    bool public reentered;

    function arm(LaunchFactory factory, address t) external {
        f = factory;
        token = t;
    }

    receive() external payable {
        reentered = true;
        f.collect(token);
    }
}

/// @dev The tests run against the REAL B20 precompile (Base Foundry registers it locally) and a
///      REAL Uniswap v4 PoolManager deployed from v4-core's own source — no stand-in for either.
contract LaunchFactoryTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// opening price ≈ 2×10^8 tokens per ETH: the whole billion is worth about 5 ETH at the start
    int24 internal constant START = 191_200;
    /// where `_locked` lives (`base-forge inspect LaunchFactory storage-layout`)
    uint256 internal constant LOCK_SLOT = 4;

    IPoolManager internal manager;
    PoolSwapTest internal router;
    LaunchFactory internal factory;

    address internal protocol = makeAddr("protocol");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    event Launched(address indexed token, address indexed creator, PoolId indexed poolId, uint256 devBuyEth, uint256 devBuyTokens);

    function setUp() public {
        manager = new PoolManager(address(this));
        router = new PoolSwapTest(manager);
        factory = new LaunchFactory(manager, protocol, START);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function _launch(address who, uint256 eth, bytes32 salt) internal returns (address token) {
        vm.prank(who);
        token = factory.launch{value: eth}("Moon Cat", "MCAT", "data:application/json,{\"name\":\"Moon Cat\"}", salt);
    }

    function _key(address token) internal view returns (PoolKey memory) {
        return factory.launches(token).key;
    }

    function _buy(address who, address token, uint256 eth) internal returns (uint256 got) {
        uint256 before = IB20(token).balanceOf(who);
        // the key is read BEFORE the prank: a call in the arguments would use the prank up
        PoolKey memory key = _key(token);
        vm.prank(who);
        router.swap{value: eth}(
            key,
            SwapParams({zeroForOne: true, amountSpecified: -int256(eth), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        got = IB20(token).balanceOf(who) - before;
    }

    function _sell(address who, address token, uint256 amount) internal {
        PoolKey memory key = _key(token);
        vm.startPrank(who);
        IB20(token).approve(address(router), amount);
        router.swap(
            key,
            SwapParams({zeroForOne: false, amountSpecified: -int256(amount), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
    }

    // ───────────────────────────────────────────── deployment

    function test_refusesAZeroManagerOrProtocol() public {
        vm.expectRevert(LaunchFactory.ZeroAddress.selector);
        new LaunchFactory(IPoolManager(address(0)), protocol, START);
        vm.expectRevert(LaunchFactory.ZeroAddress.selector);
        new LaunchFactory(manager, address(0), START);
    }

    function test_refusesAnOpeningTickOffTheSpacingOrOutOfRange() public {
        int24 floor = TickMath.minUsableTick(200);
        vm.expectRevert(LaunchFactory.BadStartTick.selector);
        new LaunchFactory(manager, protocol, START + 1);
        vm.expectRevert(LaunchFactory.BadStartTick.selector);
        new LaunchFactory(manager, protocol, floor);
        vm.expectRevert(LaunchFactory.BadStartTick.selector);
        new LaunchFactory(manager, protocol, TickMath.maxUsableTick(200) + 200);
    }

    // ───────────────────────────────────────────── the token

    function test_createsAFixedSupplyTokenNobodyAdministers() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        IB20 t = IB20(token);
        assertEq(t.name(), "Moon Cat");
        assertEq(t.symbol(), "MCAT");
        assertEq(t.decimals(), 18);
        assertEq(t.totalSupply(), factory.TOTAL_SUPPLY());
        assertEq(t.contractURI(), "data:application/json,{\"name\":\"Moon Cat\"}");
        // no account holds any role — not the launcher, not the factory
        address[3] memory who = [alice, address(factory), address(this)];
        bytes32[4] memory roles = [bytes32(0), B20Constants.MINT_ROLE, B20Constants.PAUSE_ROLE, B20Constants.METADATA_ROLE];
        for (uint256 i; i < who.length; i++) {
            for (uint256 r; r < roles.length; r++) assertFalse(t.hasRole(roles[r], who[i]));
        }
        // and therefore nobody can mint
        vm.prank(alice);
        vm.expectRevert();
        t.mint(alice, 1);
        vm.prank(address(factory));
        vm.expectRevert();
        t.mint(address(factory), 1);
    }

    function test_putsTheWholeSupplyInThePoolAndKeepsNothing() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        assertEq(IB20(token).balanceOf(address(factory)), 0);
        uint256 dust = IB20(token).balanceOf(factory.DEAD());
        assertEq(IB20(token).balanceOf(address(manager)) + dust, factory.TOTAL_SUPPLY());
        assertLt(dust, 1e9, "only rounding dust is burned");
        assertEq(IB20(token).balanceOf(alice), 0);
    }

    function test_opensThePoolAtTheStartingPriceWithTheLiquidityAboveIt() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        PoolKey memory key = _key(token);
        (uint160 sqrtPrice, int24 tick,, uint24 fee) = manager.getSlot0(key.toId());
        assertEq(tick, START);
        assertEq(sqrtPrice, TickMath.getSqrtPriceAtTick(START));
        assertEq(fee, factory.LP_FEE());
        assertEq(Currency.unwrap(key.currency0), address(0));
        assertEq(Currency.unwrap(key.currency1), token);
        assertEq(address(key.hooks), address(0));
        (uint128 liquidity,,) = manager.getPositionInfo(key.toId(), address(factory), TickMath.minUsableTick(200), START, bytes32(0));
        assertGt(liquidity, 0);
    }

    function test_recordsTheLaunchAndAnnouncesIt() public {
        bytes32 salt = bytes32(uint256(7));
        address predicted = factory.predictToken(alice, salt);
        PoolKey memory key = PoolKey(Currency.wrap(address(0)), Currency.wrap(predicted), 10_000, 200, factory.launches(address(1)).key.hooks);
        vm.expectEmit(true, true, true, true);
        emit Launched(predicted, alice, key.toId(), 0, 0);
        address token = _launch(alice, 0, salt);
        assertEq(token, predicted);
        LaunchFactory.Launch memory l = factory.launches(token);
        assertEq(l.creator, alice);
        assertEq(l.creatorRecipient, alice);
    }

    function test_bindsTheAddressToTheCallerSoASaltCannotBeStolen() public {
        bytes32 salt = bytes32(uint256(9));
        address a = _launch(alice, 0, salt);
        // bob replaying alice's salt gets his own token, not a revert and not hers
        address b = _launch(bob, 0, salt);
        assertTrue(a != b);
        assertEq(factory.launchSalt(alice, salt), keccak256(abi.encode(alice, salt)));
        // the same caller cannot reuse a salt
        vm.prank(alice);
        vm.expectRevert();
        factory.launch("Again", "AGN", "", salt);
    }

    // ───────────────────────────────────────────── the first buy

    function test_letsTheLauncherBuyFirstInTheSameTransaction() public {
        uint256 before = alice.balance;
        address token = _launch(alice, 1 ether, bytes32(uint256(1)));
        uint256 got = IB20(token).balanceOf(alice);
        assertGt(got, 0);
        assertEq(before - alice.balance, 1 ether);
        assertEq(address(factory).balance, 0);
        (, int24 tick,,) = manager.getSlot0(_key(token).toId());
        assertLt(tick, START, "buying moved the price into the range");
    }

    function test_spendsEveryWeiOfTheFirstBuy() public {
        // the range runs down to the lowest price there is, so no buy can run out of tokens to fill
        uint256 before = alice.balance;
        address token = _launch(alice, 99 ether, bytes32(uint256(1)));
        assertEq(before - alice.balance, 99 ether);
        assertEq(address(factory).balance, 0);
        assertLt(IB20(token).balanceOf(alice), factory.TOTAL_SUPPLY());
    }

    // ───────────────────────────────────────────── trading and fees

    function test_paysOnePercentOfEveryTradeEightyToTheLauncherTwentyToTheProtocol() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        uint256 got = _buy(bob, token, 10 ether);
        _sell(bob, token, got / 2);

        uint256 aliceEth = alice.balance;
        (uint256 eth, uint256 tokens) = factory.collect(token);
        // 1% of the 10 ETH bought with, to within the pool's rounding
        assertApproxEqAbs(eth, 0.1 ether, 2);
        assertApproxEqAbs(tokens, got / 2 / 100, 2);
        assertEq(alice.balance - aliceEth, eth * 8_000 / 10_000);
        assertEq(protocol.balance, eth - eth * 8_000 / 10_000);
        assertEq(IB20(token).balanceOf(alice), tokens * 8_000 / 10_000);
        assertEq(IB20(token).balanceOf(protocol), tokens - tokens * 8_000 / 10_000);
        assertEq(address(factory).balance, 0);
        assertEq(IB20(token).balanceOf(address(factory)), 0);
    }

    function test_collectsOnlyWhatIsNewAndNothingTwice() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        (uint256 eth, uint256 tokens) = factory.collect(token);
        assertEq(eth + tokens, 0);
        _buy(bob, token, 1 ether);
        (eth, tokens) = factory.collect(token);
        assertGt(eth, 0);
        assertEq(tokens, 0, "only buys so far: the fee was paid in ETH");
        (eth, tokens) = factory.collect(token);
        assertEq(eth + tokens, 0);
    }

    function test_neverTakesTheLiquidityOut() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        PoolKey memory key = _key(token);
        (uint128 opening,,) = manager.getPositionInfo(key.toId(), address(factory), TickMath.minUsableTick(200), START, bytes32(0));
        uint256 got = _buy(bob, token, 5 ether);
        _sell(bob, token, got);
        factory.collect(token);
        (uint128 after_,,) = manager.getPositionInfo(key.toId(), address(factory), TickMath.minUsableTick(200), START, bytes32(0));
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
        assertEq(factory.launches(token).creator, alice, "who launched it never changes");
        _buy(alice, token, 1 ether);
        uint256 b = bob.balance;
        (uint256 eth,) = factory.collect(token);
        assertEq(bob.balance - b, eth * 8_000 / 10_000);
    }

    function test_changesTheProtocolRecipientOnlyInTwoSteps() public {
        vm.prank(bob);
        vm.expectRevert(LaunchFactory.NotAllowed.selector);
        factory.proposeProtocolRecipient(bob);
        // nothing proposed: nobody can accept
        vm.prank(bob);
        vm.expectRevert(LaunchFactory.NotAllowed.selector);
        factory.acceptProtocolRecipient();

        vm.prank(protocol);
        factory.proposeProtocolRecipient(bob);
        assertEq(factory.protocolRecipient(), protocol, "not until accepted");
        vm.prank(alice);
        vm.expectRevert(LaunchFactory.NotAllowed.selector);
        factory.acceptProtocolRecipient();
        vm.prank(bob);
        factory.acceptProtocolRecipient();
        assertEq(factory.protocolRecipient(), bob);
        assertEq(factory.pendingProtocolRecipient(), address(0));
    }

    // ───────────────────────────────────────────── payments that bounce

    function test_keepsETHARecipientRefusesAndPaysEveryoneElse() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        Refuser refuser = new Refuser();
        vm.prank(alice);
        factory.setCreatorRecipient(token, address(refuser));
        _buy(bob, token, 1 ether);
        (uint256 eth,) = factory.collect(token);
        uint256 share = eth * 8_000 / 10_000;
        assertEq(factory.owedEth(address(refuser)), share);
        assertEq(protocol.balance, eth - share, "the protocol was paid regardless");
        assertEq(address(factory).balance, share);

        // it still cannot take it
        vm.expectRevert(LaunchFactory.TransferFailed.selector);
        refuser.withdrawFrom(factory);
    }

    function test_paysOutWhatWasOwedOnceTheRecipientCanTakeIt() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        LateTaker late = new LateTaker();
        vm.prank(alice);
        factory.setCreatorRecipient(token, address(late));
        _buy(bob, token, 1 ether);
        factory.collect(token);
        uint256 owed = factory.owedEth(address(late));
        assertGt(owed, 0);
        late.openUp();
        late.withdrawFrom(factory);
        assertEq(address(late).balance, owed);
        assertEq(factory.owedEth(address(late)), 0);
        vm.expectRevert(LaunchFactory.NothingOwed.selector);
        late.withdrawFrom(factory);
    }

    function test_cannotBeReenteredFromAPayment() public {
        address token = _launch(alice, 0, bytes32(uint256(1)));
        Reenterer r = new Reenterer();
        r.arm(factory, token);
        vm.prank(alice);
        factory.setCreatorRecipient(token, address(r));
        _buy(bob, token, 1 ether);
        (uint256 eth,) = factory.collect(token);
        // the nested collect reverted, so the payment bounced and is owed instead
        assertEq(factory.owedEth(address(r)), eth * 8_000 / 10_000);
        assertFalse(r.reentered(), "the reverted call left no trace");
    }

    function test_refusesAnyEntryWhileACallIsInProgress() public {
        // the reentrant attempt above reverts inside a call that is itself caught, which coverage
        // does not record; this holds the lock directly and checks every guarded door
        address token = _launch(alice, 0, bytes32(uint256(1)));
        // the slot is checked before it is used: an open lock reads 1
        assertEq(uint256(vm.load(address(factory), bytes32(uint256(LOCK_SLOT)))), 1);
        vm.store(address(factory), bytes32(uint256(LOCK_SLOT)), bytes32(uint256(2)));
        vm.expectRevert(LaunchFactory.Reentrancy.selector);
        factory.collect(token);
        vm.expectRevert(LaunchFactory.Reentrancy.selector);
        factory.withdraw();
        vm.expectRevert(LaunchFactory.Reentrancy.selector);
        factory.launch("X", "X", "", bytes32(uint256(2)));
    }

    // ───────────────────────────────────────────── the pool manager's side door

    function test_acceptsCallbacksAndETHOnlyFromThePoolManager() public {
        vm.expectRevert(LaunchFactory.NotPoolManager.selector);
        factory.unlockCallback("");
        vm.prank(alice);
        (bool ok,) = address(factory).call{value: 1}("");
        assertFalse(ok);
    }
}
