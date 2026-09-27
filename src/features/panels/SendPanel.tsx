import { useCallback, useEffect, useState } from "react";
import { useAdapters } from "@/adapters/AdaptersProvider";
import type { Note, Receipt } from "@/adapters/types";
import { formatAmount, parseAmount } from "@/lib/amount";
import { USDC } from "@/config/chain";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import { Anchor } from "@/features/panels/Anchor";

/**
 * Put money in, pay someone out of it, or take it back.
 *
 * Every amount here goes through parseAmount, so the input is either an exact
 * base-unit bigint or a thrown error the user reads — there is no path where a
 * typo becomes a silently rounded number. USDC is the only token for now because
 * it is the one the router pays in; the token is in the state so adding AAPLc is
 * a select, not a rewrite.
 */

const TOKEN = { address: USDC.address, symbol: USDC.symbol, decimals: USDC.decimals };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function SendPanel() {
  const { pool } = useAdapters();

  const [notes, setNotes] = useState<Note[]>([]);
  const [depositText, setDepositText] = useState("10");
  const [to, setTo] = useState("");
  const [sendText, setSendText] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setNotes(await pool.notes());
  }, [pool]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * One place where every action's failure becomes a message. Each handler below
   * throws a real Error, so the UI never has to invent wording for a failure it
   * does not understand.
   */
  const run = useCallback(
    async (action: () => Promise<Receipt | null>) => {
      setError(null);
      try {
        setReceipt(await action());
      } catch (e) {
        setReceipt(null);
        setError(e instanceof Error ? e.message : String(e));
      }
      await refresh();
    },
    [refresh],
  );

  const deposit = () =>
    run(async () => {
      const note = await pool.deposit(TOKEN, parseAmount(depositText, TOKEN.decimals));
      setSelected(note.id);
      return {
        summary: `You put ${formatAmount(note.amount, TOKEN.decimals)} ${TOKEN.symbol} in. Keep this note: it is the money.`,
        anchoring: note.anchoring,
      };
    });

  const send = () =>
    run(async () => {
      if (!selected) throw new Error("Pick a note to spend.");
      if (!ADDRESS.test(to.trim())) {
        throw new Error("That is not an address. Paste a 20-byte 0x… address.");
      }
      return pool.send(selected, to.trim(), parseAmount(sendText, TOKEN.decimals));
    });

  const withdraw = () =>
    run(async () => {
      if (!selected) throw new Error("Pick a note to withdraw.");
      if (!ADDRESS.test(to.trim())) {
        throw new Error("That is not an address. Paste a 20-byte 0x… address.");
      }
      return pool.withdraw(selected, to.trim());
    });

  const total = notes.reduce((sum, n) => sum + n.amount, 0n);

  return (
    <div className="stack">
      <fieldset className="group">
        <legend>Put money in</legend>
        <label className="group__row">
          <span>Amount</span>
          <input
            className="field"
            value={depositText}
            onChange={(e) => setDepositText(e.target.value)}
            aria-label="Amount to deposit"
            inputMode="decimal"
          />
          <span className="group__unit">{TOKEN.symbol}</span>
        </label>
        <Gel onClick={deposit}>Deposit</Gel>
      </fieldset>

      <fieldset className="group">
        <legend>
          Your notes — {formatAmount(total, TOKEN.decimals)} {TOKEN.symbol} in {notes.length}
        </legend>
        {notes.length === 0 ? (
          <p className="dim">No notes yet. Put something in above.</p>
        ) : (
          <ul className="notes notes--scroll" aria-label="Your notes">
            {notes.map((n) => (
              <li key={n.id}>
                <label className="notes__row">
                  <input
                    type="radio"
                    name="note"
                    checked={selected === n.id}
                    onChange={() => setSelected(n.id)}
                    aria-label={`Note ${n.id}, ${formatAmount(n.amount, n.token.decimals)} ${n.token.symbol}`}
                  />
                  <code className="notes__amount">
                    {formatAmount(n.amount, n.token.decimals)} {n.token.symbol}
                  </code>
                  <code className="notes__id dim">{n.id}</code>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <fieldset className="group">
        <legend>Pay out of a note</legend>
        <label className="group__row">
          <span>To</span>
          <input
            className="field"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="0x…"
            aria-label="Address to pay"
            spellCheck={false}
          />
        </label>
        <label className="group__row">
          <span>Amount</span>
          <input
            className="field"
            value={sendText}
            onChange={(e) => setSendText(e.target.value)}
            aria-label="Amount to send"
            inputMode="decimal"
          />
          <span className="group__unit">{TOKEN.symbol}</span>
        </label>
        <div className="row">
          <Gel onClick={send} disabled={notes.length === 0}>
            Send
          </Gel>
          <Gel quiet onClick={withdraw} disabled={notes.length === 0}>
            Withdraw all of it
          </Gel>
        </div>
      </fieldset>

      <Crt label="Send output">
        {error ? (
          <span className="crt__amber">{error}</span>
        ) : receipt ? (
          <>
            <span>{receipt.summary}</span>
            <Anchor anchoring={receipt.anchoring} />
          </>
        ) : (
          <span className="crt__dim">{"// nothing run yet"}</span>
        )}
      </Crt>
    </div>
  );
}
