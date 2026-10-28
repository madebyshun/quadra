import { parseAbi } from "viem";

/**
 * Payouts a launchpad could not push when they were due — a recipient (or a stock's transfer
 * policy) refused them — wait in the factory for the recipient to `withdraw`. The two deployed
 * factories keep them differently, so each has its own two calls; `tests/owed.test.ts` finds every
 * signature in that factory's own Solidity.
 *
 *   v1 (`contracts/deployed/LaunchFactory.v1.sol`): ETH only — `owedEth(account)`, `withdraw()`
 *   v2 (`contracts/src/LaunchFactory.sol`): per currency — `owed(account, currency)`, `withdraw(currency)`
 */
export const OWED_V1_ABI = parseAbi(["function owedEth(address account) view returns (uint256)", "function withdraw()"]);
export const OWED_V2_ABI = parseAbi(["function owed(address account, address currency) view returns (uint256)", "function withdraw(address currency)"]);
