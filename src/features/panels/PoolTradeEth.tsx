import { useState } from "react";
import { quoteSwap, type SwapQuote } from "@/adapters/http/relay";
import { LAUNCHPAD_DECIMALS } from "@/config/launchpad";
import { parseAmount } from "@/lib/amount";
import { ETH, type Asset } from "@/lib/erc20";
import { messageOf } from "@/lib/errors";
import { play } from "@/lib/sound";
import { tokenReceived } from "@/lib/transact";
import { minOutFor, quoteV4, swapSteps, zeroForOneFor, type LaunchPool } from "@/lib/v4swap";
import { tokenAmount } from "@/skills/format";
import { Gel } from "@/ui/Gel";
import { useWalletSession } from "@/ui/WalletProvider";
import { TxStepList, useTxSteps } from "@/features/panels/TxSteps";

/**
 * Buying a STOCK-paired coin with plain ETH (2026-10-29). A buyer who holds no AAPLc could not buy an
 * AAPLc-paired coin at all, and no single router reaches both pools: the stocks trade on Aerodrome
 * against USDC (MEASURED: AAPLc, NVDAc), the coin on its own Uniswap v4 pool. So it is two legs, each
 * checked and signed on its own: Relay turns the ETH into the stock (`checkSwap`, the same engine as
 * Swap), and the stock that ARRIVED — read from that swap's own receipt, never the quote — is then
 * spent on the coin through its pool, quoted afresh. Leg two is never asked for until leg one is
 * confirmed; if it is not signed, the stock simply stays in the wallet.
 */

/** Relay's slippage for the stock leg: 1%, the same as the pool leg's. */
export const STOCK_SLIPPAGE_BPS = 100;
/** How long a reviewed two-leg buy stays signable. */
export const QUOTE_TTL_MS = 60_000;
export const DEADLINE_S = 600;

type Pool = LaunchPool & { readonly quoteSymbol: string; readonly quoteDecimals: number };
type Review = { readonly ethIn: bigint; readonly relay: SwapQuote; readonly coinOut: bigint; readonly at: number };

export function PoolTradeEth({ pool, symbol, now = Date.now }: { pool: Pool; symbol: string; now?: () => number }) {
  const { wallet, signingProvider } = useWalletSession();
  const me = wallet?.kind === "ready" ? wallet.account : null;
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<Review | "quoting" | { readonly problem: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const stockLeg = useTxSteps();
  const coinLeg = useTxSteps();
  const stock: Asset = { kind: "erc20", address: pool.quote, symbol: pool.quoteSymbol, decimals: pool.quoteDecimals };
  const zeroForOne = zeroForOneFor(pool, "buy");

  const onReview = async () => {
    let ethIn: bigint;
    try {
      ethIn = parseAmount(amount, 18);
    } catch (e) {
      return setReview({ problem: messageOf(e) });
    }
    setReview("quoting");
    try {
      const relay = await quoteSwap({ user: me!, sell: ETH, buy: stock, amount: ethIn, slippageBps: STOCK_SLIPPAGE_BPS });
      // the coin is quoted for the LEAST the stock leg may deliver, so the estimate never flatters
      const coin = await quoteV4(pool.key, zeroForOne, relay.min);
      setReview({ ethIn, relay, coinOut: coin.amountOut, at: now() });
    } catch (e) {
      setReview({ problem: messageOf(e) });
    }
  };

  const onBuy = async (r: Review) => {
    setNote(null);
    if (now() - r.at > QUOTE_TTL_MS) {
      setReview(null);
      return setNote("That quote is more than a minute old. Review again for a fresh one — nothing was sent.");
    }
    const first = await stockLeg.run(
      signingProvider(),
      me!,
      r.relay.steps.map((s) => ({ label: `${s.label} (ETH → ${stock.symbol})`, build: () => s.tx })),
    );
    if (first === null) return;
    const got = tokenReceived(first[first.length - 1]!, pool.quote, me!);
    if (got === 0n) return setNote(`The swap confirmed, but no ${stock.symbol} arriving at your wallet could be read from it. Nothing more was sent — check your balance before buying ${symbol}.`);
    let list;
    try {
      const fresh = await quoteV4(pool.key, zeroForOne, got);
      const deadline = Math.floor(now() / 1000) + DEADLINE_S;
      list = await swapSteps({ key: pool.key, zeroForOne, amountIn: got, minOut: minOutFor(fresh.amountOut, STOCK_SLIPPAGE_BPS), deadline, from: me!, asset: { symbol: stock.symbol, decimals: stock.decimals } });
    } catch (e) {
      return setNote(`You now hold ${tokenAmount(got, stock.decimals, 6)} ${stock.symbol}; buying ${symbol} with it could not be prepared: ${messageOf(e)} Try the "Pay with ${stock.symbol}" tab.`);
    }
    const second = await coinLeg.run(
      signingProvider(),
      me!,
      list.map((s) => ({ label: s.what, build: () => ({ to: s.to, data: s.data, value: s.value }) })),
    );
    if (second === null) return setNote(`The ${stock.symbol} stays in your wallet — buy ${symbol} with it from the "Pay with ${stock.symbol}" tab.`);
    play("ok");
    setReview(null);
    setAmount("");
    setNote(`Bought ${symbol} with ${tokenAmount(got, stock.decimals, 6)} ${stock.symbol}.`);
  };

  const reviewed = review !== null && review !== "quoting" && !("problem" in review) ? review : null;
  const running = stockLeg.running || coinLeg.running;
  const cta = !me ? "Connect a wallet first" : reviewed ? `Buy — two signatures in your wallet` : "Review";

  return (
    <div className="stack">
      <label className="field-label">
        You pay (ETH)
        <input
          className="field"
          inputMode="decimal"
          aria-label="Amount of ETH"
          placeholder="0.0"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setReview(null);
          }}
        />
      </label>
      {review === "quoting" ? <p className="dim">Asking Relay for {stock.symbol}, then Uniswap&apos;s Quoter…</p> : null}
      {review !== null && review !== "quoting" && "problem" in review ? <p className="tx__warn">{review.problem}</p> : null}
      {reviewed ? (
        <p>
          ≈ <strong>{tokenAmount(reviewed.relay.out, stock.decimals, 6)} {stock.symbol}</strong> (at least {tokenAmount(reviewed.relay.min, stock.decimals, 6)}), then
          ≈ <strong>{tokenAmount(reviewed.coinOut, LAUNCHPAD_DECIMALS, 6)} {symbol}</strong> for that least amount. Two legs: ETH → {stock.symbol} through Relay,
          then {stock.symbol} → {symbol} through the coin&apos;s own pool, quoted again with what really arrived.
        </p>
      ) : null}
      <Gel className="mf__cta" disabled={!me || running || amount.trim() === "" || review === "quoting"} onClick={() => void (reviewed ? onBuy(reviewed) : onReview())}>
        {cta}
      </Gel>
      <TxStepList states={stockLeg.states} label={`ETH to ${stock.symbol}`} />
      <TxStepList states={coinLeg.states} label={`${stock.symbol} to ${symbol}`} />
      {note ? <p role="status">{note}</p> : null}
      <p className="dim">
        {stock.symbol} is a Coinbase tokenized stock, only for eligible persons outside the U.S.; if you may not hold it, its contract can refuse the first leg.
      </p>
    </div>
  );
}
