import type { ReactNode } from "react";
import { Gel } from "@/ui/Gel";

/**
 * The parts every money form on this desktop is made of: a labelled row, a
 * large amount with percentage chips, and one full-width button.
 *
 * 🔴 The load-bearing idea is `Cta`, and it is not decoration. A disabled
 * button with a fixed label ("Send", greyed out) tells the user that something
 * is wrong and nothing about which of four fields it is; they click it, nothing
 * happens, and they guess. So the blocker IS the label. That also means the
 * blocker has to be computed as one value in the panel rather than as a pile of
 * `disabled={a || b || c}` expressions, which is the change that makes the
 * panels honest rather than merely tidier.
 *
 * What is deliberately NOT here: a blocker for anything the code can explain
 * better after the fact. A malformed recipient still goes through
 * `assertChecksummedAddress` on click and lands in the output window, because
 * that function's wording ("a name or a ticker never does") is the thing a user
 * needs, and a four-word button label cannot carry it. `Cta` blocks on *absence*
 * — no note, no amount, no recipient — and lets the checks that have something
 * to say do the talking.
 */

export function FormRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mf__row">
      <span className="mf__label">{label}</span>
      <span className="mf__value">{children}</span>
    </div>
  );
}

/** 100 is spelled out as a chip like the others; "Max" would be a fourth word for a third thing. */
export const PERCENTS = [25, 50, 100] as const;

export function PercentChips({
  onPick,
  disabled,
}: {
  onPick: (percent: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="mf__pcts">
      {PERCENTS.map((percent) => (
        <button
          key={percent}
          type="button"
          className="chip chip--pct"
          disabled={disabled}
          onClick={() => onPick(percent)}
        >
          {percent}%
        </button>
      ))}
    </div>
  );
}

/** The same chips with no handler at all, for a preview of a window that is not built. */
export function InertPercentChips() {
  return (
    <div className="mf__pcts">
      {PERCENTS.map((percent) => (
        <button key={percent} type="button" className="chip chip--pct" disabled>
          {percent}%
        </button>
      ))}
    </div>
  );
}

/**
 * `inert` is a discriminated union and not a `disabled?: boolean`, which is the
 * difference between "these handlers are ignored" and "there are no handlers".
 * A boolean would have `BridgePanel` — a window with nothing behind it — passing
 * `onChange={() => {}}` and `onPercent={() => {}}`: two functions that exist, can
 * never run, and sit against the 100% requirement forever. The union deletes them
 * from the type, so the inert form cannot be handed a handler by mistake either.
 */
type AmountFieldProps = {
  label: string;
  unit: string;
  value: string;
  ariaLabel: string;
} & (
  | { inert: true }
  | {
      inert?: false;
      onChange: (next: string) => void;
      onPercent: (percent: number) => void;
      percentDisabled: boolean;
    }
);

export function AmountField(props: AmountFieldProps) {
  const { label, unit, value, ariaLabel } = props;
  return (
    <div className="mf__row mf__row--amount">
      <div className="mf__head">
        <span className="mf__label">{label}</span>
        <span className="mf__label mono">{unit}</span>
      </div>
      {props.inert ? (
        <>
          <input
            className="mf__amount"
            value={value}
            aria-label={ariaLabel}
            placeholder="0.00"
            readOnly
            disabled
          />
          <InertPercentChips />
        </>
      ) : (
        <>
          <input
            className="mf__amount"
            value={value}
            onChange={(e) => props.onChange(e.target.value)}
            aria-label={ariaLabel}
            inputMode="decimal"
            placeholder="0.00"
          />
          <PercentChips onPick={props.onPercent} disabled={props.percentDisabled} />
        </>
      )}
    </div>
  );
}

/**
 * One full-width action. `blocked` is the reason it cannot run, and doubles as
 * the label; `label` is what it says when it can.
 *
 * `onClick` is optional for the same reason as `inert` above: a preview has no
 * handler to give, and a no-op passed to satisfy a required prop is a function
 * that can never be called.
 */
export function Cta({
  blocked,
  label,
  onClick,
}: {
  blocked: string | null;
  label: string;
  onClick?: () => void;
}) {
  return (
    <Gel className="mf__cta" disabled={blocked !== null} onClick={onClick}>
      {blocked ?? label}
    </Gel>
  );
}

/**
 * The fraction of `whole` a chip means, in base units, rounding DOWN.
 *
 * Down, and via bigint the whole way, for a reason that only shows up at 100%:
 * a percentage computed in floating point and formatted back can land one base
 * unit above the note, and the only symptom is that pressing 100% produces an
 * amount the pool then refuses as an overspend. `(whole * pct) / 100n` at 100
 * returns `whole` exactly, which is the case that has to be exact.
 */
export function fractionOf(whole: bigint, percent: number): bigint {
  return (whole * BigInt(percent)) / 100n;
}
