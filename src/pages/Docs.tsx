import { BRAND } from "@/brand";
import { BASE } from "@/config/chain";
import { AAPL_BASE, AAPL_REFERENCE_POOL } from "@/config/pair";
import { Page } from "@/pages/Page";
import { Crt } from "@/ui/Crt";

export function Docs() {
  return (
    <Page title={`Docs — ${BRAND.name}`}>
      <fieldset className="group">
        <legend>What it does</legend>
        <p className="panel__lede">{BRAND.tagline}</p>
      </fieldset>

      <fieldset className="group">
        <legend>Where your money sits</legend>
        <p className="panel__lede">
          This site never holds a key. You put money into the pool yourself, and what comes back is
          a note: a secret your browser keeps. Spending a note proves you own one without saying
          which one. Lose the note and the money is gone, the same way cash is gone.
        </p>
      </fieldset>

      <fieldset className="group">
        <legend>{BRAND.ticker}</legend>
        <p className="panel__lede">
          {BRAND.ticker} pairs against tokenized Apple stock on {BASE.name}. The name is a 1991
          Macintosh, so the pair is the point.
        </p>
        <Crt label="The other side of the pair, checked on chain">
          {`token    ${AAPL_BASE.symbol}  (${AAPL_BASE.name})\n`}
          {`address  ${AAPL_BASE.address}\n`}
          {`chain    ${BASE.name} ${BASE.id}\n`}
          {`decimals ${AAPL_BASE.decimals}\n`}
          <span className="crt__dim">
            {`\npool     ${AAPL_REFERENCE_POOL.address}\n`}
            {`tvl      $${AAPL_REFERENCE_POOL.tvlUsd.toLocaleString("en-US")}  ·  24h $${AAPL_REFERENCE_POOL.volume24hUsd.toLocaleString("en-US")}\n`}
            {`measured ${AAPL_REFERENCE_POOL.measuredAt} — these move, read them live\n`}
          </span>
          <span className="crt__amber">
            {`\n${AAPL_BASE.symbol} has no Solidity source: it is a node precompile. Identity was\n`}
            {`asserted on chain, not read off an explorer page.`}
          </span>
        </Crt>
        <p className="dim">
          <a href={AAPL_BASE.explorer} target="_blank" rel="noreferrer">
            {AAPL_BASE.symbol} on Basescan
          </a>
        </p>
      </fieldset>
    </Page>
  );
}
