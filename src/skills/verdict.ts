import { assertChecksummedAddress, toChecksumAddress } from "@/lib/address";
import { messageOf } from "@/lib/errors";
import { UNISWAP_V4_POOL_MANAGER } from "@/config/chain";
import { tokenInfo, topHolders, type Holding, type TokenInfo } from "@/skills/blockscout";
import { deepest, markets, type Market } from "@/skills/dexscreener";
import { explorer, price, quoteWords, short, usd } from "@/skills/format";
import { scan, type Flag, type Scan } from "@/skills/goplus";
import { originOf, type Origin } from "@/skills/origin";
import { launchpadOf, type Launchpad, type Proven } from "@/skills/launchpads";
import { isV3, launchOf, launchpadOrigin, poolValue, v3FeeOf, v3ReferrerOf, type CoinFee, type LaunchRecord, type PoolValue } from "@/skills/launchpad";
import { chainToken } from "@/skills/chaintoken";
import { BRAND } from "@/brand";
import { feePercent, LAUNCHPAD_EXPECTS } from "@/config/launchpad";
import { poolRouter, roundTrip, type RoundTrip, type Transfer } from "@/skills/simulate";
import { NATIVE, poolKeyOf, type LaunchPool } from "@/lib/v4swap";
import { row, type Report, type Row, type Skill } from "@/skills/types";

/**
 * Token Verdict: should I buy this? Answered the way a careful trader would, all at once.
 *
 * What makes it more than a block explorer's token page is the first section: a REAL trade,
 * run on Base right now without being sent (`simulate.ts`) — buy with 0.01 ETH, move half to
 * another wallet, sell it all back — so a honeypot, a hidden tax or a sell that reverts is
 * MEASURED, not inferred from code patterns. Beside it: what the code lets its owner do
 * (GoPlus), who really holds the supply once pools and burns are set aside, who launched it and
 * what else they have launched, and how deep the market is.
 *
 * 🔴 Three answers, never two (hard rule 12): high risk / caution / no red flags found — and the
 * last is never written as "safe". Anything that could not be read is a row saying so, in amber,
 * and it counts against the score: a check that did not run is not a check that passed.
 */

/** The round trip's loss above which something is taking a cut that fees and impact do not explain. */
export const LOSS_WARN = 0.08;
export const LOSS_BAD = 0.25;
/** How many holders the concentration figure adds up. */
export const TOP = 10;
/** Score: what each red and each amber line costs, out of 100. */
export const COST = { bad: 35, warn: 10 } as const;
const DAY_MS = 86_400_000;
/** Above this share the top holders could move the price on their own. */
export const CONCENTRATED = 0.5;
/** A launcher with this many launches behind it is a serial launcher. */
export const SERIAL = 5;

/** Addresses whose balance is nobody's: burned supply. */
const BURN = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead", "0xdead000000000000000042069420694206942069"]);

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const pct = (f: number) => `${(f * 100).toFixed(Math.abs(f) < 0.1 ? 2 : 1)}%`;

// ── The trade ─────────────────────────────────────────────────────────────

/**
 * Relay refuses a route whose impact would take nearly everything — itself a measurement of the
 * market. MEASURED 2026-10-01 both ways: a sell at "-99.95%", and, on CHUBBY an hour after its
 * liquidity was pulled, a BUY at "859.38%" — 0.01 ETH could not be filled by what was left.
 */
const NO_MARKET = /impact is too high/i;

export function tradeRows(t: RoundTrip | null): Row[] {
  const label = "Buy → sell, simulated now";
  if (t === null) return [row(label, "not checked — the simulation could not run", { tone: "warn" })];
  switch (t.kind) {
    case "no-route":
      if (!NO_MARKET.test(t.why)) return [row(label, `no ${t.side} route — ${t.why}`, { tone: "warn" })];
      // A refused BUY is a measurement: there is nothing left to buy against. A refused SELL is not —
      // Relay prices the sell against the pool as it is NOW, before the simulated buy put any ETH in.
      // MEASURED on this app's first launch: a fresh single-sided pool holds almost no ETH, so the
      // sell back of a 0.01 ETH buy was "impact too high: -99.98%" although the buy would have paid
      // for it. Every fresh launch looks like that, so it is unknown, not a trap.
      return t.side === "sell"
        ? [row(label, `not checked — the buy went through, but Relay prices the sell before the buy, and a fresh pool holds almost nothing but the token yet: ${t.why}`, { tone: "warn" })]
        : [row(label, `even 0.01 ETH cannot be filled: the market is all but empty — ${t.why}`, { tone: "bad" })];
    case "buy-reverted":
      return [row(label, `the buy reverts right now — "${t.reason}"`, { tone: "warn" })];
    case "sell-reverted":
      return [
        row(label, `bought, then the SELL reverted — "${t.reason}"`, { tone: "bad" }),
        ...(t.halfSold === true ? [row("Selling half", "went through — the token lets part out and keeps the rest", { tone: "bad" })] : []),
        transferRow(t.transfer),
      ];
    case "traded":
      return [
        row(label, `${pct(t.loss)} lost on the round trip (fees, impact and any tax)`, {
          tone: t.loss > LOSS_BAD ? "bad" : t.loss > LOSS_WARN ? "warn" : "ok",
        }),
        ...(t.shortfall > 0.01
          ? [row("Tokens delivered vs quoted", `${pct(t.shortfall)} short — a buy tax or a fee on transfer`, { tone: t.shortfall > 0.1 ? "bad" : "warn" })]
          : []),
        transferRow(t.transfer),
      ];
  }
}

export function transferRow(t: Transfer): Row {
  const label = "Wallet-to-wallet transfer";
  if (t.kind === "not-run") return row(label, "not checked — no tokens to move", { tone: "warn" });
  if (t.kind === "reverted") return row(label, `reverts — "${t.reason}"`, { tone: "bad" });
  if (t.arrived >= 0.999) return row(label, "arrives in full", { tone: "ok" });
  return row(label, `${pct(1 - t.arrived)} taken on the way`, { tone: t.arrived < 0.9 ? "bad" : "warn" });
}

// ── The code ──────────────────────────────────────────────────────────────

/**
 * A check, which answer is the worrying one, and how worrying. A TRAP takes a buyer's money by
 * design and is red; an OWNER POWER is a risk many legitimate tokens carry (MEASURED: DEGEN is
 * mintable) and is amber — painting DEGEN red would teach people to ignore the red line.
 */
type Check = { readonly label: string; readonly flag: Flag; readonly badWhen: "yes" | "no"; readonly severity: "bad" | "warn" };

/** The labels a code check can raise, for a reader that groups a report's code lines (the share card). */
export const codeLabels = (): string[] => checksOf({} as Scan).map((c) => c.label);

export function checksOf(s: Scan): Check[] {
  return [
    { label: "Honeypot pattern", flag: s.honeypot, badWhen: "yes", severity: "bad" },
    { label: "Owner can change balances", flag: s.ownerCanChangeBalance, badWhen: "yes", severity: "bad" },
    { label: "Hidden owner", flag: s.hiddenOwner, badWhen: "yes", severity: "bad" },
    { label: "Ownership can be taken back", flag: s.takeBackOwnership, badWhen: "yes", severity: "bad" },
    { label: "Can self-destruct", flag: s.selfdestruct, badWhen: "yes", severity: "bad" },
    { label: "Owner can mint more", flag: s.mintable, badWhen: "yes", severity: "warn" },
    { label: "Transfers can be paused", flag: s.transferPausable, badWhen: "yes", severity: "warn" },
    { label: "Has a blacklist", flag: s.blacklist, badWhen: "yes", severity: "warn" },
    { label: "Tax can be changed", flag: s.slippageModifiable, badWhen: "yes", severity: "warn" },
    { label: "Upgradeable (proxy)", flag: s.proxy, badWhen: "yes", severity: "warn" },
    { label: "Source code verified", flag: s.openSource, badWhen: "no", severity: "warn" },
  ];
}

export function checkRow(c: Check): Row {
  if (c.flag === "unknown") return row(c.label, "not checked", { tone: "warn" });
  return row(c.label, c.flag, { tone: c.flag === c.badWhen ? c.severity : "ok" });
}

/** A clean scan in words: how many checks, the ones people ask about, and the tax when GoPlus read it. */
export function cleanScan(s: Scan): string {
  const tax = s.buyTax !== null && s.sellTax !== null ? `, tax ${pct(s.buyTax)} buy / ${pct(s.sellTax)} sell` : "";
  return `${checksOf(s).length} checks passed — not a honeypot, no mint, no pause, no blacklist, source verified${tax}`;
}

export function codeRows(s: Scan | null | undefined): Row[] {
  if (s === undefined) return [row("Code scan", "not checked — GoPlus could not be reached", { tone: "warn" })];
  if (s === null) return [row("Code scan", "not checked — GoPlus has no report on this token", { tone: "warn" })];
  // Only the lines that say something: a wall of "no" buries the one "yes". Unknowns stay.
  const lines = checksOf(s).map(checkRow).filter((r) => r.tone !== "ok");
  // all clean: say WHAT was checked, so "clean" is a list a reader can weigh, not a blank
  return lines.length ? lines : [row("Code scan", cleanScan(s), { tone: "ok" })];
}

// ── The holders ───────────────────────────────────────────────────────────

/**
 * What the largest holders own once pools and burned supply are set aside. A pool is
 * liquidity, not a whale: the pair addresses DexScreener lists, and Uniswap v4's PoolManager,
 * which holds every v4 pool's tokens.
 */
export function concentration(holders: readonly Holding[], supply: bigint, pools: ReadonlySet<string>): { share: number; largest: Holding | null; set: number } {
  let set = 0n;
  const people: Holding[] = [];
  for (const h of holders) {
    const a = h.holder.address.toLowerCase();
    if (pools.has(a) || BURN.has(a)) set += h.raw;
    else people.push(h);
  }
  const top = people.slice(0, TOP);
  const held = top.reduce((sum, h) => sum + h.raw, 0n);
  return { share: Number((held * 10_000n) / supply) / 10_000, largest: top[0] ?? null, set: Number((set * 10_000n) / supply) / 10_000 };
}

export function holderRows(info: TokenInfo | null, holders: readonly Holding[] | null, pairs: readonly Market[] | null): Row[] {
  const label = `Top ${TOP} holders`;
  if (holders === null || info === null || !info.totalSupply) return [row(label, "not checked — Blockscout has no holder list or supply", { tone: "warn" })];
  if (holders.length === 0) return [row(label, "none indexed yet — the indexer can lag a new token", { tone: "warn" })];
  const pools = new Set([UNISWAP_V4_POOL_MANAGER.toLowerCase(), ...(pairs ?? []).flatMap((p) => (p.pair ? [p.pair.toLowerCase()] : []))]);
  const c = concentration(holders, info.totalSupply, pools);
  const rows = [
    // amber at most: concentration is a risk, not a trap — DEGEN's top ten hold 62% (MEASURED), mostly its own Safes
    row(label, `${pct(c.share)} of supply, pools and burns set aside`, { tone: c.share > CONCENTRATED ? "warn" : "ok" }),
  ];
  if (c.largest) {
    const share = Number((c.largest.raw * 10_000n) / info.totalSupply) / 10_000;
    const who = c.largest.holder.label ?? short(c.largest.holder.address);
    rows.push(row("Largest holder", `${who} — ${pct(share)}`, { href: explorer.address(c.largest.holder.address) }));
  }
  if (c.set > 0) rows.push(row("In pools or burned", pct(c.set)));
  return rows;
}

// ── The launcher ──────────────────────────────────────────────────────────

function age(ms: number): string {
  const days = ms / DAY_MS;
  if (days < 1) return plural(Math.max(1, Math.round(ms / 3_600_000)), "hour", "hours");
  if (days < 60) return plural(Math.round(days), "day", "days");
  return `${(days / 365).toFixed(1)} years`;
}

export function originRows(o: Origin | null | undefined, now: number, pad: Proven | null = null): Row[] {
  if (o === undefined && pad?.admin)
    return [
      row("Launched by", `not read just now — ${pad.name} recorded ${short(pad.admin)} as the token's admin at launch (often, not always, its creator)`, {
        tone: "warn",
        href: explorer.address(pad.admin),
      }),
    ];
  if (o === undefined) return [row("Launched by", "not checked — its launch could not be read just now (Blockscout or the Base RPC refused); try again", { tone: "warn" })];
  if (o === null) return [row("Launched by", "not checked — no launch transaction on record", { tone: "warn" })];
  const through = o.via ? (o.via.name ?? short(o.via.address)) : null;
  const l = o.launcher;
  if (l === null) {
    const by = o.relay ?? "a smart wallet";
    return [row("Launched by", `${by}${through ? `, through ${through}` : ""} — the launcher is not identified`, { tone: "warn" })];
  }
  const how = through
    ? `${short(l.address)}, through ${through}`
    : o.relay
      ? `${short(l.address)}, through ${o.relay} — the contract that created the token is not identified`
      : `${short(l.address)}, deployed directly`;
  const rows: Row[] = [
    row("Launched by", how, {
      ...(through || !o.relay ? {} : { tone: "warn" as const }),
      href: explorer.address(l.address),
      next: `profile ${l.address}`,
    }),
  ];
  if (l.pulledAt !== null) {
    rows.push(row("Launcher pulled liquidity", `${age(now - l.pulledAt.getTime())} ago — it took liquidity out of a pool`, { tone: "bad" }));
  }
  if (!l.complete) rows.push(row("Launcher's wallet", `${l.txCount}+ transactions — its first use was not read`));
  else if (l.firstSeen === null) rows.push(row("Launcher's wallet", "no history on record", { tone: "warn" }));
  else {
    const old = now - l.firstSeen.getTime();
    rows.push(row("Launcher's wallet", `first used ${age(old)} ago, ${plural(l.txCount, "transaction", "transactions")}`, { tone: old < DAY_MS ? "warn" : "ok" }));
  }
  // Through a launchpad, many calls to the same factory is a serial launcher. Direct deployments are only a fact:
  // a developer's wallet deploys many contracts (MEASURED: DEGEN's deployer), and few of them are tokens.
  // MEASURED: one Clanker launcher's newest 50 transactions were all `deployToken`.
  const more = l.complete ? "" : "+";
  rows.push(
    through
      ? row("Launcher's track record", `${l.factoryCalls}${l.callsComplete ? "" : "+"} ${l.factoryCalls === 1 ? "launch" : "launches"} through ${through}`, {
          tone: l.factoryCalls >= SERIAL ? "warn" : "ok",
        })
      : row("Launcher's track record", `${l.deployments}${more} ${l.deployments === 1 ? "contract" : "contracts"} deployed`),
  );
  if (l.funder) rows.push(row("Launcher funded by", short(l.funder), { href: explorer.address(l.funder) }));
  return rows;
}

// ── Which launchpad ──────────────────────────────────────────────────────

/**
 * The launchpad, PROVEN from its own record (`launchpads.ts`): green with what the record guarantees;
 * red when the token looks like one and the launchpad has no record of it; a plain line when it is
 * none of the known ones; amber when the records could not be read (`undefined`, hard rule 12).
 */
export function launchpadRow(pad: Launchpad | undefined): Row[] {
  const label = "Launchpad";
  if (pad === undefined) return [row(label, "not checked — the launchpads' records could not be read", { tone: "warn" })];
  if (pad.kind === "unknown") return [row(label, "none of the known launchpads (basepad.si, Feel.cash, Doppler, Clanker, Zora, this app's) has a record of it")];
  if (pad.kind === "claimed") return [row(label, `looks like ${pad.name}, but is NOT one: ${pad.why}`, { tone: "bad" })];
  const what = pad.guarantees.length ? ` — ${pad.guarantees.join("; ")}` : "";
  return [row(label, `${pad.name}: ${pad.how}${what}`, { tone: "ok", href: explorer.address(pad.address) })];
}

// ── This app's launchpad ─────────────────────────────────────────────────

/**
 * A token launched on this app's own launchpad carries guarantees the CONTRACT enforces — they are
 * read from the factory, not inferred: no admin over the token, and liquidity no function can
 * remove. Nothing is said about a token that was not launched there.
 */
/** For a launchpad token, what the code allows is known exactly: the factory created it that way. */
export const LAUNCHPAD_CODE: Row = row(
  "Code",
  "a B20 token with no admin: nobody can mint, pause, seize or set a transfer rule, ever — created that way by the launchpad",
  { tone: "ok" },
);

/**
 * v3 only: the referrer recorded at launch, if any. `null` (none, or a v1/v2 coin) says nothing;
 * `undefined` (unread, or not read at all) is amber "not checked", never "none" (hard rule 12).
 */
export function referrerRows(referrer: string | null | undefined): Row[] {
  if (referrer === null) return [];
  if (referrer === undefined) return [row("Its referrer", "not checked — the launchpad could not be read", { tone: "warn" })];
  return [
    row("Its referrer", `${short(referrer)} — an approved referrer; every fee splits 80% creator / 5% referrer / ~15% ${BRAND.name}`, {
      href: explorer.address(referrer),
    }),
  ];
}

export function launchpadRows(record: LaunchRecord | null | undefined, fee?: CoinFee | null | undefined, referrer?: string | null): Row[] {
  if (record === null) return [];
  if (record === undefined) return [row(`${BRAND.name} launchpad`, "not checked — the launchpad could not be read", { tone: "warn" })];
  const base = "fixed supply with no admin; the liquidity is locked by the launchpad contract forever";
  // v3: the version, the fee its creator chose and the opening — read from its hook; `undefined` = unread
  const v3 = isV3(record.factory);
  const v3Rows =
    !v3
      ? []
      : fee
        ? [
            row(
              "Its fee",
              `${feePercent(fee.fee)} of every trade (its creator chose 1% or 3%)${fee.opening ? `; anti-sniper opening: for the first ${fee.opening.window} seconds the fee fell from ${feePercent(fee.opening.startFee)} to ${feePercent(fee.fee)}` : ""}`,
              { tone: "ok" },
            ),
          ]
        : [row("Its fee", "not checked — the launchpad's hook could not be read", { tone: "warn" })];
  return [
    row(`Launched on ${BRAND.name}'s launchpad`, v3 ? `version 3 — ${base}` : base, {
      tone: "ok",
      href: explorer.address(record.factory),
    }),
    ...v3Rows,
    ...(v3 ? referrerRows(referrer) : []),
    row("Its creator", short(record.creator), { href: explorer.address(record.creator) }),
  ];
}

/**
 * A launchpad coin's value read from its OWN pool — the one number DexScreener cannot give for a
 * coin paired with a stock (it lists such pools with no USD price, MEASURED). `undefined`: the pool
 * could not be read; it is a row in amber, never an absence (hard rule 12).
 */
export function poolValueRows(value: PoolValue | null | undefined): Row[] {
  if (value === null) return [];
  const label = "Market cap (its own pool)";
  if (value === undefined) return [row(label, "not checked — its pool could not be read", { tone: "warn" })];
  const supply = `${quoteWords(value.supplyInQuote)} ${value.quoteSymbol} for the whole supply`;
  if (value.quoteUsd === null) return [row(label, `${supply} — the ${value.quoteSymbol} price in USD could not be read`, { tone: "warn" })];
  const cap = value.supplyInQuote * value.quoteUsd;
  return [
    // a stock quote links to the stock; ETH has no token page to link
    row(label, `≈ ${usd(cap)} — ${price(cap / Number(LAUNCHPAD_EXPECTS.supply / 10n ** 18n))} a token; ${supply} at ${price(value.quoteUsd)}`, value.quoteSymbol === "ETH" ? {} : { href: explorer.token(value.quote) }),
  ];
}

/** The stock a launchpad coin is paired with, or `null` for ETH, no launch, or an unread pool. */
export function stockQuote(value: PoolValue | null | undefined): string | null {
  return value && value.quoteSymbol !== "ETH" ? value.quoteSymbol : null;
}

// ── The market ────────────────────────────────────────────────────────────

export function marketRows(pairs: readonly Market[] | null, now: number, stock: string | null = null): Row[] {
  if (pairs === null) return [row("Market", "not checked — DexScreener could not be read", { tone: "warn" })];
  const m = deepest(pairs);
  if (m === null) {
    // MEASURED: DexScreener lists a stock-paired v4 pool only after its first trade
    const why = stock ? ` — DexScreener lists a pool paired with ${stock} only after its first trade; the value above is read from the pool itself` : "";
    return [row("Market", `no market found on Base${why}`, { tone: "warn" })];
  }
  const rows: Row[] = [
    row("Price", m.priceUsd === null ? "not quoted" : price(m.priceUsd)),
    row(`Liquidity (${m.dex}, vs ${m.quote})`, m.liquidityUsd === null ? "unknown" : m.liquidityUsd < 1 ? `${usd(m.liquidityUsd)} — none left: pulled, or never added` : usd(m.liquidityUsd), {
      tone: m.liquidityUsd === null ? "warn" : m.liquidityUsd < 1 ? "bad" : m.liquidityUsd < 10_000 ? "warn" : "ok",
      ...(m.url ? { href: m.url } : {}),
    }),
    row("Volume 24h", m.volume24h === null ? "unknown" : usd(m.volume24h)),
  ];
  if (m.buys24h !== null && m.sells24h !== null) rows.push(row("Trades 24h", `${plural(m.buys24h, "buy", "buys")}, ${plural(m.sells24h, "sell", "sells")}`));
  if (m.createdAt !== null) rows.push(row("Pool age", age(now - m.createdAt), { tone: now - m.createdAt < DAY_MS ? "warn" : "ok" }));
  return rows;
}

// ── The verdict ───────────────────────────────────────────────────────────

export function score(rows: readonly Row[]): number {
  const bad = rows.filter((r) => r.tone === "bad").length;
  const warn = rows.filter((r) => r.tone === "warn").length;
  return Math.max(0, 100 - COST.bad * bad - COST.warn * warn);
}

export function verdictRow(rows: readonly Row[]): Row {
  const s = `${score(rows)}/100`;
  if (rows.some((r) => r.tone === "bad")) return row("Verdict", `High risk — ${s}, see the red lines`, { tone: "bad" });
  if (rows.some((r) => r.tone === "warn")) return row("Verdict", `Caution — ${s}, some lines raised a flag or could not be checked`, { tone: "warn" });
  return row("Verdict", `No red flags found — ${s}`, { tone: "ok" });
}

/** A failed read as `undefined`, kept apart from a source that answered "nothing" (`null`). */
const settled = <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined);

/** The pool router for an ETH-paired coin launched here; nothing (so Relay) for anything else. */
const ownPool = (pool: LaunchPool | null) => (pool && pool.quote.toLowerCase() === NATIVE ? [poolRouter(pool)] : []);

/** The whole verdict for one token, as of `now`. */
export async function tokenVerdict(input: string, now: number): Promise<Report> {
  const address = toChecksumAddress(assertChecksummedAddress(input, "Token"));
  let simFailure: string | null = null;
  // the launch is found through the token's v4 pool when Blockscout names no creator, so it waits for the markets
  const market = settled(markets(address));
  // a token launched HERE is described by the factory: its origin is the factory's record
  const launch = settled(launchOf(address));
  // every other launchpad is asked only when this app's own has no record of the token
  const pad = launch.then((l) => (l ? null : settled(launchpadOf(address, Promise.resolve(null)))));
  const [info, security, pairs, holders, origin, trip, launchpad, value, other] = await Promise.all([
    settled(tokenInfo(address)).then(async (i) => i ?? (await settled(chainToken(address)))),
    settled(scan(address)),
    market,
    settled(topHolders(address)),
    launch.then((l) =>
      l ? settled(launchpadOrigin(l)) : Promise.all([market, pad]).then(([p, d]) => settled(originOf(address, p ?? [], d?.kind === "proven" ? d : null)))),
    // a coin launched here and paired with ETH trades through its own pool: Relay routes no v3 pool
    launch.then(async (l) => roundTrip(address, ...ownPool(l ? await poolKeyOf(address) : null))).catch((e: unknown) => {
      simFailure = messageOf(e);
      return null;
    }),
    launch,
    launch.then((l) => (l ? settled(poolValue(l.factory, address)) : null)),
    pad,
  ]);
  const [fee, referrer] = await Promise.all([v3FeeOf(launchpad, address), v3ReferrerOf(launchpad, address)]);
  const token = info ?? null;
  const body = [
    ...launchpadRows(launchpad, fee, referrer),
    ...(launchpad ? [] : launchpadRow(other ?? undefined)),
    ...tradeRows(trip),
    ...(launchpad ? [LAUNCHPAD_CODE] : codeRows(security)),
    ...holderRows(token, holders ?? null, pairs ?? null),
    ...originRows(origin, now, other?.kind === "proven" ? other : null),
    ...poolValueRows(value),
    ...marketRows(pairs ?? null, now, stockQuote(value)),
  ];
  const red = body.filter((r) => r.tone === "bad").map((r) => r.label);
  return {
    title: token ? `${token.symbol} — Token Verdict` : `Token Verdict — ${address}`,
    rows: [row("Token", token ? `${token.name} (${token.symbol})` : address, { href: explorer.token(address) }), verdictRow(body), ...body],
    notes: [
      ...(red.length ? [`Red: ${red.join("; ")}.`] : []),
      "The trade is simulated on Base at this block from an address nobody holds a key to — 0.01 ETH in, everything back out. Nothing was signed or sent. A token can change its rules after you buy.",
      "\"No red flags found\" is not \"safe\": it cannot see a team leaving or liquidity about to be pulled.",
      ...(simFailure ? [`The simulation could not run: ${simFailure}`] : []),
      ...(token === null ? ["Blockscout has no token at this address — check it is a token contract on Base."] : []),
    ],
    sources: ["Base (eth_simulateV1)", launchpad ? "Uniswap v4 (Quoter, Universal Router)" : "Relay", "GoPlus Security", "Blockscout", "DexScreener", ...(launchpad ? ["Uniswap v4 (its pool, read directly)"] : ["Base (the launchpads' own records)"])],
    next: [
      ...(launchpad ? [{ label: "Its page here", command: `coin ${address}` }] : []),
      { label: "Buy or sell it", command: `swap ${address}` },
      { label: "Launch forensics", command: `forensics ${address}` },
      { label: "Its launcher", command: `launcher ${address}` },
    ],
  };
}

export const verdictSkill: Skill = {
  id: "verdict",
  title: "Token Verdict",
  summary: "Before you buy: a real buy-and-sell on Base, simulated, plus the code, the holders, the launcher and the market.",
  args: [{ name: "token address", hint: "0x…" }],
  run: ([input = ""]) => tokenVerdict(input, Date.now()),
};
