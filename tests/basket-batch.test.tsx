import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBasketBatch, BATCH_KEY } from "@/features/panels/useBasketBatch";
import { atomicCapability, checkBatchWallet, getBatchStatus, sendAtomicBatch, simulateBatch } from "@/lib/callBatch";
import { USER } from "./fixtures/routes";

vi.mock("@/lib/callBatch", () => ({ atomicCapability: vi.fn(), checkBatchWallet: vi.fn(), getBatchStatus: vi.fn(), sendAtomicBatch: vi.fn(), simulateBatch: vi.fn() }));
const provider = () => ({ request: async () => null });
const prepare = vi.fn(async () => [{ to: USER }]);
const storeKey = `${BATCH_KEY}:${USER.toLowerCase()}`;
const mount = (account: string | null = USER) => renderHook(() => useBasketBatch(account, provider));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(atomicCapability).mockResolvedValue("supported");
  vi.mocked(checkBatchWallet).mockResolvedValue();
  vi.mocked(simulateBatch).mockResolvedValue();
  vi.mocked(sendAtomicBatch).mockResolvedValue();
  vi.mocked(getBatchStatus).mockResolvedValue({ kind: "pending" });
});

describe("basket batch lifecycle", () => {
  it("prepares, simulates and submits once; locks pending work until status confirms", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.capability).toBe("supported"));
    await act(async () => { await result.current.buy(prepare); });
    expect(prepare).toHaveBeenCalledOnce();
    expect(simulateBatch).toHaveBeenCalledOnce();
    expect(sendAtomicBatch).toHaveBeenCalledOnce();
    expect(localStorage.getItem(storeKey)).toBe(result.current.pending!.id);
    expect(result.current.message).toContain("still pending");
    await act(async () => { await result.current.buy(prepare); });
    expect(sendAtomicBatch).toHaveBeenCalledOnce();
    vi.mocked(getBatchStatus).mockResolvedValue({ kind: "confirmed", receipts: [] });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.complete).toBe(true);
    expect(result.current.receipts).toEqual([]);
    expect(localStorage.getItem(storeKey)).toBeNull();
    act(() => result.current.reset());
    expect(result.current.complete).toBe(false);
    expect(result.current.receipts).toBeNull();
  });

  it("restores a pending ID after reopening and keeps an uncertain/offline batch locked", async () => {
    localStorage.setItem(storeKey, "0xabc");
    const { result } = mount();
    expect(result.current.pending?.id).toBe("0xabc");
    vi.mocked(getBatchStatus).mockRejectedValue(Error("offline"));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.message).toContain("Do not buy again");
    expect(localStorage.getItem(storeKey)).toBe("0xabc");
    vi.mocked(getBatchStatus).mockResolvedValue({ kind: "failed" });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.pending).toBeNull();
    expect(result.current.message).toContain("No basket purchases");
  });

  it("handles immediate confirmation, rejection and uncertain submission without falling back", async () => {
    const { result } = mount();
    vi.mocked(getBatchStatus).mockResolvedValue({ kind: "confirmed", receipts: [] });
    await act(async () => { await result.current.buy(prepare); });
    expect(result.current.complete).toBe(true);
    act(() => result.current.reset());
    vi.mocked(sendAtomicBatch).mockRejectedValue({ code: 4001 });
    await act(async () => { await result.current.buy(prepare); });
    expect(result.current.message).toContain("You rejected");
    expect(result.current.pending).toBeNull();
    vi.mocked(sendAtomicBatch).mockRejectedValueOnce(Object.assign(Error("Account changed. Nothing was sent."), { code: "BATCH_NOT_SENT" }));
    await act(async () => { await result.current.buy(prepare); });
    expect(result.current.pending).toBeNull();
    expect(result.current.message).toContain("Account changed");
    for (const error of [Error("connection lost"), null]) {
      vi.mocked(sendAtomicBatch).mockRejectedValueOnce(error);
      await act(async () => { await result.current.buy(prepare); });
      expect(localStorage.getItem(storeKey)).not.toBeNull();
      vi.mocked(getBatchStatus).mockResolvedValue({ kind: "failed" });
      await act(async () => { await result.current.refresh(); });
    }
  });

  it("stops before the wallet when preparation/simulation/storage fails and ignores concurrent clicks", async () => {
    const { result } = mount();
    await act(async () => { await result.current.buy(async () => { throw Error("quote expired"); }); });
    expect(result.current.message).toBe("quote expired");
    expect(sendAtomicBatch).not.toHaveBeenCalled();
    const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("storage blocked"); });
    await act(async () => { await result.current.buy(prepare); });
    expect(result.current.message).toBe("storage blocked");
    expect(sendAtomicBatch).not.toHaveBeenCalled();
    blocked.mockRestore();
    await act(async () => { await Promise.all([result.current.buy(prepare), result.current.buy(prepare)]); });
    expect(sendAtomicBatch).toHaveBeenCalledOnce();
  });

  it("waits for a connected account, cancels stale discovery and handles inaccessible storage", async () => {
    const disconnected = mount(null);
    expect(disconnected.result.current.capability).toBe("checking");
    disconnected.unmount();
    let resolve!: (value: "supported") => void;
    vi.mocked(atomicCapability).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const stale = mount();
    stale.unmount();
    await act(async () => { resolve("supported"); });
    const blocked = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw Error("blocked"); });
    const { result } = mount();
    expect(result.current.capability).toBe("unsupported");
    expect(result.current.message).toContain("storage is unavailable");
    blocked.mockRestore();
  });
  it("does not let an old wallet's status response unlock the new wallet's pending purchase", async () => {
    const other = `0x${"22".repeat(20)}`;
    localStorage.setItem(storeKey, "0xold");
    localStorage.setItem(`${BATCH_KEY}:${other}`, "0xnew");
    const hook = renderHook(({ account }) => useBasketBatch(account, provider), { initialProps: { account: USER } });
    for (const fail of [false, true]) {
      let settle!: () => void;
      vi.mocked(getBatchStatus).mockImplementationOnce(() => new Promise((resolve, reject) => {
        settle = () => fail ? reject(Error("old wallet offline")) : resolve({ kind: "confirmed", receipts: [] });
      }));
      let refreshing!: Promise<void>;
      act(() => { refreshing = hook.result.current.refresh(); });
      hook.rerender({ account: other });
      await act(async () => { settle(); await refreshing; });
      expect(hook.result.current.pending?.id).toBe("0xnew");
      expect(hook.result.current.complete).toBe(false);
      expect(hook.result.current.message).toBeNull();
      localStorage.setItem(storeKey, "0xold");
      hook.rerender({ account: USER });
      await act(async () => {});
    }
  });

  it("stops preparing for a provider that the user has replaced", async () => {
    const second = () => ({ request: async () => null });
    const hook = renderHook(({ wallet }) => useBasketBatch(USER, wallet), { initialProps: { wallet: provider } });
    let finish!: () => void;
    let buying!: Promise<void>;
    act(() => { buying = hook.result.current.buy(() => new Promise((resolve) => { finish = () => resolve([{ to: USER }]); })); });
    await waitFor(() => expect(finish).toBeDefined());
    hook.rerender({ wallet: second });
    await act(async () => { finish(); await buying; });
    expect(sendAtomicBatch).not.toHaveBeenCalled();
    expect(hook.result.current.message).toBeNull();
  });

  it("does not clear the current wallet's pending batch when the previous wallet rejects", async () => {
    const other = `0x${"22".repeat(20)}`;
    localStorage.setItem(`${BATCH_KEY}:${other}`, "0xnew");
    let reject!: () => void;
    vi.mocked(sendAtomicBatch).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = () => fail({ code: 4001 }); }));
    const hook = renderHook(({ account }) => useBasketBatch(account, provider), { initialProps: { account: USER } });
    let buying!: Promise<void>;
    act(() => { buying = hook.result.current.buy(prepare); });
    await waitFor(() => expect(reject).toBeDefined());
    hook.rerender({ account: other });
    await act(async () => { reject(); await buying; });
    expect(hook.result.current.pending?.id).toBe("0xnew");
  });

});
