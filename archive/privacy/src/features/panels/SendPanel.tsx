import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdapters } from "@/adapters/AdaptersProvider";
import type { Note, Receipt } from "@/adapters/types";
import {
  type AddressCheck,
  assertChecksummedAddress,
  checkAddress,
  describeChecksum,
} from "@/lib/address";
import { formatAmount, parseAmount } from "@/lib/amount";
import { balanceOf, inToken, largestPayment, pickNote } from "@/lib/balance";
import { offerDownload, readTextFile } from "@/lib/download";
import { BASE, USDC } from "@/config/chain";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import { Anchor } from "@/features/panels/Anchor";
import { AmountField, Cta, FormRow, fractionOf } from "@/features/panels/MoneyForm";

/**
 * Put money in, pay someone out of it, take it back, or carry it out as a file.
 *
 * Every amount here goes through parseAmount, so the input is either an exact
 * base-unit bigint or a thrown error the user reads — there is no path where a
 * typo becomes a silently rounded number. USDC is the only token.
 *
 * ── Why there is no note list ────────────────────────────────────────────────
 * There was one, with a radio per note, and paying anybody meant first choosing which
 * note to pay from. That is the pool's bookkeeping, not a decision the user has a view
 * on, so the panel shows one balance and `lib/balance.ts` picks the note. Its header
 * has the one limit that choice cannot hide — a payment spends a single note — and this
 * panel says that limit out loud whenever the balance is split.
 *
 * ── Why backup is in this panel and not its own window ───────────────────────
 * The thing being backed up is the balance the user is looking at, and the moment they
 * need to think about a backup is the moment it first goes above zero. A separate card
 * would be one more thing to find, and the people who would never find it are exactly
 * the ones who lose money.
 */

const TOKEN = { address: USDC.address, symbol: USDC.symbol, decimals: USDC.decimals };

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
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The EIP-55 verdict for whatever is in the To field, or `null` while it is empty.
   *
   * `null` rather than a `malformed` verdict for the empty case: an untouched field has
   * not made a mistake, and telling somebody their blank input is not an address is
   * scolding them for not having typed yet. Anything non-empty gets classified, including
   * half-typed addresses — that is correct, because a half-typed address IS malformed and
   * the field is the right place to learn it.
   */
  const toChecksum = useMemo((): AddressCheck | null => {
    return to.trim() === "" ? null : checkAddress(to);
  }, [to]);

  /**
   * USDC notes only. A browser that used the old Swap window can still hold notes in
   * another token; they stay in the pool and in every backup, and are left out of a
   * USDC balance rather than being added to it as if they were dollars.
   */
  const refresh = useCallback(async () => {
    setNotes(inToken(await pool.notes(), TOKEN.address));
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
      return {
        summary: `You added ${formatAmount(note.amount, TOKEN.decimals)} ${TOKEN.symbol} to your private balance. It exists only in this browser — export a backup.`,
        anchoring: note.anchoring,
      };
    });

  /**
   * Reads the pool again rather than trusting `notes` from the last render, for both
   * actions below. The list on screen can be stale — another tab spent from the same
   * pool — and spending a note id the pool has already retired would come back as
   * "already spent" about something the user never chose to spend.
   */
  const current = async () => inToken(await pool.notes(), TOKEN.address);

  /**
   * The two refusals here are the ones the old note picker used to make for the user by
   * simply not offering the note. Both name both numbers, because "not enough" without
   * the amounts is a refusal the user cannot act on.
   */
  const send = () =>
    runReceipt(async () => {
      const recipient = assertChecksummedAddress(to, "Recipient");
      const amount = parseAmount(sendText, TOKEN.decimals);
      const held = await current();
      const note = pickNote(held, amount);
      if (note === null) {
        const have = balanceOf(held);
        const fmt = (v: bigint) => `${formatAmount(v, TOKEN.decimals)} ${TOKEN.symbol}`;
        throw new Error(
          amount > have
            ? `Your balance is ${fmt(have)}, which is less than ${fmt(amount)}.`
            : `One payment can move at most ${fmt(largestPayment(held))} — your balance is split across separate deposits, and a payment spends one of them. Send that much now and the rest as a second payment.`,
        );
      }
      return pool.send(note.id, recipient, amount);
    });

  /**
   * Everything out, to the address in the To field. One public transfer per note, in
   * sequence, and the receipt says how many — each one is visible on chain, and a
   * summary claiming a single transfer would misdescribe what an observer sees.
   */
  const withdraw = () =>
    runReceipt(async () => {
      const recipient = assertChecksummedAddress(to, "Recipient");
      const held = await current();
      const [first, ...rest] = held;
      /**
       * Reachable, not defensive: the button is enabled from the last render's list, and
       * the pool can have been emptied since — the same staleness `current` is for.
       */
      if (first === undefined) throw new Error("There is nothing in this balance to withdraw.");
      let { anchoring } = await pool.withdraw(first.id, recipient);
      for (const n of rest) ({ anchoring } = await pool.withdraw(n.id, recipient));
      const count = held.length === 1 ? "one transfer" : `${held.length} separate transfers`;
      return {
        summary: `You withdrew ${formatAmount(balanceOf(held), TOKEN.decimals)} ${TOKEN.symbol} to ${recipient}, in ${count}. That amount is now public on chain.`,
        anchoring,
      };
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
          `Saving ${file.filename} — your whole balance, secrets included. ` +
          `Open your downloads and check the file is there before you rely on it.`,
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
      await pool.importBackup(await readTextFile(picked));
      const back = balanceOf(await current());
      return {
        kind: "plain",
        text: `Restored ${formatAmount(back, TOKEN.decimals)} ${TOKEN.symbol} from ${picked.name}. Check that against the balance you expected.`,
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

  const total = balanceOf(notes);
  /** What one payment can move. Equal to `total` unless the balance is split. */
  const maxPayment = largestPayment(notes);
  const fmt = (v: bigint) => formatAmount(v, TOKEN.decimals);

  /**
   * Fills the amount field with a fraction of what ONE payment can move — not of the
   * balance. On a split balance, 100% of the balance is an amount no single payment
   * can send, so the chip that most looks like "send it all" would be the one chip
   * guaranteed to be refused. 100% is the case that has to be exact, which is why
   * `fractionOf` stays in base units — see its note.
   *
   * Not a convenience: typing an exact amount by hand is how somebody leaves behind a
   * 0.000001 USDC remainder, which is both useless and a distinguishing mark on chain.
   */
  const takePercent = (percent: number) => setSendText(fmt(fractionOf(maxPayment, percent)));

  /**
   * Why the pay button cannot be pressed, or `null` when it can — and the text it
   * wears while it cannot. See `MoneyForm`'s header for what belongs here: absences
   * only. A malformed address is NOT a blocker, because `assertChecksummedAddress`
   * explains itself far better in the output window than a button label ever could,
   * and neither is an amount the balance cannot cover, because `send` names both
   * numbers and a four-word label cannot.
   */
  const blocked = useMemo((): string | null => {
    if (notes.length === 0) return "Deposit something first";
    if (sendText.trim() === "") return "Enter amount";
    if (to.trim() === "") return "Enter a recipient";
    return null;
  }, [notes.length, sendText, to]);

  return (
    <div className="stack">
      {/*
        🔴 The warning is in the deposit flow, before the money goes in, because that is
        the last moment it is free to act on. Persistence made the app survive a reload,
        which made it *look* durable — and it is not: clearing site data, closing a
        private window, or a browser reclaiming storage takes the whole balance with it,
        and there is no server-side copy by design. A user who learns this after depositing
        learns it from an empty pool. It is one line now rather than three: the panel
        was scrolling past its own window, and a warning below the fold is not a warning.
      */}
      <fieldset className="group">
        <legend>
          Private balance — {fmt(total)} {TOKEN.symbol}
        </legend>
        <div className="group__row group__row--actions">
          <input
            className="field field--short"
            value={depositText}
            onChange={(e) => setDepositText(e.target.value)}
            aria-label="Amount to deposit"
            inputMode="decimal"
          />
          <span className="group__unit">{TOKEN.symbol}</span>
          <Gel onClick={deposit}>Add funds</Gel>
        </div>
        <p className="dim">In this browser only. Clearing site data loses the money.</p>
        {/*
          The backup controls sit INSIDE the balance fieldset, against the number
          they back up. They had their own bordered block with its own legend until the
          panel was measured in a browser and came to 554px inside a 429px window —
          the backup row was the part below the fold, which is the worst possible
          thing to lose: the people who never scroll to find it are exactly the ones
          who lose money. A border and a legend cost ~40px to say something the
          adjacency already says.
        */}
        <div className="group__row group__row--actions">
          <Gel onClick={exportBackup} disabled={notes.length === 0}>
            Export a backup
          </Gel>
          <input
            className="field field--file"
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
        </div>
        {/*
          The plaintext warning is not hidden behind a details element or softened. The file
          IS the money: a backup without the secrets restores nothing, so it is exactly as
          valuable as the pool it came from. Saying that plainly is what makes the user
          careful with it, and it is the reason `lib/backup.ts` does not pretend to encrypt.

          Shortened, not removed, when this panel was made to fit its window: what got cut
          was the sentence explaining that a restore will not merge two pools, which is a
          rule the importer enforces and states in its own error. A warning the code will
          repeat at the moment it applies can leave the resting screen; one that only ever
          arrives too late cannot.
        */}
        <p className="dim">
          The file holds this balance&apos;s secrets in plain text. Keep it like cash.
        </p>
      </fieldset>

      <fieldset className="group">
        <legend>Send</legend>
        {/*
          What is being spent, then how much, then to whom — the order the decisions
          are actually made in.

          The chain is named on the Token row rather than getting a row of its own.
          It started as a separate "Network / Base" row and that cost 38px MEASURED
          in a browser, which put this panel's own Send button 152px below the fold —
          the same defect the backup row had, on the button the window exists for.
          The chain still has to be said (hard rule 2: a token without its chain is
          not a token), but "USDC on Base" says it in the one place a reader is
          already looking, and there is only one chain to say.
        */}
        <div className="mf">
          <FormRow label="Token">
            <span>
              {TOKEN.symbol} on {BASE.name}
            </span>
            <span className="dim">{fmt(total)} available</span>
          </FormRow>
          {/*
            The per-payment cap rides in the Amount header, where it is read at the
            moment it applies. It was on the Token row first, and MEASURED in a browser
            that wrapped both halves of the row onto two lines each. It appears only when
            it differs from the balance — i.e. only when it is news; always printing it
            would be a second number meaning nothing to someone who has deposited once.
          */}
          <AmountField
            label="Amount"
            unit={maxPayment === total ? TOKEN.symbol : `max ${fmt(maxPayment)} per payment`}
            value={sendText}
            onChange={setSendText}
            ariaLabel="Amount to send"
            onPercent={takePercent}
            percentDisabled={notes.length === 0}
          />
          {/*
            ⚠️ Placeholder is `0x…` and nothing else. The design this shape came from
            offers "Address, ENS, or @username"; this app resolves neither, so copying
            that line would promise two lookups that do not exist and turn a typed
            name into a refusal the user was invited to make.
          */}
          <div className="mf__row">
            <span className="mf__label">To</span>
            <input
              className="field"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="0x…"
              aria-label="Address to pay"
              spellCheck={false}
            />
          </div>
        </div>
        {/*
          The checksum verdict, live, BEFORE the button is pressed.

          ⚠️ This is the whole product value of the increment and it has to be here rather
          than in the error path: after `Send` there is nothing to warn about, because on
          a real chain the payment has already happened. A lowercase address says so out
          loud instead of staying silent, since silence next to a field reads as approval
          and "cannot be checked" is materially weaker than "checked".
        */}
        {toChecksum !== null && (
          <p className={toChecksum.kind === "checksummed" ? "dim" : "caution"}>
            {describeChecksum(toChecksum)}
          </p>
        )}
        <Cta blocked={blocked} label="Send" onClick={send} />
        {/*
          Withdraw stays a quiet second button rather than becoming a second CTA.
          It is a different act — it puts the amount on a public chain — and a
          full-width primary next to another full-width primary asks the user to
          read two long labels to find which one is the ordinary one.
        */}
        <div className="row">
          <Gel quiet onClick={withdraw} disabled={notes.length === 0}>
            Withdraw everything to this address
          </Gel>
        </div>
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
