import type { Eip1193Provider } from "@/lib/wallet";
import { rpc } from "@/skills/http";

export const JOURNAL_EVENT = "quadra-basket-journal";
const key = (account: string) => `quadra.basket.sequence.v1:${account.toLowerCase()}`;
export type PendingStep = { account: string; label: string; hash: string | null };
const HASH = /^0x[0-9a-fA-F]{64}$/;

export function readPendingStep(account: string): PendingStep | null {
  const text = localStorage.getItem(key(account));
  if (text === null) return null;
  const b = JSON.parse(text) as PendingStep;
  if (b.account !== account.toLowerCase() || typeof b.label !== "string" || (b.hash !== null && (typeof b.hash !== "string" || !HASH.test(b.hash)))) throw new Error("The saved basket status is unreadable. Check your wallet activity before buying again.");
  return b;
}
function write(account: string, value: PendingStep | null) {
  if (value === null) localStorage.removeItem(key(account));
  else localStorage.setItem(key(account), JSON.stringify(value));
  window.dispatchEvent(new Event(JOURNAL_EVENT));
}

/** Mark the wallet boundary before asking it to send, including ambiguous timeout/reload cases. */
export function journalWallet(provider: Eip1193Provider, account: string, label: string): Eip1193Provider {
  return { request: async (args) => {
    if (args.method !== "eth_sendTransaction") return provider.request(args);
    if (readPendingStep(account) !== null) throw new Error("A previous basket transaction is unresolved. Check its status before buying again.");
    const entry: PendingStep = { account: account.toLowerCase(), label, hash: null };
    write(account, entry);
    try {
      const answer = await provider.request(args);
      if (typeof answer === "string" && HASH.test(answer)) write(account, { ...entry, hash: answer });
      return answer;
    } catch (e) {
      if (String((e as { code?: unknown } | null)?.code) === "4001") write(account, null);
      throw e;
    }
  } };
}

/** Only a receipt for the recorded hash may release the lock. */
export function settlePendingStep(account: string, hash: string): void {
  const entry = readPendingStep(account);
  if (entry?.hash === hash) write(account, null);
}

export async function checkPendingStep(account: string): Promise<"none" | "unknown" | "pending" | "confirmed" | "reverted"> {
  const entry = readPendingStep(account);
  if (entry === null) return "none";
  if (entry.hash === null) return "unknown";
  const receipt = await rpc("eth_getTransactionReceipt", [entry.hash]) as { status?: unknown } | null;
  if (receipt === null) return "pending";
  if (receipt.status !== "0x1" && receipt.status !== "0x0") throw new Error("The receipt status is unreadable. Do not buy again.");
  settlePendingStep(account, entry.hash);
  return receipt.status === "0x1" ? "confirmed" : "reverted";
}
