# contracts/ — the launchpad

One contract, `src/LaunchFactory.sol` (v2), decided by the owner on 2026-10-02 ("build our own on
Base, not o1"; then "pair with stocks on Base like o1, and take o1 out of Launch"): a launch
creates a token nobody administers, a Uniswap v4 pool for it against **ETH or an enabled quote
asset — Coinbase's stock tokens on Base** — and puts the whole supply into that pool as liquidity
no function can take out. The pool's 1% fee is the only income, split 80% to the launcher and 20%
to the protocol, in whatever each trade paid with.

v1 (ETH pairs only) is deployed at `0xcDb2eC1c487fbcB6B4AF25cCD86aFf8120FaB8a5` and its exact source
is in `deployed/`. Its tokens keep trading and anyone can `collect` their fees forever; the app
reads both factories. **v2 is deployed** (owner, 2026-10-02) at
`0xef1F427bB57e0ECd7BB8051cE8bC7AAb709a0c03`, block 52,068,913 — verified on Blockscout, bytecode
identical to this build with immutables masked. New launches go to it.

**v3 is DEPLOYED** by the owner 2026-10-22 at `0x006Da367654a487bb277fe25ff54f0fE0f741377` (hook `0x0D9DdcC907658E3C61318d0F979F978e600AA880`, tx 0x151126f0…, block 52,929,530): verified on Sourcify (exact match), read back and checked by the app's own `checkFactory` (ok), 8 stocks enabled (CRCLc, GOOGLc, INTCc, MSTRc, NVDAc, SNDKc, SPCXc, TSLAc). Blue Agent's referrer `0x884fbdd5cf193e7f87cba76419e526d8f4df7a9b` is NOT yet approved — the owner must send `setReferrer` from the treasury `0xD5C1…3FAB`. Still NOT audited.

**v3** (built 2026-10-14): `src/LaunchFactoryV3.sol` + `src/LaunchHook.sol` —
v2 plus a fee the launcher chooses, an anti-sniper opening and (2026-10-22) APPROVED REFERRERS
paid 5% of the fees out of the protocol's share — 80 / 5 / 15. Its section is below
("v3 — the chosen fee and the anti-sniper opening"); everything v2 guarantees, v3 keeps.

## What one `launch(name, symbol, contractURI, salt, quote, quoteIn)` does, in one transaction

1. **The token** — a B20 Asset (Base's native token standard, a precompile at `0xB20f…0000`),
   18 decimals, created with `initialAdmin = address(0)`. Its `initCalls` mint the whole supply
   (1,000,000,000) to the factory and set the ERC-7572 `contractURI`. B20 lets factory-originated
   init calls bypass role gates, so this works with no role ever granted — and because no admin
   exists, **no role can ever be granted again**: no mint, pause, seize or rename, forever.
2. **The pool** — Uniswap v4, token/quote, 1% fee, tick spacing 200, no hook, opened at the
   quote's `startTick`. `quote` is `address(0)` for ETH, or an address the quote admin enabled.
   The token does not exist before this transaction, so nobody can open the pool first at a
   different price.
3. **The liquidity** — the whole supply as ONE single-sided position from the opening price to
   the far end of the usable range, on whichever side the token sorts to. Prices are kept as a
   tick of TOKEN-PER-QUOTE in raw units, so one number serves both orientations: token is
   currency1 → the pool opens at `startTick`, range [lowest usable, startTick]; token is currency0
   → the pool opens at `-startTick`, range [-startTick, highest usable]. A buy can never exhaust
   it. The position belongs to the factory, which has **no code path that removes liquidity** —
   `collect` pokes it with a zero change, which is how v4 pays out fees.
4. **The first buy** — `quoteIn` of the quote, swapped for the launcher in the same transaction at
   the opening price, before any bot can see the pool. ETH rides as `msg.value` (which must equal
   `quoteIn`); an asset is pulled with `transferFrom` straight from the buyer to the pool manager,
   so **approve the factory for exactly `quoteIn` first** (the Launch window does, as its own
   signature). `msg.value` must be 0 for an asset.

Rounding leaves a few wei of the token — sent to `0x…dEaD`.

## Opening prices — the quote admin

ETH's opening tick is fixed at deploy (191,200: ≈ 2×10^8 tokens per ETH, the billion opens at
≈ 5 ETH). Every other quote is enabled with `setQuote(quote, enabled, startTick)` by the **quote
admin** — the wallet that deployed, handed on only in two steps (`proposeQuoteAdmin` →
`acceptQuoteAdmin`). It can enable, disable and re-price quotes for NEW launches; it cannot touch
a pool, a position, a fee or a launch that already exists.

Ticks are never typed by hand. `scripts/quote-ticks.ts` prices each of Coinbase's stocks so its
pair opens at the same dollar value as an ETH launch — ETH from DexScreener, the stock from its
Chainlink NAV in Coinbase's own API — and prints one `setQuote` line per stock. A stock with no
NAV or with a paused feature is skipped, and the app never offers a stock whose TRANSFER is paused.
🔴 Stocks have **8 decimals** (hard rule 3): the same tick is ten orders of magnitude apart
between ETH and a stock. MEASURED 2026-10-02: NVDAc at $231.42 → tick 396,800, the supply opens at
≈ 58.6 NVDAc.

A stock's issuer may restrict who holds it (B20 transfer policies). MEASURED on NVDAc: its
sender, receiver and executor policies all authorised the pool manager, the v1 factory and an
arbitrary address. A payout a quote refuses is kept in `owed[account][currency]` for
`withdraw(currency)` instead of blocking every other payout of the same collection.

## The token's address cannot be stolen

The B20 salt is `keccak256(abi.encode(caller, salt))`, so the address a launcher computed with
`predictToken(caller, salt)` is theirs: anyone replaying their salt gets a different token.

## Fees

`collect(token)` — callable by anyone — pokes the position and pays out both currencies (buyers
pay the fee in the quote, sellers in the token), returning `(amount0, amount1)` in the pool's
order: `CREATOR_SHARE_BPS` = 8000 to the launcher's recipient, the rest to `protocolRecipient`.
Everything is pushed; anything a recipient (or a quote's policy) refuses waits in `owed`. The
launcher's recipient can hand itself on (`setCreatorRecipient`); the protocol recipient changes
only in two steps (`proposeProtocolRecipient` → `acceptProtocolRecipient`).

## Build, test, measure

Base Foundry is required (stock Foundry cannot reach the B20 precompile):

```
curl -L https://raw.githubusercontent.com/base/base-anvil/HEAD/foundryup/install | bash
base-foundryup --install v1.1.1
npm install                 # Uniswap v4-core / v4-periphery come from npm, through lib/ symlinks
npm run gate:contracts      # base-forge build → base-forge test → 100% coverage of src/
PATH="$HOME/.foundry/bin:$PATH" npx vite-node scripts/simulate-launchpad.ts   # hand-run, mainnet state
PATH="$HOME/.foundry/bin:$PATH" npx vite-node scripts/simulate-launchpad-v3.ts   # v3: the opening fee, hand-run
PATH="$HOME/.foundry/bin:$PATH" npx vite-node scripts/simulate-revenue-share.ts   # RevenueShare on the deployed v3, hand-run
```

The tests (30) run against the real B20 precompile (Base Foundry registers it locally) and a real
Uniswap v4 `PoolManager` deployed from v4-core's own source — no stand-in for either — with an
8-decimal B20 standing in for a stock, in both pool orientations. The simulation runs one
`eth_simulateV1` block against REAL Base state with a keyless address: deploy v2, enable NVDAc at
its live tick, buy NVDAc through Relay, launch an ETH pair with a first buy, approve and launch an
NVDAc pair with a first buy, collect both. MEASURED 2026-10-02: every call succeeded against
Coinbase's real NVDAc and its real transfer policies — the NVDAc launcher got 9.33M tokens for
0.558 NVDAc, the ETH launcher 1.99M for 0.01 ETH, and the factory was left holding no NVDAc.

Vendored: `lib/base-std` is base-std v1.1.0 (`src/`, README, LICENSE only), from
`github.com/base/base-std`. `lib/v4-core` and `lib/v4-periphery` are symlinks into `node_modules`
— MEASURED, `base-forge coverage`'s analyser cannot follow a relative import inside a library
outside the project root, though `build` can.

## v3 — the chosen fee and the anti-sniper opening

Decided by the owner after measuring two competitors: basepad.si lets a creator pick 1% or 3% (46%
of its launches chose 3%); feel.cash charges a falling anti-sniper fee (50% → the normal fee over
15 s). v3 = v2 + both, with nothing of v2 given up.

`launch(name, symbol, contractURI, salt, quote, quoteIn, fee, referrer)` — v2's call plus `fee` (and
`referrer`, see Referrals below):
`FEE_LOW` = 10,000 (1%) or `FEE_HIGH` = 30,000 (3%). Anything else reverts `BadFee()` (tested over
every other uint24 by fuzzing). ⚠️ A different selector from v1/v2's `launch`: the Launch window
needs the new ABI before it can send to v3.

**The pool.** Same B20 token (no admin, the whole 1B supply), same single-sided position owned by
the factory, same tick spacing 200 for both fees (so one opening tick per quote serves both and
`setQuote` is unchanged). What changes is the key: `fee = LPFeeLibrary.DYNAMIC_FEE_FLAG` (0x800000)
and `hooks = factory.hook()`. A reader that displays `key.fee` will show 8388608 — the coin's fee is
`hook.schedules(poolId).fee`, or the `LaunchFee(token, fee)` event.

**The hook** (`LaunchHook`, ≈ 140 lines) sets each swap's LP fee from `beforeSwap`, with
`OVERRIDE_FEE_FLAG`:

    fee(t) = chosen + (startFee − chosen) × (window − t) / window   for t < window   (rounded down)
    fee(t) = chosen                                                  for t ≥ window

`t` is seconds since the pool opened (the launch block's timestamp). Defaults: `startFee` 500,000
(50%), `window` 15 s — both immutable, set once at deploy, validated (`startFee` ≥ 3% and ≤ 100%,
`window` > 0). A 1% coin: 50% at 0 s, 46.73% at 1 s, 25.5% at 7.5 s, 1% from 15 s. Sells pay it too,
so the launcher cannot dump in the window either. Base's blocks are 2 s apart, so in practice the
steps a swap can land on are 0, 2, 4 … 14 s.
- **The launcher's first buy pays the CHOSEN fee**, not the opening one: it is the factory's own
  swap, inside the launch transaction, and the hook exempts `sender == factory` explicitly. The
  factory swaps nowhere else.
- **Only this factory's pools.** `beforeInitialize` refuses any `sender` but the factory. This also
  closes a gap v2 has: in v2, anybody who read `predictToken` could initialize the coin's (hookless)
  pool first at another price, making the launch revert. In v3 that pool key needs the hook, and the
  hook says no.
- **Nobody else adds liquidity during the window** (`beforeAddLiquidity`, sender ≠ factory →
  `Opening()`): the opening fee is the launch's — liquidity placed in front of the snipers would
  otherwise take their fees. After the window anyone may add, as in v2, and removing one's own
  liquidity is never blocked (the hook has no remove permission).
- **What it cannot do:** take anything (no return-delta permission of any kind — the opening fee is an
  LP fee, earned by the factory's locked position and split 80/20 by `collect` like every other fee);
  touch liquidity (it never calls the pool manager); change a fee (no owner, no setter; a pool's fee
  and opening second are written once by the factory, before the pool exists — `register`, factory
  only).

**The hook's address is its permissions** (v4 reads the low 14 bits): exactly `beforeInitialize |
beforeAddLiquidity | beforeSwap` = `0x2880`. The FACTORY deploys the hook in its own constructor
with `CREATE2` and a mined salt, so `hook.factory()` is the factory by construction — no "set the
factory once" function, no owner. The salt is mined against the factory's address, which is the
deploying wallet's next CREATE address (`script/HookSalt.sol`: v4-periphery's HookMiner pattern,
with the init-code hash computed once instead of per salt). A salt that gives any other bits makes
the constructor revert `HookAddressNotValid` (tested).

**Referrals** (owner, 2026-10-22, before v3 is deployed). An app that builds a launch for its user —
Blue Agent first, whose chat will build launch calldata for this factory — names itself as the
launch's referrer and earns 5% of the coin's fees, out of the protocol's 20%:

    launch(name, symbol, contractURI, salt, quote, quoteIn, fee, address referrer)   // address(0) = none

- **Only APPROVED referrers count.** `approvedReferrers[referrer]` must be true at the moment of the
  launch. `setReferrer(address, bool)` (event `ReferrerSet(address indexed referrer, bool approved)`)
  is callable by the **protocol recipient** only — not the quote admin: a referrer is paid out of
  the protocol's share, so the party that gives the money up decides, and the role follows
  `proposeProtocolRecipient`/`acceptProtocolRecipient` (tested). It refuses `address(0)`.
- **An unapproved non-zero referrer is treated as none, never a revert** — a stale or mistyped
  referral must not block somebody's launch. It is announced: `ReferralIgnored(token, referrer)`.
  A counted one: `Referred(address indexed token, address indexed referrer)`, before `Launched`.
- **Recorded for good, in a separate mapping** `referrerOf(token)` — `launches(token)`'s ABI is
  unchanged, so every v1/v2/v3 reader of it still decodes. No function changes a recorded referrer.
- **Removal stops NEW referrals only.** `setReferrer(r, false)` means later launches naming `r` are
  recorded with none; launches already recorded keep paying `r`, because `collect` never reads the
  list. It is the simplest honest rule: what a coin pays was fixed, publicly, when it launched.
- **A creator may name themselves** — only if approved, like anyone else (tested both ways).
- **The split.** With a referrer: creator `amount × 8000 / 10000`, referrer `amount × 500 / 10000`,
  protocol the REMAINDER (≈15%, plus at most a couple of wei of rounding) — no wei is lost (fuzzed to
  the wei). Without: 80 / 20 exactly as before. Both currencies. A referrer whose payout is refused
  (a contract that rejects ETH, a quote's transfer policy) is kept in `owed` for `withdraw(currency)`,
  exactly like the creator; everyone else is still paid.
- **The hook is unaffected** — it sets the LP fee and nothing else, so the opening window's fees
  (the sniper's 50%) are split 80 / 5 / 15 like any other (tested).

**Events.** `Launched` keeps v1/v2's exact signature (`Launched(address,address,bytes32,uint256,uint256)`
— topic0, the indexed token, creator and poolId all in the same places, tested), so one log reader still
serves every factory. New: `LaunchFee(address indexed token, uint24 fee)`, emitted just before it.

### Measured

- **Tests:** 59 in `test/LaunchFactoryV3.t.sol` (v2's 30 ported, plus the fee and the hook; 12 for
  referrals added 2026-10-22: only the protocol recipient approves, and it follows a handover; an
  approved referrer is recorded and `Referred` precedes the unchanged `Launched`; an unapproved one
  is none with `ReferralIgnored`; a self-referral only when approved; removal keeps paying recorded
  coins and stops new ones; 80/5/remainder on ETH and in the coin, on a stock pair on either side, in
  the opening window; a fuzzed split to the wei; a refused ETH payout and a refused asset payout →
  `owed` → `withdraw`), against the
  real B20 precompile and a real v4 PoolManager, the hook at a mined address exactly as on mainnet:
  fee at 0 s = 50%, at half the window exactly halfway (a 20 s window: 25.5% at 10 s), every second of
  the default window on the line, the chosen fee from `window` on; the launcher's first buy paying 1%
  / 3% (ETH and a stock) in a block where anyone else pays 50%; a pool the factory did not open
  refused (including the coin's own predicted key); other liquidity refused in the window and
  removable after; 1% and 3% both work, every other fee reverts; and a STRUCTURAL check that the
  factory reaches `modifyLiquidity` exactly twice (the supply in, a zero poke) and the hook never calls
  the pool manager (needs `fs_permissions` read on `./src`, in foundry.toml). Three mutants of the hook
  — no first-buy exemption, no factory check at initialize, no decay — each fail named tests.
  `npm run gate:contracts`: 89 tests (30 v2 + 59 v3), 100% lines/functions/branches of all three files
  in `src/` (2026-10-22; 77 = 30 + 47 before referrals). 119 over four files since RevenueShare (2026-10-28).
- **Mainnet simulation** (`scripts/simulate-launchpad-v3.ts`, hand-run, 2026-10-14): one
  `eth_simulateV1` call, three blocks (the fee depends on the block's time, so the clock must move):
  deploy v3 (hook salt mined in the script) → launch a 1% and a 3% coin with 0.01 ETH first buys →
  collect: **1.000% and 3.000%** → at T+1 s a sniper buys 0.1 ETH of the 1% coin → collect:
  **46.733%** (0.0467333 ETH) → at T+20 s 0.1 ETH buys of each → **1.000% and 3.000%**. The sniper got
  10.55M tokens for 0.1 ETH; the buyer at T+20 s 19.03M for the same 0.1 ETH.
  **Referrals, re-run 2026-10-22 (Base block 52,928,096):** the treasury approves a keyless referrer,
  the app's own `launchTx(…, referrer)` launches a referred 1% coin, `referrerOf` reads it back, and
  two collections pay, read from the ETH transfers out of the factory:
  `99999999999999 wei → creator 79999999999999 · referrer 4999999999999 · protocol 15000000000001` and
  `999999999999999 wei → creator 799999999999999 · referrer 49999999999999 · protocol 150000000000001`
  — each summing to what was collected, to the wei, EXACTLY 80 / 5 / the remainder.
- **Gas, mainnet state, same block:** launch with a 0.01 ETH first buy — v2 631,478, v3 685,443
  (+53,965, +8.5%: the hook's schedule slot, four calls into it — register, initialize, add liquidity, the first buy — and the extra event). A 0.1 ETH buy through
  a router — v2 121,207, v3 129,358 (+8.2k a swap, the `beforeSwap` call). Deploy: v3 + hook
  3,644,963 (v2: 2,918,088). Runtime size: factory 13,251 B, hook 2,691 B.
  **With referrals (2026-10-22, same script):** a launch naming no referrer 796,014 (+353 over the
  795,661 measured just before the change, same block), a referred launch 822,036 (+26.4k: the
  `referrerOf` slot and `Referred`); `collect` with no referrer +2,274 (114,278 → 116,552: one cold
  `referrerOf` read), a referred collect 128,403 (a third payout), 170,503 the first time (the
  referrer's account cold). Deploy v3 + hook 3,805,361. Runtime: factory 13,992 B (+741), under 24,576.

### Deploying v3 — the owner's step, with the owner's key

Same shape as v2's below: read `script/DeployLaunchFactoryV3.s.sol` first. It is ONE transaction
(the factory deploys the hook). The script mines the salt for the deploying wallet's next CREATE
address AT THE TIME IT RUNS (so the dry run's salt may differ from the broadcast's — that is fine),
and refuses to finish if the factory or the hook landed elsewhere. Do not send anything else from
the keystore while the script is broadcasting: the nonce would move, and the deploy would revert
(`HookAddressNotValid`), never mis-deploy. MEASURED 2026-10-14, dry run on mainnet state from forge's default sender:
the hook mined at salt 0x1838 → `0x7eF9…2880`, ≈ 4.74M gas for the script (≈ 0.00005 ETH at
0.0107 gwei).

```
cd contracts
# 1. dry run
base-forge script script/DeployLaunchFactoryV3.s.sol --rpc-url https://mainnet.base.org --account quadra-deployer
# 2. deploy and verify (the hook is verified as a contract created by the factory)
base-forge script script/DeployLaunchFactoryV3.s.sol --rpc-url https://mainnet.base.org \
  --account quadra-deployer --broadcast --verify --verifier blockscout \
  --verifier-url https://base.blockscout.com/api/
# 3. from the repo root: today's opening ticks for the stocks, then run the setQuote lines it prints
#    (setQuote is v2's, unchanged; the ticks serve 1% and 3% coins alike)
npx vite-node scripts/quote-ticks.ts <v3 factory address>
```

Then read back before pointing the app at it: `hook()` and its `factory()` (= the factory),
`startFee()` = 500000, `window()` = 15, the hook address ending in bits `0x2880`, `FEE_LOW` /
`FEE_HIGH`, `REFERRER_SHARE_BPS` = 500, `quotes(0x0…0)` = (true, 191200), `protocolRecipient` =
treasury, and no referrer approved. The app checks the same numbers (`LAUNCHPAD_V3_EXPECTS`) before
offering a launch.

**Approving a referrer — the owner's step, from the TREASURY wallet** (the protocol recipient, not
the deployer): once ShunTr supplies Blue Agent's referrer address — never guessed or hard-coded here:

```
cast send <v3 factory address> "setReferrer(address,bool)" <Blue Agent address> true \
  --rpc-url https://mainnet.base.org --account <the treasury's keystore>
cast call <v3 factory address> "approvedReferrers(address)(bool)" <Blue Agent address> --rpc-url https://mainnet.base.org
```

(The treasury `0xD5C1…3FAB` is a wallet with an EIP-7702 delegation; sending from it through its
own wallet app works the same — the call is `setReferrer(<address>, true)`.) Removing:
`setReferrer(<address>, false)` — coins already referred keep paying it.

⚠️ v3 is not audited either, and it adds the first hook this launchpad has used.

## Deploying v2 — the owner's step, with the owner's key

This repo holds no key and deploys nothing. Read `script/DeployLaunchFactory.s.sol` first (it
checks the chain and the PoolManager before spending gas). The deploying wallet becomes the quote
admin, so use the same keystore for step 3.

```
cd contracts
# 1. dry run
base-forge script script/DeployLaunchFactory.s.sol --rpc-url https://mainnet.base.org --account quadra-deployer
# 2. deploy and verify
base-forge script script/DeployLaunchFactory.s.sol --rpc-url https://mainnet.base.org \
  --account quadra-deployer --broadcast --verify --verifier blockscout \
  --verifier-url https://base.blockscout.com/api/
# 3. from the repo root: today's opening ticks, then run the setQuote lines it prints
npx vite-node scripts/quote-ticks.ts <factory address>
```

Then put the address in `CONTRACTS.launchFactory` (src/config/chain.ts) only after checking it on
Blockscout — the Launch window refuses to send to anything else (hard rule 1), and it reads every
number it relies on back from the factory before each launch.

⚠️ Not audited. It is small (≈ 425 lines), uses no hook and no upgrade path, and its tests and the
mainnet simulation pass — none of which is an audit. It will hold the liquidity of every token
launched through it, permanently.

## RevenueShare — opt-in fee sharing with stakers (PROPOSAL, NOT deployed, NOT audited)

Built 2026-10-28 for Blue Agent's "tokenize your agent" flow, and **waiting on the owner's yes**
before anything is deployed. `src/RevenueShare.sol`: `RevenueShare` (one per coin) and
`RevenueShareDeployer` (deploys one at a predictable address and announces it). It changes nothing
in the launchpad: it is just an address a coin's creator recipient may hand the launcher's 80% to,
with v3's (and v2's) existing `setCreatorRecipient`.

**What it does.** Whatever the launchpad pays it — only in the pool's two currencies, the coin and
its quote (ETH, or a stock with 8 decimals) — is split once, at a share fixed at deployment:
`agentBps` (0 to 90%) to the `agent` address, the rest to the people who **stake the coin** in it,
pro rata to stake × time. Stakers claim both currencies whenever they like; the agent's share is
paid by `payAgent()`, which anyone may call. `harvest()` calls the launchpad's public `collect`
and accounts for what came.

**Why staking, not "every holder".** Holder accounting on plain balances is impossible here, and
the alternatives were weighed:

| Option | Verdict |
|---|---|
| Pro rata over balances, via a transfer hook | **Impossible**: the coin is a B20 with no admin; nothing runs on its transfers and nothing can be added. |
| Snapshot + Merkle root posted per period | Needs an operator who computes and posts the root — a party everyone must trust with the money, i.e. an owner power. Also pays the pool itself (PoolManager holds most of the supply) unless the operator filters, which is more trust. Rejected. |
| A wrapped, transfer-hooked version of the coin | Splits liquidity between the coin and its wrapper; the pool trades the coin, so the wrapper has no market. Rejected. |
| **Stake-to-earn vault (built)** | Exact, on-chain, no operator. Cost: a holder must stake (one approve + stake, or one `stakeWithPermit`), and a staked coin is not in the wallet — it can be unstaked any second, with no lock and no fee. |

**Why a stream.** `collect` is public, so with an instant split anyone could stake a large amount,
call `collect`, claim and unstake in one transaction and take most of the fees accrued since the
last collect. Each arrival is released in a straight line over `STREAM` (7 days); a new arrival
re-spreads everything still unreleased over a fresh 7 days. A stake earns only for the seconds it
is staked — tested: a stake made around a `collect` and withdrawn in the same second earns 0.
While nobody is staked the stream PAUSES (its end moves with the clock), so nothing is released
into nothing; the first stakers receive it as it runs.

**Accounting by balance.** The launchpad pushes (ETH by call, a token by `transfer`) and nothing
tells the receiver. Every entry point compares each currency's balance with what is accounted
(stakes included, for the coin); the difference is an arrival. A gift counts the same way.

**What it guarantees** (each a test in `test/RevenueShare.t.sol`):
- no owner, no admin, no upgrade, no pause, no sweep; `agent` and `agentBps` are immutable;
- once a coin's creator recipient is set to it, the launcher's share is there FOR GOOD — the
  contract has no function that calls `setCreatorRecipient`, and the launchpad lets only the
  current recipient change it;
- a refused payout (a recipient that refuses ETH, a stock whose policy refuses the receiver, a
  re-entering recipient) stays credited to whoever was owed, and the other currency is still paid;
  `claim(to)` lets a staker name another receiver; one refusal never blocks anyone else;
- if the launchpad itself could not push to it (a quote's policy refused the contract), the
  launchpad keeps it as `owed` and anyone can `pullOwed(currency)` it in;
- a balance taken FROM it (a stock issuer's seizure) does not brick it: nothing new is counted,
  and what it can no longer cover is refused at the claim and stays credited;
- solvency and dust, fuzzed (512 runs × 40 random steps of stake/unstake/gift/claim/wait across
  three stakers): after every step the contract holds at least what it owes in both currencies;
  it never pays out more than arrived; once the stream has run out, what stays behind is rounding
  dust (≤ a wei per bookkeeping step). Two more fuzzes: payment in proportion to stake (±2 wei),
  and a late joiner earning exactly its share of the time left (±3 wei).

**What it cannot do — say these plainly wherever it is offered:**
- **Holders who do not stake get nothing.** "Holders" in any wording means "stakers".
- It shares only the LAUNCHER's 80%. The protocol's share and a referrer's 5% are untouched.
- It cannot be undone. Once pointed at it, the launcher's share cannot be taken back — by the
  launcher, the agent, Quadra or anyone. An agent that later wants its income back cannot have it.
- It does not guarantee any income: fees exist only while people trade the coin, and they are paid
  in the coin and its quote, whose prices move. Nothing is converted to a stable value.
- Fees reach stakers over 7 days, and frequent arrivals (or 1-wei gifts) re-spread the unreleased
  remainder each time, which slows the tail — it never loses it.
- Rounding dust (a few wei per operation) stays in the contract forever; there is deliberately no
  function that could move it.
- Fee-on-transfer or rebasing quotes are not supported (the launchpad enables none; Coinbase stocks
  are neither). A stock's issuer CAN seize from the contract; that loss falls on the stakers owed it.
- It does not work with launchpad v1 (v1's `owedEth`/`withdraw()` differ); v2 and v3 share the ABI.
  One deployer is bound to ONE launchpad (v3 in the deploy script).

**Measured on mainnet state** (`scripts/simulate-revenue-share.ts`, hand-run, 2026-10-28, pinned on
Base block 53,191,842): one `eth_simulateV1` call against the DEPLOYED v3 (`0x006D…1377`, its real
hook), the real PoolManager, Universal Router, Permit2 and Coinbase's real NVDAc with its real
transfer policies — keyless addresses, nothing sent. The deployer deployed (2.00M gas); the app's own
`launchTx` launched a 1% ETH coin (0.01 ETH first buy, Blue Agent's referrer — `referrerOf` read it
back, approved on chain) and a 1% NVDAc coin; `create` (1.56M gas each) → `setCreatorRecipient` →
`isActive` true for both. 30 s later a trader bought each coin (0.5 ETH; 2.892 NVDAc bought through
Relay) and sold 5,000,000 of the ETH coin through the app's `buildSwap` + Permit2; the launcher staked
the ETH coin, the trader the NVDAc coin; `harvest` both. Results:
- every arrival was exactly the launcher's 80% of what `collect` took — ETH 4,079,999,999,999,999 wei
  of 5,099,999,999,999,999 (and traceTransfers shows the same ETH pushed to the share), the coin
  40,000 of 50,000, NVDAc 2,313,875 of 2,892,344 units (8 decimals);
- **NVDAc's transfer policies accepted the share contract both ways**: the launchpad's push arrived
  (`owed(share, NVDAc)` = 0), and the share paid NVDAc to the staker and to the agent (`paid = true`),
  leaving 0 NVDAc behind;
- the agent got exactly 20% of each arrival, in all three currencies;
- `claimable` was 0 / 0 in the harvest's second, exactly half at +STREAM/2 (1,632,000,000,000,000
  wei and 16,000 coins; 925,550 NVDAc units), and at +STREAM the only staker claimed exactly the
  stakers' 80% in each currency, **0 wei left behind**; both unstakes returned the stakes.

**Gas** (from `base-forge test --gas-report`, medians): `stake` ~115k, `stakeWithPermit` ~175k,
`unstake` ~94k, `claim` ~84k (both currencies), `harvest` ~263k (includes the launchpad's
`collect`), `payAgent` ~91k, `sync` ~53k.

**Securities-sensitive — for the owner.** A token whose holders receive a share of an activity's
income can be read as an investment contract in some jurisdictions. Wording that is safe to show:
"Stake ACAT to receive a share of the trading fees this coin's pool earns, while staked. Fees vary
and may be zero; they are paid in ACAT and ETH, whose prices change. This is not an investment
product and no return is promised. Unstake at any time." Never "earn yield", "APY", "dividends",
"passive income" or a projected return; never a dollar figure for the future. The owner decides
whether Quadra offers this at all, and in which countries — this repo does not decide that.

### Deploying — only after the owner's explicit approval

```
cd contracts
base-forge script script/DeployRevenueShareDeployer.s.sol --rpc-url https://mainnet.base.org   # dry run
base-forge script script/DeployRevenueShareDeployer.s.sol --rpc-url https://mainnet.base.org \
  --account <your keystore> --broadcast --verify --verifier sourcify
```

The deployer has no owner; after it, every coin's share contract is created by whoever sets one up.
Blue Agent's integration: `REVENUE_SHARE_INTEGRATION.md`.
