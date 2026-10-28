import { useRef, useState } from "react";
import { BASE, USDC } from "@/config/chain";
import { formatAmount } from "@/lib/amount";
import { whyNotSign, type PaymentRequirements } from "@/lib/requirements";
import {
  DEFAULT_LIMITS,
  loadSpend,
  parseLimits,
  resetSpend,
  saveSpend,
  signedInLastDay,
  whyNotSpend,
  type Limits,
  type SignedPayment,
} from "@/lib/spendGuard";
import { type Wallet } from "@/lib/wallet";
import { Gel } from "@/ui/Gel";

/**
 * The pieces both halves of the x402 window share: the directory half (a tool from a
 * catalog) and the any-URL half. Split out so the two cannot drift — two copies of "what
 * a paid run costs and who gets it" is two places to forget the payee line.
 */

const usdc = (v: bigint) => `${formatAmount(v, USDC.decimals)} ${USDC.symbol}`;

/**
 * The wallet's own state, shown only next to a paid quote — a free run never touches a
 * wallet at all, so this has nothing to say about one.
 *
 * `ready` prints the connected account and nothing else: it is the one state that
 * needs no button, because there is nothing left to ask for. Every other state carries
 * its own `why` (see `lib/wallet.ts`) and a single button whose action depends on which
 * state it is — `wrongChain` asks to switch, everything else asks to connect. Two
 * buttons that do different things would invite clicking the wrong one; there is only
 * ever one useful action from any one state.
 */
export function WalletStatus({ wallet, onConnect }: { wallet: Wallet; onConnect: () => void }) {
  if (wallet.kind === "ready") {
    return (
      <p className="dim">
        Wallet connected: <code>{wallet.account}</code>.
      </p>
    );
  }
  /*
    The sentence above its button, not beside it. Side by side in a `.group__row` the
    sentence was MEASURED 2026-09-29 squeezed into a column two words wide — the button
    kept its width and the explanation paid for it.
  */
  return (
    <>
      <p className="caution">{wallet.why}</p>
      <div className="row">
        <Gel onClick={onConnect}>{wallet.kind === "wrongChain" ? "Switch to Base" : "Connect wallet"}</Gel>
      </div>
    </>
  );
}

/**
 * What a paid run will cost, who receives it, and how long the signature stays
 * spendable.
 *
 * Every field here survived `checkRequirements`, which is why this component can
 * render them flatly with no hedging: the amount is exact base units, the asset's
 * decimals came from this repo's verified table rather than from the 402, and the
 * chain was refused unless it was `eip155:8453`. That last one is why the chain
 * prints as `BASE.name` and not as a string off the wire — the name is a
 * restatement of an assertion that passed, not config quietly overriding upstream.
 *
 * ── The window is on screen because it is the exposure ───────────────────────────
 * An EIP-3009 authorization is a bearer instrument: once signed, whoever holds it
 * can redeem it once, at any moment until `validBefore`. So the honest unit of
 * risk is not the amount alone, it is the amount multiplied by how long the slip
 * stays live. Hiding the window while showing the price would describe the smaller
 * half of what is being agreed to.
 *
 * ── An unrecognised payee is shown, not swallowed ────────────────────────────────
 * `whyNotSign`'s sentence is rendered in `.caution` rather than as an error: the quote
 * parsed, the price is real, and nothing failed — the payee just is not one this build
 * can vouch for. `passedOver` is said too, so "0.001 USDC" is not mistaken for the only
 * price the server offered.
 */
export function Requirements({ requirements }: { requirements: PaymentRequirements }) {
  const { payee, value, asset, lifetimeSeconds, passedOver } = requirements;
  const refusal = whyNotSign(requirements);
  return (
    <>
      <p className="dim">
        {formatAmount(value, asset.decimals)} {asset.symbol} on {BASE.name}, to{" "}
        <code>{payee.address}</code>. Charged only if the tool answers.
      </p>
      <p className="dim">
        {"The authorization it asks you to sign stays spendable for "}
        {`${lifetimeSeconds}`} seconds, then expires on its own.
        {passedOver > 0
          ? ` It also offered ${passedOver === 1 ? "one other way" : `${passedOver} other ways`} to pay that this build does not sign.`
          : ""}
      </p>
      {refusal ? <p className="caution">{refusal}</p> : null}
    </>
  );
}

/** The spending state the window holds: limits, what was signed, and why it cannot read them. */
export type Spending = {
  readonly limits: Limits;
  readonly ledger: readonly SignedPayment[];
  /** set when the stored record is unreadable — every paid run is refused while it is */
  readonly error: string | null;
  /** why a payment of `value` may not be signed now, or `null` */
  refusal(value: bigint): string | null;
  /**
   * Throws `refusal`'s sentence. Called on the signing path itself, so the limit is
   * enforced where the signature is made and not only by a disabled button — a button's
   * `disabled` is a rendering, and a limit that lived only there would be one attribute
   * away from not existing.
   */
  assertAllowed(value: bigint): void;
  /** note a signature. Throws when it cannot be stored — and then the caller must not send it */
  record(entry: Omit<SignedPayment, "at">): void;
  setLimits(limits: Limits): void;
  reset(): void;
};

type SpendState = { limits: Limits; ledger: SignedPayment[]; error: string | null };

function initialSpend(): SpendState {
  try {
    return { ...loadSpend(localStorage), error: null };
  } catch (e) {
    return { limits: DEFAULT_LIMITS, ledger: [], error: (e as Error).message };
  }
}

/**
 * The window's one spending record, read from this browser once.
 *
 * Held in a ref as well as in state because `record` runs in the middle of an async
 * payment: two payments in quick succession must each see the other's entry, and a
 * closure over the render-time state would let both pass a daily limit that only one fits.
 */
export function useSpending(): Spending {
  const [state, setState] = useState<SpendState>(initialSpend);
  const latest = useRef(state);
  const commit = (next: SpendState) => {
    latest.current = next;
    setState(next);
  };
  const refusal = (value: bigint) =>
    latest.current.error ?? whyNotSpend(latest.current.limits, latest.current.ledger, value, Date.now());

  return {
    ...state,
    refusal,
    assertAllowed: (value) => {
      const why = refusal(value);
      if (why !== null) throw new Error(`Nothing was signed. ${why}`);
    },
    record: (entry) => {
      const now = Date.now();
      const { limits, ledger } = latest.current;
      commit({ limits, ledger: saveSpend(localStorage, limits, [...ledger, { ...entry, at: now }], now), error: null });
    },
    setLimits: (limits) => {
      const now = Date.now();
      commit({ limits, ledger: saveSpend(localStorage, limits, latest.current.ledger, now), error: null });
    },
    reset: () => {
      resetSpend(localStorage);
      commit({ limits: DEFAULT_LIMITS, ledger: [], error: null });
    },
  };
}

/**
 * The user's limits, one line at rest, two fields when changing them.
 *
 * Shown next to a paid price only, like the wallet line — a free run spends nothing.
 * When the record is unreadable it says so and offers the reset, and nothing else: the
 * limits it would display are unknown, and printing the defaults would be a guess.
 */
export function SpendLimits({ spending }: { spending: Spending }) {
  const [editing, setEditing] = useState(false);
  const [perPayment, setPerPayment] = useState("");
  const [perDay, setPerDay] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  if (spending.error) {
    return (
      <div className="group__row">
        <p className="caution">{spending.error}</p>
        <Gel quiet onClick={spending.reset}>
          Reset the record
        </Gel>
      </div>
    );
  }

  const { limits, ledger } = spending;
  if (!editing) {
    return (
      <p className="dim">
        Your limits: {usdc(limits.perPayment)} per payment, {usdc(limits.perDay)} per 24 hours —{" "}
        {usdc(signedInLastDay(ledger, Date.now()))} signed in the last 24 hours.{" "}
        <button
          type="button"
          className="chip chip--mode"
          onClick={() => {
            setPerPayment(formatAmount(limits.perPayment, USDC.decimals));
            setPerDay(formatAmount(limits.perDay, USDC.decimals));
            setProblem(null);
            setEditing(true);
          }}
        >
          Change
        </button>
      </p>
    );
  }

  const save = () => {
    try {
      spending.setLimits(parseLimits(perPayment, perDay));
      setEditing(false);
    } catch (e) {
      setProblem((e as Error).message);
    }
  };

  return (
    <>
      <div className="group__row group__row--actions">
        <input
          className="field field--short"
          value={perPayment}
          onChange={(e) => setPerPayment(e.target.value)}
          aria-label="Limit per payment"
          inputMode="decimal"
        />
        <span className="group__unit">per payment</span>
        <input
          className="field field--short"
          value={perDay}
          onChange={(e) => setPerDay(e.target.value)}
          aria-label="Limit per day"
          inputMode="decimal"
        />
        <span className="group__unit">per 24 h</span>
        <Gel onClick={save}>Save</Gel>
        <Gel quiet onClick={() => setEditing(false)}>
          Cancel
        </Gel>
      </div>
      {problem ? <p className="caution">{problem}</p> : null}
    </>
  );
}
