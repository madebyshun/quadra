import { parseAbi } from "viem";

/**
 * Aave V4 on Base — the Equities hub and its MAG7 spoke, where tokenized stocks are borrowed against.
 *
 * 🔴 Every address READ BACK from the chain on 2026-11-11, not copied: taken from bgd-labs'
 * aave-address-book (`AaveV4Base.sol`), then
 *   - the hub and the spoke are TransparentUpgradeableProxy (Sourcify exact match); the spoke's
 *     EIP-1967 implementation `0x81a7…3b19` is `SpokeInstance` on Sourcify — the ABI below is its;
 *   - the oracle is `AaveOracle` (Sourcify exact match) and its `spoke()` returns this spoke;
 *   - `getReserveCount()` = 9: AAPLc, AMZNc, GOOGLc, METAc, MSFTc, NVDAc, TSLAc, USDC, SPCXc —
 *     each underlying the Coinbase stock token config/markets knows, each priced by "Coinbase <TICKER>"
 *     (the oracle's `getReserveSource`), USDC by "Capped USDC/USD".
 * The spoke is an upgradeable proxy: its rules can change under the same address, which is why
 * every figure here is read at the click and none is pinned.
 */
export const AAVE_V4 = {
  hub: "0xa4d5947Eb727A052bae69C593FfC84247EC9864E",
  spoke: "0x17905Db0e4A3514467539956c084180616AE7B8D",
  oracle: "0xaBaf048fD7675Ea34a84332371ffd5D55E322A47",
} as const;

/** The spoke's app page, for "see it for yourself". */
export const AAVE_V4_APP = "https://app.aave.com";

/** Read calls of `SpokeInstance` (Sourcify, the implementation behind `AAVE_V4.spoke`). */
export const SPOKE_ABI = parseAbi([
  "function getReserveCount() view returns (uint256)",
  "function getReserve(uint256 reserveId) view returns ((address underlying, address hub, uint16 assetId, uint8 decimals, uint24 collateralRisk, uint8 flags, uint32 dynamicConfigKey))",
  "function getDynamicReserveConfig(uint256 reserveId, uint32 dynamicConfigKey) view returns ((uint16 collateralFactor, uint32 maxLiquidationBonus, uint16 liquidationFee))",
  "function getUserAccountData(address user) view returns ((uint256 riskPremium, uint256 avgCollateralFactor, uint256 healthFactor, uint256 totalCollateralValue, uint256 totalDebtValueRay, uint256 activeCollateralCount, uint256 borrowCount))",
  "function getUserPosition(uint256 reserveId, address user) view returns ((uint120 drawnShares, uint120 premiumShares, int200 premiumOffsetRay, uint120 suppliedShares, uint32 dynamicConfigKey))",
  "function getUserSuppliedAssets(uint256 reserveId, address user) view returns (uint256)",
  "function getUserTotalDebt(uint256 reserveId, address user) view returns (uint256)",
  "function getUserReserveStatus(uint256 reserveId, address user) view returns (bool, bool)",
]);

/** `AaveOracle`: prices in USD with 8 decimals (its `decimals()`, read back). */
export const ORACLE_ABI = parseAbi([
  "function getReservesPrices(uint256[] reserveIds) view returns (uint256[])",
  "function getReserveSource(uint256 reserveId) view returns (address)",
]);

/** A Chainlink-style feed: when its price was last set is the weekend question. */
export const FEED_ABI = parseAbi(["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)", "function description() view returns (string)"]);

/** Basis points in a factor (`collateralFactor` 7000 = 70%). */
export const BPS = 10_000n;
/** `healthFactor` is WAD-scaled: 1e18 is 1.00. */
export const WAD = 10n ** 18n;
/** The oracle's price decimals. */
export const PRICE_DECIMALS = 8;
