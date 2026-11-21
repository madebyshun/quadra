import { parseAbi } from "viem";

/**
 * The launchpads on Base whose OWN on-chain record can prove a token was launched through them.
 *
 * Every address here was verified on 2026-10-14 (hard rule 1), each the same three ways:
 * - its source is verified on Sourcify (`sourcify.dev/server/v2/contract/8453/<address>`), which
 *   names the contract — base.blockscout.com answered this machine with a Cloudflare challenge
 *   that day (HTTP 403, curl and Node alike), so Sourcify was the source-verification read;
 * - the record function below is in that verified source, and is written ONLY by the call that
 *   creates a token (each source read for the write site, noted per entry);
 * - the record was called on the live chain for a token of that launchpad (a real answer) and for
 *   DEGEN (all zero: not one of theirs). The answers are in tests/fixtures/launchpads/.
 *
 * A launchpad that could not be verified this way is simply not here. Why a record and not the
 * launch transaction: the transaction's `to` is NOT the launchpad whenever the launcher's wallet is
 * an EIP-7702 smart account (MetaMask's DelegationManager) or an ERC-4337 bundle (MEASURED
 * 2026-10-14: 45 of an hour's 154 v4 pools arrived through EntryPoint `handleOps`), and a contract's
 * own storage cannot be faked by whoever sent the transaction.
 */

/**
 * basepad.si — `LaunchFactory` (Sourcify exact match; a fork of openlaunch's factory). `infoOf(token)`
 * is a public mapping written only at the end of `launch()`; `tokenId` is the locker position, never 0
 * for a real launch. MEASURED: infoOf(0xaeAd…106d) = launch #3106859 by 0x9F9B…B09f, ETH quote,
 * lpFee 10000; `locker()` reads back as the locker below; PLATFORM_BPS 500, CREATOR_BPS 9500;
 * launchCount 588. basepad's own /llms.txt names the same two addresses.
 */
export const BASEPAD = {
  factory: "0xad60Fe9e5601500449c7d0a87908636a0920307F",
  /** `LaunchLocker` (Sourcify exact match): no function moves, burns or decreases a position; `collect` removes zero liquidity */
  locker: "0x93c137BC5b5449D6202D8BdCf1CA398F3E2781c5",
  /** basepad's share of every collect, and the launcher's recipients' share — constants in the verified source, read back on chain */
  platformBps: 500,
  creatorBps: 9_500,
} as const;

export const BASEPAD_ABI = parseAbi([
  "function infoOf(address token) view returns (uint256 tokenId, address launcher, address quote, int24 startTick, uint24 lpFee)",
  /** every basepad `LaunchToken` names the factory that made it — an impostor can claim the same */
  "function factory() view returns (address)",
  "event Launched(address indexed token, uint256 indexed tokenId, address indexed launcher, address quote, bytes32 poolId, int24 startTick, uint24 lpFee, uint256 supply, string metadataURI)",
]);

/**
 * Doppler's `Airlock` on Base (Sourcify match). `getAssetData(asset)` is written only in `create()`
 * and never deleted (the verified source), and it records the INTEGRATOR passed to `create()` — so one
 * call is the Airlock's `Create` event and the integrator in the calldata at once, which is Feel.cash's
 * own three-part proof (docs.feel.cash, Contracts) without needing the transaction, and it still holds
 * when the launch came through a smart account rather than as a call to the Airlock.
 */
export const DOPPLER_AIRLOCK = "0x660eAaEdEBc968f8f3694354FA8EC0b4c5Ba8D12";
/** Doppler's `NoOpMigrator` (Sourcify match) — the record's migrator when liquidity never migrates. MEASURED on Feel.cash's launches */
export const DOPPLER_NOOP_MIGRATOR = "0x6ddfED58D238Ca3195E49d8ac3d4cEa6386E5C33";

export const DOPPLER_ABI = parseAbi([
  "function getAssetData(address asset) view returns (address numeraire, address timelock, address governance, address liquidityMigrator, address poolInitializer, address pool, address migrationPool, uint256 numTokensToSell, uint256 totalSupply, address integrator)",
  "event Create(address asset, address indexed numeraire, address initializer, address poolOrHook)",
]);

/**
 * Feel.cash's integrator, as Feel.cash publishes it (docs.feel.cash, Contracts and protocol) and as
 * its API returns it on every Base launch. MEASURED: getAssetData of two Feel.cash launches
 * (0x0cDB…FeE1, 0xc5A5…FeE1) records exactly this integrator; an older Doppler token records another.
 * Feel.cash mines its token addresses to END in `fee1` — and says itself that the ending is NOT proof.
 */
export const FEEL_INTEGRATOR = "0x3879B1Ee8389FfeFb7afd51b1bafb9fAF23d6699";
export const FEEL_SUFFIX = "fee1";

/**
 * Clanker v4's factory, `Clanker` (Sourcify match; the same address Blockscout named "Clanker" in the
 * BOAR capture of 2026-10-01). `deploymentInfoForToken(token)` is a public mapping written in the
 * deploy path. MEASURED: it answers BOAR and a token launched 2026-10-14 through an ERC-4337 bundle
 * with hook ClankerHookStaticFeeV2 and the same locker, 0xffA3…0762 — whose source is NOT verified
 * on Sourcify, so no lock is claimed for it.
 */
export const CLANKER_FACTORY = "0xE85A59c628F7d27878ACeB4bf3b35733630083a9";

/**
 * Clanker v5 (`clanker_tax_base`) factory on Base (8453), verified from
 * `https://www.clanker.world/api/metadata/factories`.
 */
export const CLANKER_V5_FACTORY = "0x572e88D3cD7f23E4241EB6ceDD96667271bF09A0";
export const CLANKER_V5_LAUNCHED_TOPIC = "0x207384e895174175cc774fe7f7457b37c382f27ebf53d37d5257b862f80eaf9c";

/** All official Clanker factory addresses on Base (v0 through v5), keyed lowercase -> version label. */
export const CLANKER_FACTORIES: Readonly<Record<string, string>> = {
  "0x250c9fb2b411b48273f69879007803790a6aea47": "Clanker v0",
  "0x9b84fce5dcd9a38d2d01d5d72373f6b6b067c3e1": "Clanker v1",
  "0x732560fa1d1a76350b1a500155ba978031b53833": "Clanker v2",
  "0x375c15db32d28cecdcab5c03ab889bf15cbd2c5e": "Clanker v3",
  "0x71cdc0bdf30f5601fb0ac80cf1d20b771342c035": "Clanker v3",
  "0x2a787b2362021cc3eea3c24c4748a6cd5b687382": "Clanker v3.1",
  [CLANKER_FACTORY.toLowerCase()]: "Clanker v4",
  [CLANKER_V5_FACTORY.toLowerCase()]: "Clanker v5",
};

export const CLANKER_ABI = parseAbi(["function deploymentInfoForToken(address token) view returns (address token, address hook, address locker)"]);

/**
 * Zora's coin factory, `ZoraFactory` (Sourcify exact match) — an EIP-1967 PROXY with an owner, whose
 * implementation was `ZoraFactoryImpl` (exact match) when read. `getVersionForDeployedCoin(coin)` is set
 * when the factory clones a coin and is 0 for anything it did not make. MEASURED: version 4 for a coin
 * launched 2026-10-14 (the emitter of its `CoinCreatedV4` log), 0 for DEGEN.
 */
export const ZORA_FACTORY = "0x777777751622c0d3258f214F9DF38E35BF45baF3";

export const ZORA_ABI = parseAbi(["function getVersionForDeployedCoin(address coin) view returns (uint8)"]);
