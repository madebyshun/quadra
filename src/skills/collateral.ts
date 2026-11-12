import { decodeFunctionResult, encodeFunctionData } from "viem";
import { AAVE_V4, AAVE_V4_APP, BPS, FEED_ABI, MORPHO, MORPHO_ABI, MORPHO_ORACLE_ABI, MORPHO_STOCK_MARKETS, ORACLE_ABI, PRICE_DECIMALS, SPOKE_ABI, WAD } from "@/config/collateral";
import { deepest, marketsOf, type Market } from "@/skills/dexscreener";
import { explorer, short, tokenAmount, usd } from "@/skills/format";
import { ethCall } from "@/skills/http";
import { resolveTarget } from "@/skills/target";
import { chainToken } from "@/skills/chaintoken";
import { worstGaps, type Gap } from "@/skills/weekendGap";
import { row, type Report, type Row, type Skill, type Tone } from "@/skills/types";

/**
 * Collateral Watch — a wallet's tokenized stocks borrowed against on Aave V4's Equities hub (the
 * MAG7 spoke), as a person needs it: how far each stock can fall before the position is
 * liquidated, and what the WEEKEND does to that.
 *
 * Why the weekend: the spoke prices every stock with Coinbase's NAV feed, which is set only while
 * the US market trades — MEASURED 2026-11-11, every feed's `updatedAt` was that afternoon, UTC. The
 * same tokens keep trading on Base's DEXes all weekend. So on a Sunday the DEX already shows where
 * Monday is likely to open, and the position's real distance from liquidation is the one at THAT
 * price, not the frozen one. The DEX figure is a scenario, never the liquidation price itself: Aave
 * liquidates at its oracle.
 *
 * The health factor is the spoke's own (`getUserAccountData`). Liquidation prices are worked out
 * here from the same inputs — each stock's balance, the oracle's price, and the factor the spoke
 * fixed for THIS user's position (`getUserPosition().dynamicConfigKey`). If the factor recomputed
 * from them disagrees with the spoke's by more than `AGREE`, the inputs are not what the spoke
 * uses, and no liquidation price is printed: a wrong one is worse than none.
 */

/** How far the recomputed health factor may differ from the spoke's before the math is not trusted. */
export const AGREE = 0.005;
/** Health factor tones: below the first is red, below the second amber (the spoke's target is 1.24). */
export const HF_BAD = 1.05;
export const HF_WARN = 1.25;
/** Distance-to-liquidation tones, as a fraction of the oracle price. */
export const DIST_BAD = 0.1;
export const DIST_WARN = 0.25;

export type Position = {
  readonly reserve: number;
  readonly token: string;
  readonly symbol: string;
  readonly decimals: number;
  /** base units */
  readonly supplied: bigint;
  readonly debt: bigint;
  readonly collateral: boolean;
  /** the oracle's price, 8 decimals */
  readonly price: bigint;
  /** basis points, the user's own config */
  readonly factor: number;
  /** the feed: when it last set a price (seconds), and its name */
  readonly feed: { readonly address: string; readonly name: string | null; readonly updatedAt: number | null } | null;
};

export type Snapshot = {
  readonly user: string;
  readonly via: string | null;
  /** the spoke's health factor, WAD; `null` when the account has no debt (the spoke answers max uint) */
  readonly health: bigint | null;
  readonly positions: readonly Position[];
  /** the deepest Base DEX market per token (lowercase), when DexScreener answered */
  readonly dex: ReadonlyMap<string, Market> | null;
  /** positions in Morpho's stock markets (`MORPHO_STOCK_MARKETS`); `null` when Morpho could not be read */
  readonly morpho: readonly MorphoPosition[] | null;
  /** each collateral stock's worst recorded weekend gap (Blue Agent), by symbol; a missing or `null` entry is "not checked" */
  readonly gaps: ReadonlyMap<string, Gap | null>;
};

export type MorphoPosition = {
  readonly market: `0x${string}`;
  readonly token: string;
  readonly symbol: string;
  readonly decimals: number;
  /** collateral, base units */
  readonly collateral: bigint;
  /** borrowed USDC, base units (shares → assets rounded UP, as Morpho does for a borrower) */
  readonly borrowed: bigint;
  /** the market's oracle: USDC per stock token */
  readonly price: number;
  /** liquidation LTV, 0..1 */
  readonly lltv: number;
};

/** Morpho's virtual shares and assets (SharesMathLib): 1e6 shares and 1 asset added to each side. */
const VIRTUAL_SHARES = 10n ** 6n;
const USDC_DECIMALS = 6;

/** A borrower's debt from its shares, rounded up — what Morpho itself charges. */
export function borrowAssets(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  const num = shares * (totalAssets + 1n);
  const den = totalShares + VIRTUAL_SHARES;
  return (num + den - 1n) / den;
}

async function morphoOf(user: `0x${string}`): Promise<MorphoPosition[]> {
  const read = <F extends "position" | "market" | "idToMarketParams">(functionName: F, args: readonly unknown[]) =>
    call(MORPHO, encodeFunctionData({ abi: MORPHO_ABI, functionName, args } as never), (data) => decodeFunctionResult({ abi: MORPHO_ABI, functionName, data } as never) as unknown);
  const found = await Promise.all(
    MORPHO_STOCK_MARKETS.map(async (m) => {
      const [, borrowShares, collateral] = (await read("position", [m.id, user])) as readonly [bigint, bigint, bigint];
      if (borrowShares === 0n && collateral === 0n) return null;
      const [mk, params] = (await Promise.all([read("market", [m.id]), read("idToMarketParams", [m.id])])) as [readonly bigint[], readonly [string, string, string, string, bigint]];
      const [, collateralToken, oracle, , lltv] = params;
      const [raw, info] = await Promise.all([
        call(oracle, encodeFunctionData({ abi: MORPHO_ORACLE_ABI, functionName: "price" }), (data) => decodeFunctionResult({ abi: MORPHO_ORACLE_ABI, functionName: "price", data })),
        chainToken(collateralToken),
      ]);
      const position: MorphoPosition = {
        market: m.id,
        token: collateralToken,
        symbol: info.symbol,
        decimals: info.decimals,
        collateral,
        borrowed: borrowAssets(borrowShares, mk[2]!, mk[3]!),
        // loan base units per collateral base unit × 1e36 → USDC per whole token
        price: (Number(raw) / 1e36) * 10 ** (info.decimals - USDC_DECIMALS),
        lltv: Number(lltv) / 1e18,
      };
      return position;
    }),
  );
  return found.filter((p): p is MorphoPosition => p !== null);
}

const call = async <T>(to: string, data: `0x${string}`, decode: (d: `0x${string}`) => T): Promise<T> => decode(await ethCall(to, data));

/** Everything the report needs, read from the chain (and DexScreener) at once. */
export async function snapshot(input: string): Promise<Snapshot> {
  const target = await resolveTarget(input, "Wallet");
  const user = target.address as `0x${string}`;
  const spoke = AAVE_V4.spoke;
  const read = <F extends Parameters<typeof encodeFunctionData<typeof SPOKE_ABI>>[0]["functionName"]>(functionName: F, args: readonly unknown[]) =>
    call(spoke, encodeFunctionData({ abi: SPOKE_ABI, functionName, args } as never), (data) => decodeFunctionResult({ abi: SPOKE_ABI, functionName, data } as never) as unknown);

  const [account, count] = await Promise.all([read("getUserAccountData", [user]), read("getReserveCount", [])]);
  const acct = account as { healthFactor: bigint; borrowCount: bigint };
  const ids = Array.from({ length: Number(count as bigint) }, (_, i) => BigInt(i));
  const held = await Promise.all(
    ids.map(async (id) => {
      const [supplied, debt, status] = await Promise.all([read("getUserSuppliedAssets", [id, user]), read("getUserTotalDebt", [id, user]), read("getUserReserveStatus", [id, user])]);
      return { id, supplied: supplied as bigint, debt: debt as bigint, collateral: (status as readonly [boolean, boolean])[0] };
    }),
  );
  const mine = held.filter((h) => h.supplied > 0n || h.debt > 0n);
  const prices =
    mine.length === 0
      ? []
      : await call(AAVE_V4.oracle, encodeFunctionData({ abi: ORACLE_ABI, functionName: "getReservesPrices", args: [mine.map((h) => h.id)] }), (data) =>
          decodeFunctionResult({ abi: ORACLE_ABI, functionName: "getReservesPrices", data }),
        );
  const positions = await Promise.all(
    mine.map(async (h, i): Promise<Position> => {
      const reserve = (await read("getReserve", [h.id])) as { underlying: string; decimals: number; dynamicConfigKey: number };
      const own = (await read("getUserPosition", [h.id, user])) as { dynamicConfigKey: number };
      const config = (await read("getDynamicReserveConfig", [h.id, own.dynamicConfigKey])) as { collateralFactor: number };
      const [symbol, feed] = await Promise.all([chainToken(reserve.underlying).then((t) => t.symbol, () => short(reserve.underlying)), feedOf(h.id)]);
      return {
        reserve: Number(h.id),
        token: reserve.underlying,
        symbol,
        decimals: reserve.decimals,
        supplied: h.supplied,
        debt: h.debt,
        collateral: h.collateral,
        price: prices[i]!,
        factor: config.collateralFactor,
        feed,
      };
    }),
  );
  const morpho = await morphoOf(user).catch(() => null);
  const stocks = [...new Set([...positions.filter((p) => p.collateral && p.supplied > 0n).map((p) => p.token), ...(morpho ?? []).map((p) => p.token)])];
  const dex =
    stocks.length === 0
      ? new Map<string, Market>()
      : await marketsOf(stocks).then(
          (all) =>
            new Map(
              stocks.flatMap((t) => {
                const best = deepest(all.filter((m) => m.base?.toLowerCase() === t.toLowerCase() && m.priceUsd !== null));
                return best ? [[t.toLowerCase(), best] as const] : [];
              }),
            ),
          () => null,
        );
  const health = acct.borrowCount === 0n ? null : acct.healthFactor;
  // the worst weekends on record, only for a wallet that borrows — nothing to stress otherwise
  const borrows = health !== null || (morpho ?? []).some((p) => p.borrowed > 0n);
  const symbols = [...positions.filter((p) => p.collateral && p.supplied > 0n).map((p) => p.symbol), ...(morpho ?? []).map((p) => p.symbol)];
  const gaps = borrows ? await worstGaps(symbols) : new Map<string, Gap | null>();
  return { user: target.address, via: target.via, health, positions, dex, morpho, gaps };
}

/** The feed behind a reserve's price, and when it last set one — `null` when it could not be read. */
async function feedOf(id: bigint): Promise<Position["feed"]> {
  try {
    const address = await call(AAVE_V4.oracle, encodeFunctionData({ abi: ORACLE_ABI, functionName: "getReserveSource", args: [id] }), (data) =>
      decodeFunctionResult({ abi: ORACLE_ABI, functionName: "getReserveSource", data }),
    );
    const [name, round] = await Promise.all([
      call(address, encodeFunctionData({ abi: FEED_ABI, functionName: "description" }), (data) => decodeFunctionResult({ abi: FEED_ABI, functionName: "description", data })).catch(() => null),
      call(address, encodeFunctionData({ abi: FEED_ABI, functionName: "latestRoundData" }), (data) => decodeFunctionResult({ abi: FEED_ABI, functionName: "latestRoundData", data })).catch(() => null),
    ]);
    return { address, name, updatedAt: round === null ? null : Number(round[3]) };
  } catch {
    return null;
  }
}

// ── the arithmetic ───────────────────────────────────────────────────────────

const units = (raw: bigint, decimals: number) => Number(raw) / 10 ** decimals;
const priceUsd = (p: Position) => units(p.price, PRICE_DECIMALS);
const value = (p: Position, raw: bigint) => units(raw, p.decimals) * priceUsd(p);

export type Math = {
  readonly debtUsd: number;
  /** Σ collateral value × factor */
  readonly weighted: number;
  /** recomputed health factor; Infinity with no debt */
  readonly health: number;
};

/** The position's numbers at the given prices (by token, lowercase; missing = the oracle's). */
export function mathAt(positions: readonly Position[], at: ReadonlyMap<string, number> = new Map()): Math {
  const px = (p: Position) => at.get(p.token.toLowerCase()) ?? priceUsd(p);
  const debtUsd = positions.reduce((s, p) => s + units(p.debt, p.decimals) * px(p), 0);
  const weighted = positions.filter((p) => p.collateral).reduce((s, p) => s + units(p.supplied, p.decimals) * px(p) * (p.factor / Number(BPS)), 0);
  return { debtUsd, weighted, health: debtUsd === 0 ? Infinity : weighted / debtUsd };
}

/** The price at which `p` alone takes the position to a health factor of 1, everything else unchanged. */
export function liquidationPrice(positions: readonly Position[], p: Position): number | null {
  const m = mathAt(positions);
  const mine = value(p, p.supplied) * (p.factor / Number(BPS));
  const tokens = units(p.supplied, p.decimals) * (p.factor / Number(BPS));
  if (m.debtUsd === 0 || tokens === 0) return null;
  const at = (m.debtUsd - (m.weighted - mine)) / tokens;
  return at > 0 ? at : 0;
}

/** Is the US stock market shut at `ms`? Weekends, and weekdays outside 13:30–20:00 UTC — holidays are not known. */
export function marketShut(ms: number): boolean {
  const d = new Date(ms);
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return true;
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return minutes < 13 * 60 + 30 || minutes >= 20 * 60;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const hf = (x: number) => x.toFixed(2);
const hfTone = (x: number): Tone => (x < HF_BAD ? "bad" : x < HF_WARN ? "warn" : "ok");
const distTone = (x: number): Tone => (x < DIST_BAD ? "bad" : x < DIST_WARN ? "warn" : "ok");

function ago(seconds: number, now: number): string {
  const h = (now / 1000 - seconds) / 3600;
  return h < 1 ? `${Math.max(0, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
}

function utc(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function collateralRows(s: Snapshot, now: number): { rows: Row[]; notes: string[] } {
  const rows: Row[] = [];
  const notes: string[] = [];
  const stocks = s.positions.filter((p) => p.collateral && p.supplied > 0n);
  const debts = s.positions.filter((p) => p.debt > 0n);
  if (s.positions.length === 0) {
    rows.push(row("Aave V4 · MAG7", "no stock supplied and nothing borrowed", { tone: "ok", href: AAVE_V4_APP }));
    return { rows, notes };
  }

  const m = mathAt(s.positions);
  const chain = s.health === null ? Infinity : Number(s.health) / Number(WAD);
  const trusted = s.health === null || Math.abs(m.health - chain) / chain <= AGREE;
  rows.push(row("Health factor", s.health === null ? "no debt — nothing can be liquidated" : `${hf(chain)} — liquidated below 1.00`, { tone: s.health === null ? "ok" : hfTone(chain) }));
  for (const d of debts) rows.push(row(`Borrowed · ${d.symbol}`, `${tokenAmount(d.debt, d.decimals, 2)} ${d.symbol} (${usd(value(d, d.debt))})`, { href: explorer.token(d.token) }));
  for (const p of s.positions.filter((x) => x.supplied > 0n)) {
    const used = p.collateral ? `counts ${p.factor / 100}% as collateral` : "supplied, NOT used as collateral";
    rows.push(row(`Supplied · ${p.symbol}`, `${tokenAmount(p.supplied, p.decimals, 2)} ${p.symbol} · ${usd(value(p, p.supplied))} at Aave's price · ${used}`, { href: explorer.token(p.token) }));
  }
  if (!trusted) {
    rows.push(row("Liquidation prices", `not worked out — this build's health factor (${hf(m.health)}) does not match the spoke's (${hf(chain)}), so its inputs are not the spoke's`, { tone: "warn" }));
    return { rows, notes };
  }

  const shut = marketShut(now);
  for (const p of s.health !== null ? stocks : []) {
    const liq = liquidationPrice(s.positions, p)!;
    const px = priceUsd(p);
    const dist = 1 - liq / px;
    rows.push(row(`Liquidation · ${p.symbol}`, dist <= 0 ? `at or above Aave's ${usd(px)} — the position can be liquidated now` : `${usd(liq)} — ${pct(dist)} below Aave's ${usd(px)} (other holdings unchanged)`, { tone: distTone(dist) }));
    const feed = p.feed;
    if (feed === null || feed.updatedAt === null) rows.push(row(`Price feed · ${p.symbol}`, "not checked — the feed behind Aave's price could not be read", { tone: "warn" }));
    else {
      const frozen = shut ? " — the US market is shut, so this price stays until it reopens" : "";
      const text = `${feed.name ?? short(feed.address)}, last set ${utc(feed.updatedAt)} (${ago(feed.updatedAt, now)})${frozen}`;
      rows.push(row(`Price feed · ${p.symbol}`, text, shut ? { tone: "warn", href: explorer.address(feed.address) } : { href: explorer.address(feed.address) }));
    }
  }

  // the scenario: every stock at its Base DEX price
  if (s.health !== null && stocks.length > 0) {
    if (s.dex === null) rows.push(row("At Base DEX prices", "not checked — DexScreener could not be reached", { tone: "warn" }));
    else {
      const at = new Map<string, number>();
      const parts: string[] = [];
      for (const p of stocks) {
        const d = s.dex.get(p.token.toLowerCase());
        if (!d || d.priceUsd === null) {
          parts.push(`${p.symbol} has no DEX price`);
          continue;
        }
        at.set(p.token.toLowerCase(), d.priceUsd);
        const gap = d.priceUsd / priceUsd(p) - 1;
        parts.push(`${p.symbol} ${usd(d.priceUsd)} (${Math.abs(gap) < 0.0005 ? "0.0%" : `${gap > 0 ? "+" : ""}${pct(gap)}`} vs Aave)`);
      }
      if (at.size === 0) rows.push(row("At Base DEX prices", `not checked — ${parts.join(", ")}`, { tone: "warn" }));
      else {
        const then = mathAt(s.positions, at).health;
        const lead = shut ? "If the market reopened at Base's prices" : "At Base's DEX prices";
        rows.push(row(lead, `health ${hf(then)} (now ${hf(chain)}) — ${parts.join(", ")}`, { tone: hfTone(then) }));
      }
    }
  }

  // the stress: every stock at its worst recorded weekend gap (Blue Agent's grading), the oracle moving in one step
  if (s.health !== null && stocks.length > 0) {
    const at = new Map<string, number>();
    const parts: string[] = [];
    for (const p of stocks) {
      const g = s.gaps.get(p.symbol) ?? null;
      if (g === null) {
        parts.push(`${p.symbol} not checked`);
        continue;
      }
      at.set(p.token.toLowerCase(), priceUsd(p) * (1 + g.pct / 100));
      parts.push(`${p.symbol} ${g.pct.toFixed(2)}% (weekend of ${g.friday})`);
    }
    if (at.size === 0) rows.push(row(STRESS, "not checked — no weekend gap on record for these stocks", { tone: "warn" }));
    else {
      const then = mathAt(s.positions, at).health;
      rows.push(row(STRESS, `health ${hf(then)} (now ${hf(chain)})${then < 1 ? " — would be liquidated" : ""} — ${parts.join(", ")}`, { tone: hfTone(then) }));
    }
  }

  notes.push(
    "Aave liquidates at its own oracle — Coinbase's price feed for each stock — not at a DEX price. The DEX line is a scenario: where the position would stand if the feed caught up to Base's market.",
    "A liquidation price moves one stock at a time and holds the rest still; a borrow keeps growing with interest, so the distance shrinks slowly even when prices do not move.",
  );
  if (shut) notes.push("While the US market is shut the feed does not move, but the tokens still trade on Base — that gap is the weekend risk. US holidays are not known to this build.");
  return { rows, notes };
}

/** Each Morpho position: its own health and liquidation price, and the same at Base's DEX price. */
/** The stress row's label — read by the alerts (features/loanAlerts.tsx). */
export const STRESS = "At each stock's worst weekend gap";

export function morphoRows(s: Snapshot): Row[] {
  if (s.morpho === null) return [row("Morpho", "not checked — its stock markets could not be read just now", { tone: "warn" })];
  if (s.morpho.length === 0) return [row("Morpho", "no stock collateral and no debt in its stock markets", { tone: "ok" })];
  return s.morpho.map((p) => {
    const tokens = Number(p.collateral) / 10 ** p.decimals;
    const debt = Number(p.borrowed) / 10 ** USDC_DECIMALS;
    const label = `Morpho · ${p.symbol}`;
    const held = `${tokenAmount(p.collateral, p.decimals, 2)} ${p.symbol} (${usd(tokens * p.price)})`;
    if (debt === 0) return row(label, `${held}, nothing borrowed`, { tone: "ok" });
    const health = (tokens * p.price * p.lltv) / debt;
    const liq = debt / (tokens * p.lltv);
    const dist = 1 - liq / p.price;
    const dex = s.dex?.get(p.token.toLowerCase())?.priceUsd ?? null;
    const atDex = dex === null ? "" : ` · at Base's ${usd(dex)}: health ${((tokens * dex * p.lltv) / debt).toFixed(2)}`;
    const where = dist <= 0 ? "can be liquidated now" : `liquidated at ${usd(liq)}, ${pct(dist)} below its oracle's ${usd(p.price)}`;
    const g = s.gaps.get(p.symbol) ?? null;
    const stressed = g === null ? null : (tokens * p.price * (1 + g.pct / 100) * p.lltv) / debt;
    const atGap = g === null || stressed === null ? " · worst weekend gap: not checked" : ` · at its worst weekend gap (${g.pct.toFixed(2)}%, ${g.friday}): health ${stressed.toFixed(2)}`;
    const tone: Tone = dist <= 0 ? "bad" : hfTone(health) === "ok" ? (stressed !== null && stressed < 1 ? "warn" : distTone(dist)) : hfTone(health);
    return row(label, `${held} backing ${tokenAmount(p.borrowed, USDC_DECIMALS, 2)} USDC · health ${health.toFixed(2)} · ${where}${atDex}${atGap}`, { tone });
  });
}

export async function collateralReport(input: string, now: number): Promise<Report> {
  const s = await snapshot(input);
  const { rows, notes } = collateralRows(s, now);
  const who = s.via ?? short(s.user);
  return {
    title: `${who} — Collateral Watch`,
    rows: [row("Wallet", s.via ? `${s.via} (${s.user})` : s.user, { href: explorer.address(s.user) }), ...rows, ...morphoRows(s)],
    notes: [...notes, `Morpho: the ${MORPHO_STOCK_MARKETS.length} stock markets holding $1k or more of collateral when this was built (${MORPHO_STOCK_MARKETS.map((m) => m.symbol).join(", ")} against USDC). Each is its own loan, liquidated on its own.`],
    sources: ["Aave V4 on Base (the MAG7 spoke and its oracle)", "Morpho Blue on Base (positions, markets, their oracles)", "Coinbase price feeds (when each last set a price)", "DexScreener (Base DEX prices)", "Blue Agent (each stock's weekend gaps, graded since 2026-08-28)"],
  };
}

export const collateralSkill: Skill = {
  id: "collateral",
  title: "Collateral Watch",
  summary: "A wallet's stocks borrowed against on Aave V4 and Morpho: health, how far each can fall before liquidation, and the weekend gap between the frozen oracle price and Base's market.",
  args: [{ name: "wallet", hint: "0x… or name.base.eth" }],
  run: ([input = ""]) => collateralReport(input, Date.now()),
};
