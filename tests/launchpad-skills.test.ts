import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionResult, parseAbi } from "viem";
import { RELAY } from "@/config/routes";
import { BLOCKSCOUT } from "@/skills/blockscout";
import { chainToken } from "@/skills/chaintoken";
import {
  factories,
  LAUNCHED_TOPIC,
  launchedBetween,
  launchesBy,
  launchOf,
  launchpadOrigin,
  LOG_PAGES,
  parseLaunchLogs,
  pendingFees,
  poolValue,
  quotePerToken,
  slot0Of,
} from "@/skills/launchpad";
import { UNISWAP_V4_POOL_MANAGER, WETH } from "@/config/chain";
import { LAUNCHPAD_CODE, launchpadRows, marketRows, poolValueRows, stockQuote, tokenVerdict } from "@/skills/verdict";
import { row } from "@/skills/types";
import { copy, FX } from "./fixtures/base";
import { factoryCalls, LAUNCHPAD, LX, NO_LOGS, SLOT0_TEST_SLOT, V2_LOGS_URL } from "./fixtures/launchpad";
import { VX } from "./fixtures/verdict";
import { MARKETS_FX } from "./fixtures/markets";
import { toChecksumAddress } from "@/lib/address";
import { DOWN, json, net, useNet, type Answer } from "./net";

useNet();

/**
 * The launchpad as the skills read it — against the REAL deployed v1 factory's captured answers,
 * an hour after its first real launch, and the real v2 (deployed the same day, no launch on it yet).
 * A test can take either away; every test puts them back.
 */

const pinned = vi.hoisted(() => ({ v2: undefined as string | null | undefined, v1: undefined as string | null | undefined }));

vi.mock("@/config/chain", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/config/chain")>();
  const CONTRACTS = new Proxy(real.CONTRACTS, {
    get: (target, key) =>
      key === "launchFactory" && pinned.v2 !== undefined
        ? pinned.v2
        : key === "launchFactoryV1" && pinned.v1 !== undefined
          ? pinned.v1
          : target[key as keyof typeof target],
  });
  return { ...real, CONTRACTS };
});

const V2 = LAUNCHPAD.factoryV2;
afterEach(() => {
  pinned.v1 = undefined;
  pinned.v2 = undefined;
});
const ours = { [LAUNCHPAD.test.toLowerCase()]: LX.launchesTest };

describe("which factory", () => {
  it("is v2 first, then v1 — both deployed by the owner", () => {
    expect(factories()).toEqual([V2, LAUNCHPAD.factory]);
  });

  it("is v1 alone once v2 is taken out", () => {
    pinned.v2 = null;
    expect(factories()).toEqual([LAUNCHPAD.factory]);
  });

  it("asks nothing of a chain with no launchpad on it", async () => {
    pinned.v1 = null;
    pinned.v2 = null;
    net({});
    expect(await launchOf(LAUNCHPAD.test)).toBeNull();
    expect(await launchedBetween(1, 2)).toEqual(new Set());
    expect(await launchesBy(LAUNCHPAD.creator)).toEqual({ launches: [], complete: true });
  });
});

describe("one token", () => {
  it("names the event's topic exactly as the chain logged it", () => {
    expect(LAUNCHED_TOPIC).toBe(LX.launchedLogs.result[0]!.topics[0]);
  });

  it("is ours when the factory recorded a creator for it, and not when the record is empty", async () => {
    net({ rpc: factoryCalls(ours) });
    expect(await launchOf(LAUNCHPAD.test)).toEqual({ factory: LAUNCHPAD.factory, creator: LAUNCHPAD.creator, creatorRecipient: LAUNCHPAD.creator });
    expect(await launchOf("0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed")).toBeNull();
  });

  it("asks v2 first and falls through to v1, naming the factory that answered", async () => {
    const asked: string[] = [];
    net({
      rpc: (m, p) => {
        const to = (p[0] as { to?: string } | undefined)?.to;
        if (m === "eth_call" && to) asked.push(to);
        return to === V2 ? LX.launchesDegen : factoryCalls(ours)(m, p);
      },
    });
    expect((await launchOf(LAUNCHPAD.test))?.factory).toBe(LAUNCHPAD.factory);
    expect(asked).toEqual([V2, LAUNCHPAD.factory]);
  });

  /** MEASURED: one bot buy of 0.000002 ETH had left 19,994,859,999 wei of fees. */
  it("reads the fees waiting to be collected by running collect as a call", async () => {
    // `collect(address)` is 0x06ec16f8 (cast sig)
    net({ rpc: (m, p) => ((p[0] as { data?: string } | undefined)?.data?.startsWith("0x06ec16f8") ? LX.collectTest : factoryCalls(ours)(m, p)) });
    expect(await pendingFees(LAUNCHPAD.factory, LAUNCHPAD.test)).toEqual({ quote: "0x0000000000000000000000000000000000000000", inQuote: 19_994_859_999n, inToken: 0n });
  });

  it("splits the fees by the pool's order: a token sorted BELOW its quote is currency0", async () => {
    // the captured record, with the two currencies swapped as for a stock whose address sorts after the token
    const [creator, recipient, c0, c1, ...rest] = LX.launchesTest.slice(2).match(/.{64}/g)!;
    const swapped = `0x${[creator, recipient, c1, c0, ...rest].join("")}`;
    net({ rpc: (m, p) => ((p[0] as { data?: string } | undefined)?.data?.startsWith("0x06ec16f8") ? LX.collectTest : factoryCalls({ [LAUNCHPAD.test.toLowerCase()]: swapped })(m, p)) });
    expect(await pendingFees(LAUNCHPAD.factory, LAUNCHPAD.test)).toEqual({ quote: "0x0000000000000000000000000000000000000000", inQuote: 0n, inToken: 19_994_859_999n });
  });
});

describe("launches in a window, and by a creator", () => {
  it("finds the tokens the factory launched in a block range, one eth_getLogs", async () => {
    let asked: unknown;
    net({ rpc: (m, p) => (m === "eth_getLogs" ? ((asked = p[0]), [...LX.launchedLogs.result, "junk", { topics: [] }]) : undefined) });
    expect(await launchedBetween(52_066_273, 52_067_000)).toEqual(new Set([LAUNCHPAD.test.toLowerCase()]));
    expect(asked).toEqual({ address: [V2, LAUNCHPAD.factory], topics: [LAUNCHED_TOPIC], fromBlock: "0x31a77e1", toBlock: "0x31a7ab8" });
  });

  it("reads Blockscout's log index into launches, skipping what is not a launch", () => {
    const [real] = LX.blockscoutFactoryLogs.items;
    expect(parseLaunchLogs(LX.blockscoutFactoryLogs, LAUNCHPAD.factory)).toEqual({
      launches: [{ factory: LAUNCHPAD.factory, token: LAUNCHPAD.test, creator: LAUNCHPAD.creator, block: 52_066_747, at: new Date("2026-10-02T06:34:01.000Z"), tx: LAUNCHPAD.launchTx }],
      more: false,
    });
    const odd = [
      "junk",
      { ...real, topics: [`0x${"33".repeat(32)}`] },
      { ...real, topics: [LAUNCHED_TOPIC] },
      { ...real, block_number: "soon" },
      { ...real, block_timestamp: null, transaction_hash: null },
    ];
    const read = parseLaunchLogs({ items: odd, next_page_params: { block_number: 1 } }, LAUNCHPAD.factory);
    expect(read.more).toBe(true);
    expect(read.launches).toEqual([{ factory: LAUNCHPAD.factory, token: LAUNCHPAD.test, creator: LAUNCHPAD.creator, block: 52_066_747, at: null, tx: "" }]);
    expect(parseLaunchLogs(null, LAUNCHPAD.factory)).toEqual({ launches: [], more: false });
  });

  it("lists a creator's launches and nobody else's, following the index's pages up to a limit", async () => {
    const logs = `${BLOCKSCOUT}/addresses/${LAUNCHPAD.factory}/logs`;
    net({ get: (u) => (u === logs ? LX.blockscoutFactoryLogs : u === V2_LOGS_URL(BLOCKSCOUT) ? NO_LOGS : undefined) });
    expect((await launchesBy(LAUNCHPAD.creator)).launches.map((l) => l.token)).toEqual([LAUNCHPAD.test]);
    expect(await launchesBy("0x0000000000000000000000000000000000000001")).toEqual({ launches: [], complete: true });

    // an index that always has another page is read LOG_PAGES deep and said to be incomplete
    const paged = { ...copy(LX.blockscoutFactoryLogs), next_page_params: { block_number: 52066747, index: 8 } };
    const asked: string[] = [];
    net({ get: (u) => (u.startsWith(logs) ? (asked.push(u), paged) : u === V2_LOGS_URL(BLOCKSCOUT) ? NO_LOGS : undefined) });
    const read = await launchesBy(LAUNCHPAD.creator);
    expect(read.complete).toBe(false);
    expect(read.launches).toHaveLength(LOG_PAGES);
    expect(asked[1]).toBe(`${logs}?block_number=52066747&index=8`);
  });

  it("merges both factories' launches, newest first, and is complete only when both indexes are", async () => {
    const [real] = LX.blockscoutFactoryLogs.items;
    const newer = { ...real, block_number: 52_100_000, topics: [real!.topics[0], `0x${"0".repeat(24)}${"ab".repeat(20)}`, real!.topics[2], real!.topics[3]] };
    net({
      get: (u) =>
        u === `${BLOCKSCOUT}/addresses/${V2}/logs`
          ? { items: [newer], next_page_params: null }
          : u === `${BLOCKSCOUT}/addresses/${LAUNCHPAD.factory}/logs`
            ? LX.blockscoutFactoryLogs
            : undefined,
    });
    const read = await launchesBy(LAUNCHPAD.creator);
    expect(read.complete).toBe(true);
    expect(read.launches.map((l) => [l.factory, l.block])).toEqual([
      [V2, 52_100_000],
      [LAUNCHPAD.factory, 52_066_747],
    ]);
  });

  it("describes a launchpad token's origin from the factory: the creator, their wallet, their launches here", async () => {
    net({
      get: (u) =>
        u === `${BLOCKSCOUT}/addresses/${LAUNCHPAD.factory}/logs`
          ? LX.blockscoutFactoryLogs
          : u === V2_LOGS_URL(BLOCKSCOUT)
            ? NO_LOGS
            : // the creator's own history, stood in for by the captured page of another busy wallet
            u === `${BLOCKSCOUT}/addresses/${LAUNCHPAD.creator}/transactions`
            ? VX.txsDegenDeployer
            : undefined,
    });
    const o = await launchpadOrigin({ factory: LAUNCHPAD.factory, creator: LAUNCHPAD.creator, creatorRecipient: LAUNCHPAD.creator });
    expect(o.via).toEqual({ address: LAUNCHPAD.factory, name: "Quadra's launchpad" });
    expect(o.launcher).toMatchObject({ address: LAUNCHPAD.creator, factoryCalls: 1, callsComplete: true, complete: false });
  });
});

describe("a token's name from the chain", () => {
  const ERC20 = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)"]);
  /** MEASURED from the test token with cast: "test", "test", 18, 1e27. */
  const answers: Record<string, `0x${string}`> = {
    "0x06fdde03": encodeFunctionResult({ abi: ERC20, functionName: "name", result: "test" }),
    "0x95d89b41": encodeFunctionResult({ abi: ERC20, functionName: "symbol", result: "test" }),
    "0x313ce567": encodeFunctionResult({ abi: ERC20, functionName: "decimals", result: 18 }),
    "0x18160ddd": encodeFunctionResult({ abi: ERC20, functionName: "totalSupply", result: 10n ** 27n }),
  };
  const tokenReads = (m: string, p: readonly unknown[]): Answer | undefined => {
    const call = p[0] as { to: string; data: string } | undefined;
    return m === "eth_call" && call?.to.toLowerCase() === LAUNCHPAD.test.toLowerCase() ? answers[call.data] : undefined;
  };

  it("reads name, symbol, decimals and supply from the token when the indexer has none", async () => {
    net({ rpc: tokenReads });
    expect(await chainToken(LAUNCHPAD.test)).toEqual({
      address: LAUNCHPAD.test,
      name: "test",
      symbol: "test",
      decimals: 18,
      totalSupply: 10n ** 27n,
      holders: null,
      price: null,
      type: "ERC-20",
    });
  });

  it("gives a launchpad token's verdict the factory's facts instead of guesses", async () => {
    const T = LAUNCHPAD.test;
    net({
      rpc: (m, p) => poolManager(m, p) ?? factoryCalls(ours)(m, p) ?? tokenReads(m, p),
      post: (u) => (u === `${RELAY.api}/quote` ? json({ message: "No routes found" }, 400) : undefined),
      get: (u) =>
        ({
          // MEASURED: Blockscout had the minutes-old B20 with every field null
          [`${BLOCKSCOUT}/tokens/${T}`]: { address_hash: T, decimals: null, name: null, symbol: null },
          [`${BLOCKSCOUT}/tokens/${T}/holders`]: { items: [], next_page_params: null },
          [`https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${T}`]: FX.goplusUnknown,
          [`https://api.dexscreener.com/tokens/v1/base/${T}`]: DOWN,
          [`${BLOCKSCOUT}/addresses/${LAUNCHPAD.factory}/logs`]: LX.blockscoutFactoryLogs,
          [V2_LOGS_URL(BLOCKSCOUT)]: NO_LOGS,
          [ETH_MARKET]: DOWN,
          [`${BLOCKSCOUT}/addresses/${LAUNCHPAD.creator}/transactions`]: VX.txsDegenDeployer,
        })[u],
    });
    const report = await tokenVerdict(T, Date.parse("2026-10-02T07:30:00Z"));
    expect(report.title).toBe("test — Token Verdict");
    const by = (label: string) => report.rows.find((r) => r.label === label);
    expect(by("Launched on Quadra's launchpad")?.tone).toBe("ok");
    expect(by("Code")).toEqual(LAUNCHPAD_CODE);
    expect(report.rows.map((r) => r.label)).not.toContain("Honeypot pattern");
    expect(by("Launched by")?.value).toBe("0xD5C1…3FAB, through Quadra's launchpad");
    expect(by("Launcher's track record")?.value).toBe("1 launch through Quadra's launchpad");
    expect(by("Market cap (its own pool)")?.value).toMatch(/^4\.97 ETH for the whole supply/);
    expect(report.sources).toContain("Uniswap v4 (its pool, read directly)");
  });
});

/** The PoolManager answering `extsload` for the first launch's pool with the captured word. */
const poolManager = (m: string, p: readonly unknown[]): Answer | undefined => {
  const call = p[0] as { to?: string; data?: string } | undefined;
  if (m !== "eth_call" || call?.to?.toLowerCase() !== UNISWAP_V4_POOL_MANAGER.toLowerCase()) return undefined;
  return call.data!.endsWith(SLOT0_TEST_SLOT.slice(2)) ? LX.slot0Test : `0x${"0".repeat(64)}`;
};
const ETH_MARKET = `https://api.dexscreener.com/tokens/v1/base/${WETH.address}`;
/** One token's markets out of the captured Base page — a variant, built here: WETH at $2,670.91, AAPLc at $338.64. */
const marketsOf = (symbol: string) => (MARKETS_FX.dexBase as { baseToken: { symbol: string } }[]).filter((p) => p.baseToken.symbol === symbol);

describe("a launch's value, read from its own pool", () => {
  it("finds the pool's storage from its key — the slot the capture was read from", () => {
    const key = { currency0: "0x0000000000000000000000000000000000000000", currency1: LAUNCHPAD.test, fee: 10_000, tickSpacing: 200, hooks: "0x0000000000000000000000000000000000000000" };
    expect(slot0Of(key)).toBe(SLOT0_TEST_SLOT);
  });

  it("turns sqrtPriceX96 into whole quote units per token, in either orientation and any quote decimals", () => {
    const one = 2n ** 96n; // a raw price of exactly 1
    expect(quotePerToken(one, true, 18)).toBe(1);
    expect(quotePerToken(one, true, 8)).toBe(1e10);
    expect(quotePerToken(one * 2n, false, 18)).toBe(0.25);
  });

  /** MEASURED at block 52,070,604: the window's own launch, still at ≈ 4.97 ETH for the whole supply. */
  it("values the first launch at its pool's price, in ETH and in USD", async () => {
    net({ rpc: (m, p) => poolManager(m, p) ?? factoryCalls(ours)(m, p), get: (u) => (u === ETH_MARKET ? marketsOf("WETH") : undefined) });
    const v = await poolValue(LAUNCHPAD.factory, LAUNCHPAD.test);
    expect(v).toMatchObject({ quote: "0x0000000000000000000000000000000000000000", quoteSymbol: "ETH", quoteUsd: 2670.91 });
    expect(v.supplyInQuote).toBeCloseTo(4.974, 3);
  });

  it("refuses a pool that is not initialized, and keeps a quote price it could not read as null", async () => {
    net({ rpc: (m, p) => poolManager(m, p) ?? factoryCalls(ours)(m, p), get: (u) => (u === ETH_MARKET ? DOWN : undefined) });
    expect((await poolValue(LAUNCHPAD.factory, LAUNCHPAD.test)).quoteUsd).toBeNull();
    net({ rpc: (m, p) => (poolManager(m, p) ? `0x${"0".repeat(64)}` : factoryCalls(ours)(m, p)) });
    await expect(poolValue(LAUNCHPAD.factory, LAUNCHPAD.test)).rejects.toThrow("its pool is not initialized");
  });

  it("reads a stock quote's decimals, symbol and price — a stock-paired launch, from the AAPLc launch's record shape", async () => {
    // the captured record with Apple's stock token as the quote, a variant built here: the token's
    // address sorts below AAPLc's, so the token is currency0 — the orientation of the real AAPLc launch
    const AAPL = "0xb200000000000000000000c2e324d24d7eecd1fb";
    const words = LX.launchesTest.slice(2).match(/.{64}/g)!;
    words[2] = LAUNCHPAD.test.slice(2).toLowerCase().padStart(64, "0");
    words[3] = AAPL.slice(2).padStart(64, "0");
    const stockRecord = `0x${words.join("")}`;
    const erc20 = encodeFunctionResult;
    const ABI = parseAbi(["function decimals() view returns (uint8)", "function symbol() view returns (string)"]);
    net({
      rpc: (m, p) => {
        const call = p[0] as { to?: string; data?: string } | undefined;
        if (m === "eth_call" && call?.to?.toLowerCase() === AAPL) {
          return call.data === "0x313ce567" ? erc20({ abi: ABI, functionName: "decimals", result: 8 }) : erc20({ abi: ABI, functionName: "symbol", result: "AAPLc" });
        }
        if (m === "eth_call" && call?.to?.toLowerCase() === UNISWAP_V4_POOL_MANAGER.toLowerCase()) return LX.slot0Test;
        return factoryCalls({ [LAUNCHPAD.test.toLowerCase()]: stockRecord })(m, p);
      },
      get: (u) => (u === `https://api.dexscreener.com/tokens/v1/base/${toChecksumAddress(AAPL)}` ? marketsOf("AAPLc") : undefined),
    });
    const v = await poolValue(LAUNCHPAD.factory, LAUNCHPAD.test);
    expect(v).toMatchObject({ quote: toChecksumAddress(AAPL), quoteSymbol: "AAPLc", quoteUsd: 338.64 });
    // the stock's markets unreadable, or none: the value stands, its USD price is null
    for (const answer of [DOWN, []]) {
      net({
        rpc: (m, p) => {
          const call = p[0] as { to?: string; data?: string } | undefined;
          if (m === "eth_call" && call?.to?.toLowerCase() === AAPL) {
            return call.data === "0x313ce567" ? erc20({ abi: ABI, functionName: "decimals", result: 8 }) : erc20({ abi: ABI, functionName: "symbol", result: "AAPLc" });
          }
          if (m === "eth_call" && call?.to?.toLowerCase() === UNISWAP_V4_POOL_MANAGER.toLowerCase()) return LX.slot0Test;
          return factoryCalls({ [LAUNCHPAD.test.toLowerCase()]: stockRecord })(m, p);
        },
        get: (u) => (u === `https://api.dexscreener.com/tokens/v1/base/${toChecksumAddress(AAPL)}` ? answer : undefined),
      });
      expect((await poolValue(LAUNCHPAD.factory, LAUNCHPAD.test)).quoteUsd).toBeNull();
    }
    // a stock whose market cannot be read: the value is still said, in the stock
    net({
      rpc: (m, p) => {
        const call = p[0] as { to?: string; data?: string } | undefined;
        if (m === "eth_call" && call?.to?.toLowerCase() === AAPL) return DOWN;
        if (m === "eth_call" && call?.to?.toLowerCase() === UNISWAP_V4_POOL_MANAGER.toLowerCase()) return LX.slot0Test;
        return factoryCalls({ [LAUNCHPAD.test.toLowerCase()]: stockRecord })(m, p);
      },
    });
    await expect(poolValue(LAUNCHPAD.factory, LAUNCHPAD.test)).rejects.toThrow();
  });

  it("says the value as a row: in USD, in the quote alone, or not checked — and why a stock pair has no market", () => {
    const v = { quote: "0xb200000000000000000000C2e324d24d7eEcd1fb", quoteSymbol: "AAPLc", quoteDecimals: 8, supplyInQuote: 40.9, quoteUsd: 331.25 };
    expect(poolValueRows(null)).toEqual([]);
    expect(poolValueRows(undefined)).toEqual([row("Market cap (its own pool)", "not checked — its pool could not be read", { tone: "warn" })]);
    expect(poolValueRows(v)).toEqual([
      row("Market cap (its own pool)", "≈ $13,548.13 — $0.00001355 a token; 40.9 AAPLc for the whole supply at $331.25", { href: `https://basescan.org/token/${v.quote}` }),
    ]);
    expect(poolValueRows({ ...v, quoteSymbol: "ETH", supplyInQuote: 0.5 })[0]).not.toHaveProperty("href");
    expect(poolValueRows({ ...v, quoteUsd: null })[0]).toEqual(
      row("Market cap (its own pool)", "40.9 AAPLc for the whole supply — the AAPLc price in USD could not be read", { tone: "warn" }),
    );
    expect([stockQuote(v), stockQuote({ ...v, quoteSymbol: "ETH" }), stockQuote(null), stockQuote(undefined)]).toEqual(["AAPLc", null, null, null]);
    expect(marketRows([], 0, "AAPLc")[0]!.value).toBe(
      "no market found on Base — DexScreener lists a pool paired with AAPLc only after its first trade; the value above is read from the pool itself",
    );
  });
});

describe("the launchpad's rows", () => {
  it("say nothing about a token launched elsewhere, and say so when the factory could not be read", () => {
    expect(launchpadRows(null)).toEqual([]);
    expect(launchpadRows(undefined)).toEqual([row("Quadra launchpad", "not checked — the launchpad could not be read", { tone: "warn" })]);
  });
});
