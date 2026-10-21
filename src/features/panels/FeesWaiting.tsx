import { useCallback, useEffect, useState } from "react";
import { collectTx } from "@/adapters/http/launchpad";
import { say } from "@/lib/assistant";
import { messageOf } from "@/lib/errors";
import { tokenAmount, short } from "@/skills/format";
import { owedTo, type Owed } from "@/skills/owed";
import { Gel } from "@/ui/Gel";
import { useWalletSession } from "@/ui/WalletProvider";
import { feesText } from "@/features/panels/BaseLaunch";
import { readCoins, type Coins } from "@/features/panels/ProfilePanel";
import { TxStepList, useTxSteps } from "@/features/panels/TxSteps";

/**
 * The Wallet window's "Your fees" (owner, 2026-10-03: "a wallet so users can claim fees"): every coin
 * this wallet launched here with trading fees waiting, collected in one go — each `collect` its own
 * signature, in order — and anything a factory OWES this wallet (a payout it could not push) with the
 * `withdraw` that pays it. All read from the chain; nothing is held here, and `collect` pays the
 * launcher's 80% straight to the launcher's own address.
 */

type Read = { readonly kind: "reading" } | { readonly kind: "ok"; readonly coins: Coins; readonly owed: readonly Owed[] | null } | { readonly kind: "failed"; readonly why: string };

export function FeesWaiting({ account }: { account: string }) {
  const { signingProvider } = useWalletSession();
  const [read, setRead] = useState<Read>({ kind: "reading" });
  const [fresh, setFresh] = useState(0);
  const steps = useTxSteps();

  const load = useCallback(async () => {
    const coins = await readCoins(account);
    const quotes = coins.mine.flatMap((m) => (m.fees ? [m.fees.quote] : []));
    const owed = await owedTo(account, quotes).catch(() => null);
    return { coins, owed };
  }, [account]);

  useEffect(() => {
    let live = true;
    setRead({ kind: "reading" });
    load().then(
      (r) => {
        if (!live) return;
        setRead({ kind: "ok", ...r });
        const n = r.coins.mine.filter((m) => m.fees && (m.fees.inQuote > 0n || m.fees.inToken > 0n)).length;
        if (n > 0) say({ id: `fees:${account}`, text: `You have trading fees waiting on ${n} ${n === 1 ? "coin" : "coins"} you launched. One click collects them all.`, action: { label: "Open Wallet", command: "open wallet" } });
      },
      (e) => live && setRead({ kind: "failed", why: messageOf(e) }),
    );
    return () => {
      live = false;
    };
  }, [load, account, fresh]);

  if (read.kind === "reading") return <p className="dim">Reading the fees waiting for you…</p>;
  if (read.kind === "failed") return <p className="tx__warn">Could not read your fees: {read.why}</p>;
  const waiting = read.coins.mine.filter((m) => m.fees && (m.fees.inQuote > 0n || m.fees.inToken > 0n));
  const pairs = (m: (typeof waiting)[number]) =>
    m.value ? [{ address: m.value.quote, symbol: m.value.quoteSymbol, name: m.value.quoteSymbol, decimals: m.value.quoteDecimals, startTick: 0 }] : [];
  const collectAll = async () => {
    const list = waiting.map((c) => ({ label: `Collect the fees of ${c.name ?? short(c.token)}`, build: () => collectTx(c.factory, c.token) }));
    if ((await steps.run(signingProvider(), account, list)) !== null) setFresh((n) => n + 1);
  };
  const withdraw = async (o: Owed) => {
    if ((await steps.run(signingProvider(), account, [{ label: `Withdraw what ${short(o.factory)} owes you`, build: () => o.tx }])) !== null) setFresh((n) => n + 1);
  };
  return (
    <div className="stack">
      {read.coins.mine.length === 0 ? (
        <p className="dim">You have not launched a coin here yet — when you do, its trading fees gather here.</p>
      ) : (
        <ul className="notes" aria-label="Fees waiting">
          {read.coins.mine.map((m) => (
            <li key={m.token}>
              <span className="notes__row">
                <strong>{m.name ?? short(m.token)}</strong>
              </span>
              <span className="notes__why">{feesText(m.fees, pairs(m))}</span>
            </li>
          ))}
        </ul>
      )}
      {read.coins.mine.length > 0 && (
        <Gel onClick={() => void collectAll()} disabled={waiting.length === 0 || steps.running}>
          {waiting.length === 0 ? "No fees waiting" : `Claim all — ${waiting.length} ${waiting.length === 1 ? "coin" : "coins"}`}
        </Gel>
      )}
      {read.owed === null ? (
        <p className="tx__warn">Not checked — whether a launchpad owes you a refused payout could not be read.</p>
      ) : (
        read.owed.map((o) => (
          <p key={`${o.factory}:${o.currency}`}>
            A launchpad owes you {tokenAmount(o.amount, o.currency === "0x0000000000000000000000000000000000000000" ? 18 : 8, 6)}{" "}
            {o.currency === "0x0000000000000000000000000000000000000000" ? "ETH" : short(o.currency)} it could not send when it was due.{" "}
            <Gel quiet onClick={() => void withdraw(o)} disabled={steps.running}>
              Withdraw
            </Gel>
          </p>
        ))
      )}
      <TxStepList states={steps.states} label="Claim progress" />
    </div>
  );
}
