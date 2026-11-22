/**
 * Desktop transaction popups (bottom-right corner) for every on-chain action
 * launched via `useTxSteps` (Launch token, Send, Swap, Bridge, Basket, Rewards).
 */

export type TxNoticeStatus = "wallet" | "pending" | "confirmed" | "reverted" | "slow" | "failed";

export type TxNotice = {
  readonly id: string;
  readonly label: string;
  readonly status: TxNoticeStatus;
  readonly step?: number;
  readonly total?: number;
  readonly hash?: string;
  readonly block?: bigint;
  readonly why?: string;
  readonly updatedAt: number;
};

type Listener = (notices: readonly TxNotice[]) => void;

const MAX_NOTICES = 3;
const listeners = new Set<Listener>();
let notices: TxNotice[] = [];

function emit(): void {
  const snapshot = [...notices];
  listeners.forEach((l) => l(snapshot));
}

export function onTxNotices(l: Listener): () => void {
  listeners.add(l);
  l([...notices]);
  return () => listeners.delete(l);
}

export function pushTxNotice(notice: Omit<TxNotice, "updatedAt">): void {
  const next: TxNotice = { ...notice, updatedAt: Date.now() };
  const idx = notices.findIndex((n) => n.id === next.id);
  if (idx >= 0) {
    notices = notices.map((item, i) => (i === idx ? next : item));
  } else {
    notices = [...notices, next].slice(-MAX_NOTICES);
  }
  emit();
}

export function dismissTxNotice(id: string): void {
  const next = notices.filter((n) => n.id !== id);
  if (next.length === notices.length) return;
  notices = next;
  emit();
}

export function clearTxNotices(): void {
  if (notices.length === 0) return;
  notices = [];
  emit();
}
