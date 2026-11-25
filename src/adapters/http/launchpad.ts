import { BRAND } from "@/brand";
import { decodeEventLog, decodeFunctionResult, encodeFunctionData, toHex } from "viem";
import { CONTRACTS } from "@/config/chain";
import { LAUNCH_HOOK_ABI, LAUNCHPAD_ABI, LAUNCHPAD_EXPECTS, LAUNCHPAD_SPACING, LAUNCHPAD_V3_ABI, LAUNCHPAD_V3_EXPECTS } from "@/config/launchpad";
import { toChecksumAddress } from "@/lib/address";
import type { Receipt, TxRequest } from "@/lib/transact";
import { ethCall } from "@/skills/http";
import { baseStocks, type BaseStock } from "@/adapters/http/markets";
import { TRADE_CRYPTO } from "@/config/markets";
import { messageOf } from "@/lib/errors";

/**
 * This app's own launchpad on Base (`contracts/src/LaunchFactory.sol`): the transaction a launch
 * signs, the checks before it, and what the receipt says afterwards.
 *
 * Unlike o1, there is no quote from somebody else's API to check — this file BUILDS the one
 * transaction, from the form, to the one pinned factory. What is checked is the factory itself:
 * before anything is offered for signing, every number the launch relies on (the supply, the 1%
 * fee, the 80/20 split, the opening price, who the protocol's share goes to) is read from the
 * deployed contract and compared with what this build expects. A factory that answers anything
 * else is refused by name — the same rule as o1's factory and Relay's contracts (hard rule 16).
 */

export type Metadata = {
  readonly name: string;
  readonly symbol: string;
  readonly description: string;
  /** an https image URL, or "" */
  readonly image: string;
  /** an https website, or "" */
  readonly website: string;
};

/** Name 1–50 characters; symbol 1–11 with no spaces; description ≤ 280; links https only. */
export const LIMITS = { name: 50, symbol: /^\S{1,11}$/, description: 280 } as const;
const HTTPS = /^https:\/\/[^\s/]+\.[^\s]+$/;

/** The first thing about the form a launch would be refused for, or `null`. */
export function metadataProblem(m: Metadata): string | null {
  if (m.name.trim() === "") return "Enter a name";
  if (m.name.trim().length > LIMITS.name) return `Name is over ${LIMITS.name} characters`;
  if (!LIMITS.symbol.test(m.symbol.trim())) return "Enter a symbol (1–11 characters, no spaces)";
  if (m.description.trim().length > LIMITS.description) return `Description is over ${LIMITS.description} characters`;
  if (m.image.trim() !== "" && !HTTPS.test(m.image.trim())) return "Image must be an https:// link";
  if (m.website.trim() !== "" && !HTTPS.test(m.website.trim())) return "Website must be an https:// link";
  return null;
}

/**
 * The token's ERC-7572 metadata as a `data:` URI — stored by the token itself, on Base, so it
 * needs no pinning service and cannot disappear. Kept small on purpose: the image is a LINK, not
 * the picture (a picture in calldata and contract storage would cost tens of millions of gas).
 */
export function contractUri(m: Metadata): string {
  const json: Record<string, string> = { name: m.name.trim(), symbol: m.symbol.trim() };
  if (m.description.trim()) json.description = m.description.trim();
  if (m.image.trim()) json.image = m.image.trim();
  if (m.website.trim()) json.external_link = m.website.trim();
  const utf8 = new TextEncoder().encode(JSON.stringify(json));
  return `data:application/json;base64,${btoa(String.fromCharCode(...utf8))}`;
}

/** A fresh salt: 32 random bytes. The factory binds it to the caller, so it only has to be new. */
export function newSalt(): `0x${string}` {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** Which launchpad version a factory is: v2 (one 1% fee) or v3 (1% or 3%, and the anti-sniper opening). */
export type Version = 2 | 3;

/**
 * The pinned factory new launches go to — v3 once the owner has deployed it and set
 * `CONTRACTS.launchFactoryV3`, v2 until then — or a sentence saying none is deployed.
 */
export function launchFactory(): { readonly address: string; readonly version: Version } | { readonly waiting: string } {
  const v3 = CONTRACTS.launchFactoryV3;
  if (v3) return { address: toChecksumAddress(v3), version: 3 };
  const address = CONTRACTS.launchFactory;
  return address
    ? { address: toChecksumAddress(address), version: 2 }
    : {
        waiting:
          "The launchpad's version 2 — ETH and stock pairs — is not deployed yet; it waits on the owner's deploy (contracts/README.md). Coins launched on version 1 are still listed below and their fees can be collected.",
      };
}

/** The two fees a v3 launcher may choose, in hundredths of a basis point. */
export const LAUNCH_FEES = [LAUNCHPAD_V3_EXPECTS.feeLow, LAUNCHPAD_V3_EXPECTS.feeHigh] as const;
export type LaunchFee = (typeof LAUNCH_FEES)[number];

/** A v3 hook's anti-sniper opening, as READ from it: the fee at the pool's first second, and how long it takes to fall. */
export type Opening = { readonly hook: string; readonly startFee: number; readonly window: number };

const ETH_QUOTE = "0x0000000000000000000000000000000000000000";

/** What a coin can pair with: ETH, or a stock the factory's quote admin has enabled. */
export type Pair = {
  /** `0x0000…0000` for ETH */
  readonly address: string;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  /** the opening price, token-per-quote in raw units, as the FACTORY has it */
  readonly startTick: number;
};

/**
 * The launch transaction: to the pinned factory; ETH's first buy rides as `value`, a stock's is pulled.
 * With a `fee` it is v3's `launch` (the coin's fee its last argument); without, v1/v2's.
 */
/**
 * The launch transaction. v2 when `fee` is left out; v3 with the fee and a referrer — `ETH_QUOTE`'s
 * zero address (none) unless one is given. The factory counts a referrer only if it is APPROVED at
 * launch; an unapproved one is recorded as none, never a revert.
 */
export function launchTx(
  factory: string,
  m: Metadata,
  salt: `0x${string}`,
  pair: Pair,
  firstBuy: bigint,
  fee?: LaunchFee,
  referrer: string = ETH_QUOTE,
): TxRequest {
  const args = [m.name.trim(), m.symbol.trim(), contractUri(m), salt, pair.address as `0x${string}`, firstBuy] as const;
  return {
    to: factory,
    value: pair.address === ETH_QUOTE ? firstBuy : 0n,
    data:
      fee === undefined
        ? encodeFunctionData({ abi: LAUNCHPAD_ABI, functionName: "launch", args: [...args] })
        : encodeFunctionData({ abi: LAUNCHPAD_V3_ABI, functionName: "launch", args: [...args, fee, referrer as `0x${string}`] }),
  };
}

/** A pair's quote as the factory has it: enabled or not, and its opening tick. */
export async function quoteOf(factory: string, quote: string): Promise<{ readonly enabled: boolean; readonly startTick: number }> {
  const data = encodeFunctionData({ abi: LAUNCHPAD_ABI, functionName: "quotes", args: [quote as `0x${string}`] });
  const [enabled, startTick] = decodeFunctionResult({ abi: LAUNCHPAD_ABI, functionName: "quotes", data: await ethCall(factory, data) });
  return { enabled, startTick };
}

export const ECOSYSTEM_QUOTES: readonly { readonly address: string; readonly symbol: string; readonly name: string; readonly decimals: number }[] = [
  ...(CONTRACTS.token ? [{ address: toChecksumAddress(CONTRACTS.token), symbol: BRAND.ticker.replace("$", ""), name: BRAND.name, decimals: 18 }] : []),
];

/**
 * Every pair a launch can use right now: ETH, then each Base crypto / ecosystem token (`USDC`,
 * `cbBTC`, `AERO`, the brand token, ...) and Coinbase stock on Base that the factory has ENABLED.
 */
export async function launchPairs(factory: string): Promise<{ readonly pairs: readonly Pair[]; readonly problem: string | null }> {
  const eth = await quoteOf(factory, ETH_QUOTE);
  const pairs: Pair[] = eth.enabled ? [{ address: ETH_QUOTE, symbol: "ETH", name: "Ether", decimals: 18, startTick: eth.startTick }] : [];
  let stocks: BaseStock[];
  try {
    stocks = [...(await baseStocks()).values()];
  } catch (e) {
    return { pairs, problem: messageOf(e) };
  }
  // a stock whose TRANSFER feature (0) is paused cannot trade at all — B20 reverts it — so a pool of it would be dead
  // and only a stock with a NAV can have been enabled: the quote admin opens each pair at its NAV
  // (`scripts/quote-ticks.ts`). MEASURED 2026-10-29: 218 stocks, 12 with a NAV — asking the factory
  // about all 218 at once is a burst the public RPC answers with 429s
  const live = stocks.filter((st) => !st.paused.includes(0) && st.nav !== null);
  const tokenQuotes = [...ECOSYSTEM_QUOTES, ...TRADE_CRYPTO];
  const [cryptoQuotes, stockQuotes] = await Promise.all([
    Promise.all(tokenQuotes.map(async (c) => ({ c, q: await quoteOf(factory, c.address).catch(() => ({ enabled: false, startTick: 0 })) }))),
    Promise.all(live.map(async (st) => ({ st, q: await quoteOf(factory, st.address) }))),
  ]);
  for (const { c, q } of cryptoQuotes) {
    if (q.enabled) pairs.push({ address: c.address, symbol: c.symbol, name: c.name, decimals: c.decimals, startTick: q.startTick });
  }
  for (const { st, q } of stockQuotes) {
    if (q.enabled) pairs.push({ address: st.address, symbol: st.symbol, name: st.name, decimals: st.decimals, startTick: q.startTick });
  }
  return { pairs, problem: null };
}

/** Collecting a token's fees — anyone may send it; the split is the contract's. */
export function collectTx(factory: string, token: string): TxRequest {
  return { to: factory, data: encodeFunctionData({ abi: LAUNCHPAD_ABI, functionName: "collect", args: [token as `0x${string}`] }) };
}

/** The factory's no-argument getters, as one ABI so a single reader can take any of their names. */
const GETTERS = LAUNCHPAD_ABI.filter(
  (item): item is Extract<(typeof LAUNCHPAD_ABI)[number], { type: "function"; stateMutability: "view"; inputs: readonly [] }> =>
    item.type === "function" && item.stateMutability === "view" && item.inputs.length === 0,
);
type Getter = (typeof GETTERS)[number]["name"];

async function read(factory: string, functionName: Getter): Promise<unknown> {
  const data = encodeFunctionData({ abi: GETTERS, functionName });
  return decodeFunctionResult({ abi: GETTERS, functionName, data: await ethCall(factory, data) });
}

export type FactoryCheck = { readonly kind: "ok"; readonly opening?: Opening } | { readonly kind: "refused"; readonly why: string };

const refusal = (factory: string, why: string): FactoryCheck => ({ kind: "refused", why: `This build will not sign for the launchpad at ${factory}: ${why}. Nothing was sent.` });

/** What the factory on Base says about itself, checked: `ok`, or the first thing that differs. */
export async function checkFactory(factory: string, version: Version = 2): Promise<FactoryCheck> {
  if (version === 3) return checkFactoryV3(factory);
  const [supply, fee, share, eth, protocol] = await Promise.all([
    read(factory, "TOTAL_SUPPLY"),
    read(factory, "LP_FEE"),
    read(factory, "CREATOR_SHARE_BPS"),
    quoteOf(factory, ETH_QUOTE),
    read(factory, "protocolRecipient"),
  ]);
  const tick = eth.startTick;
  const why =
    supply !== LAUNCHPAD_EXPECTS.supply
      ? `its supply is ${supply}, not ${LAUNCHPAD_EXPECTS.supply}`
      : fee !== LAUNCHPAD_EXPECTS.lpFee
        ? `its pool fee is ${fee}, not ${LAUNCHPAD_EXPECTS.lpFee}`
        : share !== LAUNCHPAD_EXPECTS.creatorShareBps
          ? `its launcher share is ${share} bps, not ${LAUNCHPAD_EXPECTS.creatorShareBps}`
          : tick !== LAUNCHPAD_EXPECTS.startTick
            ? `its ETH opening tick is ${tick}, not ${LAUNCHPAD_EXPECTS.startTick}`
            : String(protocol).toLowerCase() !== CONTRACTS.treasury?.toLowerCase()
              ? `its protocol share goes to ${protocol}, not to this app's fee address`
              : null;
  return why === null ? { kind: "ok" } : refusal(factory, why);
}

const V3_GETTERS = LAUNCHPAD_V3_ABI.filter(
  (item): item is Extract<(typeof LAUNCHPAD_V3_ABI)[number], { type: "function"; stateMutability: "view"; inputs: readonly [] }> =>
    item.type === "function" && item.stateMutability === "view" && item.inputs.length === 0,
);
const HOOK_GETTERS = LAUNCH_HOOK_ABI.filter(
  (item): item is Extract<(typeof LAUNCH_HOOK_ABI)[number], { type: "function"; inputs: readonly [] }> => item.type === "function" && item.inputs.length === 0,
);

async function readV3(factory: string, functionName: (typeof V3_GETTERS)[number]["name"]): Promise<unknown> {
  const data = encodeFunctionData({ abi: V3_GETTERS, functionName });
  return decodeFunctionResult({ abi: V3_GETTERS, functionName, data: await ethCall(factory, data) });
}

async function readHook(hook: string, functionName: (typeof HOOK_GETTERS)[number]["name"]): Promise<unknown> {
  const data = encodeFunctionData({ abi: HOOK_GETTERS, functionName });
  return decodeFunctionResult({ abi: HOOK_GETTERS, functionName, data: await ethCall(hook, data) });
}

/**
 * v3, checked its own way: the supply, the two fees, the split, the tick spacing, the fee address —
 * and its HOOK, which must say this factory is its own and open at the deploy script's schedule.
 * No opening tick is pinned (the quote admin may re-price a pair; the review shows the tick read now).
 */
/** v3's protocol share may go to the treasury, or to the FeeRouter that splits it between the treasury and the Backstop. */
function protocolOk(protocol: string): boolean {
  const ok = [CONTRACTS.treasury, CONTRACTS.feeRouter].filter((a): a is string => a !== null).map((a) => a.toLowerCase());
  return ok.includes(protocol.toLowerCase());
}

async function checkFactoryV3(factory: string): Promise<FactoryCheck> {
  const [supply, low, high, share, referrerShare, spacing, protocol, hookAt] = await Promise.all([
    readV3(factory, "TOTAL_SUPPLY"),
    readV3(factory, "FEE_LOW"),
    readV3(factory, "FEE_HIGH"),
    readV3(factory, "CREATOR_SHARE_BPS"),
    readV3(factory, "REFERRER_SHARE_BPS"),
    readV3(factory, "TICK_SPACING"),
    readV3(factory, "protocolRecipient"),
    readV3(factory, "hook"),
  ]);
  const hook = toChecksumAddress(String(hookAt));
  const [owner, startFee, window] = await Promise.all([readHook(hook, "factory"), readHook(hook, "startFee"), readHook(hook, "window")]);
  const E = LAUNCHPAD_V3_EXPECTS;
  const why =
    supply !== E.supply
      ? `its supply is ${supply}, not ${E.supply}`
      : low !== E.feeLow || high !== E.feeHigh
        ? `its fees are ${low} and ${high}, not ${E.feeLow} and ${E.feeHigh}`
        : share !== E.creatorShareBps
          ? `its launcher share is ${share} bps, not ${E.creatorShareBps}`
          : referrerShare !== E.referrerShareBps
            ? `its referrer share is ${referrerShare} bps, not ${E.referrerShareBps}`
          : spacing !== E.tickSpacing
            ? `its tick spacing is ${spacing}, not ${E.tickSpacing}`
            : !protocolOk(String(protocol))
              ? `its protocol share goes to ${protocol}, not to this app's fee address`
              : String(owner).toLowerCase() !== factory.toLowerCase()
                ? `its hook ${hook} belongs to ${owner}, not to this launchpad`
                : startFee !== E.startFee || window !== E.window
                  ? `its hook opens at a fee of ${startFee} over ${window} s, not ${E.startFee} over ${E.window} s`
                  : null;
  return why === null ? { kind: "ok", opening: { hook, startFee: Number(startFee), window: Number(window) } } : refusal(factory, why);
}

/** The address the factory will give this creator's token for this salt. */
export async function predictToken(factory: string, creator: string, salt: `0x${string}`): Promise<string> {
  const data = encodeFunctionData({ abi: LAUNCHPAD_ABI, functionName: "predictToken", args: [creator as `0x${string}`, salt] });
  return toChecksumAddress(decodeFunctionResult({ abi: LAUNCHPAD_ABI, functionName: "predictToken", data: await ethCall(factory, data) }));
}

export type Launched = { readonly token: string; readonly devBuyIn: bigint; readonly devBuyTokens: bigint };

/** The factory's own `Launched` event in a receipt — what really happened, not what was predicted. */
export function launchedIn(receipt: Receipt, factory: string): Launched | null {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
    try {
      // `Launched` is the only event in the ABI, so a log that decodes IS a launch
      const { args } = decodeEventLog({ abi: LAUNCHPAD_ABI, data: log.data as `0x${string}`, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] });
      return { token: toChecksumAddress(args.token), devBuyIn: args.devBuyIn, devBuyTokens: args.devBuyTokens };
    } catch {
      // another of the factory's events (a payment, a fee collection): not the launch
    }
  }
  return null;
}

/** The whole supply's value in ETH at the opening price: supply ÷ (tokens per ETH = 1.0001^tick). */
export function openingValueEth(tick: number = LAUNCHPAD_EXPECTS.startTick): number {
  return openingValue(tick, 18);
}

/**
 * The whole supply's value in whole units of a quote with `decimals`, at an opening tick. Ticks are
 * token-per-quote in RAW units, so a quote's decimals matter: NVDAc has 8 (MEASURED), ETH 18 — the
 * same tick is ten orders of magnitude apart between them (hard rule 3).
 */
export function openingValue(tick: number, decimals: number): number {
  return Number(LAUNCHPAD_EXPECTS.supply) / 1.0001 ** tick / 10 ** decimals;
}

/**
 * The opening tick that makes the whole supply worth `targetUsd` against a quote priced at
 * `quoteUsd` per whole unit, rounded to the pool's tick spacing. What the quote admin passes to
 * `setQuote` — computed here, from live prices, never typed by hand.
 */
export function startTickFor(targetUsd: number, quoteUsd: number, decimals: number): number {
  const rawQuote = (targetUsd / quoteUsd) * 10 ** decimals;
  const tick = Math.log(Number(LAUNCHPAD_EXPECTS.supply) / rawQuote) / Math.log(1.0001);
  return Math.round(tick / LAUNCHPAD_SPACING) * LAUNCHPAD_SPACING;
}
