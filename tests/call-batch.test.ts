import { describe, expect, it, vi } from "vitest";
import { atomicCapability, checkBatchWallet, getBatchStatus, sendAtomicBatch, simulateBatch } from "@/lib/callBatch";
import { BASE } from "@/config/chain";
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

  it("sends exactly one atomic request with a persisted ID, refusing an invalid acknowledgement", async () => {
    const p = wallet();
    await sendAtomicBatch(p, USER, txs, id);
    expect(p.request).toHaveBeenLastCalledWith({ method: "wallet_sendCalls", params: [{ version: "2.0.0", id, from: USER, chainId: BASE.idHex, atomicRequired: true, calls: [{ to: USER, value: "0x0" }, { to: USER, data: "0x1234", value: "0x1" }] }] });
    p.request.mockImplementation(async ({ method }) => method === "wallet_sendCalls" ? null : method === "eth_accounts" ? [USER] : BASE.idHex);
    await expect(sendAtomicBatch(p, USER, txs, id)).rejects.toThrow("acknowledge");
    p.request.mockImplementation(async ({ method }) => method === "wallet_sendCalls" ? { id: "other" } : method === "eth_accounts" ? [USER] : BASE.idHex);
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
