/**
 * Credentials for the two extra wallet connectors, beyond the injected provider
 * `lib/wallet.ts` already reads for free.
 *
 * Same `null`-until-set shape as `CONTRACTS` in `chain.ts`, and for the same reason:
 * a WalletConnect Project ID is tied to ShunTr's own cloud.reown.com account, so this
 * file cannot invent one. `lib/connectors.ts` throws naming this constant rather than
 * calling the SDK with an empty string, which the SDK would accept and then fail on
 * an unrelated, confusing error deep inside its relay handshake.
 */

/** cloud.reown.com project id. Read from Vite's build-time env, never hardcoded. */
export const WALLETCONNECT_PROJECT_ID: string | null =
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) || null;
