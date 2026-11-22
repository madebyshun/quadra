import { useEffect, useState } from "react";
import { BASE } from "@/config/chain";
import { dismissTxNotice, onTxNotices, type TxNotice } from "@/lib/txNotice";

const AUTO_CLOSE_MS: Readonly<Partial<Record<TxNotice["status"], number>>> = {
  confirmed: 6_000,
  reverted: 9_000,
  slow: 9_000,
  failed: 9_000,
};

function heading(n: TxNotice): string {
  if (n.total && n.total > 1 && n.step) return `Transaction · Step ${n.step}/${n.total}`;
  return "Transaction";
}

function statusText(n: TxNotice): string {
  switch (n.status) {
    case "wallet":
      return "Waiting for your wallet — approve or reject there.";
    case "pending":
      return `Sent — waiting for ${BASE.name} to confirm.`;
    case "confirmed":
      return n.block !== undefined ? `Confirmed in block ${n.block.toString()}.` : "Confirmed on Base.";
    case "reverted":
      return n.block !== undefined
        ? `Reverted in block ${n.block.toString()} — nothing moved except gas.`
        : "Reverted on Base.";
    case "slow":
      return "Still pending after the wait — check Basescan before retrying.";
    case "failed":
      return n.why ?? "Transaction did not send.";
  }
}

/**
 * Bottom-right Platinum popup stack for live on-chain transactions
 * (Launch token, Send, Swap, Bridge, Basket, Rewards).
 */
export function TxToast() {
  const [items, setItems] = useState<readonly TxNotice[]>([]);

  useEffect(() => onTxNotices(setItems), []);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const item of items) {
      const delay = AUTO_CLOSE_MS[item.status];
      if (!delay) continue;
      const elapsed = Date.now() - item.updatedAt;
      const wait = Math.max(0, delay - elapsed);
      timers.push(setTimeout(() => dismissTxNotice(item.id), wait));
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [items]);

  if (items.length === 0) return null;

  return (
    <aside className="tx-toast-stack" aria-label="Transaction notifications" aria-live="polite">
      {items.map((n) => (
        <div key={n.id} className={`tx-toast tx-toast--${n.status}`} role="status">
          <div className="tx-toast__bar">
            <span className="tx-toast__title">{heading(n)}</span>
            <button
              type="button"
              className="tx-toast__close"
              aria-label="Dismiss notification"
              onClick={() => dismissTxNotice(n.id)}
            >
              Close
            </button>
          </div>
          <div className="tx-toast__body">
            <strong className="tx-toast__label">{n.label}</strong>
            <p className="tx-toast__msg">{statusText(n)}</p>
            {(n.status === "wallet" || n.status === "pending") && (
              <div className="tx-toast__meter" aria-hidden="true" />
            )}
            {n.hash ? (
              <p className="tx-toast__meta">
                <a href={`${BASE.explorer}/tx/${n.hash}`} target="_blank" rel="noreferrer">
                  View on Basescan ({n.hash.slice(0, 10)}…)
                </a>
              </p>
            ) : null}
          </div>
        </div>
      ))}
    </aside>
  );
}
