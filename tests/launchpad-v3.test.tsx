import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, erc20Abi, parseAbiParameters } from "viem";
import { BASE, CONTRACTS, UNISWAP_V4_POOL_MANAGER } from "@/config/chain";
import { DYNAMIC_FEE_FLAG, feePercent, LAUNCH_HOOK_ABI, LAUNCHPAD_V3_ABI, LAUNCHPAD_V3_EXPECTS } from "@/config/launchpad";
import { checkFactory, launchFactory, launchTx, LAUNCH_FEES, type Metadata, type Pair } from "@/adapters/http/launchpad";
import { coinFeeOf, factories, isV3, launchOf, poolIdOf, v3FeeOf } from "@/skills/launchpad";
import { NATIVE, poolKeyOf } from "@/lib/v4swap";
import { feeOf, prepareLaunch, prepareLaunchSkill, referrerArg } from "@/skills/prepare";
import { launchpadRows, referrerRows } from "@/skills/verdict";
import { Disclosures, feeLine, FLAT_FEE, openingWords, TokenInfo, useCoinFee, useCoinReferrer } from "@/features/panels/TokenPage";
import { listFee, versionOf, type Listed } from "@/features/panels/CoinsPanel";
import { BaseLaunch, openingText } from "@/features/panels/BaseLaunch";
import { applyLaunches, applyReferrals, applySwaps, coinDetail, emptyState, snapshot, SWAP_TOPIC, syncOnce, type Rpc } from "@/server/indexer";
import { parseCoinPage, parseIndex } from "@/adapters/http/indexer";
import { isApprovedReferrer, LAUNCHED_TOPIC, REFERRED_TOPIC, referrerOf, v3ReferrerOf } from "@/skills/launchpad";
import { toChecksumAddress } from "@/lib/address";
import { BLOCKSCOUT } from "@/skills/blockscout";
import { STOCKS_PATH } from "@/server/stocks";
import { forgetCatalog } from "@/adapters/http/markets";
import { WalletProvider } from "@/ui/WalletProvider";
import type { Eip1193Provider, Eip1193Request } from "@/lib/wallet";
import { contractAt, DOWN, ethCalls, net, simulated, useNet } from "./net";

useNet();
vi.mock("@/lib/connectors", () => ({ walletConnectProvider: vi.fn(), coinbaseProvider: vi.fn() }));

/**
 * Launchpad v3 as the app reads and sends to it. v3 is NOT DEPLOYED, so no capture of it exists:
 * every answer below is ENCODED with viem from the hand-written ABI (the chain's own encoding, held
 * to the Solidity by the first block of tests), and the addresses are stand-ins nothing is deployed
 * at. The contract itself is tested in Solidity (contracts/test) and against real Base state
 * (scripts/simulate-launchpad-v3.ts, which drives this app's own launchTx and v4swap).
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const V3 = toChecksumAddress("0x00000000000000000000000000000000000000f3");
const HOOK = toChecksumAddress("0x0000000000000000000000000000000000002880");
const TOKEN = "0xB200000000000000000000e326469391488619D9";
const ME = "0xabcdef0123456789abcdef0123456789abcdef01";
const ETH_Q = "0x0000000000000000000000000000000000000000";
const SALT = `0x${"11".repeat(32)}` as const;
const OPENED = 1_790_000_000;
const META: Metadata = { name: "Night Cat", symbol: "NCAT", description: "", image: "", website: "" };
const ETH_PAIR: Pair = { address: ETH_Q, symbol: "ETH", name: "Ether", decimals: 18, startTick: 191_200 };
const KEY = { currency0: ETH_Q, currency1: TOKEN, fee: DYNAMIC_FEE_FLAG, tickSpacing: 200, hooks: HOOK };
const RECORD = { creator: ME, creatorRecipient: ME, key: KEY };
/** A stand-in referrer — Blue Agent's real address is the owner's to give, never guessed here. */
const REFERRER = toChecksumAddress("0x5157000000000000000000000000000000beefca");

type Saved = Pick<typeof CONTRACTS, "launchFactory" | "launchFactoryV1" | "launchFactoryV3">;
const saved: Saved = { launchFactory: CONTRACTS.launchFactory, launchFactoryV1: CONTRACTS.launchFactoryV1, launchFactoryV3: CONTRACTS.launchFactoryV3 };
/** Point the app at the stand-in v3 (and, unless kept, at nothing else). */
function pin(over: Partial<Saved> = {}) {
  Object.assign(CONTRACTS as { -readonly [K in keyof Saved]: Saved[K] }, { launchFactoryV3: V3, launchFactory: null, launchFactoryV1: null, ...over });
}
afterEach(() => Object.assign(CONTRACTS as { -readonly [K in keyof Saved]: Saved[K] }, saved));

/** The v3 factory as `launches`, `quotes` and its getters answer — viem-encoded from the ABI. */
function factory(over: Record<string, unknown> = {}, record: unknown = RECORD) {
  const getters = contractAt(LAUNCHPAD_V3_ABI, {
    TOTAL_SUPPLY: LAUNCHPAD_V3_EXPECTS.supply,
    FEE_LOW: 10_000,
    FEE_HIGH: 30_000,
    CREATOR_SHARE_BPS: 8_000,
    REFERRER_SHARE_BPS: 500,
    approvedReferrers: false,
    referrerOf: ETH_Q,
    TICK_SPACING: 200,
    protocolRecipient: CONTRACTS.treasury!,
    hook: HOOK,
    predictToken: TOKEN,
    ...over,
  });
  return (data: `0x${string}`): `0x${string}` => {
    const { functionName } = decodeFunctionData({ abi: LAUNCHPAD_V3_ABI, data });
    if (functionName === "quotes") return encodeFunctionResult({ abi: LAUNCHPAD_V3_ABI, functionName, result: [true, 191_200] });
    if (functionName === "launches") return encodeFunctionResult({ abi: LAUNCHPAD_V3_ABI, functionName, result: record as never });
    return getters(data);
  };
}
/** The hook: its own factory, the deploy's opening, and this coin's schedule (3%). */
function hook(over: Record<string, unknown> = {}) {
  return contractAt(LAUNCH_HOOK_ABI, { factory: V3, startFee: 500_000, window: 15, schedules: [30_000, OPENED], currentFee: 30_000, ...over });
}

describe("held to the Solidity", () => {
  const flat = (path: string) => readFileSync(resolve(ROOT, path), "utf8").replace(/\s+/g, " ");
  const factorySol = flat("contracts/src/LaunchFactoryV3.sol");
  const hookSol = flat("contracts/src/LaunchHook.sol");
  const script = readFileSync(resolve(ROOT, "contracts/script/DeployLaunchFactoryV3.s.sol"), "utf8");

  it("finds every v3 function and event the app calls, word for word, in the contract", () => {
    for (const piece of [
      "function launch( string calldata name, string calldata symbol, string calldata contractURI, bytes32 salt, address quote, uint256 quoteIn, uint24 fee, address referrer ) external payable nonReentrant returns (address token)",
      "uint16 public constant REFERRER_SHARE_BPS = 500;",
      "mapping(address referrer => bool) public approvedReferrers;",
      "mapping(address token => address) public referrerOf;",
      "event Referred(address indexed token, address indexed referrer);",
      // collect: the creator's 80%, a recorded referrer's 5%, and the protocol takes the REMAINDER
      "_send(currency, protocolRecipient, amount - toCreator - toReferrer);",
      "function collect(address token) external nonReentrant returns (uint256 amount0, uint256 amount1)",
      "function predictToken(address caller, bytes32 salt) external view returns (address)",
      "uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;",
      "uint24 public constant FEE_LOW = 10_000;",
      "uint24 public constant FEE_HIGH = 30_000;",
      "int24 public constant TICK_SPACING = 200;",
      "uint16 public constant CREATOR_SHARE_BPS = 8_000;",
      "LaunchHook public immutable hook;",
      "mapping(address quote => Quote) public quotes;",
      "address public protocolRecipient;",
      "function launches(address token) external view returns (Launch memory)",
      "fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,",
      "event Launched( address indexed token, address indexed creator, PoolId indexed poolId, uint256 devBuyIn, uint256 devBuyTokens );",
      "event LaunchFee(address indexed token, uint24 fee);",
    ]) {
      expect(factorySol, piece).toContain(piece);
    }
    for (const piece of [
      "address public immutable factory;",
      "uint24 public immutable startFee;",
      "uint32 public immutable window;",
      "struct Schedule { /// @notice the coin's chosen fee (FEE_LOW or FEE_HIGH); 0 for a pool this hook never opened uint24 fee; /// @notice the block timestamp the pool opened at uint40 openedAt; }",
      "mapping(PoolId id => Schedule) public schedules;",
      "function currentFee(PoolId id) public view returns (uint24)",
    ]) {
      expect(hookSol, piece).toContain(piece);
    }
    expect(DYNAMIC_FEE_FLAG).toBe(0x800000);
    expect(LAUNCH_FEES).toEqual([LAUNCHPAD_V3_EXPECTS.feeLow, LAUNCHPAD_V3_EXPECTS.feeHigh]);
    expect(REFERRED_TOPIC).toBe(encodeEventTopics({ abi: LAUNCHPAD_V3_ABI, eventName: "Referred" })[0]);
  });

  it("expects the hook's opening and the fee address the deploy script deploys with", () => {
    expect(script).toContain(`uint24 internal constant START_FEE = ${LAUNCHPAD_V3_EXPECTS.startFee.toLocaleString("en-US").replace(/,/g, "_")};`);
    expect(script).toContain(`uint32 internal constant WINDOW = ${LAUNCHPAD_V3_EXPECTS.window};`);
    expect(script).toContain(`address internal constant TREASURY = ${CONTRACTS.treasury};`);
  });

  it("says a fee as a person reads it", () => {
    expect([feePercent(10_000), feePercent(30_000), feePercent(500_000), feePercent(466_666)]).toEqual(["1%", "3%", "50%", "46.67%"]);
  });
});

describe("which factory new launches go to", () => {
  it("v3 as deployed (2026-10-22) by default, v2 while v3 is unset, and every reader lists v3 first", () => {
    expect(CONTRACTS.launchFactoryV3).toBe("0x006Da367654a487bb277fe25ff54f0fE0f741377");
    expect(launchFactory()).toEqual({ address: toChecksumAddress(CONTRACTS.launchFactoryV3!), version: 3 });
    expect(factories()).toEqual([CONTRACTS.launchFactoryV3, CONTRACTS.launchFactory, CONTRACTS.launchFactoryV1]);
    expect(isV3(CONTRACTS.launchFactory!)).toBe(false);
    pin({ launchFactoryV3: null, launchFactory: saved.launchFactory, launchFactoryV1: saved.launchFactoryV1 });
    expect(launchFactory()).toEqual({ address: saved.launchFactory, version: 2 });
    expect(factories()).toEqual([saved.launchFactory, saved.launchFactoryV1]);
    pin({ launchFactory: saved.launchFactory, launchFactoryV1: saved.launchFactoryV1 });
    expect(launchFactory()).toEqual({ address: V3, version: 3 });
    expect(factories()).toEqual([V3, saved.launchFactory, saved.launchFactoryV1]);
    expect(isV3(V3.toLowerCase())).toBe(true);
  });

  it("builds v3's launch with the fee and the referrer (none by default) as its last arguments, and v2's without", () => {
    const v3 = launchTx(V3, META, SALT, ETH_PAIR, 5n, 30_000);
    expect(v3.value).toBe(5n);
    expect(decodeFunctionData({ abi: LAUNCHPAD_V3_ABI, data: v3.data! }).args!.slice(4)).toEqual([ETH_Q, 5n, 30_000, ETH_Q]);
    const referred = launchTx(V3, META, SALT, ETH_PAIR, 0n, 10_000, REFERRER);
    expect(decodeFunctionData({ abi: LAUNCHPAD_V3_ABI, data: referred.data! }).args!.at(-1)).toBe(REFERRER);
    expect(() => decodeFunctionData({ abi: LAUNCHPAD_V3_ABI, data: launchTx(V3, META, SALT, ETH_PAIR, 5n).data! })).toThrow();
  });
});

describe("checking v3 before anything is offered", () => {
  it("accepts it only when its numbers and its hook's are this build's, and hands back the opening it read", async () => {
    net({ rpc: ethCalls({ [V3]: factory(), [HOOK]: hook() }) });
    expect(await checkFactory(V3, 3)).toEqual({ kind: "ok", opening: { hook: HOOK, startFee: 500_000, window: 15 } });
    // Stage C: the FeeRouter as protocol recipient is this app's fee address too
    net({ rpc: ethCalls({ [V3]: factory({ protocolRecipient: CONTRACTS.feeRouter! }), [HOOK]: hook() }) });
    expect((await checkFactory(V3, 3)).kind).toBe("ok");
    // no ETH opening tick is pinned on v3: a re-priced ETH pair does not lock the launchpad
    const other = "0x1111111111111111111111111111111111111111";
    for (const [f, h, why] of [
      [{ TOTAL_SUPPLY: 1n }, {}, `its supply is 1, not ${LAUNCHPAD_V3_EXPECTS.supply}`],
      [{ FEE_LOW: 5_000 }, {}, "its fees are 5000 and 30000, not 10000 and 30000"],
      [{ FEE_HIGH: 50_000 }, {}, "its fees are 10000 and 50000, not 10000 and 30000"],
      [{ CREATOR_SHARE_BPS: 5_000 }, {}, "its launcher share is 5000 bps, not 8000"],
      [{ REFERRER_SHARE_BPS: 1_000 }, {}, "its referrer share is 1000 bps, not 500"],
      [{ TICK_SPACING: 60 }, {}, "its tick spacing is 60, not 200"],
      [{ protocolRecipient: other }, {}, `its protocol share goes to ${other}, not to this app's fee address`],
      [{}, { factory: other }, `its hook ${HOOK} belongs to ${other}, not to this launchpad`],
      [{}, { startFee: 100_000 }, "its hook opens at a fee of 100000 over 15 s, not 500000 over 15 s"],
      [{}, { window: 60 }, "its hook opens at a fee of 500000 over 60 s, not 500000 over 15 s"],
    ] as const) {
      net({ rpc: ethCalls({ [V3]: factory(f), [HOOK]: hook(h) }) });
      expect(await checkFactory(V3, 3)).toEqual({ kind: "refused", why: `This build will not sign for the launchpad at ${V3}: ${why}. Nothing was sent.` });
    }
  });
});

describe("reading a v3 coin's fee", () => {
  it("takes the chosen fee and the opening from the hook, by the pool id of the whole key", async () => {
    pin();
    let asked: unknown = null;
    net({
      rpc: ethCalls({
        [V3]: factory(),
        [HOOK]: (data) => {
          const d = decodeFunctionData({ abi: LAUNCH_HOOK_ABI, data });
          if (d.functionName === "schedules") asked = d.args[0];
          return hook()(data);
        },
      }),
    });
    expect(await coinFeeOf(V3, TOKEN)).toEqual({ fee: 30_000, opening: { startFee: 500_000, window: 15, openedAt: OPENED } });
    // the id hashes the dynamic flag and the hook, exactly as v4-core does
    expect(asked).toBe(poolIdOf(KEY));
    expect(poolIdOf(KEY)).not.toBe(poolIdOf({ ...KEY, fee: 10_000 }));
    expect(await v3FeeOf({ factory: V3 }, TOKEN)).toEqual({ fee: 30_000, opening: { startFee: 500_000, window: 15, openedAt: OPENED } });
  });

  it("refuses a pool the hook never scheduled rather than read it as 0%, and says unread as undefined", async () => {
    pin();
    net({ rpc: ethCalls({ [V3]: factory(), [HOOK]: hook({ schedules: [0, 0] }) }) });
    await expect(coinFeeOf(V3, TOKEN)).rejects.toThrow(`the hook ${HOOK} has no fee schedule for ${TOKEN}'s pool`);
    expect(await v3FeeOf({ factory: V3 }, TOKEN)).toBeUndefined();
  });

  it("reads a v1/v2 key's fee from the key itself, and asks nothing for a coin that is not v3", async () => {
    pin({ launchFactory: saved.launchFactory });
    net({ rpc: ethCalls({ [saved.launchFactory!]: factory({}, { ...RECORD, key: { ...KEY, fee: 10_000, hooks: ETH_Q } }) }) });
    expect(await coinFeeOf(saved.launchFactory!, TOKEN)).toEqual({ fee: 10_000, opening: null });
    net({});
    expect(await v3FeeOf({ factory: saved.launchFactory! }, TOKEN)).toBeNull();
    expect(await v3FeeOf(null, TOKEN)).toBeNull();
    expect(await v3FeeOf(undefined, TOKEN)).toBeNull();
  });
});

describe("trading a v3 coin through its own pool", () => {
  it("accepts the dynamic-fee key with the factory's own hook, read from the factory", async () => {
    pin();
    net({ rpc: ethCalls({ [V3]: factory() }) });
    expect(await launchOf(TOKEN)).toEqual({ factory: V3, creator: toChecksumAddress(ME), creatorRecipient: toChecksumAddress(ME) });
    expect(await poolKeyOf(TOKEN)).toEqual({
      factory: V3,
      key: { currency0: NATIVE, currency1: TOKEN, fee: DYNAMIC_FEE_FLAG, tickSpacing: 200, hooks: HOOK },
      token: TOKEN,
      quote: NATIVE,
      tokenIs0: false,
    });
  });

  it("refuses a v3 key whose hook is not the factory's, and a dynamic key with no hook", async () => {
    pin();
    net({ rpc: ethCalls({ [V3]: factory({ hook: "0x2222222222222222222222222222222222222222" }) }) });
    await expect(poolKeyOf(TOKEN)).rejects.toThrow(/^This build will not trade through .*hook 0x0000000000000000000000000000000000002880.* Nothing was sent\.$/);
    net({ rpc: ethCalls({ [V3]: factory({}, { ...RECORD, key: { ...KEY, fee: 30_000 } }) }) });
    await expect(poolKeyOf(TOKEN)).rejects.toThrow(/recorded fee 30000/);
  });
});

describe("Launch (prepared) on v3", () => {
  const CREATOR = "0xD5C1dFc036F9911348EA8065F73c8123f4013FAB";
  const value = (r: Awaited<ReturnType<typeof prepareLaunch>>, label: string) => r.rows.find((x) => x.label === label)?.value;

  it("reads the fee: 1% or 3%, 1% when left out; refused on v2 with a sentence, and anything else by name", () => {
    expect([feeOf("", 3), feeOf("1%", 3), feeOf(" 3 % ", 3), feeOf("3", 3)]).toEqual([10_000, 10_000, 30_000, 30_000]);
    expect(() => feeOf("2%", 3)).toThrow('The fee must be 1% or 3%; "2%" is neither.');
    expect(feeOf(" ", 2)).toBeUndefined();
    expect(() => feeOf("3%", 2)).toThrow('This launchpad (version 2) has one fee, 1% — a fee of "3%" cannot be chosen until version 3 is deployed. Leave the fee out.');
    expect(prepareLaunchSkill.args.at(-2)).toMatchObject({ name: "fee", optional: true });
    expect(prepareLaunchSkill.args.at(-1)).toMatchObject({ name: "referrer", optional: true });
  });

  it("prepares a 3% launch with the opening its hook answered, and says the fee everywhere", async () => {
    pin();
    net({ rpc: (m, p) => (m === "eth_getBalance" ? `0x${(10n ** 17n).toString(16)}` : ethCalls({ [V3]: factory(), [HOOK]: hook() })(m, p)) });
    const r = await prepareLaunch(["Night_Cat", "NCAT", CREATOR, "", "", "3%"]);
    expect(value(r, "Fee")).toBe("3% of every trade, chosen for this coin (1% or 3%)");
    expect(value(r, "Opening protection")).toBe(
      "for the first 15 s the fee falls from 50% to 3% — a sniper pays most of it; the creator's own first buy inside the launch pays only 3%",
    );
    expect(value(r, "Launchpad")).toBe(`${V3} (version 3) — checked: supply, 1%/3% fees, 80/20 split, fee address, its hook's opening`);
    expect(decodeFunctionData({ abi: LAUNCHPAD_V3_ABI, data: value(r, "Step 1 data") as `0x${string}` }).args!.slice(-2)).toEqual([30_000, ETH_Q]);
    expect(r.notes.join(" ")).toContain("80% of the pool's 3% fee; Quadra 20%");
    expect(value(r, "Referrer")).toBeUndefined();
  });

  it("takes a referrer, says whether the launchpad approves it — and an unread answer as not checked", async () => {
    pin();
    const run = async (approved: boolean | "down") => {
      net({
        rpc: (m, p) =>
          m === "eth_getBalance"
            ? `0x${(10n ** 17n).toString(16)}`
            : ethCalls({
                [V3]: (data) =>
                  decodeFunctionData({ abi: LAUNCHPAD_V3_ABI, data }).functionName === "approvedReferrers" && approved === "down"
                    ? (DOWN as never)
                    : factory({ approvedReferrers: approved === true })(data),
                [HOOK]: hook(),
              })(m, p),
      });
      return prepareLaunch(["Night_Cat", "NCAT", CREATOR, "", "", "", REFERRER]);
    };
    const yes = await run(true);
    expect(yes.rows.find((x) => x.label === "Referrer")).toMatchObject({
      tone: "ok",
      value: `${REFERRER} — approved: recorded for this coin; every fee splits 80% creator / 5% referrer / ~15% Quadra`,
    });
    expect(decodeFunctionData({ abi: LAUNCHPAD_V3_ABI, data: value(yes, "Step 1 data") as `0x${string}` }).args!.slice(-2)).toEqual([10_000, REFERRER]);
    expect(yes.notes.join(" ")).toContain("the referrer 5%, Quadra the rest (~15%)");
    const no = await run(false);
    expect(no.rows.find((x) => x.label === "Referrer")).toMatchObject({ tone: "warn" });
    expect(value(no, "Referrer")).toContain("NOT approved by the launchpad: the launch still goes through, recorded with no referrer");
    expect(no.notes.join(" ")).toContain("Quadra 20%");
    const unread = await run("down");
    expect(unread.rows.find((x) => x.label === "Referrer")).toMatchObject({ tone: "warn", value: `${REFERRER} — not checked: whether the launchpad approves it could not be read` });
    // the EIP-55 door: a mistyped checksum is refused, never "corrected"
    expect(REFERRER).toMatch(/[A-F]/);
    await expect(prepareLaunch(["Night_Cat", "NCAT", CREATOR, "", "", "", REFERRER.replace(/[A-F]/, (c) => c.toLowerCase())])).rejects.toThrow(/Referrer/);
  });

  it("refuses a referrer on v2 before reading anything", async () => {
    // v2 behaviour: v3 unset, as before its deploy
    pin({ launchFactoryV3: null, launchFactory: saved.launchFactory, launchFactoryV1: saved.launchFactoryV1 });
    net({});
    expect(referrerArg(" ", 2)).toBeNull();
    await expect(prepareLaunch(["Night_Cat", "NCAT", CREATOR, "", "", "", REFERRER])).rejects.toThrow(
      "This launchpad (version 2) has no referrals — a referrer can be named once version 3 is deployed. Leave the referrer out.",
    );
  });

  it("refuses a fee on v2 before reading anything", async () => {
    // v2 behaviour: v3 unset, as before its deploy
    pin({ launchFactoryV3: null, launchFactory: saved.launchFactory, launchFactoryV1: saved.launchFactoryV1 });
    net({});
    await expect(prepareLaunch(["Night_Cat", "NCAT", CREATOR, "", "", "3%"])).rejects.toThrow("has one fee, 1%");
  });
});

describe("what the verdict, the coin page and the list say about a v3 coin", () => {
  const v3Record = { factory: V3, creator: toChecksumAddress(ME), creatorRecipient: toChecksumAddress(ME) };
  const fee = { fee: 30_000, opening: { startFee: 500_000, window: 15, openedAt: OPENED } };

  it("Token Verdict names the version, the fee and the opening — and an unread hook as not checked", () => {
    pin();
    const rows = launchpadRows(v3Record, fee);
    expect(rows[0]!.value).toMatch(/^version 3 — fixed supply with no admin/);
    expect(rows[1]).toMatchObject({ label: "Its fee", tone: "ok", value: "3% of every trade (its creator chose 1% or 3%); anti-sniper opening: for the first 15 seconds the fee fell from 50% to 3%" });
    expect(launchpadRows(v3Record, { fee: 10_000, opening: null })[1]!.value).toBe("1% of every trade (its creator chose 1% or 3%)");
    expect(launchpadRows(v3Record, undefined)[1]).toMatchObject({ value: "not checked — the launchpad's hook could not be read", tone: "warn" });
    // v2 says what it always said
    expect(launchpadRows({ ...v3Record, factory: saved.launchFactory! }).map((r) => r.label)).toEqual(["Launched on Quadra's launchpad", "Its creator"]);
  });

  it("the coin page's fee line: the fee, the opening, and the most a trade paid when it was more", () => {
    expect(openingWords(fee)).toBe("for the first 15 seconds the fee fell from 50% to 3%");
    expect(openingWords(FLAT_FEE)).toBeNull();
    expect(feeLine(fee, 4666.66)).toBe("3% of every trade, paid to the pool — for the first 15 seconds the fee fell from 50% to 3%; the most a trade paid was 46.67%");
    expect(feeLine(fee, 300)).toBe("3% of every trade, paid to the pool — for the first 15 seconds the fee fell from 50% to 3%");
    expect(feeLine(fee, null)).toBe("3% of every trade, paid to the pool — for the first 15 seconds the fee fell from 50% to 3%");
    expect(feeLine(FLAT_FEE, 100)).toBe("1% of every trade, paid to the pool");
    expect(feeLine("reading", null)).toBe("reading its fee…");
    expect(feeLine({ problem: "x" }, null)).toBe("not checked — its fee could not be read: x");
  });

  it("Disclosures say the opening in the hook's numbers on v3, and keep v1/v2's words", () => {
    pin();
    const a = render(<Disclosures factory={V3} fee={fee} />);
    expect(a.container).toHaveTextContent("Anti-sniping opening (v3). for the first 15 seconds the fee fell from 50% to 3% — a bot buying in the first seconds paid most of that; the creator's own first buy, inside the launch, paid only 3%.");
    expect(a.container).toHaveTextContent("Fee split. 3% of every trade (the creator chose 1% or 3%), in whatever was paid in");
    a.unmount();
    const b = render(<Disclosures factory={V3} fee="reading" />);
    expect(b.container).toHaveTextContent("Reading the opening from the launchpad's hook…");
    expect(b.container).toHaveTextContent("Fee split. The coin's fee on every trade (the creator chose 1% or 3%)");
    b.unmount();
    const c = render(<Disclosures factory={V3} fee={{ problem: "down" }} />);
    expect(c.container).toHaveTextContent("Not checked — the hook could not be read: down");
    c.unmount();
    const d = render(<Disclosures factory={V3} fee={FLAT_FEE} />);
    expect(d.container).toHaveTextContent("no opening was recorded");
    d.unmount();
    const e = render(<Disclosures factory={saved.launchFactory!} />);
    expect(e.container).toHaveTextContent("No anti-sniping on this launchpad version. v2 opens trading at the normal 1% fee");
    expect(e.container).toHaveTextContent("Fee split. 1% of every trade, in whatever was paid in");
    e.unmount();
    const f = render(<TokenInfo page="reading" creator={ME} launchedAt={null} quoteUsd={null} fee={fee} />);
    expect(f.container).toHaveTextContent("Trading fee3% of every trade, paid to the pool — for the first 15 seconds");
  });

  it("useCoinFee reads a v3 coin's fee from its hook, and gives v1/v2 the flat 1% without asking", async () => {
    pin();
    net({ rpc: ethCalls({ [V3]: factory(), [HOOK]: hook() }) });
    const Show = ({ f }: { f: string }) => <p>{feeLine(useCoinFee(f, TOKEN), null)}</p>;
    const a = render(<Show f={V3} />);
    expect(a.container).toHaveTextContent("reading its fee…");
    await waitFor(() => expect(a.container).toHaveTextContent("3% of every trade"));
    a.unmount();
    net({ rpc: ethCalls({ [V3]: factory(), [HOOK]: () => DOWN as never }) });
    const b = render(<Show f={V3} />);
    await waitFor(() => expect(b.container).toHaveTextContent("not checked — its fee could not be read"));
    b.rerender(<Show f={saved.launchFactory!} />);
    await waitFor(() => expect(b.container).toHaveTextContent("1% of every trade, paid to the pool"));
    // a page closed before the read lands sets nothing
    net({ rpc: ethCalls({ [V3]: factory(), [HOOK]: hook() }) });
    render(<Show f={V3} />).unmount();
    net({ rpc: ethCalls({ [V3]: factory(), [HOOK]: () => DOWN as never }) });
    render(<Show f={V3} />).unmount();
    await act(async () => {});
  });

  it("the Coins list names a v3 coin's fee, says when it was not read, and says nothing for v1/v2", () => {
    pin({ launchFactoryV1: saved.launchFactoryV1 });
    const coin = { factory: V3, token: TOKEN, creator: ME, block: 1, at: null, tx: "" } satisfies Listed;
    expect(listFee(coin)).toBe("");
    expect(listFee({ ...coin, fee })).toBe(" · 3% fee, anti-sniper opening");
    expect(listFee({ ...coin, fee: undefined })).toBe(" · fee not checked");
    expect(listFee({ ...coin, factory: saved.launchFactory!, fee: null })).toBe("");
    expect([versionOf(V3), versionOf(saved.launchFactory!), versionOf(saved.launchFactoryV1!)]).toEqual(["version 3", "version 2", "version 1"]);
  });
});

describe("the indexer on a v3 coin", () => {
  const POOL_ID = poolIdOf(KEY);
  const SWAP = parseAbiParameters("int128, int128, uint160, uint128, int24, uint24");
  const launched = {
    address: V3,
    blockNumber: "0x10",
    blockTimestamp: `0x${OPENED.toString(16)}`,
    transactionHash: `0x${"aa".repeat(32)}`,
    topics: encodeEventTopics({ abi: LAUNCHPAD_V3_ABI, eventName: "Launched", args: { token: TOKEN, creator: ME as `0x${string}`, poolId: POOL_ID } }) as string[],
    data: encodeAbiParameters(parseAbiParameters("uint256, uint256"), [0n, 0n]),
  };
  /** A buy of 0.1 ETH at `fee` (hundredths of a bps), as the PoolManager's Swap event carries it. */
  const swap = (i: number, at: number, fee: number) => ({
    blockNumber: `0x${(0x10 + i).toString(16)}`,
    blockTimestamp: `0x${at.toString(16)}`,
    transactionHash: `0x${String(i).padStart(64, "b")}`,
    logIndex: "0x0",
    topics: [
      SWAP_TOPIC,
      POOL_ID,
      `0x${"00".repeat(12)}${"66".repeat(20)}`,
    ],
    data: encodeAbiParameters(SWAP, [-(10n ** 17n), 10n ** 24n, 2n ** 96n, 1n, 0, fee]),
  });
  const ERC20 = { name: "Night Cat", symbol: "NCAT" };

  it("records the coin's chosen fee and opening from the hook, charges each trade the fee its event says, and serves both", async () => {
    pin();
    const state = emptyState();
    expect(LAUNCHED_TOPIC).toBe(launched.topics[0]);
    applyLaunches(state, [launched], () => 0);
    // before its details are read, a v3 coin's fee is unknown — never assumed to be 1%
    expect(snapshot(state, OPENED + 60).coins[0]).toMatchObject({ feeBps: null, opening: null });
    expect(coinDetail(state, TOKEN, OPENED + 60)).toMatchObject({ feeBps: null, maxPaidBps: null });
    const calls = ethCalls({
      [V3]: factory(),
      [HOOK]: hook(),
      [TOKEN]: (data) => {
        const { functionName } = decodeFunctionData({ abi: erc20Abi, data });
        return encodeFunctionResult({ abi: erc20Abi, functionName: functionName as "name", result: ERC20[functionName as "name"] });
      },
    });
    const rpc: Rpc = async (m, p) => {
      if (m === "eth_call") return calls(m, [p[0]]);
      throw new Error(`unexpected ${m}`);
    };
    state.syncedTo = 0x40;
    expect(await syncOnce(state, rpc, { number: 0x40, timestamp: OPENED + 120 })).toEqual({ chunks: 0, launches: 0, swaps: 0, error: null });
    expect([...state.coins.values()][0]!.detail).toMatchObject({ fee: 30_000, opening: { startFee: 500_000, window: 15 }, symbol: "NCAT" });
    // the sniper at +1 s paid 46.67%, the buyer at +20 s paid the coin's 3%
    applySwaps(state, [swap(1, OPENED + 1, 466_666), swap(2, OPENED + 20, 30_000)], () => 0);
    const d = coinDetail(state, TOKEN, OPENED + 60)!;
    expect(d.feeBps).toBe(300);
    expect(d.maxPaidBps).toBe(4666.66);
    expect(d.trades.map((t) => t.fee)).toEqual([0.003, 0.0466666]);
    expect(d.feesQuote).toBeCloseTo(0.0496666, 10);
    expect(d.coin).toMatchObject({ feeBps: 300, opening: { fromBps: 5000, seconds: 15 } });
    // the browser reads the same figures back
    const page = parseCoinPage(JSON.parse(JSON.stringify(d)));
    expect(page).toMatchObject({ feeBps: 300, maxPaidBps: 4666.66, coin: { feeBps: 300, opening: { fromBps: 5000, seconds: 15 } } });
    expect(parseIndex({ coins: [{ ...JSON.parse(JSON.stringify(d.coin)), opening: { fromBps: 5000 } }] }).coins[0]!.opening).toBeNull();
    expect(parseIndex({ coins: [{ ...JSON.parse(JSON.stringify(d.coin)), opening: 5 }] }).coins[0]!.opening).toBeNull();
  });

  it("a v3 pool its hook never scheduled is an error, not a 0% fee", async () => {
    pin();
    const state = emptyState();
    applyLaunches(state, [launched], () => 0);
    state.syncedTo = 0x40;
    const calls = ethCalls({ [V3]: factory(), [HOOK]: hook({ schedules: [0, 0] }) });
    const rpc: Rpc = async (m, p) => calls(m, [p[0]]);
    expect((await syncOnce(state, rpc, { number: 0x40, timestamp: OPENED })).error).toBe(`The launchpad hook ${HOOK} has no fee schedule for pool ${POOL_ID}.`);
  });
});

describe("the Launch window on v3", () => {
  const LAUNCHED_LOG = {
    address: V3,
    topics: encodeEventTopics({ abi: LAUNCHPAD_V3_ABI, eventName: "Launched", args: { token: TOKEN, creator: ME as `0x${string}`, poolId: `0x${"22".repeat(32)}` } }) as string[],
    data: encodeAbiParameters(parseAbiParameters("uint256, uint256"), [0n, 0n]),
  };

  function wallet() {
    const sent: Record<string, string>[] = [];
    const provider: Eip1193Provider = {
      request(args: Eip1193Request) {
        if (args.method === "eth_accounts") return Promise.resolve([ME]);
        if (args.method === "eth_chainId") return Promise.resolve(BASE.idHex);
        if (args.method === "eth_sendTransaction") {
          sent.push(args.params?.[0] as Record<string, string>);
          return Promise.resolve(`0x${"ef".repeat(32)}`);
        }
        return Promise.reject(new Error(`unstubbed ${args.method}`));
      },
    };
    vi.stubGlobal("ethereum", provider);
    return sent;
  }

  beforeEach(() => forgetCatalog());

  it("offers 1% or 3%, says the opening read from the hook, and sends v3's launch with the chosen fee", async () => {
    pin();
    const sent = wallet();
    const calls = ethCalls({ [V3]: factory(), [HOOK]: hook(), [UNISWAP_V4_POOL_MANAGER]: () => `0x${"00".repeat(32)}` });
    net({
      get: (u) => (u === `${STOCKS_PATH}/base` ? DOWN : u.startsWith(`${BLOCKSCOUT}/addresses/${V3}/logs`) ? { items: [], next_page_params: null } : undefined),
      rpc: (m, p) =>
        simulated()(m, p) ??
        (m === "eth_getBalance" ? `0x${(10n ** 18n).toString(16)}` : m === "eth_getTransactionReceipt" ? { status: "0x1", blockNumber: "0x5", logs: [LAUNCHED_LOG] } : calls(m, p)),
    });
    render(
      <WalletProvider>
        <BaseLaunch />
      </WalletProvider>,
    );
    await act(async () => {});
    const fees = screen.getByRole("group", { name: "Fee" });
    expect(screen.getByRole("button", { name: "1%" })).toHaveAttribute("aria-pressed", "true");
    expect(fees).toHaveTextContent("1%3%a trade");
    expect(screen.getByText(/a sniper pays most of it/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "3%" }));
    expect(screen.getByText(/You earn 80% of the 3% fee/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Name"), "Night Cat");
    await userEvent.type(screen.getByLabelText("Symbol"), "NCAT");
    await userEvent.click(document.querySelector<HTMLButtonElement>(".mf__cta")!);
    const review = await screen.findByLabelText(/ready to launch on Base/);
    expect(review).toHaveTextContent("Uniswap v4, NCAT/ETH, 3% fee on every trade — your choice");
    expect(review).toHaveTextContent(openingText(30_000, { hook: HOOK, startFee: 500_000, window: 15 }));
    expect(review).toHaveTextContent("for the first 15 s the fee falls from 50% to your 3% — a sniper pays most of it; your own first buy inside the launch pays only your 3%");
    expect(review).toHaveTextContent("its hook's opening");
    await userEvent.click(screen.getByRole("button", { name: "Launch in wallet" }));
    await waitFor(() => expect(screen.getByText(/^Live:/)).toBeInTheDocument());
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to!.toLowerCase()).toBe(V3.toLowerCase());
    // the window names no referrer: a launch made in this app has none
    expect(decodeFunctionData({ abi: LAUNCHPAD_V3_ABI, data: sent[0]!.data as `0x${string}` }).args!.slice(-2)).toEqual([30_000, ETH_Q]);
    // choosing a fee again throws the review away
    await userEvent.click(screen.getByRole("button", { name: "1%" }));
    expect(screen.queryByLabelText(/ready to launch on Base/)).not.toBeInTheDocument();
  });

  it("shows no fee choice on v2", async () => {
    // v2 behaviour: v3 unset, as before its deploy
    pin({ launchFactoryV3: null, launchFactory: saved.launchFactory, launchFactoryV1: saved.launchFactoryV1 });
    wallet();
    net({ get: () => DOWN, rpc: (m, p) => ethCalls({})(m, p) ?? DOWN });
    render(
      <WalletProvider>
        <BaseLaunch />
      </WalletProvider>,
    );
    await act(async () => {});
    expect(screen.queryByRole("group", { name: "Fee" })).not.toBeInTheDocument();
    expect(screen.getByText(/You earn 80% of the 1% fee/)).toBeInTheDocument();
  });
});

describe("a referred v3 coin", () => {
  const v3Record = { factory: V3, creator: toChecksumAddress(ME), creatorRecipient: toChecksumAddress(ME) };
  const referredBy = (who: string) => factory({ referrerOf: who, approvedReferrers: true });

  it("reads the referrer from the factory — none as null, unread as undefined, and nothing asked for v1/v2", async () => {
    pin({ launchFactory: saved.launchFactory });
    net({ rpc: ethCalls({ [V3]: referredBy(REFERRER) }) });
    expect(await referrerOf(V3, TOKEN)).toBe(REFERRER);
    expect(await v3ReferrerOf({ factory: V3 }, TOKEN)).toBe(REFERRER);
    expect(await isApprovedReferrer(V3, REFERRER)).toBe(true);
    net({ rpc: ethCalls({ [V3]: factory() }) });
    expect(await referrerOf(V3, TOKEN)).toBeNull();
    net({ rpc: ethCalls({ [V3]: () => DOWN as never }) });
    expect(await v3ReferrerOf({ factory: V3 }, TOKEN)).toBeUndefined();
    net({});
    expect(await v3ReferrerOf({ factory: saved.launchFactory! }, TOKEN)).toBeNull();
    expect(await v3ReferrerOf(null, TOKEN)).toBeNull();
  });

  it("Token Verdict names the referrer and the 80/5/15 split — unread as not checked, none as nothing", () => {
    pin();
    const fee = { fee: 10_000, opening: null };
    const labels = (ref: string | null | undefined) => launchpadRows(v3Record, fee, ref).map((r) => r.label);
    expect(labels(REFERRER)).toEqual(["Launched on Quadra's launchpad", "Its fee", "Its referrer", "Its creator"]);
    expect(referrerRows(REFERRER)[0]!.value).toContain("80% creator / 5% referrer / ~15% Quadra");
    expect(referrerRows(undefined)[0]).toMatchObject({ tone: "warn", value: "not checked — the launchpad could not be read" });
    expect(labels(null)).toEqual(["Launched on Quadra's launchpad", "Its fee", "Its creator"]);
    expect(labels(undefined)).toContain("Its referrer");
    // v2 has no referrals at all — nothing is said even when asked with one
    expect(launchpadRows({ ...v3Record, factory: saved.launchFactory! }, null, REFERRER).map((r) => r.label)).toEqual(["Launched on Quadra's launchpad", "Its creator"]);
  });

  it("the coin page shows the referrer and its share, and Disclosures say the split", () => {
    pin();
    const page = render(<TokenInfo page="reading" creator={ME} launchedAt={null} quoteUsd={null} referrer={{ referrer: REFERRER }} />);
    expect(page.container).toHaveTextContent("Referrer");
    expect(page.container).toHaveTextContent("approved by the launchpad when the coin launched");
    expect(page.container).toHaveTextContent("Referrer's sharenot read");
    expect(page.container).toHaveTextContent("Quadra's sharenot read");
    page.unmount();
    for (const [ref, words] of [
      ["reading", "Referrerreading…"],
      [{ problem: "down" }, "Referrernot checked — down"],
    ] as const) {
      const r = render(<TokenInfo page="reading" creator={ME} launchedAt={null} quoteUsd={null} referrer={ref} />);
      expect(r.container).toHaveTextContent(words);
      r.unmount();
    }
    const none = render(<TokenInfo page="reading" creator={ME} launchedAt={null} quoteUsd={null} referrer={{ referrer: null }} />);
    expect(none.container).not.toHaveTextContent("Referrer");
    none.unmount();
    const a = render(<Disclosures factory={V3} fee={FLAT_FEE} referrer={{ referrer: REFERRER }} />);
    expect(a.container).toHaveTextContent("collecting pays 80% to the creator, 5% to its referrer");
    expect(a.container).toHaveTextContent("the rest, about 15%, to Quadra");
    a.unmount();
    const b = render(<Disclosures factory={V3} fee={FLAT_FEE} referrer="reading" />);
    expect(b.container).toHaveTextContent("5% of it to a referrer if one was recorded, which was not checked");
    b.unmount();
    const c = render(<Disclosures factory={V3} fee={FLAT_FEE} referrer={{ referrer: null }} />);
    expect(c.container).toHaveTextContent("collecting pays 80% to the creator and 20% to Quadra");
  });

  it("the coin page splits what the index saw 80 / 5 / 15 for a referred coin", () => {
    const coin = parseIndex({ coins: [{ token: TOKEN, factory: V3, creator: ME, launchBlock: 1, launchedAt: OPENED, quoteSymbol: "ETH", referrer: REFERRER }] }).coins[0]!;
    expect(coin.referrer).toBe(REFERRER);
    const page = { coin, trades: [], candles: [], points: [], feesQuote: 1, feesToken: null, feeBps: 100, maxPaidBps: null };
    const r = render(<TokenInfo page={page as never} creator={ME} launchedAt={OPENED} quoteUsd={null} referrer={{ referrer: REFERRER }} />);
    expect(r.container).toHaveTextContent("Creator's share80% — 0.8 ETH");
    expect(r.container).toHaveTextContent("Referrer's share5% — 0.05 ETH");
    expect(r.container).toHaveTextContent("Quadra's share~15% (the rest) — 0.15 ETH");
  });

  it("useCoinReferrer reads a v3 coin's referrer from the factory, and gives v1/v2 none without asking", async () => {
    pin({ launchFactory: saved.launchFactory });
    const Show = ({ f }: { f: string }) => {
      const r = useCoinReferrer(f, TOKEN);
      return <p>{r === "reading" ? "reading" : "problem" in r ? `problem ${r.problem}` : `ref ${r.referrer ?? "none"}`}</p>;
    };
    net({ rpc: ethCalls({ [V3]: referredBy(REFERRER) }) });
    const a = render(<Show f={V3} />);
    expect(a.container).toHaveTextContent("reading");
    await waitFor(() => expect(a.container).toHaveTextContent(`ref ${REFERRER}`));
    a.unmount();
    net({ rpc: ethCalls({ [V3]: () => DOWN as never }) });
    const b = render(<Show f={V3} />);
    await waitFor(() => expect(b.container).toHaveTextContent("problem"));
    b.rerender(<Show f={saved.launchFactory!} />);
    await waitFor(() => expect(b.container).toHaveTextContent("ref none"));
    // a page closed before the read lands sets nothing
    net({ rpc: ethCalls({ [V3]: referredBy(REFERRER) }) });
    render(<Show f={V3} />).unmount();
    net({ rpc: ethCalls({ [V3]: () => DOWN as never }) });
    render(<Show f={V3} />).unmount();
    await act(async () => {});
  });

  it("the indexer records each coin's Referred log with its launch, once, and serves it", async () => {
    pin();
    const POOL_ID = poolIdOf(KEY);
    const launched = {
      address: V3,
      blockNumber: "0x10",
      blockTimestamp: `0x${OPENED.toString(16)}`,
      transactionHash: `0x${"aa".repeat(32)}`,
      topics: encodeEventTopics({ abi: LAUNCHPAD_V3_ABI, eventName: "Launched", args: { token: TOKEN, creator: ME as `0x${string}`, poolId: POOL_ID } }) as string[],
      data: encodeAbiParameters(parseAbiParameters("uint256, uint256"), [0n, 0n]),
    };
    const referred = {
      ...launched,
      topics: encodeEventTopics({ abi: LAUNCHPAD_V3_ABI, eventName: "Referred", args: { token: TOKEN, referrer: REFERRER as `0x${string}` } }) as string[],
      data: "0x",
    };
    const state = emptyState();
    let asked: unknown = null;
    const rpc: Rpc = async (m, p) => {
      if (m === "eth_getLogs") {
        asked ??= (p[0] as { topics: unknown }).topics;
        return [referred, launched, { ...referred, topics: ["0x01"] }, 7];
      }
      throw new Error(`unexpected ${m}`);
    };
    state.syncedTo = 0x0f;
    const r = await syncOnce(state, rpc, { number: 0x10, timestamp: OPENED }, 1);
    expect(r.launches).toBe(1);
    expect(asked).toEqual([[LAUNCHED_TOPIC, REFERRED_TOPIC]]);
    expect(applyReferrals(state, [referred])).toBe(0);
    expect(snapshot(state, OPENED).coins[0]!.referrer).toBe(REFERRER);
    expect(parseIndex(JSON.parse(JSON.stringify(snapshot(state, OPENED)))).coins[0]!.referrer).toBe(REFERRER);
    const plain = emptyState();
    applyLaunches(plain, [launched], () => 0);
    expect(snapshot(plain, OPENED).coins[0]!.referrer).toBeNull();
  });
});
