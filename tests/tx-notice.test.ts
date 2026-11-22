import { beforeEach, describe, expect, it } from "vitest";
import { clearTxNotices, dismissTxNotice, onTxNotices, pushTxNotice, type TxNotice } from "@/lib/txNotice";

describe("txNotice store", () => {
  beforeEach(() => {
    clearTxNotices();
  });

  it("updates an existing transaction notice in place as steps progress", () => {
    let latest: readonly TxNotice[] = [];
    const unsub = onTxNotices((items) => {
      latest = items;
    });

    pushTxNotice({ id: "tx-1", label: "Swap USDC to ETH", status: "wallet", step: 1, total: 2 });
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ id: "tx-1", status: "wallet", step: 1, total: 2 });

    pushTxNotice({ id: "tx-1", label: "Swap USDC to ETH", status: "pending", step: 1, total: 2, hash: "0xabc123" });
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ id: "tx-1", status: "pending", hash: "0xabc123" });

    pushTxNotice({ id: "tx-1", label: "Swap USDC to ETH", status: "confirmed", step: 2, total: 2, hash: "0xabc123", block: 100n });
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ id: "tx-1", status: "confirmed", block: 100n });

    dismissTxNotice("tx-1");
    expect(latest).toHaveLength(0);
    unsub();
  });

  it("keeps at most 3 recent transaction notices", () => {
    let latest: readonly TxNotice[] = [];
    const unsub = onTxNotices((items) => {
      latest = items;
    });

    for (let i = 1; i <= 4; i++) {
      pushTxNotice({ id: `tx-${i}`, label: `Tx ${i}`, status: "confirmed" });
    }
    expect(latest.map((n) => n.id)).toEqual(["tx-2", "tx-3", "tx-4"]);
    unsub();
  });
});
