import { useEffect, useRef, useState } from "react";
import { atomicCapability, checkBatchWallet, getBatchStatus, sendAtomicBatch, simulateBatch, type BatchStatus } from "@/lib/callBatch";
import { messageOf } from "@/lib/errors";
import type { Receipt, TxRequest } from "@/lib/transact";
import type { Eip1193Provider } from "@/lib/wallet";

export const BATCH_KEY = "quadra.basket.pending.v1";
type Pending = { readonly account: string; readonly id: string };
const key = (account: string) => `${BATCH_KEY}:${account.toLowerCase()}`;

/** A persisted batch survives closing the window/reloading. Checking status never signs anything. */
export function useBasketBatch(account: string | null, provider: () => Eip1193Provider) {
  const [capability, setCapability] = useState<"checking" | "supported" | "ready" | "unsupported">("checking");
  const [pending, setPending] = useState<Pending | null>(null);
  const [receipts, setReceipts] = useState<readonly Receipt[] | null>(null);
  const [complete, setComplete] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const locked = useRef(false);
  const session = useRef({ account, provider });
  if (session.current.account !== account || session.current.provider !== provider) session.current = { account, provider };
  const activeSession = session.current;

  useEffect(() => {
    let live = true;
    setCapability("checking");
    setPending(null);
    setWorking(false);
    setComplete(false);
    setReceipts(null);
    setMessage(null);
    if (account === null) return;
    try {
      const id = localStorage.getItem(key(account));
      if (id !== null) setPending({ account, id });
      atomicCapability(provider(), account).then((c) => { if (live) setCapability(c); });
    } catch {
      setCapability("unsupported");
      setMessage("Wallet or browser storage is unavailable. Reconnect your wallet before buying.");
    }
    return () => { live = false; };
  }, [account, provider]);

  const check = async (p: Pending, wallet: Eip1193Provider): Promise<BatchStatus> => {
    const result = await getBatchStatus(wallet, p.id);
    if (result.kind !== "pending") localStorage.removeItem(key(p.account));
    // A response from a previous wallet must never unlock or complete the current wallet's basket.
    if (session.current !== activeSession) return result;
    if (result.kind === "confirmed") { setComplete(true); setReceipts(result.receipts); }
    if (result.kind !== "pending") setPending(null);
    setMessage(result.kind === "confirmed" ? "The whole basket confirmed on Base." : result.kind === "failed" ? "The batch failed. No basket purchases were applied; gas may have been charged. You can try again." : "Basket submitted, still pending. Check its status before buying again.");
    return result;
  };

  const refresh = async () => {
    setWorking(true);
    try {
      await check(pending!, provider());
    } catch (e) {
      if (session.current === activeSession) setMessage(`Status is uncertain: ${messageOf(e)} Do not buy again; check the batch in your wallet.`);
    } finally { if (session.current === activeSession) setWorking(false); }
  };

  const buy = async (prepare: () => Promise<readonly TxRequest[]>) => {
    if (locked.current || pending !== null) return;
    locked.current = true;
    setWorking(true);
    setMessage("Refreshing quotes and checking the whole basket…");
    try {
      const wallet = provider();
      await checkBatchWallet(wallet, account!);
      const calls = await prepare();
      await simulateBatch(account!, calls);
      if (session.current !== activeSession) throw new Error("The connected wallet changed while preparing the basket. Nothing was sent.");
      const p = { account: account!, id: `0x${crypto.randomUUID().replaceAll("-", "")}` };
      // Saving must succeed before signing; an RPC timeout could mean the wallet DID send it.
      localStorage.setItem(key(p.account), p.id);
      setPending(p);
      setMessage("Confirm the whole basket in your wallet. Keep this window open to check its status.");
      try {
        await sendAtomicBatch(wallet, p.account, calls, p.id);
      } catch (e) {
        // EIP-1193's explicit user rejection guarantees no submission. Other errors are uncertain.
        const code = String((e as { code?: unknown } | null)?.code);
        if (code === "4001" || code === "BATCH_NOT_SENT") {
          localStorage.removeItem(key(p.account));
          if (session.current !== activeSession) return;
          setPending(null);
          setMessage(code === "4001" ? "You rejected the basket in your wallet. Nothing was sent." : messageOf(e));
          return;
        }
        throw e;
      }
      await check(p, wallet);
    } catch (e) {
      if (session.current === activeSession) setMessage(messageOf(e));
    } finally {
      locked.current = false;
      if (session.current === activeSession) setWorking(false);
    }
  };
  return { capability, pending, working, message, complete, receipts, buy, refresh, reset: () => { setComplete(false); setReceipts(null); setMessage(null); } };
}
