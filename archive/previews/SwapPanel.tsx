import { BASE, USDC, WETH } from "@/config/chain";
import { AmountField, Cta, FormRow } from "@/features/panels/MoneyForm";

/**
 * What Swap will look like, with nothing behind it and every control dead.
 *
 * Swap used to be built: it traded a USDC note for a tokenized-stock note at a stale
 * reference price, with a direction button to go back. That pair was removed on the
 * owner's call, and with it went the only price this window had — so the window went
 * back to "not built" rather than keep a trade with nothing on the other side.
 *
 * 🔴 The same contract as `BridgePanel`, whose header is the long version: NOT in
 * `BUILT`, so the amber notice still renders and renders first; no handlers at all,
 * which `AmountField`'s `inert` variant and `Cta`'s optional `onClick` enforce; and a
 * blocker on the button saying why it is dead.
 *
 * WETH is named on the To row because it is already in `config/chain.ts`, verified —
 * naming it invents nothing. What is missing is a PRICE, and the You-get row says so
 * rather than printing one: the only price this repo displays is a live quote, and a
 * number here would be exactly the frozen-price bug the x402 window exists to avoid.
 */

const NOT_YET = "No live price — see above";

export function SwapPanel() {
  return (
    <fieldset className="group" aria-label="Swap, not built">
      <legend>What this will look like</legend>
      <div className="mf">
        <FormRow label="From">
          {USDC.symbol} on {BASE.name}
        </FormRow>
        <FormRow label="To">
          {WETH.symbol} on {BASE.name}
        </FormRow>
        <AmountField label="Amount" unit={USDC.symbol} value="" ariaLabel="Amount to swap" inert />
        <FormRow label="You get">
          <span className="caution">no live price yet</span>
        </FormRow>
      </div>
      <Cta blocked={NOT_YET} label="Swap" />
      <p className="dim">
        Nothing on this form is connected to anything. It is here so you can see the shape the
        window will take, not so you can use it.
      </p>
    </fieldset>
  );
}
