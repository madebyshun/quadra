import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { BRAND } from "@/brand";
import { coinbaseProvider, walletConnectProvider } from "@/lib/connectors";
import { discoverWallets, type Discovered } from "@/lib/discovery";
import {
  chooseAccount,
  connectWallet,
  injectedProvider,
  readWallet,
  releaseAccounts,
  requestBaseChain,
  watchWallet,
  type Eip1193Provider,
  type Wallet,
} from "@/lib/wallet";

/**
 * One wallet session for the whole page.
 *
 * It used to live inside `WalletStatus`, which was fine while the tray was the
 * only place a wallet could be connected. It is not fine now that there is a
 * Connect wallet *window* as well: two components each holding their own
 * `useState` would each hold their own `provider`, so signing in through
 * WalletConnect in the window would leave the tray still saying "connect
 * wallet" — the injected-provider events that keep the two in step do not fire
 * for a provider the other copy has never heard of.
 *
 * Still holds no key (hard rule 5). It asks a provider and re-reads the answer;
 * `lib/wallet.ts` does the asking and this only decides when.
 */
/** Which wallet is in use, as the user would name it. */
export type WalletSource = { readonly name: string; readonly icon: string | null };

export type WalletSession = {
  /** `null` means the first read has not come back yet — not "no wallet". */
  wallet: Wallet | null;
  /** a connect/switch is in flight, so every action button should be inert */
  busy: boolean;
  /** every browser wallet that announced itself (EIP-6963), in the order they did */
  wallets: readonly Discovered[];
  /**
   * The wallet the session reads through. Only meaningful while `wallet` is `ready`,
   * which is the only state anything displays it in.
   */
  connectedWith: WalletSource;
  /** one of `wallets` — the user's pick, remembered for the next visit */
  connectDiscovered: (picked: Discovered) => Promise<void>;
  /** the injected provider, `window.ethereum` — the fallback when no wallet announced itself */
  connectInjected: () => Promise<void>;
  connectWalletConnect: () => Promise<void>;
  connectCoinbase: () => Promise<void>;
  switchChain: () => Promise<void>;
  /**
   * Open the wallet's own account picker — how a second MetaMask account is reached. Only
   * for browser wallets (`canSwitchAccount`); a phone wallet switches accounts in its own app.
   */
  switchAccount: () => Promise<void>;
  canSwitchAccount: boolean;
  /**
   * Stop reading the wallet, and forget which one was picked. It cannot revoke the site's
   * access inside the wallet — no standard call does that for every wallet — so the
   * sentence it leaves says to do that there too.
   */
  disconnect: () => void;
  /**
   * 🔴 The provider a signature must actually go to, or a throw naming why there
   * is none. Every caller that signs MUST come through here.
   *
   * `X402Panel` called `injectedProvider()` directly, which is wrong in a way no
   * type could catch: with a WalletConnect or Coinbase session live, the session
   * says `ready` and prints that account, and then the signature request goes to
   * whatever browser extension happens to be installed — a different wallet, or
   * none. The user sees "connect your wallet" a second time having already
   * connected, which is the symptom that surfaced; the silent half is that a
   * signature could be asked of an account other than the one on screen.
   *
   * It is a function and not a value on purpose: it re-measures at click time.
   * The window between a `ready` read and the click can close on its own (an
   * extension disabled, a tab that lost `window.ethereum`), and the honest
   * answer then is a refusal, not a stale handle.
   */
  signingProvider: () => Eip1193Provider;
};

const WalletContext = createContext<WalletSession | null>(null);

/**
 * Same shape as `useAdapters`: a hard throw rather than a default session.
 * A default would silently give a second, unconnected copy of the wallet to
 * whichever component was mounted outside the provider, which is the exact bug
 * this file exists to remove.
 */
export function useWalletSession(): WalletSession {
  const session = useContext(WalletContext);
  if (session === null) {
    throw new Error("useWalletSession() must be called inside <WalletProvider>");
  }
  return session;
}

function connectorFailure(err: unknown): Wallet {
  return { kind: "failed", why: err instanceof Error ? err.message : String(err) };
}

/**
 * Where the pick is remembered: the chosen wallet's `rdns`, nothing else. A frozen
 * identifier like `PINS_KEY` — written out, never templated from the brand.
 */
export const WALLET_KEY = "quadra.wallet.v1";

/** Storage can throw (a private window, a blocked site); a pick that cannot be read is forgotten. */
function remembered(): string | null {
  try {
    return localStorage.getItem(WALLET_KEY);
  } catch {
    return null;
  }
}

function remember(rdns: string | null): void {
  try {
    if (rdns === null) localStorage.removeItem(WALLET_KEY);
    else localStorage.setItem(WALLET_KEY, rdns);
  } catch {
    // nothing to do: the pick simply is not remembered, which is the safe direction
  }
}

const DISCONNECTED =
  `Disconnected. ${BRAND.name} will not read your wallet again until you connect one. To ` +
  "remove this site's access completely, disconnect it inside the wallet too.";

/**
 * Which provider the session reads through.
 *
 * `default` is `window.ethereum` as the page found it — what every visit starts on.
 * `chosen` is one the user picked: a discovered wallet, WalletConnect or Coinbase.
 * `off` is after Disconnect, when nothing is read even though a wallet would answer —
 * without it, the next `accountsChanged` would quietly connect the user again.
 */
type Using =
  | { readonly kind: "default" }
  | {
      readonly kind: "chosen";
      readonly provider: Eip1193Provider;
      readonly source: WalletSource;
      /** a browser extension, which has an account picker and a revoke — not a WalletConnect/Coinbase session */
      readonly extension: boolean;
    }
  | { readonly kind: "off" };

/** The injected wallet's name, when it is one of the wallets that announced itself. */
function injectedSource(wallets: readonly Discovered[]): WalletSource {
  const injected = injectedProvider();
  const match = wallets.find((w) => w.provider === injected);
  return match ? { name: match.info.name, icon: match.info.icon } : { name: "Browser wallet", icon: null };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [busy, setBusy] = useState(false);
  const [wallets, setWallets] = useState<readonly Discovered[]>([]);
  /**
   * The provider in use. Set once the user picks one — a discovered wallet, WalletConnect
   * or Coinbase — so every later read, switch and signature talks to the wallet the user
   * actually picked instead of silently falling back to whatever extension won
   * `window.ethereum`.
   */
  const [using, setUsing] = useState<Using>({ kind: "default" });

  useEffect(() => discoverWallets(setWallets), []);

  /** A wallet picked on an earlier visit is adopted as soon as it announces itself. */
  useEffect(() => {
    if (using.kind !== "default") return;
    const rdns = remembered();
    const match = wallets.find((w) => w.info.rdns === rdns);
    if (match) setUsing({ kind: "chosen", provider: match.provider, source: match.info, extension: true });
  }, [wallets, using.kind]);

  const provider = using.kind === "chosen" ? using.provider : undefined;

  const refresh = useCallback(() => {
    if (using.kind === "off") setWallet({ kind: "disconnected", why: DISCONNECTED });
    else readWallet(provider).then(setWallet);
  }, [using.kind, provider]);

  useEffect(() => {
    refresh();
    return using.kind === "off" ? undefined : watchWallet(refresh, provider);
  }, [refresh, using.kind, provider]);

  const connectInjected = useCallback(async () => {
    setBusy(true);
    try {
      remember(null);
      setUsing({ kind: "default" });
      setWallet(await chooseAccount());
    } finally {
      setBusy(false);
    }
  }, []);

  const connectDiscovered = useCallback(async (picked: Discovered) => {
    setBusy(true);
    try {
      remember(picked.info.rdns);
      setUsing({ kind: "chosen", provider: picked.provider, source: picked.info, extension: true });
      setWallet(await chooseAccount(picked.provider));
    } finally {
      setBusy(false);
    }
  }, []);

  const connectVia = useCallback(
    (name: string, getProvider: () => Promise<Eip1193Provider>) => async () => {
      setBusy(true);
      try {
        const p = await getProvider();
        remember(null);
        setUsing({ kind: "chosen", provider: p, source: { name, icon: null }, extension: false });
        setWallet(await connectWallet(p));
      } catch (err) {
        setWallet(connectorFailure(err));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const switchChain = useCallback(async () => {
    setBusy(true);
    try {
      setWallet(await requestBaseChain(provider));
    } finally {
      setBusy(false);
    }
  }, [provider]);

  const canSwitchAccount = using.kind === "default" || (using.kind === "chosen" && using.extension);

  const switchAccount = useCallback(async () => {
    setBusy(true);
    try {
      setWallet(await chooseAccount(provider));
    } finally {
      setBusy(false);
    }
  }, [provider]);

  const disconnect = useCallback(() => {
    if (canSwitchAccount) {
      /** a browser wallet: revoke the site's access, so the next connect shows the account picker */
      void releaseAccounts(provider);
    } else {
      /** WalletConnect ends its relay session this way */
      const end = (provider as { disconnect?: unknown } | undefined)?.disconnect;
      if (typeof end === "function") Promise.resolve(end.call(provider)).catch(() => {});
    }
    remember(null);
    setUsing({ kind: "off" });
    setWallet({ kind: "disconnected", why: DISCONNECTED });
  }, [provider, canSwitchAccount]);

  const signingProvider = useCallback((): Eip1193Provider => {
    const signer = using.kind === "chosen" ? using.provider : using.kind === "default" ? injectedProvider() : null;
    if (signer === null) {
      throw new Error("No wallet provider is available to sign with. Nothing was charged.");
    }
    return signer;
  }, [using]);

  const connectedWith = useMemo(
    () => (using.kind === "chosen" ? using.source : injectedSource(wallets)),
    [using, wallets],
  );

  const value = useMemo(
    (): WalletSession => ({
      wallet,
      busy,
      wallets,
      connectedWith,
      connectDiscovered,
      connectInjected,
      connectWalletConnect: connectVia("WalletConnect", walletConnectProvider),
      connectCoinbase: connectVia("Coinbase Smart Wallet", coinbaseProvider),
      switchChain,
      switchAccount,
      canSwitchAccount,
      disconnect,
      signingProvider,
    }),
    [
      wallet,
      busy,
      wallets,
      connectedWith,
      connectDiscovered,
      connectInjected,
      connectVia,
      switchChain,
      switchAccount,
      canSwitchAccount,
      disconnect,
      signingProvider,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
