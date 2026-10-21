import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionResult, erc20Abi, parseAbi } from "viem";
import { CONTRACTS } from "@/config/chain";
import { LAUNCHPAD_ABI, LAUNCHPAD_EXPECTS } from "@/config/launchpad";
import { forgetCatalog } from "@/adapters/http/markets";
import { STOCKS_PATH } from "@/server/stocks";
import { prepareLaunch, prepareLaunchSkill, stepRows } from "@/skills/prepare";
import { row } from "@/skills/types";
import { MARKETS_FX } from "./fixtures/markets";
import { DOWN, contractAt, net, useNet, type Answer } from "./net";

useNet();

/**
 * Launch (prepared) — the launch an agent signs itself. The launchpad is the real deployed v2
 * address answering as a fake that says what the deployed one said when it was checked (see
 * `CONTRACTS.launchFactory`); the stock list is Coinbase's, captured. Nothing here sends.
 */

const pinned = vi.hoisted(() => ({ waiting: false }));
vi.mock("@/config/chain", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/config/chain")>();
  return { ...real, CONTRACTS: new Proxy(real.CONTRACTS, { get: (t, k) => (k === "launchFactory" && pinned.waiting ? null : t[k as keyof typeof t]) }) };
});

const FACTORY = CONTRACTS.launchFactory!;
const CREATOR = "0xD5C1dFc036F9911348EA8065F73c8123f4013FAB";
const TOKEN = "0xB200000000000000000000332568e721A4d1Edfc";
const ETH_Q = "0x0000000000000000000000000000000000000000";
const AAPL = "0xb200000000000000000000C2e324d24d7eEcd1fb";
const GETTERS = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)"]);

function chain(over: { quotes?: Record<string, readonly [boolean, number]>; lpFee?: number; eth?: bigint | null; shares?: bigint | null; stocks?: Answer } = {}) {
  const quotes = over.quotes ?? { [ETH_Q]: [true, LAUNCHPAD_EXPECTS.startTick], [AAPL.toLowerCase()]: [true, 400_400] };
  const getters = contractAt(LAUNCHPAD_ABI, {
    TOTAL_SUPPLY: LAUNCHPAD_EXPECTS.supply,
    LP_FEE: over.lpFee ?? LAUNCHPAD_EXPECTS.lpFee,
    CREATOR_SHARE_BPS: LAUNCHPAD_EXPECTS.creatorShareBps,
    protocolRecipient: CONTRACTS.treasury!,
    predictToken: TOKEN,
  });
  const stock: Record<string, `0x${string}`> = {
    "0x06fdde03": encodeFunctionResult({ abi: GETTERS, functionName: "name", result: "Apple Inc." }),
    "0x95d89b41": encodeFunctionResult({ abi: GETTERS, functionName: "symbol", result: "AAPLc" }),
    "0x313ce567": encodeFunctionResult({ abi: GETTERS, functionName: "decimals", result: 8 }),
    "0x18160ddd": encodeFunctionResult({ abi: GETTERS, functionName: "totalSupply", result: 10n ** 14n }),
  };
  net({
    get: (u) => (u === `${STOCKS_PATH}/base` ? (over.stocks ?? MARKETS_FX.coinbaseStocks) : undefined),
    rpc: (m, p) => {
      if (m === "eth_getBalance") return over.eth === null ? DOWN : `0x${(over.eth ?? 10n ** 17n).toString(16)}`;
      if (m !== "eth_call") return undefined;
      const { to, data } = p[0] as { to: string; data: `0x${string}` };
      if (to.toLowerCase() === FACTORY.toLowerCase()) {
        const { functionName, args } = decodeFunctionData({ abi: LAUNCHPAD_ABI, data });
        if (functionName === "quotes") return encodeFunctionResult({ abi: LAUNCHPAD_ABI, functionName, result: quotes[String(args![0]).toLowerCase()] ?? [false, 0] });
        return getters(data);
      }
      if (to.toLowerCase() === AAPL.toLowerCase()) {
        if (data.startsWith("0x70a08231")) return over.shares === null ? DOWN : encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: over.shares ?? 10n ** 8n });
        return stock[data];
      }
      // any other stock in Coinbase's list: not enabled, so never read past `quotes`
      return undefined;
    },
  });
}

const value = (r: Awaited<ReturnType<typeof prepareLaunch>>, label: string) => r.rows.find((x) => x.label === label)?.value;

describe("Launch (prepared)", () => {
  it("prepares an ETH launch as one unsigned transaction to the launchpad, its token address predicted", async () => {
    chain();
    const r = await prepareLaunch(["Night_Cat", "NCAT", CREATOR]);
    expect(r.title).toBe("Launch Night Cat (NCAT) — prepared, not sent");
    expect(r.rows[0]).toEqual(row("Ready", "One signature", { tone: "ok" }));
    expect(value(r, "Token")).toMatch(new RegExp(`^${TOKEN} \\(predicted`));
    expect(value(r, "Paired with")).toBe("ETH");
    expect(value(r, "Opening value")).toBe("the whole supply ≈ 4.97 ETH at the launchpad's opening tick, read now");
    expect(value(r, "Step 1 to")).toBe(FACTORY);
    const { functionName, args } = decodeFunctionData({ abi: LAUNCHPAD_ABI, data: value(r, "Step 1 data") as `0x${string}` });
    expect(functionName).toBe("launch");
    expect(args!.slice(0, 2)).toEqual(["Night Cat", "NCAT"]);
    expect(args!.slice(4)).toEqual([ETH_Q, 0n]);
    expect(value(r, "Step 2")).toBeUndefined();
    expect(r.notes[0]).toMatch(/^Nothing was signed or sent/);
  });

  it("prepares a stock launch with a first buy as an exact approval, then the launch", async () => {
    forgetCatalog();
    chain();
    const r = await prepareLaunch(["Stock_Cat", "SCAT", CREATOR, "aaplc", "0.5"]);
    expect(r.rows[0]!.value).toBe("Two signatures, in order");
    expect(value(r, "Paired with")).toBe(`AAPLc — ${AAPL}`);
    expect(value(r, "Step 1")).toBe("approve exactly 0.5 AAPLc for the launchpad");
    expect(decodeFunctionData({ abi: erc20Abi, data: value(r, "Step 1 data") as `0x${string}` }).args).toEqual([FACTORY, 50_000_000n]);
    expect(value(r, "Step 2 value")).toBe("0 wei");
    expect(decodeFunctionData({ abi: LAUNCHPAD_ABI, data: value(r, "Step 2 data") as `0x${string}` }).args!.slice(4)).toEqual([AAPL, 50_000_000n]);
    expect(value(r, "Creator's AAPLc")).toBe("1");
    expect(r.notes.join(" ")).toContain("Coinbase restricts who may hold it");
    // the same pair by its address, without the list
    forgetCatalog();
    chain({ stocks: DOWN });
    expect(value(await prepareLaunch(["Stock_Cat", "SCAT", CREATOR, AAPL]), "Paired with")).toBe(`AAPLc — ${AAPL}`);
  });

  it("says when the creator is short, and when a balance could not be read", async () => {
    chain({ eth: 10n ** 12n });
    const short = await prepareLaunch(["Night_Cat", "NCAT", CREATOR, "ETH", "0.01"]);
    expect(short.rows[0]).toMatchObject({ tone: "bad", value: "Not yet — the creator's wallet is short (see below)" });
    expect(value(short, "Creator's ETH")).toMatch(/not enough: the first buy and gas need about/);
    forgetCatalog();
    chain({ eth: null, shares: null });
    const unread = await prepareLaunch(["Stock_Cat", "SCAT", CREATOR, AAPL, "0.5"]);
    expect(unread.rows.filter((x) => x.value.startsWith("not checked")).map((x) => x.label)).toEqual(["Creator's ETH", "Creator's AAPLc"]);
    chain({ shares: 1n });
    expect(value(await prepareLaunch(["Stock_Cat", "SCAT", CREATOR, AAPL, "0.5"]), "Creator's AAPLc")).toBe("0.00000001 — not enough for the first buy");
    chain({ eth: 10n ** 12n });
    expect(value(await prepareLaunch(["Stock_Cat", "SCAT", CREATOR, AAPL]), "Creator's ETH")).toMatch(/the gas need about/);
  });

  it("refuses what it cannot prepare honestly, by name", async () => {
    pinned.waiting = true;
    await expect(prepareLaunch(["A", "A", CREATOR])).rejects.toThrow("not deployed yet");
    pinned.waiting = false;
    net({});
    await expect(prepareLaunch(["", "A", CREATOR])).rejects.toThrow("Enter a name.");
    await expect(prepareLaunch(["A", "A", "0x12"])).rejects.toThrow(/Creator/);
    chain({ lpFee: 3000 });
    await expect(prepareLaunch(["A", "A", CREATOR])).rejects.toThrow("its pool fee is 3000, not 10000");
    // the factory checks ETH's tick, not whether it is on — so a disabled ETH pair still passes the factory check
    chain({ quotes: { [ETH_Q]: [false, LAUNCHPAD_EXPECTS.startTick] } });
    await expect(prepareLaunch(["A", "A", CREATOR, "eth"])).rejects.toThrow("The launchpad does not pair with ETH right now.");
    chain();
    await expect(prepareLaunch(["A", "A", CREATOR, "0x1111111111111111111111111111111111111111"])).rejects.toThrow("its quote admin has not enabled it");
    forgetCatalog();
    chain();
    await expect(prepareLaunch(["A", "A", CREATOR, "TSLAc"])).rejects.toThrow('The launchpad does not pair with "TSLAc". It pairs with: ETH, AAPLc.');
    forgetCatalog();
    chain({ stocks: DOWN });
    await expect(prepareLaunch(["A", "A", CREATOR, "NVDAc"])).rejects.toThrow(/could not be read .* give the stock token's address instead of "NVDAc"/);
    chain();
    await expect(prepareLaunch(["A", "A", CREATOR, "ETH", "1e3"])).rejects.toThrow();
    forgetCatalog();
  });

  it("writes each step as where it goes, the ETH it carries, and its calldata", async () => {
    expect(stepRows(3, "x", { to: CREATOR })).toEqual([
      row("Step 3", "x"),
      row("Step 3 to", CREATOR, { href: `https://basescan.org/address/${CREATOR}` }),
      row("Step 3 value", "0 wei"),
      row("Step 3 data", "0x"),
    ]);
    chain();
    expect((await prepareLaunchSkill.run(["Night_Cat", "NCAT", CREATOR])).rows[0]!.value).toBe("One signature");
  });
});
