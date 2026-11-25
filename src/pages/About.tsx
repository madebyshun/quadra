import { IndexNotice } from "@/ui/IndexNotice";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BRAND } from "@/brand";
import { BASE, requireContract } from "@/config/chain";
import { LAUNCHPAD_DECIMALS } from "@/config/launchpad";
import { launchpadCoins, type LaunchpadIndex } from "@/adapters/http/indexer";
import { furnaceOf, type Furnace } from "@/lib/furnace";
import { readBackstop, type Backstop } from "@/lib/backstop";
import { messageOf } from "@/lib/errors";
import { launchOf } from "@/skills/launchpad";
import { explorer, short, tokenAmount } from "@/skills/format";
import { Flywheel } from "./Flywheel";
import "./About.css";

/**
 * The marketing page: one scroll that says what this app is in ten seconds —
 * for a visitor who arrives from a link and does not want a desktop first, and for whatever reads pages
 * without running them. The desktop stays the product; this page points at it.
 *
 * Every number on it is read when the page opens: the launchpad's own index for coins, launchers and
 * trades, and the token's furnace for what has been burnt. A number that could not be read says so —
 * never a zero, never a figure typed into the page.
 */

type Read<T> = T | "reading" | { readonly problem: string };

export type Stats = { readonly coins: number; readonly creators: number; readonly trades: number };

export function statsOf(index: LaunchpadIndex): Stats {
  return { coins: index.coins.length, creators: index.creators.length, trades: index.coins.reduce((n, c) => n + c.trades, 0) };
}

/** The token's furnace, read from the launchpad's record of it; `null` when its share goes elsewhere. */
async function tokenFurnace(token: string): Promise<Furnace | null> {
  const record = await launchOf(token);
  return record === null ? null : furnaceOf(record, token);
}

/** The token's furnace, or `null` when the token's share goes elsewhere. */
const readFurnace = () => tokenFurnace(requireContract("token"));

/** Stage C's Backstop for the token. */
const readTokenBackstop = () => readBackstop(requireContract("backstop"));

/** A poke's time, as UTC. */
const utc = (secs: number) => new Date(secs * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";

function useRead<T>(read: () => Promise<T>): Read<T> {
  const [value, setValue] = useState<Read<T>>("reading");
  useEffect(() => {
    let live = true;
    read().then(
      (v) => live && setValue(v),
      (e: unknown) => live && setValue({ problem: messageOf(e) }),
    );
    return () => {
      live = false;
    };
  }, [read]);
  return value;
}


const shown = <T,>(r: Read<T>, f: (v: T) => string) => (r === "reading" ? "…" : typeof r === "object" && r !== null && "problem" in r ? "not read" : f(r as T));

/** The schedule the treasury keeps for the furnace's ETH (the owner's to set): day, threshold, worst price. */
export const BUYBACK = { day: "Monday", minWei: 5n * 10n ** 16n, maxSlipPct: 2 } as const;

/**
 * When the ETH waiting in the furnace is spent. Only the treasury may call `buyAndBurn` (a v4 pool has no
 * oracle, so a permissionless buyback could be front-run), so this is a schedule the treasury keeps,
 * said as such — every buyback is a public transaction anyone can check against it.
 */
export const BUYBACK_POLICY = `Each ${BUYBACK.day}, once ${tokenAmount(BUYBACK.minWei, 18, 4)} ETH or more is waiting, the treasury spends all of it buying back and burning, at no worse than ${BUYBACK.maxSlipPct}% under the pool's price. Each one is a public transaction.`;

const SUPPLY = 10n ** 27n;

/** How far the waiting ETH is toward the next buyback, 0..100 (whole percent, capped). */
export function gauge(toBuy: bigint): number {
  return Number((toBuy >= BUYBACK.minWei ? BUYBACK.minWei : toBuy) * 100n / BUYBACK.minWei);
}

/** The furnace, as one card: what is burnt, what waits, and how it gets there. */
function FurnaceCard({ furnace, burnt }: { furnace: Read<Furnace | null>; burnt: Read<bigint> | null }) {
  const f = furnace !== null && furnace !== "reading" && !("problem" in furnace) ? furnace : null;
  return (
    <div className="about__furnace" aria-label="The furnace">
      <p className="about__card-head">furnace / {BRAND.ticker}</p>
      <div className="about__burnt">
        <strong>{burnt === null ? "—" : shown(burnt, (b) => tokenAmount(b, LAUNCHPAD_DECIMALS, 0))}</strong>
        <span>{BRAND.ticker} burnt{typeof burnt === "bigint" ? ` · ${(Number((burnt * 1_000_000n) / SUPPLY) / 10_000).toFixed(4)}% of the supply` : ""}</span>
      </div>
      <div className="about__gauge">
        <div className="about__gauge-head">
          <span>next buyback</span>
          <span>{f ? `${tokenAmount(f.toBuy, 18, 6)} / ${tokenAmount(BUYBACK.minWei, 18, 4)} ETH` : furnace === "reading" ? "…" : "not read"}</span>
        </div>
        <div className="about__gauge-bar" role="progressbar" aria-label="ETH waiting toward the next buyback" aria-valuemin={0} aria-valuemax={100} aria-valuenow={f ? gauge(f.toBuy) : 0}>
          <i style={{ width: `${f ? Math.max(gauge(f.toBuy), 1) : 0}%` }} />
        </div>
        <p>{BUYBACK_POLICY}</p>
      </div>
      <dl className="about__furnace-rows">
        <div><dt>burnt from fees, at once</dt><dd>{f ? tokenAmount(f.burnedFromFees, LAUNCHPAD_DECIMALS, 0) : shownMissing(furnace)}</dd></div>
        <div><dt>burnt by buybacks</dt><dd>{f ? tokenAmount(f.burnedFromBuybacks, LAUNCHPAD_DECIMALS, 0) : shownMissing(furnace)}</dd></div>
        <div><dt>ETH spent on buybacks</dt><dd>{f ? `${tokenAmount(f.quoteSpent, 18, 6)} ETH` : shownMissing(furnace)}</dd></div>
      </dl>
      <ol className="about__flow" aria-label="How a trade feeds the furnace">
        <li>every trade pays 1%</li>
        <li>80% reaches the furnace</li>
        <li>half the {BRAND.ticker} burns at once</li>
        <li>half the ETH buys back and burns</li>
      </ol>
    </div>
  );
}

/** The Backstop, as one card: the bid under the price, and what it has bought and burnt. */
function BackstopCard({ backstop }: { backstop: Read<Backstop> }) {
  const b = backstop !== "reading" && !("problem" in backstop) ? backstop : null;
  const missing = backstop === "reading" ? "…" : "not read";
  return (
    <div className="about__furnace about__backstop" aria-label="The backstop">
      <p className="about__card-head">backstop / {BRAND.ticker}</p>
      <p>Half of the protocol's ETH from every coin waits as a bid just under {BRAND.ticker}'s price in its own pool. A seller fills it; what it buys is burnt.</p>
      <dl className="about__furnace-rows">
        <div><dt>bid in the pool</dt><dd>{b ? (b.placed ? "placed" : "waiting for ETH") : missing}</dd></div>
        <div><dt>burnt by the backstop</dt><dd>{b ? tokenAmount(b.burned, LAUNCHPAD_DECIMALS, 0) : missing}</dd></div>
        <div><dt>ETH waiting for the next poke</dt><dd>{b ? `${tokenAmount(b.waiting, 18, 6)} ETH` : missing}</dd></div>
        <div><dt>last poke</dt><dd>{b ? (b.lastPoke === 0 ? "never" : utc(b.lastPoke)) : missing}</dd></div>
      </dl>
      {b ? <p><a href={explorer.address(b.address)}>{short(b.address)}</a> on {BASE.name}</p> : null}
    </div>
  );
}

/** A furnace figure that is not there: still reading, not read, or no furnace at all. */
function shownMissing(furnace: Read<Furnace | null>): string {
  return furnace === "reading" ? "…" : furnace === null ? "—" : "not read";
}

export function About() {
  const index = useRead(launchpadCoins);
  const token = requireContract("token");
  const furnace = useRead(readFurnace);
  const stats = index === "reading" || "problem" in index ? index : statsOf(index);
  const backstop = useRead(readTokenBackstop);
  const furnaceBurnt = furnace === "reading" || (furnace !== null && "problem" in furnace) ? furnace : furnace === null ? null : furnace.burnedFromFees + furnace.burnedFromBuybacks;
  // the headline is furnace + backstop; a part not read makes the whole "not read", never a smaller number
  const burnt =
    furnaceBurnt === null || typeof furnaceBurnt !== "bigint" ? furnaceBurnt : backstop === "reading" || "problem" in backstop ? backstop : furnaceBurnt + backstop.burned;

  return (
    <div className="about">
      <header className="about__bar">
        <Link to="/" state={{ fromPage: true }} className="about__brand">
          <img src="/brand/icon.svg" width="30" height="30" alt="" />
          {BRAND.name}
        </Link>
        <nav aria-label="About navigation">
          <a href="#tools">The tools</a>
          <Link to="/docs">Docs</Link>
          <Link to="/" state={{ fromPage: true }} className="about__button about__button--small">Open the computer <span aria-hidden="true">↗</span></Link>
        </nav>
      </header>

      <section className="about__hero">
        <img className="about__sky" src="/brand/quadra-hero.webp" width="1902" height="827" fetchPriority="high" alt="" />
        <div className="about__hero-inner">
          <p className="about__eyebrow">A personal computer. An open world.</p>
          <h1><img src="/brand/icon-white.svg" width="80" height="80" alt="" />{BRAND.name}</h1>
          <h2>Your own<br />on-chain<br /><em>supercomputer.</em></h2>
          <p className="about__lede">Research a token. Build a basket. Launch something new. Your corner of {BASE.name}, signed in your own wallet.</p>
          <div className="about__row">
            <Link to="/" state={{ fromPage: true }} className="about__button">Open the computer <span aria-hidden="true">↗</span></Link>
            <a href="#tools" className="about__text-link">Take a look around <span aria-hidden="true">↓</span></a>
          </div>
          <p className="about__hero-note">Built on {BASE.name} · Your wallet holds the keys</p>
        </div>
      </section>

      <section className="about__tools" id="tools" aria-labelledby="about-tools-title">
        <div className="about__section-head">
          <p className="about__eyebrow">Good tools. Open windows.</p>
          <h2 id="about-tools-title">A little curiosity.<br /><em>A lot you can do.</em></h2>
          <p>Start with a question, a basket, or an idea. Connect your wallet when you are ready to act.</p>
        </div>
        <div className="about__doors">
          <article className="about__tool">
            <div className="about__window" aria-hidden="true">
              <div className="about__window-bar"><span>Token Verdict</span></div>
              <div className="about__check-art">
                <span className="about__art-label">BEFORE YOU BUY</span>
                <strong>Look a<br />little closer.</strong>
                <span>Simulation · Code · Holders</span>
              </div>
            </div>
            <h3>Check before you act.</h3>
            <p>Simulate a buy and a sell, inspect the code, and read the holders and launcher. See what was checked and what could not be read.</p>
            <Link to="/?do=safety" className="about__tool-link">Check a token <span aria-hidden="true">↗</span></Link>
          </article>
          <article className="about__tool">
            <div className="about__window" aria-hidden="true">
              <div className="about__window-bar"><span>Treasury Basket</span></div>
              <div className="about__basket-art">
                <span className="about__art-label">YOUR MIX. YOUR WALLET.</span>
                <strong>A basket,<br /><em>held by you.</em></strong>
                <div className="about__basket-bars"><i /><i /><i /><i /></div>
                <span>Stocks + crypto on {BASE.name}</span>
              </div>
            </div>
            <h3>Make your own mix.</h3>
            <p>Choose assets and target weights, review a fresh quote, then buy a Treasury Basket. You hold the individual assets in your wallet.</p>
            <Link to="/?do=basket" className="about__tool-link">Build a basket <span aria-hidden="true">↗</span></Link>
          </article>
          <article className="about__tool">
            <div className="about__window" aria-hidden="true">
              <div className="about__window-bar"><span>Launch</span></div>
              <div className="about__launch-art">
                <span className="about__art-label">AN IDEA, MEET A MARKET.</span>
                <strong>Something<br /><em>starts here.</em></strong>
                <span className="about__pair">Your coin <b>↔</b> ETH / Crypto / Stock</span>
              </div>
            </div>
            <h3>Give an idea a market.</h3>
            <p>Launch a fixed-supply coin paired with ETH, Base crypto, or a supported tokenized stock. Its supply starts in a Uniswap v4 pool with permanently locked liquidity.</p>
            <Link to="/?do=launch" className="about__tool-link">Launch a coin <span aria-hidden="true">↗</span></Link>
          </article>
        </div>
        <div className="about__more">
          <span>Already have something in mind?</span>
          <Link to="/?do=coins">Browse coins <span aria-hidden="true">↗</span></Link>
          <Link to="/?do=trade">Trade on {BASE.name} <span aria-hidden="true">↗</span></Link>
        </div>
      </section>

      <section className="about__section about__live" aria-label="Live">
        <p className="about__eyebrow">from the chain, when you arrive</p>
        <h2>Live on {BASE.name}</h2>
        <div className="about__live-grid">
          <FurnaceCard furnace={furnace} burnt={burnt} />
          <BackstopCard backstop={backstop} />
          <div className="about__launchpad" aria-label="The launchpad">
            <p className="about__card-head">launchpad / since v1</p>
            <dl className="about__stats">
              <div><dt>coins launched here</dt><dd>{shown(stats, (s) => s.coins.toLocaleString("en-US"))}</dd></div>
              <div><dt>launchers</dt><dd>{shown(stats, (s) => s.creators.toLocaleString("en-US"))}</dd></div>
              <div><dt>trades on their pools</dt><dd>{shown(stats, (s) => s.trades.toLocaleString("en-US"))}</dd></div>
            </dl>
            {index !== "reading" && !("problem" in index) ? <IndexNotice behind={index.behind} error={index.error} /> : null}
            <Link to="/?do=coins" className="about__tool-link">See every coin <span aria-hidden="true">↗</span></Link>
          </div>
        </div>
        <p className="about__note">Read from {BASE.name} when this page opened: the launchpad's own logs, and the token's furnace.</p>
      </section>

      <section className="about__section">
        <p className="about__eyebrow">Follow the flow</p>
        <h2>How fees flow across {BRAND.name} and {BRAND.ticker}</h2>
        <Flywheel />
        <p className="about__note">
            {BRAND.ticker} (<a href={explorer.token(token)}>{short(token)}</a> on {BASE.name}) has a fixed supply of 1,000,000,000, no admin, and permanently locked Uniswap v4 liquidity.{" "}
            {furnace !== null && furnace !== "reading" && !("problem" in furnace) ? (
              <>
                Its creator fees go to the furnace <a href={explorer.address(furnace.address)}>{short(furnace.address)}</a>: {furnace.burnBps / 100}% burnt/buyback, the rest to the treasury.
              </>
            ) : null}{" "}
            Buybacks are on-chain transactions anyone can read, not a promise of anything.{" "}
            <Link to={`/?do=coins&t=${token}`}>view {BRAND.ticker}</Link>
        </p>
      </section>

      <section className="about__section">
        <h2>What it never does</h2>
        <ul className="about__list">
          <li>It never holds your key. Nothing moves money without your wallet's signature.</li>
          <li>It never calls a token safe. "No red flags" means the checks found none — not that there are none.</li>
          <li>Its launchpad, furnace, FeeRouter, Backstop and BasketRouter contracts are verified on Sourcify and internally reviewed (168 tests, invariants, Slither), not independently audited.</li>
          <li>Coinbase's tokenized stocks are only for eligible persons outside the U.S.</li>
        </ul>
      </section>

      <section className="about__section">
        <p className="about__eyebrow">Another way in</p>
        <h2>For agents</h2>
        <p>
          Every check is also a tool an AI agent can call — over MCP, or paid per call in USDC over x402. See the <Link to="/docs">Docs</Link> and the <Link to="/api">API</Link>.
        </p>
      </section>

      <footer className="about__foot">
        <div className="about__foot-inner">
          <p className="about__eyebrow">The desktop is yours.</p>
          <h2>Make yourself<br /><em>at home.</em></h2>
          <Link to="/" state={{ fromPage: true }} className="about__button">Open the computer <span aria-hidden="true">↗</span></Link>
          <div className="about__colophon"><span>{BRAND.name} · {BRAND.x} · built on {BASE.name}</span><Link to="/docs">Read the docs ↗</Link></div>
        </div>
      </footer>
    </div>
  );
}
