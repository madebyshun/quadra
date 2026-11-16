import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BRAND } from "@/brand";
import { BASE, requireContract } from "@/config/chain";
import { LAUNCHPAD_DECIMALS } from "@/config/launchpad";
import { launchpadCoins, type LaunchpadIndex } from "@/adapters/http/indexer";
import { furnaceOf, type Furnace } from "@/lib/furnace";
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

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="about__figure">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

const shown = <T,>(r: Read<T>, f: (v: T) => string) => (r === "reading" ? "…" : typeof r === "object" && r !== null && "problem" in r ? "not read" : f(r as T));

export function About() {
  const index = useRead(launchpadCoins);
  const token = requireContract("token");
  const furnace = useRead(readFurnace);
  const stats = index === "reading" || "problem" in index ? index : statsOf(index);
  const burnt = furnace === "reading" || (furnace !== null && "problem" in furnace) ? furnace : furnace === null ? null : furnace.burnedFromFees + furnace.burnedFromBuybacks;

  return (
    <div className="about">
      <header className="about__bar">
        <Link to="/" className="about__brand">
          <img src="/brand/icon.svg" width="30" height="30" alt="" />
          {BRAND.name}
        </Link>
        <nav aria-label="About navigation">
          <a href="#tools">The tools</a>
          <Link to="/docs">Docs</Link>
          <Link to="/" className="about__button about__button--small">Open the computer <span aria-hidden="true">↗</span></Link>
        </nav>
      </header>

      <section className="about__hero">
        <img className="about__sky" src="/brand/computer-sky.webp" srcSet="/brand/computer-sky-480.webp 480w, /brand/computer-sky-960.webp 960w, /brand/computer-sky.webp 1536w" sizes="100vw" width="1536" height="1024" fetchPriority="high" alt="A cream-colored personal computer floating above the ocean under a blue sky" />
        <div className="about__hero-inner">
          <p className="about__eyebrow">A personal computer. An open world.</p>
          <h1>{BRAND.name}</h1>
          <h2>Your own<br />on-chain<br /><em>supercomputer.</em></h2>
          <p className="about__lede">Research a token. Build a basket. Launch something new. Your corner of {BASE.name}, signed in your own wallet.</p>
          <div className="about__row">
            <Link to="/" className="about__button">Open the computer <span aria-hidden="true">↗</span></Link>
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
                <span className="about__pair">Your coin <b>↔</b> ETH / Stock</span>
              </div>
            </div>
            <h3>Give an idea a market.</h3>
            <p>Launch a fixed-supply coin paired with ETH or a supported tokenized stock. Its supply starts in a Uniswap v4 pool with permanently locked liquidity.</p>
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
        <p className="about__eyebrow">From the chain, when you arrive</p>
        <h2>Live on {BASE.name}</h2>
        <div className="about__figures">
          <Figure label="coins launched here" value={shown(stats, (s) => s.coins.toLocaleString("en-US"))} />
          <Figure label="launchers" value={shown(stats, (s) => s.creators.toLocaleString("en-US"))} />
          <Figure label="trades on their pools" value={shown(stats, (s) => s.trades.toLocaleString("en-US"))} />
          <Figure label={`${BRAND.ticker} burnt`} value={burnt === null ? "—" : shown(burnt, (b) => tokenAmount(b, LAUNCHPAD_DECIMALS, 0))} />
        </div>
        <p className="about__note">Read from {BASE.name} when this page opened: the launchpad's own logs, and the token's furnace.</p>
      </section>

      <section className="about__section">
        <p className="about__eyebrow">Follow the flow</p>
        <h2>Every coin launched here feeds {BRAND.ticker}</h2>
        <Flywheel />
        <p className="about__note">
            {BRAND.ticker} is <a href={explorer.token(token)}>{short(token)}</a> on {BASE.name}.{" "}
            {furnace !== null && furnace !== "reading" && !("problem" in furnace) ? (
              <>
                Its fees go to the furnace <a href={explorer.address(furnace.address)}>{short(furnace.address)}</a>: {furnace.burnBps / 100}% burnt, the rest to the treasury.
              </>
            ) : null}{" "}
            Buybacks are on-chain transactions anyone can read, not a promise of anything.
        </p>
      </section>

      <section className="about__section">
        <h2>What it never does</h2>
        <ul className="about__list">
          <li>It never holds your key. Nothing moves money without your wallet's signature.</li>
          <li>It never calls a token safe. "No red flags" means the checks found none — not that there are none.</li>
          <li>Its launchpad, fee-sharing and furnace contracts are verified on Sourcify and not audited.</li>
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
          <Link to="/" className="about__button">Open the computer <span aria-hidden="true">↗</span></Link>
          <div className="about__colophon"><span>{BRAND.name} · {BRAND.x} · built on {BASE.name}</span><Link to="/docs">Read the docs ↗</Link></div>
        </div>
      </footer>
    </div>
  );
}
