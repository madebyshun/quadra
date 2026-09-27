import type { Anchoring, Attestation, Settlement } from "@/adapters/types";
import { formatAmount } from "@/lib/amount";
import { BASE, USDC } from "@/config/chain";

/**
 * Where a fact came from, said in one line the user can act on.
 *
 * All three of these switch on `kind` and have no default case: when an on-chain
 * variant is added, the switch stops compiling instead of quietly rendering the
 * local wording over a real proof. That is the only reason these are components
 * rather than a string in each panel.
 */

export function Anchor({ anchoring }: { anchoring: Anchoring }) {
  switch (anchoring.kind) {
    case "onchain":
      return (
        <span className="crt__ok">
          {"On chain in block "}
          {anchoring.block}.{" "}
          <a
            href={`${BASE.explorer}/tx/${anchoring.txHash}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            See it on Basescan
          </a>
        </span>
      );
    case "local":
      return <span className="crt__amber">Not on chain: {anchoring.why}.</span>;
  }
}

export function Attested({ attestation }: { attestation: Attestation }) {
  switch (attestation.kind) {
    case "enclave":
      return (
        <span className="crt__ok">
          {"Attested "}
          {attestation.attestedAt}. Measurement <code>{attestation.measurement}</code> — check it
          against the build you expected.
        </span>
      );
    case "local-dev":
      return <span className="crt__amber">Not attested: {attestation.why}.</span>;
  }
}

/**
 * Whether money moved, and how much.
 *
 * `free` and `unsettled` both mean nothing was charged, and they are still
 * separate cases: one is the tool's price, the other is this build's limitation.
 * Collapsing them into "not paid" would tell a user their free call failed.
 */
export function Settled({ settlement }: { settlement: Settlement }) {
  switch (settlement.kind) {
    case "settled":
      return (
        <span className="crt__ok">
          {"Paid "}
          {formatAmount(settlement.amountBaseUnits, USDC.decimals)} {USDC.symbol} to{" "}
          {settlement.payTo}.{" "}
          <a
            href={`${BASE.explorer}/tx/${settlement.txHash}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            See the payment
          </a>
        </span>
      );
    case "free":
      return <span className="crt__ok">No charge: {settlement.why}.</span>;
    case "unsettled":
      return <span className="crt__amber">Not paid: {settlement.why}.</span>;
  }
}
