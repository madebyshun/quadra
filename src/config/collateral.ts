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

/**
 * Morpho Blue on Base (Sourcify: "Morpho", exact match) and its markets lending USDC against a
 * Coinbase stock. 🔴 Chosen by MEASUREMENT 2026-11-12, not by name: Morpho's API lists 23 Base
 * markets with a stock as collateral; these five held $1k or more of it (~$107k together) — the rest
 * held $0–$77. Each id was read back on chain through `idToMarketParams`: loan token USDC, the
 * collateral below, and its own oracle. A position in an unlisted market is not read, and the report
 * says which markets were.
 */
export const MORPHO = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";
export const MORPHO_STOCK_MARKETS: readonly { readonly id: `0x${string}`; readonly symbol: string }[] = [
  { id: "0xae1a30486234bf7e7ac166c7c03d9bc5f2cd8a39be2c48e73c665ac7148c3c28", symbol: "AAPLc" },
  { id: "0x44b343b5087c0bd34207cb5c199f12030777bf6b8c0a128438246f1212f37ca5", symbol: "METAc" },
  { id: "0xb4b42dd66cef25614b94510a910d54b2c148e7621d22b4271566724beda63d13", symbol: "NVDAc" },
  { id: "0xce983b9ee6344e16ebbcc66812f23caafc63ae83fcc14fa29b66c7e69e9cecf6", symbol: "SPCXc" },
  { id: "0xa3913d896b7e9c0e0a84f1be27d376cf2065616101cb7c44674af8a154e684cc", symbol: "GOOGLc" },
];

export const MORPHO_ABI = parseAbi([
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
]);
/** A Morpho oracle: loan-token base units per collateral base unit, scaled by 1e36. */
export const MORPHO_ORACLE_ABI = parseAbi(["function price() view returns (uint256)"]);
