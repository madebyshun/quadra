import { useState } from "react";
import { exactApproval, quoteBridge, type BridgeAsset, type BridgeQuote } from "@/adapters/http/across";
import { BASE, USDC } from "@/config/chain";
import { BRAND } from "@/brand";
import { ACROSS, FEE_BPS, NATIVE, ROBINHOOD } from "@/config/routes";
import { toChecksumAddress } from "@/lib/address";
import { formatAmount, parseAmount } from "@/lib/amount";
import { robinhoodBalance, waitForArrival, type ArrivalOptions } from "@/lib/arrival";
import { accountKind, allowance, balanceOf, ETH } from "@/lib/erc20";
import { messageOf } from "@/lib/errors";
import { explorer } from "@/skills/format";
import { row, type Report } from "@/skills/types";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import { useWalletSession } from "@/ui/WalletProvider";
import { ReportView } from "@/features/panels/ReportView";
import { TxStepList, useTxSteps, type Step } from "@/features/panels/TxSteps";

/**
 * Move ETH or USDC from Base to Robinhood Chain (4663), to the same address, through Across.
 *
 * **Review** quotes Across and runs `checkBridge`, which decodes the deposit and refuses it
 * unless it pays THIS wallet, on 4663, the verified token, at least the quoted minimum.
 * **Bridge** signs (an exact approval first for USDC, when the allowance is short), then
 * watches Robinhood Chain's own RPC until the balance there rises by the minimum.
 *
 * 🔴 Same address only, and only from an account one private key controls on every chain: an
 * ordinary wallet, or one with an EIP-7702 smart-account delegation (MetaMask's Smart Account —
 * see `accountKind`). A real smart-contract wallet at 0xABC on Base is not necessarily anybody's
 * wallet at 0xABC on Robinhood Chain — it may not be deployed there at all — so bridging from
 * one is refused rather than risked.
 */

/**
 * What counts as arrived. For ETH it is ETH plus WETH on Robinhood Chain: Across pays an address
 * that has code — which a 7702-delegated wallet does — in WETH rather than native ETH (inferred
 * from LI.FI refusing an Across ETH route to a contract, 2026-09-30; not measured on a fill), and
 * either one is the user's money arriving.
 */
function arrived(receive: string, account: string): Promise<bigint> {
  return receive === NATIVE
    ? Promise.all([robinhoodBalance(NATIVE, account), robinhoodBalance(ROBINHOOD.weth.address, account)]).then(([eth, weth]) => eth + weth)
    : robinhoodBalance(receive, account);
}

const ASSETS: Record<BridgeAsset, { readonly decimals: number; readonly label: string }> = {
  ETH: { decimals: 18, label: "ETH → ETH" },
  USDC: { decimals: 6, label: "USDC → USDG" },
};

type Review = {
  readonly quote: BridgeQuote;
  readonly amount: bigint;
  readonly balance: bigint;
  readonly approve: boolean;
  /** the wallet has an EIP-7702 delegation */
  readonly delegated: boolean;
};

function report(r: Review, asset: BridgeAsset, wallet: string): Report {
  const { quote } = r;
  const account = toChecksumAddress(wallet);
  const send = asset === "ETH" ? ETH : { symbol: "USDC", decimals: 6 };
  const short = r.balance < r.amount;
  return {
    title: "Review",
    rows: [
      row("You send", `${formatAmount(r.amount, send.decimals)} ${send.symbol} on ${BASE.name}`),
      row("Your balance", `${formatAmount(r.balance, send.decimals)} ${send.symbol}`, short ? { tone: "bad" } : {}),
      row("You receive, at least", `${formatAmount(quote.min, quote.receive.decimals)} ${quote.receive.symbol} on ${ROBINHOOD.name} (${ROBINHOOD.id})`),
      row("To", `${account} — your own address on ${ROBINHOOD.name}`, { href: `${ROBINHOOD.explorer}/address/${account}` }),
      row("Takes about", quote.fillSeconds === null ? "not estimated" : `${quote.fillSeconds} s`),
      row("Checked", "recipient, token, amount, destination chain and minimum — all read from the transaction itself", { tone: "ok" }),
      row("Signs to", `Across's verified contract ${quote.tx.to}`, { href: explorer.address(quote.tx.to), tone: "ok" }),
      ...(r.approve ? [row("Approval", `exactly ${formatAmount(r.amount, 6)} USDC to Across — never unlimited`)] : []),
      row(`${BRAND.name} fee`, quote.feeOn ? `${FEE_BPS / 100}%` : "off — no fee address is set"),
    ],
    notes: [
      ...(r.delegated && asset === "ETH"
        ? [`Your wallet has a smart-account delegation (EIP-7702), so Across may pay it out as WETH on ${ROBINHOOD.name}. Either counts as arrived.`]
        : []),
      ...(asset === "USDC"
        ? [`There is no USDC on ${ROBINHOOD.name}. It arrives as USDG (Paxos Global Dollar, ${ROBINHOOD.usdg.address}) — other tokens there calling themselves USDC are not it.`]
        : []),
      ...(quote.expiresAt ? [`Quote valid until ${quote.expiresAt.toLocaleTimeString()}.`] : []),
      `Tokenized stocks live only on ${ROBINHOOD.name}; they cannot be bridged from ${BASE.name}.`,
    ],
    sources: ["Across (quote)", `${BASE.name} RPC`],
  };
}

export function BridgePanel({ arrival = {} }: { arrival?: ArrivalOptions }) {
  const { wallet, signingProvider } = useWalletSession();
  const [asset, setAsset] = useState<BridgeAsset>("USDC");
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [landed, setLanded] = useState<{ rise: bigint | null } | null>(null);
  const steps = useTxSteps();

  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setReview(null);
    setError(null);
    setLanded(null);
    steps.reset();
  };

  const ready = wallet?.kind === "ready" ? wallet : null;
  const blocker = !ready ? "Connect a wallet first" : amount.trim() === "" ? "Enter an amount" : null;

  const onReview = async () => {
    setReading(true);
    setError(null);
    try {
      const account = ready!.account;
      const value = parseAmount(amount, ASSETS[asset].decimals);
      if (value === 0n) throw new Error("Enter an amount above zero.");
      const kind = await accountKind(account);
      if (kind.kind === "contract") {
        throw new Error(
          `Your wallet is a smart-contract wallet. The same address on ${ROBINHOOD.name} may not be yours, so this build only bridges from a wallet one key controls. Nothing was sent.`,
        );
      }
      const [quote, balance, allowed] = await Promise.all([
        quoteBridge({ user: account, asset, amount: value }),
        balanceOf(asset === "ETH" ? ETH : { kind: "erc20", address: USDC.address, symbol: "USDC", decimals: 6 }, account),
        asset === "ETH" ? Promise.resolve(value) : allowance(USDC.address, account, ACROSS.spokePool),
      ]);
      setReview({ quote, amount: value, balance, approve: allowed < value, delegated: kind.kind === "delegated" });
    } catch (e) {
      setError(messageOf(e));
    }
    setReading(false);
  };

  const onBridge = async () => {
    const r = review!;
    if (r.quote.expiresAt !== null && r.quote.expiresAt.getTime() <= Date.now()) {
      setReview(null);
      setError("That quote has expired. Review again for a fresh one — nothing was sent.");
      return;
    }
    const account = ready!.account;
    const before = await arrived(r.quote.receive.address, account);
    const approval = r.approve ? exactApproval(r.quote, r.amount) : null;
    const plan: Step[] = [
      ...(approval ? [{ label: "Approve Across to move exactly this much USDC", build: () => approval }] : []),
      { label: `Bridge to ${ROBINHOOD.name}`, build: () => r.quote.tx },
    ];
    const done = await steps.run(signingProvider(), account, plan);
    if (done === null) return;
    setLanded({ rise: null });
    const rise = await waitForArrival(() => arrived(r.quote.receive.address, account), before, r.quote.min, arrival);
    setLanded({ rise: rise ?? -1n });
  };

  const started = steps.states.length > 0;
  const short = review !== null && review.balance < review.amount;

  return (
    <div className="stack">
      <fieldset className="group">
        <legend>
          {BASE.name} → {ROBINHOOD.name}
        </legend>
        <label className="group__row">
          <span>Move</span>
          <select className="field" aria-label="Move" value={asset} onChange={(e) => edit(setAsset)(e.target.value as BridgeAsset)}>
            <option value="USDC">{ASSETS.USDC.label}</option>
            <option value="ETH">{ASSETS.ETH.label}</option>
          </select>
        </label>
        <label className="group__row">
          <span>Amount</span>
          <input className="field" aria-label="Amount" placeholder="0.0" inputMode="decimal" value={amount} onChange={(e) => edit(setAmount)(e.target.value)} />
        </label>
      </fieldset>

      {review === null ? (
        <Gel className="mf__cta" onClick={() => void onReview()} disabled={blocker !== null || reading}>
          {reading ? "Quoting…" : (blocker ?? "Get a quote")}
        </Gel>
      ) : (
        <>
          <ReportView report={report(review, asset, ready!.account)} />
          <Gel className="mf__cta" onClick={() => void onBridge()} disabled={short || steps.running || started}>
            {short ? `Not enough ${asset}` : started ? "Bridged — edit a field to bridge again" : "Bridge in wallet"}
          </Gel>
        </>
      )}

      {error ? (
        <Crt label="Bridge error">
          <span className="crt__amber">{error}</span>
        </Crt>
      ) : null}
      <TxStepList states={steps.states} label="Bridge progress" />
      {landed === null || review === null ? null : landed.rise === null ? (
        <p>Watching {ROBINHOOD.name} for it to arrive…</p>
      ) : landed.rise < 0n ? (
        <p className="tx__warn">
          Not seen on {ROBINHOOD.name} yet. Across usually fills in seconds — check your balance there before doing anything again.
        </p>
      ) : (
        <p className="tx__ok">
          Arrived: your {review.quote.receive.symbol === "ETH" ? "ETH and WETH" : review.quote.receive.symbol} balance on{" "}
          {ROBINHOOD.name} rose by{" "}
          {formatAmount(landed.rise, review.quote.receive.decimals)}.
        </p>
      )}
    </div>
  );
}
