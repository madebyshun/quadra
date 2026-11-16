# Treasury Basket: one wallet confirmation

Implemented 2026-11-16. Treasury Basket discovers atomic batching on Base using
[EIP-5792 v2](https://eips.ethereum.org/EIPS/eip-5792). `supported` enables the batch
button; `ready` enables it with an account-upgrade notice. Unknown, absent or refused
capabilities leave the existing sequential option available. WalletConnect's installed
provider already advertises the EIP-5792 methods as optional methods.

Each purchase refreshes every nonzero remaining leg, spaces/retries Relay quotes using
the existing pace, enforces the 2% impact limit again and keeps an exact USDC approval
immediately before each swap. This also handles allowances shared between legs. A leg
must contain exactly one checked same-chain swap. Zero top-up legs are skipped.
Preparation exceeding 30 seconds is refused; this is a conservative local budget,
not a promise about upstream quote lifetime. Relay's on-chain slippage/deadline checks
and the wallet's execution simulation still apply while the user reviews the request.

The full ordered sequence is preflighted with `eth_simulateV1`, from the connected
account against its actual balances. No fake balance or code is used in the app.
A refused or incomplete simulation stops the batch. The account/network is rechecked
before `wallet_sendCalls`, which specifies `atomicRequired: true` and a unique ID.

The app saves the batch ID to local storage before asking the wallet. Pending or
uncertain submissions lock further purchases and editing; the user checks status
without signing again, including after reopening the window or reloading. There is
no automatic fallback or resubmission. Explicit user rejection and definite complete
failure unlock retry; success requires matching Base/batch IDs, `atomic: true` and
successful receipts. Received tokens are summed from the batch's Transfer logs.
Storage recovery is scoped to this browser, origin and account. Gas may be charged
for an on-chain revert. Wallet upgrades may require an initial extra confirmation.

## Verification

- Unit/integration tests cover discovery, account/network changes, preflight refusal,
  exact interleaved approvals, fresh-quote impact, preparation timeout, rejection,
  confirmed/reverted/pending/uncertain batches, receipt measurement, storage failure,
  concurrent clicks and recovery after reopening.
- Chrome localhost smoke with a deterministic EIP-1193 test wallet: two-asset basket,
  one `wallet_sendCalls`, four calls, `atomicRequired: true`, inputs/buy buttons locked
  while pending, reload restored the ID, status confirmed without a second submission,
  no browser page errors. Screenshots inspected at desktop and mobile widths.
- Live Base simulation at 2026-11-16 14:08:55 (UTC+7), using fresh checked
  [Relay quotes](https://docs.relay.link/references/api/get-quote): $5 USDC per asset,
  NVDAc + AAPLc + WETH. A simulation-only executor runtime was overridden onto a funded
  public address and invoked once, executing all six calls atomically. No deployment,
  transaction submission, signature or real balance change occurred. Results:

| Asset | Quoted base units | Minimum | Simulated received |
| --- | ---: | ---: | ---: |
| NVDAc (8 decimals) | 3092197 | 3061275 | 3091817 |
| AAPLc (8 decimals) | 1397975 | 1383995 | 1397940 |
| WETH (18 decimals) | 2751057991484004 | 2723547411569163 | 2751012084604324 |

This verifies Relay call composability with an atomic executor. It does not claim a
real user wallet signed a batch; the final confirmation UI depends on that wallet.

## Small test purchases (2026-11-16)

Removed the app-imposed $1 minimum per asset. Any positive total representable in
USDC's six decimals can request quotes; Relay's actual route/amount refusals remain
visible per leg. Zero-USDC purchases are refused before quoting. Regression tests
cover a $0.50 basket in sequential and atomic modes, exact fractional approvals,
and a $0.50 top-up. A fresh live Base atomic simulation also passed for $0.15 NVDAc
+ $0.15 AAPLc + $0.20 WETH, each delivering at least its quoted minimum. No real
transaction was submitted.


## Basket management and share cards (2026-11-16)

Saved recipes keep only a name and target weights in this browser (up to 20).
Compact share links and QR codes reconstruct the target basket without copying
wallet addresses, balances, funding amounts or permission to trade. Shared data is
validated and asset symbols are resolved against the app's verified catalog again.
Opening a link does not connect a wallet, quote, sign, or purchase automatically.

The holdings view shows Target / Now / Value at DEX prices and can be refreshed.
A missing price for a nonzero balance makes valuation and top-up unavailable;
it is not silently valued at zero. Holdings are read again after purchases.

Strength samples full-basket buys at $100 / $1,000 / $10,000 / $100,000 using
exact target weights and paced Relay quotes. It reports a measured lower bound,
not an exact maximum or a TVL-derived estimate. Missing or refused quotes remain
unknown unless Relay explicitly reports excessive impact. Measurement is public,
read-only and requires no wallet connection. A live 60/40 NVDAc/AAPLc probe at
2026-11-16 15:11 UTC+7 passed all four sizes (eight real quotes). Nothing was sent.

Cards include all target assets, including zero-allocation top-up legs. They show
quoted, purchased or partially purchased status, label the weights as targets,
and remove the old claim that every leg was signed separately. Up to ten assets
fit without dropping a constituent. The four-asset top-up and ten-asset layouts
were rendered to PNG and inspected; local browser checks verified saving and
reopening a shared recipe. Unit/integration tests cover storage and malformed
links, quote failures, unavailable holdings prices, top-up cards, all purchase
states and account changes during a pending transaction.
