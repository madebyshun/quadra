import { parseAbi } from "viem";

/**
 * The launchpad contract's interface, and what this build expects it to say about itself.
 *
 * The ABI is written here by hand and held to the Solidity by `tests/launchpad.test.ts`, which
 * reads `contracts/src/LaunchFactory.sol` and finds every signature below in it — a signature
 * that drifted would send a call the contract does not have, and that would only show up on
 * chain. The expected values are ASSERTIONS: the Launch window reads each one from the deployed
 * factory and refuses to send if the chain says anything else (hard rule 16).
 */

export const LAUNCHPAD_ABI = parseAbi([
  "function launch(string name, string symbol, string contractURI, bytes32 salt, address quote, uint256 quoteIn) payable returns (address token)",
  "function collect(address token) returns (uint256 amount0, uint256 amount1)",
  "function predictToken(address caller, bytes32 salt) view returns (address)",
  "function TOTAL_SUPPLY() view returns (uint256)",
  "function LP_FEE() view returns (uint24)",
  "function CREATOR_SHARE_BPS() view returns (uint16)",
  "function quotes(address quote) view returns (bool enabled, int24 startTick)",
  "function protocolRecipient() view returns (address)",
  "function launches(address token) view returns ((address creator, address creatorRecipient, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key))",
  "event Launched(address indexed token, address indexed creator, bytes32 indexed poolId, uint256 devBuyIn, uint256 devBuyTokens)",
]);

/** What the deployed factory must answer — the owner's choices of 2026-10-02 (contracts/README.md). */
export const LAUNCHPAD_EXPECTS = {
  /** one billion, 18 decimals */
  supply: 10n ** 27n,
  /** 1%, in hundredths of a basis point */
  lpFee: 10_000,
  /** 80% of every fee to the launcher, 20% to the protocol */
  creatorShareBps: 8_000,
  /** the ETH pair's opening price: ≈ 2×10^8 tokens per ETH (stock pairs' are set by the quote admin) */
  startTick: 191_200,
} as const;

/** The pool's tick spacing — every opening tick is a multiple of it. */
export const LAUNCHPAD_SPACING = 200;

/** Every launchpad token has this many decimals. */
export const LAUNCHPAD_DECIMALS = 18;

/**
 * Version 3's interface (`contracts/src/LaunchFactoryV3.sol`), held to the Solidity the same way.
 * It keeps v2's `launches`, `collect`, `predictToken`, `quotes`, `protocolRecipient` and `Launched`
 * word for word, so every reader of v1/v2 reads v3; what is new is `launch`'s last two arguments
 * (the coin's fee and its referrer), the two fees a launcher may choose, the hook every v3 pool uses,
 * and APPROVED REFERRERS (owner, 2026-10-22): a referrer the protocol recipient approved, named at
 * launch, is recorded for the coin (`referrerOf`, event `Referred`) and paid 5% of every fee out of
 * the protocol's 20% — 80 / 5 / the remainder. An unapproved one is recorded as none
 * (`ReferralIgnored`). Removing a referrer stops NEW referrals only; a recorded one is paid for good.
 */
export const LAUNCHPAD_V3_ABI = parseAbi([
  "function launch(string name, string symbol, string contractURI, bytes32 salt, address quote, uint256 quoteIn, uint24 fee, address referrer) payable returns (address token)",
  "function collect(address token) returns (uint256 amount0, uint256 amount1)",
  "function predictToken(address caller, bytes32 salt) view returns (address)",
  "function TOTAL_SUPPLY() view returns (uint256)",
  "function FEE_LOW() view returns (uint24)",
  "function FEE_HIGH() view returns (uint24)",
  "function TICK_SPACING() view returns (int24)",
  "function CREATOR_SHARE_BPS() view returns (uint16)",
  "function REFERRER_SHARE_BPS() view returns (uint16)",
  "function approvedReferrers(address referrer) view returns (bool)",
  "function referrerOf(address token) view returns (address)",
  "function hook() view returns (address)",
  "function quotes(address quote) view returns (bool enabled, int24 startTick)",
  "function protocolRecipient() view returns (address)",
  "function launches(address token) view returns ((address creator, address creatorRecipient, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key))",
  "event Launched(address indexed token, address indexed creator, bytes32 indexed poolId, uint256 devBuyIn, uint256 devBuyTokens)",
  "event LaunchFee(address indexed token, uint24 fee)",
  "event Referred(address indexed token, address indexed referrer)",
]);

/** The hook every v3 pool uses (`contracts/src/LaunchHook.sol`): the fee schedule, and nothing that moves money. */
export const LAUNCH_HOOK_ABI = parseAbi([
  "function factory() view returns (address)",
  "function startFee() view returns (uint24)",
  "function window() view returns (uint32)",
  "function schedules(bytes32 id) view returns (uint24 fee, uint40 openedAt)",
  "function currentFee(bytes32 id) view returns (uint24)",
]);

/**
 * What a deployed v3 must answer — its constants, and its hook's opening as
 * `contracts/script/DeployLaunchFactoryV3.s.sol` deploys it. No ETH opening tick: a quote admin's
 * re-pricing must not lock the whole launchpad (owner, 2026-10-21), so each pair's tick is read live
 * and shown as the opening value, as stock pairs' always were.
 */
export const LAUNCHPAD_V3_EXPECTS = {
  supply: 10n ** 27n,
  /** 1% and 3%, in hundredths of a basis point — the only two fees `launch` accepts */
  feeLow: 10_000,
  feeHigh: 30_000,
  creatorShareBps: 8_000,
  /** a recorded referrer's share, out of the protocol's 20%: 80 / 5 / 15 */
  referrerShareBps: 500,
  tickSpacing: 200,
  /** the LP fee at the second a pool opens: 50% */
  startFee: 500_000,
  /** seconds for it to fall to the coin's chosen fee */
  window: 15,
} as const;

/** v4-core's `LPFeeLibrary.DYNAMIC_FEE_FLAG`: a pool key's fee when its hook sets every swap's fee — every v3 pool. */
export const DYNAMIC_FEE_FLAG = 0x800000;

/** A fee in hundredths of a basis point, as a person reads it: 10000 → "1%", 500000 → "50%". */
export function feePercent(fee: number): string {
  return `${(fee / 10_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}
