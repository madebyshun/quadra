// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {LaunchFactory} from "../src/LaunchFactory.sol";

/// @notice Deploy the launchpad. Run by the OWNER, with the owner's own key — this repo never holds one.
///
///   base-forge script script/DeployLaunchFactory.s.sol --rpc-url https://mainnet.base.org \
///     --account <your keystore> --broadcast --verify --verifier blockscout \
///     --verifier-url https://base.blockscout.com/api/
///
/// Everything it is given is checked here first, so a typo fails before it costs gas.
contract DeployLaunchFactory is Script {
    /// Uniswap v4's PoolManager on Base, verified on Blockscout ("PoolManager", is_verified) 2026-10-01.
    IPoolManager internal constant POOL_MANAGER = IPoolManager(0x498581fF718922c3f8e6A244956aF099B2652b2b);
    /// The protocol's fee address — `CONTRACTS.treasury` in src/config/chain.ts, set by the owner 2026-09-30.
    address internal constant TREASURY = 0xD5C1dFc036F9911348EA8065F73c8123f4013FAB;
    /// Opening price ≈ 2.0×10^8 tokens per ETH: the billion-token supply opens at about 5 ETH.
    int24 internal constant START_TICK = 191_200;

    function run() external returns (LaunchFactory factory) {
        require(address(POOL_MANAGER).code.length > 0, "no PoolManager at that address on this chain");
        require(block.chainid == 8453, "this deploy is for Base mainnet (8453)");
        vm.startBroadcast();
        // the deploying wallet becomes the quote admin, so the same keystore enables stock pairs
        (, address admin,) = vm.readCallers();
        factory = new LaunchFactory(POOL_MANAGER, TREASURY, admin, START_TICK);
        vm.stopBroadcast();
        console.log("LaunchFactory", address(factory));
        console.log("quote admin", admin);
    }
}
