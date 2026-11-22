import { BASE, UNISWAP_V4_POOL_MANAGER } from "@/config/chain";
import { KNOWN_LAUNCHPADS } from "@/config/launchpads";
import { BLOCKSCOUT } from "@/skills/blockscout";
import { blockAt } from "@/skills/blocktime";
import type { Market } from "@/skills/dexscreener";
import { getJson, rpc, rpcOn } from "@/skills/http";
import { isObj, listOf, strOf } from "@/skills/json";
import { INITIALIZE_TOPIC } from "@/skills/radar";
import type { Proven } from "@/skills/launchpads";

/**
 * Where a token came from: the wallet that launched it, through what, how old that wallet is,
 * what else it has launched, who funded it — and whether it has already pulled liquidity.
 *
 * Basescan shows each of those facts on a separate page and none of them says "rug". MEASURED
 * 2026-10-01 on CHUBBY, in the hour after it launched: its deployer was funded 1.405 ETH by one
 * wallet, deployed the token, added 1.4 ETH of liquidity, and fifteen minutes later called
 * `removeLiquidityETH`, sold, and sent 1.97 ETH away. Blockscout's v2 history names each call's
 * method, so that sequence is readable in one request.
 *
 * How the launch transaction is found, each step MEASURED the same day:
 * 1. Blockscout names a creation transaction for a contract deployed DIRECTLY (DEGEN, CHUBBY).
 * 2. For a token a launchpad's factory made inside a call it names none — six launchpad tokens of
 *    six. When the token trades on a Uniswap v4 pool, the launchpad created the token and the pool
 *    in ONE transaction: the pool's `Initialize` log. DexScreener's pool id and creation time find
 *    it — the time gives the block through Base's block clock (`blocktime.ts`; MEASURED: exact, 0 off)
 *    and one `eth_getLogs` over ±30 blocks returns it. 🔴 base.publicnode.com refuses logs older
 *    than its recent window ("Archive requests require a personal token"); mainnet.base.org
 *    answers them, so that one query goes there.
 * 3. That transaction names the sender and the contract called — the factory, by Blockscout's name
 *    ("Clanker", `deployToken`). When it called the ERC-4337 EntryPoint (`handleOps`), the sender
 *    is a BUNDLER relaying somebody's smart wallet, and the launcher is not identified rather than
 *    profiling the bundler.
 *
 * 🔴 Blockscout's etherscan-style API (`/api?module=account…`) was the first choice and is NOT
 * used: MEASURED, it allows 10 requests per ~45-minute window (`x-ratelimit-limit: 10`), and it
 * answers a rate limit as `status: "0"` with `result: null` — one character from its real empty
 * answer. The v2 API allows 150 per ~5 minutes. Its history comes newest-first, 50 to a page; a
 * launcher whose whole history fits on one page is read completely (a fresh wallet always does),
 * and one that does not is said to have "50+" with its first use not read.
 */

const SERVICE = "Blockscout";
/** Blockscout's v2 page size — a history with no next page is the whole history. */
export const PAGE = 50;
/** How far either side of the estimated block the pool's `Initialize` log is looked for (±90s at 5 blocks/s on Base; 900 blocks total stays under public RPC limits). */
export const BLOCK_SLACK = 450;
/** Archive-capable Base endpoints tried in order when `eth_getLogs` hits rate limits (HTTP 429/400/403). */
export const ARCHIVE_RPC: readonly string[] = [
  BASE.rpcFallback,
  "https://gateway.tenderly.co/public/base",
  "https://base.drpc.org",
  "https://1rpc.io/base",
  "https://base-rpc.publicnode.com",
];
/** Calls that take liquidity OUT: Uniswap v2's router and v3's position manager. */
const PULLS = /^(removeLiquidity|decreaseLiquidity)/i;

export type Launcher = {
  readonly address: string;
  /** the whole history was read — false when it runs past one page */
  readonly complete: boolean;
  /** transactions read (all of them when `complete`) */
  readonly txCount: number;
  /** its first transaction's time — known only when `complete` */
  readonly firstSeen: Date | null;
  /** contracts it deployed directly, in what was read */
  readonly deployments: number;
  /** its launches through the factory that made this token, in what was read */
  readonly factoryCalls: number;
  /** whether `factoryCalls` is the whole count — the history it was counted in may be one page */
  readonly callsComplete: boolean;
  /** who sent it its first ETH — known only when `complete`, and `null` when nobody did */
  readonly funder: string | null;
  /** the most recent call in which it took liquidity out, or `null` */
  readonly pulledAt: Date | null;
};

export type Origin = {
  /**
   * The launchpad, or the contract that CREATED the token — `null` for a direct deploy, or when the
   * launch came through a relay and the creating contract could not be read (then `relay` says so).
   * Never the transaction's `to` when that is a relay: MEASURED 2026-10-03, a basepad.si launch sent
   * from a MetaMask Smart Account (EIP-7702) went TO MetaMask's DelegationManager, and this was named
   * "through DelegationManager".
   */
  readonly via: { readonly address: string; readonly name: string | null } | null;
  /** `null` when the sender is not the launcher (an ERC-4337 bundler, a platform's own wallet) — `relay` says which */
  readonly launcher: Launcher | null;
  /** what the launch came through when that hid the launcher or the launchpad */
  readonly relay?: string;
};

type HistoryTx = {
  readonly from: string;
  readonly to: string | null;
  readonly value: string;
  readonly created: boolean;
  readonly at: Date | null;
  readonly method: string | null;
};

export type History = { readonly txs: readonly HistoryTx[]; readonly complete: boolean };

/** One page of a v2 address history, newest first. Throws when the answer is not one. */
export function parseHistory(body: unknown): History {
  if (!isObj(body) || !Array.isArray(body.items)) throw new Error("Blockscout did not send the launcher's history.");
  const txs = body.items.flatMap((t) => {
    if (!isObj(t)) return [];
    const at = Date.parse(strOf(t.timestamp) ?? "");
    return [
      {
        from: strOf(isObj(t.from) ? t.from.hash : null) ?? "",
        to: strOf(isObj(t.to) ? t.to.hash : null),
        value: strOf(t.value) ?? "0",
        created: isObj(t.created_contract),
        at: Number.isNaN(at) ? null : new Date(at),
        method: strOf(t.method),
      },
    ];
  });
  return { txs, complete: !isObj(body.next_page_params) };
}

/** A launcher's history read into the facts above. */
export function summarize(address: string, factory: string | null, history: History): Launcher {
  const me = address.toLowerCase();
  const { txs, complete } = history;
  const mine = txs.filter((t) => t.from.toLowerCase() === me);
  // newest first, so the LAST inbound payment is the first one ever
  const funded = txs.filter((t) => t.to?.toLowerCase() === me && /^[1-9]/.test(t.value)).at(-1);
  return {
    address,
    complete,
    txCount: txs.length,
    firstSeen: complete ? (txs.at(-1)?.at ?? null) : null,
    deployments: mine.filter((t) => t.created).length,
    factoryCalls: factory ? mine.filter((t) => t.to?.toLowerCase() === factory.toLowerCase()).length : 0,
    callsComplete: complete,
    funder: complete && funded ? funded.from : null,
    pulledAt: mine.find((t) => t.method !== null && PULLS.test(t.method))?.at ?? null,
  };
}

/** The transaction that initialized a v4 pool, found from its id and DexScreener's creation time. */
async function poolLaunch(pool: string, createdAt: number): Promise<string | null> {
  const block = BigInt(blockAt(Math.floor(createdAt / 1000)));
  const slack = BigInt(BLOCK_SLACK);
  const hex = (n: bigint) => `0x${(n < 0n ? 0n : n).toString(16)}`;
  const probe = async (from: bigint, to: bigint): Promise<string | null> => {
    const logs = await rpcOn(BASE.name, ARCHIVE_RPC, "eth_getLogs", [
      { address: UNISWAP_V4_POOL_MANAGER, topics: [INITIALIZE_TOPIC, pool], fromBlock: hex(from), toBlock: hex(to) },
    ]);
    const first = listOf(logs)[0];
    return isObj(first) ? strOf(first.transactionHash) : null;
  };
  // Try ±BLOCK_SLACK first (±90s at 5 blocks/s); if DexScreener's pairCreatedAt lagged, widen to ±4.5 min
  const hit = await probe(block - slack, block + slack);
  if (hit || block === 0n) return hit;
  const earlier = await probe(block - slack * 3n, block - slack - 1n).catch(() => null);
  if (earlier) return earlier;
  return probe(block + slack + 1n, block + slack * 3n).catch(() => null);
}

/** The launch transaction and the token's creator: Blockscout's creation record, or else the token's v4 pool initialization. */
async function launchTx(token: string, pairs: readonly Market[]): Promise<{ hash: string | null; creator: string | null } | null> {
  const record = await getJson(SERVICE, `${BLOCKSCOUT}/addresses/${token}`);
  const creator = isObj(record) ? strOf(record.creator_address_hash) : null;
  const creation = isObj(record) ? strOf(record.creation_transaction_hash) : null;
  if (creation) return { hash: creation, creator };
  // a v4 pool's id is 32 bytes, where a pool contract's address is 20
  const v4 = pairs.find((p) => p.pair?.length === 66 && p.createdAt !== null);
  const hash = v4 ? await poolLaunch(v4.pair!, v4.createdAt!) : null;
  if (hash) return { hash, creator };
  // Keep a known factory creator (e.g. Clanker v0-v5, Flaunch, Ape.Store) even if the pool Initialize log was outside the window
  if (creator && KNOWN_LAUNCHPADS[creator.toLowerCase()]) return { hash: null, creator };
  return null;
}

/** A wallet's history read into the launcher facts — for a launcher known some other way. */
export async function launcherProfile(address: string, factory: string | null): Promise<Launcher> {
  return summarize(address, factory, parseHistory(await getJson(SERVICE, `${BLOCKSCOUT}/addresses/${address}/transactions`)));
}

/**
 * A launch known to be through `factory` although the history may not show it as a call TO the
 * factory — a 7702 account calls through its delegate, a 4337 wallet through the EntryPoint. It is
 * at least one launch, and a count of direct calls is then only a lower bound.
 */
export function atLeastOne(l: Launcher): Launcher {
  return l.factoryCalls > 0 ? l : { ...l, factoryCalls: 1, callsComplete: false };
}

/** EIP-7702: a delegated account's code is `0xef0100 ‖ delegate` (MEASURED on the owner's wallet). */
export const DELEGATED = /^0xef0100/i;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * The token's origin, or `null` when no launch transaction can be found for it. With `pad` — a
 * launchpad that PROVED it made the token (`launchpads.ts`) — that launchpad is the `via`, and its
 * recorded launcher, when it records one, is the launcher without reading the transaction at all.
 */
export async function originOf(token: string, pairs: readonly Market[], pad: Proven | null = null): Promise<Origin | null> {
  const padVia = pad ? { address: pad.address, name: pad.name } : null;
  if (pad?.launcher) return { via: padVia, launcher: atLeastOne(await launcherProfile(pad.launcher, pad.address)) };
  const found = await launchTx(token, pairs);
  if (!found) return padVia ? { via: padVia, launcher: null, relay: "no launch transaction on record" } : null;
  if (!found.hash) {
    const via = padVia ?? (found.creator ? { address: found.creator, name: KNOWN_LAUNCHPADS[found.creator.toLowerCase()]?.name ?? null } : null);
    return via ? { via, launcher: null, relay: "no launch transaction on record" } : null;
  }
  const tx = await getJson(SERVICE, `${BLOCKSCOUT}/transactions/${found.hash}`);
  const from = isObj(tx) && isObj(tx.from) ? strOf(tx.from.hash) : null;
  if (!isObj(tx) || !from) return padVia ? { via: padVia, launcher: null, relay: "no launch transaction on record" } : null;
  const to = isObj(tx.to) ? strOf(tx.to.hash) : null;
  const toName = isObj(tx.to) ? strOf(tx.to.name) : null;
  const bundle = tx.method === "handleOps";
  if (padVia) {
    if (pad!.id === "feel") return { via: padVia, launcher: null, relay: "Feel.cash's own wallet, for a Feel.cash account" };
    if (bundle) return { via: padVia, launcher: null, relay: "an ERC-4337 bundle" };
    return { via: padVia, launcher: atLeastOne(await launcherProfile(from, padVia.address)) };
  }
  // the contract that CREATED the token, when Blockscout indexed it — never the transaction's `to` by default
  const creator = found.creator && !same(found.creator, from) ? found.creator : null;
  if (creator) {
    const known = KNOWN_LAUNCHPADS[creator.toLowerCase()]?.name ?? null;
    const via = { address: creator, name: (to && same(to, creator) ? toName : null) ?? known };
    if (bundle) return { via, launcher: null, relay: "an ERC-4337 bundle" };
    const l = await launcherProfile(from, creator);
    return { via, launcher: atLeastOne(l) };
  }
  if (bundle) return { via: null, launcher: null, relay: "an ERC-4337 bundle" };
  if (!to) return { via: null, launcher: await launcherProfile(from, null) };
  // with no creator on record, `to` is the factory only when the sender is a plain wallet calling it
  const code = String(await rpc("eth_getCode", [from, "latest"]));
  if (same(to, from) || DELEGATED.test(code)) return { via: null, launcher: await launcherProfile(from, null), relay: "an EIP-7702 smart account" };
  return { via: { address: to, name: toName }, launcher: atLeastOne(await launcherProfile(from, to)) };
}
