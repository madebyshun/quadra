import { decodeFunctionData, pad } from "viem";
import { BASE, CONTRACTS, USDC, WETH } from "@/config/chain";
import { ACROSS, ACROSS_ABI, FEE_BPS, NATIVE, ROBINHOOD } from "@/config/routes";
import { sameAddress } from "@/lib/address";
import { approveData } from "@/lib/erc20";
import type { TxRequest } from "@/lib/transact";
import { isObj, strOf } from "@/skills/json";
import { askQuote, rawAmount } from "@/adapters/http/quotes";

/**
 * Bridge from Base to Robinhood Chain (4663) through Across — the calldata checked field by
 * field before the wallet is asked.
 *
 * Chosen 2026-09-30 by measurement: Across, Relay, LI.FI and deBridge all route Base → 4663;
 * Circle's CCTP does not (Robinhood Chain is not a CCTP domain, and has no USDC). Across had
 * the lowest measured fees, open CORS, no key needed today — and, decisively, its deposit
 * calldata STATES the terms: depositor, recipient, input and output token, amounts and the
 * destination chain are arguments of `deposit`/`depositNative`. Relay's deposit carries only
 * an order id, so its terms cannot be checked from the transaction. This one can, so it is.
 *
 * ── What is checked ──────────────────────────────────────────────────────────────
 * The transaction goes to Across's verified SpokePool (USDC) or SpokePoolPeriphery (ETH),
 * pinned in `config/routes.ts`; its calldata decodes with the verified ABI copied there, and
 * says: from this wallet, TO THIS SAME WALLET, the asked-for token and amount, on chain 4663,
 * delivering exactly the verified output token (USDG, or WETH/ETH) for at least the quoted
 * minimum, with an EMPTY message — a message makes the destination call a contract, which a
 * transfer never needs. ETH carries exactly the amount as value; USDC carries none.
 *
 * ⚠️ Across's own approval step is IGNORED: MEASURED, it approves the maximum uint256. The
 * panel reads the allowance itself and, when short, approves exactly the amount instead.
 * ⚠️ Across documents a Bearer key and an `integratorId` as required. MEASURED 2026-09-30
 * every call worked without either; if that is enforced later, the quote fails by name.
 */

export type BridgeAsset = "ETH" | "USDC";

export type BridgeRequest = { readonly user: string; readonly asset: BridgeAsset; readonly amount: bigint };

export type BridgeQuote = {
  readonly tx: TxRequest;
  /** the ERC-20 the SpokePool must be allowed to move, or `null` for ETH */
  readonly spend: { readonly token: string; readonly spender: string } | null;
  /** base units of what arrives on Robinhood Chain, at least */
  readonly min: bigint;
  /**
   * What arrives, as the person holds it. For ETH the calldata names WETH on 4663 and Across
   * pays a wallet (EOA) out in native ETH — the panel refuses to bridge ETH from a contract
   * wallet, where that is not the case.
   */
  readonly receive: { readonly symbol: string; readonly decimals: number; readonly address: string };
  /** seconds, as Across estimates */
  readonly fillSeconds: number | null;
  readonly expiresAt: Date | null;
  readonly feeOn: boolean;
};

const word = (address: string) => pad(address.toLowerCase() as `0x${string}`, { size: 32 });
const sameWord = (a: string, address: string) => a.toLowerCase() === word(address);

function refuse(why: string): never {
  throw new Error(`This build will not sign Across's quote: ${why} Nothing was sent.`);
}

/** Across's answer, checked field by field against the request. */
export function checkBridge(body: unknown, req: BridgeRequest): BridgeQuote {
  const b = isObj(body) ? body : refuse("it has no transaction.");
  const swap = isObj(b.swapTx) ? b.swapTx : refuse("it has no transaction.");
  if (swap.chainId !== BASE.id) refuse(`the transaction is for chain ${String(swap.chainId)}, not ${BASE.name}.`);
  const to = strOf(swap.to) ?? refuse("the transaction has no destination.");
  const data = typeof swap.data === "string" && /^0x([0-9a-fA-F]{2})*$/.test(swap.data) ? (swap.data as `0x${string}`) : refuse("its calldata is not hex.");
  const value = swap.value === undefined ? 0n : (rawAmount(swap.value) ?? refuse("its value is not a whole number."));
  const min = rawAmount(b.minOutputAmount) ?? refuse("it has no minimum output.");

  let call: ReturnType<typeof decodeFunctionData<typeof ACROSS_ABI>>;
  try {
    call = decodeFunctionData({ abi: ACROSS_ABI, data });
  } catch {
    return refuse("its calldata is not an Across deposit this build can read.");
  }
  const eth = req.asset === "ETH";
  const delivered = eth ? ROBINHOOD.weth.address : ROBINHOOD.usdg.address;

  if (eth) {
    if (call.functionName !== "depositNative") refuse("an ETH bridge must call depositNative.");
    if (!sameAddress(to, ACROSS.periphery)) refuse(`it goes to ${to}, not Across's verified SpokePoolPeriphery ${ACROSS.periphery}.`);
    const [spokePool, depositor, recipient, inputToken, inputAmount, outputToken, outputAmount, chain, , , , , message] = call.args;
    if (!sameAddress(spokePool, ACROSS.spokePool)) refuse("it names a different SpokePool.");
    if (!sameAddress(depositor, req.user)) refuse("it deposits for a different wallet.");
    if (!sameWord(recipient, req.user)) refuse("it pays out to a different address than yours.");
    if (!sameAddress(inputToken, WETH.address)) refuse("its input is not ETH.");
    if (inputAmount !== req.amount || value !== req.amount) refuse("it moves a different amount than was asked.");
    checkOut(outputToken, delivered, outputAmount, min, chain, message);
  } else {
    if (call.functionName !== "deposit") refuse("a USDC bridge must call deposit.");
    if (!sameAddress(to, ACROSS.spokePool)) refuse(`it goes to ${to}, not Across's verified SpokePool ${ACROSS.spokePool}.`);
    const [depositor, recipient, inputToken, outputToken, inputAmount, outputAmount, chain, , , , , message] = call.args;
    if (!sameWord(depositor, req.user)) refuse("it deposits for a different wallet.");
    if (!sameWord(recipient, req.user)) refuse("it pays out to a different address than yours.");
    if (!sameWord(inputToken, USDC.address)) refuse("its input is not USDC.");
    if (inputAmount !== req.amount) refuse("it moves a different amount than was asked.");
    if (value !== 0n) refuse("a USDC deposit must not send ETH.");
    checkOut(outputToken, delivered, outputAmount, min, chain, message);
  }

  const expiry = typeof b.quoteExpiryTimestamp === "number" ? new Date(b.quoteExpiryTimestamp * 1000) : null;
  const fill = typeof b.expectedFillTime === "number" ? b.expectedFillTime : null;
  return {
    tx: { to, data, value },
    spend: eth ? null : { token: USDC.address, spender: ACROSS.spokePool },
    min,
    receive: eth ? { symbol: "ETH", decimals: 18, address: NATIVE } : ROBINHOOD.usdg,
    fillSeconds: fill,
    expiresAt: expiry,
    feeOn: false,
  };
}

function checkOut(outputToken: string, expected: string, outputAmount: bigint, min: bigint, chain: bigint, message: string): void {
  if (chain !== BigInt(ROBINHOOD.id)) refuse(`it bridges to chain ${chain}, not ${ROBINHOOD.name} (${ROBINHOOD.id}).`);
  if (!sameWord(outputToken, expected)) refuse(`it delivers ${outputToken}, not the verified token ${expected} on ${ROBINHOOD.name}.`);
  if (outputAmount < min || outputAmount === 0n) refuse("it promises less than its own quoted minimum.");
  if (message !== "0x") refuse("it asks the destination to call a contract with a message, which a transfer never needs.");
}

/** The exact approval a USDC bridge needs — built here, never Across's unlimited one. */
export function exactApproval(quote: BridgeQuote, amount: bigint): TxRequest | null {
  return quote.spend ? { to: quote.spend.token, data: approveData(quote.spend.spender, amount) } : null;
}

/** Quote a bridge. `treasury` is where this product's fee goes — `null` (today) means no fee. */
export async function quoteBridge(req: BridgeRequest, treasury: string | null = CONTRACTS.treasury): Promise<BridgeQuote> {
  const eth = req.asset === "ETH";
  const params = new URLSearchParams({
    tradeType: "exactInput",
    amount: req.amount.toString(),
    inputToken: eth ? NATIVE : USDC.address,
    outputToken: eth ? NATIVE : ROBINHOOD.usdg.address,
    originChainId: String(BASE.id),
    destinationChainId: String(ROBINHOOD.id),
    depositor: req.user,
    recipient: req.user,
    ...(treasury ? { appFee: String(FEE_BPS / 10_000), appFeeRecipient: treasury } : {}),
  });
  const body = await askQuote("Across", `${ACROSS.api}/swap/approval?${params.toString()}`);
  return { ...checkBridge(body, req), feeOn: treasury !== null };
}
