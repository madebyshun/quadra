import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { LAUNCHPAD_DECIMALS } from "@/config/launchpad";
import { parseAmount } from "@/lib/amount";
import { balanceOf } from "@/lib/erc20";
import { messageOf } from "@/lib/errors";
import { play } from "@/lib/sound";
import { minOutFor, NATIVE, poolKeyOf, quoteV4, swapSteps, zeroForOneFor, type LaunchPool } from "@/lib/v4swap";
import { chainToken } from "@/skills/chaintoken";
import { tokenAmount } from "@/skills/format";
import { Gel } from "@/ui/Gel";
import { useWalletSession } from "@/ui/WalletProvider";
import { useOpenWindow } from "@/features/openWindow";
import { TxStepList, useTxSteps } from "@/features/panels/TxSteps";
import { PoolTradeEth } from "@/features/panels/PoolTradeEth";

/**
 * Trade a coin launched here straight against ITS OWN POOL — no aggregator in between (2026-10-14).
 * Relay may not route a minutes-old v4 pool (MEASURED: the first trade of the first AAPLc-paired launch
 * went through KyberSwap), and this pool is the one place the coin is sure to trade. The quote comes
 * from Uniswap's own Quoter as an eth_call; the swap is Uniswap's Universal Router, every approval
 * EXACT (Permit2 for a token in), and the wallet signs each step (lib/v4swap.ts). Any edit throws the
 * quote away, so what was reviewed is what is signed.
 */

/** 1%: the default slippage cap before the router refuses the swap. */
export const SLIPPAGE_BPS = 100;
export const SLIPPAGE_OPTIONS = [100, 200, 500] as const;
/** How long a reviewed swap stays signable. */
export const DEADLINE_S = 600;

const ETH_PRESETS = ["0.01", "0.05", "0.1", "0.5"] as const;
const STABLE_PRESETS = ["10", "50", "100", "500"] as const;
const QUOTE_PRESETS = ["0.1", "0.5", "1", "5"] as const;
const SELL_PCT_PRESETS = [25, 50, 75, 100] as const;

function buyPresetsFor(symbol: string): readonly string[] {
  const s = symbol.toUpperCase();
  if (s === "ETH" || s === "WETH" || s === "CBETH") return ETH_PRESETS;
  if (s === "USDC" || s === "EURC" || s === "USDT") return STABLE_PRESETS;
  return QUOTE_PRESETS;
}

type Pool = (LaunchPool & { readonly quoteSymbol: string; readonly quoteDecimals: number }) | null;
type Review = { readonly amountIn: bigint; readonly out: bigint; readonly minOut: bigint };

export function PoolTrade({ token, symbol, side }: { token: string; symbol: string; side: "buy" | "sell" }) {
  const { wallet, signingProvider, connectInjected, busy } = useWalletSession();
  const openWindow = useOpenWindow();
  const me = wallet?.kind === "ready" ? wallet.account : null;
  const [pool, setPool] = useState<Pool | "reading" | { readonly problem: string }>("reading");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(SLIPPAGE_BPS);
  const [review, setReview] = useState<Review | "quoting" | { readonly problem: string } | null>(null);
  const [sellBalance, setSellBalance] = useState<bigint | null>(null);
  // a stock-paired coin can be bought with plain ETH too: two legs, in PoolTradeEth (2026-10-29)
  const [withEth, setWithEth] = useState(false);
  const steps = useTxSteps();

  useEffect(() => {
    if (side !== "sell" || !me) {
      setSellBalance(null);
      return;
    }
    let live = true;
    balanceOf({ kind: "erc20", address: token, symbol, decimals: LAUNCHPAD_DECIMALS }, me).then(
      (raw) => live && setSellBalance(raw),
      () => live && setSellBalance(null),
    );
    return () => {
      live = false;
    };
  }, [side, me, token, symbol]);

  useEffect(() => {
    let live = true;
    poolKeyOf(token).then(
      async (p) => {
        if (p === null) return live && setPool(null);
        const q = p.quote.toLowerCase() === NATIVE ? { symbol: "ETH", decimals: 18 } : await chainToken(p.quote).then((t) => ({ symbol: t.symbol, decimals: t.decimals }));
        if (live) setPool({ ...p, quoteSymbol: q.symbol, quoteDecimals: q.decimals });
      },
      (e: unknown) => live && setPool({ problem: messageOf(e) }),
    );
    return () => {
      live = false;
    };
  }, [token]);

  if (pool === "reading") return <p className="dim">Reading {symbol}&apos;s pool…</p>;
  if (pool === null) return <p className="tx__warn">{symbol} has no pool on this launchpad.</p>;
  if ("problem" in pool) return <p className="tx__warn">The pool could not be read: {pool.problem}</p>;

  const stockBuy = side === "buy" && pool.quote.toLowerCase() !== NATIVE;
  const payWith = stockBuy ? (
    <div className="group__row group__row--actions" role="group" aria-label="Pay with">
      {[false, true].map((eth) => (
        <button key={String(eth)} type="button" className="chip chip--mode" aria-pressed={withEth === eth} onClick={() => setWithEth(eth)}>
          {eth ? "Pay with ETH" : `Pay with ${pool.quoteSymbol}`}
        </button>
      ))}
    </div>
  ) : null;
  if (stockBuy && withEth) {
    return (
      <div className="stack">
        {payWith}
        <PoolTradeEth pool={pool} symbol={symbol} />
      </div>
    );
  }

  const inSym = side === "buy" ? pool.quoteSymbol : symbol;
  const outSym = side === "buy" ? symbol : pool.quoteSymbol;
  const inDec = side === "buy" ? pool.quoteDecimals : LAUNCHPAD_DECIMALS;
  const outDec = side === "buy" ? LAUNCHPAD_DECIMALS : pool.quoteDecimals;
  const zeroForOne = zeroForOneFor(pool, side);
  const isBuy = side === "buy";
  const isSell = side === "sell";
  const buyPresets = isBuy ? buyPresetsFor(pool.quoteSymbol) : null;

  const onReview = async () => {
    let amountIn: bigint;
    try {
      amountIn = parseAmount(amount, inDec);
    } catch (e) {
      return setReview({ problem: messageOf(e) });
    }
    setReview("quoting");
    try {
      const q = await quoteV4(pool.key, zeroForOne, amountIn);
      setReview({ amountIn, out: q.amountOut, minOut: minOutFor(q.amountOut, slippageBps) });
    } catch (e) {
      setReview({ problem: messageOf(e) });
    }
  };
  const onTrade = async (r: Review) => {
    const deadline = Math.floor(Date.now() / 1000) + DEADLINE_S;
    const list = await swapSteps({ key: pool.key, zeroForOne, amountIn: r.amountIn, minOut: r.minOut, deadline, from: me!, asset: { symbol: inSym, decimals: inDec } });
    const done = await steps.run(
      signingProvider(),
      me!,
      list.map((s) => ({ label: s.what, build: () => ({ to: s.to, data: s.data, value: s.value }) })),
    );
    if (done !== null) {
      play("ok");
      setReview(null);
      setAmount("");
    }
  };
  const reviewed = review !== null && review !== "quoting" && !("problem" in review) ? review : null;
  const onConnect = () => (openWindow ? openWindow("wallet") : void connectInjected());
  const cta = !me ? (busy ? "Connecting…" : "Connect wallet") : reviewed ? `${side === "buy" ? "Buy" : "Sell"} — sign in your wallet` : "Review";

  return (
    <div className="stack">
      {payWith}
      <div className="pt__box">
        <label className="field-label">
          <span className="pt__box-head">
            <span>You {side === "buy" ? "pay" : "sell"} ({inSym})</span>
            <span className="mono">{outSym} pool</span>
          </span>
          <input
            className="field pt__input"
            inputMode="decimal"
            aria-label={`Amount of ${inSym}`}
            placeholder="0.0"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setReview(null);
            }}
          />
        </label>
        {buyPresets ? (
          <div className="pt__presets" role="group" aria-label="Quick amount">
            {buyPresets.map((val) => (
              <button
                key={val}
                type="button"
                className="pt__preset"
                onClick={() => {
                  setAmount(val);
                  setReview(null);
                }}
              >
                {val} {pool.quoteSymbol}
              </button>
            ))}
          </div>
        ) : isSell ? (
          <div className="pt__presets" role="group" aria-label="Quick sell percentage">
            {SELL_PCT_PRESETS.map((pct) => (
              <button
                key={pct}
                type="button"
                className="pt__preset"
                disabled={sellBalance === null || sellBalance === 0n}
                onClick={() => {
                  if (sellBalance === null || sellBalance === 0n) return;
                  const raw = pct === 100 ? sellBalance : (sellBalance * BigInt(pct)) / 100n;
                  setAmount(formatUnits(raw, LAUNCHPAD_DECIMALS));
                  setReview(null);
                }}
              >
                {pct}%
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="pt__slip">
        <span>Max slippage</span>
        <div className="pt__slip-btns" role="group" aria-label="Max slippage">
          {SLIPPAGE_OPTIONS.map((bps) => (
            <button
              key={bps}
              type="button"
              className="pt__slip-btn"
              aria-pressed={slippageBps === bps}
              onClick={() => {
                setSlippageBps(bps);
                setReview(null);
              }}
            >
              {bps / 100}%
            </button>
          ))}
        </div>
      </div>
      {review === "quoting" ? <p className="dim">Asking Uniswap&apos;s Quoter…</p> : null}
      {review !== null && review !== "quoting" && "problem" in review ? <p className="tx__warn">{review.problem}</p> : null}
      {reviewed ? (
        <p className="pt__review">
          You get ≈ <strong>{tokenAmount(reviewed.out, outDec, 6)} {outSym}</strong> — at least {tokenAmount(reviewed.minOut, outDec, 6)} or the swap is refused ({slippageBps / 100}% slippage).
          Straight from the coin&apos;s own pool; the pool&apos;s fee is included.
        </p>
      ) : null}
      <Gel
        className="mf__cta"
        disabled={!me ? busy : steps.running || amount.trim() === "" || review === "quoting"}
        onClick={() => (!me ? onConnect() : void (reviewed ? onTrade(reviewed) : onReview()))}
      >
        {cta}
      </Gel>
      <TxStepList states={steps.states} label="Trade progress" />
      <p className="dim">
        Quoted by Uniswap&apos;s Quoter, swapped through Uniswap&apos;s Universal Router — approvals exact, nothing unlimited. The transaction is simulated before your wallet sees it.
      </p>
    </div>
  );
}
