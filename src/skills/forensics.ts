import { UNISWAP_V4_POOL_MANAGER } from "@/config/chain";
import { assertChecksummedAddress, toChecksumAddress } from "@/lib/address";
import { encodeFunctionData, erc20Abi } from "viem";
import { chainToken } from "@/skills/chaintoken";
import { deepest, markets, type Market } from "@/skills/dexscreener";
import { explorer, short } from "@/skills/format";
import { ethCall, quantity, rpc, rpcOn } from "@/skills/http";
import { isObj, listOf, strOf } from "@/skills/json";
import { ARCHIVE_RPC, BLOCK_SLACK } from "@/skills/origin";
import { TRANSFER_TOPIC } from "@/skills/simulate";
import { row, type Report, type Row, type Skill, type Tone } from "@/skills/types";

/**
 * Launch Forensics — who got a token first, and whether they look like one operator. The fifth of
 * the x402 tools the owner chose on 2026-10-02: launch forensics sells on Solana (Deepnets, $0.15)
 * and nobody sells it for Base.
 *
 * Read from the token's own Transfer logs over the first `WINDOW` blocks after its pool opened, on
 * the archive node (publicnode refuses old logs — origin.ts). MEASURED that day on a live launch
 * (VAMP, a "no hook" v4 pool, 13 minutes old):
 *   - 96.8% of the supply moved to one wallet the block after launch, outside the pool, and that
 *     wallet then sent dust to ~100 addresses in ONE transaction — holder-count padding;
 *   - the buys came every 2 blocks, 0.03–0.06% each, and the first eight buyers ALL had an EIP-7702
 *     delegation to the same contract and nonces of 1–15 — one operator, many wallets.
 * So a buy is found by NET balance change per transaction (a v4 swap moves tokens PoolManager →
 * router → buyer; the router nets to zero), and an operator by a shared delegate or shared code.
 */

/** Blocks read after the pool opened — one archive call (mainnet.base.org caps a range at 2,000). */
export const WINDOW = 1_800;
/** The first buyers looked at closely (code, nonce, balance now). */
export const EARLY = 20;
/** A buy this many blocks after launch or sooner is a snipe (2 s blocks: four seconds). */
export const SNIPE_BLOCKS = 2;
/** A wallet with at most this many transactions sent is fresh. */
export const FRESH_NONCE = 5;
/** One transaction sending the token to at least this many addresses is a spray. */
export const SPRAY = 20;
/** A wallet outside the pools holding this share of the supply at the hour's end is amber; double it, red. */
export const HOLDER_WARN = 10;

export type Log = { readonly block: number; readonly tx: string; readonly from: string; readonly to: string; readonly value: bigint };

/** Transfer logs, as the RPC answers them; a malformed log is skipped. */
export function parseLogs(body: unknown): Log[] {
  return listOf(body).flatMap((l) => {
    if (!isObj(l)) return [];
    const topics = listOf(l.topics).filter((t): t is string => typeof t === "string");
    const data = strOf(l.data);
    const tx = strOf(l.transactionHash);
    const block = parseInt(strOf(l.blockNumber) ?? "", 16);
    if (topics[0] !== TRANSFER_TOPIC || topics.length < 3 || !data || !tx || Number.isNaN(block)) return [];
    return [{ block, tx, from: `0x${topics[1]!.slice(26)}`.toLowerCase(), to: `0x${topics[2]!.slice(26)}`.toLowerCase(), value: BigInt(data === "0x" ? 0 : data) }];
  });
}

export type Buy = { readonly block: number; readonly tx: string; readonly buyer: string; readonly amount: bigint };
export type Holder = { readonly address: string; readonly amount: bigint };

export type Findings = {
  readonly launchBlock: number;
  /** buys through a pool, in order */
  readonly buys: readonly Buy[];
  /**
   * The largest holders outside the pools at the window's end, from the window's own transfers —
   * `null` when the token was minted before the window, so balances from before it are unknown.
   * MEASURED on VAMP: launch mechanics move the supply mint → factory → a wallet → the pool inside
   * a few blocks, so who holds at the END is the fact, not who held along the way.
   */
  readonly holders: readonly Holder[] | null;
  /** transactions that sent the token to many addresses at once */
  readonly sprays: readonly { readonly tx: string; readonly recipients: number }[];
};

const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";

/**
 * Buys, hand-outs and sprays from the logs. A transaction is a BUY when a pool's net change in it is
 * negative (tokens left the pool), and each address whose net change is positive in it is a buyer.
 * Anything else that moves a big share out of a non-pool address is a hand-out.
 */
export function analyze(logs: readonly Log[], pools: ReadonlySet<string>, launchBlock: number): Findings {
  const byTx = new Map<string, { block: number; delta: Map<string, bigint>; recipients: Set<string> }>();
  for (const l of logs) {
    const t = byTx.get(l.tx) ?? { block: l.block, delta: new Map(), recipients: new Set() };
    byTx.set(l.tx, t);
    t.delta.set(l.from, (t.delta.get(l.from) ?? 0n) - l.value);
    t.delta.set(l.to, (t.delta.get(l.to) ?? 0n) + l.value);
    t.recipients.add(l.to);
  }
  const buys: Buy[] = [];
  const sprays: { tx: string; recipients: number }[] = [];
  const balance = new Map<string, bigint>();
  for (const l of logs) {
    balance.set(l.from, (balance.get(l.from) ?? 0n) - l.value);
    balance.set(l.to, (balance.get(l.to) ?? 0n) + l.value);
  }
  for (const [tx, t] of byTx) {
    if (t.recipients.size >= SPRAY) sprays.push({ tx, recipients: t.recipients.size });
    const fromPool = [...t.delta].some(([who, d]) => pools.has(who) && d < 0n);
    for (const [who, d] of t.delta) {
      if (fromPool && d > 0n && !pools.has(who) && who !== ZERO) buys.push({ block: t.block, tx, buyer: who, amount: d });
    }
  }
  buys.sort((a, b) => a.block - b.block);
  const minted = logs.some((l) => l.from === ZERO);
  const holders = minted
    ? [...balance]
        .filter(([who, b]) => b > 0n && !pools.has(who) && who !== ZERO && who !== DEAD)
        .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
        .slice(0, 3)
        .map(([address, amount]) => ({ address, amount }))
    : null;
  return { launchBlock, buys, holders, sprays };
}

export type Wallet = {
  readonly address: string;
  /** transactions it has sent */
  readonly nonce: number | null;
  /** its EIP-7702 delegate, or `null` for a plain wallet; `undefined` when the code was not read */
  readonly delegate: string | null | undefined;
  /** a contract's code, by its first bytes — `null` for a wallet */
  readonly codeTag: string | null | undefined;
  /** what it holds now */
  readonly holds: bigint | null;
};

/** Wallets that look like one operator: a shared EIP-7702 delegate, or the same contract code. */
export function operators(wallets: readonly Wallet[]): { readonly by: string; readonly count: number } | null {
  const groups = new Map<string, number>();
  for (const w of wallets) {
    const key = w.delegate ? `delegate ${w.delegate}` : w.codeTag ? `contract code ${w.codeTag}` : null;
    if (key) groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const best = [...groups].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? { by: best[0], count: best[1] } : null;
}

/** A share in percent; a real amount too small to show stays above zero, so it reads "<0.01%", never "0%". */
const pct = (part: bigint, whole: bigint) => {
  const p = whole === 0n ? 0 : Number((part * 1_000_000n) / whole) / 10_000;
  return p === 0 && part > 0n ? 1e-6 : p;
};
const share = (n: number) => (n > 0 && n < 0.01 ? "<0.01%" : `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`);

/** The report's body from what was found and read. */
export function forensicRows(f: Findings, wallets: readonly Wallet[], supply: bigint, symbol: string, token: string): Row[] {
  const rows: Row[] = [];
  const early = f.buys.slice(0, EARLY);
  const sniped = f.buys.filter((b) => b.block - f.launchBlock <= SNIPE_BLOCKS).reduce((s, b) => s + b.amount, 0n);
  const snipedPct = pct(sniped, supply);
  rows.push(
    row("Sniped", f.buys.length === 0 ? "no buy through a pool in the window" : `${share(snipedPct)} of the supply bought within ${SNIPE_BLOCKS} blocks of launch`, {
      tone: snipedPct >= 20 ? "bad" : snipedPct >= 5 ? "warn" : "ok",
    }),
  );
  if (f.holders === null) {
    rows.push(row("Held outside the pool", "not checked — the token was minted before its pool, so earlier balances are not in the window", { tone: "warn" }));
  } else if (f.holders.length === 0) {
    rows.push(row("Held outside the pool", "nothing at the hour's end — the supply is in the pool", { tone: "ok" }));
  } else {
    const top = f.holders[0]!;
    const topPct = pct(top.amount, supply);
    // MEASURED on VAMP: the largest holder at the hour's end was the TOKEN'S OWN CONTRACT (96.8%) —
    // released by its code, not sold by a person; said as such, and amber, not red
    const self = top.address === token.toLowerCase();
    const who = self ? "the token's own contract" : short(toChecksumAddress(top.address));
    const then = f.holders.length > 1 ? `; then ${f.holders.slice(1).map((h) => share(pct(h.amount, supply))).join(", ")}` : "";
    const tone: Tone = topPct < HOLDER_WARN ? "ok" : self || topPct < 2 * HOLDER_WARN ? "warn" : "bad";
    rows.push(row("Held outside the pool", `largest ${share(topPct)} — ${who}${then} — at the hour's end`, { tone, href: explorer.address(toChecksumAddress(top.address)), next: `profile ${toChecksumAddress(top.address)}` }));
  }
  if (f.sprays.length) {
    const most = [...f.sprays].sort((a, b) => b.recipients - a.recipients)[0]!;
    rows.push(row("Sprayed", `${f.sprays.length} transaction${f.sprays.length === 1 ? "" : "s"} sent ${symbol} to ${SPRAY}+ addresses at once (up to ${most.recipients}) — holder-count padding`, { tone: "warn", href: explorer.tx(most.tx) }));
  }
  const op = operators(wallets);
  const read = wallets.filter((w) => w.delegate !== undefined);
  rows.push(
    op
      ? row("One operator", `${op.count} of the first ${wallets.length} buyers share ${op.by.startsWith("delegate") ? `an EIP-7702 delegate, ${short(op.by.slice(9))}` : `the same contract code`}`, {
          tone: op.count >= Math.max(3, Math.ceil(wallets.length / 3)) ? "bad" : "warn",
        })
      : read.length === 0 && wallets.length > 0
        ? row("One operator", "not checked — the buyers' code could not be read", { tone: "warn" })
        : row("One operator", wallets.length ? "no shared delegate or contract among the first buyers" : "no buyers to compare", { tone: "ok" }),
  );
  const nonces = wallets.filter((w) => w.nonce !== null);
  const fresh = nonces.filter((w) => w.nonce! <= FRESH_NONCE).length;
  if (nonces.length) {
    rows.push(row("Fresh wallets", `${fresh} of the first ${nonces.length} buyers have sent ${FRESH_NONCE} transactions or fewer`, { tone: fresh * 2 >= nonces.length ? "warn" : "ok" }));
  }
  const held = wallets.filter((w) => w.holds !== null);
  if (held.length) {
    const now = pct(held.reduce((s, w) => s + w.holds!, 0n), supply);
    const bought = pct(early.reduce((s, b) => s + b.amount, 0n), supply);
    rows.push(row("Early buyers hold now", `${share(now)} of the supply (they bought ${share(bought)})`, { tone: now >= 25 ? "bad" : now >= 10 ? "warn" : "ok" }));
  }
  for (const [i, b] of early.slice(0, 10).entries()) {
    const w = wallets.find((x) => x.address === b.buyer);
    const traits = [
      `+${b.block - f.launchBlock} blocks`,
      share(pct(b.amount, supply)),
      ...(w?.nonce != null && w.nonce <= FRESH_NONCE ? ["fresh"] : []),
      ...(w?.delegate ? [`delegates to ${short(w.delegate)}`] : []),
    ];
    rows.push(row(`Buyer ${i + 1}`, `${toChecksumAddress(b.buyer)} · ${traits.join(" · ")}`, { href: explorer.address(toChecksumAddress(b.buyer)), next: `profile ${toChecksumAddress(b.buyer)}` }));
  }
  return rows;
}

export function verdictOf(rows: readonly Row[]): Row {
  const tone: Tone = rows.some((r) => r.tone === "bad") ? "bad" : rows.some((r) => r.tone === "warn") ? "warn" : "ok";
  return row("Launch", tone === "bad" ? "Red flags — see the red lines" : tone === "warn" ? "Caution — see the amber lines" : "No red flags found in the first hour", { tone });
}

/** Where to read: from the pool's creation time on DexScreener, as a block (MEASURED exact at 2 s — origin.ts), to at most the chain's head. */
async function rangeOf(pairs: readonly Market[], now: number): Promise<{ readonly from: number; readonly to: number } | null> {
  const created = pairs.map((p) => p.createdAt).filter((t): t is number => t !== null).sort((a, b) => a - b)[0];
  if (created === undefined) return null;
  const latest = Number(quantity(await rpc("eth_blockNumber"), "the latest block"));
  const from = Math.max(0, latest - Math.round((now - created) / 2000) - BLOCK_SLACK);
  return { from, to: Math.min(latest, from + WINDOW) };
}

async function walletOf(address: string, token: string): Promise<Wallet> {
  const [nonce, code, holds] = await Promise.all([
    rpc("eth_getTransactionCount", [address, "latest"]).then((n) => Number(quantity(n, "a nonce")), () => null),
    rpc("eth_getCode", [address, "latest"]).then((c) => String(c), () => undefined),
    ethCall(token, encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] })).then((d) => BigInt(d), () => null),
  ]);
  const delegate = code === undefined ? undefined : /^0xef0100[0-9a-f]{40}$/i.test(code) ? toChecksumAddress(`0x${code.slice(8)}`) : null;
  const codeTag = code === undefined ? undefined : code === "0x" || delegate ? null : code.slice(0, 26);
  return { address, nonce, delegate, codeTag, holds };
}

export async function forensics(input: string, now: number): Promise<Report> {
  const token = toChecksumAddress(assertChecksummedAddress(input.trim(), "Token"));
  const [info, pairs] = await Promise.all([chainToken(token), markets(token)]);
  const supply = info.totalSupply;
  if (supply === null || supply === 0n) throw new Error(`${token}'s supply could not be read — shares of it cannot be measured.`);
  const range = await rangeOf(pairs, now);
  if (range === null) throw new Error(`${token} has no pool on record — there is no launch to read.`);
  const logs = parseLogs(
    await rpcOn("Base", ARCHIVE_RPC, "eth_getLogs", [{ address: token, topics: [TRANSFER_TOPIC], fromBlock: `0x${range.from.toString(16)}`, toBlock: `0x${range.to.toString(16)}` }]),
  );
  const pools = new Set([UNISWAP_V4_POOL_MANAGER.toLowerCase(), ...pairs.flatMap((p) => (p.pair && p.pair.length === 42 ? [p.pair.toLowerCase()] : []))]);
  // the launch is the first time tokens leave a pool, or the window's first transfer when none has
  const launchBlock = logs.find((l) => pools.has(l.from))?.block ?? logs[0]?.block ?? range.from;
  const found = analyze(logs, pools, launchBlock);
  const firstBuyers = [...new Set(found.buys.map((b) => b.buyer))].slice(0, EARLY);
  const wallets: Wallet[] = [];
  for (let i = 0; i < firstBuyers.length; i += 5) wallets.push(...(await Promise.all(firstBuyers.slice(i, i + 5).map((b) => walletOf(b, token)))));
  const body = forensicRows(found, wallets, supply, info.symbol, token);
  // a launch was found only because a pool was: there is one
  const pool = deepest(pairs)!;
  return {
    title: `${info.symbol} — Launch Forensics`,
    rows: [
      verdictOf(body),
      row("Token", `${info.name} (${info.symbol})`, { href: explorer.token(token) }),
      row("Window", `${WINDOW} blocks (~${Math.round((WINDOW * 2) / 60)} min) from block ${launchBlock.toLocaleString("en-US")}, pool on ${pool.dex} vs ${pool.quote} — ${found.buys.length} buys`),
      ...body,
    ],
    notes: [
      "A buy is a transaction in which tokens left a pool, and its buyer the address whose balance rose in it. One operator is several of the first buyers sharing an EIP-7702 delegate or the same contract code — the shape of a wallet farm, not proof of one owner.",
      "The first hour after the pool opened, from the token's own Transfer logs. A launch older than that is read from its pool's creation time on DexScreener.",
    ],
    sources: ["Base (Transfer logs on the archive node, wallet code and nonces, balances)", "DexScreener (the pool and its creation time)"],
    next: [
      { label: "Token Verdict", command: `verdict ${token}` },
      { label: "Its launcher", command: `launcher ${token}` },
    ],
  };
}

export const forensicsSkill: Skill = {
  id: "forensics",
  title: "Launch Forensics",
  summary: "The first hour of a token: snipers, who holds outside the pool, holder padding, and buyers that look like one operator.",
  args: [{ name: "token address", hint: "0x…" }],
  run: ([input = ""]) => forensics(input, Date.now()),
};
