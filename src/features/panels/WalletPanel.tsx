import { useState } from "react";
import { BRAND } from "@/brand";
import { BASE } from "@/config/chain";
import { shortAddress, toChecksumAddress } from "@/lib/address";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import type { Wallet } from "@/lib/wallet";
import { WalletActions } from "@/ui/WalletActions";
import { useWalletSession } from "@/ui/WalletProvider";
import { FeesWaiting } from "@/features/panels/FeesWaiting";

/**
 * The Connect wallet window: the same session the tray shows, with room to say
 * what connecting does and does not do.
 *
 * The tray banner has one line to work with and gets dismissed; this is where
 * somebody who went looking for a sign-in ends up, so it is the place to be
 * explicit that nothing here takes custody (hard rule 5) and that reading the
 * chain needs no wallet at all — research, scans and the Terminal work with
 * no wallet connected. A sign-in screen that implies otherwise would push
 * people into connecting for a feature that does not require it.
 */
/**
 * The Connected box. Its own component so it can be KEYED by wallet and account: picking
 * another wallet mounts a fresh one, which closes the "Use another wallet" list instead of
 * leaving it open under the wallet just chosen.
 */
function Connected({ wallet }: { wallet: Extract<Wallet, { kind: "ready" }> }) {
  const { connectedWith, disconnect, switchAccount, canSwitchAccount, busy } = useWalletSession();
  /** "Use another wallet" opens the same list the Sign in box shows. */
  const [picking, setPicking] = useState(false);
  const checksummed = toChecksumAddress(wallet.account);
  return (
    <>
      <p className="panel__lede">
        {connectedWith.icon ? <img className="wallet-icon" src={connectedWith.icon} alt="" /> : null}
        <strong>{connectedWith.name}</strong> — <code>{shortAddress(checksummed)}</code> on {BASE.name}.
      </p>
      {/*
        Printed with its EIP-55 checksum, the way Basescan and the wallet itself print
        it — wallets hand accounts back lowercase, and an all-lowercase line is the
        hardest form to compare by eye against the one in the extension.
      */}
      <p className="dim">
        <a href={`${BASE.explorer}/address/${checksummed}`} target="_blank" rel="noreferrer">
          <code className="notes__id">{checksummed}</code>
        </a>
      </p>
      <div className="row">
        {canSwitchAccount ? (
          <Gel quiet onClick={() => void switchAccount()} disabled={busy}>
            Switch account
          </Gel>
        ) : null}
        <Gel quiet onClick={() => setPicking((p) => !p)}>
          Use another wallet
        </Gel>
        <Gel quiet onClick={disconnect}>
          Disconnect
        </Gel>
      </div>
      {picking ? (
        <div className="row" role="group" aria-label="Other wallets">
          <WalletActions wallet={wallet} />
        </div>
      ) : null}
    </>
  );
}

export function WalletPanel() {
  const { wallet, connectedWith } = useWalletSession();

  if (wallet === null) {
    return (
      <Crt label="Wallet">
        <span className="crt__dim">{"// reading the wallet on this device…"}</span>
      </Crt>
    );
  }

  return (
    <div className="stack">
      <fieldset className="group">
        <legend>{wallet.kind === "ready" ? "Connected" : "Sign in"}</legend>
        {wallet.kind === "ready" ? (
          <Connected wallet={wallet} key={`${connectedWith.name}:${wallet.account}`} />
        ) : (
          <>
            <p className="panel__lede">{wallet.why}</p>
            <p className="caution">
              New here? No extension needed: Coinbase Smart Wallet makes a wallet with a passkey (Face ID or a fingerprint) in seconds. The key is yours and Coinbase's —
              never this computer's.
            </p>
            <div className="row">
              <WalletActions wallet={wallet} />
            </div>
          </>
        )}
      </fieldset>

      {wallet.kind === "ready" ? (
        <fieldset className="group">
          <legend>Your fees</legend>
          <FeesWaiting account={wallet.account} key={wallet.account} />
        </fieldset>
      ) : null}

      <fieldset className="group">
        <legend>What connecting does</legend>
        {/*
          Written as a list of what this app cannot do rather than a promise that
          it will behave. "We never store your keys" is a claim; "there is no
          field to put one in" is a shape.
        */}
        <ul className="notes">
          <li className="notes__why">
            {BRAND.name} never holds a key. Your wallet signs, you approve each signature,
            and nothing is charged until you do.
          </li>
          <li className="notes__why">
            Connecting is only needed to move money on {BASE.name}. Research, token scans and the
            Terminal read the chain with no wallet connected at all.
          </li>
        </ul>
      </fieldset>
    </div>
  );
}
