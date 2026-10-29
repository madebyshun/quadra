import { decodeFunctionData, erc20Abi } from "viem";
import { BASE, CONTRACTS } from "@/config/chain";
import { FEE_BPS, NATIVE, RELAY, RELAY_PAIRS } from "@/config/routes";
import { sameAddress } from "@/lib/address";
import type { Asset } from "@/lib/erc20";
import type { TxRequest } from "@/lib/transact";
import { isObj, listOf, objAt, strOf } from "@/skills/json";
import { askQuote, rawAmount } from "@/adapters/http/quotes";

/**
 * Swap on Base through Relay — and the checks a quote passes before the wallet sees it.
 *
 * Chosen 2026-09-30 by measurement over KyberSwap, 0x, 1inch, Uniswap, Odos and LI.FI: no key,
 * browser CORS open, an exact-amount approval, a per-request app fee, and a live quote that
 * came back 200 (KyberSwap answers 403 to the owner's country; 0x/1inch/Uniswap need a key
 * their own docs say not to ship to a browser; LI.FI takes 0.25% on every swap).
 *
 * ── What is checked ──────────────────────────────────────────────────────────────
 * Every step is a plain transaction on Base from the connected wallet, to a PINNED contract
 * (`config/routes.ts`): the approval goes to the token being sold and approves Relay's
 * approval proxy for EXACTLY the amount sold — never more; the swap goes to that proxy
 * (token in) or Relay's router (ETH in, with exactly the amount as value). The quote must be
 * for the tokens asked for, and its minimum no larger than its estimate.
 *
 * ⚠️ What is NOT checked before signing: the minimum received is enforced inside Relay's
 * ~8 KB calldata, which this build does not decode. So the panel says so, and measures what
 * actually arrived afterwards against the quoted minimum.
 */

export type SwapRequest = {
  readonly user: string;
  readonly sell: Asset;
  readonly buy: Asset;
  /** base units of `sell` */
  readonly amount: bigint;
  readonly slippageBps: number;
};

export type SwapQuote = {
  readonly steps: readonly { readonly label: string; readonly tx: TxRequest }[];
  /** base units of `buy` */
  readonly out: bigint;
  readonly min: bigint;
  /** Relay's `totalImpact.percent`, as it sent it — e.g. "-0.11" */
  readonly impact: string | null;
  /** whether this product's fee is in this quote — only when a fee address is set */
  readonly feeOn: boolean;
};

/** Relay's refusal when it has not indexed or cannot fill a market. */
export function isRelayNoRoute(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /relay:\s+no routes? found?\.?$/i.test(message) || /relay:\s+no route\.?$/i.test(message);
}

const tokenOf = (a: Asset): string => (a.kind === "native" ? NATIVE : a.address);

function refuse(why: string): never {
  throw new Error(`This build will not sign Relay's quote: ${why} Nothing was sent.`);
}

type Item = { readonly id: string; readonly data: Record<string, unknown> };

/** The one Relay pair a quote's steps all belong to — fixed by its first step that names one. */
type Pair = (typeof RELAY_PAIRS)[number];

function checkStep(step: Item, req: SwapRequest, pair: { current: Pair | null }): { label: string; tx: TxRequest } {
  const d = step.data;
  if (d.chainId !== BASE.id) refuse(`a step is for chain ${String(d.chainId)}.`);
  if (typeof d.from !== "string" || !sameAddress(d.from, req.user)) refuse("a step is sent from a different wallet.");
  const to = typeof d.to === "string" ? d.to : refuse("a step has no destination.");
  const data = typeof d.data === "string" && /^0x([0-9a-fA-F]{2})*$/.test(d.data) ? (d.data as `0x${string}`) : refuse("a step's calldata is not hex.");
  const value = rawAmount(d.value) ?? refuse("a step's value is not a whole number.");

  if (step.id === "approve") {
    if (req.sell.kind === "native" || !sameAddress(to, req.sell.address)) refuse("the approval is not on the token being sold.");
    let spender: string;
    let amount: bigint;
    try {
      const call = decodeFunctionData({ abi: erc20Abi, data });
      if (call.functionName !== "approve") throw new Error("not approve");
      [spender, amount] = call.args;
    } catch {
      return refuse("the approval step is not an ERC-20 approve.");
    }
    const p = RELAY_PAIRS.find((x) => sameAddress(spender, x.approvalProxy));
    if (!p) refuse(`the approval is for ${spender}, not Relay's verified approval proxy.`);
    pair.current = p!;
    if (amount !== req.amount) refuse(`the approval is for ${amount}, not exactly the ${req.amount} being sold.`);
    if (value !== 0n) refuse("the approval step sends ETH.");
    return { label: `Approve Relay to move exactly this much ${req.sell.symbol}`, tx: { to, data } };
  }

  const kind = req.sell.kind === "native" ? "router" : "approvalProxy";
  const allowed = pair.current ? [pair.current] : RELAY_PAIRS;
  const p = allowed.find((x) => sameAddress(to, x[kind]));
  if (!p) refuse(`the swap goes to ${to}, not Relay's verified contract ${allowed.map((x) => x[kind]).join(" or ")}.`);
  const expected = req.sell.kind === "native" ? req.amount : 0n;
  if (value !== expected) refuse(`the swap sends ${value} wei of ETH, not ${expected}.`);
  return { label: `Swap ${req.sell.symbol} for ${req.buy.symbol}`, tx: { to, data, value } };
}

/** Relay's answer, checked against the request. Throws a sentence naming the first problem. */
export function checkSwap(body: unknown, req: SwapRequest): SwapQuote {
  const items: Item[] = listOf(objAt({ body }, "body").steps).flatMap((s) => {
    const step = isObj(s) ? s : refuse("a step is not an object.");
    const id = strOf(step.id);
    if (id !== "approve" && id !== "swap") refuse(`it has a step called "${String(id)}", which a same-chain swap does not need.`);
    return listOf(step.items).map((i) => ({ id, data: objAt(i, "data") }));
  });
  if (!items.some((i) => i.id === "swap")) refuse("it has no swap step.");
  const pair: { current: Pair | null } = { current: null };
  const steps = items.map((i) => checkStep(i, req, pair));

  const details = objAt(body, "details");
  const into = objAt(details, "currencyIn");
  const outOf = objAt(details, "currencyOut");
  const bought = strOf(objAt(outOf, "currency").address);
  if (bought === null || !sameAddress(bought, tokenOf(req.buy))) refuse(`it is for ${String(bought)}, not the token asked for.`);
  if (rawAmount(into.amount) !== req.amount) refuse("it quotes a different amount in than was asked.");
  const out = rawAmount(outOf.amount) ?? refuse("it has no amount out.");
  const min = rawAmount(outOf.minimumAmount) ?? refuse("it has no minimum out.");
  if (min > out) refuse("its minimum is larger than its estimate.");
  return { steps, out, min, impact: strOf(objAt(details, "totalImpact").percent), feeOn: false };
}

/** Quote a swap. `treasury` is where this product's fee goes — `null` (today) means no fee. */
export async function quoteSwap(req: SwapRequest, treasury: string | null = CONTRACTS.treasury): Promise<SwapQuote> {
  if (sameAddress(tokenOf(req.sell), tokenOf(req.buy))) throw new Error("Pick two different tokens.");
  const body = await askQuote("Relay", `${RELAY.api}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user: req.user,
      recipient: req.user,
      originChainId: BASE.id,
      destinationChainId: BASE.id,
      originCurrency: tokenOf(req.sell),
      destinationCurrency: tokenOf(req.buy),
      amount: req.amount.toString(),
      tradeType: "EXACT_INPUT",
      slippageTolerance: String(req.slippageBps),
      ...(treasury ? { appFees: [{ recipient: treasury, fee: String(FEE_BPS) }] } : {}),
    }),
  });
  return { ...checkSwap(body, req), feeOn: treasury !== null };
}
