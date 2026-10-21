import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, toFunctionSelector, type Abi } from "viem";
import { OWED_V1_ABI, OWED_V2_ABI } from "@/config/owed";
import { owedTo } from "@/skills/owed";
import { contractAt, ethCalls, net, useNet } from "./net";

const F = vi.hoisted(() => ({
  v1: "0xcDb2eC1c487fbcB6B4AF25cCD86aFf8120FaB8a5" as string | null,
  v2: "0xef1F427bB57e0ECd7BB8051cE8bC7AAb709a0c03" as string | null,
}));

vi.mock("@/config/chain", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/config/chain")>();
  return {
    ...real,
    CONTRACTS: new Proxy(real.CONTRACTS, {
      get: (t, k) => (k === "launchFactoryV1" ? F.v1 : k === "launchFactory" ? F.v2 : Reflect.get(t, k)),
    }),
  };
});

useNet();

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const flat = (path: string) => readFileSync(resolve(ROOT, path), "utf8").replace(/\s+/g, " ");

const ME = "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9";
const ETH = "0x0000000000000000000000000000000000000000";
const NVDA = "0xB2000000000000000000006f3e7c62e1cee07b97";
const V1 = "0xcDb2eC1c487fbcB6B4AF25cCD86aFf8120FaB8a5";
const V2 = "0xef1F427bB57e0ECd7BB8051cE8bC7AAb709a0c03";

beforeEach(() => {
  F.v1 = V1;
  F.v2 = V2;
});

describe("the ABIs are the deployed factories' own", () => {
  it("v1: owedEth is a public mapping and withdraw() takes nothing", () => {
    const src = flat("contracts/deployed/LaunchFactory.v1.sol");
    expect(src).toContain("mapping(address account => uint256 amount) public owedEth;");
    expect(src).toContain("function withdraw() external");
    expect(toFunctionSelector(OWED_V1_ABI[0])).toBe(toFunctionSelector("owedEth(address)"));
    expect(toFunctionSelector(OWED_V1_ABI[1])).toBe(toFunctionSelector("withdraw()"));
  });

  it("v2: owed is a mapping per account per currency, and withdraw takes the currency (an address)", () => {
    const src = flat("contracts/src/LaunchFactory.sol");
    expect(src).toContain("mapping(address account => mapping(Currency currency => uint256 amount)) public owed;");
    expect(src).toContain("function withdraw(Currency currency) external");
    // v4-core: `type Currency is address;` — so the selector is over `address`
    expect(readFileSync(resolve(ROOT, "node_modules/@uniswap/v4-core/src/types/Currency.sol"), "utf8")).toContain("type Currency is address;");
    expect(toFunctionSelector(OWED_V2_ABI[0])).toBe(toFunctionSelector("owed(address,address)"));
    expect(toFunctionSelector(OWED_V2_ABI[1])).toBe(toFunctionSelector("withdraw(address)"));
  });
});

/** Factories that owe from a table: v1 by account, v2 by currency (lowercased). */
function factoriesOwing(v1: bigint, v2: Record<string, bigint>) {
  const asked: string[] = [];
  const v2Fake = (data: `0x${string}`) => {
    const currency = `0x${data.slice(-40)}`.toLowerCase();
    asked.push(currency);
    return contractAt(OWED_V2_ABI as Abi, { owed: v2[currency] ?? 0n })(data);
  };
  net({ rpc: ethCalls({ [V1]: contractAt(OWED_V1_ABI as Abi, { owedEth: v1 }), [V2]: v2Fake }) });
  return asked;
}

describe("owedTo", () => {
  it("returns only the non-zero payouts, each with the exact withdraw call", async () => {
    const asked = factoriesOwing(7n, { [NVDA.toLowerCase()]: 5n });
    const out = await owedTo(ME, [NVDA, NVDA.toLowerCase(), ETH]);
    // ETH asked once, NVDA once — duplicates and case do not ask twice
    expect(asked).toEqual([ETH, NVDA.toLowerCase()]);
    expect(out).toEqual([
      { factory: V1, currency: ETH, amount: 7n, tx: { to: V1, data: "0x3ccfd60b" } },
      {
        factory: V2,
        currency: NVDA.toLowerCase(),
        amount: 5n,
        tx: { to: V2, data: encodeFunctionData({ abi: OWED_V2_ABI, functionName: "withdraw", args: [NVDA.toLowerCase() as `0x${string}`] }) },
      },
    ]);
    expect(out[1]!.tx.data).toBe(`${toFunctionSelector("withdraw(address)")}000000000000000000000000${NVDA.slice(2).toLowerCase()}`);
  });

  it("owes nothing when every amount is zero", async () => {
    factoriesOwing(0n, {});
    expect(await owedTo(ME, [])).toEqual([]);
  });

  it("v2 in ETH as well", async () => {
    factoriesOwing(0n, { [ETH]: 3n });
    expect(await owedTo(ME, [])).toEqual([
      { factory: V2, currency: ETH, amount: 3n, tx: { to: V2, data: `${toFunctionSelector("withdraw(address)")}${"0".repeat(64)}` } },
    ]);
  });

  it("asks no factory that is not deployed", async () => {
    F.v1 = null;
    F.v2 = null;
    net({});
    expect(await owedTo(ME, [NVDA])).toEqual([]);
  });

  it("v1 alone, and v2 alone", async () => {
    F.v2 = null;
    factoriesOwing(1n, {});
    expect((await owedTo(ME, [NVDA])).map((o) => o.factory)).toEqual([V1]);
    F.v2 = V2;
    F.v1 = null;
    factoriesOwing(1n, { [ETH]: 2n });
    expect((await owedTo(ME, [])).map((o) => o.factory)).toEqual([V2]);
  });
});
