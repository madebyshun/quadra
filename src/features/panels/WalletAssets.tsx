import { useEffect, useState } from "react";
import { baseStocks } from "@/adapters/http/markets";
import { USDC } from "@/config/chain";
import { TRADE_CRYPTO } from "@/config/markets";
import { balanceOf } from "@/lib/erc20";
import { priced, tokenBalances } from "@/skills/blockscout";
import { tokenAmount, usd } from "@/skills/format";
import { ethUsd } from "@/skills/dexscreener";
import { quantity, rpc } from "@/skills/http";
import { messageOf } from "@/lib/errors";

/**
 * What the connected wallet holds on Base, as a list to pick from — so Send and Swap start from
 * the user's own assets instead of a blank token field.
 *
 * ETH first (one RPC call, ~0.2 s), then Blockscout's priced tokens, each shown as it arrives
 * (MEASURED 2026-09-30: Blockscout took 3.6–8.7 s; awaited together the list read as broken).
 * Unpriced tokens never appear — mostly airdropped lures, one click from a transfer.
 *
 * `loadFastWalletRows` is TokenPicker's: ETH plus direct on-chain reads of the listed crypto and
 * Coinbase's stocks with a NAV, fetched only when a picker opens and cached per account for 15 s.
 */

export const SHOWN = 8;

export type WalletRow = {
  readonly address: string | null;
  readonly symbol: string;
  readonly name?: string;
  readonly amount: string;
  readonly value: string | null;
  /** the row's dollar value for ordering; 0 when it has no price */
  readonly sortUsd: number;
};

async function ethRow(account: string): Promise<WalletRow> {
  const [wei, eth] = await Promise.all([rpc("eth_getBalance", [account, "latest"]).then((v) => quantity(v, "the ETH balance")), ethUsd()]);
  const v = eth === null ? null : (Number(wei) / 1e18) * eth;
  return { address: null, symbol: "ETH", name: "Ether", amount: tokenAmount(wei, 18), value: v === null ? null : usd(v), sortUsd: v ?? 0 };
}

/** Fast direct on-chain read for USDC, listed Base crypto, and Coinbase tokenized stocks. */
async function fastKnownRows(account: string): Promise<WalletRow[]> {
  const stocks = await baseStocks().then((m) => [...m.values()].filter((s) => !s.paused.includes(0) && s.nav !== null)).catch(() => []);
  const targets = [
    ...TRADE_CRYPTO.map((c) => ({ address: c.address, symbol: c.symbol, name: c.name, decimals: c.decimals, nav: c.address.toLowerCase() === USDC.address.toLowerCase() ? 1 : null })),
    ...stocks.map((s) => ({ address: s.address, symbol: s.symbol, name: s.name, decimals: s.decimals, nav: s.nav })),
  ];
  const balances = await Promise.all(
    targets.map(async (t) => {
      const raw = await balanceOf({ kind: "erc20", address: t.address, symbol: t.symbol, decimals: t.decimals }, account).catch(() => 0n);
      return { ...t, raw };
    }),
  );
  return balances
    .filter((b) => b.raw > 0n)
    .map((b) => {
      const num = Number(b.raw) / 10 ** b.decimals;
      const v = b.nav !== null ? num * b.nav : null;
      return { address: b.address, symbol: b.symbol, name: b.name, amount: tokenAmount(b.raw, b.decimals, 4), value: v === null ? null : usd(v), sortUsd: v ?? 0 };
    })
    .sort(byUsd);
}

async function tokenRows(account: string): Promise<WalletRow[]> {
  return priced(await tokenBalances(account))
    .slice(0, SHOWN)
    .map(({ token, value }) => ({ address: token.token, symbol: token.symbol, amount: tokenAmount(token.raw, token.decimals), value: usd(value), sortUsd: value }));
}

const byUsd = (a: WalletRow, b: WalletRow) => b.sortUsd - a.sortUsd;

const fastCache = new Map<string, { readonly at: number; readonly promise: Promise<readonly WalletRow[]> }>();

/** Shared fast wallet holdings list (ETH + USDC + Base crypto + Coinbase stocks) for TokenPicker. */
export function loadFastWalletRows(account: string): Promise<readonly WalletRow[]> {
  const k = account.toLowerCase();
  const hit = fastCache.get(k);
  if (hit && Date.now() - hit.at < 15_000) return hit.promise;
  // fastKnownRows never throws: an unreadable list or balance is left out of a list that is only for choosing
  const promise = Promise.all([ethRow(account).catch(() => null), fastKnownRows(account)]).then(([e, rest]) => {
    const out: WalletRow[] = [];
    if (e) out.push(e);
    out.push(...rest);
    return out.sort(byUsd);
  });
  fastCache.set(k, { at: Date.now(), promise });
  return promise;
}

/** a part of the list: still reading, read, or why it could not be */
type Part<T> = T | { readonly failed: string } | null;

export function WalletAssets({ account, label, onPick }: { account: string; label: string; onPick: (address: string | null, symbol: string) => void }) {
  const [eth, setEth] = useState<Part<WalletRow>>(null);
  const [tokens, setTokens] = useState<Part<readonly WalletRow[]>>(null);

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

  const merged: readonly WalletRow[] = [...(eth && !("failed" in eth) ? [eth] : []), ...(tokens && !("failed" in tokens) ? tokens : [])];

  const stillReadingAll = eth === null && tokens === null;
  const stillReadingMore = eth !== null && tokens === null;

  return (
    <fieldset className="group">
      <legend>{label}</legend>
      {merged.length > 0 ? (
        <ul className="assets" aria-label={label}>
          {merged.map((r) => (
            <li key={r.address ?? "eth"}>
              <button type="button" className="assets__row" onClick={() => onPick(r.address, r.symbol)}>
                <strong>{r.symbol}</strong>
                <span className="assets__amount">{r.amount}</span>
                <span className="assets__value">{r.value ?? "—"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {stillReadingAll ? <p className="dim">Reading your wallet…</p> : null}
      {stillReadingMore ? <p className="dim">Reading your tokens…</p> : null}
      {eth && "failed" in eth ? <p className="dim">Your ETH balance could not be read: {eth.failed}</p> : null}
      {tokens && "failed" in tokens ? <p className="dim">Your tokens could not be read: {tokens.failed}</p> : null}
    </fieldset>
  );
}
