import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256 as viemKeccak, toHex as viemHex } from "viem";
import { BASEPAD, CLANKER_FACTORY, DOPPLER_AIRLOCK, FEEL_INTEGRATOR, ZORA_FACTORY } from "@/config/launchpads";
import { BLOCKSCOUT } from "@/skills/blockscout";
import { parseMarkets } from "@/skills/dexscreener";
import {
  BASEPAD_LAUNCHED_TOPIC,
  basepadPad,
  DOPPLER_CREATE_TOPIC,
  dopplerPad,
  clankerPad,
  launchpadOf,
  padsBetween,
  parsePadLogs,
  type Proven,
} from "@/skills/launchpads";
import { atLeastOne, originOf, PAGE, type Launcher } from "@/skills/origin";
import { launchpadRow, originRows } from "@/skills/verdict";
import { row } from "@/skills/types";
import { copy } from "./fixtures/base";
import { factoryCalls, LAUNCHPAD, LX } from "./fixtures/launchpad";
import { padCalls, PADS_TOKENS as T, PX } from "./fixtures/launchpads";
import { LAUNCHERS, TOKENS, VX } from "./fixtures/verdict";
import { DOWN, net, useNet, type Answer } from "./net";
import { withoutV3 } from "./v2only";

// Its fixtures are real v2/v1 captures, so it runs as the app did before v3 was set.
withoutV3();

useNet();

/**
 * The launchpads are judged on their own records, captured from the chain 2026-10-14
 * (fixtures/launchpads): basepad's `infoOf`, Doppler's Airlock `getAssetData` (Feel.cash and another
 * integrator), Clanker's `deploymentInfoForToken`, Zora's `getVersionForDeployedCoin`, for a token of
 * each and for DEGEN. Variants are built from those, visibly, in the tests.
 */

const rpcOf = (route: (m: string, p: readonly unknown[]) => unknown) => ({ rpc: (m: string, p: readonly unknown[]) => route(m, p) as Answer | undefined });
const both = (as: Parameters<typeof padCalls>[0] = {}) => (m: string, p: readonly unknown[]) => factoryCalls()(m, p) ?? padCalls(as)(m, p);

async function proven(token: string, as: Parameters<typeof padCalls>[0] = {}): Promise<Proven> {
  net(rpcOf(both(as)));
  const pad = await launchpadOf(token);
  if (pad.kind !== "proven") throw new Error(`expected proven, got ${pad.kind}`);
  return pad;
}

describe("which launchpad made a token, from its own record", () => {
  /** MEASURED 2026-10-03: this token was named "through DelegationManager". basepad's factory says otherwise. */
  it("proves the DelegationManager token is basepad's, with the launcher basepad recorded", async () => {
    const pad = await proven(T.basepadToken);
    expect(pad).toEqual({
      kind: "proven",
      id: "basepad",
      name: "basepad.si",
      address: BASEPAD.factory,
      how: "basepad's factory recorded it as launch #3106859",
      guarantees: [
        "fixed supply; the token has no owner, mint, pause, blacklist or tax",
        "the whole supply was placed in one Uniswap v4 position held by an ownerless locker with no withdraw path",
        "1% pool fee: 95% to the creator's recipients, 5% to basepad",
      ],
      launcher: "0x9F9B1b095831e39b90C56991E1a259304354B09f",
    });
  });

  it("proves Feel.cash by the integrator the Airlock recorded, and names any other integrator plain Doppler", async () => {
    const feel = await proven(T.feelToken);
    expect(feel).toMatchObject({ id: "feel", name: "Feel.cash", address: DOPPLER_AIRLOCK, launcher: null });
    expect(feel.guarantees).toEqual(["100% of the supply sold through its pool", "no governance", "its liquidity never migrates (Doppler's NoOpMigrator)"]);
    const doppler = await proven(T.dopplerToken);
    expect(doppler).toMatchObject({ id: "doppler", name: "Doppler", how: "Doppler's Airlock recorded it (integrator 0xF606…163e)" });
    // its record sold 85% of the supply, and its timelock is zero, not dead: no governance claim
    expect(doppler.guarantees).toEqual(["85% of the supply sold through its pool", "no governance", "its liquidity never migrates (Doppler's NoOpMigrator)"]);
  });

  it("proves Clanker and Zora by their factories' records — and promises nothing they do not show", async () => {
    expect(await proven(T.boar)).toMatchObject({ id: "clanker", address: CLANKER_FACTORY, guarantees: [] });
    expect(await proven(T.clankerToken)).toMatchObject({ id: "clanker", launcher: null, admin: "0xE7535782201A2165DE705f6B9f7144b481D33b50" });
    expect(clankerPad(null)).not.toHaveProperty("admin");
    expect(clankerPad("0x0000000000000000000000000000000000000000")).not.toHaveProperty("admin");
    // BOAR's named admin is not the wallet that launched it — so it is never called the launcher
    expect(await proven(T.boar)).toMatchObject({ launcher: null, admin: "0x32d1C8A4d133241a710d780f1198992A015Ea5Ed" });
    expect(await proven(T.zoraCoin)).toMatchObject({ id: "zora", address: ZORA_FACTORY, how: "Zora's coin factory recorded it (coin version 4); the factory itself is upgradeable" });
  });

  it("asks nothing else for this app's own token", async () => {
    net(rpcOf(factoryCalls({ [LAUNCHPAD.test.toLowerCase()]: LX.launchesTest })));
    expect(await launchpadOf(LAUNCHPAD.test)).toMatchObject({ kind: "proven", id: "quadra", launcher: LAUNCHPAD.creator, address: LAUNCHPAD.factory });
  });

  it("is unknown for a direct deploy — DEGEN", async () => {
    net(rpcOf(both()));
    expect(await launchpadOf(T.degen)).toEqual({ kind: "unknown" });
  });

  it("calls an address ending in fee1 without Feel.cash's record a CLAIM", async () => {
    const lookalike = "0x000000000000000000000000000000000000fee1";
    net(rpcOf(both({ [lookalike]: "degen" })));
    expect(await launchpadOf(lookalike)).toEqual({
      kind: "claimed",
      name: "Feel.cash",
      why: 'its address ends in "fee1" like Feel.cash\'s launches, but Doppler\'s Airlock has no Feel.cash record of it',
    });
    net(rpcOf(both({ [lookalike]: "dopplerToken" })));
    expect(await launchpadOf(lookalike)).toMatchObject({ kind: "claimed", why: expect.stringMatching(/— it was made by Doppler$/) });
  });

  it("calls a token naming basepad's factory, which has no record of it, a CLAIM", async () => {
    // DEGEN's empty records, with its factory() answering as the basepad token's did — a variant, built here
    const impostor = T.degen;
    const route = both();
    net(rpcOf((m, p) => {
      const call = (p as [{ to: string; data: string }])[0];
      if (m === "eth_call" && call.to === impostor && call.data === "0xc45a0155") return PX.records.basepadToken.tokenFactory;
      return route(m, p);
    }));
    expect(await launchpadOf(impostor)).toEqual({ kind: "claimed", name: "basepad.si", why: "the token names basepad's factory as its maker, but the factory has no record of it" });
  });

  it("throws when a record cannot be read — never 'unknown'", async () => {
    net(rpcOf((m, p) => {
      const call = (p as [{ to: string }])[0];
      return m === "eth_call" && call.to === ZORA_FACTORY ? DOWN : both()(m, p);
    }));
    await expect(launchpadOf(T.degen)).rejects.toThrow(/RPC/);
    net(rpcOf((m, p) => ((p as [{ data: string }])[0].data === "0xc45a0155" ? DOWN : both()(m, p))));
    await expect(launchpadOf(T.degen)).rejects.toThrow(/RPC/);
  });

  it("reads the records' edges: a feeless basepad pool, an empty Airlock record, a supply of zero", () => {
    expect(basepadPad([1n, BASEPAD.factory, BASEPAD.factory, 0, 0])!.guarantees[2]).toBe("no pool fee");
    const z = "0x0000000000000000000000000000000000000000";
    expect(dopplerPad([z, z, z, z, z, z, z, 0n, 0n, z])).toBeNull();
    expect(dopplerPad([z, z, z, z, BASEPAD.factory, z, z, 0n, 0n, FEEL_INTEGRATOR])!.guarantees).toEqual([]);
  });
});

describe("the radar's launchpad logs", () => {
  it("hashes the two events from their signatures — the captured Create log carries the same topic", () => {
    expect(DOPPLER_CREATE_TOPIC).toBe(PX.padLogs.result[0]!.topics[0]);
    // an external oracle: viem's keccak, not lib/keccak
    expect(BASEPAD_LAUNCHED_TOPIC).toBe(viemKeccak(viemHex("Launched(address,uint256,address,address,bytes32,int24,uint24,uint256,string)")));
    expect(PX.padLogs.params[0]!.topics).toEqual([[BASEPAD_LAUNCHED_TOPIC, DOPPLER_CREATE_TOPIC]]);
  });

  it("names basepad's tokens by topic and Doppler's by the first data word, and skips anything else", () => {
    // a basepad Launched log, built from its event's shape with the measured token — none fell in a window publicnode would serve
    const launched = { topics: [BASEPAD_LAUNCHED_TOPIC, `0x${T.basepadToken.slice(2).padStart(64, "0")}`], data: encodeAbiParameters([{ type: "address" }], [BASEPAD.factory]) };
    const pads = parsePadLogs([...PX.padLogs.result, launched, "junk", { topics: [DOPPLER_CREATE_TOPIC], data: "0x" }, { topics: ["0x1"] }]);
    expect([...pads]).toEqual([
      ["0xeec5dc2169633ac3f68c123d2f86caa3b79d6b21", "Doppler"],
      ["0x6c6abf7fba90b10e5a5518a6d95557471e6d24d0", "Doppler"],
      [T.basepadToken, "basepad.si"],
    ]);
  });

  it("asks for both contracts' logs in one request", async () => {
    const asked: unknown[] = [];
    net({ rpc: (m, p) => (m === "eth_getLogs" ? (asked.push(p[0]), PX.padLogs.result) : undefined) });
    const { fromBlock, toBlock } = PX.padLogs.params[0]!;
    expect((await padsBetween(Number(fromBlock), Number(toBlock))).size).toBe(2);
    expect(asked).toEqual([PX.padLogs.params[0]]);
  });
});

// ── the origin, with the launchpad known ────────────────────────────────────

const historyUrl = (a: string) => `${BLOCKSCOUT}/addresses/${a}/transactions`;
const boarPairs = parseMarkets(VX.dexscreenerBoar);

function blockscout(over: Record<string, Answer> = {}) {
  const table: Record<string, Answer> = {
    [`${BLOCKSCOUT}/addresses/${TOKENS.boar}`]: { ...VX.addressBoar, creation_transaction_hash: VX.creationBoar.hash },
    [`${BLOCKSCOUT}/transactions/${VX.creationBoar.hash}`]: VX.creationBoar,
    [historyUrl(LAUNCHERS.clanker)]: VX.txsClankerLauncher,
    ...over,
  };
  return (url: string) => table[url];
}

describe("where a token came from, when a launchpad proved it", () => {
  /** The bug: the launchpad is the one that PROVED it made the token, and the launcher is the one it recorded. */
  it("names basepad and its recorded launcher for the DelegationManager token, without the transaction", async () => {
    net(rpcOf(both()));
    const pad = await launchpadOf(T.basepadToken);
    if (pad.kind !== "proven") throw new Error("not proven");
    // the launcher's own history could not be captured (Blockscout 403'd that day): CHUBBY's launcher's stands in, visibly
    const stand = { ...pad, launcher: LAUNCHERS.chubby };
    net({ get: (url) => (url === historyUrl(LAUNCHERS.chubby) ? VX.txsChubbyLauncher : undefined) });
    const o = (await originOf(T.basepadToken, [], stand))!;
    expect(o.via).toEqual({ address: BASEPAD.factory, name: "basepad.si" });
    // none of its transactions called basepad directly — a 7702 account calls through its delegate — so "1+"
    expect(o.launcher).toMatchObject({ address: LAUNCHERS.chubby, factoryCalls: 1, callsComplete: false });
    expect(originRows(o, Date.parse("2026-10-01T03:00:00Z"))[0]!.value).toBe("0x46b9…2cDe, through basepad.si");
  });

  const clanker = { kind: "proven", id: "clanker", name: "Clanker", address: CLANKER_FACTORY, how: "", guarantees: [], launcher: null } as const;

  it("takes the launcher from the transaction when the launchpad records none, and counts against the launchpad", async () => {
    net({ get: blockscout() });
    const o = (await originOf(TOKENS.boar, [], clanker))!;
    expect(o).toMatchObject({ via: { address: CLANKER_FACTORY, name: "Clanker" }, launcher: { address: LAUNCHERS.clanker, factoryCalls: PAGE } });
  });

  it("never takes a bundler or Feel.cash's own wallet for the launcher", async () => {
    const bundled = { ...VX.creationBoar, method: "handleOps" };
    net({ get: blockscout({ [`${BLOCKSCOUT}/transactions/${VX.creationBoar.hash}`]: bundled }) });
    expect(await originOf(TOKENS.boar, [], clanker)).toEqual({ via: { address: CLANKER_FACTORY, name: "Clanker" }, launcher: null, relay: "an ERC-4337 bundle" });
    net({ get: blockscout() });
    const feel = { ...clanker, id: "feel", name: "Feel.cash", address: DOPPLER_AIRLOCK } as const;
    expect(await originOf(TOKENS.boar, [], feel)).toEqual({ via: { address: DOPPLER_AIRLOCK, name: "Feel.cash" }, launcher: null, relay: "Feel.cash's own wallet, for a Feel.cash account" });
  });

  it("keeps the launchpad when no launch transaction is on record", async () => {
    const none = { via: { address: CLANKER_FACTORY, name: "Clanker" }, launcher: null, relay: "no launch transaction on record" };
    net({ get: blockscout({ [`${BLOCKSCOUT}/addresses/${TOKENS.boar}`]: VX.addressBoar }) });
    expect(await originOf(TOKENS.boar, [], clanker)).toEqual(none);
    net({ get: blockscout({ [`${BLOCKSCOUT}/transactions/${VX.creationBoar.hash}`]: { hash: VX.creationBoar.hash } }) });
    expect(await originOf(TOKENS.boar, [], clanker)).toEqual(none);
  });
});

describe("where a token came from, with no launchpad known", () => {
  it("names the contract Blockscout says CREATED the token — the factory, when it is also the transaction's `to`", async () => {
    const created = { ...VX.addressBoar, creation_transaction_hash: VX.creationBoar.hash, creator_address_hash: CLANKER_FACTORY };
    net({ get: blockscout({ [`${BLOCKSCOUT}/addresses/${TOKENS.boar}`]: created }) });
    expect(await originOf(TOKENS.boar, [])).toMatchObject({ via: { address: CLANKER_FACTORY, name: "Clanker" }, launcher: { factoryCalls: PAGE } });
  });

  it("names the creator, not the transaction's `to`, when they differ — the DelegationManager case", async () => {
    // BOAR's launch, its creator re-pointed at basepad's factory: the `to` (Clanker here) stands for the relay
    const created = { ...VX.addressBoar, creation_transaction_hash: VX.creationBoar.hash, creator_address_hash: BASEPAD.factory };
    net({ get: blockscout({ [`${BLOCKSCOUT}/addresses/${TOKENS.boar}`]: created }) });
    const o = (await originOf(TOKENS.boar, []))!;
    expect(o.via).toEqual({ address: BASEPAD.factory, name: null });
    expect(o.launcher).toMatchObject({ factoryCalls: 1, callsComplete: false });
    net({ get: blockscout({ [`${BLOCKSCOUT}/addresses/${TOKENS.boar}`]: created, [`${BLOCKSCOUT}/transactions/${VX.creationBoar.hash}`]: { ...VX.creationBoar, method: "handleOps" } }) });
    expect(await originOf(TOKENS.boar, [])).toEqual({ via: { address: BASEPAD.factory, name: null }, launcher: null, relay: "an ERC-4337 bundle" });
  });

  it("does not take a 7702 account's `to` for the launchpad when no creator is on record", async () => {
    const answer = (code: string) => (m: string) =>
      m === "eth_getBlockByNumber" ? VX.rpcLatestBlock : m === "eth_getLogs" ? VX.rpcBoarInitialize : m === "eth_getCode" ? code : undefined;
    net({ get: blockscout({ [`${BLOCKSCOUT}/addresses/${TOKENS.boar}`]: VX.addressBoar }), rpc: answer(PX.code.owner7702) });
    const o = (await originOf(TOKENS.boar, boarPairs))!;
    expect(o).toMatchObject({ via: null, relay: "an EIP-7702 smart account", launcher: { address: LAUNCHERS.clanker } });
    // a transaction a wallet sends to ITSELF is the same thing
    const self = { ...VX.creationBoar, to: { hash: VX.creationBoar.from.hash } };
    net({ get: blockscout({ [`${BLOCKSCOUT}/addresses/${TOKENS.boar}`]: VX.addressBoar, [`${BLOCKSCOUT}/transactions/${VX.creationBoar.hash}`]: self }), rpc: answer(PX.code.clankerLauncher) });
    expect((await originOf(TOKENS.boar, boarPairs))?.relay).toBe("an EIP-7702 smart account");
  });

  it("keeps a factory count that is already there", () => {
    const l = { factoryCalls: 3, callsComplete: true } as Launcher;
    expect(atLeastOne(l)).toBe(l);
  });
});

describe("the launchpad and a relayed launch, as rows", () => {
  it("says proven in green, a claim in red, none plainly, and an unread record in amber", () => {
    const pad: Proven = { kind: "proven", id: "basepad", name: "basepad.si", address: BASEPAD.factory, how: "recorded", guarantees: ["a", "b"], launcher: null };
    expect(launchpadRow(pad)).toEqual([row("Launchpad", "basepad.si: recorded — a; b", { tone: "ok", href: `https://basescan.org/address/${BASEPAD.factory}` })]);
    expect(launchpadRow({ ...pad, guarantees: [] })[0]!.value).toBe("basepad.si: recorded");
    expect(launchpadRow({ kind: "claimed", name: "Feel.cash", why: "no record" })).toEqual([row("Launchpad", "looks like Feel.cash, but is NOT one: no record", { tone: "bad" })]);
    expect(launchpadRow({ kind: "unknown" })[0]!.tone).toBeUndefined();
    expect(launchpadRow(undefined)).toEqual([row("Launchpad", "not checked — the launchpads' records could not be read", { tone: "warn" })]);
  });

  it("says what a relay hid, in amber", () => {
    const now = Date.parse("2026-10-01T03:00:00Z");
    expect(originRows({ via: { address: CLANKER_FACTORY, name: "Clanker" }, launcher: null, relay: "an ERC-4337 bundle" }, now)).toEqual([
      row("Launched by", "an ERC-4337 bundle, through Clanker — the launcher is not identified", { tone: "warn" }),
    ]);
    expect(originRows({ via: null, launcher: null }, now)[0]!.value).toBe("a smart wallet — the launcher is not identified");
    // the launch could not be read: a Clanker token still names the admin its launch recorded, as the admin
    const pad = { kind: "proven", id: "clanker", name: "Clanker", address: CLANKER_FACTORY, how: "", guarantees: [], launcher: null, admin: "0xE7535782201A2165DE705f6B9f7144b481D33b50" } as const;
    expect(originRows(undefined, now, pad)[0]).toMatchObject({
      value: "not read just now — Clanker recorded 0xE753…3b50 as the token's admin at launch (often, not always, its creator)",
      tone: "warn",
    });
    expect(originRows(undefined, now, { ...pad, admin: undefined } as never)[0]!.value).toMatch(/^not checked — its launch could not be read just now/);
    const launcher = copy({ address: LAUNCHERS.chubby, complete: true, txCount: 1, firstSeen: null, deployments: 0, factoryCalls: 0, callsComplete: true, funder: null, pulledAt: null });
    expect(originRows({ via: null, launcher, relay: "an EIP-7702 smart account" }, now)[0]).toEqual(
      row("Launched by", "0x46b9…2cDe, through an EIP-7702 smart account — the contract that created the token is not identified", {
        tone: "warn",
        href: `https://basescan.org/address/${LAUNCHERS.chubby}`,
        next: `profile ${LAUNCHERS.chubby}`,
      }),
    );
  });
});
