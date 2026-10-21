import { useEffect, useState } from "react";
import { priced, tokenBalances } from "@/skills/blockscout";
import { tokenAmount, usd } from "@/skills/format";
import { ethUsd } from "@/skills/dexscreener";
import { quantity, rpc } from "@/skills/http";
import { messageOf } from "@/lib/errors";

/**
 * What the connected wallet holds on Base, as a list to pick from — so Send and Swap start from
 * the user's own assets instead of a blank token field. ETH first, then priced tokens, largest
 * first (the same rule as the wallet skill: unpriced tokens in a wallet are mostly airdropped
 * lures, and a list to click on must not put a lure one click from a transfer).
 *
 * ETH and the tokens arrive SEPARATELY, and each is shown the moment it does. MEASURED
 * 2026-09-30: Blockscout's token list took 3.6–8.7 s for a real wallet, and while the two were
 * awaited together the whole list said "Reading your wallet…" for ~4.5 s — the owner read that as
 * the panel not responding. ETH is one RPC call (~0.2 s).
 *
 * The amounts come from Blockscout, an indexer, so they are for choosing; the % buttons read the
 * chain itself when pressed.
 */

export const SHOWN = 8;

type Row = { readonly address: string | null; readonly symbol: string; readonly amount: string; readonly value: string | null };

async function ethRow(account: string): Promise<Row> {
  const [wei, eth] = await Promise.all([rpc("eth_getBalance", [account, "latest"]).then((v) => quantity(v, "the ETH balance")), ethUsd()]);
  return { address: null, symbol: "ETH", amount: tokenAmount(wei, 18), value: eth === null ? null : usd((Number(wei) / 1e18) * eth) };
}

async function tokenRows(account: string): Promise<Row[]> {
  return priced(await tokenBalances(account))
    .slice(0, SHOWN)
    .map(({ token, value }) => ({ address: token.token, symbol: token.symbol, amount: tokenAmount(token.raw, token.decimals), value: usd(value) }));
}

/** a part of the list: still reading, read, or why it could not be */
type Part<T> = T | { readonly failed: string } | null;

export function WalletAssets({ account, label, onPick }: { account: string; label: string; onPick: (address: string | null) => void }) {
  const [eth, setEth] = useState<Part<Row>>(null);
  const [tokens, setTokens] = useState<Part<readonly Row[]>>(null);

  useEffect(() => {
    let live = true;
    setEth(null);
    setTokens(null);
    ethRow(account).then(
      (r) => live && setEth(r),
      (e: unknown) => live && setEth({ failed: messageOf(e) }),
    );
    tokenRows(account).then(
      (r) => live && setTokens(r),
      (e: unknown) => live && setTokens({ failed: messageOf(e) }),
    );
    return () => {
      live = false;
    };
  }, [account]);

  const rows = [...(eth && !("failed" in eth) ? [eth] : []), ...(tokens && !("failed" in tokens) ? tokens : [])];

  return (
    <fieldset className="group">
      <legend>{label}</legend>
      {rows.length > 0 ? (
        <ul className="assets" aria-label={label}>
          {rows.map((r) => (
            <li key={r.address ?? "eth"}>
              <button type="button" className="assets__row" onClick={() => onPick(r.address)}>
                <strong>{r.symbol}</strong>
                <span className="assets__amount">{r.amount}</span>
                <span className="assets__value">{r.value ?? "—"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {eth === null && tokens === null ? <p className="dim">Reading your wallet…</p> : null}
      {eth !== null && tokens === null ? <p className="dim">Reading your tokens…</p> : null}
      {eth && "failed" in eth ? <p className="dim">Your ETH balance could not be read: {eth.failed}</p> : null}
      {tokens && "failed" in tokens ? <p className="dim">Your tokens could not be read: {tokens.failed}</p> : null}
    </fieldset>
  );
}
