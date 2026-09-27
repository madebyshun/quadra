import type { ReactNode } from "react";
import type { Feature } from "@/features/registry";
import { isEnabled } from "@/features/registry";
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
            {feature.title} is switched on but not built yet. There is nothing here to click, and
            nothing here will move money.
          </span>
        </Crt>
      )}
    </div>
  );
}
