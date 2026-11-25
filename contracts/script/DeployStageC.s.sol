// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Backstop, IBackstopLaunchpad} from "../src/Backstop.sol";
import {FeeRouter, IRouterLaunchpad} from "../src/FeeRouter.sol";

/// @notice Stage C (docs/BACKSTOP.md): deploy the Backstop for $QUADRA and the FeeRouter that feeds it. Run by
///         the OWNER with the owner's own key; this repo never holds one. Deploying moves no money: fees keep
///         going to the treasury until the treasury proposes the router and the router accepts.
///
///   base-forge script script/DeployStageC.s.sol --rpc-url https://mainnet.base.org   # dry run
///   base-forge script script/DeployStageC.s.sol --rpc-url https://mainnet.base.org \
///     --account quadra-deployer --broadcast --verify --verifier sourcify
contract DeployStageC is Script {
    /// LaunchFactoryV3 on Base: CONTRACTS.launchFactoryV3 in src/config/chain.ts.
    address internal constant LAUNCHPAD_V3 = 0x006Da367654a487bb277fe25ff54f0fE0f741377;
    /// Uniswap v4 PoolManager on Base: UNISWAP_V4_POOL_MANAGER in src/config/chain.ts.
    address internal constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    /// $QUADRA paired with ETH: CONTRACTS.token.
    address internal constant QUADRA = 0xB200000000000000000000bdb78b7B145fB15d7F;
    /// CONTRACTS.treasury: v3's protocol recipient today, and the router's treasury.
    address internal constant TREASURY = 0xD5C1dFc036F9911348EA8065F73c8123f4013FAB;

    function run() external returns (Backstop backstop, FeeRouter router) {
        require(block.chainid == 8453, "this deploy is for Base mainnet (8453)");
        vm.startBroadcast();
        backstop = new Backstop(IBackstopLaunchpad(LAUNCHPAD_V3), IPoolManager(POOL_MANAGER), QUADRA);
        router = new FeeRouter(IRouterLaunchpad(LAUNCHPAD_V3), TREASURY, address(backstop));
        vm.stopBroadcast();
        require(backstop.token() == QUADRA && address(backstop.poolManager()) == POOL_MANAGER, "backstop settings");
        require(address(router.launchpad()) == LAUNCHPAD_V3 && router.treasury() == TREASURY && router.backstop() == address(backstop), "router settings");
        console.log("Backstop", address(backstop));
        console.log("FeeRouter", address(router));
        console.log("next, from the TREASURY: proposeProtocolRecipient(FeeRouter) on LaunchFactoryV3; then anyone: FeeRouter.accept()");
    }
}
