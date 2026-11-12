import { useEffect, useMemo, useState } from "react";
import { baseStocks, spots, type BaseStock } from "@/adapters/http/markets";
import { quoteSwap, type SwapQuote } from "@/adapters/http/relay";
import { BASE, USDC } from "@/config/chain";
import { TRADE_CRYPTO } from "@/config/markets";
import { RELAY_PAIRS } from "@/config/routes";
import { sameAddress } from "@/lib/address";
import { formatAmount, parseAmount } from "@/lib/amount";
import { basketProblem, PRESETS, split, topUp, weightsNow, type BasketAsset, type Leg } from "@/lib/basket";
import { approveData, balanceOf, type Asset } from "@/lib/erc20";
import { messageOf } from "@/lib/errors";
import { RESTRICTED_TEXT, useStocksClosed } from "@/lib/region";
import { tokenReceived, type TxRequest } from "@/lib/transact";
import { tokenAmount, usd } from "@/skills/format";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import { useWalletSession } from "@/ui/WalletProvider";
import { TxStepList, useTxSteps, type Step } from "@/features/panels/TxSteps";
import { transfersPaused } from "@/features/panels/TradePanel";

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

/** One leg's quote, asked again while Relay says it is busy. */
export async function quoteLeg(user: string, asset: BasketAsset, amount: bigint): Promise<SwapQuote> {
  const tries = [0, ...PACE.retryMs];
  let last: unknown;
  for (const [i, wait] of tries.entries()) {
    if (i > 0) await sleep(wait);
    try {
      return await quoteSwap({ user, sell: USDC_ASSET, buy: asAsset(asset), amount, slippageBps: SLIPPAGE_BPS });
    } catch (e) {
      if (!BUSY.test(messageOf(e))) throw e;
      last = e;
    }
  }
  throw last;
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
  const closed = useStocksClosed();
  const [list, setList] = useState<ReturnType<typeof catalog> | { readonly problem: string } | null>(null);
  const [rows, setRows] = useState<readonly Row[]>(PRESETS[0]!.picks.map(([s, w]) => ({ symbol: s, weight: String(w) })));
  const [amount, setAmount] = useState("");
  const [top, setTop] = useState(false);
  const [held, setHeld] = useState<readonly bigint[] | null>(null);
  const [review, setReview] = useState<{ readonly priced: readonly Priced[]; readonly balance: bigint } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState<readonly bigint[] | null>(null);
  const steps = useTxSteps();
  const ready = wallet?.kind === "ready" ? wallet : null;

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
    setError(null);
    setGot(null);
    steps.reset();
  };

  // what the wallet already holds of each asset, valued at Base's DEX price — for the top-up and "your basket"
  const key = resolved.legs.map((l) => l.asset.address).join();
  useEffect(() => {
    setHeld(null);
    if (!ready || resolved.legs.length === 0) return;
    let live = true;
    const legs = resolved.legs;
    Promise.all([Promise.all(legs.map((l) => balanceOf(asAsset(l.asset), ready.account))), spots("base", legs.map((l) => l.asset.address))]).then(
      ([balances, prices]) => {
        const value = legs.map((l, i) => {
          const p = prices.get(l.asset.address.toLowerCase())?.price ?? null;
          return p === null ? 0n : BigInt(Math.floor((Number(balances[i]!) / 10 ** l.asset.decimals) * p * 1e6));
        });
        if (live) setHeld(value);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [key, ready]);

  const amounts = (total: bigint): bigint[] => {
    const w = resolved.legs.map((l) => l.weight);
    return top && held ? topUp(total, w, held) : split(total, w);
  };

  const blocker = resolved.problem ?? (!ready ? "Connect a wallet first" : amount.trim() === "" ? "Enter how much USDC to put in" : null);

  const onReview = async () => {
    setBusy(true);
    setError(null);
    try {
      const total = parseAmount(amount, USDC.decimals);
      const balance = await balanceOf(USDC_ASSET, ready!.account);
      const parts = amounts(total);
      const priced = await priceAll(resolved.legs.map((leg, i) => ({ leg, amount: parts[i]!, quote: null, problem: "not quoted yet" })));
      setReview({ priced, balance });
    } catch (e) {
      setError(messageOf(e));
    }
    setBusy(false);
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
    setReview({ ...review!, priced });
    setBusy(false);
  };

  /** Each leg is approve + buy, both built from ONE fresh quote taken when that leg's turn comes. */
  const onBuy = async () => {
    const r = review!;
    const account = ready!.account;
    const legs = r.priced.filter((p) => p.quote !== null);
    const fresh = new Map<number, SwapQuote>();
    const plan: Step[] = legs.flatMap((p, i): Step[] => [
      {
        label: `Approve exactly ${formatAmount(p.amount, USDC.decimals)} USDC for ${p.leg.asset.symbol}`,
        build: async (): Promise<TxRequest> => {
          const q = await quoteLeg(account, p.leg.asset, p.amount);
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
    ]);
    const done = await steps.run(signingProvider(), account, plan);
    if (done === null) return;
    setGot(legs.map((p, i) => tokenReceived(done[i * 2 + 1]!, p.leg.asset.address, account)));
  };

  const priced = review?.priced ?? [];
  const total = priced.reduce((s, p) => s + p.amount, 0n);
  const stop = review === null ? null : priced.find((p) => p.problem !== null) ? "A leg cannot be bought — see it above" : review.balance < total ? "Not enough USDC" : null;
  const now = held ? weightsNow(held) : null;
  const bought = priced.filter((p) => p.quote !== null);

  return (
    <div className="stack">
      <p className="panel__lede">
        Buy a basket of stocks and crypto on {BASE.name} with USDC. Every asset lands in your own wallet — no index token, no manager, no basket fee. Each one is
        quoted, checked and signed on its own.
      </p>
      {closed ? <p className="crt__amber">{RESTRICTED_TEXT} A basket of crypto only still works.</p> : null}

      <fieldset className="group">
        <legend>Basket</legend>
        <div className="group__row group__row--actions" role="group" aria-label="Ready-made baskets">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="chip"
              onClick={() => {
                edit();
                setRows(p.picks.map(([s, w]) => ({ symbol: s, weight: String(w) })));
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
        <ul className="basket__legs" aria-label="Assets and weights">
          {rows.map((r, i) => (
            <li key={i} className="group__row">
              <input
                className="field"
                aria-label={`Asset ${i + 1}`}
                value={r.symbol}
                placeholder="NVDA, cbBTC…"
                onChange={(e) => {
                  edit();
                  setRows(rows.map((x, j) => (j === i ? { ...x, symbol: e.target.value } : x)));
                }}
              />
              <input
                className="field field--short"
                aria-label={`Weight ${i + 1}`}
                inputMode="numeric"
                value={r.weight}
                onChange={(e) => {
                  edit();
                  setRows(rows.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)));
                }}
              />
              <span className="unit">%</span>
              {now && resolved.legs[i] ? <span className="dim">now {now[i]}%</span> : null}
              <button
                type="button"
                className="chip"
                aria-label={`Remove asset ${i + 1}`}
                onClick={() => {
                  edit();
                  setRows(rows.filter((_, j) => j !== i));
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="chip"
          onClick={() => {
            edit();
            setRows([...rows, { symbol: "", weight: "" }]);
          }}
        >
          Add an asset
        </button>
      </fieldset>

      <label className="group__row">
        <span>Put in</span>
        <input
          className="field"
          aria-label="USDC to put in"
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
      {held && held.some((v) => v > 0n) ? (
        <label className="group__row">
          <input
            type="checkbox"
            checked={top}
            onChange={(e) => {
              edit();
              setTop(e.target.checked);
            }}
          />
          <span>Top up toward the weights — what you already hold ({usd(Number(held.reduce((s, v) => s + v, 0n)) / 1e6)}) counts, the most underweight first</span>
        </label>
      ) : null}

      {error ? (
        <Crt label="Basket">
          <span className="crt__amber">{error}</span>
        </Crt>
      ) : null}

      {review === null ? (
        <Gel className="mf__cta" onClick={() => void onReview()} disabled={blocker !== null || busy}>
          {busy ? "Quoting each asset…" : (blocker ?? "Quote the basket")}
        </Gel>
      ) : (
        <>
          <table className="basket__review" aria-label="The basket, quoted">
            <tbody>
              {priced.map((p) => {
                const impact = p.quote ? impactOf(p.quote) : null;
                return (
                  <tr key={p.leg.asset.address} className={p.problem ? "tone-bad" : undefined}>
                    <th scope="row">{p.leg.asset.symbol}</th>
                    <td>{formatAmount(p.amount, USDC.decimals)} USDC</td>
                    <td>
                      {p.problem
                        ? p.problem
                        : p.quote
                          ? `≈ ${tokenAmount(p.quote.out, p.leg.asset.decimals, 4)} ${p.leg.asset.symbol} · ${impact === null ? "impact not given" : `${impact.toFixed(2)}% impact`}`
                          : "nothing to add — already at its weight"}
                    </td>
                    {got && p.quote ? <td>{arrived(got[bought.indexOf(p)]!, p.leg.asset)}</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="dim">
            {priced.filter((p) => p.quote).length * 2} signatures: for each asset, an approval of exactly its USDC, then the buy — each re-quoted the moment it is
            signed, checked against Relay&apos;s verified contracts and simulated first. Your USDC: {formatAmount(review.balance, USDC.decimals)}.
          </p>
          {priced.some((p) => p.quote === null && p.problem !== null) ? (
            <Gel quiet onClick={() => void onRetry()} disabled={busy || steps.running}>
              {busy ? "Quoting…" : "Quote the failed ones again"}
            </Gel>
          ) : null}
          <Gel className="mf__cta" onClick={() => void onBuy()} disabled={stop !== null || steps.running || steps.states.length > 0}>
            {stop ?? `Buy the basket — ${formatAmount(total, USDC.decimals)} USDC`}
          </Gel>
          <TxStepList states={steps.states} label="Buying the basket" />
        </>
      )}
    </div>
  );
}

