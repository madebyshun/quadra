import { decodeFunctionResult, encodeFunctionData, type Abi } from "viem";
import { BRAND } from "@/brand";
import {
  BASEPAD,
  BASEPAD_ABI,
  CLANKER_ABI,
  CLANKER_FACTORY,
  DOPPLER_ABI,
  DOPPLER_AIRLOCK,
  DOPPLER_NOOP_MIGRATOR,
  FEEL_INTEGRATOR,
  FEEL_SUFFIX,
  ZORA_ABI,
  ZORA_FACTORY,
} from "@/config/launchpads";
import { toChecksumAddress } from "@/lib/address";
import { keccak256, toHex, utf8 } from "@/lib/keccak";
import { short } from "@/skills/format";
import { ethCall, RpcRefusal, rpc } from "@/skills/http";
import { isObj, listOf, strOf } from "@/skills/json";
import { launchOf, type LaunchRecord } from "@/skills/launchpad";

/**
 * Which launchpad a Base token came from — PROVEN from that launchpad's own on-chain record, never
 * inferred from the launch transaction's `to` (an EIP-7702 account sends it to MetaMask's
 * DelegationManager, a 4337 wallet to the EntryPoint) and never from a look-alike address.
 *
 * Three answers, kept apart (hard rule 10 — no `verified: boolean`):
 * - `proven`: the launchpad's own contract has a record of this token;
 * - `claimed`: the token LOOKS like one (an address ending in `fee1`, a `factory()` naming basepad's
 *   factory) and the launchpad has no record of it — red, because a look-alike is the point;
 * - `unknown`: none of the pinned launchpads made it. Not a flag: most tokens come from elsewhere.
 * A failed read is a thrown error, which the verdict shows as "not checked" (hard rule 12).
 */

export type PadId = "quadra" | "basepad" | "feel" | "doppler" | "clanker" | "zora";

export type Launchpad =
  | {
      readonly kind: "proven";
      readonly id: PadId;
      readonly name: string;
      /** the contract whose record proves it — the factory, or Doppler's Airlock */
      readonly address: string;
      /** how it was proven, in a sentence */
      readonly how: string;
      /** what that record guarantees — only what the verified source or the record itself says */
      readonly guarantees: readonly string[];
      /** the launcher the launchpad RECORDED, when it records one (the caller, so a 7702 account's own address) */
      readonly launcher: string | null;
    }
  | { readonly kind: "claimed"; readonly name: string; readonly why: string }
  | { readonly kind: "unknown" };

export type Proven = Extract<Launchpad, { kind: "proven" }>;

const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const pct = (n: number) => `${Number(n.toFixed(2))}%`;

/** A call to a record function, decoded. */
async function read(abi: Abi, to: string, functionName: string, args: readonly unknown[]): Promise<unknown> {
  const data = encodeFunctionData({ abi, functionName, args } as Parameters<typeof encodeFunctionData>[0]);
  return decodeFunctionResult({ abi, functionName, data: await ethCall(to, data) } as Parameters<typeof decodeFunctionResult>[0]);
}

export function quadraPad(record: LaunchRecord): Proven {
  return {
    kind: "proven",
    id: "quadra",
    name: `${BRAND.name}'s launchpad`,
    address: record.factory,
    how: "the factory's own launch record",
    guarantees: ["fixed supply with no admin", "liquidity locked by the launchpad contract forever"],
    launcher: record.creator,
  };
}

export function basepadPad(info: readonly [bigint, string, string, number, number]): Proven | null {
  const [tokenId, launcher, , , lpFee] = info;
  if (tokenId === 0n) return null;
  return {
    kind: "proven",
    id: "basepad",
    name: "basepad.si",
    address: BASEPAD.factory,
    how: `basepad's factory recorded it as launch #${tokenId}`,
    guarantees: [
      "fixed supply; the token has no owner, mint, pause, blacklist or tax",
      "the whole supply was placed in one Uniswap v4 position held by an ownerless locker with no withdraw path",
      lpFee === 0 ? "no pool fee" : `${pct(lpFee / 10_000)} pool fee: ${BASEPAD.creatorBps / 100}% to the creator's recipients, ${BASEPAD.platformBps / 100}% to basepad`,
    ],
    launcher: toChecksumAddress(launcher),
  };
}

type AssetData = readonly [string, string, string, string, string, string, string, bigint, bigint, string];

export function dopplerPad(data: AssetData): Proven | null {
  const [, , governance, migrator, initializer, , , forSale, supply, integrator] = data;
  if (same(initializer, ZERO)) return null;
  const feel = same(integrator, FEEL_INTEGRATOR);
  const guarantees = [
    ...(supply > 0n ? [`${pct(Number((forSale * 10_000n) / supply) / 100)} of the supply sold through its pool`] : []),
    ...(same(governance, DEAD) ? ["no governance"] : []),
    ...(same(migrator, DOPPLER_NOOP_MIGRATOR) ? ["its liquidity never migrates (Doppler's NoOpMigrator)"] : []),
  ];
  return {
    kind: "proven",
    id: feel ? "feel" : "doppler",
    name: feel ? "Feel.cash" : "Doppler",
    address: DOPPLER_AIRLOCK,
    how: feel ? "Doppler's Airlock recorded it with Feel.cash as the integrator" : `Doppler's Airlock recorded it (integrator ${short(integrator)})`,
    guarantees,
    // the Airlock records no launcher, and Feel.cash sends every launch from its own wallet (MEASURED: 5 of 5)
    launcher: null,
  };
}

export function clankerPad(info: readonly [string, string, string]): Proven | null {
  if (same(info[0], ZERO)) return null;
  return { kind: "proven", id: "clanker", name: "Clanker", address: CLANKER_FACTORY, how: "Clanker's factory recorded its deployment", guarantees: [], launcher: null };
}

export function zoraPad(version: number): Proven | null {
  if (version === 0) return null;
  return {
    kind: "proven",
    id: "zora",
    name: "Zora",
    address: ZORA_FACTORY,
    how: `Zora's coin factory recorded it (coin version ${version}); the factory itself is upgradeable`,
    guarantees: [],
    launcher: null,
  };
}

/** A call that reverts is "no claim made"; any other failure is a read that did not happen. */
const refusedIsNull = (e: unknown): null => {
  if (e instanceof RpcRefusal) return null;
  throw e;
};

/**
 * The launchpad behind `token`. `ours` is this app's own record, when the caller already asked for
 * it; a token launched here asks nothing else.
 */
export async function launchpadOf(token: string, ours: Promise<LaunchRecord | null> = launchOf(token)): Promise<Launchpad> {
  const mine = await ours;
  if (mine) return quadraPad(mine);
  const found = await Promise.all([
    read(BASEPAD_ABI, BASEPAD.factory, "infoOf", [token]).then((r) => basepadPad(r as never)),
    read(DOPPLER_ABI, DOPPLER_AIRLOCK, "getAssetData", [token]).then((r) => dopplerPad(r as never)),
    read(CLANKER_ABI, CLANKER_FACTORY, "deploymentInfoForToken", [token]).then((r) => clankerPad(r as never)),
    read(ZORA_ABI, ZORA_FACTORY, "getVersionForDeployedCoin", [token]).then((r) => zoraPad(Number(r))),
  ]);
  const proven = found.find((p): p is Proven => p !== null);
  if (token.toLowerCase().endsWith(FEEL_SUFFIX) && proven?.id !== "feel") {
    return {
      kind: "claimed",
      name: "Feel.cash",
      why: `its address ends in "${FEEL_SUFFIX}" like Feel.cash's launches, but Doppler's Airlock has no Feel.cash record of it${proven ? ` — it was made by ${proven.name}` : ""}`,
    };
  }
  if (proven) return proven;
  const claims = await read(BASEPAD_ABI, token, "factory", []).catch(refusedIsNull);
  if (typeof claims === "string" && same(claims, BASEPAD.factory)) {
    return { kind: "claimed", name: "basepad.si", why: "the token names basepad's factory as its maker, but the factory has no record of it" };
  }
  return { kind: "unknown" };
}

// ── The radar's cheap version: one eth_getLogs for a window ─────────────────

export const BASEPAD_LAUNCHED_TOPIC = toHex(keccak256(utf8("Launched(address,uint256,address,address,bytes32,int24,uint24,uint256,string)")));
export const DOPPLER_CREATE_TOPIC = toHex(keccak256(utf8("Create(address,address,address,address)")));

/**
 * Token → launchpad name, from basepad's `Launched` (the token is topic 1) and the Airlock's `Create`
 * (the asset is the first data word) logs in a window. Feel.cash is NOT named here: its proof is the
 * integrator in the Airlock's record, a read per token — the radar says "Doppler", the verdict says which.
 */
export function parsePadLogs(logs: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of listOf(logs)) {
    if (!isObj(l)) continue;
    const topics = listOf(l.topics).filter((t): t is string => typeof t === "string");
    const data = strOf(l.data) ?? "";
    if (topics[0] === BASEPAD_LAUNCHED_TOPIC && topics[1]) out.set(`0x${topics[1].slice(-40)}`.toLowerCase(), "basepad.si");
    else if (topics[0] === DOPPLER_CREATE_TOPIC && data.length >= 66) out.set(`0x${data.slice(26, 66)}`.toLowerCase(), "Doppler");
  }
  return out;
}

export async function padsBetween(from: number, to: number): Promise<Map<string, string>> {
  const logs = await rpc("eth_getLogs", [
    { address: [BASEPAD.factory, DOPPLER_AIRLOCK], topics: [[BASEPAD_LAUNCHED_TOPIC, DOPPLER_CREATE_TOPIC]], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` },
  ]);
  return parsePadLogs(logs);
}
