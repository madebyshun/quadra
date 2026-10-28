// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {RevenueShareDeployer, ILaunchpad} from "../src/RevenueShare.sol";

/// @notice Deploy the RevenueShare deployer for launchpad v3. NOT YET APPROVED: run only after the
///         owner has said yes (contracts/README.md, "RevenueShare"). Run by the OWNER, with the
///         owner's own key — this repo never holds one.
///
///   base-forge script script/DeployRevenueShareDeployer.s.sol --rpc-url https://mainnet.base.org \
///     --account <your keystore> --broadcast --verify --verifier sourcify
///
/// The deployer has no owner and no settings; each coin's RevenueShare is then created by whoever
/// sets one up (`create(token, agent, agentBps)`), and does nothing until the coin's creator
/// recipient points its share at it.
contract DeployRevenueShareDeployer is Script {
    /// LaunchFactoryV3 on Base — CONTRACTS.launchFactoryV3 in src/config/chain.ts, deployed 2026-10-22.
    ILaunchpad internal constant LAUNCHPAD_V3 = ILaunchpad(0x006Da367654a487bb277fe25ff54f0fE0f741377);

    function run() external returns (RevenueShareDeployer deployer) {
        require(block.chainid == 8453, "this deploy is for Base mainnet (8453)");
        require(address(LAUNCHPAD_V3).code.length > 0, "no launchpad at that address on this chain");
        vm.startBroadcast();
        deployer = new RevenueShareDeployer(LAUNCHPAD_V3);
        vm.stopBroadcast();
        require(address(deployer.launchpad()) == address(LAUNCHPAD_V3), "bound to the wrong launchpad");
        console.log("RevenueShareDeployer", address(deployer));
    }
}
