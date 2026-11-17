import { useEffect, useState } from "react";
import { checkPendingStep, JOURNAL_EVENT, readPendingStep, type PendingStep } from "@/lib/basketJournal";
import { messageOf } from "@/lib/errors";

export function useBasketRecovery(account: string | null) {
  const [pending, setPending] = useState<PendingStep | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    const update = () => {
      try { setPending(account === null ? null : readPendingStep(account)); setProblem(null); }
      catch (e) { setProblem(messageOf(e)); }
    };
    setNote(null); update();
    window.addEventListener(JOURNAL_EVENT, update);
    window.addEventListener("storage", update);
    return () => { window.removeEventListener(JOURNAL_EVENT, update); window.removeEventListener("storage", update); };
  }, [account]);
  const refresh = async () => {
    try {
      const state = await checkPendingStep(account!);
      setNote(state === "confirmed" ? "Previous transaction confirmed. Refresh your holdings and review the remaining allocation before buying again." : state === "reverted" ? "Previous transaction reverted. Check gas costs and refresh holdings before reviewing a new purchase." : "Status is still unresolved. Do not buy again; check your wallet activity.");
    } catch (e) { setNote(messageOf(e)); }
  };
  return { pending, problem, note, refresh, locked: pending !== null || problem !== null };
}
