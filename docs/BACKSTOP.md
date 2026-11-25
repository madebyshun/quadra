# Backstop — every coin's fees buying back and burning $QUADRA (Stage C)

Status: BUILT and tested 2026-11-25 (contracts/src/FeeRouter.sol, contracts/src/Backstop.sol, contracts/test/StageC.t.sol; gate:contracts 154 tests, 8 files at 100%) and SIMULATED on mainnet state (scripts/simulate-backstop.ts). DEPLOYED 2026-11-26 by the owner (Backstop 0xc5b6CA155E17a4Ff45ffC056Ff39468d48940409, FeeRouter 0xFad19ece5eB90cC4442589541fa3Be9d0853169c, block 62,181,865, both Sourcify exact) and LIVE: v3 protocolRecipient() = FeeRouter (accept tx 0x7e807735…2c31). Kept by scripts/keep-backstop.ts in the harvest workflow. NOT audited; internal review contracts/REVIEW-2026-11-26.md (B1: an empty poke resets the drag clock, keep a band placed). The owner chose the name ("Backstop") and
the direction: an automatic, oracle-free buyback-and-burn of $QUADRA funded by the protocol share of every
coin launched on LaunchFactoryV3, in the spirit of Flaunch's Progressive Bid Wall (a public description of
the idea only; no Flaunch code was read or used).

## What is measured (2026-11-25)

- `LaunchHook.beforeAddLiquidity` refuses non-factory liquidity only during a pool's 15 s opening window
  (`contracts/src/LaunchHook.sol:127`): after it, anyone may add a position to $QUADRA's pool.
- $QUADRA's pool key: currency0 = ETH (address 0), currency1 = $QUADRA `0xB200…5d7F`, dynamic fee flag,
  tickSpacing 200, hook `0x0D9D…A880` (read back from `launches(token)`).
- `LaunchFactoryV3.protocolRecipient` moves in two steps (`proposeProtocolRecipient` by the current one,
  `acceptProtocolRecipient` by the new one). The protocol recipient is ALSO the only address that may
  `setReferrer`. A payout the recipient refuses is kept in `owed` for `withdraw(currency)`.
- `collect(token)` may be called by anyone; ETH is pushed with a plain `call` (no gas stipend).

## Two contracts

### FeeRouter — becomes v3's protocol recipient

- `receive()` accepts ETH; tokens arrive by transfer.
- `distribute(currencies)`, anyone may call:
  - ETH: `ETH_BPS` (5,000 = 50%) to Backstop, the rest to the treasury — never all of it (the owner's rule).
  - any token (USDC, a stock, AERO, the coin itself): all to the treasury. Not sold here: selling a
    creator's coin would push down the very coin that paid the fee, and converting a quote needs a price.
- `pullOwed(currency)`: anyone; calls the factory's `withdraw` for what it kept for the router.
- `accept()`: anyone; calls `acceptProtocolRecipient` (only works once the treasury has proposed it).
- `setReferrer(referrer, approved)`: the treasury only, forwarded unchanged — the one power the router
  would otherwise take away from the treasury.
- the escape hatch (the owner kept it, 2026-11-25): `announceMove(next)` by the treasury, public on chain;
  `executeMove()` proposes `next` as the protocol recipient no sooner than `MOVE_DELAY` (7 days) later;
  `cancelMove()` withdraws it. Anyone watching has a week's notice before the split could change.

### Backstop — the bid wall on $QUADRA's own pool

Holds ETH and keeps it as ONE single-sided position just below $QUADRA's price. With ETH as currency0,
an ETH-only position sits ABOVE the current tick; a seller of $QUADRA pushes the tick up into it and the
position turns ETH into $QUADRA — a buyback at, or under, the market, filled by the seller's own trade.

`poke()`, anyone may call, at most once per `MIN_INTERVAL`:
1. remove the whole position (ETH, $QUADRA, and the LP fees it earned);
2. send every $QUADRA it holds to `0x…dEaD`;
3. place all its ETH in `[lower, lower + WIDTH]`, `lower` = the current tick rounded up plus `GAP`;
4. follow a higher $QUADRA price (a lower tick) by at most one spacing per `DRAG_PERIOD` (24 h), held to the last band even when it is empty.

Values (immutable): `GAP` one spacing (~2% under spot), `WIDTH` one spacing, `MIN_INTERVAL` 30 min,
`MIN_ETH` 0.001, and a RISING price followed by one spacing per `DRAG_PERIOD` = 24 h — the band is anchored
where the price was at deployment and held to its last band even when empty.

### MEASURED on the real $QUADRA pool (scripts/simulate-backstop.ts, 2026-11-25)

The first design (follow a rising price one spacing per 30-minute poke, no anchor) lost money twice:
- a first band placed right under a pumped price: buy 1 ETH, poke, dump into a 0.2 ETH band → +0.033 ETH
  for the buyer. Fixed by the anchor at deployment.
- pump 1 ETH, poke 12 times over 6 h, dump → +0.013 ETH. With one spacing per 24 h the same needs twelve
  days holding the pump alone, exposed to every other trade.

With the shipped values: a holder who bought before the Backstop existed sold into a 0.2 ETH band, and the
next poke burned 2.92% of the supply; pump-and-dump with 0, 1, 3 or 6 daily pokes lost the attacker
0.009–0.018 ETH per 1 ETH. The FeeRouter took v3's protocol recipient (proposed by the treasury, accepted by
the router), collected a real coin's fees and distributed them.

Views for the About page: ETH held, the range, $QUADRA burnt by it, ETH spent.

## Why no oracle is needed, and what can still go wrong

- The wall never sends a swap. It only waits; a fill is a seller choosing to sell into it, at a price
  below spot. There is no "buy now at whatever price" call to sandwich.
- The attack left: pump $QUADRA, call `poke()` so the wall follows the price up, then sell into it at the
  inflated price. The anchor + `DRAG_PERIOD` bound how far the wall can be dragged (~2% per day),
  `GAP` puts it ~2% below spot, and the attacker pays the 1% pool fee on the pump and on the dump — so a
  round costs about what it can take. The simulation must show this with the real pool's depth.
- A thin pool fills the wall quickly in a dump: that is the job — it buys the dip and burns it.
- Not audited. Both contracts would hold real money; the owner deploys and decides when.

## How it is tested before anyone deploys

1. Foundry, 100% of both contracts (gate:contracts): splits, refusals, owed, the treasury-only powers;
   the wall against a REAL v4 PoolManager and the real LaunchHook: placement side, fill by a seller,
   burn, re-placement, the anchor and `DRAG_PERIOD`, `MIN_INTERVAL`, rounding, a pool inside its window.
2. Mainnet simulation (`eth_simulateV1`, no key): deploy both, hand the router v3's protocol recipient
   (state override), collect a real coin's fees, `poke()`, sell $QUADRA into the wall, burn — and the
   pump/poke/dump attack, measured in ETH.
3. Only then: the owner proposes the recipient from the treasury, the router accepts, the keeper pokes.
