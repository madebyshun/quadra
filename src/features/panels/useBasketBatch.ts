import { useEffect, useRef, useState } from "react";
import { atomicCapability, checkBatchWallet, findBatchOnChain, getBatchStatus, sendAtomicBatch, simulateBatch, type BatchStatus } from "@/lib/callBatch";
import { messageOf } from "@/lib/errors";
import type { Receipt, TxRequest } from "@/lib/transact";
import type { Eip1193Provider } from "@/lib/wallet";
import { rpc } from "@/skills/http";

export const BATCH_KEY = "quadra.basket.pending.v1";
/** `from`/`usdc` let the chain answer when the wallet's status is stuck; a record saved before them has neither. */
type Pending = { readonly account: string; readonly id: string; readonly from?: bigint; readonly usdc?: bigint };
const key = (account: string) => `${BATCH_KEY}:${account.toLowerCase()}`;
/** Stored as `id` or `id|fromBlock|usdcTotal` — the frozen key keeps reading what it always held. */
const save = (p: Pending) => localStorage.setItem(key(p.account), p.from === undefined || p.usdc === undefined ? p.id : `${p.id}|${p.from}|${p.usdc}`);
function load(account: string, raw: string): Pending {
  const [id, from, usdc] = raw.split("|");
  return /^\d+$/.test(from ?? "") && /^\d+$/.test(usdc ?? "") ? { account, id: id!, from: BigInt(from!), usdc: BigInt(usdc!) } : { account, id: id! };
}

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
      const raw = localStorage.getItem(key(account));
      if (raw !== null) setPending(load(account, raw));
      atomicCapability(provider(), account).then((c) => { if (live) setCapability(c); });
    } catch {
      setCapability("unsupported");
      setMessage("Wallet or browser storage is unavailable. Reconnect your wallet before buying.");
    }
    return () => { live = false; };
  }, [account, provider]);

  const check = async (p: Pending, wallet: Eip1193Provider): Promise<BatchStatus> => {
    let result = await getBatchStatus(wallet, p.id);
    if (result.kind === "pending" && p.from !== undefined && p.usdc !== undefined) {
      const found = await findBatchOnChain(p.account, p.from, p.usdc);
      if (found !== null) result = { kind: "confirmed", receipts: [found] };
    }
    if (result.kind !== "pending") localStorage.removeItem(key(p.account));
    // A response from a previous wallet must never unlock or complete the current wallet's basket.
    if (session.current !== activeSession) return result;
    if (result.kind === "confirmed") { setComplete(true); setReceipts(result.receipts); }
    if (result.kind !== "pending") setPending(null);
    setMessage(result.kind === "confirmed" ? "The whole basket confirmed on Base." : result.kind === "failed" ? "The batch failed. No basket purchases were applied; gas may have been charged. You can try again." : "Basket submitted, still pending. Check its status before buying again.");
    return result;
  };

  const errText = (e: unknown) => {
    if (e && typeof e === "object" && "message" in e && typeof (e as { message?: unknown }).message === "string") return (e as { message: string }).message;
    return messageOf(e);
  };

  const refresh = async () => {
    setWorking(true);
    try {
      await check(pending!, provider());
    } catch (e) {
      if (session.current === activeSession) setMessage(`Status is uncertain: ${errText(e)} Do not buy again; check the batch in your wallet.`);
    } finally { if (session.current === activeSession) setWorking(false); }
  };

  const buy = async (prepare: () => Promise<readonly TxRequest[]>, usdcTotal?: bigint) => {
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
      const id = `0x${crypto.randomUUID().replaceAll("-", "")}`;
      const p: Pending = usdcTotal === undefined ? { account: account!, id } : { account: account!, id, from: BigInt(await rpc("eth_blockNumber", []) as string), usdc: usdcTotal };
      // Saving must succeed before signing; an RPC timeout could mean the wallet DID send it.
      save(p);
      setPending(p);
      setMessage("Confirm the whole basket in your wallet. Keep this window open to check its status.");
      let actualId = p.id;
      try {
        const ackId = await sendAtomicBatch(wallet, p.account, calls, p.id);
        if (ackId && ackId !== p.id) {
          actualId = ackId;
          save({ ...p, id: actualId });
          if (session.current === activeSession) setPending({ ...p, id: actualId });
        }
      } catch (e) {
        // EIP-1193 explicit rejection or pre-submission parameter rejection guarantees nothing was sent.
        const code = String((e as { code?: unknown } | null)?.code);
        const msg = errText(e);
        const notSent = code === "4001" || code === "BATCH_NOT_SENT" || code === "-32602" || /batch size cannot exceed|exceeds? max/i.test(msg);
        if (notSent) {
          localStorage.removeItem(key(p.account));
          if (session.current !== activeSession) return;
          setPending(null);
          setMessage(code === "4001" ? "You rejected the basket in your wallet. Nothing was sent." : msg);
          return;
        }
        throw e;
      }
      await check({ ...p, id: actualId }, wallet);
    } catch (e) {
      if (session.current === activeSession) setMessage(errText(e));
    } finally {
      locked.current = false;
      if (session.current === activeSession) setWorking(false);
    }
  };
  const clear = () => {
    if (pending) {
      try {
        localStorage.removeItem(key(pending.account));
      } catch {
        // ignore storage errors when manually clearing
      }
    }
    setPending(null);
    setMessage(null);
  };
  return { capability, pending, working, message, complete, receipts, buy, refresh, clear, reset: () => { setComplete(false); setReceipts(null); setMessage(null); } };
}
