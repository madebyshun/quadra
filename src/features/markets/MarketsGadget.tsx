import { FLAGS } from "@/config/chain";
import { useMarkets } from "@/features/markets/MarketsProvider";
import { MarketRows } from "@/features/markets/Rows";

/**
 * The desktop's market gadget — a Platinum floating palette (a desk accessory) on the left: each watched asset's price,
 * its 24-hour change and a sparkline. A click opens the Markets window on that asset.
 *
 * A missing price is a dash with the reason in its tooltip, never a zero; the footer says which
 * source each kind of number comes from, because a stock's price (Robinhood's quote for the
 * share) and its chart (trades of the token on Robinhood Chain) are two different facts.
 */
export function MarketsGadget() {
  const { rows, updatedAt, pick } = useMarkets();
  return (
    <aside className="gadget" aria-label="Markets">
      <div className="gadget__title">
        <span>Markets</span>
      </div>
      <MarketRows rows={rows} onPick={pick} />
      <div className="gadget__foot">
        {updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : "Reading prices…"}
        <br />
        Prices: DexScreener{FLAGS.robinhood ? "; Robinhood stocks: Robinhood's quote" : ""}. Charts: GeckoTerminal, 24h.
      </div>
    </aside>
  );
}
