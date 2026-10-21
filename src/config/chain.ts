/**
 * Base 8453 only. Every address here is either verified on Basescan or `null`.
 *
 * `null` is deliberate and load-bearing: nothing in this repo may invent an
 * address that looks real. A caller that needs an unset address gets a thrown
 * error naming the constant, never a plausible-looking zero address.
 */

export const BASE = {
  id: 8453,
  idHex: "0x2105",
  name: "Base",
  /**
   * MEASURED 2026-09-30 from the owner's side of the world, three `eth_getBalance` each:
   * base.publicnode.com 0.19–0.29 s, mainnet.base.org 0.66–1.70 s — and the Send/Swap % buttons
   * felt stuck at 1.8 s a click. Both are public, rate-limited and "not suitable for production
   * traffic" (docs.base.org, Throughput and Limits); production needs a provider (T3).
   */
  rpc: "https://base.publicnode.com",
  rpcFallback: "https://mainnet.base.org",
  explorer: "https://basescan.org",
} as const;

/** Circle-issued USDC on Base. Verified: basescan.org/token/0x8335...913 */
export const USDC = {
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  decimals: 6,
  symbol: "USDC",
  /** EIP-712 domain for TransferWithAuthorization (EIP-3009) */
  eip712: { name: "USD Coin", version: "2" },
} as const;

/** Wrapped ETH on Base. Verified: basescan.org/token/0x4200...0006 */
export const WETH = {
  address: "0x4200000000000000000000000000000000000006",
  decimals: 18,
  symbol: "WETH",
} as const;

/**
 * Basenames, Base's own name service (ENS-compatible).
 *
 * MEASURED ON CHAIN 2026-09-30 (`cast`, mainnet.base.org): the registry at this address has
 * code; `resolver(namehash("jesse.base.eth"))` answers the L2 resolver
 * `0xC6d566A56A1aFf6508b41f6c90ff131615583BCD`, whose `addr(node)` is
 * `0x2211d1D0020DAEA8039E46Cf1367962070d77DA9`; and the REVERSE record lives at
 * `namehash("<address without 0x, lowercase>.80002105.reverse")` — the ENSIP-19 namespace
 * for Base's coin type — where `name(node)` answers `"jesse.base.eth"` again.
 *
 * Only the registry is pinned. The resolver is read from it per name, because a name's
 * owner can point it at a different resolver and a hard-coded one would answer for the
 * wrong contract.
 */
export const BASENAMES = {
  registry: "0xb94704422c2a1e396835a571837aa5ae53285a95",
  /** the reverse namespace for Base, coin type 0x80002105 */
  reverseSuffix: "80002105.reverse",
} as const;

/**
 * Uniswap v4's PoolManager on Base — the ONE contract that holds every v4 pool's tokens.
 * VERIFIED on Blockscout 2026-10-01 (`smart-contracts/<address>`: name "PoolManager",
 * `is_verified: true`). Pinned so a holder list can tell liquidity from a whale: a v4 token's
 * largest "holder" is usually this contract, and it is nobody's wallet.
 */
export const UNISWAP_V4_POOL_MANAGER = "0x498581fF718922c3f8e6A244956aF099B2652b2b";

/**
 * Contracts this product will own. All unset until deployed and verified on
 * Basescan — see the module note above for why these are `null` and not zeros.
 */
export const CONTRACTS = {
  /**
   * Where this product's fees land: the swap and bridge integrator fee (`FEE_BPS` in
   * `config/routes.ts`). `null` means every fee is OFF, never sent to a placeholder.
   *
   * PROVIDED BY THE OWNER 2026-09-30, and MEASURED before it was written here: a valid EIP-55
   * checksum; on Base AND on Robinhood Chain its code is exactly `0xef0100 ‖ 0x63c0…e32b` — an
   * ordinary wallet (EOA) with an EIP-7702 delegation to MetaMask's `EIP7702StatelessDeleGator`
   * (verified on Blockscout). One private key controls it on every chain, which matters: Across
   * pays its app fee on the DESTINATION chain (Robinhood Chain), and Relay accrues its app fee
   * as a balance the address claims from Relay. (`shieldedPool` and `verifier` lived here until
   * the privacy model was archived on 2026-09-30.)
   */
  treasury: "0xD5C1dFc036F9911348EA8065F73c8123f4013FAB" as string | null,
  /** the product's own token, once launched — see BRAND.ticker for its name */
  token: null as string | null,
  /**
   * The launchpad, version 2 (`contracts/src/LaunchFactory.sol`: ETH OR stock pairs), DEPLOYED BY THE
   * OWNER 2026-10-02 with their own key: tx 0xd05554c5…42f2a293, block 52,068,913, from 0x00FD29B7…
   * 48Ce746F (its quote admin). CHECKED before it was written here: Blockscout "LaunchFactory", fully
   * verified, solc 0.8.26, optimizer 200, cancun; runtime bytecode byte-identical to this repo's build
   * with the 19 immutable slots masked; TOTAL_SUPPLY 1e27, LP_FEE 10000, CREATOR_SHARE_BPS 8000,
   * quotes(ETH) = enabled at 191200, protocolRecipient = `treasury`, poolManager = Uniswap v4's.
   * New launches go here. Set it back to `null` to stop offering launches; v1 stays read either way.
   */
  launchFactory: "0xef1F427bB57e0ECd7BB8051cE8bC7AAb709a0c03" as string | null,
  /**
   * The launchpad, version 3 (`contracts/src/LaunchFactoryV3.sol` + `LaunchHook.sol`: a 1% or 3% fee
   * chosen per coin, and the anti-sniper opening — the fee falls from the hook's `startFee` to the
   * chosen one over its `window` seconds). NOT DEPLOYED: it waits on the owner's deploy
   * (`contracts/script/DeployLaunchFactoryV3.s.sol`), its verification on Blockscout and an audit
   * (hard rule 1 — never an address before then). The day it is set, NEW launches go here and v2
   * becomes read-only like v1; until then everything behaves exactly as with v2.
   */
  launchFactoryV3: null as string | null,
  /**
   * The launchpad, version 1 (`contracts/deployed/LaunchFactory.v1.sol`: ETH pairs only), DEPLOYED BY
   * THE OWNER 2026-10-02: tx 0xc51a517c…4a972764d, block 52,066,273. CHECKED before it was written
   * here: Blockscout "LaunchFactory", fully verified; runtime bytecode byte-identical to the v1 source
   * with the immutables masked; TOTAL_SUPPLY 1e27, LP_FEE 10000, CREATOR_SHARE_BPS 8000, startTick
   * 191200, protocolRecipient = `treasury`. Its first real launch and fee collection worked. No new
   * launches go to it; it is READ — the verdict, the radar, "your launches" — and collected from.
   */
  launchFactoryV1: "0xcDb2eC1c487fbcB6B4AF25cCD86aFf8120FaB8a5" as string | null,
} as const;

export type ContractName = keyof typeof CONTRACTS;

/** Read a contract address, or throw naming the constant that is unset. */
export function requireContract(name: ContractName): string {
  return assertDeployed(name, CONTRACTS[name]);
}

/**
 * Split out from `requireContract` so the deployed path can be tested while
 * every address is still null. `requireContract` closes over the real CONTRACTS,
 * so mocking the module's exports cannot reach its success branch — which would
 * leave the one line that hands an address to a payment untested until the day
 * it first runs in production.
 */
export function assertDeployed(name: string, addr: string | null): string {
  if (!addr) {
    throw new Error(
      `CONTRACTS.${name} is not deployed yet. Deploy it, verify it on ${BASE.explorer}, then set the address in src/config/chain.ts.`,
    );
  }
  return addr;
}

/**
 * Which capabilities are switched on. Mirrors a real feature flag table.
 *
 * 2026-09-30: the product became an "on-chain supercomputer" (see CLAUDE.md), which
 * added `terminal`, `research` and `safety`, dropped `router` (it was the private-balance
 * agent payer, archived with the privacy model) and switched `inference` off — it is a
 * stub with no enclave behind it. `audit` and `hooks` stay off as they were; both still
 * build and keep their tests, so turning either on is one line.
 */
export const FLAGS = {
  wallet: true,
  terminal: true,
  research: true,
  safety: true,
  markets: true,
  trade: true,
  send: true,
  swap: true,
  bridge: true,
  launch: true,
  coins: true,
  profile: true,
  /**
   * The machine's own programs (2026-10-14, the owner: "make it more fun", keeping the "on-chain
   * supercomputer"): Task Manager (Base as this computer's CPU), the Recycle Bin (pools emptied
   * today), the Coming Soon folder, Rugsweeper, Achievements and the Leaderboard.
   */
  taskmgr: true,
  trash: true,
  soon: true,
  rugsweeper: true,
  achievements: true,
  leaderboard: true,
  /**
   * Robinhood Chain (4663), HIDDEN on the owner's call of 2026-10-02: "build on Base first, Robinhood
   * Chain after". Off hides every surface that needs it — the Bridge window and the Robinhood Chain
   * half of Markets — without deleting a line of it; a watchlist's Robinhood entries are kept, only
   * not shown or fetched. Turning it back on is this one line.
   */
  robinhood: false,
  /**
   * The x402 window's two ways to pay OTHERS — BlueAgent's directory and any x402 URL (Coinbase's
   * Bazaar) — HIDDEN on the owner's call of 2026-10-02: the window sells this app's own tools only.
   * Both halves are kept and tested; this one line brings them back.
   */
  x402Others: false,
  x402: true,
  mcp: true,
  inference: false,
  audit: false,
  hooks: false,
  webhooks: false,
} as const;

export type FlagName = keyof typeof FLAGS;
