import { describe, expect, it } from "vitest";
import { decodeFunctionData, parseAbi, type Abi } from "viem";
import { UNISWAP_V4_POOL_MANAGER, USDC } from "@/config/chain";
import { TRANSFER_TOPIC } from "@/lib/transact";
import {
  BIN_MAX,
  BIN_MINUTES,
  LOG_CHUNK,
  MODIFY_LIQUIDITY_TOPIC,
  emptied,
  liquidities,
  liquiditySlot,
  parseEmptying,
  parseRemovals,
  recycleBin,
} from "@/skills/rugs";
import { RUGS, RUGS_LATEST } from "./fixtures/rugs";
import { contractAt, DOWN, net, RpcError, useNet, type Answer } from "./net";

useNet();

const EXTSLOAD = parseAbi(["function extsload(bytes32[] slots) view returns (bytes32[])"]);
const GETTERS = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);

const POOL = {
  based: "0x07fe05d6c737ae0ed44f735b5a748c3d22082aa7f161283d69d8967020af3e4f",
  dexsi: "0x2966b659853fcd1bda1ee144f53e39adf1dda5587d52d3e82b79b8ed6ded4385",
  xdpA: "0x1a3a5d1c0e7282cfe8be8344c280410c6ddbe0f5ee0e7b17bedd635882b70e9f",
  xdpB: "0x81e649abe0dd9b2208fec3cc40ff0ca5cb5b71b27d4ad75b5437419ded71cb83",
  kept: "0x6b07986078eb469033daa3c67bfc6719847b2b235826fed1f681ea057b785e36",
};
const TOKEN = {
  based: "0xb2000000000000000000002DF28FE1e36391efD5",
  dexsi: "0xB2000000000000000000001E1AC75af2158E8e45",
  xdp: "0x07b3D902783c3C12b077508c3B5c00113d1291D0",
};
const RECEIPTS: Record<string, unknown> = Object.fromEntries(
  [RUGS.receiptBased, RUGS.receiptDexsi, RUGS.receiptXdpA, RUGS.receiptXdpB].map((r) => [r.transactionHash, r]),
);

describe("the topic", () => {
  it("is what the PoolManager emits", () => {
    expect(MODIFY_LIQUIDITY_TOPIC).toBe(RUGS.logs[0]!.topics[0]);
  });
});

describe("parseRemovals", () => {
  const removals = parseRemovals(RUGS.logs);

  it("keeps the 12 pools that had something taken out, positive deltas skipped", () => {
    expect(removals).toHaveLength(12);
    expect(removals.map((r) => r.pool)).toContain(POOL.kept);
  });

  it("sums every removal in a pool and keeps the LAST one's transaction", () => {
    const xdpB = removals.find((r) => r.pool === POOL.xdpB)!;
    expect(xdpB.removed).toBe(233467898259893250902n);
    expect(xdpB.tx).toBe(RUGS.receiptXdpB.transactionHash);
    expect(xdpB.block).toBe(Number(RUGS.receiptXdpB.blockNumber));
  });

  it("skips what is not a log", () => {
    const good = RUGS.logs.find((l) => l.topics[1] === POOL.based && BigInt(`0x${l.data.slice(130, 194)}`) >= 1n << 255n)!;
    const broken = [
      null,
      "x",
      { ...good, topics: [good.topics[0]] },
      { ...good, data: "0x00" },
      { ...good, data: undefined },
      { ...good, transactionHash: undefined },
      { ...good, blockNumber: undefined },
      { ...good, topics: [good.topics[0], 7] },
    ];
    expect(parseRemovals(broken)).toEqual([]);
    expect(parseRemovals(undefined)).toEqual([]);
  });
});

describe("emptied", () => {
  it("is 90% or more taken, and never for nothing taken", () => {
    expect(emptied(9n, 1n)).toBe(true);
    expect(emptied(8n, 1n)).toBe(false);
    expect(emptied(5n, 0n)).toBe(true);
    expect(emptied(0n, 0n)).toBe(false);
  });
});

/** The PoolManager on the captured state: extsload answered only for the captured calldata. */
const manager = (data: `0x${string}`): Answer =>
  data === (RUGS.extsload.request.params[0] as { data: string }).data ? RUGS.extsload.response.result : undefined;

describe("liquiditySlot / liquidities — measured against the chain", () => {
  const pools = parseRemovals(RUGS.logs).map((r) => r.pool);

  it("asks for exactly the slots the captured request asked for", () => {
    const { args } = decodeFunctionData({ abi: EXTSLOAD, data: (RUGS.extsload.request.params[0] as { data: `0x${string}` }).data });
    expect(pools.map(liquiditySlot)).toEqual(args[0]);
  });

  it("reads what Uniswap's own StateView reads for the same pools", async () => {
    net({ rpc: (m, p) => (m === "eth_call" ? manager((p[0] as { data: `0x${string}` }).data) : undefined) });
    const now = await liquidities(pools);
    for (const [pool, word] of Object.entries(RUGS.stateView)) expect(now[pools.indexOf(pool)]).toBe(BigInt(word));
    expect(now[pools.indexOf(POOL.based)]).toBe(0n);
  });
});

describe("parseEmptying", () => {
  it("names the coin that left the PoolManager and who sent the transaction", () => {
    const found = parseEmptying(RUGS.receiptBased)!;
    expect(found.token).toBe(TOKEN.based);
    expect(found.by.toLowerCase()).toBe(RUGS.receiptBased.from);
    expect(found.by).not.toBe(RUGS.receiptBased.from); // checksummed
  });

  it("never takes a quote (USDC) for the coin", () => {
    // XDP is first in this receipt; without it, only USDC left the PoolManager
    const onlyQuote = { ...RUGS.receiptXdpA, logs: RUGS.receiptXdpA.logs.filter((l) => l.address !== TOKEN.xdp.toLowerCase()) };
    expect(onlyQuote.logs.some((l) => l.address === USDC.address.toLowerCase())).toBe(true);
    expect(parseEmptying(onlyQuote)).toBeNull();
  });

  it("is nothing without a sender, a receipt, or logs", () => {
    expect(parseEmptying({ ...RUGS.receiptBased, from: undefined })).toBeNull();
    expect(parseEmptying(null)).toBeNull();
    expect(parseEmptying({ from: RUGS.receiptBased.from })).toBeNull();
    expect(parseEmptying({ from: RUGS.receiptBased.from, logs: [null, { topics: [TRANSFER_TOPIC, `0x${UNISWAP_V4_POOL_MANAGER.slice(2).padStart(64, "0")}`] }] })).toBeNull();
  });
});

type Route = { logs?: (from: number, to: number) => Answer; receipt?: (tx: string) => Answer; eth?: (to: string, data: `0x${string}`) => Answer; dex?: Answer };

function chain(r: Route = {}) {
  const ranges: [number, number][] = [];
  const calls = net({
    rpc: (m, p) => {
      if (m === "eth_blockNumber") return `0x${RUGS_LATEST.toString(16)}`;
      if (m === "eth_getLogs") {
        const q = p[0] as { address: string; topics: string[]; fromBlock: string; toBlock: string };
        expect(q.address).toBe(UNISWAP_V4_POOL_MANAGER);
        expect(q.topics).toEqual([MODIFY_LIQUIDITY_TOPIC]);
        const a = Number(q.fromBlock);
        const b = Number(q.toBlock);
        ranges.push([a, b]);
        return r.logs ? r.logs(a, b) : RUGS.logs.filter((l) => Number(l.blockNumber) >= a && Number(l.blockNumber) <= b);
      }
      if (m === "eth_getTransactionReceipt") return r.receipt ? r.receipt(p[0] as string) : (RECEIPTS[p[0] as string] ?? DOWN);
      if (m === "eth_call") {
        const { to, data } = p[0] as { to: string; data: `0x${string}` };
        if (to === UNISWAP_V4_POOL_MANAGER) return manager(data);
        return r.eth?.(to, data);
      }
      return undefined;
    },
    get: (url) => (url.startsWith("https://api.dexscreener.com/tokens/v1/base/") ? (r.dex ?? RUGS.dexscreener) : undefined),
  });
  return { ranges, calls };
}

describe("recycleBin", () => {
  it("reads three hours in 1800-block pages, oldest first, under the RPC's cap", async () => {
    const { ranges } = chain();
    await recycleBin();
    const from = RUGS_LATEST - (BIN_MINUTES * 60) / 2;
    expect(ranges).toEqual([
      [from, from + LOG_CHUNK - 1],
      [from + LOG_CHUNK, from + 2 * LOG_CHUNK - 1],
      [from + 2 * LOG_CHUNK, from + 3 * LOG_CHUNK - 1],
      [from + 3 * LOG_CHUNK, RUGS_LATEST],
    ]);
    for (const [a, b] of ranges) expect(b - a + 1).toBeLessThanOrEqual(LOG_CHUNK);
  });

  it("lists each emptied coin once, the busiest market first, and counts what it could not read", async () => {
    const { calls } = chain();
    const bin = await recycleBin();
    expect(bin.latest).toBe(RUGS_LATEST);
    expect(bin.minutes).toBe(BIN_MINUTES);
    expect(bin.removals).toBe(12);
    // 10 of the 12 pools lost 90% or more; 4 receipts were captured, the other 6 answer as down
    expect(bin.unread).toBe(6);
    expect(calls.filter((c) => c.rpc === "eth_getTransactionReceipt").length).toBe(10 * 2 - 4);
    expect(bin.emptied.map((e) => [e.symbol, e.token, e.pool])).toEqual([
      ["DEXSI", TOKEN.dexsi, POOL.dexsi],
      ["BASED", TOKEN.based, POOL.based],
      ["XDP", TOKEN.xdp, POOL.xdpA],
    ]);
    const based = bin.emptied[1]!;
    expect(based.by.toLowerCase()).toBe(RUGS.receiptBased.from);
    expect(based.tx).toBe(RUGS.receiptBased.transactionHash);
    expect(based.minutesAgo).toBe(Math.round(((RUGS_LATEST - Number(RUGS.receiptBased.blockNumber)) * 2) / 60));
    expect(based.market?.symbol).toBe("BASED");
    // XDP's DexScreener pair is a different pool: named, but no market for THIS pool
    expect(bin.emptied[2]!.market).toBeNull();
  });

  it("is empty with nothing removed — and asks nothing more", async () => {
    const { calls } = chain({ logs: () => [] });
    expect(await recycleBin(10)).toEqual({ latest: RUGS_LATEST, minutes: 10, removals: 0, emptied: [], unread: 0 });
    expect(calls.map((c) => c.rpc)).toEqual(["eth_blockNumber", "eth_getLogs"]);
  });

  it("caps the coins looked up at BIN_MAX", async () => {
    const { calls } = chain({ receipt: () => null });
    const bin = await recycleBin();
    expect(bin.emptied).toEqual([]);
    expect(bin.unread).toBe(0);
    expect(calls.filter((c) => c.rpc === "eth_getTransactionReceipt").length).toBeLessThanOrEqual(BIN_MAX);
  });

  it("names a coin from the chain when DexScreener is down, and 'unnamed' when the chain will not say", async () => {
    chain({
      dex: DOWN,
      eth: (to, data) =>
        to.toLowerCase() === TOKEN.based.toLowerCase()
          ? contractAt(GETTERS as Abi, { name: "Based", symbol: "BASED", decimals: 18, totalSupply: 10n ** 27n })(data)
          : new RpcError("execution reverted"),
    });
    const bin = await recycleBin();
    const sym = Object.fromEntries(bin.emptied.map((e) => [e.token, e.symbol]));
    expect(sym[TOKEN.based]).toBe("BASED");
    expect(sym[TOKEN.dexsi]).toBe("unnamed");
    expect(bin.emptied.every((e) => e.market === null)).toBe(true);
  });

  it("does not trust a market with no pair, no symbol or no volume", async () => {
    const [based, dexsi] = RUGS.dexscreener as Record<string, unknown>[];
    chain({
      dex: [
        { ...based, volume: {} },
        { ...dexsi, pairAddress: undefined, baseToken: { address: TOKEN.dexsi, symbol: null } },
      ],
      eth: () => new RpcError("execution reverted"),
    });
    const bin = await recycleBin();
    const by = Object.fromEntries(bin.emptied.map((e) => [e.token, [e.symbol, e.market?.volume24h ?? null]]));
    // BASED's market matched its pool but has no volume; DEXSI's has no pair and no symbol, so it is named from the chain
    expect(by).toEqual({ [TOKEN.based]: ["BASED", null], [TOKEN.dexsi]: ["unnamed", null], [TOKEN.xdp]: ["unnamed", null] });
    expect(bin.emptied.find((e) => e.token === TOKEN.based)!.market).not.toBeNull();
  });
});
