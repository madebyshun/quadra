import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, getAddress, parseAbi } from "viem";
import {
  claimData,
  createData,
  DEPLOYER_ABI,
  deployer,
  hasCode,
  LAUNCHPAD_RECIPIENT_ABI,
  predictShare,
  REVENUE_SHARE_ABI,
  setRecipientData,
  shareOf,
  stakeData,
  stakerOf,
  unstakeData,
} from "@/lib/revenueShare";
import { contractAt, DOWN, ethCalls, net, RpcError, useNet } from "./net";

useNet();

/**
 * Reading a coin's RevenueShare, and the calls that use one. The share answers from a table, by the
 * ABI the contract has (contracts/src/RevenueShare.sol); a recipient that is a wallet, a delegated
 * wallet or some other contract is not a share.
 */

const FACTORY = "0x006Da367654a487bb277fe25ff54f0fE0f741377";
const COIN = "0xb200000000000000000000694E3F5A4AB150b283";
const SHARE = getAddress("0x5157000000000000000000000000000000000abc");
const AGENT = "0x884FBdd5cF193E7F87CBA76419e526D8F4dF7A9B";
const ME = "0x00fd29b7000000000000000000000000000746ff";
const ZERO = "0x0000000000000000000000000000000000000000";
const record = { factory: FACTORY, creator: ME, creatorRecipient: SHARE };

const GETTERS = parseAbi([
  "function token() view returns (address)",
  "function launchpad() view returns (address)",
  "function agent() view returns (address)",
  "function agentBps() view returns (uint256)",
  "function totalStaked() view returns (uint256)",
]);

function chain(code: string, answers: Record<string, unknown> | "reverts") {
  net({
    rpc: (m, p) =>
      m === "eth_getCode"
        ? code
        : ethCalls({ [SHARE]: answers === "reverts" ? () => new RpcError({ code: 3, message: "execution reverted" }) : contractAt(GETTERS, answers) })(m, p),
  });
}

describe("which recipient is a share", () => {
  it("reads a share that serves THIS coin on THIS launchpad, with its agent", async () => {
    chain("0x6080", { token: COIN, launchpad: FACTORY, agent: AGENT, agentBps: 500n, totalStaked: 10n ** 24n });
    expect(await shareOf(record, COIN)).toEqual({ address: SHARE, agent: AGENT, agentBps: 500, totalStaked: 10n ** 24n });
    chain("0x6080", { token: COIN, launchpad: FACTORY, agent: ZERO, agentBps: 0n, totalStaked: 0n });
    expect(await shareOf(record, COIN)).toMatchObject({ agent: null, agentBps: 0 });
  });

  it("is a wallet when there is no code, or only an EIP-7702 delegation", async () => {
    chain("0x", "reverts");
    expect(await shareOf(record, COIN)).toBeNull();
    chain("0xef0100" + "ab".repeat(20), "reverts");
    expect(await shareOf(record, COIN)).toBeNull();
  });

  it("is not a share when the contract does not answer, or serves another coin or launchpad", async () => {
    chain("0x6080", "reverts");
    expect(await shareOf(record, COIN)).toBeNull();
    chain("0x6080", { token: AGENT, launchpad: FACTORY });
    expect(await shareOf(record, COIN)).toBeNull();
    chain("0x6080", { token: COIN, launchpad: AGENT });
    expect(await shareOf(record, COIN)).toBeNull();
  });

  it("is not a share when the contract serves this coin but refuses a share's own getters — a furnace", async () => {
    const furnaceLike = contractAt(GETTERS, { token: COIN, launchpad: FACTORY });
    net({
      rpc: (m, p) =>
        m === "eth_getCode"
          ? "0x6080"
          : ethCalls({
              [SHARE]: (data) => (["0xfc0c546a", "0x02669b52"].some((sel) => data.startsWith(sel)) ? furnaceLike(data) : new RpcError({ code: 3, message: "execution reverted" })),
            })(m, p),
    });
    expect(await shareOf(record, COIN)).toBeNull();
  });

  it("does not read an outage as \"no share\"", async () => {
    net({ rpc: (m) => (m === "eth_getCode" ? "0x6080" : DOWN) });
    await expect(shareOf(record, COIN)).rejects.toThrow();
  });
});

describe("a staker, and the calls", () => {
  it("reads what one staker has staked and can claim", async () => {
    net({ rpc: ethCalls({ [SHARE]: contractAt(REVENUE_SHARE_ABI, { stakedOf: 7n, claimable: [1n, 2n] }) }) });
    expect(await stakerOf(SHARE, ME)).toEqual({ staked: 7n, claimable: [1n, 2n] });
  });

  it("encodes stake, unstake, claim, the recipient change and the deployer's two calls exactly", async () => {
    expect(decodeFunctionData({ abi: REVENUE_SHARE_ABI, data: stakeData(5n) })).toMatchObject({ functionName: "stake", args: [5n] });
    expect(decodeFunctionData({ abi: REVENUE_SHARE_ABI, data: unstakeData(5n) })).toMatchObject({ functionName: "unstake", args: [5n] });
    expect(decodeFunctionData({ abi: REVENUE_SHARE_ABI, data: claimData(ME) })).toMatchObject({ functionName: "claim", args: [getAddress(ME)] });
    expect(decodeFunctionData({ abi: LAUNCHPAD_RECIPIENT_ABI, data: setRecipientData(COIN, SHARE) })).toMatchObject({ functionName: "setCreatorRecipient", args: [COIN, SHARE] });
    expect(decodeFunctionData({ abi: DEPLOYER_ABI, data: createData(COIN, null, 0) })).toMatchObject({ functionName: "create", args: [COIN, ZERO, 0] });
    expect(decodeFunctionData({ abi: DEPLOYER_ABI, data: createData(COIN, AGENT, 500) })).toMatchObject({ args: [COIN, AGENT, 500] });
    const DEPLOYER = "0x5157000000000000000000000000000000000def";
    net({ rpc: ethCalls({ [DEPLOYER]: contractAt(DEPLOYER_ABI, { predict: SHARE.toLowerCase() }) }) });
    expect(await predictShare(DEPLOYER, COIN, null, 0)).toBe(SHARE);
  });

  it("names the deployer the owner deployed and verified (2026-10-29), and asks whether a share is already there", async () => {
    expect(deployer()).toBe("0x774CD3CD89337cF7e57aF6a04256733F1dd74139");
    net({ rpc: (m, p) => (m === "eth_getCode" ? ((p[0] as string) === SHARE ? "0x6080" : "0x") : undefined) });
    expect(await hasCode(SHARE)).toBe(true);
    expect(await hasCode(ZERO)).toBe(false);
    vi.unstubAllGlobals();
  });
});
