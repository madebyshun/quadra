// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {QuadraFurnace, IFurnaceLaunchpad} from "../src/QuadraFurnace.sol";

interface IRecipient {
    function setCreatorRecipient(address token, address recipient) external;
}

interface IBal {
    function balanceOf(address) external view returns (uint256);
}

/// @notice Hand-run, never broadcast: the whole furnace on REAL Base state — deploy, point $QUADRA's
///         creator share at it (as its launcher), harvest the real fees waiting, buy back with what
///         was set aside, burn. `base-forge script script/SimulateQuadraFurnace.s.sol --rpc-url https://mainnet.base.org`
contract SimulateQuadraFurnace is Script {
    IFurnaceLaunchpad internal constant V3 = IFurnaceLaunchpad(0x006Da367654a487bb277fe25ff54f0fE0f741377);
    IPoolManager internal constant PM = IPoolManager(0x498581fF718922c3f8e6A244956aF099B2652b2b);
    address internal constant QUADRA = 0xb200000000000000000000d096efba9896ab0816;
    address internal constant AAPL = 0xb200000000000000000000C2e324d24d7eEcd1fb;
    address internal constant TREASURY = 0xD5C1dFc036F9911348EA8065F73c8123f4013FAB;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    function run() external {
        QuadraFurnace f = new QuadraFurnace(V3, PM, QUADRA, TREASURY, 5_000);
        address launcher = V3.launches(QUADRA).creatorRecipient;
        vm.prank(launcher);
        IRecipient(address(V3)).setCreatorRecipient(QUADRA, address(f));
        console.log("active", f.isActive());
        uint256 deadBefore = IBal(QUADRA).balanceOf(DEAD);
        uint256 tAapl = IBal(AAPL).balanceOf(TREASURY);
        f.harvest();
        console.log("burnt from fees (QUADRA wei)", f.burnedFromFees());
        console.log("AAPLc set aside for buyback", f.toBuy());
        console.log("AAPLc to treasury", IBal(AAPL).balanceOf(TREASURY) - tAapl);
        uint256 set = f.toBuy();
        if (set > 0) {
            vm.prank(TREASURY);
            uint256 got = f.buyAndBurn(set, 1);
            console.log("bought back and burnt (QUADRA wei)", got);
        }
        console.log("QUADRA at the dead address, added", IBal(QUADRA).balanceOf(DEAD) - deadBefore);
    }
}
