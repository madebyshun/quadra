// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {BasketRouter, IUSDC} from "../src/BasketRouter.sol";

/// A USDC stand-in: plain balances and allowances, a `permit` that grants exactly what it is asked
/// for (the signature's validity is USDC's business, not the router's), and switches to make each of
/// its calls fail the way a token can.
contract TestUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public permitReverts;
    bool public transferFromFalse;
    bool public transferFalse;
    bool public approveFalse;
    bool public approveZeroFalse;

    function set(bool p, bool tf, bool t, bool a, bool az) external {
        (permitReverts, transferFromFalse, transferFalse, approveFalse, approveZeroFalse) = (p, tf, t, a, az);
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (amount == 0 ? approveZeroFalse : approveFalse) return false;
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function permit(address owner, address spender, uint256 value, uint256, uint8, bytes32, bytes32) external {
        require(!permitReverts, "permit used");
        allowance[owner][spender] = value;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (transferFalse) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (transferFromFalse) return false;
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// What the buyer receives: a token whose balances the proxy mints.
contract TestToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
}

/// Relay's approval proxy, reduced to what a leg does: pull USDC from its caller, deliver a token to
/// the recipient. It can use less than it was approved (the router refunds the rest), revert with a
/// reason, or call back into the router.
contract TestRelayProxy {
    TestUSDC public immutable usdc;

    constructor(TestUSDC usdc_) {
        usdc = usdc_;
    }

    function swap(uint256 pull, TestToken out, address to, uint256 amount) external {
        usdc.transferFrom(msg.sender, address(this), pull);
        out.mint(to, amount);
    }

    function fail() external pure {
        revert("no route");
    }

    function reenter(BasketRouter router) external {
        router.buy(new BasketRouter.Leg[](1), type(uint256).max);
    }
}

abstract contract BasketRouterBase is Test {
    TestUSDC usdc;
    TestToken nvda;
    TestToken aapl;
    TestRelayProxy proxyA;
    TestRelayProxy proxyB;
    BasketRouter router;
    address buyer = address(0xB0B);
    uint256 constant DEADLINE = 2_000_000_000;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        usdc = new TestUSDC();
        nvda = new TestToken();
        aapl = new TestToken();
        proxyA = new TestRelayProxy(usdc);
        proxyB = new TestRelayProxy(usdc);
        router = new BasketRouter(IUSDC(address(usdc)), address(proxyA), address(proxyB));
        usdc.mint(buyer, 1_000e6);
    }

    function _leg(TestRelayProxy p, uint256 amountIn, uint256 pull, TestToken out, uint256 delivered, uint256 minOut) internal view returns (BasketRouter.Leg memory) {
        return BasketRouter.Leg({
            target: address(p),
            amountIn: amountIn,
            tokenOut: address(out),
            minOut: minOut,
            data: abi.encodeCall(TestRelayProxy.swap, (pull, out, buyer, delivered))
        });
    }

    function _two() internal view returns (BasketRouter.Leg[] memory legs) {
        legs = new BasketRouter.Leg[](2);
        legs[0] = _leg(proxyA, 60e6, 60e6, nvda, 3e8, 3e8);
        legs[1] = _leg(proxyB, 40e6, 40e6, aapl, 1e8, 1e8);
    }

}

contract BasketRouterTest is BasketRouterBase {
    function test_buysEveryLegInOneTransaction_straightToTheBuyer() public {
        vm.prank(buyer);
        usdc.approve(address(router), 100e6);
        vm.expectEmit(true, false, false, true, address(router));
        emit BasketRouter.BasketBought(buyer, 100e6, 0, 2);
        vm.prank(buyer);
        uint256 refunded = router.buy(_two(), DEADLINE);
        assertEq(refunded, 0);
        assertEq(nvda.balanceOf(buyer), 3e8);
        assertEq(aapl.balanceOf(buyer), 1e8);
        assertEq(usdc.balanceOf(buyer), 900e6);
        // nothing is left behind: no USDC, no token, no allowance
        assertEq(usdc.balanceOf(address(router)), 0);
        assertEq(nvda.balanceOf(address(router)), 0);
        assertEq(usdc.allowance(address(router), address(proxyA)), 0);
        assertEq(usdc.allowance(address(router), address(proxyB)), 0);
    }

    function test_buysWithOnePermitSignature_andToleratesAPermitAlreadyUsed() public {
        vm.prank(buyer);
        router.buyWithPermit(_two(), DEADLINE, 27, bytes32(0), bytes32(0));
        assertEq(nvda.balanceOf(buyer), 3e8);
        // someone submitted the signature first: the permit reverts, the allowance is already there
        usdc.set(true, false, false, false, false);
        vm.prank(buyer);
        usdc.approve(address(router), 100e6);
        vm.prank(buyer);
        router.buyWithPermit(_two(), DEADLINE, 27, bytes32(0), bytes32(0));
        assertEq(nvda.balanceOf(buyer), 6e8);
    }

    function test_refundsWhatALegDidNotUse() public {
        BasketRouter.Leg[] memory legs = new BasketRouter.Leg[](1);
        legs[0] = _leg(proxyA, 50e6, 49e6, nvda, 1e8, 1e8);
        vm.prank(buyer);
        usdc.approve(address(router), 50e6);
        vm.prank(buyer);
        assertEq(router.buy(legs, DEADLINE), 1e6);
        assertEq(usdc.balanceOf(buyer), 951e6);
        assertEq(usdc.balanceOf(address(router)), 0);
    }

    function test_revertsTheWholeBasketWhenALegDeliversTooLittle() public {
        BasketRouter.Leg[] memory legs = _two();
        legs[1] = _leg(proxyB, 40e6, 40e6, aapl, 1e8 - 1, 1e8);
        vm.prank(buyer);
        usdc.approve(address(router), 100e6);
        vm.expectRevert(abi.encodeWithSelector(BasketRouter.TooLittle.selector, 1, 1e8 - 1, 1e8));
        vm.prank(buyer);
        router.buy(legs, DEADLINE);
        assertEq(nvda.balanceOf(buyer), 0);
        assertEq(usdc.balanceOf(buyer), 1_000e6);
    }

    function test_revertsWithTheLegsOwnReason() public {
        BasketRouter.Leg[] memory legs = _two();
        legs[0].data = abi.encodeCall(TestRelayProxy.fail, ());
        vm.prank(buyer);
        usdc.approve(address(router), 100e6);
        vm.expectRevert(abi.encodeWithSelector(BasketRouter.LegFailed.selector, 0, abi.encodeWithSignature("Error(string)", "no route")));
        vm.prank(buyer);
        router.buy(legs, DEADLINE);
    }

    /// The property that makes approving this contract safe: a leg can only call Relay.
    function test_callsNothingButTheTwoRelayProxies() public {
        address victim = address(0xA11CE);
        usdc.mint(victim, 500e6);
        vm.prank(victim);
        usdc.approve(address(router), type(uint256).max);
        BasketRouter.Leg[] memory legs = new BasketRouter.Leg[](1);
        legs[0] = BasketRouter.Leg({
            target: address(usdc),
            amountIn: 0,
            tokenOut: address(nvda),
            minOut: 0,
            data: abi.encodeCall(TestUSDC.transferFrom, (victim, buyer, 500e6))
        });
        vm.expectRevert(abi.encodeWithSelector(BasketRouter.NotRelay.selector, address(usdc)));
        vm.prank(buyer);
        router.buy(legs, DEADLINE);
        assertEq(usdc.balanceOf(victim), 500e6);
    }

    function test_refusesNoLegs_tooMany_andALateBasket() public {
        vm.expectRevert(BasketRouter.NoLegs.selector);
        router.buy(new BasketRouter.Leg[](0), DEADLINE);
        vm.expectRevert(BasketRouter.TooManyLegs.selector);
        router.buy(new BasketRouter.Leg[](11), DEADLINE);
        vm.expectRevert(BasketRouter.Expired.selector);
        router.buy(_two(), block.timestamp - 1);
    }

    function test_refusesATokenThatAnswersFalse_atEveryStep() public {
        vm.prank(buyer);
        usdc.approve(address(router), type(uint256).max);
        bool[5][4] memory cases = [
            [false, true, false, false, false], // transferFrom
            [false, false, false, true, false], // approve the leg
            [false, false, false, false, true], // approve back to zero
            [false, false, true, false, false] // the refund
        ];
        for (uint256 c; c < cases.length; ++c) {
            usdc.set(cases[c][0], cases[c][1], cases[c][2], cases[c][3], cases[c][4]);
            BasketRouter.Leg[] memory legs = new BasketRouter.Leg[](1);
            // the refund case needs something to refund
            legs[0] = _leg(proxyA, 10e6, c == 3 ? 9e6 : 10e6, nvda, 1, 1);
            vm.expectRevert(BasketRouter.TransferFailed.selector);
            vm.prank(buyer);
            router.buy(legs, DEADLINE);
        }
    }

    function test_refusesReentry() public {
        vm.prank(buyer);
        usdc.approve(address(router), 10e6);
        BasketRouter.Leg[] memory legs = new BasketRouter.Leg[](1);
        legs[0] = BasketRouter.Leg({ target: address(proxyA), amountIn: 10e6, tokenOut: address(nvda), minOut: 0, data: abi.encodeCall(TestRelayProxy.reenter, (router)) });
        vm.expectRevert(abi.encodeWithSelector(BasketRouter.LegFailed.selector, 0, abi.encodeWithSelector(BasketRouter.Reentrant.selector)));
        vm.prank(buyer);
        router.buy(legs, DEADLINE);
    }

    function test_refusesAZeroAddressAtDeployment() public {
        vm.expectRevert(BasketRouter.ZeroAddress.selector);
        new BasketRouter(IUSDC(address(0)), address(proxyA), address(proxyB));
        vm.expectRevert(BasketRouter.ZeroAddress.selector);
        new BasketRouter(IUSDC(address(usdc)), address(0), address(proxyB));
        vm.expectRevert(BasketRouter.ZeroAddress.selector);
        new BasketRouter(IUSDC(address(usdc)), address(proxyA), address(0));
    }

    function testFuzz_neverKeepsUsdc(uint96 a, uint96 b, uint96 usedA) public {
        vm.assume(a > 0 && b > 0 && uint256(a) + b <= 1_000e6 && usedA <= a);
        BasketRouter.Leg[] memory legs = new BasketRouter.Leg[](2);
        legs[0] = _leg(proxyA, a, usedA, nvda, 5, 5);
        legs[1] = _leg(proxyB, b, b, aapl, 7, 7);
        vm.prank(buyer);
        usdc.approve(address(router), uint256(a) + b);
        vm.prank(buyer);
        router.buy(legs, DEADLINE);
        assertEq(usdc.balanceOf(address(router)), 0);
        assertEq(usdc.balanceOf(buyer), 1_000e6 - usedA - b);
    }
}
