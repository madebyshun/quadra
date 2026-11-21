import { describe, expect, it } from "vitest";
import { RELAY } from "@/config/routes";
import { UNISWAP_V4_POOL_MANAGER } from "@/config/chain";
import { BLOCKSCOUT, parseHolders, type Holding } from "@/skills/blockscout";
import { parseMarkets } from "@/skills/dexscreener";
import { parseScan } from "@/skills/goplus";
import { ARCHIVE_RPC, BLOCK_SLACK, originOf, PAGE, parseHistory, summarize, type Origin } from "@/skills/origin";
import { INITIALIZE_TOPIC } from "@/skills/radar";
import {
  arrived,
  ETH_PSEUDO,
  parseSimulation,
  PROBE_ACCOUNT,
  roundTrip,
  SIM_ACCOUNT,
  SIM_ETH_IN,
  stepsOf,
  transferData,
  TRANSFER_TOPIC,
  type RoundTrip,
} from "@/skills/simulate";
import {
  checkRow,
  checksOf,
  codeRows,
  cleanScan,
  concentration,
  holderRows,
  marketRows,
  originRows,
  score,
  tokenVerdict,
  tradeRows,
  transferRow,
  verdictRow,
  verdictSkill,
} from "@/skills/verdict";
import { row, type Row } from "@/skills/types";
import { ADDR, copy, FX } from "./fixtures/base";
import { CAPTURED_AT, LAUNCHERS, TOKENS, VX } from "./fixtures/verdict";
import { factoryCalls } from "./fixtures/launchpad";
import { DOWN, json, net, RpcError, useNet, type Answer } from "./net";
import { padCalls, PX } from "./fixtures/launchpads";
import { withoutV3 } from "./v2only";

// Its fixtures are real v2/v1 captures, so it runs as the app did before v3 was set.
withoutV3();

useNet();

/**
 * A Token Verdict is judged on real captures: Relay's quotes and Base's own `eth_simulateV1`
 * answers for a keyless buyer of DEGEN, Blockscout's records of four launches (direct, fresh,
 * through Clanker, through an ERC-4337 bundle), and the base captures for the code scan, the
 * holders and the market. Each failure case is built FROM a capture, visibly, in the test.
 */

const NATIVE = "0x0000000000000000000000000000000000000000";
const QUOTE = `${RELAY.api}/quote`;
const DAY = 86_400_000;

type SimCallIn = { from: string; to: string; data: string; value: string };
type Sim = (calls: SimCallIn[]) => Answer;

/** The default simulation: the capture matching the shape of what was asked. */
const captured: Sim = (calls) => {
  if (calls.length === 1) return VX.simBuy;
  if (calls.length === 2) return VX.simTransfer;
  return VX.simRoundtrip;
};

type World = {
  buy?: () => Answer;
  sell?: (amount: bigint, nth: number) => Answer;
  sim?: Sim;
  get?: (url: string) => Answer | undefined;
  calls?: (method: string, params: readonly unknown[]) => Answer | undefined;
};

/** Relay and Base for the round trip, and any GETs the test adds. Returns the calls made. */
function world(w: World = {}) {
  let sells = 0;
  const asked: { sell: string; amount: bigint }[] = [];
  const calls = net({
    post: (url, body) => {
      if (url !== QUOTE) return undefined;
      const b = body as { originCurrency: string; amount: string; user: string; recipient: string };
      expect([b.user, b.recipient]).toEqual([SIM_ACCOUNT, SIM_ACCOUNT]);
      asked.push({ sell: b.originCurrency, amount: BigInt(b.amount) });
      return b.originCurrency === NATIVE ? (w.buy ?? (() => VX.relayEthDegen))() : (w.sell ?? (() => VX.relayDegenEth))(BigInt(b.amount), sells++);
    },
    rpc: (method, params) => {
      // every other read is the launchpad's: by default it says the token is not one of its own
      if (method !== "eth_simulateV1") return (w.calls ?? ((m, p) => factoryCalls()(m, p) ?? padCalls()(m, p)))(method, params);
      const [block] = params as [{ blockStateCalls: { stateOverrides: Record<string, { balance: string }>; calls: SimCallIn[] }[]; traceTransfers: boolean }];
      const state = block.blockStateCalls[0]!;
      expect(block.traceTransfers).toBe(true);
      expect(BigInt(state.stateOverrides[SIM_ACCOUNT]!.balance)).toBe(10n ** 19n);
      return (w.sim ?? captured)(state.calls);
    },
    get: (url) => w.get?.(url),
  });
  return { calls, asked };
}

/** A simulation result whose call `i` reverted with `message` (or with no message at all). */
function reverting(base: unknown, i: number, message?: string): unknown {
  const out = copy(base) as { calls: { status: string; error?: unknown; logs: unknown[] }[] }[];
  out[0]!.calls[i]!.status = "0x0";
  out[0]!.calls[i]!.logs = [];
  if (message !== undefined) out[0]!.calls[i]!.error = { message };
  return out;
}

// ── the simulation's parts ─────────────────────────────────────────────────

describe("reading Relay's steps and Base's simulation", () => {
  it("takes every step's transaction, in order — the sell is an approve then a swap", () => {
    expect(stepsOf(VX.relayEthDegen).map((s) => [s.to, s.value])).toEqual([["0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f", SIM_ETH_IN]]);
    const sell = stepsOf(VX.relayDegenEth);
    expect(sell.map((s) => s.to)).toEqual([TOKENS.degen.toLowerCase(), "0xccc88a9d1b4ed6b0eaba998850414b24f1c315be"]);
    expect(sell[0]!.data.startsWith("0x095ea7b3")).toBe(true);
  });

  it("skips an item with no destination or data, and reads a missing or odd value as zero", () => {
    const body = { steps: [{ items: [{ data: { to: "0xa", data: "0x1" } }, { data: { to: "0xb", data: "0x2", value: "nope" } }, { data: { data: "0x3" } }, {}] }, "junk"] };
    expect(stepsOf(body)).toEqual([
      { to: "0xa", data: "0x1", value: 0n },
      { to: "0xb", data: "0x2", value: 0n },
    ]);
    expect(stepsOf(null)).toEqual([]);
  });

  it("reads each call's outcome and its logs, and a revert with no message says so", () => {
    const calls = parseSimulation(VX.simRoundtrip);
    expect(calls.map((c) => c.ok)).toEqual([true, true, true]);
    expect(calls[2]!.logs.length).toBeGreaterThan(0);
    const odd = [{ calls: [{ status: "0x0", logs: ["junk", { address: "0xa", data: "0x", topics: [TRANSFER_TOPIC, 7] }, { address: "0xb" }] }, "junk"] }];
    expect(parseSimulation(odd)).toEqual([
      { ok: false, reason: "reverted with no reason", logs: [{ address: "0xa", topics: [TRANSFER_TOPIC], data: "0x" }] },
      { ok: false, reason: "reverted with no reason", logs: [] },
    ]);
    expect(parseSimulation(null)).toEqual([]);
  });

  /** MEASURED: 0.01 ETH became 24,891.45 DEGEN, and the sell sent 0.00994 ETH back — as `traceTransfers` reports native ETH. */
  it("adds up what reached an address, native ETH included", () => {
    expect(arrived(parseSimulation(VX.simBuy), TOKENS.degen, SIM_ACCOUNT)).toBe(24891446777070950672436n);
    const back = arrived(parseSimulation(VX.simRoundtrip).slice(1), ETH_PSEUDO, SIM_ACCOUNT);
    expect(back).toBeGreaterThan(9_000_000_000_000_000n);
    expect(back).toBeLessThan(SIM_ETH_IN);
    // a log with data that is not a number counts for nothing
    expect(arrived([{ ok: true, reason: "", logs: [{ address: TOKENS.degen, topics: [TRANSFER_TOPIC, "0x", `0x${"0".repeat(24)}${SIM_ACCOUNT.slice(2)}`], data: "0x" }] }], TOKENS.degen, SIM_ACCOUNT)).toBe(0n);
  });

  it("encodes the transfer test exactly as ERC-20 transfer(to, amount)", () => {
    expect(transferData(PROBE_ACCOUNT, 255n)).toBe(`0xa9059cbb${PROBE_ACCOUNT.slice(2).padStart(64, "0")}${"ff".padStart(64, "0")}`);
  });
});

describe("the round trip", () => {
  it("buys, moves half, and sells it all back — DEGEN as the chain answered it", async () => {
    const { asked } = world();
    const trip = (await roundTrip(TOKENS.degen)) as Extract<RoundTrip, { kind: "traded" }>;
    expect(trip.kind).toBe("traded");
    expect(trip.received).toBe(24891446777070950672436n);
    expect(trip.loss).toBeGreaterThan(0);
    expect(trip.loss).toBeLessThan(0.01);
    // the quote said 24,891.81; 24,891.45 arrived — a rounding difference, not a tax
    expect(trip.shortfall).toBeLessThan(0.0001);
    expect(trip.transfer).toEqual({ kind: "ok", arrived: 1 });
    expect(asked).toEqual([
      { sell: NATIVE, amount: SIM_ETH_IN },
      { sell: TOKENS.degen, amount: trip.received },
    ]);
  });

  it("says when there is no route to buy or to sell, in Relay's words", async () => {
    world({ buy: () => json({ message: "No routes found" }, 400) });
    expect(await roundTrip(TOKENS.degen)).toEqual({ kind: "no-route", side: "buy", why: "Relay: No routes found." });
    world({ sell: () => json({ message: "Swap impact is too high: -99.95%" }, 400) });
    expect(await roundTrip(TOKENS.degen)).toEqual({ kind: "no-route", side: "sell", why: "Relay: Swap impact is too high: -99.95%." });
    world({ buy: () => ({ steps: [] }) });
    expect(await roundTrip(TOKENS.degen)).toMatchObject({ kind: "no-route", why: "Relay: the quote carried no transaction." });
  });

  it("reports a buy that reverts", async () => {
    world({ sim: () => reverting(VX.simBuy, 0, "trading not open") });
    expect(await roundTrip(TOKENS.degen)).toEqual({ kind: "buy-reverted", reason: "trading not open" });
  });

  it("catches a sell that reverts, and whether selling half gets out", async () => {
    // selling all reverts; selling half goes through — the "cannot sell all" trap
    const rounds: number[] = [];
    world({
      sim: (calls) => {
        if (calls.length < 3) return captured(calls);
        rounds.push(calls.length);
        return rounds.length === 1 ? reverting(VX.simRoundtrip, 2, "arithmetic underflow") : VX.simRoundtrip;
      },
    });
    const trip = await roundTrip(TOKENS.degen);
    expect(trip).toMatchObject({ kind: "sell-reverted", reason: "arithmetic underflow", halfSold: true, transfer: { kind: "ok", arrived: 1 } });

    // selling half reverts too
    world({ sim: (calls) => (calls.length < 3 ? captured(calls) : reverting(VX.simRoundtrip, 2)) });
    expect(await roundTrip(TOKENS.degen)).toMatchObject({ kind: "sell-reverted", reason: "reverted with no reason", halfSold: false });

    // and when the half-sized quote cannot even be had, that is not known
    world({ sell: (_, nth) => (nth === 0 ? VX.relayDegenEth : DOWN), sim: (calls) => (calls.length < 3 ? captured(calls) : reverting(VX.simRoundtrip, 2)) });
    expect(await roundTrip(TOKENS.degen)).toMatchObject({ kind: "sell-reverted", halfSold: null });
  });

  it("reports a transfer that reverts, one that loses some on the way, and none when nothing was bought", async () => {
    world({ sim: (calls) => (calls.length === 2 ? reverting(VX.simTransfer, 1, "blocked") : captured(calls)) });
    expect(await roundTrip(TOKENS.degen)).toMatchObject({ kind: "traded", transfer: { kind: "reverted", reason: "blocked" } });

    const taxed = copy(VX.simTransfer) as { calls: { logs: { data: string }[] }[] }[];
    const log = taxed[0]!.calls[1]!.logs[0]!;
    log.data = `0x${((BigInt(log.data) * 95n) / 100n).toString(16)}`;
    world({ sim: (calls) => (calls.length === 2 ? taxed : captured(calls)) });
    const trip = (await roundTrip(TOKENS.degen)) as Extract<RoundTrip, { kind: "traded" }>;
    expect(trip.transfer.kind === "ok" && trip.transfer.arrived).toBeCloseTo(0.95, 6);

    // nothing arrived from the buy: nothing to move, and the quote's promise was not kept at all
    const empty = copy(VX.simBuy) as { calls: { logs: unknown[] }[] }[];
    empty[0]!.calls[0]!.logs = [];
    const noOut = copy(VX.relayEthDegen) as { details: { currencyOut: { amount?: string } } };
    delete noOut.details.currencyOut.amount;
    world({ buy: () => noOut, sim: (calls) => (calls.length === 1 ? empty : VX.simRoundtrip) });
    expect(await roundTrip(TOKENS.degen)).toMatchObject({ kind: "traded", received: 0n, quoted: 0n, shortfall: 0, transfer: { kind: "not-run" } });
  });
});

// ── the rows ──────────────────────────────────────────────────────────────

const traded = (loss: number, shortfall = 0): RoundTrip => ({
  kind: "traded",
  ethIn: SIM_ETH_IN,
  quoted: 100n,
  received: 100n,
  ethBack: 1n,
  loss,
  shortfall,
  transfer: { kind: "ok", arrived: 1 },
});

describe("the trade, as rows", () => {
  it("colours the round trip's loss: a DEX's cut, something more, or a trap", () => {
    expect(tradeRows(traded(0.006))[0]).toMatchObject({ value: "0.60% lost on the round trip (fees, impact and any tax)", tone: "ok" });
    expect(tradeRows(traded(0.12))[0]).toMatchObject({ value: "12.0% lost on the round trip (fees, impact and any tax)", tone: "warn" });
    expect(tradeRows(traded(0.4))[0]?.tone).toBe("bad");
  });

  it("says when fewer tokens arrived than were quoted", () => {
    expect(tradeRows(traded(0.01, 0.005)).map((r) => r.label)).not.toContain("Tokens delivered vs quoted");
    expect(tradeRows(traded(0.01, 0.05))[1]).toEqual(row("Tokens delivered vs quoted", "5.00% short — a buy tax or a fee on transfer", { tone: "warn" }));
    expect(tradeRows(traded(0.01, 0.2))[1]?.tone).toBe("bad");
  });

  /** MEASURED on this app's first launch: a fresh single-sided pool reads "-99.98%" on the sell back. */
  it("reads a refused sell as not checked — Relay prices it before the buy — and any other missing route as amber", () => {
    expect(tradeRows({ kind: "no-route", side: "sell", why: "Relay: Swap impact is too high: -99.95%." })[0]).toMatchObject({
      tone: "warn",
      value: expect.stringMatching(/^not checked — the buy went through, but Relay prices the sell before the buy/),
    });
    expect(tradeRows({ kind: "no-route", side: "sell", why: "Relay: No routes found." })[0]).toEqual(
      row("Buy → sell, simulated now", "no sell route — Relay: No routes found.", { tone: "warn" }),
    );
    expect(tradeRows({ kind: "no-route", side: "buy", why: "x" })[0]?.value).toBe("no buy route — x");
    // MEASURED on CHUBBY after its liquidity was pulled: not even the BUY could be filled
    expect(tradeRows({ kind: "no-route", side: "buy", why: "Relay: Swap impact is too high: 859.38%." })[0]).toEqual(
      row("Buy → sell, simulated now", "even 0.01 ETH cannot be filled: the market is all but empty — Relay: Swap impact is too high: 859.38%.", { tone: "bad" }),
    );
  });

  it("puts a reverting sell in red, and a sell that only lets half out beside it", () => {
    const base = { kind: "sell-reverted", received: 1n, reason: "nope", transfer: { kind: "ok", arrived: 1 } } as const;
    expect(tradeRows({ ...base, halfSold: true }).map((r) => [r.label, r.tone])).toEqual([
      ["Buy → sell, simulated now", "bad"],
      ["Selling half", "bad"],
      ["Wallet-to-wallet transfer", "ok"],
    ]);
    expect(tradeRows({ ...base, halfSold: false })).toHaveLength(2);
    expect(tradeRows({ ...base, halfSold: null })).toHaveLength(2);
  });

  it("does not call a buy that reverts a trap, and a simulation that could not run is not checked", () => {
    expect(tradeRows({ kind: "buy-reverted", reason: "paused" })).toEqual([row("Buy → sell, simulated now", 'the buy reverts right now — "paused"', { tone: "warn" })]);
    expect(tradeRows(null)[0]).toMatchObject({ value: "not checked — the simulation could not run", tone: "warn" });
  });

  it("colours the transfer by how much arrived", () => {
    expect(transferRow({ kind: "ok", arrived: 0.95 })).toMatchObject({ value: "5.00% taken on the way", tone: "warn" });
    expect(transferRow({ kind: "ok", arrived: 0.5 })).toMatchObject({ value: "50.0% taken on the way", tone: "bad" });
    expect(transferRow({ kind: "reverted", reason: "x" })).toMatchObject({ tone: "bad" });
    expect(transferRow({ kind: "not-run" })).toMatchObject({ value: "not checked — no tokens to move", tone: "warn" });
  });
});

describe("the code, as rows", () => {
  const degen = parseScan(FX.goplusDegen, ADDR.degen)!;

  it("shows only what says something — DEGEN is mintable, and that is amber, not red", () => {
    expect(codeRows(degen)).toEqual([row("Owner can mint more", "yes", { tone: "warn" })]);
  });

  it("collapses multiple checks GoPlus did not run into one amber Code scan row", () => {
    const brtc = parseScan(FX.goplusBrtc, ADDR.brtc)!;
    const rows = codeRows(brtc);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "Code scan", tone: "warn", value: expect.stringMatching(/GoPlus left .* checks blank/) });
  });

  it("says when nothing was found, when GoPlus has no report, and when it could not be reached", () => {
    expect(codeRows({ ...degen, mintable: "no" })).toEqual([row("Code scan", cleanScan({ ...degen, mintable: "no" }), { tone: "ok" })]);
    expect(cleanScan({ ...degen, buyTax: 0, sellTax: 0.05 })).toBe("11 checks passed — not a honeypot, no mint, no pause, no blacklist, source verified, tax 0.00% buy / 5.00% sell");
    expect(cleanScan({ ...degen, buyTax: null })).toBe("11 checks passed — not a honeypot, no mint, no pause, no blacklist, source verified");
    expect(codeRows(null)[0]?.value).toBe("not checked — GoPlus has no report on this token");
    expect(codeRows(undefined)[0]?.value).toBe("not checked — GoPlus could not be reached");
  });

  it("paints a trap red and an owner power amber, and a 'no' on verified source as amber", () => {
    const checks = checksOf({ ...degen, honeypot: "yes", openSource: "no" });
    expect(checkRow(checks.find((c) => c.label === "Honeypot pattern")!).tone).toBe("bad");
    expect(checkRow(checks.find((c) => c.label === "Source code verified")!).tone).toBe("warn");
    expect(checkRow(checks.find((c) => c.label === "Hidden owner")!).tone).toBe("ok");
  });
});

describe("the holders, as rows", () => {
  const holders = parseHolders(FX.holdersDegen);
  const info = { address: ADDR.degen, symbol: "DEGEN", name: "Degen", decimals: 18, totalSupply: BigInt(FX.tokenDegen.total_supply), holders: 1, price: null, type: null };
  const pairs = parseMarkets(FX.dexscreenerDegen);

  /** MEASURED: DEGEN's top ten hold 61.7%, its own Safes most of all — concentrated, and amber, not red. */
  it("adds up the top ten and names the largest", () => {
    const rows = holderRows(info, holders, pairs);
    expect(rows).toEqual([
      row("Top 10 holders", "61.7% of supply, pools and burns set aside", { tone: "warn" }),
      row("Largest holder", "GnosisSafeProxy — 22.6%", { href: `https://basescan.org/address/${holders[0]!.holder.address}` }),
    ]);
  });

  it("sets aside a pool, the v4 PoolManager and burned supply, and says how much", () => {
    const moved: Holding[] = holders.map((h, i) => ({
      ...h,
      holder: { ...h.holder, address: [pairs[0]!.pair!, UNISWAP_V4_POOL_MANAGER, "0x000000000000000000000000000000000000dEaD"][i] ?? h.holder.address },
    }));
    const c = concentration(moved, info.totalSupply, new Set([pairs[0]!.pair!.toLowerCase(), UNISWAP_V4_POOL_MANAGER.toLowerCase()]));
    expect(c.largest?.holder.address).toBe(holders[3]!.holder.address);
    expect(c.set).toBeCloseTo(0.3349, 3);
    const rows = holderRows(info, moved, pairs);
    expect(rows.map((r) => r.label)).toEqual(["Top 10 holders", "Largest holder", "In pools or burned"]);
    expect(rows[0]?.tone).toBe("ok");
    // a holder with no label is named by its address
    expect(rows[1]?.value).toMatch(/^0x9773…418C — /);
    // with no pairs read, only the PoolManager and burns are set aside
    expect(holderRows(info, moved, null)[2]?.value).not.toBe(rows[2]?.value);
  });

  it("with every top holder a pool or a burn, names no largest holder", () => {
    const pooled = holders.map((h) => ({ ...h, holder: { ...h.holder, address: UNISWAP_V4_POOL_MANAGER } }));
    expect(concentration(pooled, info.totalSupply, new Set([UNISWAP_V4_POOL_MANAGER.toLowerCase()]))).toMatchObject({ share: 0, largest: null });
    const unpaired = parseMarkets([{ dexId: "x" }]);
    expect(holderRows(info, pooled, unpaired).map((r) => r.label)).toEqual(["Top 10 holders", "In pools or burned"]);
  });

  it("says not checked without a list or a supply, and none yet for a list that is empty", () => {
    expect(holderRows(null, holders, pairs)[0]?.value).toBe("not checked — Blockscout has no holder list or supply");
    expect(holderRows({ ...info, totalSupply: null }, holders, pairs)[0]?.tone).toBe("warn");
    expect(holderRows(info, null, pairs)[0]?.tone).toBe("warn");
    expect(holderRows(info, [], pairs)).toEqual([row("Top 10 holders", "none indexed yet — the indexer can lag a new token", { tone: "warn" })]);
  });
});

// ── the launcher ───────────────────────────────────────────────────────────

/** Blockscout for each captured launch: the token's record, the launch transaction, the launcher's history. */
function origins(over: Record<string, Answer> = {}) {
  const table: Record<string, Answer> = {
    [`${BLOCKSCOUT}/addresses/${TOKENS.degen}`]: VX.addressDegen,
    [`${BLOCKSCOUT}/transactions/${VX.creationDegen.hash}`]: VX.creationDegen,
    [`${BLOCKSCOUT}/addresses/${TOKENS.chubby}`]: VX.addressChubby,
    [`${BLOCKSCOUT}/transactions/${VX.creationChubby.hash}`]: VX.creationChubby,
    [`${BLOCKSCOUT}/addresses/${TOKENS.boar}`]: VX.addressBoar,
    [`${BLOCKSCOUT}/transactions/${VX.creationBoar.hash}`]: VX.creationBoar,
    [`${BLOCKSCOUT}/addresses/${TOKENS.doppler}`]: VX.addressDoppler,
    [`${BLOCKSCOUT}/transactions/${VX.creationDoppler.hash}`]: VX.creationDoppler,
    [historyUrl(LAUNCHERS.degen)]: VX.txsDegenDeployer,
    [historyUrl(LAUNCHERS.chubby)]: VX.txsChubbyLauncher,
    [historyUrl(LAUNCHERS.clanker)]: VX.txsClankerLauncher,
    ...over,
  };
  return (url: string) => table[url];
}
const historyUrl = (a: string) => `${BLOCKSCOUT}/addresses/${a}/transactions`;
const boarPairs = parseMarkets(VX.dexscreenerBoar);

/** The chain as the BOAR capture saw it: the latest block, and its pool's Initialize log on the archive node. */
function boarChain(logs: Answer = VX.rpcBoarInitialize) {
  const asked: { endpoint: string; filter: unknown }[] = [];
  const answer = (method: string, params: readonly unknown[], endpoint: string): Answer | undefined => {
    if (method === "eth_getBlockByNumber") return VX.rpcLatestBlock;
    if (method === "eth_getCode") return PX.code.clankerLauncher;
    if (method !== "eth_getLogs") return undefined;
    asked.push({ endpoint, filter: params[0] });
    return logs;
  };
  return { asked, answer };
}

describe("where a token came from", () => {
  it("reads a direct deploy by a busy developer wallet — DEGEN", async () => {
    net({ get: origins() });
    const o = (await originOf(TOKENS.degen, []))!;
    expect(o.via).toBeNull();
    expect(o.launcher).toMatchObject({ address: LAUNCHERS.degen, complete: false, txCount: PAGE, firstSeen: null, funder: null, pulledAt: null });
  });

  /** MEASURED: CHUBBY's deployer was funded once, made this one contract, added liquidity — and pulled it. */
  it("reads a single-use launcher that pulled the liquidity — CHUBBY", async () => {
    net({ get: origins() });
    const o = (await originOf(TOKENS.chubby, []))!;
    expect(o.via).toBeNull();
    expect(o.launcher).toEqual({
      address: LAUNCHERS.chubby,
      complete: true,
      txCount: 9,
      firstSeen: new Date("2026-10-01T01:38:35.000Z"),
      deployments: 1,
      factoryCalls: 0,
      callsComplete: true,
      funder: VX.txsChubbyLauncher.items.at(-1)!.from.hash,
      pulledAt: new Date("2026-10-01T01:54:47.000Z"),
    });
  });

  it("finds a launchpad token's launch through its v4 pool, on the archive node — Clanker", async () => {
    const { asked, answer } = boarChain();
    net({ get: origins(), rpc: answer });
    const o = (await originOf(TOKENS.boar, boarPairs))!;
    expect(o.via).toEqual({ address: VX.creationBoar.to.hash, name: "Clanker" });
    expect(o.launcher).toMatchObject({ address: LAUNCHERS.clanker, complete: false, factoryCalls: PAGE });
    // the creation time gave the launch block exactly: 51801067 ± the slack
    expect(asked).toEqual([
      {
        endpoint: ARCHIVE_RPC[0],
        filter: {
          address: UNISWAP_V4_POOL_MANAGER,
          topics: [INITIALIZE_TOPIC, boarPairs[0]!.pair],
          fromBlock: `0x${(51801067 - BLOCK_SLACK).toString(16)}`,
          toBlock: `0x${(51801067 + BLOCK_SLACK).toString(16)}`,
        },
      },
    ]);
  });

  it("finds nothing when the pool's log is not there, or there is no v4 pool to look through", async () => {
    net({ get: origins(), rpc: boarChain([]).answer });
    expect(await originOf(TOKENS.boar, boarPairs)).toBeNull();
    net({ get: origins() });
    const v3 = parseMarkets([{ pairAddress: "0xc9034c3E7F58003E6ae0C8438e7c8f4598d5ACAA", pairCreatedAt: 1 }]);
    expect(await originOf(TOKENS.boar, v3)).toBeNull();
    expect(await originOf(TOKENS.boar, [{ ...boarPairs[0]!, createdAt: null }])).toBeNull();
    expect(await originOf(TOKENS.boar, [])).toBeNull();
  });

  it("reads a missing token record as no creation", async () => {
    net({ get: origins({ [`${BLOCKSCOUT}/addresses/${TOKENS.boar}`]: new Response("", { status: 404 }) }) });
    expect(await originOf(TOKENS.boar, [])).toBeNull();
  });

  it("estimates no block before the first", async () => {
    const { asked, answer } = boarChain();
    net({ get: origins(), rpc: answer });
    await originOf(TOKENS.boar, [{ ...boarPairs[0]!, createdAt: 0 }]);
    expect(asked[0]!.filter).toMatchObject({ fromBlock: "0x0" });
  });

  it("does not take an ERC-4337 bundler for the launcher", async () => {
    const doppler = { ...VX.addressDoppler, creation_transaction_hash: VX.creationDoppler.hash };
    net({ get: origins({ [`${BLOCKSCOUT}/addresses/${TOKENS.doppler}`]: doppler }) });
    // the EntryPoint is a relay, never the launchpad
    expect(await originOf(TOKENS.doppler, [])).toEqual({ via: null, launcher: null, relay: "an ERC-4337 bundle" });
  });

  it("reads a history that did not come as could-not-read, never as a wallet with no history", async () => {
    net({ get: origins({ [historyUrl(LAUNCHERS.chubby)]: { message: "Too many requests" } }) });
    await expect(originOf(TOKENS.chubby, [])).rejects.toThrow("Blockscout did not send the launcher's history.");
    expect(() => parseHistory(null)).toThrow("Blockscout did not send the launcher's history.");
  });

  it("is null for a launch transaction with no sender, and names a factory it has no name for by nothing", async () => {
    net({ get: origins({ [`${BLOCKSCOUT}/transactions/${VX.creationChubby.hash}`]: { hash: VX.creationChubby.hash } }) });
    expect(await originOf(TOKENS.chubby, [])).toBeNull();
    net({ get: origins({ [`${BLOCKSCOUT}/transactions/${VX.creationChubby.hash}`]: new Response("", { status: 404 }) }) });
    expect(await originOf(TOKENS.chubby, [])).toBeNull();
    const unnamed = { ...VX.creationBoar, to: { hash: VX.creationBoar.to.hash } };
    net({ get: origins({ [`${BLOCKSCOUT}/transactions/${VX.creationBoar.hash}`]: unnamed }), rpc: boarChain().answer });
    expect((await originOf(TOKENS.boar, boarPairs))?.via).toEqual({ address: VX.creationBoar.to.hash, name: null });
  });

  it("reads odd rows as what they are: no time, no method, no sender", () => {
    const h = parseHistory({ items: ["junk", { timestamp: "never", value: null, to: "0xa" }, {}], next_page_params: null });
    const odd = { from: "", to: null, value: "0", created: false, at: null, method: null };
    expect(h).toEqual({ complete: true, txs: [odd, odd] });
    expect(summarize(LAUNCHERS.chubby, null, h)).toMatchObject({ firstSeen: null, funder: null, pulledAt: null });
    expect(summarize(LAUNCHERS.chubby, null, { txs: [], complete: true }).firstSeen).toBeNull();
  });
});

describe("the launcher, as rows", () => {
  const now = CAPTURED_AT;
  const launcher = (over: Partial<NonNullable<Origin["launcher"]>> = {}): NonNullable<Origin["launcher"]> => ({
    address: LAUNCHERS.chubby,
    complete: true,
    firstSeen: new Date(now - 3 * 3_600_000),
    txCount: 6,
    deployments: 1,
    factoryCalls: 0,
    callsComplete: true,
    funder: "0x0e6e91775d24d34b90e0f3d806a90705f0199999",
    pulledAt: null,
    ...over,
  });

  it("flags a fresh wallet, and names who funded it", () => {
    expect(originRows({ via: null, launcher: launcher() }, now)).toEqual([
      row("Launched by", "0x46b9…2cDe, deployed directly", { href: `https://basescan.org/address/${LAUNCHERS.chubby}`, next: `profile ${LAUNCHERS.chubby}` }),
      row("Launcher's wallet", "first used 3 hours ago, 6 transactions", { tone: "warn" }),
      row("Launcher's track record", "1 contract deployed"),
      row("Launcher funded by", "0x0e6e…9999", { href: "https://basescan.org/address/0x0e6e91775d24d34b90e0f3d806a90705f0199999" }),
    ]);
  });

  it("puts a launcher that pulled liquidity in red, right under its name", () => {
    expect(originRows({ via: null, launcher: launcher({ pulledAt: new Date(now - 2 * 3_600_000) }) }, now)[1]).toEqual(
      row("Launcher pulled liquidity", "2 hours ago — it took liquidity out of a pool", { tone: "bad" }),
    );
  });

  it("does not flag a developer for deploying many contracts, but does flag a serial launchpad launcher", () => {
    const busy = launcher({ complete: false, firstSeen: null, txCount: 50, deployments: 21, funder: null });
    expect(originRows({ via: null, launcher: busy }, now).slice(1)).toEqual([
      row("Launcher's wallet", "50+ transactions — its first use was not read"),
      row("Launcher's track record", "21+ contracts deployed"),
    ]);
    const via = { address: "0xE85A59c628F7d27878ACeB4bf3b35733630083a9", name: "Clanker" };
    expect(originRows({ via, launcher: launcher({ factoryCalls: 7 }) }, now)[2]).toEqual(row("Launcher's track record", "7 launches through Clanker", { tone: "warn" }));
    expect(originRows({ via, launcher: launcher({ factoryCalls: 1 }) }, now)[2]?.value).toBe("1 launch through Clanker");
    expect(originRows({ via, launcher: launcher({ factoryCalls: 50, callsComplete: false }) }, now)[2]?.value).toBe("50+ launches through Clanker");
    expect(originRows({ via: { ...via, name: null }, launcher: launcher() }, now)[0]?.value).toBe("0x46b9…2cDe, through 0xE85A…83a9");
    expect(originRows({ via: null, launcher: launcher({ firstSeen: new Date(now - 1000 * DAY) }) }, now)[1]).toEqual(
      row("Launcher's wallet", "first used 2.7 years ago, 6 transactions", { tone: "ok" }),
    );
    expect(originRows({ via: null, launcher: launcher({ firstSeen: new Date(now - 40 * DAY), txCount: 1 }) }, now)[1]?.value).toBe("first used 40 days ago, 1 transaction");
    expect(originRows({ via: null, launcher: launcher({ firstSeen: new Date(now - DAY - 1) }) }, now)[1]?.value).toBe("first used 1 day ago, 6 transactions");
    expect(originRows({ via: null, launcher: launcher({ firstSeen: new Date(now - 60_000) }) }, now)[1]?.value).toBe("first used 1 hour ago, 6 transactions");
  });

  it("says what it could not find", () => {
    expect(originRows({ via: null, launcher: launcher({ firstSeen: null }) }, now)[1]).toEqual(row("Launcher's wallet", "no history on record", { tone: "warn" }));
    expect(originRows({ via: { address: "0x1", name: "EntryPoint" }, launcher: null }, now)).toEqual([
      row("Launched by", "a smart wallet, through EntryPoint — the launcher is not identified", { tone: "warn" }),
    ]);
    expect(originRows(null, now)[0]?.value).toBe("not checked — no launch transaction on record");
    expect(originRows(undefined, now)[0]?.value).toBe("not checked — its launch could not be read just now (Blockscout or the Base RPC refused); try again");
  });
});

// ── the market, the score, the whole ────────────────────────────────────────

describe("the market, as rows", () => {
  it("reads DEGEN's deepest market — price, depth, volume, trades and age", () => {
    const rows = marketRows(parseMarkets(FX.dexscreenerDegen), CAPTURED_AT);
    expect(rows.map((r) => r.label)).toEqual(["Price", "Liquidity (uniswap, vs WETH)", "Volume 24h", "Trades 24h", "Pool age"]);
    expect(rows[1]).toMatchObject({ value: "$132,845.39", tone: "ok", href: "https://dexscreener.com/base/0xc9034c3e7f58003e6ae0c8438e7c8f4598d5acaa" });
    expect(rows[4]).toEqual(row("Pool age", "2.7 years", { tone: "ok" }));
  });

  it("flags thin or unknown depth and a pool under a day old, and says what is missing", () => {
    const [bare] = parseMarkets([{ dexId: "x", pairCreatedAt: CAPTURED_AT - 3_600_000 }]);
    const rows = marketRows([bare!], CAPTURED_AT);
    expect(rows).toEqual([
      row("Price", "not quoted"),
      row("Liquidity (x, vs ?)", "unknown", { tone: "warn" }),
      row("Volume 24h", "unknown"),
      row("Pool age", "1 hour", { tone: "warn" }),
    ]);
    expect(marketRows([{ ...bare!, liquidityUsd: 500, createdAt: null }], CAPTURED_AT)[1]?.tone).toBe("warn");
    // MEASURED on CHUBBY: DexScreener's pool read $0.00 once the launcher had pulled it
    expect(marketRows([{ ...bare!, liquidityUsd: 0 }], CAPTURED_AT)[1]).toEqual(row("Liquidity (x, vs ?)", "$0.00 — none left: pulled, or never added", { tone: "bad" }));
    expect(marketRows([], CAPTURED_AT)).toEqual([row("Market", "no market found on Base", { tone: "warn" })]);
    expect(marketRows(null, CAPTURED_AT)[0]?.value).toBe("not checked — DexScreener could not be read");
  });
});

describe("the verdict", () => {
  const r = (tone?: Row["tone"]) => row("x", "y", tone ? { tone } : {});

  it("scores out of 100: a red line costs 35, an amber one 10, and it stops at zero", () => {
    expect(score([r(), r("ok")])).toBe(100);
    expect(score([r("warn"), r("bad")])).toBe(55);
    expect(score([r("bad"), r("bad"), r("bad")])).toBe(0);
  });

  it("keeps three answers apart, and never says safe", () => {
    expect(verdictRow([r("ok"), r("bad")])).toEqual(row("Verdict", "High risk — 65/100, see the red lines", { tone: "bad" }));
    expect(verdictRow([r("warn")])).toEqual(row("Verdict", "Caution — 90/100, some lines raised a flag or could not be checked", { tone: "warn" }));
    expect(verdictRow([r("ok")])).toEqual(row("Verdict", "No red flags found — 100/100", { tone: "ok" }));
  });
});

/** Every source a DEGEN verdict reads, answered by its capture. */
function degenSources(over: Record<string, Answer> = {}) {
  const table: Record<string, Answer> = {
    [`${BLOCKSCOUT}/tokens/${TOKENS.degen}`]: FX.tokenDegen,
    [`${BLOCKSCOUT}/tokens/${TOKENS.degen}/holders`]: FX.holdersDegen,
    [`https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${TOKENS.degen}`]: FX.goplusDegen,
    [`https://api.dexscreener.com/tokens/v1/base/${TOKENS.degen}`]: FX.dexscreenerDegen,
    ...over,
  };
  const launch = origins();
  return (url: string) => (url in table ? table[url] : launch(url));
}

/** The launchpad says "not ours", and the token's own name/symbol reads do not answer either. */
const unreadToken = (method: string, params: readonly unknown[]): Answer | undefined => factoryCalls()(method, params) ?? (method === "eth_call" ? DOWN : undefined);

describe("a whole Token Verdict", () => {
  it("reads DEGEN end to end: a clean trade, one owner power, concentrated holders — caution", async () => {
    world({ get: degenSources() });
    const report = await tokenVerdict(TOKENS.degen, CAPTURED_AT);
    expect(report.title).toBe("DEGEN — Token Verdict");
    expect(report.rows.filter((x) => x.label !== "Launchpad").slice(0, 4)).toEqual([
      row("Token", "Degen (DEGEN)", { href: `https://basescan.org/token/${TOKENS.degen}` }),
      row("Verdict", "Caution — 80/100, some lines raised a flag or could not be checked", { tone: "warn" }),
      row("Buy → sell, simulated now", "0.72% lost on the round trip (fees, impact and any tax)", { tone: "ok" }),
      row("Wallet-to-wallet transfer", "arrives in full", { tone: "ok" }),
    ]);
    expect(report.rows.find((x) => x.label === "Launcher's wallet")?.value).toBe("50+ transactions — its first use was not read");
    expect(report.notes[0]).toMatch(/^The trade is simulated on Base/);
    expect(report.sources).toEqual(["Base (eth_simulateV1)", "Relay", "GoPlus Security", "Blockscout", "DexScreener", "Base (the launchpads' own records)"]);
    expect(report.rows.find((x) => x.label === "Launchpad")?.value).toMatch(/^none of the known launchpads/);
  });

  it("names every red line in the notes", async () => {
    world({ get: degenSources(), sim: (calls) => (calls.length < 3 ? captured(calls) : reverting(VX.simRoundtrip, 2, "nope")) });
    const report = await tokenVerdict(TOKENS.degen, CAPTURED_AT);
    expect(report.rows[1]?.tone).toBe("bad");
    expect(report.notes[0]).toBe("Red: Buy → sell, simulated now.");
  });

  /** CHUBBY an hour after launch, from its captures: the launcher pulled liquidity, the pool is empty, no buy fills. */
  it("reads a rug as high risk, and names every red line", async () => {
    const empty = copy(FX.dexscreenerDegen) as { liquidity: { usd: number } }[];
    empty[0]!.liquidity.usd = 0;
    world({
      buy: () => json({ message: "Swap impact is too high: 859.38%" }, 400),
      calls: unreadToken,
      get: (url) =>
        url.startsWith("https://api.gopluslabs.io/") || url === `${BLOCKSCOUT}/tokens/${TOKENS.chubby}` || url === `${BLOCKSCOUT}/tokens/${TOKENS.chubby}/holders`
          ? DOWN
          : url === `https://api.dexscreener.com/tokens/v1/base/${TOKENS.chubby}`
            ? empty
            : origins()(url),
    });
    const report = await tokenVerdict(TOKENS.chubby, CAPTURED_AT);
    expect(report.rows[1]).toMatchObject({ label: "Verdict", tone: "bad" });
    expect(report.notes[0]).toBe("Red: Buy → sell, simulated now; Launcher pulled liquidity; Liquidity (uniswap, vs WETH).");
  });

  it("turns every source that fails into a not-checked row, and still answers", async () => {
    world({
      get: degenSources({
        [`${BLOCKSCOUT}/tokens/${TOKENS.degen}`]: DOWN,
        [`${BLOCKSCOUT}/tokens/${TOKENS.degen}/holders`]: DOWN,
        [`https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${TOKENS.degen}`]: DOWN,
        [`https://api.dexscreener.com/tokens/v1/base/${TOKENS.degen}`]: DOWN,
        [`${BLOCKSCOUT}/addresses/${TOKENS.degen}`]: DOWN,
      }),
      sim: () => new RpcError("execution timeout"),
      calls: unreadToken,
    });
    const report = await tokenVerdict(TOKENS.degen, CAPTURED_AT);
    expect(report.title).toBe(`Token Verdict — ${TOKENS.degen}`);
    expect(report.rows.filter((x) => x.value.startsWith("not checked")).map((x) => x.label)).toEqual([
      "Launchpad",
      "Buy → sell, simulated now",
      "Code scan",
      "Top 10 holders",
      "Launched by",
      "Market",
    ]);
    expect(report.notes.find((n) => n.startsWith("The simulation could not run:"))).toMatch(/execution timeout/);
    expect(report.notes.at(-1)).toMatch(/^Blockscout has no token at this address/);
  });

  it("names a proven launchpad as the launch's `via`, never the transaction's `to`", async () => {
    // DEGEN's captures, with Clanker's record of BOAR answered for it — a variant, built here
    world({ get: degenSources(), calls: (m, p) => factoryCalls()(m, p) ?? padCalls({ [TOKENS.degen]: "boar" })(m, p) });
    const report = await tokenVerdict(TOKENS.degen, CAPTURED_AT);
    expect(report.rows.find((x) => x.label === "Launchpad")).toMatchObject({ value: "Clanker: Clanker's factory recorded its deployment", tone: "ok" });
    expect(report.rows.find((x) => x.label === "Launched by")?.value).toMatch(/, through Clanker$/);
  });

  it("is a skill: one token address, checked before anything is read", async () => {
    expect(verdictSkill.args.map((a) => a.name)).toEqual(["token address"]);
    await expect(verdictSkill.run(["degen"])).rejects.toThrow(/Token/);
    await expect(verdictSkill.run([])).rejects.toThrow(/Token/);
    world({ get: degenSources() });
    expect((await verdictSkill.run([TOKENS.degen])).title).toBe("DEGEN — Token Verdict");
  });
});
