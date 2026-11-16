import { useCallback, useRef, useState } from "react";
import { BASE } from "@/config/chain";
import { messageOf } from "@/lib/errors";
import { sendTransaction, waitForReceipt, type Receipt, type TxRequest, type WaitOptions } from "@/lib/transact";
import type { Eip1193Provider } from "@/lib/wallet";

/**
 * One or more transactions, signed one at a time, each watched until the chain answers.
 *
 * Send is one step; a token swap is an approval and then the swap; a launch paired with a
 * stock is an exact approval and then the launch. They share this runner so the thing a person watches — "waiting for your
 * wallet", "sent, waiting for Base", "confirmed in block N", "reverted" — reads the same
 * everywhere, and so a later step is never asked for while an earlier one is unconfirmed:
 * a swap signed before its approval lands simply reverts, and the user pays gas to learn
 * that.
 */

export type Step = {
  /** what this signature does, in words — shown before and after the wallet asks */
  readonly label: string;
  /** built at the moment it is sent, so it can read state the previous step changed */
  readonly build: () => TxRequest | Promise<TxRequest>;
};

export type StepState =
  | { readonly label: string; readonly status: "queued" | "wallet" }
  | { readonly label: string; readonly status: "pending"; readonly hash: string }
  | { readonly label: string; readonly status: "confirmed" | "reverted"; readonly hash: string; readonly block: bigint }
  /** the wait ran out with no receipt — NOT a failure, and it says so */
  | { readonly label: string; readonly status: "slow"; readonly hash: string }
  | { readonly label: string; readonly status: "failed"; readonly why: string };

export type TxSteps = {
  readonly states: readonly StepState[];
  readonly running: boolean;
  /** Runs the steps in order. Resolves with every receipt when all confirmed, else `null`. */
  run(provider: Eip1193Provider, from: string, steps: readonly Step[]): Promise<Receipt[] | null>;
  /**
   * How many steps of the LAST `run` confirmed, read synchronously after it resolves — the `states`
   * array is React state and may still be the previous render when a caller looks at it.
   */
  confirmed(): number;
  reset(): void;
};

export function useTxSteps(wait: WaitOptions = {}): TxSteps {
  const [states, setStates] = useState<readonly StepState[]>([]);
  const [running, setRunning] = useState(false);
  /** kept in a ref as well as in `states`: a caller reading it right after `run` resolves sees the truth */
  const lastConfirmed = useRef(0);

  const run = useCallback(
    async (provider: Eip1193Provider, from: string, steps: readonly Step[]) => {
      setRunning(true);
      const now: StepState[] = steps.map((s) => ({ label: s.label, status: "queued" }));
      const show = (i: number, state: StepState) => {
        now[i] = state;
        setStates([...now]);
      };
      setStates([...now]);
      lastConfirmed.current = 0;
      const receipts: Receipt[] = [];
      try {
        for (const [i, step] of steps.entries()) {
          show(i, { label: step.label, status: "wallet" });
          let hash: string;
          try {
            hash = await sendTransaction(provider, from, await step.build());
          } catch (err) {
            show(i, { label: step.label, status: "failed", why: messageOf(err) });
            return null;
          }
          show(i, { label: step.label, status: "pending", hash });
          const receipt = await waitForReceipt(hash, wait);
          if (receipt === null) {
            show(i, { label: step.label, status: "slow", hash });
            return null;
          }
          show(i, { label: step.label, status: receipt.status === "success" ? "confirmed" : "reverted", hash, block: receipt.block });
          if (receipt.status !== "success") return null;
          receipts.push(receipt);
          lastConfirmed.current = receipts.length;
        }
        return receipts;
      } finally {
        setRunning(false);
      }
    },
    [wait],
  );

  const reset = useCallback(() => {
    lastConfirmed.current = 0;
    setStates([]);
  }, []);
  return { states, running, run, reset, confirmed: () => lastConfirmed.current };
}

function line(s: StepState) {
  switch (s.status) {
    case "queued":
      return <span className="dim">next</span>;
    case "wallet":
      return <span>waiting for your wallet — check it and approve or reject</span>;
    case "pending":
      return <span>sent, waiting for {BASE.name} to include it</span>;
    case "confirmed":
      return <span className="tx__ok">confirmed in block {s.block.toString()}</span>;
    case "reverted":
      return <span className="tx__bad">reverted in block {s.block.toString()} — nothing moved except the gas fee</span>;
    case "slow":
      return (
        <span className="tx__warn">
          still pending after the wait — NOT failed. Check it on Basescan before doing anything again.
        </span>
      );
    case "failed":
      return <span className="tx__bad">{s.why}</span>;
  }
}

/** The steps as a list: each label, what is happening to it, and its hash as a Basescan link. */
export function TxStepList({ states, label }: { states: readonly StepState[]; label: string }) {
  if (states.length === 0) return null;
  return (
    <ol className="tx" aria-label={label}>
      {states.map((s, i) => (
        <li key={`${i}-${s.label}`} className={`tx__step tx__step--${s.status}`}>
          <strong>{s.label}</strong>
          <br />
          {line(s)}
          {"hash" in s ? (
            <>
              {" · "}
              <a href={`${BASE.explorer}/tx/${s.hash}`} target="_blank" rel="noreferrer">
                {s.hash.slice(0, 10)}…
              </a>
            </>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
