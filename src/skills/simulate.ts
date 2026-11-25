import { askQuote, rawAmount } from "@/adapters/http/quotes";
import { BASE } from "@/config/chain";
import { RELAY } from "@/config/routes";
import { isObj, listOf, objAt, strOf } from "@/skills/json";
import { rpc } from "@/skills/http";
import { UNISWAP_V4 } from "@/config/uniswap";
import { approveData } from "@/lib/erc20";
import { buildSwap, minOutFor, permit2ApproveData, quoteV4, type LaunchPool } from "@/lib/v4swap";

/**
 * A real trade, run on Base without sending it: buy a token with ETH, then sell it all back —
 * the question every buyer is really asking, answered by the chain instead of guessed from code.
 *
 * MEASURED 2026-10-01, before a line of this was written: both public Base endpoints answer
 * `eth_simulateV1` with state overrides and `traceTransfers`, so an address holding nothing can be
 * given ETH for one simulated block and run the exact transactions a wallet would sign. The routes
 * are Relay's own quotes (the same router Swap uses), asked for that address. Measured outcomes:
 * DEGEN −0.74% and VIRTUAL −0.33% round trip; a token launched minutes earlier whose SELL reverted
 * ("arithmetic underflow") — a trap a code scanner can miss, because the code compiles fine.
 *
 * Nothing is signed and nothing is sent: `SIM_ACCOUNT` is an address nobody holds a key to, used
 * only inside the simulation. A pattern scanner (GoPlus) still runs beside this in the verdict;
 * the two answer different questions — what the code CAN do, and what a trade DOES today.
 */

/** No key exists for this address; it only ever appears inside a simulation. */
export const SIM_ACCOUNT = "0x5157000000000000000000000000000000005157";
/** A second keyless address, the receiver of the transfer test. */
export const PROBE_ACCOUNT = "0x5157000000000000000000000000000000000002";
/** What the simulated buyer spends: 0.01 ETH — big enough to move through real pools, small enough to quote anywhere. */
export const SIM_ETH_IN = 10n ** 16n;
const NATIVE = "0x0000000000000000000000000000000000000000";
/** How `traceTransfers` reports native ETH moving: as an ERC-20 Transfer from this pseudo-address (MEASURED). */
export const ETH_PSEUDO = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export type SimTx = { readonly to: string; readonly data: string; readonly value: bigint };

export type RoundTrip =
  | {
      readonly kind: "traded";
      readonly ethIn: bigint;
      /** what Relay's quote said the buy would deliver */
      readonly quoted: bigint;
      /** what the buy actually delivered in the simulation */
      readonly received: bigint;
      readonly ethBack: bigint;
      /** fraction of the ETH that did not come back — DEX fees, impact, and any tax */
      readonly loss: number;
      /** fraction of the quoted tokens that did not arrive — a buy tax or a fee-on-transfer */
      readonly shortfall: number;
      readonly transfer: Transfer;
    }
  | {
      readonly kind: "sell-reverted";
      readonly received: bigint;
      readonly reason: string;
      readonly transfer: Transfer;
      /** whether selling HALF went through when selling all did not — the "cannot sell all" trap */
      readonly halfSold: boolean | null;
    }
  | { readonly kind: "buy-reverted"; readonly reason: string }
  | { readonly kind: "no-route"; readonly side: "buy" | "sell"; readonly why: string };

/** Moving the token between two plain wallets: does it work, and does all of it arrive? */
export type Transfer = { readonly kind: "ok"; readonly arrived: number } | { readonly kind: "reverted"; readonly reason: string } | { readonly kind: "not-run" };

export type SimCall = { readonly ok: boolean; readonly reason: string; readonly logs: readonly { address: string; topics: string[]; data: string }[] };

/** Relay's steps as plain transactions, in order. */
export function stepsOf(body: unknown): SimTx[] {
  return listOf(objAt({ body }, "body").steps).flatMap((s) =>
    listOf(isObj(s) ? s.items : null).flatMap((i) => {
      const d = objAt(i, "data");
      const to = strOf(d.to);
      const data = strOf(d.data);
      return to && data ? [{ to, data, value: rawAmount(String(d.value ?? "0")) ?? 0n }] : [];
    }),
  );
}

/** Where a simulated trade gets its transactions: `sell` → `buy`, exactly `amount` in. */
export type Router = (sell: string, buy: string, amount: bigint) => Promise<{ steps: SimTx[]; out: bigint }>;

/** The slippage a simulated trade allows, as Relay is asked for: 5%. */
const SIM_SLIPPAGE_BPS = 500;
/** A deadline far enough out that the simulated block is always before it. */
const SIM_DEADLINE_S = 3600;

/**
 * A coin launched on this app's launchpad, traded through ITS OWN POOL — Uniswap's Quoter, then the
 * Universal Router, with the exact approvals (token → Permit2 → router) a wallet would sign. MEASURED
 * 2026-10-28: Relay answers "no routes found" for every v3 coin (a pool with a hook), so a verdict that
 * asked only Relay called this app's own coins untradable while they traded fine.
 */
export function poolRouter(pool: LaunchPool, now: () => number = Date.now): Router {
  return async (sell, _buy, amount) => {
    const zeroForOne = sell.toLowerCase() === pool.key.currency0.toLowerCase();
    const deadline = Math.floor(now() / 1000) + SIM_DEADLINE_S;
    if (sell.toLowerCase() === NATIVE) {
      const out = (await quoteV4(pool.key, zeroForOne, amount)).amountOut;
      return { steps: [buildSwap({ key: pool.key, zeroForOne, amountIn: amount, minOut: minOutFor(out, SIM_SLIPPAGE_BPS), deadline })], out };
    }
    // The sell is NOT quoted: a quote prices it against the pool as it is now, before the simulated buy put
    // any ETH in — MEASURED on a fresh launch, "could not fill" although the buy would pay for it. It runs
    // after the buy in the same simulated block with a floor of one wei, and what came back is measured.
    const swap = buildSwap({ key: pool.key, zeroForOne, amountIn: amount, minOut: 1n, deadline });
    const approvals: SimTx[] = [
      { to: sell, data: approveData(UNISWAP_V4.permit2, amount), value: 0n },
      { to: UNISWAP_V4.permit2, data: permit2ApproveData(sell, UNISWAP_V4.universalRouter, amount, deadline), value: 0n },
    ];
    return { steps: [...approvals, swap], out: 0n };
  };
}

async function relayQuote(sell: string, buy: string, amount: bigint): Promise<{ steps: SimTx[]; out: bigint }> {
  const body = await askQuote("Relay", `${RELAY.api}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user: SIM_ACCOUNT,
      recipient: SIM_ACCOUNT,
      originChainId: BASE.id,
      destinationChainId: BASE.id,
      originCurrency: sell,
      destinationCurrency: buy,
      amount: amount.toString(),
      tradeType: "EXACT_INPUT",
      slippageTolerance: "1500",
    }),
  });
  const steps = stepsOf(body);
  if (steps.length === 0) throw new Error("Relay: the quote carried no transaction.");
  return { steps, out: rawAmount(objAt(objAt(body, "details"), "currencyOut").amount) ?? 0n };
}

/** The simulated outcome of each call, in order. */
export function parseSimulation(result: unknown): SimCall[] {
  return listOf(objAt({ r: listOf(result)[0] }, "r").calls).map((c) => {
    const call = isObj(c) ? c : {};
    const error = objAt(call, "error");
    return {
      ok: call.status === "0x1",
      reason: strOf(error.message) ?? "reverted with no reason",
      logs: listOf(call.logs).flatMap((l) => {
        if (!isObj(l)) return [];
        const address = strOf(l.address);
        const data = strOf(l.data);
        const topics = listOf(l.topics).filter((t): t is string => typeof t === "string");
        return address && data !== null ? [{ address, topics, data }] : [];
      }),
    };
  });
}

/** Run `txs` from `SIM_ACCOUNT`, given 10 ETH for the block, with transfers traced. */
async function simulateAt(txs: readonly SimTx[], blockTag = "latest"): Promise<{ readonly calls: SimCall[]; readonly block: string | null }> {
  const calls = txs.map((t) => ({ from: SIM_ACCOUNT, to: t.to, data: t.data, value: `0x${t.value.toString(16)}` }));
  const payload = { blockStateCalls: [{ stateOverrides: { [SIM_ACCOUNT]: { balance: `0x${(10n ** 19n).toString(16)}` } }, calls }], traceTransfers: true };
  let result: unknown;
  try {
    result = await rpc("eth_simulateV1", [payload, blockTag]);
  } catch (e) {
    if (blockTag === "latest") throw e;
    result = await rpc("eth_simulateV1", [payload, "latest"]);
  }
  const parsed = parseSimulation(result);
  // an answer that does not account for every step is no simulation — never a trade that "went through"
  if (parsed.length !== calls.length) throw new Error(`Base simulated ${parsed.length} of ${calls.length} steps.`);
  const num = strOf((listOf(result)[0] as Record<string, unknown>).number);
  return { calls: parsed, block: num && /^0x[0-9a-fA-F]+$/.test(num) ? num : null };
}

export async function simulate(txs: readonly SimTx[], blockTag = "latest"): Promise<SimCall[]> {
  return (await simulateAt(txs, blockTag)).calls;
}

const pad = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;

/** How much of `asset` reached `to` across `calls` (native ETH as `ETH_PSEUDO`). */
export function arrived(calls: readonly SimCall[], asset: string, to: string): bigint {
  let sum = 0n;
  for (const c of calls) {
    for (const l of c.logs) {
      if (l.address.toLowerCase() === asset.toLowerCase() && l.topics[0] === TRANSFER_TOPIC && l.topics[2]?.toLowerCase() === pad(to) && /^0x[0-9a-fA-F]+$/.test(l.data)) {
        sum += BigInt(l.data);
      }
    }
  }
  return sum;
}

/** ERC-20 `transfer(to, amount)` calldata. */
export function transferData(to: string, amount: bigint): string {
  return `0xa9059cbb${to.slice(2).toLowerCase().padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`;
}

const failed = (calls: readonly SimCall[]) => calls.find((c) => !c.ok) ?? null;

/** The full round trip — buy, transfer test, sell — as the chain answers it right now. */
export async function roundTrip(token: string, route: Router = relayQuote): Promise<RoundTrip> {
  let buy: { steps: SimTx[]; out: bigint };
  try {
    buy = await route(NATIVE, token, SIM_ETH_IN);
  } catch (e) {
    return { kind: "no-route", side: "buy", why: (e as Error).message };
  }
  // Pin the exact block where buy ran so transfer and sell see the identical pool state (prevents 200ms Base block drift)
  const buySim = await simulateAt(buy.steps);
  const bought = buySim.calls;
  const pin = buySim.block ?? "latest";
  const buyFail = failed(bought);
  if (buyFail) return { kind: "buy-reverted", reason: buyFail.reason };
  const received = arrived(bought, token, SIM_ACCOUNT);

  // the transfer test: half the tokens to a second plain wallet
  const half = received / 2n;
  let transfer: Transfer = { kind: "not-run" };
  if (half > 0n) {
    const moved = await simulate([...buy.steps, { to: token, data: transferData(PROBE_ACCOUNT, half), value: 0n }], pin);
    const last = moved[moved.length - 1]!;
    transfer = last.ok ? { kind: "ok", arrived: Number(arrived([last], token, PROBE_ACCOUNT)) / Number(half) } : { kind: "reverted", reason: last.reason };
  }

  let sell: { steps: SimTx[]; out: bigint };
  try {
    sell = await route(token, NATIVE, received);
  } catch (e) {
    return { kind: "no-route", side: "sell", why: (e as Error).message };
  }
  const traded = await simulate([...buy.steps, ...sell.steps], pin);
  const sold = traded.slice(buy.steps.length);
  const sellFail = failed(sold);
  if (sellFail) {
    // selling all failed: does selling half? A token that lets part out and keeps the rest is a known trap
    let halfSold: boolean | null = null;
    try {
      const part = await route(token, NATIVE, received / 2n);
      halfSold = failed((await simulate([...buy.steps, ...part.steps], pin)).slice(buy.steps.length)) === null;
    } catch {
      halfSold = null;
    }
    return { kind: "sell-reverted", received, reason: sellFail.reason, transfer, halfSold };
  }
  const ethBack = arrived(sold, ETH_PSEUDO, SIM_ACCOUNT);
  return {
    kind: "traded",
    ethIn: SIM_ETH_IN,
    quoted: buy.out,
    received,
    ethBack,
    loss: 1 - Number(ethBack) / Number(SIM_ETH_IN),
    shortfall: buy.out > 0n ? 1 - Number(received) / Number(buy.out) : 0,
    transfer,
  };
}
