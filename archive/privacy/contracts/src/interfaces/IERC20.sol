// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * The parts of ERC-20 this pool touches, and nothing more.
 *
 * Declared rather than imported because there is no dependency directory here
 * on purpose — `forge test` runs on a bare clone with nothing installed. Four
 * function signatures are not worth a package.
 *
 * `transfer` and `transferFrom` are typed as returning `bool` because that is
 * what the standard says. Several real tokens return nothing at all, which is
 * why nothing in this repo calls them directly — see `SafeTransfer`.
 */
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}
