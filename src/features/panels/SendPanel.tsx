import { useEffect, useRef, useState } from "react";
import { useInbox } from "@/features/openWindow";
import { transfersOf } from "@/skills/profile";
import { historyOf, historyRow } from "@/skills/sendcheck";
import { BASE } from "@/config/chain";
import { sameAddress } from "@/lib/address";
import { formatAmount, parseAmount } from "@/lib/amount";
import { accountKind, balanceOf, transferData } from "@/lib/erc20";
import { messageOf } from "@/lib/errors";
import type { TxRequest } from "@/lib/transact";
import { explorer } from "@/skills/format";
import { resolveTarget, type Target } from "@/skills/target";
import { row, type Report, type Row } from "@/skills/types";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import { useWalletSession } from "@/ui/WalletProvider";
import { ReportView } from "@/features/panels/ReportView";
import { TxStepList, useTxSteps } from "@/features/panels/TxSteps";
import { amountFor, assetFor, choiceFor, PercentButtons, TokenPicker, type Choice } from "@/features/panels/TokenPicker";
import { WalletAssets } from "@/features/panels/WalletAssets";

/**
 * Send ETH or any token on Base from the connected wallet, to an address or a Basename.
 *
 * Two clicks on purpose. **Review** reads everything the wallet will not show clearly —
 * which address a Basename resolves to, what the token contract says it is, whether the
 * balance covers it, whether the recipient is a contract — and lays it out as a report.
 * **Send** hands exactly that transaction to the wallet. Changing any field throws the
 * review away, so what was reviewed is always what gets signed.
 *
 * Public: this is an ordinary transfer, visible on Basescan like any other. (The private
 * send that used to live in this window was archived with the privacy model, 2026-09-30.)
 */

type Review = {
  readonly report: Report;
  readonly tx: TxRequest;
  readonly label: string;
  /** a reason the send cannot go ahead, worn by the button */
  readonly blocked: string | null;
};

/** Below this much ETH left over, a native send leaves too little to pay for the next transaction. */
const GAS_RESERVE = 10n ** 13n;

async function buildReview(from: string, choice: Choice, typedToken: string, typedTo: string, typedAmount: string): Promise<Review> {
  const [asset, target] = await Promise.all([assetFor(choice, typedToken, "Token address"), resolveTarget(typedTo, "Recipient")]);
  const amount = parseAmount(typedAmount, asset.decimals);
  if (amount === 0n) throw new Error("Enter an amount above zero.");
  // the sender's own history, for Send Check's look-alike test: a failed read is a row, never a pass
  const [balance, kind, moved] = await Promise.all([balanceOf(asset, from), accountKind(target.address), transfersOf(from).catch(() => null)]);
  const history = sameAddress(target.address, from)
    ? null
    : moved === null
      ? row("Your history", "not checked — your token history could not be read; compare the address with where you got it", { tone: "warn" })
      : historyRow(target.address, historyOf(from, moved));
  /** a fake transfer named this address as if you had paid it: address poisoning, and the send is refused */
  const planted = history?.tone === "bad" && history.value.includes("PLANTED");
  /** a wallet with an EIP-7702 delegation is still a wallet: only real contracts get the warning */
  const contract = kind.kind === "contract";

  const shown = `${formatAmount(amount, asset.decimals)} ${asset.symbol}`;
  const short = balance < amount;
  const rows: Row[] = [
    row("You send", shown),
    asset.kind === "native"
      ? row("Token", "ETH, Base's own currency")
      : row("Token", `${asset.symbol} · ${asset.address}`, { href: explorer.token(asset.address) }),
    row("To", target.via ? `${target.via} → ${target.address}` : target.address, { href: explorer.address(target.address) }),
    row("Your balance", `${formatAmount(balance, asset.decimals)} ${asset.symbol}`, short ? { tone: "bad" } : {}),
    row("Network", `${BASE.name} (${BASE.id})`),
    ...recipientWarnings(target, from, contract),
    ...(history && history.tone !== undefined ? [history] : []),
    ...(asset.kind === "native" && !short && balance - amount < GAS_RESERVE
      ? [row("Gas", "This leaves almost no ETH to pay for the next transaction.", { tone: "warn" })]
      : []),
  ];
  const tx: TxRequest =
    asset.kind === "native"
      ? { to: target.address, value: amount }
      : { to: asset.address, data: transferData(target.address, amount) };
  return {
    report: {
      title: "Review",
      rows,
      notes: ["Your wallet shows this again before anything is sent. Nothing moves until you approve it there."],
      sources: ["Base RPC", ...(target.via ? ["Basenames"] : []), "Blockscout (your token transfers)"],
    },
    tx,
    label: `Send ${shown} to ${target.via ?? target.address}`,
    blocked: planted ? "Refused: a planted address" : short ? `Not enough ${asset.symbol}` : null,
  };
}

function recipientWarnings(target: Target, from: string, contract: boolean): Row[] {
  return [
    ...(sameAddress(target.address, from) ? [row("Recipient", "That is your own address.", { tone: "warn" })] : []),
    ...(contract
      ? [row("Recipient", "This address is a contract. Tokens sent to a contract that cannot handle them are lost for good.", { tone: "warn" })]
      : []),
  ];
}

export function SendPanel() {
  const { wallet, signingProvider } = useWalletSession();
  const [choice, setChoice] = useState<Choice>("ETH");
  const [token, setToken] = useState("");
  const [pickedSymbol, setPickedSymbol] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const steps = useTxSteps();

  /** Any edit throws the review away: what was reviewed is what gets signed. */
  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    setReview(null);
    setError(null);
    steps.reset();
  };

  // `send 0x…` from anywhere in the app — a Send Check's "Send to it", a profile — fills the recipient
  useInbox("to", edit(setTo));

  const ready = wallet?.kind === "ready" ? wallet : null;
  const blocker = !ready
    ? "Connect a wallet first"
    : choice === "other" && token.trim() === ""
      ? "Enter the token address"
      : to.trim() === ""
        ? "Enter a recipient"
        : amount.trim() === ""
          ? "Enter an amount"
          : null;

  const onReview = async () => {
    setReading(true);
    setError(null);
    try {
      setReview(await buildReview(ready!.account, choice, token, to, amount));
    } catch (e) {
      setError(messageOf(e));
    }
    setReading(false);
  };

  /** A token picked from the wallet list: the known ones by name, anything else by address. */
  const pick = (address: string | null, symbol?: string) => {
    const c = choiceFor(address);
    edit((v) => setChoice(v as Choice))(c);
    setToken(c === "other" ? address! : "");
    setPickedSymbol(c === "other" ? (symbol ?? null) : null);
    // an amount typed for the old token means nothing for the new one
    setAmount("");
  };

  /** the % button being read, so the click shows at once */
  const [pending, setPending] = useState<number | null>(null);
  const fill = async (pct: number) => {
    setPending(pct);
    try {
      edit(setAmount)(await amountFor(choice, token, "Token address", ready!.account, pct));
    } catch (e) {
      setError(messageOf(e));
    }
    setPending(null);
  };

  const onSend = async () => {
    const r = review!;
    await steps.run(signingProvider(), ready!.account, [{ label: r.label, build: () => r.tx }]);
  };

  const done = steps.states.length > 0;
  const statusRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (done) statusRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [done, steps.states]);

  return (
    <div className="stack">
      {ready ? <WalletAssets account={ready.account} label={`Your assets on ${BASE.name} — pick one to send`} onPick={pick} /> : null}
      <fieldset className="group">
        <legend>Send on {BASE.name}</legend>
        <TokenPicker
          label="Token"
          choice={choice}
          address={token}
          customLabel={pickedSymbol}
          onChoice={(c) => {
            if (c !== "other") setPickedSymbol(null);
            edit((v) => setChoice(v as Choice))(c);
          }}
          onAddress={(a) => {
            setPickedSymbol(null);
            edit(setToken)(a);
          }}
        />
        <label className="group__row">
          <span>To</span>
          <input className="field" aria-label="Recipient" placeholder="0x… or name.base.eth" spellCheck={false} value={to} onChange={(e) => edit(setTo)(e.target.value)} />
        </label>
        <label className="group__row">
          <span>Amount</span>
          <input className="field" aria-label="Amount" placeholder="0.0" inputMode="decimal" value={amount} onChange={(e) => edit(setAmount)(e.target.value)} />
        </label>
        <PercentButtons onPick={(p) => void fill(p)} pending={pending} disabled={!ready || (choice === "other" && token.trim() === "")} />
      </fieldset>

      {done ? (
        <div ref={statusRef} className="stack tx__result">
          <TxStepList states={steps.states} label="Send progress" />
        </div>
      ) : null}

      {error ? (
        <Crt label="Send error">
          <span className="crt__amber">{error}</span>
        </Crt>
      ) : null}

      {review === null ? (
        <Gel className="mf__cta" onClick={() => void onReview()} disabled={blocker !== null || reading}>
          {reading ? "Reading…" : (blocker ?? "Review")}
        </Gel>
      ) : (
        <>
          <ReportView report={review.report} />
          <Gel className={done ? "mf__cta mf__cta--static" : "mf__cta"} onClick={() => void onSend()} disabled={review.blocked !== null || steps.running || done}>
            {review.blocked ?? (done ? "Sent — edit a field to send again" : "Send in wallet")}
          </Gel>
        </>
      )}
    </div>
  );
}
