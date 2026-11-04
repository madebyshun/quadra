import { BRAND } from "@/brand";
import { BASE } from "@/config/chain";
import { Page } from "@/pages/Page";

/**
 * The prose alone. Rendered inside a window on the desktop and inside `Page`
 * on `/docs` — the same body either way, so the two can never drift.
 */
export function DocsBody() {
  return (
    <>
      <fieldset className="group">
        <legend>What it does</legend>
        <p className="panel__lede">{BRAND.tagline}</p>
      </fieldset>

      {/*
        What works and what does not, in one place a person reads before trusting anything.
        The tagline says "being built"; this is where that is made specific. Two short lists
        because each line is a claim somebody can check in the app.
      */}
      <fieldset className="group">
        <legend>What works today</legend>
        <ul className="notes" aria-label="Works today">
          <li>
            Research: see what launched on Base in the last hour, read from the chain, with each
            launchpad named and every hook that can take a cut of a trade flagged.
          </li>
          <li>
            Safety: a real buy and sell of a token, run on Base without sending anything, before you
            buy it — plus what its owner can do, who holds it, who launched it and its market. A check
            that could not run says so; it never reads as a pass.
          </li>
          <li>The Terminal: every skill above, typed.</li>
          <li>
            Send ETH or any token on Base to an address or a Basename; swap any token on Base; launch a coin on this app&apos;s own launchpad — a fixed supply nobody
            can mint and liquidity nobody can pull. Each is checked before your
            wallet is asked — where it goes, how much it can take — and signed there.
          </li>
          <li>
            Pay any x402 endpoint from your own wallet, with every 402 checked before anything signs
            and spending limits you set.
          </li>
          <li>Every skill as a tool your own AI agent can call, from a server that holds no key.</li>
        </ul>
      </fieldset>

      <fieldset className="group">
        <legend>Not yet</legend>
        <ul className="notes" aria-label="Not yet">
          <li>The app itself is not deployed: it runs on a developer&apos;s machine while each feature is tested.</li>
          <li>The launchpad contract has not been audited. It holds the liquidity of every coin launched through it, forever.</li>
        </ul>
      </fieldset>

      <fieldset className="group">
        <legend>Where your money sits</legend>
        <p className="panel__lede">
          In your wallet. This site never holds a key and has no field to type one into: anything
          that moves money is a transaction your own wallet shows you and you sign.
        </p>
      </fieldset>

      {/*
        There were sections here about the product's own token and a tokenized-stock pair,
        both removed on the owner's call while the token was not deployed, because a plan printed beside
        checked facts borrows their credibility. The token is live since 2026-10-29; the About page
        (/about) is where it is described, with its numbers read from the chain.
      */}
      <fieldset className="group">
        <legend>Where the answers come from</legend>
        <p className="panel__lede">
          Every report names its sources. Balances and contract reads come from {BASE.name} itself;
          the rest from services that index or scan it.
        </p>
        <ul className="notes" aria-label="Sources">
          <li>Base RPC — balances, gas, contract reads, Basenames. The chain, read directly.</li>
          <li>Blockscout — token lists, holders, verified contracts, decoded transactions. An indexer: seconds behind the chain.</li>
          <li>GoPlus Security — the token scan. It does not run every check on every token; the report says which it skipped.</li>
          <li>DexScreener — prices, liquidity and volume from on-chain markets.</li>
          <li>Relay — swap quotes.</li>
          <li>Markets — GeckoTerminal for on-chain charts; Coinbase&apos;s Tokenized Stocks API for which contract is a real stock on Base.</li>
        </ul>
      </fieldset>
    </>
  );
}

export function Docs() {
  return (
    <Page title={`Docs — ${BRAND.name}`}>
      <DocsBody />
    </Page>
  );
}
