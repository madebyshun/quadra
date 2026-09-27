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
  rpc: "https://mainnet.base.org",
  rpcFallback: "https://base.publicnode.com",
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
 * Contracts this product will own. All unset until deployed and verified on
 * Basescan — see the module note above for why these are `null` and not zeros.
 */
export const CONTRACTS = {
  shieldedPool: null as string | null,
  verifier: null as string | null,
  /** where off-chain x402 revenue settles */
  treasury: null as string | null,
  /** the product's own token, once launched — see BRAND.ticker for its name */
  token: null as string | null,
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

/** Which capabilities are switched on. Mirrors a real feature flag table. */
export const FLAGS = {
  swap: true,
  send: true,
  inference: true,
  router: true,
  mcp: true,
  bridge: false,
  launch: false,
  audit: true,
  hooks: true,
  x402: true,
  webhooks: false,
} as const;

export type FlagName = keyof typeof FLAGS;
