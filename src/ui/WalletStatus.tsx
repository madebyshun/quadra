import { useState } from "react";
import { BRAND } from "@/brand";
import { shortAddress, toChecksumAddress } from "@/lib/address";
import type { Wallet } from "@/lib/wallet";
import { WalletActions } from "@/ui/WalletActions";
import { useWalletSession } from "@/ui/WalletProvider";

/**
 * The taskbar's wallet control. Reads the one session `WalletProvider` holds —
 * it used to own that state, which meant the Connect wallet window could not
 * share it; see that file's header.
 *
 * The balloon above the tray holds the ways in. It opens when the tray button
 * is pressed, and opens BY ITSELF for exactly one state — see `opensItself`.
 */

/**
 * Whether the balloon opens without being asked. Only for a connected wallet on
 * the wrong chain.
 *
 * 🔴 It used to open on every page load for every not-ready state, and MEASURED
 * 2026-09-29 at 1120×760 it sat over the bottom of the Send window, covering the
 * Send button itself. Nearly every first visit is "no wallet" or "not connected",
 * and neither is a problem: research, token scans and the Terminal read the chain with
 * no wallet at all (CLAUDE.md). A banner popping over the windows to advertise
 * something optional hid the one control the user came for. Wrong chain is
 * different in kind — the user has already engaged their wallet, and a payment
 * will fail until it is fixed — so that is the case worth interrupting for. The
 * same split the money forms' blockers used (archive/previews/MoneyForm.tsx): a
 * problem speaks up, an absence waits to be asked.
 */
export function opensItself(wallet: Wallet): boolean {
  return wallet.kind === "wrongChain";
}

export function WalletStatus() {
  const { wallet, busy, switchChain, connectedWith } = useWalletSession();
  /**
   * `null` until the user touches the balloon — then `true` (opened from the tray)
   * or `false` (dismissed). While it is `null`, `opensItself` decides. A dismissal
   * lasts for this page's lifetime; reloading hands the choice back to
   * `opensItself`, since "dismissed" is not a promise nothing changed.
   */
  const [chosen, setChosen] = useState<boolean | null>(null);

  if (wallet === null) {
    return (
      <span className="mono" title="Reading the injected wallet, if any">
        checking wallet…
      </span>
    );
  }

  const showBanner = wallet.kind !== "ready" && (chosen ?? opensItself(wallet));

  /*
   * The tray button opens the balloon rather than connecting directly, and is
   * never disabled for want of an injected provider.
   *
   * It used to read "no wallet found" and be `disabled` whenever nothing was
   * injected, so a visitor with no extension — once they had dismissed the banner,
   * or reached for the tray first, which is where a sign-in lives in this
   * interface — had no way back to WalletConnect or Coinbase at all. The sign-in
   * was present and unreachable, which is the same thing as absent. (The comment
   * sits here and not in the ternary below: a JSX branch in parentheses cannot
   * hold a comment block plus an element — see CLAUDE.md.)
   */

  return (
    <>
      {showBanner ? (
        <div className="wallet-banner" role="dialog" aria-label="Wallet">
          <p className="wallet-banner__text">{wallet.why}</p>
          <div className="wallet-banner__actions">
            <WalletActions wallet={wallet} />
            <button
              type="button"
              className="wallet-banner__dismiss"
              onClick={() => setChosen(false)}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}
      {wallet.kind === "ready" ? (
        <span className="mono" title={`Connected with ${connectedWith.name}: ${toChecksumAddress(wallet.account)}. ${BRAND.name} holds no key.`}>
          {shortAddress(toChecksumAddress(wallet.account))}
        </span>
      ) : (
        <button
          type="button"
          className="mono taskbar__wallet"
          onClick={wallet.kind === "wrongChain" ? switchChain : () => setChosen(true)}
          disabled={busy}
          title={wallet.why}
        >
          {wallet.kind === "wrongChain" ? "wrong chain" : "connect wallet"}
        </button>
      )}
    </>
  );
}
