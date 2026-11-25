import { BRAND } from "@/brand";
import "@/styles/folio.css";
import "./Flywheel.css";

/** Separate the launch fee split from the token's own furnace; the dashed row is built but carries no funds yet. */
export function Flywheel() {
  return (
    <figure className="fee-map folio" aria-label="Where every fee goes">
      <div className="folio__bar"><span aria-hidden="true">▣</span><span>System / Fee Flow</span><span>Read only</span></div>
      <div className="folio__body">
        <section className="fee-map__pipeline" aria-labelledby="launch-fees-title">
          <header><span className="folio__path">01 / Launchpad</span><h3 id="launch-fees-title" className="folio__title">A trade comes in.<br /><em>The fee branches out.</em></h3><p>Coins paired with ETH, Base crypto, or a supported tokenized stock.</p></header>
          <div className="fee-map__split">
            <div className="fee-map__source folio__slab"><span>Trade fee</span><strong className="folio__figure">1% <small>or</small> 3%</strong><p>Set by the launcher</p></div>
            <div className="fee-map__folders">
              <div className="fee-map__folder folio__card folio__card--tab"><span>Creator /</span><strong className="folio__figure">80%</strong><p>To the coin’s launcher</p></div>
              <div className="fee-map__folder folio__card folio__card--tab"><span>Referrer /</span><strong className="folio__figure">5%</strong><p>Approved referrers only</p></div>
              <div className="fee-map__folder folio__card folio__card--tab"><span>Treasury /</span><strong className="folio__figure">15–20%</strong><p>20% without a referrer.<br />15% with one.</p></div>
            </div>
          </div>
        </section>
        <div className="fee-map__planned folio__pending"><span className="folio__status">Built, not deployed</span><p>Stage C / Backstop: half of the treasury’s ETH share waits as a bid under {BRAND.ticker}; what it buys is burnt.</p><b className="folio__pill">Not live</b></div>
        <section className="fee-map__pipeline" aria-labelledby="token-fees-title">
          <header><span className="folio__path">02 / {BRAND.ticker}</span><h3 id="token-fees-title" className="folio__title">Its own pool.<br /><em>Its own fee flow.</em></h3><p>{BRAND.ticker} / ETH · 1% trade fee</p></header>
          <div className="fee-map__token-flow">
            <div className="fee-map__allocation"><div><strong className="folio__figure">20%</strong><span>To treasury</span></div><div><strong className="folio__figure">80%</strong><span>To furnace</span></div></div>
            <div className="fee-map__furnace folio__end"><div className="fee-map__furnace-title"><span>Furnace /</span><span>Fixed at deploy</span></div><div className="fee-map__outputs"><div><strong className="folio__figure">50%</strong><h4>Burn &amp; buyback</h4><p>{BRAND.ticker} burnt at once.<br />ETH held for buybacks.</p></div><div><strong className="folio__figure">50%</strong><h4>To treasury</h4><p>Remaining 50% of fees<br />sent to treasury.</p></div></div></div>
          </div>
        </section>
        <figcaption className="folio__caveat">Base / Fixed supply / No admin / Permanently locked liquidity / Contracts not audited</figcaption>
      </div>
    </figure>
  );
}
