// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LaunchFactoryV3} from "../src/LaunchFactoryV3.sol";
import {HookSalt} from "./HookSalt.sol";

/// @notice Deploy launchpad v3 and its hook. Run by the OWNER, with the owner's own key — this repo
///         never holds one.
///
///   base-forge script script/DeployLaunchFactoryV3.s.sol --rpc-url https://mainnet.base.org \
///     --account <your keystore> --broadcast --verify --verifier blockscout \
///     --verifier-url https://base.blockscout.com/api/
///
/// ONE transaction: the factory's constructor deploys the hook with CREATE2, so the hook's address is
/// mined against the FACTORY's address, which is the deploying wallet's next CREATE address. The
/// script mines the salt for exactly that address, and refuses to continue if the factory or the hook
/// would land anywhere else — e.g. if the keystore sends another transaction between mining and the
/// deploy, the nonce moves and the constructor would revert with `HookAddressNotValid` anyway.
contract DeployLaunchFactoryV3 is Script {
    /// Uniswap v4's PoolManager on Base, verified on Blockscout ("PoolManager", is_verified) 2026-10-01.
    IPoolManager internal constant POOL_MANAGER = IPoolManager(0x498581fF718922c3f8e6A244956aF099B2652b2b);
    /// The protocol's fee address — `CONTRACTS.treasury` in src/config/chain.ts, set by the owner 2026-09-30.
    address internal constant TREASURY = 0xD5C1dFc036F9911348EA8065F73c8123f4013FAB;
    /// Opening price ≈ 2.0×10^8 tokens per ETH: the billion-token supply opens at about 5 ETH (as v1, v2).
    int24 internal constant START_TICK = 191_200;
    /// The anti-sniper opening: 50% at the second the pool opens, falling to the coin's fee over 15 s.
    uint24 internal constant START_FEE = 500_000;
    uint32 internal constant WINDOW = 15;

    function run() external returns (LaunchFactoryV3 factory) {
        require(address(POOL_MANAGER).code.length > 0, "no PoolManager at that address on this chain");
        require(block.chainid == 8453, "this deploy is for Base mainnet (8453)");
        vm.startBroadcast();
        // the deploying wallet becomes the quote admin, so the same keystore enables stock pairs
        (, address admin,) = vm.readCallers();
        address predicted = vm.computeCreateAddress(admin, vm.getNonce(admin));
        (bytes32 salt, address hook) = HookSalt.find(predicted, HookSalt.initCodeHash(POOL_MANAGER, START_FEE, WINDOW));
        factory = new LaunchFactoryV3(POOL_MANAGER, TREASURY, admin, START_TICK, START_FEE, WINDOW, salt);
        vm.stopBroadcast();
        require(address(factory) == predicted, "the factory did not land where the hook salt was mined for");
        require(address(factory.hook()) == hook, "the hook did not land at the mined address");
        require(uint160(hook) & Hooks.ALL_HOOK_MASK == HookSalt.FLAGS, "the hook's permission bits are wrong");
        console.log("LaunchFactoryV3", address(factory));
        console.log("LaunchHook", hook);
        console.log("hook salt");
        console.logBytes32(salt);
        console.log("quote admin", admin);
        // referrers: none is approved at deploy. The PROTOCOL RECIPIENT (the treasury wallet, not this
        // deployer) approves one with setReferrer(<referrer>, true) - see contracts/README.md
        console.log("referrers approved: none; the treasury calls setReferrer");
    }
}
