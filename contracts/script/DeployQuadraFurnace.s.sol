// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {QuadraFurnace, IFurnaceLaunchpad} from "../src/QuadraFurnace.sol";

/// @notice Deploy the furnace for $QUADRA. Run by the OWNER, with the owner's own key — this repo never
///         holds one. It receives nothing until the coin's creator recipient (the launcher's wallet)
///         sends `setCreatorRecipient(QUADRA, <furnace>)` on the launchpad, which is FOR GOOD.
///
///   base-forge script script/DeployQuadraFurnace.s.sol --rpc-url https://mainnet.base.org   # dry run
///   base-forge script script/DeployQuadraFurnace.s.sol --rpc-url https://mainnet.base.org \
///     --account quadra-deployer --broadcast --verify --verifier sourcify
contract DeployQuadraFurnace is Script {
    /// LaunchFactoryV3 on Base — CONTRACTS.launchFactoryV3 in src/config/chain.ts.
    IFurnaceLaunchpad internal constant LAUNCHPAD_V3 = IFurnaceLaunchpad(0x006Da367654a487bb277fe25ff54f0fE0f741377);
    /// Uniswap v4 PoolManager on Base — UNISWAP_V4_POOL_MANAGER in src/config/chain.ts.
    IPoolManager internal constant POOL_MANAGER = IPoolManager(0x498581fF718922c3f8e6A244956aF099B2652b2b);
    /// $QUADRA paired with ETH (2026-11-25; the AAPLc-paired 0xb200…0816 of 2026-10-29 was never traded and
    /// is abandoned). PREDICTED by eth_call of scripts/prepare-quadra-launch.ts's calldata from
    /// quadra-deployer; `run` refuses until the launchpad has a record of it, so confirm it after the launch.
    address internal constant QUADRA = 0xB200000000000000000000bdb78b7B145fB15d7F;
    /// CONTRACTS.treasury — receives what is not burnt, and alone triggers buybacks.
    address internal constant TREASURY = 0xD5C1dFc036F9911348EA8065F73c8123f4013FAB;
    /// The share of every arrival burnt: 50%, the rest to the treasury (owner, 2026-10-29: "keep part of
    /// the revenue for the treasury"). Fixed for good once deployed — change it here, before deploying.
    uint16 internal constant BURN_BPS = 5_000;

    function run() external returns (QuadraFurnace furnace) {
        require(block.chainid == 8453, "this deploy is for Base mainnet (8453)");
        require(LAUNCHPAD_V3.launches(QUADRA).creator != address(0), "QUADRA is not a coin of this launchpad");
        vm.startBroadcast();
        furnace = new QuadraFurnace(LAUNCHPAD_V3, POOL_MANAGER, QUADRA, TREASURY, BURN_BPS);
        vm.stopBroadcast();
        require(furnace.token() == QUADRA && furnace.treasury() == TREASURY && furnace.burnBps() == BURN_BPS, "deployed with the wrong settings");
        console.log("QuadraFurnace", address(furnace));
        console.log("next, from the launcher's wallet: setCreatorRecipient(QUADRA, furnace) on the launchpad");
    }
}
