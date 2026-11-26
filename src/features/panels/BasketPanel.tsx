import { useBasketRecovery } from "@/features/panels/useBasketRecovery";
import { RebalancePreview } from "@/features/panels/RebalancePreview";
import { useEffect, useMemo, useRef, useState } from "react";
import { baseStocks, spots, type BaseStock } from "@/adapters/http/markets";
import { quoteSwap, type SwapQuote } from "@/adapters/http/relay";
import { BASE, CONTRACTS, USDC } from "@/config/chain";
import { TRADE_CRYPTO } from "@/config/markets";
import { RELAY_PAIRS } from "@/config/routes";
import { sameAddress } from "@/lib/address";
import { formatAmount, parseAmount } from "@/lib/amount";
import { basketProblem, MIN_TOP_UP_LEG, PRESETS, split, topUp, weightsNow, type BasketAsset, type Leg } from "@/lib/basket";
import { allowance, approveData, balanceOf, type Asset } from "@/lib/erc20";
import { buyData, buyWithPermitData, deadlineFrom, routerLeg, signPermit, totalOf, type RouterLeg } from "@/lib/basketRouter";
import { messageOf } from "@/lib/errors";
import { RESTRICTED_TEXT, useStocksClosed } from "@/lib/region";
import { tokenReceived, type TxRequest } from "@/lib/transact";
import { QUOTE_ACCOUNT } from "@/skills/depth";
import { tokenAmount, usd } from "@/skills/format";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import { useWalletSession } from "@/ui/WalletProvider";
import { TxStepList, useTxSteps, type Step } from "@/features/panels/TxSteps";
import { transfersPaused } from "@/features/panels/TradePanel";
import { useBasketBatch } from "@/features/panels/useBasketBatch";
import { BasketRecipes } from "@/features/panels/BasketRecipes";
import { parseRecipe, recipeLink } from "@/lib/basketRecipes";
import { measureStrength, type Strength } from "@/lib/basketStrength";
import { BasketShare } from "@/features/panels/BasketShare";
import { useOpenWindow } from "@/features/openWindow";

/**
 * Treasury Basket (2026-11-13): buy a basket of Coinbase stocks and verified crypto on Base with
 * USDC, each asset landing in YOUR wallet — no index token, no manager, no basket fee. One Relay swap
 * per asset, the same engine as Swap (`quoteSwap` → `checkSwap`, exact approvals, simulation before
 * the wallet sees anything, the delivered amount read from each receipt).
 *
 * Review quotes every leg, one at a time (Relay rate-limits a burst — MEASURED), and refuses to go on
 * if any leg would move its market more than `LOUD`% — a basket is only as liquid as its thinnest
 * asset. Signing takes a FRESH quote for each leg at its own moment: seven legs take longer than a
 * quote lives. A U.S. visitor is offered no stock (lib/region.ts), and a stock whose transfers are
 * paused is never quoted.
 */

/** Impact above this blocks the basket. */
export const LOUD = 2;
const SLIPPAGE_BPS = 100;
const USDC_ASSET: Asset = { kind: "erc20", address: USDC.address, symbol: "USDC", decimals: USDC.decimals };

/**
 * Relay's pace. MEASURED 2026-11-13: three quotes in a row went through and the fourth was refused
 * "Could not process request. Please try again later." — so quotes are spaced, and a refusal with
 * those words is asked again after a pause, twice. The pauses are here, not inline, so tests run
 * them at zero.
 */
export const PACE = { gapMs: 1200, retryMs: [2500, 6000] as readonly number[] };
const BUSY = /could not process request|try again later/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A Relay request, asked again while Relay says it is busy. */
async function retrying<T>(ask: () => Promise<T>): Promise<T> {
  const tries = [0, ...PACE.retryMs];
  let last: unknown;
  for (const [i, wait] of tries.entries()) {
    if (i > 0) await sleep(wait);
    try {
      return await ask();
    } catch (e) {
      if (!BUSY.test(messageOf(e))) throw e;
      last = e;
    }
  }
  throw last;
}

/** One leg's quote, asked again while Relay says it is busy. */
export async function quoteLeg(user: string, asset: BasketAsset, amount: bigint): Promise<SwapQuote> {
  return retrying(() => quoteSwap({ user, sell: USDC_ASSET, buy: asAsset(asset), amount, slippageBps: SLIPPAGE_BPS }));
}

type Row = { readonly symbol: string; readonly weight: string };
type Priced = { readonly leg: Leg; readonly amount: bigint; readonly quote: SwapQuote | null; readonly problem: string | null };

/** What a leg delivered, summed from its receipt's Transfer logs to the buyer (`tokenReceived`). */
const arrived = (amount: bigint, a: BasketAsset) => `arrived: ${tokenAmount(amount, a.decimals, 4)} ${a.symbol}`;
const asAsset = (a: BasketAsset): Asset => ({ kind: "erc20", address: a.address, symbol: a.symbol, decimals: a.decimals });
const impactOf = (q: SwapQuote) => (q.impact === null ? null : Math.abs(Number(q.impact)));

/** Every asset a basket may hold, by symbol (upper-cased): Coinbase's stocks by ticker and symbol, and the verified crypto. */
export function catalog(stocks: ReadonlyMap<string, BaseStock>): Map<string, BasketAsset & { readonly paused: boolean }> {
  const out = new Map<string, BasketAsset & { readonly paused: boolean }>();
  for (const c of TRADE_CRYPTO) if (!sameAddress(c.address, USDC.address)) out.set(c.symbol.toUpperCase(), { symbol: c.symbol, address: c.address, decimals: c.decimals, kind: "crypto", paused: false });
  for (const [ticker, s] of stocks) {
    const a = { symbol: s.symbol, address: s.address, decimals: s.decimals, kind: "stock" as const, paused: transfersPaused(s) };
    out.set(ticker.toUpperCase(), a);
    out.set(s.symbol.toUpperCase(), a);
  }
  return out;
}

export function BasketPanel() {
  const { wallet, signingProvider } = useWalletSession();
  const openWindow = useOpenWindow();
  const closed = useStocksClosed();
  const [list, setList] = useState<ReturnType<typeof catalog> | { readonly problem: string } | null>(null);
  const [rows, setRows] = useState<readonly Row[]>(PRESETS[0]!.picks.map(([s, w]) => ({ symbol: s, weight: String(w) })));
  const [name, setName] = useState("My basket");
  const [strength, setStrength] = useState<Strength | null>(null);
  const [strengthProgress, setStrengthProgress] = useState<string | null>(null);
  const [strengthAt, setStrengthAt] = useState<number | null>(null);
  const [heldRefresh, setHeldRefresh] = useState(0);
  const [heldProblem, setHeldProblem] = useState(false);
  const [amount, setAmount] = useState("");
  const [top, setTop] = useState(false);
  const [held, setHeld] = useState<readonly bigint[] | null>(null);
  const [review, setReview] = useState<{ readonly priced: readonly Priced[]; readonly balance: bigint; readonly at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** what each buyable leg delivered — `null` for one not bought yet, or whose receipt could not be read */
  const [got, setGot] = useState<readonly (bigint | null)[] | null>(null);
  /** how many legs at the FRONT of the plan have confirmed — a failed leg is retried from here */
  const [bought, setBought] = useState(0);
  const steps = useTxSteps({}, true);
  const ready = wallet?.kind === "ready" ? wallet : null;
  const recovery = useBasketRecovery(ready?.account ?? null);
  const activeAccount = useRef(ready?.account);
  activeAccount.current = ready?.account;
  const batch = useBasketBatch(ready?.account ?? null, signingProvider);
  const [routerBusy, setRouterBusy] = useState(false);
  const purchaseLocked = routerBusy || recovery.locked || strengthProgress !== null || busy || steps.running || batch.working || batch.pending !== null;

  useEffect(() => {
    setReview(null);
    setBought(0);
    setGot(null);
    steps.reset();
  }, [ready?.account]);

  useEffect(() => {
    let live = true;
    baseStocks().then(
      (m) => live && setList(catalog(m)),
      (e: unknown) => live && setList({ problem: messageOf(e) }),
    );
    return () => {
      live = false;
    };
  }, []);

  // the basket as typed, resolved against the catalog — an unknown symbol is a problem, never a guess
  const resolved = useMemo((): { readonly legs: readonly Leg[]; readonly problem: string | null } => {
    if (list === null) return { legs: [], problem: "Reading Coinbase's list of stocks…" };
    if ("problem" in list) return { legs: [], problem: `Coinbase's list of stocks could not be read: ${list.problem}` };
    const legs: Leg[] = [];
    for (const r of rows) {
      const a = list.get(r.symbol.trim().toUpperCase());
      if (!a) return { legs: [], problem: `${r.symbol.trim() || "An empty row"} is not a Coinbase stock or a listed token on ${BASE.name}.` };
      if (a.paused) return { legs: [], problem: `${a.symbol}'s transfers are paused by its issuer — it cannot be bought now.` };
      if (closed && a.kind === "stock") return { legs: [], problem: RESTRICTED_TEXT };
      legs.push({ asset: a, weight: Number(r.weight) });
    }
    return { legs, problem: basketProblem(legs) };
  }, [list, rows, closed]);

  const edit = () => {
    setReview(null);
    setStrength(null);
    setStrengthAt(null);
    setError(null);
    setGot(null);
    setBought(0);
    batch.reset();
    steps.reset();
  };

  // what the wallet already holds of each asset, valued at Base's DEX price — for the top-up and "your basket"
  const key = resolved.legs.map((l) => l.asset.address).join();
  useEffect(() => {
    setHeld(null);
    setHeldProblem(false);
    if (!ready || resolved.legs.length === 0) return;
    let live = true;
    const legs = resolved.legs;
    Promise.all([Promise.all(legs.map((l) => balanceOf(asAsset(l.asset), ready.account))), spots("base", legs.map((l) => l.asset.address))]).then(
      ([balances, prices]) => {
        const unknown = legs.some((l, i) => balances[i]! > 0n && prices.get(l.asset.address.toLowerCase())?.price == null);
        if (unknown) { if (live) setHeldProblem(true); return; }
        const value = legs.map((l, i) => {
          const p = prices.get(l.asset.address.toLowerCase())?.price ?? null;
          return p === null ? 0n : BigInt(Math.floor((Number(balances[i]!) / 10 ** l.asset.decimals) * p * 1e6));
        });
        if (live) setHeld(value);
      },
      () => { if (live) setHeldProblem(true); },
    );
    return () => {
      live = false;
    };
  }, [key, ready, bought, batch.complete, heldRefresh]);

  const amounts = (total: bigint): bigint[] => {
    const w = resolved.legs.map((l) => l.weight);
    return top && held ? topUp(total, w, held, MIN_TOP_UP_LEG) : split(total, w);
  };

  const blocker = resolved.problem ?? (!ready ? "Connect a wallet first" : amount.trim() === "" ? "Enter how much USDC to put in" : null);

  const onReview = async () => {
    setBusy(true);
    setError(null);
    try {
      const total = parseAmount(amount, USDC.decimals);
      if (total === 0n) throw new Error("Enter an amount above 0 USDC.");
      const balance = await balanceOf(USDC_ASSET, ready!.account);
      const parts = amounts(total);
      const priced = await priceAll(resolved.legs.map((leg, i) => ({ leg, amount: parts[i]!, quote: null, problem: "not quoted yet" })));
      setReview({ priced, balance, at: Date.now() });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  /** Quote every leg that has none yet, one at a time and spaced — the legs already quoted are kept. */
  const priceAll = async (legs: readonly Priced[]): Promise<Priced[]> => {
    const out: Priced[] = [];
    let asked = 0;
    for (const p of legs) {
      if (p.amount === 0n) {
        out.push({ ...p, quote: null, problem: null });
        continue;
      }
      if (p.quote !== null) {
        out.push(p);
        continue;
      }
      if (asked++ > 0) await sleep(PACE.gapMs);
      try {
        const quote = await quoteLeg(ready!.account, p.leg.asset, p.amount);
        const impact = impactOf(quote);
        out.push({ ...p, quote, problem: impact !== null && impact > LOUD ? `moves its market ${impact.toFixed(2)}% — too thin for this size` : null });
      } catch (e) {
        out.push({ ...p, quote: null, problem: messageOf(e) });
      }
    }
    return out;
  };

  const onRetry = async () => {
    setBusy(true);
    const priced = await priceAll(review!.priced);
    setReview({ ...review!, priced, at: Date.now() });
    setBusy(false);
  };

  /** Each leg is approve + buy, both built from ONE fresh quote taken when that leg's turn comes. */
  const onBuy = async (from = 0) => {
    const r = review!;
    const account = ready!.account;
    const legs = r.priced.filter((p) => p.quote !== null);
    const fresh = new Map<number, SwapQuote>();
    const plan: Step[] = legs.slice(from).flatMap((p, k): Step[] => {
      const i = from + k;
      return [
        {
          label: `Approve exactly ${formatAmount(p.amount, USDC.decimals)} USDC for ${p.leg.asset.symbol}`,
          build: async (): Promise<TxRequest> => {
            const q = await quoteLeg(account, p.leg.asset, p.amount);
            const impact = impactOf(q);
            if (impact !== null && impact > LOUD) throw new Error(`${p.leg.asset.symbol} now moves its market ${impact.toFixed(2)}% — review the basket again.`);
            fresh.set(i, q);
            const approve = q.steps.find((s) => s.label.startsWith("Approve"));
            if (approve) return approve.tx;
            // Relay saw an allowance already in place; set it to exactly this leg anyway, for the proxy this quote uses
            const swap = q.steps[q.steps.length - 1]!;
            const pair = RELAY_PAIRS.find((x) => sameAddress(x.approvalProxy, swap.tx.to))!;
            return { to: USDC.address, data: approveData(pair.approvalProxy, p.amount) };
          },
        },
        { label: `Buy ${p.leg.asset.symbol}`, build: () => fresh.get(i)!.steps.at(-1)!.tx },
      ];
    });
    const done = await steps.run(signingProvider(), account, plan);
    if (activeAccount.current !== account) return;
    setReview({ ...r, at: Date.now(), priced: r.priced.map((p) => ({ ...p, quote: fresh.get(legs.indexOf(p)) ?? p.quote })) });
    if (done !== null) {
      // `done` holds the receipts of the legs attempted, in order; each pair is approve then buy, and
      // every one of those buys confirmed — so every one of them is measured, never `null`
      const measured = [...(got ?? buyable.map(() => null as bigint | null))];
      legs.slice(from).forEach((p, k) => {
        measured[buyable.indexOf(p)] = tokenReceived(done[k * 2 + 1]!, p.leg.asset.address, account);
      });
      setGot(measured);
      setBought(buyable.length);
      return;
    }
    // a leg failed or the wallet refused (MEASURED 2026-11-15: a buy reverted while its approval
    // confirmed, and before this the whole button was dead afterwards): the legs before it DID
    // confirm, so the next attempt must start there rather than at the top
    const confirmed = steps.confirmed();
    if (confirmed > 0) setBought(from + Math.floor(confirmed / 2));
  };

  const onBatchBuy = () => batch.buy(async () => {
    const remaining = buyable.slice(bought);
    const router = CONTRACTS.basketRouter;
    if (router) {
      // One confirmation for a wallet that can batch: an exact USDC approval to the router and its `buy`
      // in the same atomic batch — the router checks every leg's minimum and refunds what is unused.
      const legs: RouterLeg[] = [];
      for (const p of remaining) {
        if (legs.length > 0) await sleep(PACE.gapMs);
        const { leg, quote } = await retrying(() => routerLeg(router, ready!.account, asAsset(p.leg.asset), p.amount, SLIPPAGE_BPS));
        const impact = impactOf(quote);
        if (impact !== null && impact > LOUD) throw new Error(`${p.leg.asset.symbol} now moves its market ${impact.toFixed(2)}% — review the basket again.`);
        legs.push(leg);
      }
      return [
        { to: USDC.address, data: approveData(router, totalOf(legs)) },
        { to: router, data: buyData(legs, deadlineFrom(Date.now())) },
      ];
    }
    // The batch always signs the Relay quotes the review showed. The Aerodrome/Uniswap multicall
    // quotes different pools (stocks' deep pools sit on CL factory 0x9CB2…7a76, which those
    // published quoters do not serve), so it is never swapped in here behind the review's back.

    const priced: Priced[] = [];
    const rawLegs: { readonly proxy: string; readonly amount: bigint; readonly swap: TxRequest }[] = [];
    const started = Date.now();
    for (const p of remaining) {
      if (rawLegs.length > 0) await sleep(PACE.gapMs);
      const q = await quoteLeg(ready!.account, p.leg.asset, p.amount);
      const impact = impactOf(q);
      if (impact !== null && impact > LOUD) throw new Error(`${p.leg.asset.symbol} now moves its market ${impact.toFixed(2)}% — review the basket again.`);
      if (q.steps.filter((step) => !step.label.startsWith("Approve")).length !== 1) throw new Error("A basket leg needs one same-chain swap. Nothing was sent.");
      for (const step of q.steps) {
        if (!step.label.startsWith("Approve")) {
          const pair = RELAY_PAIRS.find((x) => sameAddress(x.approvalProxy, step.tx.to))!;
          rawLegs.push({ proxy: pair.approvalProxy, amount: p.amount, swap: step.tx });
        }
      }
      priced.push({ ...p, quote: q });
    }
    // Conservative preparation budget, not a claim about Relay's quote expiry. The wallet
    // simulates the final atomic execution too; on-chain slippage/deadline checks still apply.
    if (Date.now() - started > 30_000) throw new Error("Refreshing the basket took too long. Nothing was sent — try again for fresh quotes.");
    setReview({ ...review!, at: Date.now(), priced: review!.priced.map((p) => priced.find((fresh) => fresh.leg === p.leg) ?? p) });

    // When >5 legs fall back to Relay, merge approvals per proxy (1 approve + N swaps) to stay within the 10-call wallet limit.
    if (rawLegs.length > 5) {
      const totals = new Map<string, { readonly proxy: string; amount: bigint }>();
      for (const leg of rawLegs) {
        const k = leg.proxy.toLowerCase();
        const prev = totals.get(k);
        if (prev) prev.amount += leg.amount;
        else totals.set(k, { proxy: leg.proxy, amount: leg.amount });
      }
      return [
        ...[...totals.values()].map(({ proxy, amount }) => ({ to: USDC.address, data: approveData(proxy, amount) })),
        ...rawLegs.map((l) => l.swap),
      ];
    }
    // For <=5 legs, keep fresh exact interleaved approvals per leg (<=10 calls total).
    return rawLegs.flatMap((l) => [{ to: USDC.address, data: approveData(l.proxy, l.amount) }, l.swap]);
  }, buyable.slice(bought).reduce((s, p) => s + p.amount, 0n));

  /**
   * One transaction through BasketRouter, for a wallet that cannot batch: fresh legs quoted with the
   * router as sender and this wallet as recipient, then `buy` (an allowance already covers the total)
   * or one USDC permit signature and `buyWithPermit`. Simulated before the wallet sees it (TxSteps).
   */
  const onRouterBuy = async (router: string) => {
    const account = ready!.account;
    setError(null);
    setRouterBusy(true);
    try {
      const remaining = buyable.slice(bought);
      const legs: RouterLeg[] = [];
      for (const p of remaining) {
        if (legs.length > 0) await sleep(PACE.gapMs);
        const { leg, quote } = await retrying(() => routerLeg(router, account, asAsset(p.leg.asset), p.amount, SLIPPAGE_BPS));
        const impact = impactOf(quote);
        if (impact !== null && impact > LOUD) throw new Error(`${p.leg.asset.symbol} now moves its market ${impact.toFixed(2)}% — review the basket again.`);
        legs.push(leg);
      }
      const total = totalOf(legs);
      const deadline = deadlineFrom(Date.now());
      const data = (await allowance(USDC.address, account, router)) >= total ? buyData(legs, deadline) : buyWithPermitData(legs, deadline, await signPermit(signingProvider(), account, router, total, deadline));
      // the step runner re-reads the wallet at the click and refuses if the account moved
      setRouterBusy(false);
      const done = await steps.run(signingProvider(), account, [{ label: `Buy the basket (${legs.length} legs) in one transaction`, build: () => ({ to: router, data }) }]);
      if (activeAccount.current !== account || done === null) return;
      const measured = [...(got ?? buyable.map(() => null as bigint | null))];
      remaining.forEach((p, i) => {
        measured[bought + i] = tokenReceived(done[0]!, p.leg.asset.address, account);
      });
      setGot(measured);
      setBought(buyable.length);
    } catch (e) {
      if (activeAccount.current === account) setError(messageOf(e));
    } finally {
      if (activeAccount.current === account) setRouterBusy(false);
    }
  };

  useEffect(() => {
    if (batch.receipts === null || review === null) return;
    const receipts = batch.receipts;
    const measured = [...(got ?? buyable.map(() => null as bigint | null))];
    buyable.slice(bought).forEach((p, i) => {
      measured[bought + i] = receipts.reduce((sum, r) => sum + tokenReceived(r, p.leg.asset.address, ready!.account), 0n);
    });
    setGot(measured);
    setBought(buyable.length);
  }, [batch.receipts]);

  const priced = review?.priced ?? [];
  const total = priced.reduce((s, p) => s + p.amount, 0n);
  const stop = review === null ? null : priced.find((p) => p.problem !== null) ? "A leg cannot be bought — see it above" : review.balance < total ? "Not enough USDC" : null;
  const now = held ? weightsNow(held) : null;
  const buyable = priced.filter((p) => p.quote !== null);

  const recipe = parseRecipe({ name, picks: rows.map((r) => [r.symbol.trim(), Number(r.weight)]) });
  const checkStrength = async () => {
    setStrength(null);
    let asked = 0;
    const result = await measureStrength(resolved.legs, async (leg, amount) => {
      if (asked++ > 0) await sleep(PACE.gapMs);
      return quoteLeg(ready?.account ?? QUOTE_ACCOUNT, leg.asset, amount);
    }, (total, symbol) => setStrengthProgress(`Checking ${usd(total)} · ${symbol}…`));
    setStrength(result);
    setStrengthAt(Date.now());
    setStrengthProgress(null);
  };

  const totalWeight = rows.reduce((s, r) => s + (Number.isFinite(Number(r.weight)) ? Number(r.weight) : 0), 0);
  const weightRounded = Math.round(totalWeight * 100) / 100;
  const amountNum = Number(amount);
  const hasValidAmount = amount.trim() !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const activeCount = rows.filter((r) => r.symbol.trim() !== "").length;
  const canBatch = batch.capability === "supported" || batch.capability === "ready";
  const execMode = canBatch ? "1 SIGN" : CONTRACTS.basketRouter ? "1 TX" : "STEP";

  // with no rows there is nothing to map, so nothing changes
  const equalSplit = () => {
    edit();
    const base = Math.floor(100 / rows.length);
    const rem = 100 - base * rows.length;
    setRows(rows.map((r, i) => ({ ...r, weight: String(base + (i < rem ? 1 : 0)) })));
  };

  const QUICK_AMOUNTS = ["10", "25", "50", "100"] as const;

  return (
    <div className="stack basket">
      <header className="mk__hero">
        <div>
          <p className="mk__eyebrow">BASE 8453 / TREASURY BASKET</p>
          <h3 className="mk__title">Own a mix in one go.</h3>
          <p className="mk__sub">Self-custody stocks and crypto on Base — every asset lands directly in your wallet, no index token, no basket fee.</p>
        </div>
        <dl className="mk__kpis">
          <div className="mk__kpi">
            <dt>Assets</dt>
            <dd>{activeCount}</dd>
          </div>
          <div className="mk__kpi">
            <dt>Weight</dt>
            <dd>{weightRounded}%</dd>
          </div>
          <div className="mk__kpi">
            <dt>Mode</dt>
            <dd>{execMode}</dd>
          </div>
        </dl>
      </header>

      <div className="mk__strip" role="group" aria-label="Preset baskets">
        <span className="mk__strip-tag">PRESETS</span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            className="mk__pill"
            aria-label={p.name}
            disabled={purchaseLocked}
            aria-pressed={name === p.name}
            onClick={() => {
              edit();
              setRows(p.picks.map(([symbol, weight]) => ({ symbol, weight: String(weight) })));
              setName(p.name);
            }}
          >
            <strong>{p.name}</strong>
            <span className="dim" aria-hidden="true">{p.picks.length}</span>
          </button>
        ))}
        <span className="dim">Presets are starting points, not advice.</span>
      </div>

      {closed ? <p className="crt__amber">{RESTRICTED_TEXT} A basket of crypto only still works.</p> : null}

      {recovery.locked || recovery.note ? (
        <section className="group" aria-label="Basket recovery">
          <h3>basket / recovery</h3>
          <p role="status">{recovery.problem ?? recovery.note ?? "A previous basket transaction is unresolved. Do not buy again."}</p>
          {recovery.pending ? (
            <>
              <p>{recovery.pending.label}</p>
              {recovery.pending.hash ? (
                <a href={`${BASE.explorer}/tx/${recovery.pending.hash}`} target="_blank" rel="noreferrer">
                  check transaction on Base
                </a>
              ) : (
                <p>The wallet did not return a hash. Check wallet activity; nothing will be resubmitted automatically.</p>
              )}
              <Gel quiet onClick={() => void recovery.refresh()}>
                Check previous transaction
              </Gel>
            </>
          ) : null}
        </section>
      ) : null}

      <div className="bk__grid">
        <section className="stack" aria-label="Basket composition">
          <div className="mk__dir-head">
            <h3>{name.trim() || "My basket"}</h3>
            <div className="mk__actions">
              <span className={Math.round(totalWeight) === 100 ? "badge badge--ok" : "badge badge--warn"}>
                {weightRounded}% / 100%
              </span>
              <button type="button" className="chip" disabled={purchaseLocked || rows.length === 0} onClick={equalSplit}>
                Equal split
              </button>
              <button
                type="button"
                className="chip chip--mode"
                aria-label="Add an asset"
                disabled={purchaseLocked}
                onClick={() => {
                  edit();
                  setRows([...rows, { symbol: "", weight: "" }]);
                }}
              >
                + Add asset
              </button>
            </div>
          </div>

          <div className="mk__table-wrap">
            <table className="mk__table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th className="num">Weight</th>
                  <th className="num">USDC</th>
                  <th className="num"></th>
                </tr>
              </thead>
              <tbody role="list" aria-label="Assets and weights">
                {rows.map((r, i) => {
                  const sym = r.symbol.trim().toUpperCase();
                  const meta = list && !("problem" in list) ? list.get(sym) : undefined;
                  const w = Number(r.weight);
                  const pct = Number.isFinite(w) && w > 0 ? w : 0;
                  const shareUsd = hasValidAmount ? (amountNum * pct) / 100 : null;
                  return (
                    <tr key={i} role="listitem">
                      <td>
                        <div className="bk__asset-cell">
                          <input
                            className="field bk__sym-input"
                            aria-label={`Asset ${i + 1}`}
                            disabled={purchaseLocked}
                            value={r.symbol}
                            placeholder="NVDA, cbBTC…"
                            onChange={(e) => {
                              edit();
                              setRows(rows.map((x, j) => (j === i ? { ...x, symbol: e.target.value } : x)));
                            }}
                          />
                          {meta ? <span className="mk__tag">{meta.kind === "stock" ? "STOCK" : "CRYPTO"}</span> : null}
                        </div>
                      </td>
                      <td className="num">
                        <div className="bk__weight-cell">
                          <input
                            className="field bk__wt-input"
                            aria-label={`Weight ${i + 1}`}
                            disabled={purchaseLocked}
                            inputMode="numeric"
                            value={r.weight}
                            onChange={(e) => {
                              edit();
                              setRows(rows.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)));
                            }}
                          />
                          <span className="dim">%</span>
                        </div>
                      </td>
                      <td className="num mono">
                        {shareUsd !== null ? `$${shareUsd.toFixed(2)}` : <span className="dim">—</span>}
                        {now && resolved.legs[i] ? <div className="bk__now dim">now {now[i]}%</div> : null}
                      </td>
                      <td className="num">
                        <button
                          type="button"
                          className="chip"
                          disabled={purchaseLocked}
                          aria-label={`Remove asset ${i + 1}`}
                          onClick={() => {
                            edit();
                            setRows(rows.filter((_, j) => j !== i));
                          }}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="mk__trade-box" aria-label="Buy basket">
          <h4 className="mk__trade-title">Buy {name.trim() || "basket"} on {BASE.name}</h4>

          <label className="group__row">
            <span>Put in</span>
            <input
              className="field"
              aria-label="USDC to put in"
              disabled={purchaseLocked}
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => {
                edit();
                setAmount(e.target.value);
              }}
            />
            <span className="unit">USDC</span>
          </label>

          <div className="basket__quick" role="group" aria-label="Quick USDC amounts">
            {QUICK_AMOUNTS.map((preset) => (
              <button
                key={preset}
                type="button"
                className="chip chip--mode"
                disabled={purchaseLocked}
                aria-pressed={amount.trim() === preset}
                onClick={() => {
                  edit();
                  setAmount(preset);
                }}
              >
                ${preset}
              </button>
            ))}
          </div>

          {held && held.some((v) => v > 0n) ? (
            <label className="check">
              <input
                type="checkbox"
                disabled={purchaseLocked}
                checked={top}
                onChange={(e) => {
                  edit();
                  setTop(e.target.checked);
                }}
              />
              <span>Top up toward weights ({usd(Number(held.reduce((s, v) => s + v, 0n)) / 1e6)} held)</span>
            </label>
          ) : null}

          {error ? (
            <Crt label="Basket">
              <span className="crt__amber">{error}</span>
            </Crt>
          ) : null}

          {batch.message ? <p role="status" className="tx__warn">{batch.message}</p> : null}
          {batch.pending ? (
            <div className="stack">
              <p className="dim">
                Batch ID: <code style={{ overflowWrap: "anywhere" }}>{batch.pending.id}</code>
              </p>
              <div className="row">
                <Gel quiet disabled={batch.working} onClick={() => void batch.refresh()}>
                  Check basket status
                </Gel>
                <button type="button" className="chip" disabled={batch.working} onClick={() => batch.clear()}>
                  Clear stuck batch
                </button>
              </div>
            </div>
          ) : null}

          {review === null ? (
            <Gel className="mf__cta" onClick={() => void onReview()} disabled={blocker !== null || purchaseLocked}>
              {busy ? "Quoting each asset…" : (blocker ?? "Quote the basket")}
            </Gel>
          ) : (
            <div className="stack">
              <div className="mk__table-wrap">
                <table className="mk__table" aria-label="The basket, quoted">
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th className="num">USDC</th>
                      <th className="num">Est. out</th>
                      {got ? <th className="num">Received</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {priced.map((p) => {
                      const impact = p.quote ? impactOf(p.quote) : null;
                      return (
                        <tr key={p.leg.asset.address} className={p.problem ? "tone-bad" : undefined}>
                          <th scope="row">{p.leg.asset.symbol}</th>
                          <td className="num mono">{formatAmount(p.amount, USDC.decimals)} USDC</td>
                          <td className="num mono">
                            {p.problem ? (
                              p.problem
                            ) : p.quote ? (
                              <>
                                <div>≈ {tokenAmount(p.quote.out, p.leg.asset.decimals, 4)} {p.leg.asset.symbol}</div>
                                <div className="bk__now dim">{impact === null ? "impact not given" : `${impact.toFixed(2)}% impact`}</div>
                              </>
                            ) : (
                              "nothing to add in this allocation"
                            )}
                          </td>
                          {got && p.quote ? <td className="num mono">{got[buyable.indexOf(p)] === null ? "not measured" : arrived(got[buyable.indexOf(p)]!, p.leg.asset)}</td> : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="dim mono">Balance: {formatAmount(review.balance, USDC.decimals)} USDC</p>

              {canBatch ? (
                <>
                  <Gel
                    className="mf__cta"
                    disabled={stop !== null || purchaseLocked || batch.complete || steps.states.some((s) => s.status === "slow") || bought >= buyable.length}
                    onClick={() => void onBatchBuy()}
                  >
                    {batch.working ? "Preparing basket…" : "Buy basket · 1 confirmation"}
                  </Gel>
                  <p className="dim">
                    Atomic batch: all assets succeed together or revert together.{batch.capability === "ready" ? " Your wallet may first ask you to enable batching." : ""}
                  </p>
                </>
              ) : batch.capability === "checking" ? (
                <p className="dim">Checking whether your wallet can confirm the basket at once…</p>
              ) : CONTRACTS.basketRouter ? (
                <>
                  <Gel
                    className="mf__cta"
                    disabled={stop !== null || purchaseLocked || steps.states.some((s) => s.status === "slow") || bought >= buyable.length}
                    onClick={() => void onRouterBuy(CONTRACTS.basketRouter!)}
                  >
                    {routerBusy ? "Preparing basket…" : "Buy basket · 1 transaction"}
                  </Gel>
                  <p className="dim">One transaction via BasketRouter: every asset or none. Your wallet may first ask for one USDC signature for exactly this amount — no standing approval.</p>
                </>
              ) : (
                <p className="dim">This wallet does not report atomic batching on Base. Buy step by step, or connect a compatible wallet.</p>
              )}

              {priced.some((p) => p.quote === null && p.problem !== null) ? (
                <Gel quiet onClick={() => void onRetry()} disabled={purchaseLocked}>
                  {busy ? "Quoting…" : "Quote the failed ones again"}
                </Gel>
              ) : null}

              <details className="basket__advanced">
                <summary>Step-by-step Relay fallback ({priced.filter((p) => p.quote).length * 2} signatures)</summary>
                <div className="stack">
                  <Gel
                    quiet
                    className="basket__sequential"
                    onClick={() => void onBuy(bought)}
                    disabled={stop !== null || purchaseLocked || batch.complete || steps.states.some((s) => s.status === "slow") || bought >= buyable.length}
                  >
                    {stop ?? (bought > 0 ? `Buy the rest — ${formatAmount(buyable.slice(bought).reduce((s, p) => s + p.amount, 0n), USDC.decimals)} USDC` : `Buy the basket — ${formatAmount(total, USDC.decimals)} USDC`)}
                  </Gel>
                </div>
              </details>

              {bought > 0 && bought < buyable.length && !steps.running ? (
                <p className="tx__warn">
                  {bought} of {buyable.length} bought. Next attempt resumes from the remaining assets.
                </p>
              ) : null}

              <TxStepList states={steps.states} label="Buying the basket" />

              <BasketShare
                c={{
                  lines: priced.map((p) => ({ symbol: p.leg.asset.symbol, weight: p.leg.weight, impact: p.quote ? impactOf(p.quote) : null, skipped: p.amount === 0n })),
                  total: formatAmount(total, USDC.decimals),
                  name,
                  link: recipe ? recipeLink(recipe) : undefined,
                  state: batch.complete || (buyable.length > 0 && bought === buyable.length) ? "bought" : bought > 0 ? "partial" : "quoted",
                  topUp: top,
                  at: review.at,
                }}
              />
            </div>
          )}
        </aside>
      </div>

      <details className="group basket__drawer">
        <summary>Saved baskets &amp; share link</summary>
        <BasketRecipes
          rows={rows}
          name={name}
          setName={setName}
          disabled={purchaseLocked}
          onLoad={(r) => {
            edit();
            setName(r.name);
            setRows(r.picks.map(([symbol, weight]) => ({ symbol, weight: String(weight) })));
            setAmount("");
            setTop(false);
          }}
        />
      </details>

      {ready && resolved.problem === null ? (
        <details className="group basket__drawer">
          <summary>
            Your holdings &amp; rebalance{held ? ` (${usd(Number(held.reduce((sum, v) => sum + v, 0n)) / 1e6)})` : ""}
          </summary>
          <section className="stack" aria-label="Your basket holdings">
            <Gel quiet disabled={purchaseLocked} onClick={() => setHeldRefresh((n) => n + 1)}>
              Refresh holdings
            </Gel>
            {held === null ? (
              <p className="dim">
                {heldProblem ? "Holdings value unavailable — a balance or market price could not be read. Top-up is unavailable." : "Reading balances and market prices…"}
              </p>
            ) : (
              <>
                <div className="mk__table-wrap">
                  <table className="mk__table" aria-label="Basket target and current holdings">
                    <thead>
                      <tr>
                        <th>Asset</th>
                        <th className="num">Target</th>
                        <th className="num">Now</th>
                        <th className="num">Value</th>
                        {openWindow ? <th className="num">Action</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {resolved.legs.map((l, i) => (
                        <tr key={l.asset.address}>
                          <th scope="row">{l.asset.symbol}</th>
                          <td className="num mono">{l.weight}%</td>
                          <td className="num mono">{now![i]}%</td>
                          <td className="num mono">{usd(Number(held[i]!) / 1e6)}</td>
                          {openWindow ? (
                            <td className="num">
                              <button
                                type="button"
                                className="chip chip--mode"
                                disabled={held[i]! === 0n}
                                onClick={() => openWindow("swap", { sell: l.asset.address })}
                              >
                                Sell
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <RebalancePreview held={held} weights={resolved.legs.map((l) => l.weight)} symbols={resolved.legs.map((l) => l.asset.symbol)} />
                <p className="dim">Total {usd(Number(held.reduce((sum, v) => sum + v, 0n)) / 1e6)} · wallet holdings at current DEX prices.</p>
              </>
            )}
          </section>
        </details>
      ) : null}

      <details className="group basket__drawer">
        <summary>Liquidity strength test ($100 – $100K)</summary>
        <section className="stack" aria-label="Basket Strength">
          <p className="dim">Test a buy of $100, $1K, $10K and $100K at your target weights. Each leg must have at most 2% quoted impact. Nothing is signed.</p>
          <Gel quiet disabled={purchaseLocked || resolved.problem !== null} onClick={() => void checkStrength()}>
            Measure basket Strength
          </Gel>
          {strengthProgress ? <p role="status">{strengthProgress}</p> : null}
          {strength ? (
            <div className="dim">
              <p>
                {strength.passed > 0 ? `Measured buy depth ≥ ${usd(strength.passed)}` : "No tested size passed"}
                {strength.limiting && !strength.problem ? ` · ${strength.limiting} exceeded 2% at a ${usd(strength.tested)} basket buy.` : ""}
              </p>
              {strength.problem ? <p>{strength.limiting} at {usd(strength.tested)}: not measured — {strength.problem}.</p> : null}
              <p>Sampled quotes, not an exact maximum or a guarantee of execution. {new Date(strengthAt!).toLocaleTimeString()} · Relay.</p>
            </div>
          ) : null}
        </section>
      </details>
    </div>
  );
}

