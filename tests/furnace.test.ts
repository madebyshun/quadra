import { describe, expect, it } from "vitest";
import { decodeFunctionData, getAddress } from "viem";
import { buyAndBurnData, FURNACE_ABI, furnaceOf, harvestData } from "@/lib/furnace";
import { contractAt, DOWN, ethCalls, net, RpcError, useNet } from "./net";

useNet();

/**
 * Reading a coin's QuadraFurnace (contracts/src/QuadraFurnace.sol): the furnace answers from a table,
 * by the ABI the contract has; a wallet, a delegated wallet, a contract that does not answer, or one
 * serving another coin or launchpad is not a furnace — and an outage is not "no furnace".
 */

const FACTORY = "0x006Da367654a487bb277fe25ff54f0fE0f741377";
const QUADRA = "0xb200000000000000000000d096efba9896ab0816";
const FURNACE = getAddress("0x78386a3c1888f89ef4c874675069cb930536a44c");
const TREASURY = "0xD5C1dFc036F9911348EA8065F73c8123f4013FAB";
const record = { factory: FACTORY, creator: TREASURY, creatorRecipient: FURNACE };
const answers = {
  token: QUADRA,
  launchpad: FACTORY,
  treasury: TREASURY.toLowerCase(),
  burnBps: 5_000n,
  toBuy: 7n,
  burnedFromFees: 1n,
  burnedFromBuybacks: 2n,
  quoteSpent: 3n,
};

function chain(code: string, a: Record<string, unknown> | "reverts") {
  net({
    rpc: (m, p) =>
      m === "eth_getCode" ? code : ethCalls({ [FURNACE]: a === "reverts" ? () => new RpcError({ code: 3, message: "execution reverted" }) : contractAt(FURNACE_ABI, a) })(m, p),
  });
}

describe("which recipient is a furnace", () => {
  it("reads a furnace that serves THIS coin on THIS launchpad", async () => {
    chain("0x6080", answers);
    expect(await furnaceOf(record, QUADRA)).toEqual({
      address: FURNACE,
      treasury: TREASURY,
      burnBps: 5_000,
      toBuy: 7n,
      burnedFromFees: 1n,
      burnedFromBuybacks: 2n,
      quoteSpent: 3n,
    });
  });

  it("is a wallet when there is no code, or only an EIP-7702 delegation", async () => {
    chain("0x", "reverts");
    expect(await furnaceOf(record, QUADRA)).toBeNull();
    chain(`0xef0100${"ab".repeat(20)}`, "reverts");
    expect(await furnaceOf(record, QUADRA)).toBeNull();
  });

  it("is not a furnace when the contract does not answer, or serves another coin or launchpad", async () => {
    chain("0x6080", "reverts");
    expect(await furnaceOf(record, QUADRA)).toBeNull();
    chain("0x6080", { ...answers, token: TREASURY });
    expect(await furnaceOf(record, QUADRA)).toBeNull();
    chain("0x6080", { ...answers, launchpad: TREASURY });
    expect(await furnaceOf(record, QUADRA)).toBeNull();
  });

  it("does not read an outage as \"no furnace\"", async () => {
    net({ rpc: (m) => (m === "eth_getCode" ? "0x6080" : DOWN) });
    await expect(furnaceOf(record, QUADRA)).rejects.toThrow();
  });

  it("encodes harvest and the buyback exactly", () => {
    expect(decodeFunctionData({ abi: FURNACE_ABI, data: harvestData() }).functionName).toBe("harvest");
    expect(decodeFunctionData({ abi: FURNACE_ABI, data: buyAndBurnData(5n, 4n) })).toMatchObject({ functionName: "buyAndBurn", args: [5n, 4n] });
  });
});
