import { BASE } from "@/config/chain";
import type { Wallet } from "@/lib/wallet";
import { Gel } from "@/ui/Gel";
import { useWalletSession } from "@/ui/WalletProvider";

/**
 * The buttons that get somebody signed in: every browser wallet by name, then
 * WalletConnect (a wallet on a phone) and Coinbase Smart Wallet — and the chain
 * switch when that is the only thing wrong.
 *
 * Extracted the day a Connect wallet window appeared next to the tray banner.
 * Two copies of this row would be two places to forget that "no injected
 * provider" must NOT remove WalletConnect and Coinbase — the bug that made the
 * sign-in unreachable in the first place.
 */
export function WalletActions({ wallet }: { wallet: Wallet }) {
  const { busy, wallets, connectDiscovered, connectInjected, connectWalletConnect, connectCoinbase, switchChain } =
    useWalletSession();

  if (wallet.kind === "wrongChain") {
    return (
      <Gel onClick={switchChain} disabled={busy}>
        Switch to {BASE.name}
      </Gel>
    );
  }

  return (
    <>
      {/*
        Every browser wallet that announced itself (EIP-6963), by its own name and icon —
        so a user with two extensions picks one instead of getting whichever won
        `window.ethereum`. The generic button is only the fallback for a wallet too old
        to announce, and only when something is injected at all: pressing it with no
        extension opens nothing and reports nothing, which reads as a broken button.
      */}
      {wallets.map((w) => (
        <Gel key={w.info.uuid} onClick={() => void connectDiscovered(w)} disabled={busy}>
          {w.info.icon ? <img className="wallet-icon" src={w.info.icon} alt="" /> : null}
          {w.info.name}
        </Gel>
      ))}
      {wallets.length === 0 && wallet.kind !== "unavailable" ? (
        <Gel onClick={connectInjected} disabled={busy}>
          Connect wallet
        </Gel>
      ) : null}
      <Gel onClick={connectWalletConnect} disabled={busy}>
        WalletConnect
      </Gel>
      <Gel onClick={connectCoinbase} disabled={busy}>
        Coinbase Smart Wallet
      </Gel>
    </>
  );
}
