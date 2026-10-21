/**
 * The two extra ways to reach an `Eip1193Provider`, beyond the injected one
 * `wallet.ts` already reads for free.
 *
 * ── The line this module sits on ──────────────────────────────────────────────────
 * Same boundary as `wallet.ts`, `eip712.ts`, `requirements.ts` and `payment.ts`: it
 * hands back an object shaped like `{ request(args) }` and never touches a key (hard
 * rule 5). `readWallet` / `connectWallet` / `requestBaseChain` already accept any such
 * object as their `provider` parameter — that seam is what makes this file possible
 * without changing a line of `wallet.ts`. A WalletConnect session and a Coinbase Smart
 * Wallet popup are, from this codebase's point of view, just two more objects with a
 * `request` method.
 *
 * ── Both SDKs are dynamically imported ────────────────────────────────────────────
 * `import()` rather than a top-level `import`, so neither SDK is in the chunk every
 * visitor downloads — only someone who clicks "Connect with WalletConnect" or
 * "Connect with Coinbase Smart Wallet" pays for it. `lib/wallet.ts`'s own header
 * tracks the main bundle by byte count for exactly this reason.
 *
 * ── The Project ID is refused, never guessed ──────────────────────────────────────
 * `WALLETCONNECT_PROJECT_ID` is `null` until ShunTr sets `VITE_WALLETCONNECT_PROJECT_ID`
 * (see `config/connectors.ts`). Calling `EthereumProvider.init` with an empty string
 * would not fail here — it fails minutes later, deep in the SDK's relay handshake, as
 * an error that names none of this. Refusing before the call is the same shape as
 * `requireContract` in `config/chain.ts`.
 */

import { BASE } from "@/config/chain";
import { WALLETCONNECT_PROJECT_ID } from "@/config/connectors";
import { BRAND } from "@/brand";
import type { Eip1193Provider } from "@/lib/wallet";

const NO_PROJECT_ID =
  `WalletConnect needs a Project ID from cloud.reown.com. Set VITE_WALLETCONNECT_PROJECT_ID ` +
  "and rebuild — this build has none configured.";

/**
 * A fresh WalletConnect session provider, scoped to Base only. Opens the SDK's own QR
 * modal; the promise resolves once a wallet has answered.
 */
export async function walletConnectProvider(): Promise<Eip1193Provider> {
  if (WALLETCONNECT_PROJECT_ID === null) throw new Error(NO_PROJECT_ID);
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  const provider = await EthereumProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    chains: [BASE.id],
    showQrModal: true,
    metadata: {
      name: BRAND.name,
      description: BRAND.blurb,
      url: `https://${BRAND.domain}`,
      icons: [],
    },
  });
  return provider as unknown as Eip1193Provider;
}

/** A Coinbase Smart Wallet provider, scoped to Base only. No Project ID required. */
export async function coinbaseProvider(): Promise<Eip1193Provider> {
  const { createCoinbaseWalletSDK } = await import("@coinbase/wallet-sdk");
  const sdk = createCoinbaseWalletSDK({ appName: BRAND.name, appChainIds: [BASE.id] });
  return sdk.getProvider() as unknown as Eip1193Provider;
}
