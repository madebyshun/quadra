import type { ReactNode } from "react";
import type { Feature } from "@/features/registry";
import { FEATURES, isEnabled } from "@/features/registry";
import { Crt } from "@/ui/Crt";
import { SendPanel } from "@/features/panels/SendPanel";
import { InferencePanel } from "@/features/panels/InferencePanel";
import { X402Panel } from "@/features/panels/X402Panel";
import { HooksPanel } from "@/features/panels/HooksPanel";
import { McpPanel } from "@/features/panels/McpPanel";

/**
 * How each window explains itself before you touch anything. Second person,
 * no jargon, and it says what the thing actually does rather than what it is.
 */
const EXPLAIN: Record<Feature["id"], string> = {
  swap:
    "Trade any token at the best price. In private mode the pool trades for you, so your wallet is never on the trade.",
  inference:
    "Run an AI model on a GPU that nobody can look into, not even its owner. Pick a model, ask it something, pay per question. The answer comes with a proof it ran inside the chip.",
  router:
    "Point this at any paid endpoint. It reads the price the server asks for, pays it from your balance, and hands you back the answer.",
  send: "Pay any address. The pool pays them, so nothing on chain connects their address to yours.",
  mcp: "Plug all of this into your own AI agent. It runs on your computer, and your agent never holds your keys.",
  bridge: "Move what you hold out to another chain.",
  launch: "Put a coin out, and send its fees to any X account.",
  audit: "Point it at a GitHub repo and get a score with the reasons written out.",
  hooks:
    "A Uniswap v4 pool can carry a hook: code the pool runs around every swap. What a hook may do is written into its own address, so it can be read, not promised.",
  x402:
    "Any endpoint that answers 402 is asking to be paid. This pays it, in USDC, and shows you the receipt.",
};

/**
 * Which features are actually built. A feature absent from here renders the
 * not-built panel below, which says so outright — the alternative is a window
 * that looks finished because it has a text box in it.
 */
const BUILT: Partial<Record<Feature["id"], () => ReactNode>> = {
  send: () => <SendPanel />,
  inference: () => <InferencePanel />,
  x402: () => <X402Panel />,
  hooks: () => <HooksPanel />,
  mcp: () => <McpPanel />,
};

/**
 * What each switched-on-but-unbuilt window is actually waiting on.
 *
 * The notice used to read "switched on but not built yet" for all three, which is
 * true and close to useless. Three windows, three different missing pieces — and
 * two of them are waiting on the *same* piece as each other, which a reader can
 * act on and "not built" hides. Someone looking at an amber box cannot otherwise
 * tell a deliberate omission from a dependency nobody has got to, and those
 * warrant completely different reactions.
 *
 * Deliberately no price in here, for `audit` least of all. The tool it would call
 * is paid, and writing what it costs into this file is the stale-price bug the
 * x402 panel is built to avoid — the failure mode of a frozen price is agreeing
 * to the wrong amount. So this names the id and points at the window that quotes
 * it live, which stays true whatever upstream charges tomorrow.
 */
export const WAITING_ON: Readonly<Partial<Record<Feature["id"], string>>> = {
  swap:
    "a deployed pool. CONTRACTS.shieldedPool in src/config/chain.ts is null because nothing has been deployed and verified on Basescan, and this repo will not stand in a plausible-looking address to make a window render.",
  router:
    "wallet signing. Reading a server's price already works — the x402 window does it live — but paying one means signing a USDC authorization from your own wallet, and there is no signing code here yet.",
  audit:
    "wallet signing, the same piece the router is waiting on. The repo scorer it would call is `repo-health` upstream, which asks to be paid: open the x402 window to see the live price it is quoting today.",
};

/**
 * Switched on, and nothing behind it. The exact set of windows that render the
 * amber notice, so it is the set that has to explain itself.
 *
 * Derived from `FLAGS` and `BUILT` rather than typed out, because a hand-kept list
 * of "the unfinished ones" is wrong the day one gets finished — and wrong in the
 * flattering direction, still claiming an excuse for a window that works.
 */
export const UNBUILT: readonly Feature[] = FEATURES.filter((f) => isEnabled(f) && !BUILT[f.id]);

/**
 * The amber sentence, composed rather than written out, so that both halves are
 * reachable from a test.
 *
 * Same reason `apiLede` takes its endpoints and `assertDeployed` takes an address:
 * every switched-on-unbuilt feature names its blocker today, so a function reading
 * `WAITING_ON` directly could never reach its own no-reason branch — and that
 * branch is exactly what ships the day someone adds a feature and forgets. A test
 * asserts the omission cannot happen; this keeps the wording honest if it does.
 */
export function notBuiltNotice(title: string, waitingOn: string | undefined): string {
  const opening = `${title} is switched on but not built yet. There is nothing here to click, and nothing here will move money.`;
  return waitingOn ? `${opening} It is waiting on ${waitingOn}` : opening;
}

export function FeaturePanel({ feature }: { feature: Feature }) {
  const on = isEnabled(feature);
  const built = BUILT[feature.id];

  return (
    <div className="stack">
      <p className="panel__lede">{EXPLAIN[feature.id]}</p>

      {!on ? (
        <Crt label={`${feature.title} is off`}>
          <span className="crt__amber">
            {feature.title} is not switched on. Nothing here will move money.
          </span>
        </Crt>
      ) : built ? (
        built()
      ) : (
        <Crt label={`${feature.title} is not built yet`}>
          <span className="crt__amber">
            {notBuiltNotice(feature.title, WAITING_ON[feature.id])}
          </span>
        </Crt>
      )}
    </div>
  );
}
