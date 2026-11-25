import { BASE, USDC } from "@/config/chain";
import { readWallet, type Eip1193Provider } from "@/lib/wallet";
import { parseReceipt, type Receipt, type TxRequest } from "@/lib/transact";
import { rpc } from "@/skills/http";
import { parseSimulation } from "@/skills/simulate";

/** EIP-5792 v2: capability discovery is read-only; an absent/unknown answer never enables batching. */
export async function atomicCapability(provider: Eip1193Provider, account: string): Promise<"supported" | "ready" | "unsupported"> {
  try {
    const caps = await provider.request({ method: "wallet_getCapabilities", params: [account, [BASE.idHex]] }) as Record<string, { atomic?: { status?: string } }>;
    const status = caps[BASE.idHex]?.atomic?.status;
    return status === "supported" || status === "ready" ? status : "unsupported";
  } catch {
    return "unsupported";
  }
}

async function sameWallet(provider: Eip1193Provider, account: string): Promise<void> {
  const now = await readWallet(provider);
  if (now.kind !== "ready" || now.account.toLowerCase() !== account.toLowerCase()) {
    throw Object.assign(new Error("Your wallet account or network changed. Review the basket again. Nothing was sent."), { code: "BATCH_NOT_SENT" });
  }
}

/** Simulate the ordered approvals AND buys together: isolated eth_call would miss their dependencies. */
export async function simulateBatch(account: string, txs: readonly TxRequest[]): Promise<void> {
  const calls = txs.map((tx) => ({ from: account, to: tx.to, data: tx.data, value: `0x${(tx.value ?? 0n).toString(16)}` }));
  const result = parseSimulation(await rpc("eth_simulateV1", [{ blockStateCalls: [{ calls }], validation: false }, "latest"]));
  if (result.length !== calls.length) throw new Error("Base did not simulate the whole basket. Nothing was sent.");
  const failed = result.findIndex((r) => !r.ok);
  if (failed >= 0) throw new Error(`Basket call ${failed + 1} would revert: ${result[failed]!.reason}. Nothing was sent.`);
}

export async function checkBatchWallet(provider: Eip1193Provider, account: string): Promise<void> {
  await sameWallet(provider, account);
  if (await atomicCapability(provider, account) === "unsupported") throw new Error("This wallet cannot buy the basket atomically on Base. Use the step-by-step option.");
}

/** The caller persists id BEFORE this request. Returns the wallet-acknowledged batch ID (which may differ from the suggested id). */
export async function sendAtomicBatch(provider: Eip1193Provider, account: string, txs: readonly TxRequest[], id: string): Promise<string> {
  await sameWallet(provider, account);
  const answer = await provider.request({ method: "wallet_sendCalls", params: [{
    version: "2.0.0", id, from: account, chainId: BASE.idHex, atomicRequired: true,
    calls: txs.map((tx) => ({ to: tx.to, data: tx.data, value: `0x${(tx.value ?? 0n).toString(16)}` })),
  }] }) as string | { id?: string } | null;
  const returnedId = typeof answer === "string" ? answer : typeof answer?.id === "string" ? answer.id : "";
  if (!returnedId) throw new Error("The wallet did not acknowledge this batch ID. Check its activity before buying again.");
  return returnedId;
}

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** mainnet.base.org caps eth_getLogs at 2,000 blocks (MEASURED); 30 windows reach ~3.3 h back at 0.2 s blocks. */
const LOG_WINDOW = 2_000n;
const MAX_WINDOWS = 30;

/**
 * The chain's own answer when the wallet's is stuck. MEASURED 2026-11-25: MetaMask kept answering
 * `wallet_getCallsStatus` with 100 (pending) for a basket confirmed on Base minutes earlier (tx
 * 0xeaa94ad4…a358). The batch is ONE transaction from `account` whose USDC transfers out of the
 * account add up to exactly `usdcTotal`; only a successful receipt of such a transaction counts.
 * `null` = not found yet, never "failed".
 */
export async function findBatchOnChain(account: string, fromBlock: bigint, usdcTotal: bigint): Promise<Receipt | null> {
  const latest = BigInt(await rpc("eth_blockNumber", []) as string);
  const from = `0x${account.slice(2).toLowerCase().padStart(64, "0")}`;
  const sums = new Map<string, bigint>();
  let start = fromBlock;
  for (let i = 0; i < MAX_WINDOWS && start <= latest; i++) {
    const end = start + LOG_WINDOW - 1n < latest ? start + LOG_WINDOW - 1n : latest;
    const logs = await rpc("eth_getLogs", [{ address: USDC.address, topics: [TRANSFER, from], fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}` }]) as { transactionHash: string; data: string }[];
    for (const l of logs) sums.set(l.transactionHash, (sums.get(l.transactionHash) ?? 0n) + BigInt(l.data));
    start = end + 1n;
  }
  for (const [hash, sum] of sums) {
    if (sum !== usdcTotal) continue;
    const receipt = parseReceipt(await rpc("eth_getTransactionReceipt", [hash]));
    if (receipt?.status === "success") return receipt;
  }
  return null;
}

export type BatchStatus ={ readonly kind: "pending" } | { readonly kind: "failed" } | { readonly kind: "confirmed"; readonly receipts: readonly Receipt[] };

/** A missing/malformed answer or a partial execution is uncertain, never permission to charge again. */
export async function getBatchStatus(provider: Eip1193Provider, id: string): Promise<BatchStatus> {
  const r = await provider.request({ method: "wallet_getCallsStatus", params: [id] }) as { id: string; chainId: string; status: number; atomic: boolean; receipts?: unknown[] };
  if (r.id !== id || r.chainId !== BASE.idHex) throw new Error("The wallet returned a different batch or network.");
  if (r.status >= 100 && r.status < 200) return { kind: "pending" };
  if (r.status === 400 || r.status === 500) return { kind: "failed" };
  if (r.status !== 200 || r.atomic !== true || !Array.isArray(r.receipts) || r.receipts.length === 0) throw new Error("The wallet has not proved that the whole basket completed atomically.");
  const receipts = r.receipts.map(parseReceipt);
  if (receipts.some((receipt) => receipt === null || receipt.status !== "success")) throw new Error("The batch receipts do not confirm success.");
  return { kind: "confirmed", receipts: receipts as Receipt[] };
}
