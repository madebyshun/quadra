// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IB20} from "base-std/interfaces/IB20.sol";
import {IB20Factory} from "base-std/interfaces/IB20Factory.sol";
import {StdPrecompiles} from "base-std/StdPrecompiles.sol";
import {B20FactoryLib} from "base-std/lib/B20FactoryLib.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LaunchFactoryV3} from "../src/LaunchFactoryV3.sol";
import {RevenueShare, RevenueShareDeployer, ILaunchpad} from "../src/RevenueShare.sol";
import {HookSalt} from "../script/HookSalt.sol";

/// @dev Refuses ETH.
contract RSRefuser {}

/// @dev Refuses ETH until told otherwise.
contract RSLateTaker {
    bool public open;

    function openUp() external {
        open = true;
    }

    receive() external payable {
        require(open, "closed");
    }
}

/// @dev Tries to claim again from inside the ETH it is paid.
contract RSReenterer {
    RevenueShare public share;

    function arm(RevenueShare s) external {
        share = s;
    }

    receive() external payable {
        share.claim(address(this));
    }
}

/// @dev A minimal ERC-20 whose transfers can return nothing, return false, or refuse one receiver.
contract RSOddToken {
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

    /// an issuer's seizure: the balance simply goes
    function seize(address from, uint256 amount) external {
        balanceOf[from] -= amount;
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

/// @dev A launchpad that records whatever launch it is told to — for staking a token a B20 never is
///      (one whose transfers can fail), which the real launchpad cannot produce.
contract RSFakeLaunchpad {
    mapping(address => ILaunchpad.Launch) internal _l;

    function set(address token, Currency c0, Currency c1) external {
        _l[token].creator = msg.sender;
        _l[token].creatorRecipient = msg.sender;
        _l[token].key = PoolKey({currency0: c0, currency1: c1, fee: 0, tickSpacing: 1, hooks: IHooks(address(0))});
    }

    function launches(address token) external view returns (ILaunchpad.Launch memory) {
        return _l[token];
    }
}

/// @dev Against the REAL B20 precompile, a REAL Uniswap v4 PoolManager and the REAL LaunchFactoryV3:
///      the fees a share receives are the fees a pool charged and `collect` paid.
contract RevenueShareTest is Test {
    int24 internal constant START = 191_200;
    int24 internal constant STOCK_START = 382_000;
    uint24 internal constant ONE = 10_000;
    uint16 internal constant AGENT_BPS = 2_000;
    uint256 internal constant STREAM = 7 days;
    /// where `_locked` lives (`base-forge inspect RevenueShare storage-layout`)
    uint256 internal constant LOCK_SLOT = 12;
    Currency internal constant ETH = Currency.wrap(address(0));

    IPoolManager internal manager;
    PoolSwapTest internal router;
    LaunchFactoryV3 internal factory;
    RevenueShareDeployer internal deployer;
    IB20 internal stock;

    address internal protocol = makeAddr("protocol");
    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice"); // the launcher
    address internal agent = makeAddr("agent");
    address internal bob = makeAddr("bob"); // a trader
    address internal carol = makeAddr("carol"); // stakers
    address internal dave = makeAddr("dave");

    address internal coin;
    RevenueShare internal share;

    event Created(address indexed token, address indexed share, address indexed agent, uint16 agentBps);
    event Arrived(Currency indexed currency, uint256 amount, uint256 toAgent);
    event Claimed(address indexed staker, address indexed to, Currency indexed currency, uint256 amount, bool paid);

    function setUp() public {
        vm.warp(1_760_000_000);
        manager = new PoolManager(address(this));
        router = new PoolSwapTest(manager);
        address next = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        (bytes32 salt,) = HookSalt.find(next, HookSalt.initCodeHash(manager, 500_000, 15));
        factory = new LaunchFactoryV3(manager, protocol, admin, START, 500_000, 15, salt);
        deployer = new RevenueShareDeployer(ILaunchpad(address(factory)));
        stock = _stock();
        vm.prank(admin);
        factory.setQuote(address(stock), true, STOCK_START);
        vm.deal(bob, 1_000 ether);
        vm.deal(carol, 100 ether);
        vm.deal(dave, 100 ether);

        vm.prank(alice);
        coin = factory.launch("Agent Cat", "ACAT", "", bytes32(uint256(1)), address(0), 0, ONE, address(0));
        share = deployer.create(coin, agent, AGENT_BPS);
        vm.prank(alice);
        factory.setCreatorRecipient(coin, address(share));
        // past the anti-sniper opening, so every fee below is the coin's 1%
        vm.warp(block.timestamp + 60);
        _buy(carol, coin, 1 ether);
        _buy(dave, coin, 1 ether);
    }

    function _stock() internal returns (IB20 s) {
        bytes[] memory init = new bytes[](2);
        init[0] = abi.encodeCall(IB20.mint, (bob, 1_000_000e8));
        init[1] = abi.encodeCall(IB20.mint, (carol, 1_000e8));
        s = IB20(
            StdPrecompiles.B20_FACTORY.createB20(
                IB20Factory.B20Variant.ASSET, bytes32(uint256(77)), B20FactoryLib.encodeAssetCreateParams("NVDAc", "NVDAc", address(this), 8), init
            )
        );
    }

    function _key(address token) internal view returns (PoolKey memory) {
        return factory.launches(token).key;
    }

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

    function _stake(RevenueShare s, address who, uint256 amount) internal {
        vm.startPrank(who);
        IB20(s.token()).approve(address(s), amount);
        s.stake(amount);
        vm.stopPrank();
    }

    function _gift(RevenueShare s, uint256 amount) internal {
        vm.deal(address(this), amount);
        (bool ok,) = address(s).call{value: amount}("");
        assertTrue(ok);
    }

    /// The launcher's share of what one `collect` took: what reaches the share contract.
    function _creatorShare(uint256 amount) internal pure returns (uint256) {
        return amount * 8_000 / 10_000;
    }

    function _forStakers(uint256 arrived) internal pure returns (uint256) {
        return arrived - arrived * AGENT_BPS / 10_000;
    }

    // ───────────────────────────────────────────── setting one up

    function test_refusesATokenTheLaunchpadDidNotLaunch() public {
        vm.expectRevert(RevenueShare.NotLaunched.selector);
        new RevenueShare(ILaunchpad(address(factory)), address(stock), agent, AGENT_BPS);
    }

    function test_refusesASplitThatIsNotFixedAndBounded() public {
        ILaunchpad lp = ILaunchpad(address(factory));
        vm.expectRevert(RevenueShare.BadSplit.selector);
        new RevenueShare(lp, coin, agent, 9_001);
        vm.expectRevert(RevenueShare.BadSplit.selector);
        new RevenueShare(lp, coin, address(0), 100);
        vm.expectRevert(RevenueShare.BadSplit.selector);
        new RevenueShare(lp, coin, agent, 0);
        new RevenueShare(lp, coin, agent, 9_000);
        RevenueShare none = new RevenueShare(lp, coin, address(0), 0);
        assertEq(none.agent(), address(0));
        assertEq(none.agentBps(), 0);
    }

    function test_readsThePoolsCurrenciesFromTheLaunchpad() public view {
        assertEq(address(share.launchpad()), address(factory));
        assertEq(share.token(), coin);
        assertEq(Currency.unwrap(share.currency0()), address(0));
        assertEq(Currency.unwrap(share.currency1()), coin);
        assertEq(share.agent(), agent);
        assertEq(share.agentBps(), AGENT_BPS);
        assertEq(share.STREAM(), STREAM);
    }

    function test_deploysAtThePredictedAddressOnceAndAnnouncesIt() public {
        vm.prank(alice);
        address other = factory.launch("Two", "TWO", "", bytes32(uint256(2)), address(0), 0, ONE, address(0));
        address predicted = deployer.predict(other, agent, 500);
        vm.expectEmit(true, true, true, true, address(deployer));
        emit Created(other, predicted, agent, 500);
        RevenueShare s = deployer.create(other, agent, 500);
        assertEq(address(s), predicted);
        assertEq(address(deployer.launchpad()), address(factory));
        vm.expectRevert(RevenueShareDeployer.AlreadyCreated.selector);
        deployer.create(other, agent, 500);
        // another split for the same coin is another contract
        assertTrue(deployer.predict(other, agent, 501) != predicted);
    }

    function test_isActiveOnlyWhileItIsTheCoinsCreatorRecipient() public {
        vm.prank(alice);
        address other = factory.launch("Two", "TWO", "", bytes32(uint256(2)), address(0), 0, ONE, address(0));
        RevenueShare s = deployer.create(other, agent, AGENT_BPS);
        assertFalse(s.isActive());
        vm.prank(alice);
        factory.setCreatorRecipient(other, address(s));
        assertTrue(s.isActive());
        assertTrue(share.isActive());
    }

    function test_holdsTheLaunchersShareForGoodOnceHandedOver() public {
        // the launcher can no longer point it anywhere, and the share contract has no way to
        vm.prank(alice);
        vm.expectRevert(LaunchFactoryV3.NotAllowed.selector);
        factory.setCreatorRecipient(coin, alice);
        assertEq(factory.launches(coin).creatorRecipient, address(share));
    }

    // ───────────────────────────────────────────── staking

    function test_stakesAndUnstakesTheCoin() public {
        uint256 bal = IB20(coin).balanceOf(carol);
        _stake(share, carol, bal);
        assertEq(share.stakedOf(carol), bal);
        assertEq(share.totalStaked(), bal);
        assertEq(IB20(coin).balanceOf(address(share)), bal);
        vm.prank(carol);
        share.unstake(bal / 2);
        assertEq(share.stakedOf(carol), bal - bal / 2);
        assertEq(IB20(coin).balanceOf(carol), bal / 2);
    }

    function test_refusesZeroAndMoreThanWasStaked() public {
        vm.prank(carol);
        vm.expectRevert(RevenueShare.ZeroAmount.selector);
        share.stake(0);
        vm.prank(carol);
        vm.expectRevert(RevenueShare.ZeroAmount.selector);
        share.unstake(0);
        _stake(share, carol, 100);
        vm.prank(carol);
        vm.expectRevert(RevenueShare.Insufficient.selector);
        share.unstake(101);
    }

    function test_stakesWithAPermitInOneTransaction() public {
        (address eve, uint256 pk) = makeAddrAndKey("eve");
        vm.prank(carol);
        IB20(coin).transfer(eve, 1_000e18);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                IB20(coin).DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                        eve,
                        address(share),
                        1_000e18,
                        IB20(coin).nonces(eve),
                        deadline
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        vm.prank(eve);
        share.stakeWithPermit(1_000e18, deadline, v, r, s);
        assertEq(share.stakedOf(eve), 1_000e18);
    }

    function test_fallsBackToTheAllowanceWhenAPermitWasAlreadyUsed() public {
        vm.startPrank(carol);
        IB20(coin).approve(address(share), 5e18);
        share.stakeWithPermit(5e18, block.timestamp, 27, bytes32(0), bytes32(0));
        vm.stopPrank();
        assertEq(share.stakedOf(carol), 5e18);
    }

    // ───────────────────────────────────────────── fees in, shared out

    function test_sharesAnETHBuysFeeAgentFirstThenStakersOverTheStream() public {
        _stake(share, carol, IB20(coin).balanceOf(carol));
        share.harvest(); // the setup's buys, before anybody staked: let them in first
        vm.warp(block.timestamp + STREAM + 1);
        vm.prank(carol);
        share.claim(carol);
        share.payAgent();
        uint256 carolBefore = carol.balance;
        uint256 agentBefore = agent.balance;

        _buy(bob, coin, 10 ether);
        uint256 arrivedBefore = address(share).balance;
        (uint256 eth,) = _collectThroughShare();
        uint256 arrived = address(share).balance - arrivedBefore;
        assertEq(arrived, _creatorShare(eth), "what collect paid the launcher arrived here");

        // the agent's share is due at once, the stakers' share is released over STREAM
        share.payAgent();
        assertEq(agent.balance - agentBefore, arrived * AGENT_BPS / 10_000);
        (uint256 now0,) = share.claimable(carol);
        assertEq(now0, 0, "nothing released in the same second");

        vm.warp(block.timestamp + STREAM / 2);
        (uint256 half,) = share.claimable(carol);
        assertApproxEqAbs(half, _forStakers(arrived) / 2, 2);

        vm.warp(block.timestamp + STREAM);
        vm.prank(carol);
        (uint256 paid0,) = share.claim(carol);
        assertApproxEqAbs(paid0, _forStakers(arrived), 2, "the only staker got all of the stakers' share");
        assertLe(paid0, _forStakers(arrived));
        assertEq(carol.balance - carolBefore, paid0);
    }

    function _collectThroughShare() internal returns (uint256 eth, uint256 tok) {
        (eth, tok) = factory.collect(coin);
        share.sync();
    }

    function test_sharesASellsFeeInTheCoinItself() public {
        _stake(share, dave, IB20(coin).balanceOf(dave));
        share.harvest();
        uint256 sold = IB20(coin).balanceOf(carol) / 2;
        _sell(carol, coin, sold);
        uint256 before = IB20(coin).balanceOf(address(share));
        vm.expectEmit(true, false, false, false, address(share));
        emit Arrived(Currency.wrap(coin), 0, 0);
        share.harvest();
        uint256 arrived = IB20(coin).balanceOf(address(share)) - before;
        assertGt(arrived, 0);
        vm.warp(block.timestamp + STREAM);
        (, uint256 inCoin) = share.claimable(dave);
        assertApproxEqAbs(inCoin, _forStakers(arrived), 2);
        // the stake itself is never counted as fees
        uint256 staked = share.stakedOf(dave);
        vm.startPrank(dave);
        (, uint256 paid1) = share.claim(dave);
        share.unstake(staked);
        vm.stopPrank();
        assertEq(paid1, inCoin);
        assertEq(IB20(coin).balanceOf(dave), staked + inCoin);
    }

    function test_paysStakersInProportionToStakeAndTime() public {
        uint256 c = IB20(coin).balanceOf(dave);
        _stake(share, carol, c);
        _stake(share, dave, c); // the same amount
        share.harvest();
        vm.warp(block.timestamp + STREAM + 1);
        vm.prank(carol);
        share.claim(carol);
        vm.prank(dave);
        share.claim(dave);

        _gift(share, 7 ether);
        share.sync();
        uint256 forStakers = _forStakers(7 ether);
        vm.warp(block.timestamp + STREAM / 2);
        vm.prank(dave);
        share.unstake(c); // dave leaves halfway
        vm.warp(block.timestamp + STREAM);
        (uint256 carol0,) = share.claimable(carol);
        (uint256 dave0,) = share.claimable(dave);
        // first half split evenly, second half all carol's
        assertApproxEqAbs(dave0, forStakers / 4, 2);
        assertApproxEqAbs(carol0, forStakers * 3 / 4, 2);
    }

    function test_aStakeMadeAroundACollectEarnsNothingInThatSecond() public {
        _stake(share, dave, IB20(coin).balanceOf(dave));
        share.harvest();
        vm.warp(block.timestamp + 1 days);
        _buy(bob, coin, 50 ether); // a big fee waits in the pool
        uint256 c = IB20(coin).balanceOf(carol);
        vm.startPrank(carol);
        IB20(coin).approve(address(share), c);
        share.stake(c);
        share.harvest();
        (uint256 got0, uint256 got1) = share.claim(carol);
        share.unstake(c);
        vm.stopPrank();
        assertEq(got0, 0);
        assertEq(got1, 0);
    }

    function test_pausesTheStreamWhileNobodyIsStakedAndLosesNothing() public {
        share.harvest();
        uint256 arrived = address(share).balance;
        assertGt(arrived, 0);
        vm.warp(block.timestamp + 30 days); // nobody staked: nothing released into nothing
        share.sync();
        assertEq(share.streams(0).unreleased, _forStakers(arrived));
        _stake(share, carol, 1e18);
        vm.warp(block.timestamp + STREAM);
        (uint256 c0,) = share.claimable(carol);
        assertApproxEqAbs(c0, _forStakers(arrived), 2);
        // once everybody has left, the clock stops again
        vm.prank(carol);
        share.unstake(1e18);
        vm.warp(block.timestamp + 1 days);
        share.sync();
    }

    function test_spreadsANewArrivalTogetherWithWhatIsStillUnreleased() public {
        _stake(share, carol, 1e18);
        share.harvest();
        vm.warp(block.timestamp + STREAM + 1);
        vm.prank(carol);
        share.claim(carol);
        _gift(share, 10 ether);
        share.sync();
        vm.warp(block.timestamp + STREAM / 2);
        _gift(share, 10 ether);
        share.sync();
        RevenueShare.Stream memory st = share.streams(0);
        assertApproxEqAbs(st.unreleased, _forStakers(10 ether) / 2 + _forStakers(10 ether), 2);
        assertEq(st.finish, block.timestamp + STREAM);
        vm.warp(st.finish);
        (uint256 c0,) = share.claimable(carol);
        assertApproxEqAbs(c0, 2 * _forStakers(10 ether), 4);
    }

    function test_claimablePredictsExactlyWhatAClaimPays() public {
        _stake(share, carol, 3e18);
        _stake(share, dave, 1e18);
        _buy(bob, coin, 3 ether);
        _sell(carol, coin, 1e20);
        vm.warp(block.timestamp + 2 days);
        // fees collected but not yet seen by the share: the view counts them as a call would
        factory.collect(coin);
        vm.warp(block.timestamp + 3 days);
        (uint256 c0, uint256 c1) = share.claimable(carol);
        vm.prank(carol);
        (uint256 p0, uint256 p1) = share.claim(carol);
        assertEq(p0, c0);
        assertEq(p1, c1);
        (c0, c1) = share.claimable(carol);
        assertEq(c0 + c1, 0);
    }

    function test_paysStakersWhenTheCoinSortsBeforeAStockQuoteAndAfterIt() public {
        for (uint256 above; above < 2; above++) {
            address c = _launchOnStock(above == 1);
            RevenueShare s = deployer.create(c, address(0), 0);
            vm.prank(alice);
            factory.setCreatorRecipient(c, address(s));
            vm.warp(block.timestamp + 60);
            uint256 got = _buy(carol, c, 10e8);
            _stake(s, carol, got);
            s.harvest();
            vm.warp(block.timestamp + STREAM + 1);
            vm.prank(carol);
            s.claim(carol);
            _buy(bob, c, 1_000e8); // a stock fee, 8 decimals
            uint256 before = stock.balanceOf(address(s));
            s.harvest();
            uint256 arrived = stock.balanceOf(address(s)) - before;
            assertGt(arrived, 0);
            vm.warp(block.timestamp + STREAM);
            uint256 carolStock = stock.balanceOf(carol);
            vm.prank(carol);
            s.claim(carol);
            // no agent: stakers get everything, to within a unit of the stock
            assertApproxEqAbs(stock.balanceOf(carol) - carolStock, arrived, 1);
        }
    }

    function _launchOnStock(bool tokenAbove) internal returns (address token) {
        bytes32 salt;
        for (uint256 i = 100; ; i++) {
            salt = bytes32(i);
            if ((factory.predictToken(alice, salt) > address(stock)) == tokenAbove) break;
        }
        vm.prank(alice);
        token = factory.launch("Stock Cat", "SCAT", "", salt, address(stock), 0, ONE, address(0));
    }

    // ───────────────────────────────────────────── refusals

    function test_keepsAClaimTheReceiverRefusesAndPaysTheOtherCurrency() public {
        _stake(share, carol, IB20(coin).balanceOf(carol));
        _buy(bob, coin, 5 ether);
        _sell(dave, coin, IB20(coin).balanceOf(dave));
        share.harvest();
        vm.warp(block.timestamp + STREAM);
        RSRefuser refuser = new RSRefuser();
        (uint256 c0, uint256 c1) = share.claimable(carol);
        vm.prank(carol);
        (uint256 p0, uint256 p1) = share.claim(address(refuser));
        assertEq(p0, 0, "ETH refused");
        assertEq(p1, c1, "the coin still paid");
        assertEq(IB20(coin).balanceOf(address(refuser)), c1);
        (uint256 left0, uint256 left1) = share.claimable(carol);
        assertEq(left0, c0, "the refused ETH is still carol's");
        assertEq(left1, 0);
        vm.prank(carol);
        share.claim(carol);
        assertGe(carol.balance, c0);
    }

    function test_keepsTheAgentsShareUntilTheAgentCanTakeIt() public {
        vm.prank(alice);
        address other = factory.launch("Two", "TWO", "", bytes32(uint256(2)), address(0), 0, ONE, address(0));
        RSLateTaker late = new RSLateTaker();
        RevenueShare s = deployer.create(other, address(late), 5_000);
        vm.prank(alice);
        factory.setCreatorRecipient(other, address(s));
        vm.warp(block.timestamp + 60);
        _buy(bob, other, 2 ether);
        s.harvest();
        uint256 owedAgent = s.streams(0).agentOwed;
        assertGt(owedAgent, 0);
        s.payAgent();
        assertEq(s.streams(0).agentOwed, owedAgent, "refused, still owed");
        late.openUp();
        s.payAgent();
        assertEq(address(late).balance, owedAgent);
        assertEq(s.streams(0).agentOwed, 0);
        s.payAgent(); // nothing owed: nothing happens
    }

    function test_keepsAPaymentThatReentersAsRefused() public {
        _stake(share, carol, 1e18);
        share.harvest();
        vm.warp(block.timestamp + STREAM + 1);
        RSReenterer r = new RSReenterer();
        r.arm(share);
        (uint256 c0,) = share.claimable(carol);
        assertGt(c0, 0);
        vm.prank(carol);
        (uint256 p0,) = share.claim(address(r));
        assertEq(p0, 0);
        (uint256 still,) = share.claimable(carol);
        assertEq(still, c0);
    }

    function test_refusesAnyEntryWhileACallIsInProgress() public {
        assertEq(uint256(vm.load(address(share), bytes32(LOCK_SLOT))), 1, "the slot holds the lock");
        vm.store(address(share), bytes32(LOCK_SLOT), bytes32(uint256(2)));
        vm.expectRevert(RevenueShare.Reentrancy.selector);
        share.stake(1);
        vm.expectRevert(RevenueShare.Reentrancy.selector);
        share.stakeWithPermit(1, 0, 0, 0, 0);
        vm.expectRevert(RevenueShare.Reentrancy.selector);
        share.unstake(1);
        vm.expectRevert(RevenueShare.Reentrancy.selector);
        share.claim(carol);
        vm.expectRevert(RevenueShare.Reentrancy.selector);
        share.payAgent();
        vm.expectRevert(RevenueShare.Reentrancy.selector);
        share.harvest();
        vm.expectRevert(RevenueShare.Reentrancy.selector);
        share.pullOwed(ETH);
        vm.expectRevert(RevenueShare.Reentrancy.selector);
        share.sync();
    }

    /// A quote whose transfer refuses the share contract: the launchpad keeps it as owed, and the
    /// share pulls it in once the quote lets it through.
    function test_pullsInWhatTheLaunchpadKeptForIt() public {
        RSOddToken odd = new RSOddToken();
        odd.mint(bob, 1_000e18);
        vm.prank(admin);
        factory.setQuote(address(odd), true, START);
        vm.prank(alice);
        address c = factory.launch("Odd", "ODD", "", bytes32(uint256(9)), address(odd), 0, ONE, address(0));
        RevenueShare s = deployer.create(c, address(0), 0);
        vm.prank(alice);
        factory.setCreatorRecipient(c, address(s));
        vm.warp(block.timestamp + 60);
        _buy(bob, c, 100e18);
        odd.refuse(address(s), true);
        s.harvest();
        Currency oddC = Currency.wrap(address(odd));
        uint256 kept = factory.owed(address(s), oddC);
        assertGt(kept, 0);
        vm.expectRevert(LaunchFactoryV3.TransferFailed.selector);
        s.pullOwed(oddC);
        odd.refuse(address(s), false);
        s.pullOwed(oddC);
        assertEq(odd.balanceOf(address(s)), kept);
        uint256 i = Currency.unwrap(s.currency0()) == address(odd) ? 0 : 1;
        assertEq(s.streams(i).unreleased, kept, "accounted and streaming");
    }

    /// A stock's issuer can seize from anyone, this contract included (Coinbase's stocks carry a
    /// SEIZE_ROLE; base-forge's B20 precompile does not implement `seizeWithMemo`, so the seizure is
    /// modelled by a token that can take a balance back). What the contract can no longer cover is
    /// refused at the claim and stays credited; nothing reverts and the other currency still pays.
    function test_survivesABalanceTakenFromItBySeizure() public {
        RSOddToken coinish = new RSOddToken();
        RSOddToken quote = new RSOddToken();
        RSFakeLaunchpad lp = new RSFakeLaunchpad();
        lp.set(address(coinish), Currency.wrap(address(coinish)), Currency.wrap(address(quote)));
        RevenueShare s = new RevenueShare(ILaunchpad(address(lp)), address(coinish), address(0), 0);
        coinish.mint(carol, 10e18);
        vm.startPrank(carol);
        coinish.approve(address(s), 10e18);
        s.stake(10e18);
        vm.stopPrank();
        quote.mint(address(s), 100e8);
        coinish.mint(address(s), 1e18);
        s.sync();
        vm.warp(block.timestamp + STREAM);
        quote.seize(address(s), 100e8);
        s.sync(); // a balance below what is accounted brings nothing in and does not revert
        (uint256 c0, uint256 c1) = s.claimable(carol);
        assertApproxEqAbs(c1, 100e8, 1);
        vm.prank(carol);
        (uint256 p0, uint256 p1) = s.claim(carol);
        assertEq(p1, 0, "the seized stock cannot be paid");
        assertEq(p0, c0, "the other currency still is");
        (, uint256 left1) = s.claimable(carol);
        assertEq(left1, c1, "and the stock stays credited");
    }

    // ───────────────────────────────────────────── a staked token that can fail (not a B20)

    function _oddShare() internal returns (RSOddToken odd, RevenueShare s) {
        odd = new RSOddToken();
        RSFakeLaunchpad lp = new RSFakeLaunchpad();
        lp.set(address(odd), Currency.wrap(address(odd)), ETH);
        s = new RevenueShare(ILaunchpad(address(lp)), address(odd), address(0), 0);
        odd.mint(carol, 100e18);
        vm.prank(carol);
        odd.approve(address(s), type(uint256).max);
    }

    function test_refusesAStakeTheTokenWouldNotMove() public {
        (RSOddToken odd, RevenueShare s) = _oddShare();
        odd.setMode(RSOddToken.Mode.ReturnsFalse);
        vm.prank(carol);
        vm.expectRevert(RevenueShare.TransferFailed.selector);
        s.stake(1e18);
    }

    function test_refusesAnUnstakeTheTokenWouldNotMove() public {
        (RSOddToken odd, RevenueShare s) = _oddShare();
        vm.prank(carol);
        s.stake(1e18);
        odd.refuse(carol, true);
        vm.prank(carol);
        vm.expectRevert(RevenueShare.TransferFailed.selector);
        s.unstake(1e18);
        assertEq(s.stakedOf(carol), 1e18, "still staked");
    }

    function test_paysATokenThatReturnsNothingAndKeepsOneThatReturnsFalse() public {
        (RSOddToken odd, RevenueShare s) = _oddShare();
        vm.prank(carol);
        s.stake(1e18);
        odd.mint(address(s), 5e18); // a gift in the coin
        s.sync();
        vm.warp(block.timestamp + STREAM);
        odd.setMode(RSOddToken.Mode.ReturnsFalse);
        vm.prank(carol);
        (uint256 refused,) = s.claim(carol);
        assertEq(refused, 0);
        odd.setMode(RSOddToken.Mode.NoReturn);
        vm.prank(carol);
        (uint256 paid,) = s.claim(carol);
        assertApproxEqAbs(paid, 5e18, 1);
        assertEq(odd.balanceOf(carol), 99e18 + paid);
    }

    // ───────────────────────────────────────────── fuzzing the accounting

    /// Two stakers in for the whole stream are paid in proportion to their stakes, to within a wei or two.
    function testFuzz_paysInProportionToStake(uint96 a, uint96 b, uint96 gift) public {
        a = uint96(bound(a, 1, IB20(coin).balanceOf(carol)));
        b = uint96(bound(b, 1, IB20(coin).balanceOf(dave)));
        gift = uint96(bound(gift, 1, 1_000 ether));
        share.harvest();
        _stake(share, carol, a);
        _stake(share, dave, b);
        vm.warp(block.timestamp + STREAM + 1); // the setup's fees, out of the way
        vm.prank(carol);
        share.claim(carol);
        vm.prank(dave);
        share.claim(dave);
        _gift(share, gift);
        share.sync();
        vm.warp(block.timestamp + STREAM);
        (uint256 ca,) = share.claimable(carol);
        (uint256 cb,) = share.claimable(dave);
        uint256 total = _forStakers(gift);
        assertLe(ca + cb, total, "never more than arrived");
        assertApproxEqAbs(ca, total * a / (uint256(a) + b), 2);
        assertApproxEqAbs(cb, total * b / (uint256(a) + b), 2);
    }

    /// A stake earns for the seconds it is staked and no more — wherever in the stream it joins.
    function testFuzz_aLateStakerEarnsOnlyItsShareOfTheTimeLeft(uint32 joinAfter, uint96 gift) public {
        joinAfter = uint32(bound(joinAfter, 0, STREAM));
        gift = uint96(bound(gift, 1 ether, 1_000 ether));
        uint256 x = 1e18;
        _stake(share, carol, x);
        share.harvest();
        vm.warp(block.timestamp + STREAM + 1);
        vm.prank(carol);
        share.claim(carol);
        _gift(share, gift);
        share.sync();
        vm.warp(block.timestamp + joinAfter);
        _stake(share, dave, x);
        vm.warp(block.timestamp + STREAM);
        (uint256 cd,) = share.claimable(dave);
        uint256 total = _forStakers(gift);
        // dave held half the stake for the part of the stream after he joined
        uint256 expected = total * (STREAM - joinAfter) / STREAM / 2;
        assertApproxEqAbs(cd, expected, 3);
    }

    /// Any sequence of stakes, unstakes, arrivals, claims and waits: the contract always holds at least
    /// what it owes, never pays out more than arrived, and once the stream has run out with somebody
    /// staked, loses no more than a wei per bookkeeping step to rounding.
    function testFuzz_staysSolventAndLosesOnlyDust(uint256 seed) public {
        address[3] memory who = [carol, dave, bob];
        _buy(bob, coin, 1 ether);
        share.harvest();
        uint256 arrived0 = address(share).balance; // from the trades above
        uint256 gifts;
        uint256 paidOut;
        uint256 steps;
        for (uint256 n; n < 40; n++) {
            uint256 r = uint256(keccak256(abi.encode(seed, n)));
            address w = who[r % 3];
            uint256 action = (r >> 8) % 5;
            if (action == 0) {
                uint256 bal = IB20(coin).balanceOf(w);
                if (bal == 0) continue;
                _stake(share, w, bound(r >> 16, 1, bal));
            } else if (action == 1) {
                uint256 st = share.stakedOf(w);
                if (st == 0) continue;
                vm.prank(w);
                share.unstake(bound(r >> 16, 1, st));
            } else if (action == 2) {
                uint256 g = bound(r >> 16, 1, 50 ether);
                gifts += g;
                _gift(share, g);
            } else if (action == 3) {
                vm.warp(block.timestamp + bound(r >> 16, 1, 3 days));
            } else {
                vm.prank(w);
                (uint256 p0,) = share.claim(w);
                paidOut += p0;
            }
            steps++;
            _assertSolvent(who);
        }
        // let the stream run out with somebody staked, then everyone takes everything
        _stake(share, carol, 1);
        vm.warp(block.timestamp + STREAM + 1);
        for (uint256 k; k < 3; k++) {
            vm.prank(who[k]);
            (uint256 p0,) = share.claim(who[k]);
            paidOut += p0;
        }
        share.payAgent();
        _assertSolvent(who);
        uint256 total = arrived0 + gifts;
        uint256 out = paidOut + agent.balance;
        assertLe(out, total, "never more than arrived");
        assertLe(total - out, steps * 3 + 10, "only rounding dust stays behind");
        assertEq(share.streams(0).unreleased, 0);
    }

    function _assertSolvent(address[3] memory who) internal {
        share.sync();
        uint256 owe0 = share.streams(0).unreleased + share.streams(0).agentOwed;
        uint256 owe1 = share.streams(1).unreleased + share.streams(1).agentOwed + share.totalStaked();
        for (uint256 k; k < 3; k++) {
            (uint256 c0, uint256 c1) = share.claimable(who[k]);
            owe0 += c0;
            owe1 += c1;
        }
        assertGe(address(share).balance, owe0, "ETH covers what is owed");
        assertGe(IB20(coin).balanceOf(address(share)), owe1, "the coin covers stakes and what is owed");
    }
}
