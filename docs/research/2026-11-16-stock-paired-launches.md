# Stock-paired launches: Quadra, Bankr and o1

Research date: 2026-11-16. Purpose: identify useful next work for Quadra's own launchpad.
This does not restore the retired o1 integration or change deployed contracts.

## Evidence and limits

Quadra: current repository implementation plus a read-only Base factory check at block
58,129,421. Bankr: current public Base quote-token API plus its official documentation.
o1: `docs.o1.exchange` official documentation and its separately dated configuration;
not the different `docs.o1bot.exchange` service. No launch, trade, funding, approval or
contract deployment was submitted during this research. Competitor transaction flows
were not end-to-end signed, and their entire deployments were not independently audited here.

## Quadra, verified on Base

Factory `0x006Da367654a487bb277fe25ff54f0fE0f741377`, v3, passed the app's
`checkFactory` assertions. Hook `0x0D9DdcC907658E3C61318d0F979F978e600AA880`
reported an opening fee of 50%, declining over 15 seconds. The normal fee is chosen
at launch: 1% or 3%. Creator share is 80% of fees; an approved launch referrer can
receive 5% out of the protocol share (80/5/15). Collection returns token and quote
fees in kind; it does not universally convert everything into the paired stock.

The app returned ETH plus 11 enabled stock choices: CRCLc, TSLAc, GOOGLc, SNDKc,
MSTRc, INTCc, NVDAc, SPCXc, METAc, MSFTc and AAPLc. This is the current *app-visible*
list after Coinbase registry, transfer-pause and NAV filtering, not a count of every
possible factory registry entry. The older comments mentioning eight stocks are dated snapshots.

Source: `src/adapters/http/launchpad.ts`, `src/config/launchpad.ts`,
`src/features/panels/BaseLaunch.tsx`, `contracts/src/LaunchFactoryV3.sol`,
`contracts/src/LaunchHook.sol`, plus the live reads above.

Existing strengths: fixed one-billion supply, no token admin, permanent single-sided
Uniswap v4 liquidity, exact stock approval before an atomic first buy inside launch,
factory/quote assertions before signing, simulated writes, share cards, pool-native
trading, and paired-stock exposure on a coin's page. ETH conversion for trading a
stock-paired coin exists in `PoolTrade`; ETH-funded atomic acquisition of the stock
inside the *launch transaction* is a separate feature and is not in `BaseLaunch`.

## Bankr

The public endpoint `https://api.bankr.bot/token-launches/quote-tokens?chain=base`
returned HTTP 200, provider `doppler`, and 44 quote entries: 38 stock entries and six
other quotes. Fourteen entries carried `illiquid: true`; this is an advisory flag,
not a proof of an executable route. Stock deployment uses an exact address and the
Doppler provider. A stale or unpriceable stock is refused; a thin stock can still launch.

For new Doppler launches the documented total trading fee is 1.75%: 0.665% claimable
creator fees, 0.285% compounded locked liquidity, 0.475% Bankr, 0.2375% BNKR buyback,
and approximately 0.0875% Doppler. Optional quote-only creator fees, creator vesting,
and a temporary wallet balance cap are distinct launch settings. Older launches keep
their original economics. These figures describe Doppler, not Bankr's separate Arc v3.

Source: [Bankr launch overview](https://docs.bankr.bot/token-launching/overview/).

Bankr also supports pairing a token against a qualifying index token on Base or
Robinhood Chain. That requires a live index vault and eligibility checks. A saved
Quadra basket recipe is not an on-chain quote asset and cannot be passed to a pool
as though it were an ERC-20.
Source: [Index-paired launches](https://docs.bankr.bot/token-launching/index-paired-launches/).

## o1 Exchange

Stock-paired Standard and Tax launches use permanent token-only Uniswap v4 liquidity.
The issuer's stock is the quote asset; a launch requires no stock liquidity deposit.
Its November 13 catalog lists 341 Base stocks, all with eight decimals. Catalog
membership is not proof of executable depth or current product availability.
Stock fees and Tax dividends are paid in the quote stock; burns use the launched token.
Source: [Stock-paired launches](https://docs.o1.exchange/launchpad/create/stock-paired-launches).

The documented Base Standard fee is 1% of the paired asset, split 50% creator,
30% platform, 20% valid referrer. Without a valid referrer the platform receives that
share. Base Standard creation is 0.001 ETH plus gas; opening total fees fall from
99% to 1% over 20 seconds. The atomic launch-time Dev Buy is exempt from the extra
opening surcharge. Tax and wstO products have different economics.
Source: [Fees and referrals](https://docs.o1.exchange/launchpad/trading/fees-referrals).

The route adapter's validation, permissions, and dependency boundaries matter as
much as the launch hook. Stock issuer restrictions remain external to the launch
liquidity lock. Published audit scope does not automatically cover every adapter.
Source: [Security and audit](https://docs.o1.exchange/launchpad/security).

## Recommended next work for Quadra

1. **Pair health before launch.** Combine factory enablement, issuer transfer status,
   current NAV/DEX price with timestamps, executable buy/sell route probes, and an
   explicit thin/unread state. A large catalog is not the same as a usable quote.
   Reuse the ordered, paced quote infrastructure; do not infer depth from TVL alone.
2. **Opening valuation review.** Show opening FDV in stock units and USD, the reference
   used, and the effect of stock-price movement since the configured opening tick.
   Never silently reprice an existing pool or perform an admin `setQuote` automatically.
3. **Funding and confirmation flow.** Offer USDC/ETH funding of a stock first buy.
   Atomic approval + launch can reuse wallet batching when supported. A truly atomic
   conversion + launch needs a dedicated validated adapter and separate contract review.
4. **Fee clarity and stock-denominated proceeds.** Show the exact chosen fee and its
   split in dollars/stock units, and distinguish in-kind fees from conversion to stock.
   Quote-only creator proceeds require an explicit conversion mechanism; current
   deployed contracts cannot acquire this behavior through a UI label.
5. **Growth surfaces.** A launch page and card should explain what the stock pair
   means, link the issuer stock, separate the coin's return from the quote's return,
   and expose creator fees/referrer rules. Pairing does not grant stock ownership or
   a stock-redemption right to holders of the launched coin.
6. **Later product: index-paired launches.** An index vault, mint/redeem accounting,
   pricing, rebalancing and liquidity checks are a new contract product. First ship
   useful wallet-held baskets and shared recipes; do not imply those recipes back a token.

Priority 1–2 can improve the existing launchpad without changing its economics.
Adapter funding, fee conversion and index vaults need separate implementations,
contract tests, security review and explicit deployment decisions.
