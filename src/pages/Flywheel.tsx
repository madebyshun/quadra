import { BRAND } from "@/brand";
import "./Flywheel.css";

/** Separate the launch fee split from the token's own furnace; the planned connection carries no funds. */
export function Flywheel() {
  return (
    <figure className="fee-map" aria-label="Where every fee goes">
      <div className="fee-map__bar"><span aria-hidden="true">▣</span><span>System / Fee Flow</span><span>Read only</span></div>
      <div className="fee-map__body">
        <section className="fee-map__pipeline" aria-labelledby="launch-fees-title">
          <header><span className="fee-map__path">01 / Launchpad</span><h3 id="launch-fees-title">A trade comes in.<br /><em>The fee branches out.</em></h3><p>Coins paired with ETH or a supported tokenized stock.</p></header>
          <div className="fee-map__split">
            <div className="fee-map__source"><span>Trade fee</span><strong>1% <small>or</small> 3%</strong><p>Set by the launcher</p><span className="fee-map__connector" aria-hidden="true">↓</span></div>
            <div className="fee-map__folders">
              <div className="fee-map__folder"><span>Creator /</span><strong>80%</strong><p>To the coin’s launcher</p></div>
              <div className="fee-map__folder"><span>Referrer /</span><strong>5%</strong><p>Approved referrers only</p></div>
              <div className="fee-map__folder"><span>Treasury /</span><strong>15–20%</strong><p>20% without a referrer.<br />15% with one.</p></div>
            </div>
          </div>
        </section>
        <div className="fee-map__planned"><span>Not connected</span><p>Stage C / A share of launch fees routed to the furnace.</p><b>Planned</b></div>
        <section className="fee-map__pipeline fee-map__pipeline--token" aria-labelledby="token-fees-title">
          <header><span className="fee-map__path">02 / {BRAND.ticker}</span><h3 id="token-fees-title">Its own pool.<br /><em>Its own fee flow.</em></h3><p>{BRAND.ticker} / AAPLc · 1% trade fee</p></header>
          <div className="fee-map__token-flow">
            <div className="fee-map__allocation"><div><strong>20%</strong><span>→ Treasury</span></div><div><strong>80%</strong><span>↓ Furnace</span></div></div>
            <div className="fee-map__furnace"><div className="fee-map__furnace-title"><span>Furnace /</span><span>Fixed at deploy</span></div><div className="fee-map__outputs"><div><strong>50%</strong><h4>Burn now</h4><p>{BRAND.ticker} is burnt directly.</p></div><div><strong>50%</strong><h4>To treasury</h4><p>AAPLc for on-chain buybacks.<br />Bought {BRAND.ticker} is burnt.</p></div></div></div>
          </div>
        </section>
        <figcaption>Base / Fixed supply / No admin / Permanently locked liquidity / Contracts not audited</figcaption>
      </div>
    </figure>
  );
}
