# CLAUDE.md — Quadra

An on-chain supercomputer for Base 8453: look up any token or wallet, scan for traps before
you act, then send, swap or launch a coin — every action signed in the user's
own wallet, no key ever held here. Named after the 1991 Macintosh Quadra and dressed like
the software of that era. One page, Mac OS 8 "Platinum" chrome (since 2026-10-22; Windows XP before), `?do=<id>` opens a window, and every
skill is also a line in the Terminal. It reads BlueAgent's x402 catalog as **one directory
of tools to spend on** — not a platform it is built on — and it is a separate product in a
separate repo and must stay that way.

---

## Standing constraints from the owner

These came from ShunTr directly. They are not preferences.

- **Separate repo. Never build it inside `blue-agent`.** The two live side by side at
  `~/projects/quadra` and `~/projects/blue-agent`. Do not edit anything in `blue-agent` on
  Quadra's behalf — not its config, not its `.claude/launch.json`, nothing. If a tool needs
  a file over there to work, use a different tool.
- **Launching (owner, 2026-11-04: "Commit + push, đồng thời bắt đầu T3").** The app deploys on
  **Vercel** from the PRIVATE repo `madebyshun/quadra` (the repo stays private — Vercel reads it;
  do not make it public, do not publish to npm). A domain, an announcement and the public launch are
  the owner's steps, never taken from here. Until then it was: "Not public yet".
- **100% tested before launch.** `npm run gate` must be green, and coverage thresholds are
  pinned at 100% for statements, branches, functions and lines. A drop fails the run.
- **Perfect it locally first.** Nothing deploys until the product is finished and tested.
- **Do not commit unless asked.** The owner decides when work lands.
- **The position, decided 2026-09-30: an on-chain supercomputer for Base.** It REPLACES the
  2026-09-29 position ("private money for AI agents"): the privacy model — shielded pool,
  notes, private send, `router` — is dropped and archived under `archive/privacy/`, not
  deleted. The phases (P0 foundation → P1 read skills → P2 send/swap/revoke/bridge → P3
  launch, now this app's own launchpad → P4 agents) and what was decided with them are at the top of `TASKS.md` ("The
  direction") — read that before choosing what to build. Concretely: the server is
  **Vercel**; **launch is always public — through this app's own launchpad on Base, paired
  with ETH or a Coinbase stock; o1 was taken OUT of Launch on 2026-10-02 and archived under
  `archive/o1/`**; every fee is off while `CONTRACTS.treasury` is `null`;
  `audit`, `hooks` and `inference` are switched off; `$QUADRA` is postponed (T9) — still, the owner
  2026-10-14: "$QUADRA để sau".
- **Build it complete locally, feature by feature; the owner tests each one before anything
  goes to production** (2026-09-30).
- **Base first, Robinhood Chain after** (2026-10-02): Robinhood Chain is HIDDEN, not deleted —
  `FLAGS.robinhood = false` hides the Bridge window (desktop and Start menu; `?do=bridge` still
  resolves, to an off window) and the Robinhood Chain half of Markets (a watchlist's Robinhood
  entries stay saved, never shown or fetched; an edit keeps them). The tagline, the blurb,
  `index.html` and Docs no longer offer it. Turning it back on is that one line; `tests/switched-off.test.tsx`
  opens Bridge with it on, and `tests/markets.test.tsx` keeps the Robinhood half tested with it on.

---

## The gate

From the repo root:

```
npm run gate
```

That is `tsc --noEmit` → `vitest run --coverage` → `tsc --noEmit && vite build`. All three,
in one go. Do not report "done" on a subset. **2244 tests in 124 files**, 100% on all four metrics, measured 2026-11-12 after the share cards were redrawn (panels/cardKit.tsx: halftone sky, small windows, a selected italic lead line); 2243 earlier that day after Trade Depth's share card (panels/DepthShare.tsx) and Coinbase-stock tickers (`tokenFrom`: looked up in Coinbase's own list, the address shown); 2235/123 earlier that day after the post-push review (Trade Depth reads Relay's "impact is too high" refusal as a red measurement — MEASURED on PDDc, it had let the headline say no size moved the price past 2%); 2233 earlier that day after Collateral Watch read Morpho's five stock markets (config/collateral.ts MORPHO_STOCK_MARKETS); 2229 earlier that day after the Weekend window (Blue Agent's scorecard + diary through server/weekend.ts, lib/weekend.ts, panels/WeekendPanel.tsx; FLAGS.weekend); 2216/122 earlier that day after Trade Depth (skills/depth.ts — Relay at $1k/$10k/$100k each way, red past 2%; Trade's "Price impact" button); 2206/121 earlier that day after Collateral Watch (skills/collateral.ts, config/collateral.ts — Aave V4's MAG7 spoke, read back on chain); 2191/120 on 2026-11-11 after Base's 0.2 s blocks were read through one block clock (skills/blocktime.ts); 2187/119 on 2026-11-04 after the share card's tiles, logo route (server/logo.ts, api/logo), QR and red high-risk card; 2182 after the Token Verdict share card and its pinned lines (panels/VerdictShare.tsx); 2175 after the fee flow became an animated Platinum diagram (pages/Flywheel.tsx); 2174 after the About page (/about, live figures from the index and the furnace), the intro's loading steps and room (intro/room.ts), the shorter Welcome and `CONTRACTS.token` set to $QUADRA; 2167 after Home closed every window and cleared the URL (and the desktop's name became a way home); 2165 after the paid API sold its first 402 on Vercel (the owner's CDP key; `asSent` drops Vercel's `...path` parameter) and the index caught up (block 53,495,204: 10 coins, 3 creators, 20 trades); 2164 after the indexer took BASE_RPC_URL (the first Vercel deploy's index stopped at block 52,096,272 on a public 429); 2162 after a Blob store connected through OIDC (BLOB_STORE_ID, no token) was accepted; 2161 after the stored indexer and the Mac names (no `.exe`, "Read Me"); 2151 after the Vercel functions (T3: src/server/vercel.ts, api/ generated, vercel.json); 2147/113 on 2026-10-29 after the menu bar's Home button (2145 after the coin page's furnace block (lib/furnace.ts — Harvest for anyone, Buy back & burn for the furnace's treasury only; `shareOf` now treats a contract that refuses `agent()` as not a share)); 2136/112 after Relay's v3.2 pair was pinned beside v3 (Relay moved 2026-10-26; config/routes.ts RELAY_PAIRS); 2135 after RevenueShareDeployer was deployed and wired (2134 after the six launchpad additions (Pay with ETH for a stock-paired coin, every page of Coinbase's stocks, a share card, Verdict badges on Coins, where the 80% goes, staking into a RevenueShare)); 2104/107 after Coinbase's stock list began to be read past its first page (2101 after the simplification (one door per job: Check / Coins / Launch / Wallet on the desktop, the coin page trading through its own pool only, Token Verdict simulating a launchpad coin on its own pool)); 2085/105 measured 2026-10-28 after the Relay no-route fallback's missing branches were tested (2082 at the fallback's commit, which had left `relay.ts` and `SwapPanel.tsx` below 100% — the gate was red); 2081 measured 2026-10-22 after Explore Base, the coin page's CA, the compact small-number format and the Mac OS 8 "Platinum" redesign (2049/102 earlier that day, after v3's approved referrers reached the app, and re-measured the same day after v3's deploy, when v2-fixture test files were pinned to `launchFactoryV3: null` (`tests/v2only.ts`); 2041/102 earlier that day, after the desktop was reorganised into folders; 2017/101 on 2026-10-21, with the Base card program (`card`) and the Welcome screen in the tree; 1971/97 earlier that day, after the coin chart's frames and opening price; 1968/97 earlier that day, after the app was wired to launchpad v3; 1945/96 on 2026-10-14; 1918/95 before the coin page, same day) (1684/76 on 2026-10-02, before the "more fun" programs, the wallet's fees,
pool trading, the indexer and launchpad recognition; 1682/76 before the doc audit's fixes) — it FELL from 1627/68 the same day, deliberately: o1 was taken out
of Launch and `tests/launch.test.tsx` went with it to `archive/o1/` (1608/67 before the verdict, radar and Launch window read the
launchpad; 1585/66 before the launchpad's window; 1548/60 on 2026-10-01 before the 3D intro; 1547/59 on 2026-09-30, before the seven basic skills were deleted
and Token Verdict and Launch Radar replaced them; it was 1147/43 earlier the same day, before send, swap, bridge,
launch and the multi-wallet picker landed; 1391/51 before Markets went Base-first, the wallet's
asset list, measured swap arrivals and Launch's pairs; 1455/52 before Trade, DexScreener prices,
cached charts and simulating every transaction before it is sent; 1487/53 before the paid API,
the CDP facilitator, the x402 window's own-tools mode and the skills as MCP tools). ⚠️ It FELL from 1353/45 that day, deliberately: the privacy
model was archived and its eight test files went with it to `archive/privacy/tests/`
(`field`, `hash`, `note`, `tree`, `transaction`, `backup`, `download`, `balance`, and most of
`adapters`), along with the Send/Swap/Bridge panel tests. It grew back with the skills
(`skills-core`, `skills-sources`, `skills-names`, `skills-ui`, and since 2026-10-01 `verdict`
and `radar` in place of `skills-reports`). A drop you
cannot account for like that is still the checkout, not your change.

That count is a dated measurement, not a target — it is here so a fresh clone that comes
back with *fewer* tests tells you something is wrong with the checkout rather than with
your change. It had drifted to 473/16 in this file and in `TASKS.md` before being
re-measured, which is the ordinary way a written-down number goes stale: the suite grew
and nobody re-ran the count. **If you add tests, re-measure both files in the same
commit.**

**The Solidity gate is back, for the launchpad (2026-10-02):** `npm run gate:contracts` =
`base-forge build` → `base-forge test` → `scripts/check-contract-coverage.ts` (100% of
`contracts/src`, or it fails — `forge coverage` has no `--fail-under`). It needs **Base Foundry**
(`base-foundryup --install v1.1.1`), because stock Foundry cannot reach the B20 precompile; it is
not part of `npm run gate`, which must run on a bare clone. 119 tests (v2 30 + v3 59 + RevenueShare 30), 100% over 4
files in `contracts/src` (`LaunchFactory.sol` v2, `LaunchFactoryV3.sol`, `LaunchHook.sol`, `RevenueShare.sol`), measured 2026-10-28
with RevenueShare (a PROPOSAL for Blue Agent — NOT deployed, waiting on the owner; contracts/README.md "RevenueShare") (89 = 30 + 59 on 2026-10-22
with v3's approved referrers; 77 = 30 + 47 on 2026-10-14; 30 tests, 1 contract on 2026-10-02; 21 for v1, whose exact source is in `contracts/deployed/`). Run it whenever `contracts/` changes. The shielded pool's Foundry project stays in
`archive/privacy/`; the Foundry lessons below apply to the launchpad.

Dev server is `npm run dev` on **port 5273**.

---

## Rules that exist because something broke

- **jsdom has no layout, so the suite cannot see a visual bug.** 473 green tests missed three
  real defects at once: a `.dim` rule overriding `.shell__hint` (invisible text), a
  `max-height` on a shared `.notes` class slicing a row through the middle of the glyphs, and
  `word-break: break-all` rendering prose as "nothing here will mo / ve money". A class name
  being present in the DOM is not evidence it rendered. **Look at it in a real renderer.**
  Headless Chrome does this with no new dependency:
  ```
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
    --screenshot=/tmp/shot.png --window-size=1120,640 "http://localhost:5273/?do=mcp"
  ```
  Shoot at a small window size — a large one comes back downscaled past the point of reading
  text. Write the PNGs outside the repo.
- 🔴 **A screenshot shows you a panel is ugly; only a number shows you its button is off
  screen.** MEASURED 2026-09-29: the money-form rebuild left Send at `scrollHeight` 601 in a
  `.win__body` of `clientHeight` 449 — the Send button 152px below the fold, in a window whose
  entire purpose is that button — and **1238 green tests plus a clean `tsc` saw none of it**.
  The PNG did not say it either, because a cropped screenshot of a scrollable box looks like a
  panel that simply continues. Assert the pair instead:
  `body.scrollHeight - body.clientHeight` and
  `cta.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom`.
  Do that for **every** panel you touched, not the one you were editing — the same CSS change
  moved Swap by 69px and Bridge by 88. Driving Chrome over CDP (`--remote-debugging-port`,
  poll `/json/list`, `Runtime.evaluate`) gets these numbers without a new dependency, and is
  the fallback when the preview MCP is unresponsive.
  The fix order that worked, cheapest first: trim padding and font-size, then delete a row by
  folding its content into a neighbour (the standalone "Network / Base" row cost 38px and says
  the same thing as "USDC on Base"), and only then raise `DEFAULT_HEIGHT`. Raising it first
  hides a panel that is simply too tall, and hard rule 2 means the chain can be *moved* but
  never dropped.
- 🔴 **`--window-size` below ~500px does NOT narrow the layout — it crops the PNG.** MEASURED
  2026-09-27: `--window-size=390,300` reports `innerWidth=500`. Chrome clamps the headless
  viewport to a minimum and the screenshot is a 390px-wide crop of a 500px-wide render, so
  every element looks sliced off at the right edge. **This produced an entire fictional bug** —
  "the document overflows the viewport at 390px on / and /api" was written into this file and
  into TASKS.md as a measured finding, and it was the measuring tool the whole time.
  To render narrow for real, put the app in an **iframe of the width you want** and screenshot
  the parent at a legal size; an iframe gets a true layout viewport equal to its element size.
  Check `documentElement.scrollWidth` against `clientWidth` inside it rather than eyeballing
  a PNG — the number is the evidence, the picture is not.
  **The general lesson is the expensive one: when a tool and an assertion disagree, suspect the
  tool before writing down the finding.** A wrong measurement recorded as fact costs more than
  no measurement, because the next reader spends their time chasing it instead of building.
- 🔴 **A protocol rule measured against one server is a sample of one.** MEASURED 2026-09-29:
  `lib/requirements.ts` refused any 402 offering more than one way to pay, and read the
  requirements from the JSON body — both true of BlueAgent, the only server it had met. Against
  servers listed on Coinbase's Bazaar, both were wrong: the x402 v2 transport puts the
  requirements in a base64 `PAYMENT-REQUIRED` header with `{}` as the body, and real servers
  offer several ways to pay (EIP-3009, permit2, Solana). The rule is now "exactly one SIGNABLE
  offer" and the header is read first. **Before generalising a parser, measure three servers
  that were not the one it was written against** — `curl -D -` against Bazaar entries costs
  nothing and would have caught both.
- **CSS cascade order beats intent at equal specificity.** `.dim` was declared after
  `.shell__hint` and silently won. Check where a rule sits, not just what it says.
- **A shared class sized for one panel breaks another.** `max-height` belongs on a modifier
  (`.notes--scroll`) applied to the one list a user can grow, not on every list that wants a
  sunken box.
- 🔴 **A modifier that only ever appears inside a compound selector must MATCH that selector's
  specificity, or it does nothing and says nothing.** MEASURED 2026-09-28: `.field--short`
  (0,1,0) lost to `.group__row--actions .field` (0,2,0), so the deposit box rendered full
  width no matter where in the file the modifier sat — this is not the cascade-order rule
  above, moving it later does not help. The fix is `.group__row--actions .field--short`. The
  tell is a modifier that *looks* ignored rather than wrong; count the selector before
  reordering anything.
- 🔴 **`filter` cannot express "disabled", because it moves the label and the background it
  sits on by the same amount.** MEASURED 2026-09-28: `.gel:disabled` was `grayscale(1)
  brightness(1.15)` with `color: var(--xp-ink-dim)`; greyscaling the blue gradient lands on
  ~#9b9b9b and lifting it gives ~#b3b3b3, while the dim ink greyscales to ~#7b7b7b — about
  1.6:1, which is a blank lozenge, not a contrast. **It survived because `.gel--quiet` is
  already light**, so the quiet disabled buttons in the same row stayed perfectly readable
  and the row read as a deliberate style rather than a bug. jsdom cannot see this (no
  layout, no computed colour) and 1232 green tests did not. A disabled control gets its own
  flat palette.
- **A JSX ternary branch in parentheses cannot hold a comment block plus an element.** Eight
  confusing `TS2657`/`TS1005`/`TS1382` errors come from exactly that. Put the note in the CSS
  or above the ternary.
- 🔴 **Foundry's `deny = "warnings"` belongs in `[profile.default]`. Put it under `[lint]` and
  it silently turns itself OFF.** MEASURED 2026-09-27: forge accepts the key there, prints one
  line about an unknown config key, and resolves `deny` back to `"never"`. The build then goes
  green *because the strictness is gone* — which is the same observable result as a clean
  build, and reads as success. **Verify with `forge config | grep deny`, never by whether the
  build passed.** (`[lint]` is where it looks like it belongs, which is why this happened; the
  deprecated spelling `deny_warnings = true` works but warns on every invocation, training the
  reader to skim warnings in the one project that has decided warnings are errors.)
- 🔴 **A glob that matches nothing is indistinguishable from one that works.** `[lint] ignore =
  ["test/**"]` in `foundry.toml` matches **no files at all** — `test/*` covers the top level
  only and `test/**/*` is what reaches `test/doubles/`, so both entries are required. Measured
  by appending a deliberately bad cast to a file in `test/doubles/` and counting warnings under
  each pattern: `test/*` alone left 3 lines, the pair left 0. **Whenever you narrow or widen an
  ignore list, plant a violation you expect it to swallow and confirm the count goes to zero.**
  Do not infer coverage of an exemption from a clean build — that is the same mistake as the
  `deny` one above, and both times the wrong answer looked exactly like the right one.
- **`vm.expectRevert` binds to the next *external call*, not the next statement.** Any view call
  made while building arguments consumes the expectation, and the failure message — "next call
  did not revert as expected" — points at the wrong call entirely. This produced 12 simultaneous
  failures in one run from a single cause: the `_args()` test helper calls `pool.getLastRoot()`.
  Hoist all argument construction above the `expectRevert`.
- **A `view` interface cannot be instrumented, and that is usually correct.** `IVerifier.verifyProof`
  is `view`, so no implementation can record what it was called with — a recording double is
  impossible to write. The fix is to invert it: `ExpectingVerifier` takes the expected vector
  through a separate non-view `expect()` and returns whether the call matches. Worth noticing
  that the restriction is a feature — a verifier that could record could also return a different
  answer for the same proof depending on what it had seen before.
- 🔴 **`new URL(relative, import.meta.url)` does NOT resolve against the file. Vite rewrites it.**
  MEASURED 2026-09-27 while making `tests/field.test.ts` read the Solidity: that exact expression is
  Vite's static-asset reference pattern, so it was transformed into
  `http://localhost:3000/contracts/src/ShieldedPool.sol` — resolved against the dev server. The
  giveaway is an `ENOENT` for `/contracts/src/…` with the project directory missing from the front,
  which reads as a bad relative path and sends you editing the `../`. `import.meta.url` itself is
  correct; it is the wrapper that vanishes. Use
  `resolve(dirname(fileURLToPath(import.meta.url)), "..")` — a plain call is not rewritten.
- 🔴 **A spy that delegates to the original `crypto.getRandomValues` RE-ENTERS ITSELF, so it cannot
  count calls.** MEASURED 2026-09-27: `const real = crypto.getRandomValues.bind(crypto)` captured
  before `vi.spyOn`, then `return real(buf)` from inside `mockImplementation`, counted **5** calls
  for a single `randomFieldElement()` that drew once. The control — a mock that never delegates —
  counted exactly 1. The danger is not the wrong number, it is that the number is plausible: a
  rejection-sampling test asserting "it drew twice" would have been written around whatever the spy
  happened to report and would have passed while measuring nothing. Script every draw instead; see
  `withScriptedBytes` in `tests/field.test.ts`.
- 🔴 **A pinned output vector cannot catch a defect that is dormant at today's values.**
  MEASURED 2026-09-28. `STORE_KEY` and the hash domain tag were both unpinned — every test
  imported the constant it was checking, so either could change and stay green. The intuitive
  fix is to assert the output: a checked-in hash vector, the key's literal value. Then
  templating the tag from `BRAND.slug` was applied and **all 722 tests passed**, because
  `BRAND.slug` is `"quadra"` today, so the template expands to a byte-identical string and
  nothing observable moves. The bug detonates at the rename — a commit later, in a different
  file, as "every note is unspendable". **When a mutation is a no-op at current values, no
  behavioural test can see it; check its shape instead.** The guard is textual and lives in
  `tests/brand.test.ts`. Keep the vectors anyway: an endianness flip in the same file is
  caught by those three tests and nothing else, with 727 green.
- **Renaming: the line is prose vs identifier, not brand vs internal.** `brand.ts` used to
  claim nothing else hardcoded a brand string, which was false and invited the edit above —
  grep the slug, template what turns up. Four strings are identifiers in data that already
  exists and must keep their shipped value forever: today `PINS_KEY`, `SPEND_KEY`, `WALLET_KEY`
  and `WATCH_KEY` (`quadra.pins.v1`, `quadra.spend.v1`, `quadra.wallet.v1`, `quadra.watch.v1`), plus since 2026-10-14 `SOUND_KEY`, `Q_KEY` and
  `ACHIEVEMENTS_KEY` (`quadra.sound.v1`, `quadra.q.v1`, `quadra.achievements.v1`), and since 2026-10-22 `WALLPAPER_KEY`, `SAVER_KEY`, `SAVER_MINUTES_KEY` (`quadra.wallpaper.v1`, `quadra.saver.v1`, `quadra.saver-minutes.v1`); until 2026-09-30 also `STORE_KEY`, the hash domain tag,
  `BACKUP_FORMAT` and the empty-leaf preimage, archived with the pool. A name shown to a person may change; a name
  some byte on a disk or on chain is already keyed to may not. `backupFilename` is the
  counter-example — derived from the slug, because nothing reads it back.
- **A comment that quotes a forbidden pattern will trip a textual check on that pattern.** The
  frozen-string test above failed first on the two doc comments warning against the thing it
  forbids. Strip comments before checking — which also strengthens a presence check from "the
  literal is somewhere in the file" to "the literal is in the code".
- **A test may read a constant out of the Solidity** — and one did, until the privacy model was
  archived (it is in `archive/privacy/tests/` now; the lesson stands). `tests/field.test.ts` extracted
  `FIELD_SIZE` and `MAX_NOTE_VALUE` from `contracts/src/` rather than restating them, because a
  copied constant drifts silently and only disagrees where the two halves meet. Do not
  "simplify" such a test into a hard-coded number; the hard-coded number is the bug it exists to
  catch.
- 🔴 **A missing answer must never read as a negative one — and the tests have caught it twice.**
  MEASURED 2026-09-30 while the skills were tested against real captures: `deepest()` returned
  "no market" for a token whose only pool had no liquidity figure (a `reduce` from `null`
  comparing -1 with -1), and `summary()` compared `undefined` with `undefined` and wrote
  "unknown swapped …" about a transaction with no sender. Both passed every test written from
  the happy path. **When a field can be absent, write the test where it IS absent** — and
  render it as "not checked" / "unknown" in amber, never as a pass.
- 🔴 **"Has code" is not "is a contract" since EIP-7702.** MEASURED 2026-09-30 on the owner's own
  fee address: code `0xef0100 ‖ <delegate>`, 23 bytes, on Base and Robinhood Chain — an ordinary
  wallet with MetaMask's Smart Account turned on. The first Bridge refused it as "a smart-contract
  wallet", which would have locked out every MetaMask user with Smart Account on. Classify with
  `accountKind` (wallet / delegated / contract), never `code !== "0x"`.
- 🔴 **The test run must not read `.env` files.** MEASURED 2026-09-30: once the owner put a
  WalletConnect id in `.env.local`, Vitest loaded it and coverage changed with whose machine ran
  the gate. `vite.config.ts` points `envDir` at `tests/` in test mode; a test that needs a value
  stubs it.
- **`eth_requestAccounts` cannot switch accounts.** MEASURED by the owner 2026-09-30: once a site
  has an account, it answers at once with that account and shows nothing, so a second MetaMask
  account was unreachable. `chooseAccount` uses `wallet_requestPermissions` (EIP-2255), which opens
  the picker every time, and Disconnect calls `wallet_revokePermissions`.
- 🔴 **An issuer's own API is not an EIP-55 source.** MEASURED 2026-09-30: Coinbase's Tokenized
  Stocks API sends AMDc as `0xB200…0d8ce462E99ee7A47B` and BIRDc as `0xb200…535fE96f…` — mixed
  case that FAILS EIP-55 — and nine more all lowercase. The address door refused them the moment
  one was traded. `parseBaseStocks` keeps the hex and computes the checksum (the capitalisation
  asserts nothing). This is data, not a user's typing: the "never offer the recomputed checksum"
  rule is about a person's input, where the capitalisation IS the evidence. docs.base.org's own
  Earn page prints a Morpho vault address that fails EIP-55 too — copy addresses from the chain.
- 🔴 **Every transaction is simulated before the wallet sees it** (`simulate` in
  `lib/transact.ts`) — docs.base.org does it in every write example. A revert (a paused B20, a
  policy block) stops the send with the chain's words; it is asked about `SIMULATE_TRIES` times
  first, because the node may be a block behind an approval that just confirmed; an unreachable
  node is NOT a refusal. Test fakes answer it with `simulated()` from `tests/net.ts` (it carries
  a `from`, a read never does).
- **A fallback that can never fire is an uncovered branch that shows up only sometimes.** Two
  `?? "default"` guards in `MarketsProvider` made the gate read 99.94% on some runs and 100% on
  others. The fix was deleting them, not a test: a Robinhood stock's price is Robinhood's quote,
  full stop.
- 🔴 **A fixture typed from memory tests the parser against what somebody thought the service
  says.** The skills' fixtures are real responses, captured and trimmed, with the curl commands
  in `tests/fixtures/base/index.ts`. Blockscout names USDC "USDC", not "USD Coin"; it sends
  decimals and holder counts as STRINGS; GoPlus's field set depends on the token. All three
  would have been written wrong from memory. A variant a test needs is built FROM a capture,
  visibly, in the test — and `tests/net.ts` fails any test whose code made a call no route
  answered, because the skills turn a throwing `fetch` into a plausible "could not be reached".
- 🔴 **A dev server's SPA fallback turns a missing file into a 200.** `index.html` linked
  `/manifest.webmanifest` and `/brand/icon.svg` from the first commit and neither existed — Vite
  answered both with the page (HTTP 200, `text/html`), so the only symptom was a console
  "Manifest: Syntax error" on every load. `tests/brand.test.ts` now checks every `<link href>` is a
  real file in `public/`.

- 🔴 **Base's blocks are 0.2 s since block 53,556,127 — a block count is not a time.** MEASURED
  2026-11-11 by bisection on mainnet.base.org: before it every block is 2 s after its parent; after
  it five blocks share each second. Radar, the Recycle Bin, Task Manager, Rugsweeper, Forensics,
  origin's launch-block estimate and the indexer's clock all multiplied by 2 s and read ten times
  too far back for days. Time ↔ block goes through `skills/blocktime.ts` (`timeOf`, `blockAt`,
  `blocksAgo`, `minutesBetween`), never a constant.
- 🔴 **A 403 can be a refusal of the METHOD, not of you.** MEASURED 2026-10-14: publicnode answers
  archive-backed methods such as `eth_getTransactionReceipt` with HTTP 403 "Archive requests require
  a personal token". `rpc` moved on only for 429/5xx, so every receipt failed silently and the
  Recycle Bin read "empty" for a whole session. `rpc` (`skills/http.ts`) now moves on for 403 too.
  An empty list built from failed reads is the missing-answer-as-negative rule again.
- **A page-wide poller runs in every test unless the suite replaces it.** The block pulse
  (`lib/pulse.ts`) is one shared poller; `tests/setup.ts` swaps `PULSE` for a silent store, and a
  test about the pulse passes its own through `PulseContext` (`tests/pulseFake.ts`).

---

## Hard rules in the code

1. **No invented addresses, ever.** Every address in `src/config/` is either verified on
   Basescan or `null`. `null` is load-bearing: `requireContract()` throws naming the unset
   constant rather than handing back a plausible-looking zero address. A zero address in a
   payment path looks like a real address and fails silently.
2. **A ticker string never identifies a token.** The same ticker exists on Base 8453 *and* on
   Robinhood Chain 4663 as different contracts in different pools — tokenized stocks most of
   all. Chain + address, always. An explorer link without its chain is meaningless.
3. **B20 share tokens have 8 decimals, not 18.** Code that assumes an 18-decimal ERC-20
   misprices one by 10^10 — which reads as a 10-billion-x move, not as a bug, so it will not
   announce itself. The app ships no B20 token today; the rule stays for the next one.
4. *(Archived with the privacy model, 2026-09-30.)* A note's `secret` never leaves the browser.
   The notes are gone from `src/`; the rule binds again if `archive/privacy/` is revived. Its
   general form still holds: **nothing the user types that controls money goes into a URL, a
   log, or a request to a server.**
5. **The `quadra_*` MCP server holds no keys.** Every tool in `tools/quadra-mcp/` reads. If
   one ever needs to sign, that is a custody change and the owner's call, not a refactor.
6. **`scripts/measure-catalog.ts` must never invent a tool input.** It measures what upstream
   actually answers; a fabricated input turns a measurement into a guess.
7. **Amounts go through `parseAmount`.** Either an exact base-unit bigint or a thrown error
   the user reads. No path where a typo becomes a silently rounded number.
8. *(Archived with the contracts — binds again if they return.)* **The accepting verifier lives under `contracts/test/` and nowhere else.**
   `AcceptingVerifier` in `contracts/test/doubles/TestVerifier.sol` returns `true` for every
   proof. Nothing under `contracts/src/` may import it. It compiles, the suite goes green, the
   pool "works", and the only symptom is that anybody can drain it — there is no error message
   and no failing test, which is what makes it the single most dangerous file in the repo. Same
   for `TestHasher`: keccak satisfies every property the tree checks, so it passes everything
   and yields a pool whose withdrawals nobody can afford to prove.
9. *(Archived with the pool — binds again if it returns.)* **Never write Poseidon constants from memory, a blog post, or another chain.** Its round
   constants and MDS matrix come from a specified derivation (a Grain LFSR) for one field, width
   and round count. Recalled constants give a hash that is deterministic, collision-free, in-field
   and therefore passes every test in `tests/hash.test.ts` — while matching no circuit anybody
   will generate. Money in, nothing out, no error: the browser half of rule 8's hazard. Poseidon
   arrives with checked-in test vectors that a generated circuit reproduces, or it does not
   arrive. Until then `standInHash` is SHA-256 and says so in every value it tags.
10. **A stand-in value must carry its own reason, and the type must make that unavoidable.**
   `Attestation` (the enclave) and `Payee` (x402) are discriminated unions where only the variant
   that could not be checked carries a `why`, so code needing a checked value narrows and cannot
   ignore a boolean; `ReverseName` (Basenames) and `Flag` (GoPlus) are the same device in the
   skills. (`Commitment` and `Nullifier` were the original examples; archived with the pool.) Do
   not add a `verified: boolean` anywhere in this codebase — `verified: false` is a field that
   gets ignored; a missing `quote` is a type error.
11. **Where the contract and the browser enforce the same rule, the browser enforces it the
   contract's way — even when a local shortcut is correct.** A spend was refused by
   `note.spentAt !== null`; on chain it is refused by `mapping(bytes32 => bool) isSpent`. The
   timestamp was not wrong, it was **unverifiable and locally mutable** — `notes()` copies the
   array but not the notes, so a caller already held a reference that could clear it and re-arm a
   spent note. The tell is that the shortcut reads state nobody outside this tab can check. When
   you find one, keep the convenience for display and move the authority; then write the test
   that forces the two apart (wipe the timestamp, the spend must still be refused), because a
   test where they agree passes under both rules and proves nothing. (The example is from the
   archived pool; the rule is general — it applies to every write skill in P2 that reads state
   the chain also holds, an allowance or a nonce above all.)
12. **Every skill report names its sources, and a value it could not read is a ROW, not an
   absence.** "not checked" in amber, never omitted and never "no". A token scan that silently
   drops the flags it could not fetch reads as a clean scan — the most dangerous thing a panel
   like that can print. The verdict keeps three answers apart: high risk / caution / no red
   flags — and "no red flags found" is never written as "safe".
13. **A reverse record is a claim.** A Basename is shown as an address's name only when the name
   resolves FORWARD to the same address (`nameOf` → `verified`). Anything else is shown as
   `unverified`, in red, with where the name really points.
14. **Server-held keys never reach the browser.** A CDP key (and any aggregator, RPC or data
   key — the o1 key, while o1 was in the app) is a Vercel environment variable read by a function under `api/`. Not `VITE_`-prefixed,
   not in `.env.example` with a value, not in a response body. A key the owner has not given is
   not invented — the feature waits and its window says what it is waiting on.
15. **Fees are off while `CONTRACTS.treasury` is `null`.** Never a placeholder recipient, never
   the connected wallet, never a guessed address — and a quote with the fee switched off says so.
   The owner SET it on 2026-09-30 (`0xD5C1…3FAB`, measured: a wallet with an EIP-7702
   delegation, one key on every chain), so fees are ON at `FEE_BPS` = 10 (0.1%);
   `tests/fees.test.tsx` mocks it back to `null` and checks the fee turns OFF, so clearing the
   address is always a safe way to stop charging.
16. **A quote from somebody else's API is checked before the wallet sees it.** Relay and Across
   each return transactions to sign (o1 did, until it was archived with its `checkPlan`);
   `checkSwap` and `checkBridge` refuse any
   step whose destination is not a PINNED, Blockscout-verified contract (`config/routes.ts` —
   assertions, never destinations), whose sender is not the connected wallet,
   whose chain is not Base, or whose ETH value is not what was asked. Approvals are EXACT —
   Across's quote asks for the maximum uint256 and is ignored; the panel builds its own. Where the
   calldata can be decoded (Across) the recipient, output token, destination chain, amounts and
   an EMPTY message are checked field by field. Where it cannot (Relay's ~8 KB swap call), the
   review SAYS so and the result is measured afterwards as a balance change. Every refusal
   reads "This build will not sign …'s quote: <why> Nothing was sent."
17. **Sending lives in `lib/transact.ts`, not `lib/wallet.ts`.** `wallet.ts` keeps its ban on
   `eth_sendTransaction`; `transact.ts` may ask for it and nothing else — no `eth_sign`, no raw
   transactions, no `wallet_addEthereumChain` (both bans are source-reading tests). It re-reads
   the wallet at the click and refuses if the account or chain moved since the review; it treats
   a hash as "sent, not confirmed", and a wait that runs out as "still pending — NOT failed".

---

## Layout

```
src/
  skills/          🔴 THE PRODUCT, since 2026-09-30. Each skill is a `Skill` (types.ts):
                   id, title, summary, args, and `run(args) → Promise<Report>`. A Report is
                   DATA — rows (label, value, tone?, href?), notes, sources — so one skill
                   reaches three surfaces: a window (features/panels/SkillWindow), the
                   Terminal (`features/commands.ts` `parseCommand`, which falls back to
                   index.ts's `findSkill`; `helpText`, `reportText`), and MCP (T18).
                   A skill that returned JSX could not be typed; one that returned a string
                   could not be laid out. Hard rule 12 is enforced here, per row
                   index.ts   — SKILLS (the order `help` lists), ALIASES (`scan`, `honeypot`,
                               `snipers`, `deployer`, `pay`, `prepare`, …), and `reportText`, which is ALSO what an agent
                               will read — no second wording to keep in step
                   http.ts    — `getJson` (404 → null: "no such thing" is an answer) and
                               `rpc`, which tries base.publicnode.com then mainnet.base.org
                               (MEASURED from the owner's side: 0.2–0.3 s vs 0.7–1.7 s a call).
                               A JSON-RPC `error` is thrown as `RpcRefusal`, so a simulation can
                               tell the chain's "no" from an outage.
                               🔴 It moves on for a 429, a 5xx or an unreachable node, and
                               NOT for a JSON-RPC `error` — a revert is the chain's answer,
                               and asking another node gets the same one. MEASURED: the
                               first endpoint 429s a burst of a few eth_calls
                   json.ts    — accessors that tolerate absence; Blockscout sends numbers
                               as strings ("18", "1225549"), so `numOf` reads both
                   format.ts  — DISPLAY ONLY (hard rule 7 still governs input). Token
                               amounts TRUNCATE, never round up; dust is "<0.0001", not 0;
                               a sub-cent price keeps four significant digits in positional
                               notation, because "$2.74e-8" reads as 2.74 dollars
                               🔴 Since 2026-10-22 a coin's small numbers go through `compact`:
                               subscript zeros from four zeros after the point, as DEX screens
                               write them — 0.00000299 is "0.0₅299", 4.09e-8 is "0.0₇409" —
                               never "e-6"; truncated; null/NaN/negative = "not read".
                               `quoteWithUsd` DROPS the dollar half under a cent instead of
                               printing "<$0.01 ·" beside it; `tinyPrice` for a coin's $ price.
                               TokenPage (cards, info, trades, chart) and `quoteWords` use them
                   blockscout.ts / dexscreener.ts / goplus.ts — one module per source,
                               each a `parse*` (pure, tested on captures) plus a fetch. All
                               three answer CORS, measured. 🔴 GoPlus's field set depends
                               on the token, so a flag is yes / no / unknown (`Flag`)
                   names.ts   — Basenames on chain: the registry is pinned
                               (`BASENAMES` in config), the resolver is read per name, and
                               `nameOf` forward-verifies (hard rule 13)
                   target.ts  — "an address or a Basename" → a checksummed address. Anything
                               0x-shaped goes through the EIP-55 door and is NEVER retried
                               as a name
                   🔴 ONLY skills a block explorer does not already answer (owner,
                               2026-10-01). wallet / whales / tx / read / name / gas / token
                               were DELETED outright — Basescan has every one. Do not re-add
                               them. Their shared helpers stay as library code: `priced` in
                               blockscout.ts, `ethUsd` in dexscreener.ts, names.ts, target.ts
                   verdict.ts — Token Verdict (`verdict`, aliases token/scan/safety/
                               honeypot/check). Trade, code, holders, launcher, market → one
                               of three answers and a score (−35 a red line, −10 an amber).
                               Concentration is AMBER at most (DEGEN's top ten hold 62%,
                               mostly its own Safes); direct deployments are a fact, not a
                               flag; a serial LAUNCHPAD launcher is amber
                   simulate.ts — the trade half: Relay quotes for a keyless address
                               (`SIM_ACCOUNT`), run with `eth_simulateV1` + a state override
                               giving it 10 ETH, `traceTransfers` on: buy 0.01 ETH, move half
                               to a second keyless address, sell all back; on a reverted sell,
                               try half. Native ETH shows up as Transfer logs from 0xeeee…
                               (MEASURED). Relay's "Swap impact is too high" is itself a
                               measurement — on a sell, no exit; on a BUY, an empty market
                   origin.ts  — who launched it. Blockscout v2 ONLY: 🔴 its etherscan-
                               style API allows 10 requests per ~45 min (MEASURED,
                               `x-ratelimit-limit: 10`) and answers a rate limit as
                               `result: null`. Launchpad tokens have NO creator on Blockscout;
                               their launch is the v4 pool's `Initialize` tx, found from
                               DexScreener's pool id + creation time (block = time / 2 s,
                               MEASURED exact) on mainnet.base.org — 🔴 publicnode refuses old
                               logs. A `handleOps` launch is a bundler, not the launcher.
                               A launcher whose history shows `removeLiquidity*` is RED
                               (MEASURED: CHUBBY's deployer, 15 minutes after launch)
                   radar.ts   — Launch Radar (`radar [minutes]`): v4 `Initialize` logs
                               from the chain, the hook's Blockscout name as the launchpad,
                               DexScreener in batches of 30. An unverified hook whose ADDRESS
                               grants a swap-returns-delta bit is red (it can take a cut).
                               Only Uniswap v4 — v3 and Aerodrome launches are not read yet.
                               This app's own launches are named "<brand> launchpad" (the
                               factory's `Launched` logs for the same window)
                   launchpad.ts — reading this app's launchpads — BOTH factories, v2 then v1
                               (`factories()`; v2 kept v1's `launches`, `collect` and `Launched`
                               signatures so one reader serves both): `launchOf` (the factory's
                               record, and WHICH factory), `launchedBetween` (one eth_getLogs over
                               both addresses), `launchesBy`
                               (Blockscout's log index — 🔴 mainnet.base.org caps eth_getLogs at
                               2,000 blocks, MEASURED), `pendingFees` (`collect` run as an eth_call:
                               exactly what it would pay, nothing paid — split into the quote's share and the
                               token's by the pool key's order), `launchpadOrigin`, `poolValue` (the whole supply's value read
                               from the pool's own slot0 through PoolManager `extsload` — slot 6 —
                               times the quote's USD price). 🔴 MEASURED 2026-10-02: DexScreener did NOT
                               list a fresh AAPLc-paired launch at all — so bots showed no market
                               cap — until its FIRST trade (a KyberSwap buy via MetaMask, tx
                               0x50064859…), then listed it priced in USD ($13,455 fdv vs this
                               app's $13,551). Two TSLAc pairs it lists still have no USD price, so
                               it is not promised. An earlier entry here said DexScreener never
                               prices a stock pair: WRONG, written from those two TSLAc pairs alone —
                               a sample of one again. Verdict and "Your launches" show the pool's
                               own figure; the Launch window says DexScreener waits for a trade. For a
                               launchpad token the verdict states the contract's guarantees and
                               takes the creator from the factory, not from the transaction's `to`
                   🔴 THE x402 TOOLS (owner, 2026-10-02: "build all 6", after the market was MEASURED —
                               22,030 Bazaar endpoints and x402scan's 30 days: the whole on-chain-data
                               category earns hundreds of dollars a month, token-verdict calls are the
                               one real demand, and x402 is a DISTRIBUTION channel more than revenue).
                               Seven skills, each sold at its own price (`SKILL_PRICES` in config/api.ts):
                               verdict $0.05 · gate $0.01 · radar $0.02 (now with `score N/100`) ·
                               forensics $0.10 · launcher $0.05 · sendcheck $0.005 · launch $0.05
                   collateral.ts — Collateral Watch (`collateral`, aliases liquidation/loans; in the Research
                               window): a wallet's stocks on Aave V4's MAG7 spoke (config/collateral.ts, every
                               address read back 2026-11-11) — the spoke's health factor, each stock's
                               liquidation price (NOT printed when the recomputed health disagrees by >0.5%),
                               the Coinbase feed's last update, and the scenario at Base DEX prices; the
                               feed stops while the US market is shut. Morpho: the 5 stock markets with ≥$1k of
                               collateral (of 23, MEASURED 2026-11-12; ≈$107k in all), each loan on its own
                   depth.ts   — Trade Depth (`depth`, aliases impact/slippage; Research window, and Trade's
                               "Price impact" button): Relay quotes at $1k/$10k/$100k each way, one at a time
                               (Relay rate-limits a burst, MEASURED), red past 2%. Pools from DexScreener's
                               `/token-pairs/v1` — 🔴 `/tokens/v1` answers ONE pair per token (MEASURED: TSLAc's
                               $34k v4 pool, hiding its $476k Aerodrome one). Stocks' deep pools are Aerodrome
                               Slipstream from CL factory 0x9CB2…7a76, which NO published Aerodrome quoter serves
                               (MEASURED all 8), so per-venue quotes wait. 🔴 Relay REFUSES a size the pools cannot carry with
                               "Swap impact is too high: -74.28%" (PDDc $100k) — that refusal is the worst
                               measurement and is red (`TOO_HIGH`), never "not quoted"
                   gate.ts    — verdict → allow / caution / block + reason codes (`row-label:block`)
                   sendcheck.ts — before paying: EIP-55 on what was TYPED, what is there (a TOKEN
                               contract is red: tokens sent there are lost), Basename, and given the
                               sender, a LOOK-ALIKE (same first and last 4 hex) of a real counterparty
                               or an address PLANTED by a fake transfer — MEASURED on the owner's
                               wallet: 0x00FDCd…746F mimicking the deployer 0x00FD29…746F
                   launcher.ts — a token's launcher (launchpad record first) or a wallet, as a record
                   forensics.ts — the first 1,800 blocks of a token's Transfer logs (archive node).
                               A BUY is found by NET balance change per tx (v4: PoolManager → router →
                               buyer; the router nets to zero). MEASURED on VAMP: 19 of the first 20
                               buyers shared one EIP-7702 delegate (a wallet farm), one tx sprayed dust
                               to 101 addresses, and the largest holder at the hour's end was the
                               TOKEN'S OWN CONTRACT (96.8%) — named as such and amber, not red. A first
                               draft summed "handed out" supply to 293%: launch mechanics move supply
                               mint → factory → wallet → pool, so who holds at the END is the fact
                   prepare.ts — `launch`: an UNSIGNED launch for an agent's own wallet (approve +
                               launch for a stock first buy), the token address predicted. Nothing signs
                               (hard rule 5). MEASURED: its calldata, eth_call'd from the creator,
                               returned exactly the predicted address. Its stock list is
                               `baseStocks` (adapters/http/markets.ts), which asks Coinbase directly
                               where there is no `document` (MCP, the paid API, smoke) and through
                               /api/stocks/base in a browser — MEASURED 2026-10-02: `launch … AAPLc`
                               failed for agents while working in the Terminal
                   chaintoken.ts — name/symbol/decimals/supply read from the token when
                               Blockscout has nulls (MEASURED: a minutes-old B20)
                   🔴 verdict: a SELL that Relay refuses as "impact too high" is "not checked"
                               (amber), never red — Relay prices the sell BEFORE the simulated buy,
                               and a fresh single-sided pool has almost no ETH yet (MEASURED on this
                               app's first launch: -99.98%, a false "no exit"). A refused BUY stays red
  🔴 THE "MORE FUN" PROGRAMS (owner, 2026-10-14: "make it more fun", positioning unchanged; a
                   "Base Apps" directory was dropped by the owner). FLAGS `taskmgr`, `trash`,
                   `soon`, `rugsweeper`, `achievements`, `leaderboard`. Every one reads the chain;
                   none invents an event
                   lib/pulse.ts + ui/usePulse.ts — ONE shared block poller (every 4 s) for the
                               page; Task Manager, the tray's block clock and the screensaver read it
                   panels/TaskManagerPanel.tsx — blocks + `skills/activity.ts` `launchActivity`
                   ui/TrayExtras.tsx — block clock + sound toggle; sounds synthesized in
                               lib/sound.ts, OFF by default (`quadra.sound.v1`, frozen)
                   skills/rugs.ts + panels/TrashPanel.tsx — Recycle Bin: pools that lost ≥90% of
                               liquidity in 3 h. MEASURED: of 226 pools with removals 76 were at
                               exactly 0 and 95 ≥90%, and one hour held none at exactly 0 — hence
                               the threshold. Receipts read ONE AT A TIME; an unreadable one is
                               counted as `unread`, never dropped. A coin `lureOf` flags is named FAKE-
                   Coming Soon — the off programs wait in a folder inside My Computer
                               (`comingSoon`, `CORNER` in registry.ts)
                   🔴 $QUADRA IS LIVE (owner, 2026-10-29: "launch luôn"): `0xb200…ab0816`, v3, paired with
                               AAPLc, 1%, no referrer, launched from the terminal by `quadra-deployer`
                               (tx 0x9529911d…2b43, block 53,236,421); metadata built by
                               scripts/prepare-quadra-launch.ts with the on-chain pixel logo
                               (public/brand/quadra-token/quadra-white.svg — metadata is FROZEN, no website).
                               contracts/src/QuadraFurnace.sol (stage B — DEPLOYED 2026-10-29 at 0x7838…a44c, Sourcify exact, and $QUADRA's creator recipient set to it FOR GOOD; NOT audited): the
                               coin's 80% → `burnBps` (50%) burnt — coin side at once, quote side set aside
                               and bought back by the TREASURY only (`buyAndBurn(amountIn, minOut)`; a v4
                               pool has no oracle) — the rest to the treasury. ETH pushed with a 50k
                               stipend, no return data (review F1 kept out). `script/DeployQuadraFurnace.s.sol`;
                               `script/SimulateQuadraFurnace.s.sol` ran the whole cycle on mainnet state
                               (0.0569 AAPLc → 1,566,435 QUADRA burnt). Stage C (a share of every launch's
                               protocol fee into it) is planned only. public/brand/flywheel.svg/.png = the diagram
                   🔴 THE LAUNCHPAD'S SIX (owner, 2026-10-29: "build cả 6"). panels/PoolTradeEth.tsx —
                               a STOCK-paired coin bought with plain ETH: Relay ETH → the stock (stocks
                               trade on Aerodrome vs USDC, MEASURED — no single router reaches both),
                               then the stock that ARRIVED (its receipt) into the coin's pool, quoted
                               afresh; PoolTrade shows "Pay with <stock> / Pay with ETH". Coinbase's stock
                               list is PAGED (218, 100 a page — MEASURED; only page one used to be read, so
                               AAPLc/NVDAc/SPCXc were "missing"): `baseStocks` reads every page
                               (STOCK_PAGES), the server forwards `page_token` only; Launch asks the
                               factory only about stocks WITH a NAV (12, not 218). panels/CoinShare.tsx —
                               a share card (SVG → `drawCard`) + "Post on X" linking the coin page.
                               panels/VerdictBadge.tsx — Check on each Coins row, run when asked, kept
                               per page. panels/CoinRewards.tsx + lib/revenueShare.ts — where the 80%
                               goes: the recipient can `setCreatorRecipient` to another wallet; a coin
                               whose recipient IS a RevenueShare (asked of the recipient itself: token()
                               and launchpad()) gets stake / unstake / claim; handing it to a share needs
                               `CONTRACTS.revenueShareDeployer` = `0x774C…4139`, DEPLOYED by the owner
                               2026-10-29 (Sourcify exact, `launchpad()` = v3), NOT audited — internal
                               review in contracts/REVIEW-2026-10-29.md (F1: a hostile creator recipient
                               can make v3's `collect` revert for its own coin; needs a new factory).
                               The page skips `create` when the predicted share already has code.
                               v3 quotes since 2026-10-29: ETH + 11 stocks (AAPLc, METAc, MSFTc added)
                   🔴 ONE DOOR PER JOB (owner, 2026-10-29: "cực kì đơn giản, không chồng chéo"). The
                               desktop is `DESKTOP` = Check (`safety`: Verdict, Send Check, Forensics,
                               Launcher, Gate), Coins, Launch, Wallet, Agents, My Computer — and My Computer
                               holds the other folders (Research = Radar alone, Markets, Profile, Explore;
                               Money = Send, Swap, Trade; Launchpad = Leaderboard, Card; Games), Terminal,
                               Task Manager, Control Panel, README. Nothing sits in two places (tested). The
                               menu bar's folder menus are only the folders ON the desktop. The Welcome
                               screen is the front door: paste a token → `verdict` in Check, or Launch /
                               Browse coins / Your wallet. Q never greets unprompted; the Markets gadget left
                               the desktop. The coin page trades through ITS OWN POOL only (no Relay chips —
                               Relay routes no v3 hook pool, MEASURED); Swap offers the pool when a
                               launchpad coin is on EITHER side. Token Verdict simulates an ETH-paired
                               launchpad coin through `poolRouter` (simulate.ts): the buy at the Quoter's
                               figure, the sell UNQUOTED with a 1-wei floor in the same simulated block
                               (MEASURED: quoting the sell first read "could not fill" on a fresh pool) —
                               the first referred v3 coin read 1.99% round trip. `.win__body` has
                               `overflow-wrap: anywhere` (an address in prose widened a phone window 61px)
                   🔴 THE DESKTOP IN FOLDERS (owner, 2026-10-21, after solana95.com: "sắp xếp lại
                               thư mục"; NO external-links directory — folders hold this app's programs
                               only). registry.ts `FOLDERS`/`DESKTOP`/`folderItems`/`desktopItems`: the
                               desktop is My Computer (`computer`: taskmgr, control, soon), Research
                               (`folder-research`: research, safety, markets, profile), Money
                               (`folder-money`: wallet, send, swap, trade, bridge when on), Launchpad
                               (`folder-launchpad`: launch, coins, leaderboard, card), Games
                               (`folder-games`), Agents (`folder-agents`: mcp, x402, api, docs, verify),
                               then shortcuts Terminal, Launch, Coins, Wallet and README.TXT (`readme`);
                               the Recycle Bin keeps its corner. Every old `?do=` id still opens its
                               window directly. A folder is an Explorer window (panels/FolderPanel.tsx:
                               inert File/Edit/View/Help, click selects, double-click or Enter opens,
                               status bar "N objects" + the selection's blurb); folders, Control Panel
                               and README have no flag (`Feature.flag` is optional = always on). The
                               Start menu groups by folder; `windows` lists by folder; `open research`
                               opens the FOLDER while a bare `research` stays the window
                   panels/ControlPanel.tsx + lib/settings.ts + ui/useSettings.ts — wallpaper
                               (Bliss / Windows 95 teal / Base blue dither / plain dark, a class on
                               `.desktop`), sound (lib/sound.ts), screen saver on/off + idle minutes,
                               Welcome at startup (lib/welcome.ts). NEW frozen keys
                               `quadra.wallpaper.v1`, `quadra.saver.v1`, `quadra.saver-minutes.v1`;
                               unreadable or unknown = the default
                   panels/ReadmePanel.tsx — README.TXT in Notepad, prose via BRAND
                   lib/assistant.ts + ui/Assistant.tsx — Q (`quadra.q.v1`, frozen). Speaks only on
                               a REAL event: a red Verdict/Decision (ReportView `tipFor`), fees
                               waiting, a Rugsweeper win; the greeting once
                   features/commands.ts `EASTER` — Terminal easter eggs (kind "say"); never
                               shadow a skill or a shortcut
                   ui/Screensaver.tsx — after 2 min idle (Control Panel sets it), real blocks; off for reduced motion
                   lib/rugsweeper.ts (pure rules) + panels/RugsweeperPanel.tsx — mines are launches
                               Radar's quick checks flag red. 🔴 A hook whose Blockscout record could
                               not be read is NOT a mine
                   lib/achievements.ts — local counters (`quadra.achievements.v1`, frozen) plus
                               wallet achievements read from the chain; unreadable = "not checked",
                               never "locked"
                   panels/LeaderboardPanel.tsx — indexer first, factory logs + DexScreener fallback
                   panels/BaseCard.tsx — the `card` program (2026-10-21, after Solana 95's card):
                               Card Wizard → "Imaging" viewer → 1995 Paint around ONE 1600×900 SVG
                               (Download = exactly what is shown). Picture: the VERIFIED Basename's
                               own `avatar` record as a data: URL (untainted canvas), else a pixel
                               face from the address (lib/cardArt.ts). Title + quote: lib/cardWords.ts,
                               seeded by (address, roll); each has a `when` and a null fact satisfies
                               none. Facts: lib/cardFacts.ts via Profile's own readers; `textOf` in
                               skills/names.ts (MEASURED on jesse.base.eth). Profile's tab opens it
                   config/baseApps.ts + panels/ExplorePanel.tsx — `explore`, "Explore Base" (2026-10-22,
                               after solana95.com's directory): 12 folders, 82 projects as `<name>.exe`;
                               a double click opens ONLY a dialog naming the domain, whose Open is a
                               target=_blank, rel=noopener noreferrer link. 🔴 Data is base.org's OWN
                               list (github.com/base/web `apps/web/src/data/ecosystem.json`, 598
                               entries, read 2026-10-22): name, https URL and logo (base.org's image)
                               copied and tested against `tests/fixtures/ecosystem/`; only the folder
                               and the one-line description are ours. http-only entries (Aerodrome,
                               Uniswap) are left out. "Add yours.exe" points to base/web and BRAND.x,
                               sends nothing. No flag: it reads nothing live. In the Research folder
                   panels/ContractAddress.tsx — a coin's CA in full near its name, Copy (Clipboard
                               API, else the text is selected and the note says Ctrl+C), Basescan and
                               Blockscout; `CopyCa` on each Coins row
                   panels/FeesWaiting.tsx — "Your fees" in the Wallet window: every coin the wallet
                               launched with fees waiting, "Claim all" (each collect its own
                               signature through TxSteps), and payouts a factory OWES
                               (config/owed.ts + skills/owed.ts: v1 `owedEth`/`withdraw()`, v2
                               `owed`/`withdraw(currency)`) with Withdraw
                   lib/v4swap.ts + config/uniswap.ts + panels/PoolTrade.tsx — a coin launched here
                               trades against its OWN v4 pool: Uniswap's Quoter, Universal Router
                               (`0x6fF5…9b43`) and Permit2, exact approvals. The coin page's default
                               route is "<quote> · its pool"; Relay stays as alternatives. Simulated
                               on mainnet: buy, sell and an AAPLc buy delivered exactly the quote to
                               the wei. Addresses checked against Uniswap's docs + Sourcify + the
                               chain (Blockscout answered a Cloudflare 403 that day)
                   config/launchpads.ts + skills/launchpads.ts — `launchpadOf` → proven / claimed /
                               unknown: Quadra; basepad.si (factory `0xad60…307F` `infoOf`);
                               Feel.cash via Doppler Airlock `0x660e…8D12` `getAssetData`, integrator
                               `0x3879…6699` (a `fee1` suffix alone is a CLAIM, red); Clanker
                               `0xE85A…83a9`; Zora `0x7777…baF3` (an upgradeable proxy). origin.ts:
                               the launchpad is the token's CREATING contract or a proven launchpad,
                               never a 7702 relay (DelegationManager) or a 4337 bundler. Radar
                               labels basepad/Doppler launches, and with Blockscout unreadable a hook
                               is amber "not checked" — MEASURED: 7 of 12 shown launches had been a
                               false red "UNVERIFIED"
  intro/           The home page's first seconds (owner, 2026-10-02): the early-nineties Macintosh
                   this app is named after, in three.js, switches on, boots THIS app (its own
                   icon and welcome box — no maker's logo or trademarked boot art) and the camera
                   flies into its screen until the screen is the page. Not played for a `?do=` link,
                   `prefers-reduced-motion`, or without WebGL. SLOWER and INTERACTIVE since
                   2026-10-02 (owner): two phases WAIT for the visitor — `idle` (the machine off:
                   drag to turn around it, scroll to lean in, click it or Enter to switch on) and
                   `ready` (the welcome box: click the SCREEN or Enter to go in) — at most 1.2 s and 1.5 s (sped up twice on 2026-10-21, ~6.4 s end to end),
                   then it carries on by itself. The scene's `hit` raycasts the machine (the desk
                   excluded; the hole is "screen"); the orbit is unwound by the fly-in, which always
                   ends square. A click no longer skips — Esc and the Skip button do
                   timeline.ts — the whole sequence as arithmetic on a clock (phases, camera,
                               framing per aspect), so it is tested without a GPU
                   machine.ts — the model, from boxes. 🔴 The screen is a HOLE (`NoBlending`,
                               opacity 0) in the WebGL picture; the boot screen is real HTML in
                               a CSS3D layer BEHIND the canvas, so text stays crisp all the way in
                   scene.ts   — lights, fog, camera; takes its renderer as an argument (`GL`),
                               so it runs under test. webgl.ts makes the real one; start.ts
                               imports both on demand — three.js is its own chunk (~125 kB gz)
                   Intro.tsx  — the overlay; the boot screen is a portal into the element CSS3D
                               owns. The welcome box shows the latest Base block, READ from the
                               chain, or says it was not reached. 🔴 Three things MEASURED in a
                               real render: a default `clock = () => …` parameter restarted the
                               scene on every phase (a new function each render); the first frame
                               compiles every shader, so it is drawn BEFORE the clock starts; and
                               fog fixed at 16..34 hid the machine at a phone's camera distance
                               (~32), so it moves with the camera. Headless Chrome films it with
                               `--use-angle=swiftshader` over CDP; software GL runs a few frames a
                               second, so judge framing from it, never pacing
  (contracts/)     NOT under src/ — the launchpad, `contracts/src/LaunchFactory.sol` v2 (owner,
                   2026-10-02: "build our own on Base, not o1", then "pair with stocks like o1").
                   One call: a B20 Asset with `initialAdmin = 0` and the whole 1B supply minted in
                   `initCalls` (so no role can EVER be granted: no mint/pause/seize/rename —
                   MEASURED on mainnet: a later mint reverts), a Uniswap v4 pool at 1% against ETH
                   or a quote the QUOTE ADMIN enabled (`setQuote`; the deployer, two-step to hand
                   on), opened at that quote's tick in the same transaction, the supply as ONE
                   single-sided position on whichever side the token sorts to, owned by the
                   factory, which has NO code path that removes liquidity, and an optional first
                   buy (ETH as value, a stock pulled by `transferFrom` after an EXACT approval).
                   `collect` pokes the position and pays 80% launcher / 20% protocol in both
                   currencies; anything a recipient or a stock's transfer policy refuses waits in
                   `owed` for `withdraw(currency)`. v1 (ETH only) is DEPLOYED and its exact source
                   kept in `contracts/deployed/`. contracts/README.md has the design, the
                   measurements and the OWNER's deploy + setQuote steps.
                   🔴 Measured while building it: (1) `vm.prank` is consumed by the first external
                   call, including one in a later call's ARGUMENTS — read the PoolKey before the
                   prank; (2) `base-forge coverage`'s analyser cannot follow relative imports inside
                   a library outside the project root, so v4-core/periphery are reached through
                   `contracts/lib/` symlinks into node_modules; (3) coverage does not count a revert
                   inside a call that is itself caught — the reentrancy guard is tested by holding
                   the lock with `vm.store` (slot checked first); (4) publicnode refuses
                   `eth_getLogs` for old blocks, mainnet.base.org answers.
                   `scripts/simulate-launchpad.ts` runs deploy v2 → enable NVDAc → buy NVDAc via
                   Relay → launch an ETH pair and an NVDAc pair, each with a first buy → collect
                   both, in one `eth_simulateV1` block on REAL mainnet state (hand-run).
                   🔴 v3 (built 2026-10-14; DEPLOYED 2026-10-22 at `0x006d…1377`, Sourcify exact match, NOT audited; the app launches on it):
                   `LaunchFactoryV3.sol` + `LaunchHook.sol` — the creator picks 1% or 3%; an
                   anti-sniper fee decays 50% → that fee over 15 s through a dynamic-fee hook (the
                   in-launch first buy exempt); the factory's constructor deploys the hook at a
                   mined CREATE2 salt (`script/DeployLaunchFactoryV3.s.sol` + `HookSalt.sol`); only
                   the factory may add liquidity during the window; `beforeInitialize` refuses pools
                   the factory did not open (which also closes a v2 front-run gap).
                   `scripts/simulate-launchpad-v3.ts`: a sniper at +1 s paid 46.7%, a buyer at +20 s
                   1%; launch gas +8.5% over v2
                   🔴 REFERRALS in v3 (owner, 2026-10-22, before the deploy): `launch(…, fee,
                   address referrer)`; a referrer counts only if the PROTOCOL RECIPIENT approved it
                   (`setReferrer`, `approvedReferrers`) at launch — an unapproved one is recorded as
                   none (`ReferralIgnored`), never a revert. Recorded for good in `referrerOf(token)`
                   (event `Referred`; `launches` and `Launched` unchanged). `collect`: creator 80% /
                   referrer 5% / protocol the REMAINDER; 80/20 without. Removing a referrer stops NEW
                   referrals only — `collect` never reads the list. A refused referrer payout goes
                   to `owed`. Blue Agent is the first referrer; its address is the owner's to give
                   `scripts/quote-ticks.ts` prints each stock's opening tick from live prices and
                   the `setQuote` line for it — 🔴 stocks have 8 decimals, so a tick means ten
                   orders of magnitude less in a stock than in ETH (hard rule 3)
  adapters/        Enclave + Catalog behind one interface (the ShieldedPool adapter was
                   archived 2026-09-30)
    local/         the enclave stub and the offline catalog
    http/          the live BlueAgent x402 catalog client, the Bazaar, any-URL endpoints;
                   relay.ts (swap quotes + `checkSwap`), across.ts (bridge quotes +
                   `checkBridge`, decodes the deposit), launchpad.ts (the launch transaction,
                   `checkFactory`, `launchPairs` — ETH plus every Coinbase stock the factory
                   ENABLED, transfer-paused stocks never offered), quotes.ts (one request, the
                   service's own refusal sentence). o1.ts was ARCHIVED to `archive/o1/`
  config/          chain.ts (Base 8453, flags, USDC, WETH), upstream.ts (the
                   directories this app reads — BlueAgent is one), payees.ts,
                   connectors.ts — the WalletConnect project id, and `null` when
                   it is unset. Same load-bearing `null` as CONTRACTS (hard rule
                   1): lib/connectors.ts throws naming the variable rather than
                   calling the SDK with `""`, which fails later and elsewhere
  features/        🔴 commands.ts — ONE command language for the whole app (owner, 2026-10-02: "link
                               everything together"). A line runs a skill (`verdict 0x…`) or OPENS A
                               WINDOW with what it shows (`coin 0x…`, `profile name`, `send 0x…`,
                               `swap 0x…`, `open markets`, `windows`). The Terminal types it; a report's
                               `next` (Row.next, Report.next) IS one; ReportView's buttons run one. A
                               skill run from a button opens its home window (`SKILL_HOME`) told to run
                               it via `run-<window>` — per window, because several windows run skills
                   openWindow.tsx — `useOpenWindow(id, params)`, `useRunCommand`, `useInbox` (a one-time
                               instruction in the URL — `run-<window>`, `to`, `buy` — applied, then
                               cleared; a no-op without a router). `t` (coin page) and `a` (profile) are
                               window STATE and stay. 🔴 MEASURED in a real browser: the router applies a
                               param change in a transition, so App's `do=` sync wrote the URL from the
                               OLD params and dropped `a=`/`t=`; App now merges pending params into it.
                               Send runs Send Check's history test in its review and REFUSES an address
                               a fake transfer planted (address poisoning)
                   registry.ts (the feature ?do= ids, the folders, plus DOC_PAGES — docs/api/
                   verify are windows on the desktop as well as routes, because
                   navigating to one threw away the header and every other open
                   window) + panels/ + DocWindow.tsx. `router` was REMOVED as an id on
                   2026-09-30 — acceptable only because nothing is public yet; once the
                   site is live an id is redirected, never deleted
                   panels/SkillWindow.tsx — the form is GENERATED from a skill's `args`,
                               so a window and the Terminal cannot disagree about what a
                               skill takes; fields are joined and split exactly like a
                               Terminal line. `key={skill.id}` resets the form on a tab
                               change — an address typed for Radar must not become
                               Verdict's input. The button names what is missing
                   panels/ReportView.tsx — a Report as a table; the link is the value
                               itself, so "see it for yourself" cannot drift from the claim
                   panels/TerminalPanel.tsx — prints `reportText`; each answer settles
                               onto its own command's entry, whatever order they finish in
                   panels/SendPanel, SwapPanel, BridgePanel, LaunchPanel — the money windows,
                               all one shape: fields → Review (a Report, reads + a checked
                               quote) → one CTA that wears its blocker as its label → signing
                               through TxSteps. Any edit throws the review away, so what was
                               reviewed is what gets signed
                   panels/TxSteps.tsx — runs signatures one at a time, each watched to a
                               receipt; a later step is never asked for while an earlier one is
                               unconfirmed. "slow" is its own state and never reads as failed
                   panels/TokenPicker.tsx — ETH/USDC/WETH (verified config) or any token
                               by ADDRESS, read from its contract (hard rules 2 and 3); also
                               the 25/50/75/Max shortcuts, which read the balance FROM THE
                               CHAIN at the click (the list above is an indexer, seconds
                               behind), truncate, and keep `ETH_GAS_RESERVE` back on ETH Max
                   panels/WalletAssets.tsx — what the wallet holds on Base, above Send and
                               Swap: ETH, then PRICED tokens by value (top 8). An unpriced
                               token never appears — it is mostly an airdropped lure, and this
                               list is one click from a transfer. ETH and the tokens load
                               SEPARATELY: MEASURED, Blockscout's token list takes 3.6–9 s and
                               ETH ~0.3 s; awaited together, the owner read the wait as broken.
                               Picking a token clears the amount; a % button shows "…" at once
                               and reads USDC/WETH from verified config, not the chain (1 call,
                               ~0.24 s, was 1.8 s)
                   src/server/indexer.ts (+ indexerPath.ts, adapters/http/indexer.ts) — the
                               launchpad indexer at /api/launchpad/coins|creators, mounted in
                               vite.config.ts: DEV SERVER ONLY (T3). mainnet.base.org, then
                               Tenderly's public gateway on a 429, 1,000-block chunks
                   panels/TradePanel.tsx — Trade: the Crypto/Stocks lists, the pick at a
                               glance, Buy/Sell × USDC/ETH, then `<SwapPanel fixed>`
  lib/             amount, hooks, manifest, verify, errors (`messageOf`)
                   transact.ts — `sendTransaction` (re-reads the wallet at the click, then
                               `simulate`s the transaction as an eth_call) and
                               `waitForReceipt`. Hard rule 17. 🔴 What a swap DELIVERED is read
                               from its own receipt: `tokenReceived` sums the Transfer logs to the
                               user; `ethReceived` reads the balance AT the receipt's block and the
                               one before, plus the fee. MEASURED 2026-09-30 by the owner: a
                               confirmed ETH→USDC swap was reported as "your USDC balance rose by
                               0" — a `latest` balance read had raced the chain. The fixtures are
                               two real Relay receipts; the ETH one matches its WETH withdrawal
                               to the wei. Unmeasurable is `null` and said as such, never 0
                   erc20.ts  — read a token, balances, allowance; transfer/approve calldata.
                               Approvals are for EXACTLY the amount, never unlimited
                   arrival.ts — a bridge's arrival measured on Robinhood Chain's own RPC
                   watchlist.ts — the Markets watchlist (`quadra.watch.v1`, frozen); a
                               display preference, so unreadable falls back to the default
                   discovery.ts — EIP-6963: every installed wallet by name; icons only as
                               `data:image/` URIs; a name is not an identity
                   x402http.ts — the x402 v2 HTTP transport: `PAYMENT-REQUIRED` read
                               header-first (body fallback, for BlueAgent), `PAYMENT-SIGNATURE`,
                               `PAYMENT-RESPONSE`. UTF-8 base64, because these carry the
                               SERVER's text; `payment.ts`'s legacy header stays ASCII-only
                   pins.ts   — payees the USER confirmed, per origin, in localStorage
                               (`quadra.pins.v1`, frozen). Shipped pins in `config/payees.ts`
                               always win and cannot be overridden from the browser; an
                               unreadable record throws rather than reading as "none"
                   spendGuard.ts — per-payment and per-24h limits, and a ledger of what
                               was SIGNED (not settled — an EIP-3009 authorization is a
                               bearer instrument). Fails CLOSED on an unreadable record
                               (`quadra.spend.v1`, frozen). Enforced by `assertAllowed` on the
                               signing path, not only by a disabled button
                   address.ts — the ONE door every address goes through. Folded four
                               copies of `/^0x[0-9a-fA-F]{40}$/` into it, one of which sat
                               on the money path. 🔴 `checkAddress` returns a FOUR-valued
                               union (malformed / unchecked / mismatch / checksummed) and
                               must never be collapsed to a boolean: EIP-55 is only
                               checkable when the address has mixed case, so `unchecked →
                               true` lets a typo bypass the check by lowercasing and
                               `unchecked → false` rejects most addresses explorers hand
                               out. 🔴 Never offer the recomputed checksum as "did you
                               mean" — `toChecksumAddress` only changes case, so on a
                               mismatch the suggestion IS the typo, correctly capitalised.
                               And `assertChecksummedAddress` checks BEFORE it lowercases,
                               because lowercasing first destroys the evidence
                   keccak.ts — Keccak-256, hand-written, ZERO tabulated constants: the ρ
                               offsets, the π permutation and all 24 round constants are
                               derived at module load, so a transcription typo is
                               impossible rather than merely tested for. NOT a rule-9
                               violation and its header explains why at length — `cast
                               keccak` is a local oracle, so a wrong bit fails the first
                               vector, which is the exact opposite of a recalled Poseidon
                               constant. It must NEVER become a pool's hash (rule 9, if the
                               archived pool returns). It SHIPS to the browser
                               as of the EIP-55 increment — address.ts imports it and three
                               panels import that, so the whole permutation is in the
                               bundle. It was tree-shaken out while transaction.ts was its
                               only importer and nothing imported THAT; the bundle went
                               221.42 → 224.51 kB when that stopped being true, which is
                               the first time this code has run anywhere but a test
                   🔴 HOW TO CHECK WHETHER SOMETHING IS IN THE BUNDLE, because two
                               attempts got this wrong in opposite directions and both
                               looked convincing. (1) Use `grep -cF`, never plain `grep`:
                               `grep -c 's^=369'` reports 0 on a bundle that contains
                               `(s^=369)` verbatim, and a 0 reads as "tree-shaken". (2) The
                               needle must contain NO identifier. esbuild renames every
                               local, so `(1600-2*Cs*8)/8` matched one build and `Cs` is
                               not promised to the next. The stable needles for keccak are
                               `(1600-2*`, `^=369`, `&256)!==0` and `(1n<<64n)-1n` —
                               operators and literals only, all four verified 2026-09-28.
                               (3) A bare numeric literal is useless: `369` also occurs
                               inside the BN254 modulus. Prefer a distinctive error string
                               where the module has one
                   abi.ts    — the 32-byte word layout, extracted from (the now archived)
                               transaction.ts's `writeWord` when eip712.ts needed the same loop. Two
                               copies of a byte layout whose output gets hashed and signed
                               is the address-regex smell with worse consequences. 🔴 An
                               out-of-range word THROWS; the version it replaced masked,
                               and a masked `value` word is a signature over a number
                               nobody chose. `wordFromBytes32` refuses any length but 32
                               for the same reason — a 31-byte nonce left-padded is a
                               different nonce that encodes cleanly
                   eip712.ts — the EIP-3009 `TransferWithAuthorization` digest. Holds no
                               key and produces no signature (rule 5) — that is why it
                               could be built while the rest of T4 waits on a decision.
                               🔴 Its strongest test is a closed loop: the domain separator
                               derived from config/chain.ts equals the deployed USDC
                               contract's own `DOMAIN_SEPARATOR()` on Base,
                               `0x02fa7265…7834f`, so one equality turns the struct shape,
                               the string hashing, name, version, chainId and token address
                               into measurements. 🔴 An authorization is a BEARER
                               INSTRUMENT: `validBefore` far in the future is a standing
                               withdrawal permission, not a payment, hence the
                               one-hour cap. 🔴 The nonce comes from a SET not a sequence —
                               `crypto.getRandomValues`, never a counter and never derived
                               from the payment fields, which would make paying the same
                               amount twice impossible and publish the payment's contents.
                               Typehashes are derived from the type strings at load, never
                               tabulated (rule 9); the strings are whitespace-sensitive and
                               pinned as text as well as by hash
                   requirements.ts — reads a live 402 into the ONLY struct `Price`'s
                               `paid` variant can hold, so a displayed price is by
                               construction a checked one. It became the parse rather
                               than a second pass over `Price`, because `Price` used to
                               drop `scheme`, `extra` and `maxTimeoutSeconds` — exactly
                               the three a signature's safety rests on — so a checker
                               downstream of it was structurally unable to check them.
                               🔴 Authority differs PER FIELD and the directions are not
                               interchangeable: `payTo` comes from upstream and the
                               config constant is only ever an assertion (a constant used
                               as the destination keeps paying the old payee after a
                               rotation — a silent misroute, not an error), while the
                               EIP-712 domain comes from config and upstream's
                               `extra.{name,version}` is only ever compared (adopting it
                               would let the payee choose the domain its own signature is
                               verified under). 🔴 MEASURED 2026-09-28: `network` is CAIP-2
                               `"eip155:8453"`, NOT the bare number — an assertion written
                               against `BASE.id` without measuring would refuse every real
                               402. Same measurement: `maxTimeoutSeconds: 120`, which
                               supersedes eip712.ts's 600-second fallback, and a 402
                               carries no `decimals` at all. Every bound REFUSES and none
                               clamp; an unrecognised payee is a VALUE (`Payee` is a union,
                               rule 10) because a rotated payee leaves the 402 perfectly
                               readable and throwing would make the price un-renderable
                   wallet.ts — EIP-1193: connects, and re-measures instead of
                               believing. Same boundary as eip712.ts/requirements.ts —
                               asks, never holds (rule 5), and `tests/wallet.test.ts`
                               reads the source to ban `eth_sign`, `personal_sign`,
                               `eth_sendTransaction`, `privateKey` and `mnemonic`.
                               `eth_signTypedData_v4` is deliberately NOT banned: T4 went
                               there, and a test that forbids the next planned commit is
                               one somebody deletes without reading. Sending lives in
                               `transact.ts` (hard rule 17); this ban stays. 🔴 Five
                               states, not `{address,chainId}|null` — unavailable /
                               failed / disconnected / wrongChain / ready — because a
                               null makes the panel guess, and the guess is "install a
                               wallet" said to somebody who has one. `ready` carries no
                               chainId (same reason `PaymentRequirements` carries no
                               `network`: a checked chain has nothing left to report).
                               🔴 Never calls `wallet_addEthereumChain` — that writes an
                               RPC endpoint into the user's wallet that outlives this
                               page and then carries their Base traffic everywhere else
  server/          api.ts — this app's OWN API (owner's decision, 2026-09-30): GET /api/skills
                               free; GET /api/skills/<id>?arg=… sold per call over x402 (exact,
                               USDC on Base, priced per skill by `SKILL_PRICES` in config/api.ts —
                               `API_PRICE` is only the fallback — to the treasury). Order:
                               check the payment is for THIS sale → facilitator verify → run the
                               skill (a failure is a 422, `charged: false`, nothing settled) →
                               settle → deliver. Only a settled payment gets the report, so a
                               replayed authorization gets nothing; CDP's `settlement_pending` is
                               asked once more, then delivered with that status. No CDP key or no
                               treasury = a named 503, never a 402 for money it cannot collect.
                               Loaded by the dev server through `ssrLoadModule` (it imports the
                               skills, so it cannot be imported by vite.config.ts); its path is in
                               `apiPath.ts` for that reason
                   cdp.ts — Coinbase CDP's x402 facilitator (verify/settle), with the CDP JWT
                               built on WebCrypto (Ed25519 or ES256, SEC1 wrapped as PKCS#8) —
                               written from cdp-sdk's and x402 core's own sources, no library.
                               Keys `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` from `.env.local`, server-only
                   stocks.ts — GET /api/stocks/prices → Robinhood's Stock Token API, and
                               GET /api/stocks/base → Coinbase's Tokenized Stocks API; neither
                               sends a CORS header; no key, `x-quadra` header required
                   charts.ts — GET /api/charts/ohlcv → GeckoTerminal, every parameter
                               checked against a fixed shape, answers cached FRESH_MS and served
                               stale (header `x-quadra-stale`) for up to STALE_MS when upstream
                               refuses; identical requests in flight are asked once
                   forward.ts — the forwarder, as a Fetch-API `Request → Response`, so it
                               runs unchanged on Workers/Vercel/Node (T3 is where, not how).
                               🔴 Not an open proxy: a policy per target (`anyPublicHttps` in
                               dev, `allowOrigins` in production), a required `x-forward: 1`
                               header against cross-site use, x402 headers only, no redirects.
                               Imports nothing from the app — Vite's config pass loads it
  pages/           /docs /api /verify /404. Each of the three exports a *Body
                   component as well as its route component; the body is what a
                   desktop window renders, so the two can never show different prose
  ui/              Window (Platinum: close box left, zoom + collapse right, grow box; `win--inactive`
                   goes flat; no drag above `MENUBAR_H`), Taskbar (since 2026-10-22 the Mac OS MENU BAR
                   across the top — the app's own menu holds every program by folder, each folder is
                   its own menu on a wide screen, the Windows menu at the right lists open windows and
                   "Show Desktop"; the name `Taskbar` and `toggleFromTaskbar` stayed), Gel (Platinum push
                   button; `.gel` is the DEFAULT button with the ring), Crt (output box)
                   WalletProvider.tsx — 🔴 ONE wallet session for the whole page,
                               and the reason it is a provider rather than state in
                               a component: the tray and the Connect-wallet window
                               each held their own, so connecting through
                               WalletConnect in the window left the tray still
                               saying "connect wallet". The injected-provider events
                               that keep two copies in step never fire for a provider
                               one of them has never seen. `useWalletSession()`
                               THROWS outside it — a default session would rebuild
                               that bug silently, with the orphan looking fine
                   WalletActions.tsx / WalletStatus.tsx — the three ways in, and the
                               tray that shows them. Both are consumers only. 🔴 The
                               tray balloon opens BY ITSELF only for a wallet on the
                               wrong chain (`opensItself`). It used to open on every
                               load for every not-ready state and MEASURED 2026-09-29 it
                               covered the Send window's Send button — for "no wallet",
                               which is not a problem here: research needs no wallet at
                               all. An absence waits to be asked
  styles/          reset.css + theme.css — the Mac OS 8 "Platinum" design system (2026-10-22, the
                   owner: "toàn bộ app sang System 7", then — after a System 7 pass with a pixel
                   font he found childish — Platinum). Inter (OFL) for chrome 600/700 and text,
                   tabular figures; JetBrains Mono (OFL) for addresses; both from Google Fonts in
                   index.html. NO pixel font in chrome, NO Apple font or artwork. The `--xp-*`,
                   `--aqua-*` and `--s7-*` token NAMES are kept as aliases carrying Platinum values,
                   because other stylesheets (BaseCard.css, ExplorePanel.css, ContractAddress.css)
                   read them; new code uses `--pt-*`. Desktop: icons fixed down the RIGHT edge
                   (`column wrap-reverse`), the Trash bottom-right, Markets as a floating palette on
                   the left; rows in normal flow at ≤600px wide or ≤570px tall. Wallpaper ids in
                   `quadra.wallpaper.v1` are the XP-era ids (`bliss` = the blue-grey default) so a
                   saved choice never breaks; each is a pair of `--pattern-a/b` values.
                   Measured over CDP (`Emulation.setDeviceMetricsOverride`, true 390px layout) on
                   2026-10-22: every `?do=` window, 1280×760 and 390×844 — no horizontal overflow,
                   every money CTA (Send, Swap, Trade, Launch, the coin page's trade, Wallet) above
                   its window's fold, no title bar under the menu bar.
                   🔴 `.gel:disabled` may NOT be a `filter` on the enabled style: a
                   filter moves the label and the background it sits on by the same
                   amount, so `grayscale(1) brightness(1.15)` over the blue gradient
                   made the primary button's text invisible at ~1.6:1 while the
                   quiet buttons beside it stayed readable and the row looked
                   deliberate. Disabled has its own flat palette
tests/             105 files, mirrors src/. keccak.test.ts's nine digests come from an
                   EXTERNAL oracle (`cast keccak`, commands in its header). Regenerate a
                   doubted vector with cast — never by running our code and pasting the
                   answer back, which converts the test into a tautology
                   fixtures/base/ — REAL responses from Blockscout, GoPlus, DexScreener and
                               the RPC, captured 2026-09-30 and trimmed; the curl commands
                               are in its index.ts. Never edit one by hand to make a test pass
                   net.ts     — the fake network the skill tests run on: GET routes, RPC
                               routes, an `eth_call` router, and a Basenames registry +
                               resolver encoded with viem. An unrouted call FAILS the test
                               (after it ends) — see the rule on fixtures above
tools/quadra-mcp/  stdio MCP server, read-only: its five own tools plus every skill as a tool.
                   `skills.mjs` is GENERATED from `src/skills/mcp.ts` by `npm run build:mcp`
                   (esbuild, Vite's own); `tests/mcpBundle.test.ts` rebuilds it in memory and
                   fails while the checked-in file is stale. The no-key source checks cover
                   the bundle too
scripts/           measure-catalog.ts — hand-run, hits the network
                   smoke-skills.ts — `npm run smoke -- "radar 20" "verdict 0x…"`: skills
                               against the live chain, hand-run. Measure a source with it
                               before writing or changing a parser
                   build-mcp.mjs — `npm run build:mcp`, generates tools/quadra-mcp/skills.mjs
                   check-contract-coverage.ts — the last step of `gate:contracts`
                   simulate-launchpad.ts / quote-ticks.ts — the launchpad's hand-run
                               mainnet simulation and stock opening ticks (see contracts/)
api/               🔴 GENERATED Vercel Functions (T3, 2026-11-04) — `npm run build:api`
                   (scripts/build-api.mjs) bundles src/server/vercel.ts `routes(process.env)` per
                   route, because Vercel's compiler does not follow the `@/` alias:
                   stocks/[...path].js, charts/[...path].js, skills.js + skills/[...path].js,
                   launchpad/[...path].js (the indexer, its state in the project's Vercel Blob —
                   server/indexStore.ts; each stale request steps it forward for ≤20 s and saves)
                   and cron/index.js (vercel.json `crons`, daily: Hobby allows no more).
                   Web signature `export function GET(request)`. tests/apiBundle.test.ts fails while
                   one is stale. vercel.json sends every non-`/api/` path to index.html (the /api
                   PAGE included). NOT yet: the forwarder
                   (serves only x402 halves that are switched off). Measured locally by importing
                   the bundles; NOT yet measured on a real Vercel deploy
archive/           privacy/ (src, tests, contracts, the contract-gate scripts) and
                   previews/ — ARCHIVED 2026-09-30 — and o1/ (launching through o1, retired
                   2026-10-02; its README says how to bring it back) — outside tsconfig's include, so they
                   neither compile nor count toward coverage. Nothing in src/ may
                   import from here
```

`@/` → `src/`. Tests never touch the network: `tests/setup.ts` makes `fetch` throw, so
anything network-facing lives in a hand-run script instead of the suite.

---

## What is real and what is not

**Built and working:** `wallet`, `terminal`, `research`, `safety`, `markets`, `trade`, `send`,
`swap`, `launch`, `coins`, `profile`, `x402`, `mcp`; `bridge` is built but hidden
(`FLAGS.robinhood`). Every window that moves money was built on 2026-09-30 and checked in a
real browser against LIVE quotes with a read-only test wallet that refused every send — none has
yet signed a transaction with real money; that is the owner's test.

`research` is Radar, Verdict, Forensics and Launcher; `safety` is Verdict, Gate and Send Check
(2026-10-01, the owner: "market-grade, not what Basescan already has"; the rest joined 2026-10-02). Both checked in a real browser against the
live chain the day they were built: the radar listed an hour's 166 v4 pools with the launchpad
named by its hook; the verdict called CHUBBY "High risk — 0/100" an hour after its deployer pulled
the liquidity, and a five-day-old Clanker token "Caution — 90/100" with its launcher's 50+
`deployToken` calls flagged.

`coins` (2026-10-02, the owner: "a page like launch.o1.exchange", kept as a desktop window in this
app's style) is the launchpad's front page: a head with "Launch a token" (opens Launch through
`features/openWindow.tsx`), four numbers (coins launched, volume and trades 24h — DexScreener, which
gives no trader count, so none is claimed — and the highest market cap read from the pools), All /
Crypto / Stocks, a pair filter, and Trending (most trades 24h) / Vol 24h / New / Liquidity. Each coin
opens its page in the same window, linked as `?do=coins&t=0x…`: the coin at a glance, a buy or sell
through `<SwapPanel fixed>` (the same Relay engine as Trade), everything with sources folded below,
Collect for the creator's wallet, and Token Verdict on demand. MEASURED in a real render: with the
report first the swap's button sat 311px below the fold, so the trade comes first.

`profile` (2026-10-02, the owner: "there is no page for the user"; positioning kept as the on-chain
supercomputer) — any wallet as a person reads it: the connected one, or `?do=profile&a=<address or
Basename>` for anybody (a coin's page links its launcher's). Who (Basename forward-verified, account
kind), then Holdings (ETH, priced tokens, and coins launched here — their balance read from the CHAIN,
MEASURED: Blockscout lacked a coin bought minutes earlier — valued from their pools; the unpriced rest
COUNTED, never listed), Coins launched (value, fees, "Collect all" on your own) and Activity.
🔴 MEASURED on the owner's own wallet: its history is an ADDRESS-POISONING campaign — a token named
"ETH" that is not ETH, and "E឵Τ឵H", "ꓴ឵ՏᎠ឵Ꮳ", "U឵S឵Dꓚ" (look-alike letters + invisible U+17B5) "sent"
from the wallet to addresses sharing the first and last characters of ones it really uses (0x00FDCd…
against the deployer 0x00FD29…). `lureOf` in `skills/profile.ts` names them: any non-ASCII symbol, or
ETH/WETH/USDC at a contract that is not the verified one; Activity shows each in red with "never copy
an address from your history". The fixtures in `tests/fixtures/profile/` are that campaign — never
tidy their characters.

`launch` is this app's own **Base launchpad** (`BaseLaunch.tsx` + `adapters/http/launchpad.ts`);
o1 was taken out on 2026-10-02 (the owner: "take o1 out of launch") and its adapter, server route,
panel and tests archived under `archive/o1/` — its API had answered 500 for days and never
exchanged a live request. The window builds the one transaction itself and, before offering it,
READS the deployed factory and refuses it unless its supply, 1% fee, 80/20 split, ETH opening
tick and protocol recipient (= `CONTRACTS.treasury`) are exactly `LAUNCHPAD_EXPECTS`;
`tests/launchpad.test.tsx` holds the hand-written ABI to the Solidity text and the expectations to
the deploy script. **Pairs**: ETH, or any Coinbase stock on Base the factory has ENABLED (the list
is Coinbase's own; each stock is asked `quotes(address)` and offered only if the factory says so,
at the factory's tick — re-read at Review). A stock first buy is two signatures: an EXACT approval,
then the launch. The review shows the opening value in the pair's own units and, for a stock,
that Coinbase restricts holders (eligible persons outside the U.S.).
**v3 is DEPLOYED** by the owner 2026-10-22 at `0x006Da367654a487bb277fe25ff54f0fE0f741377` (hook `0x0D9DdcC907658E3C61318d0F979F978e600AA880`, tx 0x151126f0…, block 52,929,530): verified on Sourcify (exact match), read back and checked by the app's own `checkFactory` (ok), 8 stocks enabled (CRCLc, GOOGLc, INTCc, MSTRc, NVDAc, SNDKc, SPCXc, TSLAc). Blue Agent's referrer `0x884fbdd5cf193e7f87cba76419e526d8f4df7a9b` is NOT yet approved — the owner must send `setReferrer` from the treasury `0xD5C1…3FAB`. Still NOT audited. New launches go to v3; v2 and v1 stay read and collected from. Tests whose fixtures are v2/v1 captures run with v3 unset through `withoutV3()` in `tests/v2only.ts`.
**v2 is DEPLOYED** by the owner 2026-10-02 (`CONTRACTS.launchFactory` =
`0xef1F427bB57e0ECd7BB8051cE8bC7AAb709a0c03`, tx 0xd05554c5…, block 52,068,913, quote admin = the
deployer `0x00FD…746F`): fully verified on Blockscout, runtime bytecode identical to this repo's
build with the 19 immutable slots masked, and every expected value read back — supply 1e27, fee
10000, share 8000, `quotes(ETH)` enabled at 191200, recipient = treasury. NO stock is enabled yet
(`quotes(NVDAc)` read back `false`), so the window offers ETH alone until the owner runs the
`setQuote` lines `scripts/quote-ticks.ts` prints. "Your launches" lists and collects from both. **v1 is
DEPLOYED** (`CONTRACTS.launchFactoryV1` = `0xcDb2eC1c487fbcB6B4AF25cCD86aFf8120FaB8a5`, block
52,066,273, fully verified on Blockscout, runtime bytecode identical to `contracts/deployed/`'s
source, every expected value read back from the chain). FIRST REAL LAUNCH, by the owner through the
window, 2026-10-02 (tx 0x58762159…, block 52,066,747): token `0xB200…0dF9`, supply exactly 1e27, the
pool holding all of it but the 5,316-wei dust, no role held by anyone, pool opened at tick 191200 —
and a bot bought ~398 tokens for 0.000002 ETH through Uniswap's UniversalRouter ONE block later, so
the pool is tradable by standard routers with no indexing step. FIRST COLLECT (tx 0xbf2115c1…):
19,994,859,999 wei, 80/20 to the wei. 🔴 MEASURED on the same launch: the
owner's MetaMask Smart Account (EIP-7702) sends the transaction TO MetaMask's `DelegationManager`
(`0xdb9b…7db3`), not to the factory — yet the factory's `msg.sender` (and so the recorded creator and
fee recipient) is still the user's own address, because the 7702 account makes the call. Never infer
the creator from a transaction's `to`/`from`; read the `Launched` event. Metadata is an on-token `data:` URI (image as a
LINK — a picture in storage would cost tens of millions of gas). Not audited.

**2026-10-14 (owner: "make it more fun"):** `taskmgr`, `trash` (Recycle Bin), `soon` (Coming
Soon), `rugsweeper`, `achievements`, `leaderboard`, plus Q, the tray's block clock and sound, the
screensaver, Terminal easter eggs and the Base card on Profile — see Layout. IconMenu shows only
switched-on programs; the Terminal prompt lines up (`.terminal__line`). Wallet: the owner chose
(2026-10-03) a NON-custodial embedded wallet — Coinbase Smart Wallet with a passkey is offered as
the "no extension needed" path; Quadra still never generates or holds a key. The Wallet window
gained "Your fees" (Claim all, Withdraw what a factory owes). A coin launched here now trades on
its own pool inside the app (PoolTrade).

`send` — ETH, USDC, WETH or any token by address, to an address or a Basename. Review reads the
token from its contract, the balance, whether the recipient is a contract or yourself; Send is one
signature. `swap` — Relay (chosen by measurement: no key, CORS open, exact approvals; KyberSwap
403s the owner's country, 0x/1inch/Uniswap need a server key, LI.FI takes 0.25%). A quote older
than a minute is refused at the click. `bridge` (hidden while `FLAGS.robinhood` is false) — Base → Robinhood Chain (4663) through Across:
ETH → ETH, USDC → USDG (there is NO USDC on 4663). Same address only, and REFUSED from a
smart-contract wallet (the same address on 4663 may not be yours). Arrival is measured on
Robinhood Chain's own RPC.

`markets` — a gadget on the desktop (Vista-sidebar style, right edge) and a Markets window
(its Robinhood Chain half hidden while `FLAGS.robinhood` is false), grouped **Base first, Robinhood Chain after** (the owner's rule, 2026-09-30: every feature is
Base first): tokens on Base, Coinbase's stocks on Base (from Coinbase's own Tokenized Stocks API,
through `server/stocks.ts` — it sends no CORS header), then Robinhood's stock tokens on Robinhood
Chain, each with price, 24h change, a chart and its pool's depth. 🔴 PRICES come from DexScreener
(one request per chain for every watched token; CORS `*`, 300/min) and CHARTS separately,
one at a time, from GeckoTerminal through `server/charts.ts`, which caches and serves a
remembered chart marked stale when GeckoTerminal says no. MEASURED on the owner's screen: when
prices were read off GeckoTerminal candles, one rate limit blanked every row. A thin pool's
missing hours are filled with the last price (`fillGaps`). A stock on Base shows its shares per
token (`multiplier` — GOOGLc 1.00038), paused features (DKNGc had transfers paused) and its
Chainlink NAV, and says Coinbase stocks are only for eligible persons outside the U.S.

`trade` — buy or sell a token or a Coinbase stock on Base for USDC or ETH. A front for
`SwapPanel` (`fixed` prop), never a second engine: same Relay quote, `checkSwap`, exact approval,
simulation and arrival measurement. MEASURED first: Relay routes B20 stocks both ways through the
two pinned Relay contracts. Crypto tab = `TRADE_CRYPTO` in `config/markets.ts`, each address
verified on Blockscout; Stocks tab = Coinbase's list, deepest markets first. A stock whose
TRANSFER feature is paused is not quoted at all. A token's price is its last on-chain trade; a stock's is its deepest DEX pair on Base
(DexScreener), with Coinbase's Chainlink NAV shown beside it as a reference; every chart is
on-chain trades from GeckoTerminal. 🔴 Stocks are identified by the contract Robinhood's API names,
never by ticker: MEASURED, "TSLA" on Robinhood Chain has an impostor at $564 claiming $282M of
liquidity. ⚠️ GeckoTerminal's free tier is 30 requests a minute and a 429 arrives WITHOUT a CORS
header — so the app refreshes every 2 minutes and words a failed read as a possible rate
limit, not an outage. `quadra.pools.v1` (a pool memory) is RETIRED since DexScreener began
naming the pool — never reuse that key. 🔴 A polling loop left
running in a shell IS the rate limit: two background `until curl …geckoterminal…` loops from a screenshot attempt
kept this machine's quota spent for an hour and made the gadget read "unavailable" in a real
render. Stop a watcher before blaming the service.

`wallet` lists every browser wallet that announces itself (EIP-6963) by name and icon, plus
WalletConnect and Coinbase Smart Wallet; remembers the pick (`quadra.wallet.v1`, frozen); shows
which wallet is connected and the address with its EIP-55 checksum; and can Disconnect (which
stops reading — it cannot revoke the site inside the wallet, and says so).

`x402` opens on **this app's own tools** (`X402Own.tsx`): pick a skill, give its arguments, and
its URL on this app's API goes through the same any-URL flow — price read from the live 402, the
payee checked against this app's own origin pin (`config/payees.ts` pins `location.origin` to
`CONTRACTS.treasury`), the spending limits, the wallet. Two more ways in are kept and tested
but HIDDEN since 2026-10-02 (`FLAGS.x402Others`): a tool from the BlueAgent directory, or **any x402 URL** — pasted, or
picked from Coinbase's x402 Bazaar (`adapters/http/bazaar.ts`, the second directory; the list
shows no prices, the endpoint is quoted when picked). `adapters/http/endpoint.ts` tries the
endpoint directly and falls back to the forwarder when the browser is refused (CORS). Both
halves sign through one wallet session under one set of spending limits, and the window opens
at prose height because its output box sat below the fold at panel height (MEASURED).

`x402` checks every 402's payee against the payee **pinned for the origin that sent it**
(`config/payees.ts`). An origin with no pin is its own refusal (`Payee` kind `unpinned`),
worded differently from a pinned origin whose payee changed. 🔴 A pin is an assertion, never
a destination — the payee always comes from the live 402. The table is a `Map` because an
object literal answers `["constructor"]` with a function.

`wallet` connects one and nothing else: injected, WalletConnect or Coinbase Smart Wallet, a
chain switch when Base is the only thing wrong, and the connected address shown in full. It
**never creates a wallet on the user's behalf.** That was asked for and declined: a key this
app generates is a key this app custodies, which is hard rule 5 and the owner's call, not a
refactor. ⚠️ Connecting is never required to look anything up, and the panel says so.
`VITE_WALLETCONNECT_PROJECT_ID` was set by ShunTr on 2026-09-30 in `.env.local` (checked valid
against Reown's API, with a fake-id control answering 401). Without it the button throws a named
error rather than calling the SDK with an empty string. Do not invent a project id.

**Flag on, not built:** none, since 2026-09-30. The machinery stays: a window switched on with
nothing in `BUILT` renders an amber notice naming what it waits on (`WAITING_ON`, now `{}`),
with `UNBUILT` derived from `FLAGS` and `BUILT`, and `tests/switched-off.test.tsx` switches
`audit` on to prove the notice still renders. **Do not write a price or a fee into that map** —
the live quote is the only price this repo displays.

**Flag off:** `inference` (a stub with no enclave, off 2026-09-30), `audit`, `hooks` (off-thesis,
2026-09-29); `robinhood` (Bridge and Markets' Robinhood Chain half, Base first, 2026-10-02);
`x402Others` (the x402 window's BlueAgent and any-URL halves — it sells this app's own tools only,
2026-10-02); `webhooks` (off, nothing reads it yet). Rendered dimmed, off rather than deleted, so reversing any is one line in `FLAGS`
— and `tests/switched-off.test.tsx` opens `hooks` and `inference` with the flag flipped, so the
day someone does, they get the panel, not a surprise.

**x402 status:** (BlueAgent's half is hidden by `FLAGS.x402Others`; this is its state when on.)
`tools()` and `quote()` are live against BlueAgent's real catalog (115 tools,
6 of them $0.00). The dev-only Vite proxy at `/upstream` is what makes a BlueAgent run possible
at all — upstream opens GET to any origin and does not open POST. Production needs T3.

---

## Known open items

*(Close an item here in the same edit that closes the work. A resolved entry left in a
known-open-items list is worse than a missing one: the next reader spends their session
re-chasing something that was already fixed, and the list stops being believed. The four
privacy items that lived here — no verifier and no Poseidon, the join-split amount leak, the
Railgun question, `$QUADRA`'s pair — were closed on 2026-09-30 by the privacy model being
archived, not by being solved; they are in `TASKS.md`'s Archive.)*

- **The production server is built, not yet measured on Vercel (T3, 2026-11-04).** Stocks, charts,
  the paid API and the launchpad indexer are Vercel Functions in `api/`; the index lives in a Vercel
  Blob (the owner created the store 2026-11-04; `BLOB_ACCESS=public` only if it is a public store).
  Its first catch-up is ~1.2M blocks from v1's deploy, stepped ≤20 s per request on public RPCs. Before 2026-11-04: Vercel is decided; nothing is deployed. The forwarder, the
  charts cache and the paid API run on the dev server only (`vite.config.ts`). The Vercel functions
  are T3 — and `server/api.ts` imports the app through the `@/` alias, which a Vercel function
  bundle must resolve (measure it at deploy; the dev server does it through `ssrLoadModule`).
- **The paid API SELLS on Vercel since 2026-11-04** (the owner's CDP key in Vercel's env; `/api/skills/verdict`
  answers 402: 50000 = 0.05 USDC to the treasury). No paid call has settled through CDP yet — the first is
  the owner's test. Before that: **The paid API sold nothing until the owner added a CDP key.** `CDP_API_KEY_ID` and
  `CDP_API_KEY_SECRET` in `.env.local` (and Vercel at deploy). Until then the list is live, every
  call is priced, and a paid call answers a named 503. The facilitator client was built from CDP's
  sources and tested with locally generated keys; it has NOT exchanged a request with CDP yet.
  Priced per skill by `SKILL_PRICES` (verdict $0.05 … forensics $0.10); `API_PRICE` ($0.005) is
  only the fallback. All are starting figures for the owner, not measured ones.
- **Fees are ON (0.1%) since 2026-09-30, and collected two different ways.** Relay accrues its app
  fee as a USDC balance held by Relay for `0xD5C1…3FAB`, which has to be CLAIMED from Relay; Across
  pays its app fee directly on the DESTINATION chain (USDG or ETH on Robinhood Chain). Neither
  lands on Base automatically. The WalletConnect project id is set (`.env.local`, checked valid
  against Reown's API with a fake-id control).
- **Relay's swap minimum is not decoded.** Checked: destination, sender, chain, value, exact
  approval. Not checked before signing: the minimum inside Relay's calldata. The review says so;
  the result is measured as a balance change afterwards.
- **Across documents a Bearer key + `integratorId` as required**; measured 2026-09-30 it answered
  without either. If enforced, bridge quotes fail by name ("Across: …").
- **Token Verdict's launcher is not found for every token.** Direct deploys and launchpad tokens
  on a Uniswap v4 pool are found; a launchpad token that trades only on v3/v2/Aerodrome is "not
  checked — no launch transaction on record". The holder list lags a brand-new token ("none
  indexed yet"). GoPlus answers one token per request on the free tier (MEASURED: a two-address
  request returned one), so the radar does not scan code.
- **Launch Radar reads Uniswap v4 only.** v3's `PoolCreated` and Aerodrome's factory are not read.
  It does not yet group launches by launcher — MEASURED, many of an hour's busiest "no hook"
  launches show near-identical liquidity (~$10.5k) and trade counts, the look of one bot farm;
  that is Phase 2 (holder clusters).
- **Public RPCs are not for production** (docs.base.org, Throughput and Limits: "rate-limited and
  are not suitable for production traffic"). Both endpoints `rpc` uses are public. Production (T3)
  needs a provider from Base's Builder Stack — a server-side key, the owner's call.
- **Builder Codes are not set.** docs.base.org: an ERC-8021 suffix appended to calldata attributes
  a transaction to the app on base.dev and "qualifies you for potential future rewards". It needs
  a code from registering Quadra on base.dev — the owner's account, not invented here — and then
  one `dataSuffix` in `lib/transact.ts`.
- **Flashblocks are to be deprecated in the Denim hardfork** in favour of canonical 200 ms blocks
  (docs.base.org, not yet final). `waitForReceipt` polls every 2 s; with 200 ms blocks that is ten
  blocks late per poll. Worth tightening when Denim is scheduled.
- **No stock is enabled on the v2 launchpad yet, and NEITHER version is audited.** v2
  (`contracts/src/LaunchFactory.sol`, ETH or stock pairs, deployed 2026-10-02 at `0xef1F…0c03`) passes 30 tests at 100% coverage on the
  real B20 precompile and a real v4 PoolManager, and the full mainnet simulation with Coinbase's real
  NVDAc (`scripts/simulate-launchpad.ts`) — none of which is an audit. The quote admin still has to
  run the `setQuote` lines `scripts/quote-ticks.ts` prints (contracts/README.md). v1 (`0xcDb2…B8a5`) stays deployed and read. No stock-paired
  launch has been made with real money; that is the owner's test. Both former gaps are built (2026-10-14):
  Withdraw for what a factory `owed`s (Wallet → Your fees) and trading a coin on its own pool (PoolTrade).
- **Launchpad v3 is DEPLOYED (2026-10-22) and NOT audited.** **v3 is DEPLOYED** by the owner 2026-10-22 at `0x006Da367654a487bb277fe25ff54f0fE0f741377` (hook `0x0D9DdcC907658E3C61318d0F979F978e600AA880`, tx 0x151126f0…, block 52,929,530): verified on Sourcify (exact match), read back and checked by the app's own `checkFactory` (ok), 8 stocks enabled (CRCLc, GOOGLc, INTCc, MSTRc, NVDAc, SNDKc, SPCXc, TSLAc). Blue Agent's referrer `0x884fbdd5cf193e7f87cba76419e526d8f4df7a9b` is NOT yet approved — the owner must send `setReferrer` from the treasury `0xD5C1…3FAB`. Still NOT audited. Setting
  `CONTRACTS.launchFactoryV3` (src/config/chain.ts) to the verified address sends NEW launches there
  (1%/3% fee choice, the opening read from the hook), lists v3 first everywhere, and leaves v2/v1 read
  and collected from; until then the app behaves exactly as with v2. `LAUNCHPAD_V3_ABI`/`LAUNCH_HOOK_ABI`
  are held to the Solidity, `LAUNCHPAD_V3_EXPECTS` to the deploy script (tests/launchpad-v3.test.tsx);
  `scripts/simulate-launchpad-v3.ts` runs the app's own `launchTx` and `v4swap` against v3 on mainnet
  state (quotes delivered to the wei). Waits on: the referrer approval, an audit.
  **v3 now includes APPROVED REFERRERS (2026-10-22): 80% creator / 5% referrer / ~15% protocol.** The
  `launch` skill takes an optional referrer and says whether it is approved; the indexer records
  `Referred`; the coin page and Token Verdict show it. After the deploy the OWNER must call
  `setReferrer(<Blue Agent's address>, true)` FROM THE TREASURY (the protocol recipient) — the address
  is ShunTr's to supply, never guessed (contracts/README.md). Until then no referral counts.
- **The launchpad indexer is dev-only and leans on a public endpoint.** It runs in `vite.config.ts`
  (T3 for Vercel) and falls back to Tenderly's public gateway (`gateway.tenderly.co/public/base`) on a
  429 — a third-party endpoint new on 2026-10-14, not production-grade.
- **`v4swap` cannot tell "not enough liquidity" from "no pool".** `rpc()` discards revert data, so
  both read the same; keep the revert bytes to word them apart.
- **Blockscout answered a Cloudflare 403 from this machine on 2026-10-14.** Everything that reads it
  says "not checked" then (Radar's hooks, Rugsweeper); worth watching — it is many skills' source.
- **`$QUADRA` is LIVE** (2026-10-29) and `CONTRACTS.token` holds it since 2026-11-04 (read back from the
  factory's `Launched` event). The "unset" path of `requireContract` is now tested through `assertDeployed`.
- **React `act(...)` warnings** from `WalletProvider` fill the test output (31 of them,
  2026-09-30 — more now that more windows mount the provider) — the synchronous `renderAt` tests do not wait for the wallet read. They are
  noise, not failures, and they bury real warnings; worth an `await settle()` sweep.
