import { useCallback, useEffect, useState } from "react";
import { useAdapters } from "@/adapters/AdaptersProvider";
import type { Note, Receipt } from "@/adapters/types";
import { formatAmount, parseAmount } from "@/lib/amount";
import { offerDownload, readTextFile } from "@/lib/download";
import { USDC } from "@/config/chain";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import { Anchor } from "@/features/panels/Anchor";

/**
 * Put money in, pay someone out of it, take it back, or carry it out as a file.
 *
 * Every amount here goes through parseAmount, so the input is either an exact
 * base-unit bigint or a thrown error the user reads — there is no path where a
 * typo becomes a silently rounded number. USDC is the only token for now because
 * it is the one the router pays in; the token is in the state so adding AAPLc is
 * a select, not a rewrite.
 *
 * ── Why backup is in this panel and not its own window ───────────────────────
 * It is the same object as the notes list: the thing being backed up is what the user
 * is looking at, and the moment they need to think about a backup is the moment they
 * first see a note appear. A separate card would be one more thing to find, and the
 * people who would never find it are exactly the ones who lose money.
 */

const TOKEN = { address: USDC.address, symbol: USDC.symbol, decimals: USDC.decimals };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * What the CRT is showing.
 *
 * A discriminated union rather than one `Receipt | null`, because a backup is not a
 * receipt and rendering it as one would lie in the user's favour and against them at the
 * same time. `Anchor` prints "Not on chain: …" in amber for a `local` anchoring — correct
 * and useful after a deposit, actively misleading after an export, where not being on
 * chain is the entire feature. A successful backup would come back looking like a warning.
 */
type Output =
  | { kind: "receipt"; receipt: Receipt }
  /** A plain sentence: something happened that no chain has an opinion about. */
  | { kind: "plain"; text: string };

export function SendPanel() {
  const { pool } = useAdapters();

  const [notes, setNotes] = useState<Note[]>([]);
  const [depositText, setDepositText] = useState("10");
  const [to, setTo] = useState("");
  const [sendText, setSendText] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [output, setOutput] = useState<Output | null>(null);
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
    async (action: () => Promise<Output>) => {
      setError(null);
      try {
        setOutput(await action());
      } catch (e) {
        setOutput(null);
        setError(e instanceof Error ? e.message : String(e));
      }
      await refresh();
    },
    [refresh],
  );

  /** Most actions produce a receipt; wrapping here keeps that off every call site. */
  const runReceipt = useCallback(
    (action: () => Promise<Receipt>) =>
      run(async () => ({ kind: "receipt", receipt: await action() })),
    [run],
  );

  const deposit = () =>
    runReceipt(async () => {
      const note = await pool.deposit(TOKEN, parseAmount(depositText, TOKEN.decimals));
      setSelected(note.id);
      return {
        summary: `You put ${formatAmount(note.amount, TOKEN.decimals)} ${TOKEN.symbol} in. Keep this note: it is the money.`,
        anchoring: note.anchoring,
      };
    });

  const send = () =>
    runReceipt(async () => {
      if (!selected) throw new Error("Pick a note to spend.");
      if (!ADDRESS.test(to.trim())) {
        throw new Error("That is not an address. Paste a 20-byte 0x… address.");
      }
      return pool.send(selected, to.trim(), parseAmount(sendText, TOKEN.decimals));
    });

  const withdraw = () =>
    runReceipt(async () => {
      if (!selected) throw new Error("Pick a note to withdraw.");
      if (!ADDRESS.test(to.trim())) {
        throw new Error("That is not an address. Paste a 20-byte 0x… address.");
      }
      return pool.withdraw(selected, to.trim());
    });

  /**
   * ⚠️ Says the file was **offered**, not that it was saved.
   *
   * Nothing here can know whether it reached a disk — that is decided by the browser's
   * download UI and by the user, neither of which reports back (see `offerDownload`).
   * "Backed up ✓" would be the app claiming a fact it does not have, about the one file
   * standing between the user and losing everything. So the wording tells them to go and
   * check, which is the action that actually makes the backup real.
   */
  const exportBackup = () =>
    run(async () => {
      const file = await pool.exportBackup();
      offerDownload(file);
      return {
        kind: "plain",
        text:
          `Saving ${file.filename} — ${notes.length === 1 ? "1 note" : `all ${notes.length} notes`}, ` +
          `secrets included. Open your downloads and check the file is there before you rely on it.`,
      };
    });

  /**
   * Takes the `<input>` itself rather than reaching for it through a ref.
   *
   * A ref would be `HTMLInputElement | null`, so the reset below would need a null
   * check — for a state that cannot happen, since the only caller is that input's own
   * `onChange` and an element firing an event is by definition mounted. An unreachable
   * branch is not free here: it can never be exercised, so it sits against the 100%
   * requirement forever and the honest ways to satisfy it are a non-null assertion
   * (a lie if it ever could be null) or a test that fakes a state the app cannot
   * reach. Passing the element makes the impossible state unrepresentable instead,
   * which is the same move as `requireContract()` refusing to hand back a plausible
   * zero address.
   */
  const restore = (input: HTMLInputElement) =>
    run(async () => {
      /**
       * `undefined` when the user opened the picker and cancelled. Not an error and not
       * silence either — a cancelled restore that printed nothing is indistinguishable
       * from one that failed without a message.
       */
      const picked = input.files?.[0];
      if (!picked) throw new Error("No file picked, so nothing was restored.");
      const { notes: restored } = await pool.importBackup(await readTextFile(picked));
      return {
        kind: "plain",
        text: `Restored ${restored === 1 ? "1 note" : `${restored} notes`} from ${picked.name}. Check the amounts below against what you expected.`,
      };
    }).finally(() => {
      /**
       * Cleared after every restore so picking the same file twice actually fires. A file
       * input does not emit `change` when the chosen file is identical to the last one, and
       * the second attempt is exactly what a user makes after a refusal they have just
       * fixed. `tests/panels.test.tsx` has the measurement.
       */
      input.value = "";
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
        {/*
          🔴 The warning is in the deposit flow, before the money goes in, because that is
          the last moment it is free to act on. Persistence made the app survive a reload,
          which made it *look* durable — and it is not: clearing site data, closing a
          private window, or a browser reclaiming storage takes every note with it, and
          there is no server-side copy by design. A user who learns this after depositing
          learns it from an empty pool.
        */}
        <p className="dim">
          These notes live in this browser and nowhere else. Clearing site data or losing
          this browser loses the money — there is no copy on any server. Export a backup
          below once you have put something in.
        </p>
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

      <fieldset className="group">
        <legend>Back up your notes</legend>
        {/*
          The plaintext warning is not hidden behind a details element or softened. The file
          IS the money: a backup without the secrets restores nothing, so it is exactly as
          valuable as the pool it came from. Saying that plainly is what makes the user
          careful with it, and it is the reason `lib/backup.ts` does not pretend to encrypt.
        */}
        <p className="dim">
          The file holds your note secrets in plain text. Anyone who opens it can spend
          your money, so keep it like cash — not in a shared folder, not in email.
        </p>
        <div className="row">
          <Gel onClick={exportBackup} disabled={notes.length === 0}>
            Export a backup
          </Gel>
        </div>
        <label className="group__row">
          <span>Restore</span>
          <input
            className="field"
            type="file"
            accept="application/json,.json"
            aria-label="Backup file to restore"
            /**
             * `currentTarget` read synchronously, which is the only time it is valid —
             * React nulls it once the handler returns, and the reset runs after an await.
             * Reading it here passes the element itself, which outlives the event.
             */
            onChange={(e) => void restore(e.currentTarget)}
          />
        </label>
        <p className="dim">
          Restoring only works into a browser with no notes in it. If this one already has
          some, export them first — nothing here will merge two pools or overwrite one.
        </p>
      </fieldset>

      <Crt label="Send output">
        {error ? (
          <span className="crt__amber">{error}</span>
        ) : output === null ? (
          <span className="crt__dim">{"// nothing run yet"}</span>
        ) : output.kind === "receipt" ? (
          <>
            <span>{output.receipt.summary}</span>
            <Anchor anchoring={output.receipt.anchoring} />
          </>
        ) : (
          <span>{output.text}</span>
        )}
      </Crt>
    </div>
  );
}
