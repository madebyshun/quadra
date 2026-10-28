import { BASE, USDC } from "@/config/chain";
import { AmountField, Cta, FormRow } from "@/features/panels/MoneyForm";

/**
 * What Bridge will look like, with nothing behind it and every control dead.
 *
 * 🔴 Read this before changing anything here. CLAUDE.md says of the switched-on
 * unbuilt windows: **"Do not make them look finished."** This file is as close to
 * that line as anything in the repo gets, so it is built to be unable to cross it:
 *
 * - It is NOT in `BUILT`. `FeaturePanel` still derives `UNBUILT` from `BUILT`, still
 *   renders the amber `notBuiltNotice` — with the blocker `WAITING_ON.bridge` names,
 *   a bridge protocol and a verified contract on Base — and renders this UNDER it.
 *   The notice is the first thing in the window and this is the second.
 * - There are no handlers AT ALL, and the types enforce it: `AmountField`'s `inert`
 *   variant has no `onChange` or `onPercent` in its shape and `Cta`'s `onClick` is
 *   optional, so this file cannot be given behaviour without changing those types
 *   first. That is deliberate — no-op handlers would have been functions that exist
 *   and can never run. There is no adapter call to make and nothing imported that
 *   could make one.
 * - The destination row reads "none configured" rather than naming a chain. Writing
 *   "Arbitrum" here would be inventing the answer to the exact question this window is
 *   blocked on, and a second chain in a form is indistinguishable from a second chain
 *   that works.
 * - The button is a `Cta` with a permanent blocker, which is the whole point of `Cta`:
 *   the reason it cannot be pressed IS its label, so a dead form says why it is dead
 *   in the one place a user is going to click.
 *
 * If a verified bridge contract ever lands in `config/`, this file does not become the
 * panel by deleting `disabled` — the flow has to be written. Deleting the `disabled`
 * props would produce a form that submits nothing and reports success by silence.
 */

const NOT_YET = "No bridge contract — see above";

export function BridgePanel() {
  return (
    <fieldset className="group" aria-label="Bridge, not built">
      <legend>What this will look like</legend>
      <div className="mf">
        <FormRow label="From">
          {USDC.symbol} on {BASE.name}
        </FormRow>
        <FormRow label="To">
          <span className="caution">none configured</span>
        </FormRow>
        <AmountField label="Amount" unit={USDC.symbol} value="" ariaLabel="Amount to bridge" inert />
      </div>
      <Cta blocked={NOT_YET} label="Bridge" />
      <p className="dim">
        Nothing on this form is connected to anything. It is here so you can see the shape the
        window will take, not so you can use it.
      </p>
    </fieldset>
  );
}
