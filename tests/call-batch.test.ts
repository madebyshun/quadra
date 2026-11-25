import { describe, expect, it, vi } from "vitest";
import { atomicCapability, checkBatchWallet, findBatchOnChain, getBatchStatus, sendAtomicBatch, simulateBatch } from "@/lib/callBatch";
import { BASE, USDC } from "@/config/chain";
import { USER } from "./fixtures/routes";
import { net, useNet } from "./net";
import type { Eip1193Provider } from "@/lib/wallet";

useNet();
const id = "0x1234";
const txs = [{ to: USER }, { to: USER, data: "0x1234" as const, value: 1n }];
const receipt = { status: "0x1", blockNumber: "0x2a", logs: [] };
function wallet(caps: unknown = { [BASE.idHex]: { atomic: { status: "supported" } } }) {
  return { request: vi.fn(async ({ method }: { method: string }): Promise<unknown> => {
    if (method === "eth_accounts") return [USER];
    if (method === "eth_chainId") return BASE.idHex;
    if (method === "wallet_getCapabilities") return caps;
    return { id };
  }) };
}

describe("atomic wallet calls", () => {
  it("discovers Base support, upgrade readiness and unsupported/unknown/unreadable wallets", async () => {
    await expect(atomicCapability(wallet(), USER)).resolves.toBe("supported");
    for (const [caps, expected] of [[{ [BASE.idHex]: { atomic: { status: "ready" } } }, "ready"], [{}, "unsupported"], [{ [BASE.idHex]: {} }, "unsupported"], [{ [BASE.idHex]: { atomic: { status: "unknown" } } }, "unsupported"], [null, "unsupported"]] as const) {
      await expect(atomicCapability(wallet(caps), USER)).resolves.toBe(expected);
    }
    await expect(atomicCapability({ request: async () => { throw Error("offline"); } }, USER)).resolves.toBe("unsupported");
    await expect(checkBatchWallet(wallet(), USER)).resolves.toBeUndefined();
    await expect(checkBatchWallet(wallet({}), USER)).rejects.toThrow("cannot buy");
  });

  it("refuses changed account or network, and simulates the whole ordered sequence", async () => {
    await expect(checkBatchWallet(wallet(), `0x${"11".repeat(20)}`)).rejects.toThrow("changed");
    const wrong = { request: async ({ method }: { method: string }) => method === "eth_accounts" ? [USER] : "0x1" };
    await expect(checkBatchWallet(wrong, USER)).rejects.toThrow("changed");
    const asked: unknown[][] = [];
    net({ rpc: (method, params) => {
      expect(method).toBe("eth_simulateV1");
      asked.push([...params]);
      return [{ calls: [{ status: "0x1" }, { status: "0x1" }] }];
    } });
    await expect(simulateBatch(USER, txs)).resolves.toBeUndefined();
    expect(asked[0]).toEqual([{ blockStateCalls: [{ calls: [{ from: USER, to: USER, value: "0x0" }, { from: USER, to: USER, data: "0x1234", value: "0x1" }] }], validation: false }, "latest"]);
    net({ rpc: () => [{ calls: [] }] });
    await expect(simulateBatch(USER, txs)).rejects.toThrow("whole basket");
    net({ rpc: () => [{ calls: [{ status: "0x1" }, { status: "0x0", error: { message: "paused" } }] }] });
    await expect(simulateBatch(USER, txs)).rejects.toThrow("call 2 would revert: paused");
  });

  it("sends exactly one atomic request with a persisted ID, returning the wallet-acknowledged ID and refusing empty replies", async () => {
    const p = wallet();
    await expect(sendAtomicBatch(p, USER, txs, id)).resolves.toBe(id);
    expect(p.request).toHaveBeenLastCalledWith({ method: "wallet_sendCalls", params: [{ version: "2.0.0", id, from: USER, chainId: BASE.idHex, atomicRequired: true, calls: [{ to: USER, value: "0x0" }, { to: USER, data: "0x1234", value: "0x1" }] }] });
    p.request.mockImplementation(async ({ method }) => method === "wallet_sendCalls" ? null : method === "eth_accounts" ? [USER] : BASE.idHex);
    await expect(sendAtomicBatch(p, USER, txs, id)).rejects.toThrow("acknowledge");
    p.request.mockImplementation(async ({ method }) => method === "wallet_sendCalls" ? { id: "wallet-assigned-id" } : method === "eth_accounts" ? [USER] : BASE.idHex);
    await expect(sendAtomicBatch(p, USER, txs, id)).resolves.toBe("wallet-assigned-id");
    p.request.mockImplementation(async ({ method }) => method === "wallet_sendCalls" ? "0xbare-string-id" : method === "eth_accounts" ? [USER] : BASE.idHex);
    await expect(sendAtomicBatch(p, USER, txs, id)).resolves.toBe("0xbare-string-id");
    p.request.mockImplementation(async ({ method }) => method === "wallet_sendCalls" ? { id: "" } : method === "eth_accounts" ? [USER] : BASE.idHex);
    await expect(sendAtomicBatch(p, USER, txs, id)).rejects.toThrow("acknowledge");
  });

  it("accepts only matching, atomic confirmed receipts, distinguishes pending and definite failures", async () => {
    const status = (patch: Record<string, unknown> = {}): Eip1193Provider => ({ request: async () => ({ id, chainId: BASE.idHex, status: 200, atomic: true, receipts: [receipt], ...patch }) });
    await expect(getBatchStatus(status(), id)).resolves.toMatchObject({ kind: "confirmed", receipts: [{ status: "success", block: 42n }] });
    for (const code of [100, 199]) await expect(getBatchStatus(status({ status: code }), id)).resolves.toEqual({ kind: "pending" });
    for (const code of [400, 500]) await expect(getBatchStatus(status({ status: code }), id)).resolves.toEqual({ kind: "failed" });
    for (const patch of [{ id: "other" }, { chainId: "0x1" }]) await expect(getBatchStatus(status(patch), id)).rejects.toThrow("different");
    for (const patch of [{ status: 600 }, { atomic: false }, { receipts: null }, { receipts: [] }]) await expect(getBatchStatus(status(patch), id)).rejects.toThrow("proved");
    for (const receipts of [[null], [{ ...receipt, status: "0x0" }]]) await expect(getBatchStatus(status({ receipts }), id)).rejects.toThrow("receipts");
  });
});

describe("the chain's answer when the wallet's status is stuck", () => {
  // MEASURED 2026-11-25: MetaMask answered status 100 for a basket confirmed minutes earlier.
  const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
  const log = (hash: string, amount: bigint) => ({ transactionHash: hash, data: word(amount), topics: [TRANSFER] });

  it("finds the one transaction whose USDC out adds up to the basket, across log windows, and only a successful one", async () => {
    const windows: [string, string][] = [];
    net({ rpc: (method, params) => {
      if (method === "eth_blockNumber") return "0xfa0"; // 4000: two windows from block 1, then a third
      if (method === "eth_getLogs") {
        const f = params[0] as { address: string; topics: string[]; fromBlock: string; toBlock: string };
        expect(f.address.toLowerCase()).toBe(USDC.address.toLowerCase());
        expect(f.topics[1]).toBe(`0x${USER.slice(2).toLowerCase().padStart(64, "0")}`);
        windows.push([f.fromBlock, f.toBlock]);
        // the basket's legs land in different windows; a reverted look-alike and an unrelated send sit beside them
        if (f.fromBlock === "0x1") return [log("0xaaa", 400_000n), log("0xbad", 1_000_000n), log("0xccc", 5n)];
        if (f.fromBlock === "0x7d1") return [log("0xaaa", 600_000n)];
        return [];
      }
      if (method === "eth_getTransactionReceipt") return params[0] === "0xbad" ? { ...receipt, status: "0x0" } : receipt;
      return undefined;
    } });
    const found = await findBatchOnChain(USER, 1n, 1_000_000n);
    expect(found?.status).toBe("success");
    expect(windows).toEqual([["0x1", "0x7d0"], ["0x7d1", "0xfa0"]]);
  });

  it("answers null, never failure, when nothing matches yet", async () => {
    net({ rpc: (method) => method === "eth_blockNumber" ? "0x10" : method === "eth_getLogs" ? [log("0xaaa", 7n)] : undefined });
    await expect(findBatchOnChain(USER, 1n, 1_000_000n)).resolves.toBeNull();
    net({ rpc: (method) => method === "eth_blockNumber" ? "0x10" : undefined });
    await expect(findBatchOnChain(USER, 0x20n, 1n)).resolves.toBeNull();
  });
});
