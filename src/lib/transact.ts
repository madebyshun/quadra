import { readWallet, type Eip1193Provider } from "@/lib/wallet";
import { quantity, rpc, RpcRefusal } from "@/skills/http";

/**
 * Handing a transaction to the user's wallet, and watching what the chain did with it.
 *
 * ── The line this module sits on ──────────────────────────────────────────────────
 * It ASKS the wallet to send (`eth_sendTransaction`) — the wallet shows the user the
 * destination, the value and the data, and the user decides. It never signs, never holds a
 * key, never broadcasts raw bytes (hard rule 5), and `tests/transact.test.ts` reads this
 * source to keep it that way. `lib/wallet.ts` keeps its own, stricter ban: connecting and
 * sending live in different files so each boundary can be checked on its own.
 *
 * ── Re-measured at the moment of sending ──────────────────────────────────────────
 * A panel reviews a transaction against the account on screen, and the user may switch
 * accounts or networks in the wallet between the review and the click. So `sendTransaction`
 * reads the wallet again first and refuses unless it is still `ready` on Base with the SAME
 * account — a transfer reviewed as "from A" must never go out from B.
 *
 * ── Tried before it is sent ───────────────────────────────────────────────────────
 * Every transaction is run once as an `eth_call` from the user's address first — what
 * docs.base.org does before every write it shows. A transaction the chain already refuses (a
 * paused B20 stock, a policy that blocks the buyer, an allowance that is not there) is
 * stopped here with the chain's own reason, before the wallet asks for a signature and a gas
 * fee. A revert is asked about again before it is believed: the node answering may be a block
 * behind the approval that just confirmed. A node that cannot answer at all is NOT a refusal —
 * the wallet estimates the transaction itself — so an outage never blocks a send.
 *
 * ── A hash is not a confirmation ─────────────────────────────────────────────────
 * The hash comes back when the wallet has broadcast, not when the chain has included it,
 * and an included transaction can still revert. `waitForReceipt` polls the receipt and
 * reports `success` or `reverted`; when it gives up it says "still pending", never "failed"
 * — a slow transaction is not a failed one, and telling someone it failed invites them to
 * send the money twice.
 */

export type TxRequest = {
  readonly to: string;
  readonly data?: `0x${string}`;
  /** wei; omitted means zero */
  readonly value?: bigint;
};

/** EIP-1193: the user rejected the request. */
const USER_REJECTED = 4001;

const HASH = /^0x[0-9a-fA-F]{64}$/;

function rejectedByUser(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code: unknown = (err as { code?: unknown }).code;
  return code === USER_REJECTED || code === String(USER_REJECTED);
}

/** How many times a simulated revert is asked about before it is believed. */
export const SIMULATE_TRIES = 3;

/**
 * Run `tx` as an `eth_call` from `from`. `null` when it would go through — or when no node could
 * say; the chain's refusal, in its own words, when it would not.
 */
export async function simulate(from: string, tx: TxRequest, options: WaitOptions = {}): Promise<string | null> {
  const { every = 1_000, sleep = nap } = options;
  const call = { from, to: tx.to, value: `0x${(tx.value ?? 0n).toString(16)}`, ...(tx.data ? { data: tx.data } : {}) };
  let said = "";
  for (let attempt = 1; attempt <= SIMULATE_TRIES; attempt++) {
    try {
      await rpc("eth_call", [call, "latest"]);
      return null;
    } catch (e) {
      if (!(e instanceof RpcRefusal)) return null;
      said = e.said;
      if (attempt < SIMULATE_TRIES) await sleep(every);
    }
  }
  return said;
}

/** Send one transaction through the wallet, from `from`, on Base. Resolves with its hash. */
export async function sendTransaction(provider: Eip1193Provider, from: string, tx: TxRequest, options: WaitOptions = {}): Promise<`0x${string}`> {
  const now = await readWallet(provider);
  if (now.kind !== "ready") throw new Error(`${now.why} Nothing was sent.`);
  if (now.account.toLowerCase() !== from.toLowerCase()) {
    throw new Error(
      `Your wallet is now on account ${now.account}, not ${from}, which this was reviewed for. Nothing was sent — review it again.`,
    );
  }
  const refused = await simulate(now.account, tx, options);
  if (refused !== null) {
    throw new Error(`Base would refuse this right now — tried without sending, the chain answered "${refused}". Nothing was sent.`);
  }
  let answer: unknown;
  try {
    answer = await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: now.account,
          to: tx.to,
          value: `0x${(tx.value ?? 0n).toString(16)}`,
          ...(tx.data ? { data: tx.data } : {}),
        },
      ],
    });
  } catch (err) {
    if (rejectedByUser(err)) throw new Error("You rejected it in your wallet. Nothing was sent.");
    const said = err instanceof Error && err.message !== "" ? ` (${err.message})` : "";
    throw new Error(`Your wallet did not send it${said}.`);
  }
  if (typeof answer !== "string" || !HASH.test(answer)) {
    throw new Error(
      `Your wallet answered ${JSON.stringify(answer)} instead of a transaction hash. Check the wallet's activity before trying again — it may have sent.`,
    );
  }
  return answer as `0x${string}`;
}

export type Log = { readonly address: string; readonly topics: readonly string[]; readonly data: string };

export type Receipt = {
  readonly status: "success" | "reverted";
  readonly block: bigint;
  readonly logs: readonly Log[];
  /**
   * What the sender paid for this transaction, in wei: L2 gas × effective price, plus Base's
   * L1 data fee (`l1Fee`, an OP-stack receipt field). `null` when the receipt does not say.
   */
  readonly fee: bigint | null;
};

function readLogs(value: unknown): Log[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((l: unknown) => {
    const log = l as { address?: unknown; topics?: unknown; data?: unknown } | null;
    if (log === null || typeof log !== "object") return [];
    if (typeof log.address !== "string" || typeof log.data !== "string" || !Array.isArray(log.topics)) return [];
    return [{ address: log.address, topics: log.topics.filter((t): t is string => typeof t === "string"), data: log.data }];
  });
}

/** A receipt from the RPC, or `null` while it has none (still pending). */
const HEX_QUANTITY = /^0x[0-9a-fA-F]+$/;
const optional = (v: unknown): bigint | null => (typeof v === "string" && HEX_QUANTITY.test(v) ? BigInt(v) : null);

export function parseReceipt(value: unknown): Receipt | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as { status?: unknown; blockNumber?: unknown; logs?: unknown; gasUsed?: unknown; effectiveGasPrice?: unknown; l1Fee?: unknown };
  const gas = optional(r.gasUsed);
  const price = optional(r.effectiveGasPrice);
  return {
    status: r.status === "0x1" ? "success" : "reverted",
    block: quantity(r.blockNumber, "the receipt's block number"),
    logs: readLogs(r.logs),
    fee: gas === null || price === null ? null : gas * price + (optional(r.l1Fee) ?? 0n),
  };
}

/** keccak256("Transfer(address,address,uint256)") — the ERC-20 Transfer event. */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * How much of `token` reached `to` in this transaction, read from its own Transfer events.
 *
 * MEASURED by the owner 2026-09-30: a Swap confirmed on chain was reported as "your USDC
 * balance rose by 0". The balance read raced the chain — the RPC answering `latest` was a node
 * one block behind the one that returned the receipt. The receipt's logs cannot race: they are
 * the transaction's own record of what moved.
 */
export function tokenReceived(receipt: Receipt, token: string, to: string): bigint {
  const topic = `0x${to.toLowerCase().slice(2).padStart(64, "0")}`;
  return receipt.logs
    .filter((l) => l.address.toLowerCase() === token.toLowerCase() && l.topics[0]?.toLowerCase() === TRANSFER_TOPIC && l.topics[2]?.toLowerCase() === topic)
    .reduce((sum, l) => sum + (HEX_QUANTITY.test(l.data) ? BigInt(l.data) : 0n), 0n);
}

/**
 * How much ETH reached `account` in this transaction: its balance AT the receipt's block minus
 * the block before, plus the fee it paid. Native ETH leaves no log, so this reads balances — but
 * pinned to those two blocks, never `latest`, so a lagging node errors instead of answering the
 * past; each read is tried a few times for exactly that case.
 *
 * `null` — "could not be measured", said as such — when the fee is unknown or a balance stays
 * unreadable. Never a thrown error: the swap has already confirmed by the time this runs, and a
 * failed measurement must not read as a failed swap.
 *
 * Only right when nothing else moved the account's ETH in that block; a second transaction from
 * the same account in the same block is counted in with it.
 */
export async function ethReceived(receipt: Receipt, account: string, options: WaitOptions = {}): Promise<bigint | null> {
  if (receipt.fee === null) return null;
  const { every = 1_000, sleep = nap } = options;
  const at = async (block: bigint): Promise<bigint | null> => {
    for (let attempt = 1; attempt <= BALANCE_TRIES; attempt++) {
      try {
        return quantity(await rpc("eth_getBalance", [account, `0x${block.toString(16)}`]), "the ETH balance");
      } catch {
        if (attempt < BALANCE_TRIES) await sleep(every);
      }
    }
    return null;
  };
  const after = await at(receipt.block);
  if (after === null) return null;
  const before = await at(receipt.block - 1n);
  if (before === null) return null;
  return after - before + receipt.fee;
}

/** How many times a balance at a past block is asked for before it counts as unreadable. */
export const BALANCE_TRIES = 5;

export type WaitOptions = {
  /** ms between polls — Base makes a block every two seconds */
  readonly every?: number;
  /** ms before giving up and reporting "still pending" */
  readonly within?: number;
  readonly sleep?: (ms: number) => Promise<void>;
};

const nap = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Poll for the receipt. `null` means it was still pending when `within` ran out — not failed. */
export async function waitForReceipt(hash: string, options: WaitOptions = {}): Promise<Receipt | null> {
  const { every = 2_000, within = 120_000, sleep = nap } = options;
  for (let waited = 0; waited <= within; waited += every) {
    const receipt = parseReceipt(await rpc("eth_getTransactionReceipt", [hash]));
    if (receipt !== null) return receipt;
    await sleep(every);
  }
  return null;
}
