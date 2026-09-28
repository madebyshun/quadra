import type { Catalog, Quote, Tool, ToolField, ToolRun } from "@/adapters/types";
import { USDC } from "@/config/chain";
import { checkRequirements } from "@/lib/requirements";

/**
 * The upstream tool catalog, offline.
 *
 * ⚠️ This is no longer what the app runs. `adapters()` resolves `HttpCatalog`,
 * which reads the real 115 tools and their real prices — see the note there for
 * why the catalog resolves live while the pool does not. What survives here is the
 * offline implementation: it is what panel tests mount against, so a UI test never
 * depends on a network, and it is the one place that exercises a working `run`.
 *
 * It exists so the browsing, pricing and input-filling UI can be built and tested
 * with no network and no wallet — and, more importantly, so the RUN path has
 * something to return that cannot be mistaken for a paid result.
 *
 * Two things this deliberately does not do:
 *
 *   - It never returns `kind: "settled"`. Nothing is charged locally, so every
 *     run comes back `unsettled` (or `free`, for the ids that genuinely cost
 *     nothing). A stub that reported a txHash would make an unpaid run look paid.
 *   - It does not invent a `payTo`. The address below is BlueAgent's own
 *     published payee, asserted against in `config/upstream.ts`, not a
 *     placeholder shaped like an address.
 *
 * ── The list is copied, not invented ────────────────────────────────────────────
 * Six real ids, with the titles, prices and field names upstream returned on
 * 2026-09-27, chosen to cover every case the UI has to render: free, cheap,
 * expensive, no inputs, several inputs, an optional field, and two tools declaring
 * the same field name.
 *
 * It was invented before that, and every column was wrong in a way a test could not
 * see: ids upstream does not have (`honeypot`, whose live name is `honeypot-check`),
 * a price off by 2× on it, and input fields — `chain`, `address`, `repo` — that no
 * tool in the catalog declares. Panel tests typed into a form production never
 * renders, so they proved the form worked and nothing about the form users get.
 * A stub is a claim about upstream. Copy it; do not compose it.
 */

const WHY_LOCAL = "nothing was charged — this ran against the local stub, not the catalog";

/** The published payee, not a made-up one. Kept in sync with `BLUEAGENT.knownPayTo`. */
const PAY_TO = "0x02950ad38ada1d599375bd447e080cd404809205";

/**
 * Base mainnet, in the CAIP-2 form upstream actually uses.
 *
 * This said `"base"` until it was measured: every live 402 sends
 * `network: "eip155:8453"`. The short name reads fine and is not what any caller
 * will be handed, which is the only thing a stub is for.
 */
const NETWORK = "eip155:8453";

/**
 * The settlement window upstream asks for, copied like every other column here.
 *
 * Measured 2026-09-28: `maxTimeoutSeconds: 120` on every paid id. Not
 * `DEFAULT_AUTHORIZATION_SECONDS` — that constant is a fallback for callers with no
 * requirements to read, and a stub that used it would be quietly claiming upstream
 * asks for ten minutes when it asks for two.
 */
const SETTLEMENT_SECONDS = 120;

type LocalTool = Tool & { priceBaseUnits: bigint };

const need = (name: string): ToolField => ({ name, required: true });
const may = (name: string): ToolField => ({ name, required: false });

export const LOCAL_TOOLS: readonly LocalTool[] = [
  {
    id: "hood-live",
    title: "Blue Hood Live Board",
    summary: "Every tokenized stock Blue Hood is watching right now, on both live venues.",
    inputs: [may("chain")],
    priceBaseUnits: 0n,
  },
  {
    id: "gas-tracker",
    title: "Gas Tracker",
    summary: "Live Base gas price + USD cost estimates for common actions.",
    inputs: [],
    priceBaseUnits: 10_000n,
  },
  {
    id: "token-price",
    title: "Token Price",
    summary: "Live price, mcap, volume and liquidity for any Base token (DexScreener).",
    inputs: [need("token")],
    priceBaseUnits: 10_000n,
  },
  /**
   * Kept because it declares `token` too. Two tools sharing a field name is the case
   * that makes clearing the form on tool change load-bearing: without it a value typed
   * for one tool is silently submitted to the next, and the user pays for a run against
   * an argument they never typed into the form in front of them.
   */
  {
    id: "liquidity-depth",
    title: "Liquidity Depth",
    summary: "Liquidity depth, slippage estimate and exit risk for a Base token.",
    inputs: [need("token"), may("trade_size_usd")],
    priceBaseUnits: 30_000n,
  },
  {
    id: "competitor-scan",
    title: "Competitor Scan",
    summary: "Identify direct/indirect competitors and surface your defensible edge.",
    inputs: [need("project"), need("description"), may("competitors")],
    priceBaseUnits: 200_000n,
  },
  {
    id: "blue-audit",
    title: "Blue Audit",
    summary: "Security + product risk review. Reentrancy, oracle, MEV, x402. Go/no-go.",
    inputs: [need("prompt")],
    priceBaseUnits: 1_000_000n,
  },
] as const;

const BY_ID = new Map<string, LocalTool>(LOCAL_TOOLS.map((t) => [t.id, t]));

function find(toolId: string): LocalTool {
  const found = BY_ID.get(toolId);
  if (!found) {
    throw new Error(
      `No tool called "${toolId}". Available: ${LOCAL_TOOLS.map((t) => t.id).join(", ")}.`,
    );
  }
  return found;
}

/**
 * Free is a case, not a zero. See the `Price` type for why that distinction exists.
 *
 * 🔴 **The paid branch goes through `checkRequirements`, the same function that reads
 * production's 402.** Building a `PaymentRequirements` literal would have been shorter
 * and is exactly the drift this file's header forbids: a hand-built struct can hold a
 * scheme, a chain or a window the real checker would refuse, and then every panel test
 * passes against a price that could never have come off a live 402. Assembling
 * upstream's envelope and handing it to the checker makes the stub *provably* a shape
 * production could produce — if `PAY_TO`, `NETWORK` or the domain ever drift out of
 * agreement with `config/`, this throws in the test suite rather than in front of a
 * user.
 *
 * "A stub is a claim about upstream. Copy it; do not compose it" — the header of this
 * file, which until now composed four of the seven fields and dropped the other three.
 */
export function priceOf(tool: LocalTool): Quote["price"] {
  if (tool.priceBaseUnits === 0n) {
    return { kind: "free", why: "this tool answers without asking for payment" };
  }
  return {
    kind: "paid",
    requirements: checkRequirements(tool.id, {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: NETWORK,
          asset: USDC.address,
          amount: `${tool.priceBaseUnits}`,
          payTo: PAY_TO,
          maxTimeoutSeconds: SETTLEMENT_SECONDS,
          extra: USDC.eip712,
        },
      ],
    }),
  };
}

export class LocalCatalog implements Catalog {
  /** Never true here. Runs reach nothing and settle nothing. */
  readonly isLive = false;

  /** Every price is runnable here, free or paid. Runs reach nothing and settle nothing. */
  whyNot(): null {
    return null;
  }

  async tools(): Promise<Tool[]> {
    return LOCAL_TOOLS.map(({ id, title, summary, inputs }) => ({ id, title, summary, inputs }));
  }

  async quote(toolId: string): Promise<Quote> {
    const tool = find(toolId);
    return { toolId: tool.id, price: priceOf(tool) };
  }

  async run(toolId: string, input: Record<string, string>): Promise<ToolRun> {
    const tool = find(toolId);
    const missing = tool.inputs
      .filter((field) => field.required && !(input[field.name] ?? "").trim())
      .map((field) => field.name);
    if (missing.length > 0) {
      throw new Error(`${tool.title} needs ${missing.join(" and ")}.`);
    }

    const price = priceOf(tool);
    return {
      toolId: tool.id,
      output: [
        "[nothing ran]",
        "",
        `The local stub stood in for ${tool.id}. When the router is wired up this`,
        "is where the tool's own answer appears, with the transaction that paid",
        "for it printed underneath.",
        "",
        `What would have been sent: ${JSON.stringify(input)}`,
      ].join("\n"),
      settlement:
        price.kind === "free"
          ? { kind: "free", why: price.why }
          : { kind: "unsettled", why: WHY_LOCAL },
    };
  }
}
