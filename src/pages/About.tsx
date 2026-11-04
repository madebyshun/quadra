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

/**
 * The plain page (2026-11-04, after c-na.dev): one scroll that says what this app is in ten seconds —
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
          {BRAND.name}
        </Link>
        <Link to="/" className="gel">
          Open the computer
        </Link>
      </header>

      <section className="about__hero">
        <h1>{BRAND.name}</h1>
        <p className="about__lede">An on-chain supercomputer for {BASE.name}. Check a token before you buy it, launch a coin, trade it — every step signed in your own wallet.</p>
        <div className="about__row">
          <Link to="/" className="gel">
            Open the computer
          </Link>
          <Link to="/?do=coins" className="gel gel--quiet">
            Browse coins
          </Link>
        </div>
      </section>

      <section className="about__section" aria-label="Live">
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
        <h2>Three things it does</h2>
        <div className="about__doors">
          <div>
            <h3>Check</h3>
            <p>Paste any token. A buy and a sell are simulated on {BASE.name} right now, then its code, holders and launcher are read — one answer: high risk, caution, or no red flags.</p>
          </div>
          <div>
            <h3>Launch</h3>
            <p>A coin with a fixed supply and no admin, its whole supply in a Uniswap v4 pool nobody can pull, paired with ETH or a tokenized stock. 80% of every trade's fee is the launcher's.</p>
          </div>
          <div>
            <h3>Trade</h3>
            <p>Buy or sell a coin on its own pool, with ETH or its pair. Every transaction is simulated and shown to you before your wallet signs it.</p>
          </div>
        </div>
      </section>

      <section className="about__section">
        <h2>Every coin launched here feeds {BRAND.ticker}</h2>
        <img className="about__flywheel" src="/brand/flywheel.svg" alt={`How fees flow: 1% of every trade, 80% to the coin's creator, the rest to the treasury; ${BRAND.ticker}'s own fees half burnt, half to the treasury.`} />
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
        <h2>For agents</h2>
        <p>
          Every check is also a tool an AI agent can call — over MCP, or paid per call in USDC over x402. See the <Link to="/docs">Docs</Link> and the <Link to="/api">API</Link>.
        </p>
      </section>

      <footer className="about__foot">
        <Link to="/" className="gel">
          Open the computer
        </Link>
        <span>
          {BRAND.name} · {BRAND.x} · built on {BASE.name}
        </span>
      </footer>
    </div>
  );
}
