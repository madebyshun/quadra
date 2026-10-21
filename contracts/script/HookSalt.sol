// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {LaunchHook} from "../src/LaunchHook.sol";

/// @notice Mines the CREATE2 salt that puts LaunchFactoryV3's hook at an address whose low 14 bits are
///         EXACTLY its permissions (beforeInitialize | beforeAddLiquidity | beforeSwap) — v4-periphery's
///         HookMiner pattern, with the init-code hash computed once instead of once per salt (HookMiner
///         re-hashes the whole creation code every iteration, ~16,000 times on average for 14 bits).
///         The deployer is the FACTORY: its constructor deploys the hook.
library HookSalt {
    uint160 internal constant FLAGS =
        uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG);
    uint256 internal constant MAX_LOOP = 1_000_000;

    function initCodeHash(IPoolManager manager, uint24 startFee, uint32 window) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(type(LaunchHook).creationCode, abi.encode(manager, startFee, window)));
    }

    function find(address factory, bytes32 codeHash) internal view returns (bytes32 salt, address hook) {
        for (uint256 i; i < MAX_LOOP; i++) {
            hook = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), factory, bytes32(i), codeHash)))));
            if (uint160(hook) & Hooks.ALL_HOOK_MASK == FLAGS && hook.code.length == 0) return (bytes32(i), hook);
        }
        revert("HookSalt: no salt found");
    }
}
