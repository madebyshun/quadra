import { beforeEach, describe, expect, it, vi } from "vitest";
import { USDC } from "@/config/chain";
import { TRADE_CRYPTO } from "@/config/markets";
import { USER } from "./fixtures/routes";

/** TokenPicker's wallet list: ETH plus direct reads of the listed crypto and Coinbase's stocks, by value. */
const NVDA = "0xb2000000000000000000000000000000000000aa";
const h = vi.hoisted(() => ({ eth: 10n ** 17n as bigint | Error, price: 3000 as number | null, stocks: null as Map<string, unknown> | null, held: new Map<string, bigint | Error>() }));
vi.mock("@/skills/http", async (orig) => ({ ...(await orig<typeof import("@/skills/http")>()), rpc: vi.fn(async () => { if (h.eth instanceof Error) throw h.eth; return `0x${h.eth.toString(16)}`; }) }));
vi.mock("@/skills/dexscreener", async (orig) => ({ ...(await orig<typeof import("@/skills/dexscreener")>()), ethUsd: vi.fn(async () => h.price) }));
vi.mock("@/adapters/http/markets", () => ({ baseStocks: vi.fn(async () => { if (h.stocks === null) throw new Error("down"); return h.stocks; }) }));
vi.mock("@/lib/erc20", async (orig) => ({
  ...(await orig<typeof import("@/lib/erc20")>()),
  balanceOf: vi.fn(async (a: { address: string }) => { const v = h.held.get(a.address.toLowerCase()) ?? 0n; if (v instanceof Error) throw v; return v; }),
}));
const { loadFastWalletRows } = await import("@/features/panels/WalletAssets");

let n = 0;
const fresh = () => `0x${(++n).toString(16).padStart(40, "0")}`; // a new account each time: the cache is per account
beforeEach(() => {
  h.eth = 10n ** 17n;
  h.price = 3000;
  h.stocks = new Map([[NVDA, { address: NVDA, symbol: "NVDAc", name: "NVIDIA", decimals: 8, nav: 200, paused: [] }], ["x", { address: "0xb2000000000000000000000000000000000000bb", symbol: "OFFc", name: "Off", decimals: 8, nav: 1, paused: [0] }]]);
  h.held = new Map();
});

describe("loadFastWalletRows", () => {
  it("lists ETH, USDC and stocks held, largest value first, and leaves out what is not held or unpriced at zero", async () => {
    const other = TRADE_CRYPTO.find((c) => c.address.toLowerCase() !== USDC.address.toLowerCase())!;
    h.held = new Map<string, bigint | Error>([[USDC.address.toLowerCase(), 50_000_000n], [NVDA, 100_000_000n], [other.address.toLowerCase(), 10n ** BigInt(other.decimals)], ["0xb2000000000000000000000000000000000000bb", 5n]]);
    const rows = await loadFastWalletRows(fresh());
    expect(rows.map((r) => [r.symbol, r.value])).toEqual([["ETH", "$300.00"], ["NVDAc", "$200.00"], ["USDC", "$50.00"], [other.symbol, null]]);
  });

  it("answers from its cache for the same account, and keeps going when ETH, its price, the stock list or a balance cannot be read", async () => {
    const who = fresh();
    const first = loadFastWalletRows(who);
    expect(loadFastWalletRows(who.toUpperCase().replace("0X", "0x"))).toBe(first);
    h.price = null;
    h.stocks = null;
    h.held = new Map<string, bigint | Error>([[USDC.address.toLowerCase(), new Error("rpc down")]]);
    expect((await loadFastWalletRows(fresh())).map((r) => [r.symbol, r.value])).toEqual([["ETH", null]]);
    h.eth = new Error("rpc down");
    expect(await loadFastWalletRows(fresh())).toEqual([]);
    void USER;
  });
});
