import { useEffect, useRef, useState } from "react";
import { isStock, RESTRICTED_TEXT, useStockAddresses, useStocksClosed } from "@/lib/region";
import { quoteSwap, isRelayNoRoute, type SwapQuote } from "@/adapters/http/relay";
import { SIM_ACCOUNT } from "@/skills/simulate";
import { launchOf } from "@/skills/launchpad";
import { BASE } from "@/config/chain";
import { BRAND } from "@/brand";
import { FEE_BPS } from "@/config/routes";
import { toChecksumAddress } from "@/lib/address";
import { formatAmount, parseAmount } from "@/lib/amount";
import { balanceOf, type Asset } from "@/lib/erc20";
import { messageOf } from "@/lib/errors";
import { ethReceived, tokenReceived } from "@/lib/transact";
import { explorer } from "@/skills/format";
import { row, type Report, type Row, type Tone } from "@/skills/types";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import { useWalletSession } from "@/ui/WalletProvider";
import { ReportView } from "@/features/panels/ReportView";
import { TxStepList, useTxSteps } from "@/features/panels/TxSteps";
import { amountFor, assetFor, choiceFor, PercentButtons, TokenPicker, type Choice } from "@/features/panels/TokenPicker";
import { useInbox, useOpenWindow } from "@/features/openWindow";
import { WalletAssets } from "@/features/panels/WalletAssets";

/**
 * Trade any token on Base, quoted live by Relay and signed in the user's wallet.
 *
 * **Review** reads both tokens from the chain, checks the balance, fetches a live quote and
 * passes it through `checkSwap` (where it goes, how much it may take); **Swap** signs it —
 * approval first when one is needed, then the swap — and afterwards measures what actually
 * arrived against the quoted minimum: a token from the swap's own Transfer events, ETH from the
 * balance at that block (`lib/transact.ts` — a `latest` read once raced the chain and said 0).
 *
 * A quote is a price at a moment. One more than a minute old is refused at the click and
 * has to be fetched again; the live quote is the only price this repo displays.
 */

/** A quote older than this is refused when Swap is pressed. */
export const QUOTE_TTL_MS = 60_000;

const SLIPPAGE = [
  { bps: 50, label: "0.5%" },
  { bps: 100, label: "1%" },
  { bps: 300, label: "3%" },
];

type Review = {
  readonly sell: Asset;
  readonly buy: Asset;
  readonly amount: bigint;
  readonly quote: SwapQuote;
  readonly quotedAt: number;
  readonly short: boolean;
};

/** Relay's price impact as a tone: past 1% is worth a look, past 5% is a warning in red. */
export function impactTone(percent: string | null): Tone {
  const n = Math.abs(Number(percent));
  return percent === null || Number.isNaN(n) ? "warn" : n > 5 ? "bad" : n > 1 ? "warn" : "ok";
}

function report(r: Review, balance: bigint, slippage: string): Report {
  const { sell, buy, quote } = r;
  const rows: Row[] = [
    row("You pay", `${formatAmount(r.amount, sell.decimals)} ${sell.symbol}`),
    row("Your balance", `${formatAmount(balance, sell.decimals)} ${sell.symbol}`, r.short ? { tone: "bad" } : {}),
    row("You get, about", `${formatAmount(quote.out, buy.decimals)} ${buy.symbol}`),
    row("At least", `${formatAmount(quote.min, buy.decimals)} ${buy.symbol} (slippage ${slippage})`),
    row("Price impact", quote.impact === null ? "not reported" : `${quote.impact}%`, { tone: impactTone(quote.impact) }),
    ...(buy.kind === "erc20" ? [row("Token you get", buy.address, { href: explorer.token(buy.address) })] : []),
    // the swap step's own target, which checkSwap already held to one of Relay's verified pairs
    row("Signs to", `Relay's verified contract ${toChecksumAddress(quote.steps[quote.steps.length - 1]!.tx.to)}`, {
      href: explorer.address(quote.steps[quote.steps.length - 1]!.tx.to),
      tone: "ok",
    }),
    ...(sell.kind === "erc20" && quote.steps.length > 1 ? [row("Approval", `exactly ${formatAmount(r.amount, sell.decimals)} ${sell.symbol} — never unlimited`)] : []),
    row(`${BRAND.name} fee`, quote.feeOn ? `${FEE_BPS / 100}%` : "off — no fee address is set"),
  ];
  return {
    title: "Review",
    rows,
    notes: [
      "Checked before you sign: where each transaction goes and how much it may take. The minimum is enforced inside Relay's contract call, which this app does not decode — so after the swap it measures what actually arrived.",
      `Quoted ${new Date(r.quotedAt).toLocaleTimeString()}. After a minute the quote must be fetched again.`,
    ],
    sources: ["Relay (quote)", `${BASE.name} RPC (tokens, balances)`],
  };
}

/** One side of a pair a caller has already chosen — Trade's asset and what it is paid for with. */
export type Picked = { readonly choice: Choice; readonly address: string; readonly symbol: string };

/**
 * `fixed` is Trade's way in: the pair is chosen outside (an asset and USDC or ETH), so the
 * pickers and the wallet list are not shown and only the amount is asked. Everything after
 * that — the quote, `checkSwap`, the signatures, what arrived — is this same code.
 */
export function SwapPanel({ fixed }: { readonly fixed?: { readonly sell: Picked; readonly buy: Picked } } = {}) {
  const { wallet, signingProvider } = useWalletSession();
  const openWindow = useOpenWindow();
  const [sellChoice, setSellChoice] = useState<Choice>(fixed?.sell.choice ?? "USDC");
  const [sellAddress, setSellAddress] = useState(fixed?.sell.address ?? "");
  const [sellLabel, setSellLabel] = useState<string | null>(null);
  const [buyChoice, setBuyChoice] = useState<Choice>(fixed?.buy.choice ?? "ETH");
  const [buyAddress, setBuyAddress] = useState(fixed?.buy.address ?? "");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(SLIPPAGE[0]!);
  const [review, setReview] = useState<(Review & { balance: bigint }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noRouteToken, setNoRouteToken] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [est, setEst] = useState<{ readonly out: bigint; readonly decimals: number; readonly symbol: string } | null>(null);
  const [quotingEst, setQuotingEst] = useState(false);
  /** what the swap delivered — `amount: null` when it could not be measured */
  const [received, setReceived] = useState<{ amount: bigint | null } | null>(null);
  const steps = useTxSteps();

  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setReview(null);
    setError(null);
    setReceived(null);
    steps.reset();
  };

  const closed = useStocksClosed();
  const stocks = useStockAddresses(closed);
  const touchesStock = closed && [sellChoice === "other" ? sellAddress : "", buyChoice === "other" ? buyAddress : ""].some((a) => a !== "" && isStock(a, stocks));
  const ready = wallet?.kind === "ready" ? wallet : null;

  // Live debounced "You get" estimate as soon as an amount and both tokens are entered
  useEffect(() => {
    if (review !== null || touchesStock || amount.trim() === "") {
      setEst(null);
      setQuotingEst(false);
      return;
    }
    if (sellChoice === "other" && sellAddress.trim().length < 42) return;
    if (buyChoice === "other" && buyAddress.trim().length < 42) return;
    let live = true;
    const id = setTimeout(() => {
      setQuotingEst(true);
      void (async () => {
        try {
          const [sell, buy] = await Promise.all([
            assetFor(sellChoice, sellAddress, "Token you pay"),
            assetFor(buyChoice, buyAddress, "Token you get"),
          ]);
          const value = parseAmount(amount, sell.decimals);
          if (value === 0n) {
            if (live) setEst(null);
            return;
          }
          const q = await quoteSwap({ user: ready?.account ?? SIM_ACCOUNT, sell, buy, amount: value, slippageBps: slippage.bps });
          if (live) setEst({ out: q.out, decimals: buy.decimals, symbol: buy.symbol });
        } catch {
          if (live) setEst(null);
        } finally {
          if (live) setQuotingEst(false);
        }
      })();
    }, 450);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [amount, sellChoice, sellAddress, buyChoice, buyAddress, slippage.bps, touchesStock, ready?.account, review]);
  const blocker = touchesStock
    ? "Not offered in your region"
    : !ready
    ? "Connect a wallet first"
    : sellChoice === "other" && sellAddress.trim() === ""
      ? "Enter the address of the token you pay"
      : buyChoice === "other" && buyAddress.trim() === ""
        ? "Enter the address of the token you get"
        : amount.trim() === ""
          ? "Enter an amount"
          : null;

  const onReview = async () => {
    setReading(true);
    setError(null);
    setNoRouteToken(null);
    try {
      const account = ready!.account;
      const [sell, buy] = await Promise.all([
        assetFor(sellChoice, sellAddress, "Token you pay"),
        assetFor(buyChoice, buyAddress, "Token you get"),
      ]);
      const value = parseAmount(amount, sell.decimals);
      if (value === 0n) throw new Error("Enter an amount above zero.");
      const [balance, quote] = await Promise.all([
        balanceOf(sell, account),
        quoteSwap({ user: account, sell, buy, amount: value, slippageBps: slippage.bps }),
      ]);
      setReview({ sell, buy, amount: value, quote, quotedAt: Date.now(), balance, short: balance < value });
    } catch (e) {
      setError(messageOf(e));
      // either side may be the launchpad coin: selling one hits the same missing route as buying it
      const coin = buyChoice === "other" && buyAddress.trim() !== "" ? buyAddress.trim() : sellChoice === "other" && sellAddress.trim() !== "" ? sellAddress.trim() : null;
      if (isRelayNoRoute(e) && coin !== null) {
        try {
          const target = await launchOf(coin);
          if (target !== null) setNoRouteToken(coin);
        } catch {
          // The fallback is advisory; keep Relay's measured refusal when the launchpad cannot be read.
        }
      }
    }
    setReading(false);
  };

  // `swap 0x…` / `buy 0x…` from anywhere in the app: that token is what you get
  useInbox(
    "buy",
    (address) => {
      const c = choiceFor(address);
      edit(setBuyChoice)(c);
      setBuyAddress(c === "other" ? address : "");
    },
    fixed === undefined,
  );

  /** A token picked from the wallet list becomes what you pay. */
  const pick = (address: string | null, symbol?: string) => {
    const c = choiceFor(address);
    edit(setSellChoice)(c);
    setSellAddress(c === "other" ? address! : "");
    setSellLabel(c === "other" ? (symbol ?? null) : null);
    // an amount typed for the old token means nothing for the new one
    setAmount("");
  };

  /** the % button being read, so the click shows at once */
  const [pending, setPending] = useState<number | null>(null);
  const fill = async (pct: number) => {
    setPending(pct);
    try {
      edit(setAmount)(await amountFor(sellChoice, sellAddress, "Token you pay", ready!.account, pct));
    } catch (e) {
      setError(messageOf(e));
    }
    setPending(null);
  };

  const onSwap = async () => {
    const r = review!;
    if (Date.now() - r.quotedAt > QUOTE_TTL_MS) {
      setReview(null);
      setError("That quote is more than a minute old. Review again for a fresh one — nothing was sent.");
      return;
    }
    const done = await steps.run(
      signingProvider(),
      ready!.account,
      r.quote.steps.map((s) => ({ label: s.label, build: () => s.tx })),
    );
    if (done === null) return;
    const swap = done[done.length - 1]!;
    const account = ready!.account;
    setReceived({ amount: r.buy.kind === "erc20" ? tokenReceived(swap, r.buy.address, account) : await ethReceived(swap, account) });
  };

  const started = steps.states.length > 0;
  const statusRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (started || received !== null) statusRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [started, received, steps.states]);

  return (
    <div className="stack">
      {ready && !fixed ? <WalletAssets account={ready.account} label={`Pay with one of your assets on ${BASE.name}`} onPick={pick} /> : null}
      <fieldset className="group">
        <legend>{fixed ? `${fixed.sell.symbol} → ${fixed.buy.symbol} on ${BASE.name}` : `Swap on ${BASE.name}`}</legend>
        {fixed ? null : (
          <TokenPicker
            label="You pay"
            choice={sellChoice}
            address={sellAddress}
            customLabel={sellLabel}
            onChoice={(c) => {
              setSellLabel(null);
              edit(setSellChoice)(c);
            }}
            onAddress={(a) => {
              setSellLabel(null);
              edit(setSellAddress)(a);
            }}
          />
        )}
        <label className="group__row">
          <span>Amount</span>
          <input className="field" aria-label="Amount" placeholder="0.0" inputMode="decimal" value={amount} onChange={(e) => edit(setAmount)(e.target.value)} />
          {fixed ? <span className="unit">{fixed.sell.symbol}</span> : null}
        </label>
        <PercentButtons onPick={(p) => void fill(p)} pending={pending} disabled={!ready || (sellChoice === "other" && sellAddress.trim() === "")} />
        {fixed ? null : (
          <TokenPicker label="You get" choice={buyChoice} address={buyAddress} onChoice={edit(setBuyChoice)} onAddress={edit(setBuyAddress)} />
        )}
        <div className="group__row">
          <span>You get (est.)</span>
          <div className="swap__est" aria-live="polite">
            {review ? (
              <strong>{`≈ ${formatAmount(review.quote.out, review.buy.decimals)} ${review.buy.symbol}`}</strong>
            ) : quotingEst ? (
              <span className="dim">Quoting…</span>
            ) : est ? (
              <strong>{`≈ ${formatAmount(est.out, est.decimals)} ${est.symbol}`}</strong>
            ) : (
              <span className="dim">Enter amount to preview</span>
            )}
          </div>
        </div>
        <label className="group__row">
          <span>Slippage</span>
          <select
            className="field"
            aria-label="Slippage"
            value={slippage.bps}
            onChange={(e) => edit(setSlippage)(SLIPPAGE.find((s) => s.bps === Number(e.target.value))!)}
          >
            {SLIPPAGE.map((s) => (
              <option key={s.bps} value={s.bps}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      {touchesStock ? <p className="crt__amber">{RESTRICTED_TEXT}</p> : null}
      {started || (received !== null && review !== null) ? (
        <div ref={statusRef} className="stack tx__result">
          <TxStepList states={steps.states} label="Swap progress" />
          {received === null || review === null ? null : received.amount === null ? (
            <p className="tx__warn">
              Confirmed, but what arrived could not be measured here — check your {review.buy.symbol} balance on Basescan.
            </p>
          ) : (
            <p className={received.amount >= review.quote.min ? "tx__ok" : "tx__bad"}>
              Received {formatAmount(received.amount < 0n ? 0n : received.amount, review.buy.decimals)} {review.buy.symbol} — the quoted
              minimum was {formatAmount(review.quote.min, review.buy.decimals)}.
            </p>
          )}
        </div>
      ) : null}
      {error ? (
        <Crt label="Swap error">
          <span className="crt__amber">{error}</span>
        </Crt>
      ) : null}
      {noRouteToken !== null ? (
        <div className="notes__row swap__fallback">
          <span>Relay has no route for this launchpad coin yet.</span>
          {openWindow ? (
            <Gel className="gel--quiet" onClick={() => openWindow("coins", { t: noRouteToken })}>
              Trade through its pool
            </Gel>
          ) : null}
        </div>
      ) : null}
      {review === null ? (
        <Gel className="mf__cta" onClick={() => void onReview()} disabled={blocker !== null || reading}>
          {reading ? "Quoting…" : (blocker ?? "Get a quote")}
        </Gel>
      ) : (
        <>
          <ReportView report={report(review, review.balance, slippage.label)} />
          <Gel className={started ? "mf__cta mf__cta--static" : "mf__cta"} onClick={() => void onSwap()} disabled={review.short || steps.running || started}>
            {review.short ? `Not enough ${review.sell.symbol}` : started ? "Swapped — edit a field to swap again" : "Swap in wallet"}
          </Gel>
        </>
      )}
    </div>
  );
}
