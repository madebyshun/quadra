import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import { CONTRACTS } from "@/config/chain";
import { toChecksumAddress } from "@/lib/address";
import { ethCall, rpc, RpcRefusal } from "@/skills/http";
import type { LaunchRecord } from "@/skills/launchpad";

/**
 * Where a launchpad coin's 80% goes, and the opt-in way to share it (2026-10-29). Two things a creator
 * can do with the launchpad's own `setCreatorRecipient`:
 *
 *   • point the share at another wallet — an agent's, a team's (the factory lets the CURRENT recipient
 *     do it, and the new one can do it again);
 *   • point it at a `RevenueShare` (contracts/src/RevenueShare.sol), which passes it to whoever STAKES
 *     the coin, streamed over seven days, with an optional fixed cut for an agent. That hand-over is FOR
 *     GOOD: the contract has no function that calls `setCreatorRecipient`.
 *
 * A RevenueShare is made by the `RevenueShareDeployer`, which is NOT deployed: `CONTRACTS.revenueShareDeployer`
 * is `null` (hard rule 1), so the window offers the second only once the owner has deployed it and the
 * address is verified. A coin whose recipient already IS a RevenueShare for it is recognised either way —
 * by asking the recipient itself which coin and which launchpad it serves.
 */

export const LAUNCHPAD_RECIPIENT_ABI = parseAbi(["function setCreatorRecipient(address token, address recipient)"]);

export const REVENUE_SHARE_ABI = parseAbi([
  "function stakedOf(address staker) view returns (uint256)",
  "function claimable(address staker) view returns (uint256 amount0, uint256 amount1)",
  "function stake(uint256 amount)",
  "function unstake(uint256 amount)",
  "function claim(address to) returns (uint256 paid0, uint256 paid1)",
]);

export const DEPLOYER_ABI = parseAbi([
  "function create(address token, address agent, uint16 agentBps) returns (address share)",
  "function predict(address token, address agent, uint16 agentBps) view returns (address)",
]);

/** The most an agent may take, as the contract caps it: stakers always get at least 10%. */
export const MAX_AGENT_BPS = 9_000;

export type Share = {
  readonly address: string;
  readonly agent: string | null;
  readonly agentBps: number;
  readonly totalStaked: bigint;
};

const ZERO = "0x0000000000000000000000000000000000000000";

/** The share's no-argument getters, each read on its own as one plain number or address. */
const ADDRESS_GETTERS = parseAbi(["function token() view returns (address)", "function launchpad() view returns (address)", "function agent() view returns (address)"]);
const NUMBER_GETTERS = parseAbi(["function agentBps() view returns (uint256)", "function totalStaked() view returns (uint256)"]);

async function address(at: string, name: "token" | "launchpad" | "agent"): Promise<string> {
  return decodeFunctionResult({ abi: ADDRESS_GETTERS, functionName: name, data: await ethCall(at, encodeFunctionData({ abi: ADDRESS_GETTERS, functionName: name })) });
}

async function number(at: string, name: "agentBps" | "totalStaked"): Promise<bigint> {
  return decodeFunctionResult({ abi: NUMBER_GETTERS, functionName: name, data: await ethCall(at, encodeFunctionData({ abi: NUMBER_GETTERS, functionName: name })) });
}

/**
 * The coin's RevenueShare, when its creator recipient is one — or `null` when the recipient is a wallet
 * or any other contract. A recipient is a share for THIS coin only when it says so itself, on both
 * counts (the coin and the factory): a contract that merely has a `token()` is not one.
 */
export async function shareOf(record: LaunchRecord, token: string): Promise<Share | null> {
  const code = (await rpc("eth_getCode", [record.creatorRecipient, "latest"])) as string;
  // no code, or an EIP-7702 wallet's delegation (0xef0100…): a person's wallet, not a contract
  if (code === "0x" || code.toLowerCase().startsWith("0xef0100")) return null;
  let served: readonly [string, string];
  let agent: string, agentBps: bigint, totalStaked: bigint;
  try {
    served = [await address(record.creatorRecipient, "token"), await address(record.creatorRecipient, "launchpad")];
    if (served[0].toLowerCase() !== token.toLowerCase() || served[1].toLowerCase() !== record.factory.toLowerCase()) return null;
    // a share's own getters, inside the same refusal check: a furnace answers token() and launchpad()
    // too, and refuses agent() — MEASURED 2026-10-29 on the app token's own furnace, which read as a broken share
    [agent, agentBps, totalStaked] = await Promise.all([
      address(record.creatorRecipient, "agent"),
      number(record.creatorRecipient, "agentBps"),
      number(record.creatorRecipient, "totalStaked"),
    ]);
  } catch (e) {
    if (e instanceof RpcRefusal) return null;
    throw e;
  }
  // a uint16 read as a word: the ABI's own type pads it, so a number in range is exact
  return { address: record.creatorRecipient, agent: agent === ZERO ? null : toChecksumAddress(agent), agentBps: Number(agentBps), totalStaked };
}

/** What one staker has in a share: staked, and claimable in the pool's two currencies (currency0, currency1). */
export async function stakerOf(share: string, staker: string): Promise<{ readonly staked: bigint; readonly claimable: readonly [bigint, bigint] }> {
  const s = encodeFunctionData({ abi: REVENUE_SHARE_ABI, functionName: "stakedOf", args: [staker as `0x${string}`] });
  const c = encodeFunctionData({ abi: REVENUE_SHARE_ABI, functionName: "claimable", args: [staker as `0x${string}`] });
  const [staked, claim] = await Promise.all([ethCall(share, s), ethCall(share, c)]);
  return {
    staked: decodeFunctionResult({ abi: REVENUE_SHARE_ABI, functionName: "stakedOf", data: staked }),
    claimable: decodeFunctionResult({ abi: REVENUE_SHARE_ABI, functionName: "claimable", data: claim }),
  };
}

export const stakeData = (amount: bigint) => encodeFunctionData({ abi: REVENUE_SHARE_ABI, functionName: "stake", args: [amount] });
export const unstakeData = (amount: bigint) => encodeFunctionData({ abi: REVENUE_SHARE_ABI, functionName: "unstake", args: [amount] });
export const claimData = (to: string) => encodeFunctionData({ abi: REVENUE_SHARE_ABI, functionName: "claim", args: [to as `0x${string}`] });
export const setRecipientData = (token: string, recipient: string) =>
  encodeFunctionData({ abi: LAUNCHPAD_RECIPIENT_ABI, functionName: "setCreatorRecipient", args: [token as `0x${string}`, recipient as `0x${string}`] });

/** The deployer, or why there is none: it is not deployed until the owner deploys and verifies it. */
export function deployer(): string | null {
  return CONTRACTS.revenueShareDeployer;
}

/** Where `create(token, agent, agentBps)` puts the share — asked of the deployer itself. */
export async function predictShare(at: string, token: string, agent: string | null, agentBps: number): Promise<string> {
  const data = encodeFunctionData({ abi: DEPLOYER_ABI, functionName: "predict", args: [token as `0x${string}`, (agent ?? ZERO) as `0x${string}`, agentBps] });
  return toChecksumAddress(decodeFunctionResult({ abi: DEPLOYER_ABI, functionName: "predict", data: await ethCall(at, data) }));
}

/**
 * Whether a share is already deployed at `at`. `create` is open to anyone and its address is fixed by
 * (token, agent, agentBps), so the same share may already exist — made earlier, or by somebody else —
 * and `create` then reverts `AlreadyCreated`. Found in the review of 2026-10-29.
 */
export async function hasCode(at: string): Promise<boolean> {
  return ((await rpc("eth_getCode", [at, "latest"])) as string) !== "0x";
}

export const createData = (token: string, agent: string | null, agentBps: number) =>
  encodeFunctionData({ abi: DEPLOYER_ABI, functionName: "create", args: [token as `0x${string}`, (agent ?? ZERO) as `0x${string}`, agentBps] });
