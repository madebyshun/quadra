# TASKS — what is left to finish Quadra

Handoff document. Written 2026-09-27 for a session that has never seen this repo, and
re-pointed on 2026-09-30 when the owner changed what the product is (see "The direction").
Read `CLAUDE.md` first — it has the constraints and the rules that exist because
something broke. This file is only the work.

**Before you start anything:** `npm install`, then `npm run gate`. It must be green
(tsc clean, **2229 tests in 123 files** as measured 2026-11-12 (the Weekend window); 2216/122 earlier that day (Trade Depth); 2206/121 earlier that day (Collateral Watch); 2191/120 on 2026-11-11 (Base's 0.2 s block clock); 2187/119 on 2026-11-04; 2167/115 before the About page; 2165 before Home cleared the URL; 2164 before asSent; 2162 before BASE_RPC_URL; 2161 before OIDC Blob; 2151 before the stored indexer; 2147/113 on 2026-10-29; 2145 before Home; 2136/112 before the furnace block; 2135 before Relay v3.2; 2134 before the deployer was wired; 2104/107 earlier that day; 2085/105 on 2026-10-28; 2081 on 2026-10-22, after Explore Base, the coin page's CA and the compact small-number format (2049/102 earlier that day, after v3's approved referrers reached the app; 2041/102 earlier that day, after the desktop was reorganised into folders; 2017/101 on 2026-10-21; 1971/97 before the Welcome screen and the Paint card, 2026-10-21) as measured 2026-10-21, after the coin chart's frames and opening price — 1968/97 earlier that day after wiring the app to launchpad v3, 1945/96 on 2026-10-14 (1918/95 before the coin page, same day), 1684/76 on 2026-10-02, 1682/76 before the doc
audit's fixes —; `npm run gate:contracts` 119 tests (v2 30 + v3 59 + RevenueShare 30, 2026-10-28; 89 = 30 + 59 with approved referrers, 2026-10-22; 77 = 30 + 47 before), 100% over 4 files — 100% on
statements/branches/functions/lines, build succeeds). If it is not green on a fresh
checkout, fix that before touching a task — you are looking at drift, not at your own
change. ⚠️ The count FELL on 2026-09-30, from 1353/45, deliberately: the privacy model
was archived (its tests went with it to `archive/privacy/tests/`), then the skills added
their own. It fell again on 2026-10-02, from 1627/68, when o1 was taken out of Launch and its
tests archived to `archive/o1/`. A drop you cannot account for like that is still the checkout,
not your change.

The Solidity gate is back for the launchpad: `npm run gate:contracts` (Base Foundry). 30
tests, 100% of `contracts/src`; not part of `npm run gate`. (The shielded pool's Foundry
project stays in `archive/privacy/contracts/`.)

**Before you report anything done:** `npm run gate` again, green, all three parts.
Say which three. "Build is green" has been used to mean "tsc passed" and it was not.

---

## The direction — decided by ShunTr on 2026-09-30

**Read this before picking a task.** It replaces the 2026-09-29 direction ("private money
for AI agents"), which is kept in the Archive at the bottom with the reasoning behind it.

> **Quadra is an on-chain supercomputer for Base: look up any wallet, token or
> transaction, scan for traps before you act, and send, swap, bridge and launch — every
> action signed in your own wallet. It never holds your key.**

The owner's words, 2026-09-30: drop the private send; reposition as an "on-chain
supercomputer"; the server is on **Vercel**; the **o1 API key will be provided**; launch is
**always public** and the "private" model is dropped; **build it complete locally first —
the owner tests each feature before anything is deployed to production.**

What was decided with it:

| Decision | Status |
|---|---|
| Position as above | **done 2026-09-30** — `brand.ts`, `index.html`, Docs, every window's copy |
| Drop the privacy model: shielded pool, notes, backups, private send, the `router` feature | **done 2026-09-30** — ARCHIVED, not deleted: `archive/privacy/` (src, tests, contracts) |
| One skill, three ways in: a window, the Terminal, and (P4) an MCP tool | **done 2026-09-30** — `src/skills/`, see T12 |
| Server on Vercel — the forwarder and every server-held key live there | **decided**; see T3 |
| Launch goes through o1's public API, always public | **REPLACED 2026-10-02** by this app's own launchpad (T22), paired with ETH or a Coinbase stock; o1 taken out of Launch and archived under `archive/o1/` |
| Send, swap (Relay), bridge to Robinhood Chain (Across) — each checked before the wallet | **built in development 2026-09-30** — T13, T14, T16 |
| Connect any browser wallet by name (EIP-6963), remember the pick, disconnect | **built in development 2026-09-30** |
| `inference` switched off — a stub with no enclave behind it | **done 2026-09-30** (off, not deleted) |
| Fees: swap and bridge integrator fee (the o1 referral share was archived with o1, 2026-10-02). Every fee OFF while `CONTRACTS.treasury` is `null` | **decided**; the address and the percentages are ShunTr's — see "Decisions" |

The phases. A phase does not start until the one before it is green **and the owner has
tested it locally**:

- **P0 — Foundation.** The skill shape (`Skill` → `Report`), the Terminal, and the rule
  that every report names its sources. **Done in development 2026-09-30.** The Vercel side
  is T3 and waits until there is something server-side to run (T17 is the first).
- **P1 — Read skills** (no money moves). Done 2026-09-30 (T12), then replaced 2026-10-01 by
  Token Verdict, Gate, Radar, Forensics, Launcher and Send Check (T21).
- **P2 — Write skills** (you sign). Send (T13), swap with an integrator fee (T14), revoke
  approvals (T15), bridge — Across to Robinhood Chain (T16), hidden since 2026-10-02.
- **P3 — Launch** — through this app's own launchpad on Base (T22), ETH or stock pairs. o1 (T17)
  was the first route and is archived.
- **P4 — Agents** (T18). Every skill as an MCP tool; write skills as *prepared, unsigned*
  transactions an agent requests and the owner approves.

**What Quadra must be that Base Rooms is not** — the closest product (a desktop OS on Base
with trade, safety, research, a terminal, MCP agents, and o1 launches). With privacy gone,
the difference is: (1) **checked before signed** — live prices only, addresses verified,
no guessed numbers, every report naming what it could not check; (2) **agent-first** — every
skill an MCP tool, and paid x402 endpoints of any origin already payable (T11).

### Fees, as answered to the owner on 2026-09-30

| Where | Rate | Who sets it |
|---|---|---|
| Swap (aggregator integrator fee) | 0.1% proposed | ShunTr — confirm |
| Bridge (Across app fee, paid on Robinhood Chain) | 0.1% | ShunTr — confirm. Bridge hidden since 2026-10-02 |
| Launchpad | 20% of each pool's 1% fee (80% to the launcher) | the contract (T22) |
| x402 skills over this app's API | $0.005–$0.10 per call (`SKILL_PRICES`) | ShunTr — starting figures |
| The skills in the app and over MCP | free | — |

All of them pay `CONTRACTS.treasury` — **set by ShunTr on 2026-09-30 to
`0xD5C1dFc036F9911348EA8065F73c8123f4013FAB`** (measured: a wallet with an EIP-7702 MetaMask
Smart Account delegation, one key on Base and on Robinhood Chain), so swap and bridge fees are
**ON at 0.1%**. Relay's fee accrues at Relay and must be claimed there; Across's is paid on
Robinhood Chain.

---

## Where the product actually is

| Window | Flag | State |
|---|---|---|
| `wallet` | on | built — every browser wallet by name and icon (EIP-6963), WalletConnect, Coinbase Smart Wallet; remembers the pick; shows which wallet and the EIP-55 address; Disconnect. **Never creates a wallet** (hard rule 5). `VITE_WALLETCONNECT_PROJECT_ID` set 2026-09-30 (valid). **Switch account** opens the wallet's account picker (`wallet_requestPermissions`); Disconnect revokes the site's access |
| `terminal` | on | **built 2026-09-30** — every skill, typed; `help` lists them. Output is `reportText`, the same text an agent will read |
| `research` | on | **rebuilt 2026-10-01** — Radar, Verdict, Forensics, Launcher (T21) |
| `safety` | on | **rebuilt 2026-10-01** — Verdict (a simulated buy-and-sell, the code, the holders, the launcher, the market; three answers and a score), Gate, Send Check (T21) |
| `markets` | on | **built 2026-09-30** — desktop gadget + window: Base tokens and Coinbase stocks on Base, prices from DexScreener, charts from GeckoTerminal, 24h change, sparkline, 1D/7D/30D chart; the Robinhood Chain half is hidden (`FLAGS.robinhood`) |
| `trade` | on | **built 2026-09-30** — Crypto/Stocks on Base, Buy/Sell for USDC or ETH through Swap's engine (T19) |
| `send` | on | **built 2026-09-30** — ETH or any token to an address or Basename; one signature (T13) |
| `swap` | on | **built 2026-09-30** — Relay; exact approval + swap to pinned verified contracts; result measured afterwards (T14) |
| `bridge` | **hidden** (2026-10-02, Base first) | **built 2026-09-30** — Across to Robinhood Chain 4663: ETH → ETH, USDC → USDG; calldata decoded and checked; arrival measured on 4663 (T16) |
| `coins` | on | **built 2026-10-02** — the launchpad's front page, o1-style, as a window: numbers, All/Crypto/Stocks, Trending/Vol/New/Liquidity, a page per coin (`?do=coins&t=0x…`) with buy/sell, fees and a verdict |
| `profile` | on | **built 2026-10-02** — any wallet (`?do=profile&a=`): who, holdings (launchpad coins read on chain), coins launched + Collect all, activity with address-poisoning lures named |
| x402 tools | on | **built 2026-10-02** — gate, forensics, launcher, sendcheck, launch (prepared), radar scored; priced per skill; the x402 window sells only this app's own tools (BlueAgent and any-URL hidden, `FLAGS.x402Others`). Next: list them on the Bazaar — needs the CDP key and T3 |
| `launch` | on | **this app's launchpad (T22)** — v1 (ETH) deployed and launched on; v2 (ETH or Coinbase stock pairs) deployed 2026-10-02 at `0xef1F…0c03`, no stock enabled yet. o1 taken out 2026-10-02 |
| `x402` | on | built — sells this app's own tools (`X402Own`); BlueAgent and any-URL (T4, T11) are kept but hidden behind `FLAGS.x402Others = false` |
| `mcp` | on | built, read-only: 5 own tools plus every skill as `quadra_<id>` (7) — T18 |
| `taskmgr` `trash` `soon` `rugsweeper` `achievements` `leaderboard` | on | **built 2026-10-14** (T23) — Task Manager, Recycle Bin, Coming Soon, Rugsweeper, Achievements, Leaderboard; plus Q, block clock + sound, screensaver, easter eggs, Base card |
| `inference` | **off** | switched off 2026-09-30 — a local stub, no enclave |
| `audit` | **off** | switched off 2026-09-29 (T5) |
| `hooks` | **off** | switched off 2026-09-29 — a working read-only panel, off-thesis |

Flags that are not windows: `robinhood` (off — hides Bridge and Markets' Robinhood half),
`x402Others` (off — see `x402`), `webhooks` (off, nothing reads it yet).

Flags live in `src/config/chain.ts` → `FLAGS`. The "built" set is `BUILT` in
`src/features/FeaturePanel.tsx`. A panel is honest today; the failure mode to avoid
is making one *look* finished before it is.

Each amber notice names its own blocker — `WAITING_ON` in the same file, with `UNBUILT`
derived from `FLAGS` and `BUILT` rather than typed out, and a test asserting the two
agree in both directions. A switched-off window has no entry there on purpose: a reason
kept for a window nobody can open is an excuse for nothing.

In `src/config/chain.ts` → `CONTRACTS`, `treasury`, `launchFactory` (v2) and
`launchFactoryV1` are set and verified; `token` is `null`, deliberately — and load-bearing. `requireContract()` throws naming the unset
constant. **Do not put a zero address anywhere.** A zero address in a payment path looks
real and fails silently.

---

## ~~T1 — Stop `/api` describing endpoints that do not exist~~ — DONE 2026-09-27

Took option (a). `src/pages/ApiPage.tsx` now says outright that this is a single page
with no server behind it, lists the two endpoints as `not built`, and prints no `curl`
for either — a copyable command is a promise the thing answers. The only URL shown as
a command is upstream's catalog, because that one genuinely resolves.

Honesty is structural rather than well-worded: each endpoint carries a `live` flag,
the badge derives from it, and `tests/api-page.test.tsx` asserts the property — no
command on the page may name this origin. `apiLede` and `endpointBadge` take their
input rather than reading `ENDPOINTS`, so the wording that ships the day an endpoint
goes up is already tested. Same pattern as `installLine` and `assertDeployed`.

Fixed alongside it: `.notes__row` is a three-column grid sized for SendPanel, so any
row with two children had its second stretched by the `1fr` column — the MCP panel had
been rendering its capability chips as full-width bars. `.notes__row > .chip` now has
`justify-self: start`. 473 green tests never saw it; the chip had the right class and
the right text the whole time.

---

## ~~T2 — The document overflows the viewport at 390px~~ — WITHDRAWN, there is no such bug

**Status:** closed 2026-09-27 as a false finding. Left in place rather than deleted,
because the next person to shoot a narrow screenshot will see the same thing and
needs to know it was already chased.

The claim was that at 390px the document is wider than the window on `/` and `/api`.
**It is not.** Measured by loading the app in an iframe of a known width and reading
`documentElement.scrollWidth` against `clientWidth` — 6 paths × 3 widths
(390 / 360 / 320), 18 combinations, **zero overflow, zero elements past the right
edge.** The layout is fine: at 390px the cards collapse to one column, the tagline
wraps, the chips wrap to a second row and the taskbar fits.

**The bug was the measuring tool.** `--window-size=390,300` reports `innerWidth=500`
— headless Chrome clamps its viewport to a minimum and the PNG is a 390px crop of a
500px render. Everything looks sliced off at the right edge because it literally was,
by the screenshot rather than by the CSS.

If you need a genuine narrow render, use the iframe method in `CLAUDE.md`. And take
the general lesson with you: when the tool and the assertion disagree, suspect the
tool before writing the finding down.

---

## T3 — Decide and build the production forwarder

✅ **Where: decided 2026-09-30 — Vercel.** The owner chose it along with the new direction.
What is left is the project itself and the allowlist, and it waits until there is something
server-side worth deploying: the first is the paid API (`server/api.ts`) with the CDP key,
then the forwarder, charts and stocks. `api/` is already
in `tsconfig.json`'s include list and is empty. Nothing deploys until the owner has tested
locally. The reasoning below is kept because it is still why a server is needed at all.

**Size:** medium. **Blocks: T4, and the entire x402 surface at launch.** This is the
real architectural gap and it is currently invisible because development papers over it.

A run is a POST. Upstream opens GET to any origin and **does not open POST at all**
(measured 2026-09-27: the `OPTIONS` preflight answers 204 with no CORS header, and a
plain-text POST answers 200 with none either). So the browser blocks every run —
including the six that cost nothing — unless it is same-origin.

`vite.config.ts` proxies `/upstream` in development. **A static production build has
no server, so there is no forwarder.** `HttpCatalog.run` already knows this and checks
the response body rather than its status, because an absent forwarder answers 501 with
an HTML error page on a plain static host and 200 with `index.html` on one doing SPA
rewrites — neither status says "no forwarder".

So the choice is:
- **(a)** Stop being a static build. Put the app on something with a server route
  (a Next app, a Vercel/Netlify function, a Cloudflare Worker) that forwards
  `/upstream/*` to `https://blueagent.dev/*`. Matches the dev proxy exactly, so
  nothing else changes.
- **(b)** Get POST opened up on the upstream origin. That is a change to `blue-agent`,
  **which this project is forbidden from making** — it would have to be asked for, not
  done. Note that this also makes the payment path cross-origin, which is a different
  security conversation.
- **(c)** Ship without runs and say so on the panel.

**(a) is the obvious one**, but it changes the deployment target, so **confirm with
ShunTr before building it.** Do not silently convert the repo to Next.

⚠️ **Widened 2026-09-29 by T11 — and half-answered.** The forwarder now EXISTS as code:
`src/server/forward.ts`, a Fetch-API handler (`Request → Response`) that Cloudflare Workers,
Vercel/Netlify functions and Node 18+ all run unchanged, mounted on the dev server by
`vite.config.ts`. So this task is no longer "build a forwarder" — it is **where to run
`forward`, and with which `allowOrigins([...])`**. Running it with `anyPublicHttps` (the dev
policy) in production would make it an open proxy; its header explains the four limits it
has and the one it cannot have without a resolver (a public name resolving to a private IP).
The `/upstream` BlueAgent proxy is still separate and could be folded into it.

**Done when:** a production build, served the way it will really be served, runs a
free tool end to end — and the honest-failure path still works when the forwarder is
absent.

---

## T4 — Wallet + EIP-3009 signing, so paid runs work

**Size:** large. This is the biggest remaining piece of the product. **Blocked by T3**
(a signed payment still has to reach upstream through a same-origin POST).

Today `catalog.whyNot(price)` refuses every paid price because there is no signing
code. 109 of the 115 catalog tools are paid. Making them run means:

1. **Connect a wallet.** ✅ **DONE 2026-09-28** — `src/lib/wallet.ts`, 65 tests, taken
   ahead of T3 for the same reason as steps 2 and 3: connecting a wallet needs no
   forwarder and no owner decision. `readWallet` / `connectWallet` / `requestBaseChain`
   all end by re-measuring, because EIP-3326 has `wallet_switchEthereumChain` resolve
   `null` both when it switched and when it decided not to — so its return value carries
   no information and prompt-and-hope is not even available. An error from the request
   can only *relabel* that measurement, never replace it. See **Step 1l** under T7 for
   the near-bug this avoided (a hex string comparison against `BASE.idHex` that passes
   for Base and silently breaks for any chain id containing `a`–`f`), and for why this
   build refuses to call `wallet_addEthereumChain`. **Now wired in** — `src/ui/WalletStatus.tsx`
   is the panel; the "not wired into any panel yet" note above described an earlier point
   in this same day and is stale (left here as the record of how it was measured, not as
   current status — see step 6 below for the panel wiring).
   **Two more connectors, same day** — `src/lib/connectors.ts` adds `walletConnectProvider`
   and `coinbaseProvider`, both dynamically `import()`ed so neither SDK is in the main
   chunk until a user clicks the button that needs it (measured: the build produces a
   separate ~117 kB chunk, main chunk grew 256.01 → 258.01 kB). Both return a plain
   `Eip1193Provider` and plug into the *existing* `connectWallet`/`readWallet`/
   `requestBaseChain` unchanged — no wagmi, no React context, no new state-management
   layer, because those three functions already took `provider` as an optional parameter.
   `WALLETCONNECT_PROJECT_ID` in `src/config/connectors.ts` is `null` until
   `VITE_WALLETCONNECT_PROJECT_ID` is set (see `.env.example`) — same shape as
   `CONTRACTS.shieldedPool`, refused rather than guessed. **Still open:** ShunTr has not
   yet supplied a real Project ID, so `walletConnectProvider()` is exercised in the live
   preview only as far as its own refusal message; nobody has connected a real
   WalletConnect session against this build yet. Coinbase Smart Wallet needs no Project ID
   and is otherwise untested against a real wallet for the same reason nothing in T4 was
   until today: there is no owner-in-the-loop way to click a real popup in this session.
2. **Read the payment requirements off the live 402 — and CHECK them.** ✅ **DONE
   2026-09-28** — `src/lib/requirements.ts`. It did not end up being an assertion pass over
   `Price`, because measuring the live 402 proved that impossible: `Price` kept four of the
   seven fields and dropped `scheme`, `extra` and `maxTimeoutSeconds`, which are the three
   that matter. So the check *became* the parse, and `Price`'s `paid` variant now carries a
   `PaymentRequirements` and nothing else — there is no way to hold a displayable price that
   was not checked. Two things the plan above got wrong and the measurement fixed: `network`
   is CAIP-2 `"eip155:8453"` (asserting against `BASE.id` directly would have refused every
   real 402), and upstream asks for `maxTimeoutSeconds: 120` where this build's fallback said
   600. See **Step 1k** under T7 for the measured table, the per-field authority asymmetry,
   and why an unrecognised payee is a value rather than a throw.
3. **Sign an EIP-3009 `TransferWithAuthorization`.** ✅ **DONE 2026-09-28** —
   `src/lib/eip712.ts` has the digest half (`authorizationDigest(USDC_DOMAIN, auth)`,
   domain separator verified equal to the deployed contract's own `DOMAIN_SEPARATOR()`
   on Base — see **Step 1j** under T7). `src/lib/payment.ts` has the rest:
   `signAuthorization` calls `eth_signTypedData_v4` with the `types`/`domain`/`message`
   `typedDataFor` builds from one `Authorization`, and checks the answer is a well-formed
   65-byte signature before returning it. **There is no `{v,r,s}` split** — measured
   against the only client of this payee that has actually been paid (upstream's own
   `HubView.tsx`), which passes the packed hex string straight through and lets the
   facilitator recover the signer; see the module header in `payment.ts` for the full
   argument. `signAuthorization` holds no key (rule 5) — it asks the wallet passed to it,
   same boundary as `eip712.ts` and `requirements.ts`.
   Also added, measured the same day: `SETTLEMENT_SLACK_SECONDS` in `eip712.ts` (60s,
   copied from that same working client) and the `askedSeconds`/`lifetimeSeconds` split
   in `PaymentRequirements` — the signed window is now the ask plus slack, capped at
   `MAX_AUTHORIZATION_SECONDS` on the **signed** total, not the ask. Without the slack, a
   payee asking for exactly `maxTimeoutSeconds` got a signature that could expire before
   settlement finished.
4. **Base64 the authorization into an `X-PAYMENT` header.** ✅ **DONE 2026-09-28** —
   `paymentHeader` in `src/lib/payment.ts`, wire format also measured off `HubView.tsx`:
   `accepted` mirrors the 402's `accepts[0]` field for field (including the key that was
   missing from that format until 2026-09-26 upstream), `network` is CAIP-2, and every
   value in the header comes from `requirements`/`auth` rather than being recomputed —
   see the function's own comment for why re-deriving `to` from the payee a second time
   would be the wrong call. **Re-POSTing the tool with this header is still open** — that
   is the forwarder from T3, not this step, and nothing here calls `fetch`.
5. **Read the settlement back.** ✅ **DONE 2026-09-28** — unchanged from the plan:
   `Settlement`'s three variants still gate on `kind === "settled"` for a `txHash`, and
   no `paid: boolean` was added. `X402Panel` renders whichever variant `catalog.run`
   returns; it does not infer settlement from anything else.
6. **Wire steps 1–4 into a panel, then relax `whyNot`.** ✅ **DONE 2026-09-28** —
   `X402Panel.tsx`'s `go()` now signs only when `wallet.kind === "ready"`
   (`injectedProvider` → `authorizationFor` → `signAuthorization` → `paymentHeader`),
   and otherwise calls `catalog.run(toolId, input)` with no payment at all, trusting the
   adapter to answer honestly either way — `LocalCatalog` runs it anyway (its documented
   contract), `HttpCatalog` throws its own legible `NO_WALLET` message. The Run button is
   **no longer gated on wallet state** — that was the actual bug, not a missing
   `whyNot(wallet)` parameter: the button and `go()` were blind to which adapter was
   behind the quote, so a wallet-less run of a *free-to-run-locally* paid stub was being
   blocked for a reason that had nothing to do with the adapter in front of it.
   `Catalog.whyNot` itself was **not changed** — it stayed per-price the whole time
   (`LocalCatalog.whyNot` always returns `null`; `HttpCatalog.whyNot` reports only an
   unrecognised payee, never a missing wallet — re-read it, it never composed a
   `NO_WALLET` reason to begin with). The ⚠️ note above about deleting `NO_WALLET` from
   that string described a design that was not actually in the code; the real fix lived
   entirely in the panel.

**Hard constraints:**
- The panel must keep re-quoting on every tool change. A stale price is how someone
  signs for the wrong amount — that is the whole reason `Tool` does not carry a price.
- The button label must keep saying what it will do. `"Run for 0.05 USDC"` and
  `"Run — free"` are different promises; a bare `"Run"` that sometimes charges is the
  one wording this surface exists to avoid.
- **Quadra is the buyer here, not the seller.** It signs an authorization; BlueAgent
  settles it. `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` in `.env.example` and the `CDP`
  block in `src/config/upstream.ts` are the *seller* side. **Work out whether this
  build needs them at all before wiring anything to them** — if it does not, say so
  and leave them unused rather than inventing a use.

**Done when:** a paid tool runs, the USDC actually moves on Base, the receipt shows a
real `txHash`, and a run with no wallet connected still fails honestly instead of
throwing something the user cannot read.

---

## T5 — Build `audit` — ⏸ SWITCHED OFF 2026-09-29, not planned

**Not part of the product as positioned** (see "The direction" at the top). The flag is
off, the notice is gone, and nothing here should be built unless ShunTr turns it back on.
Kept below as a record of what was measured, because the measurements are still true.

**Size:** small-to-medium. **Blocked by T4 — measured 2026-09-27, no longer a guess.**

This task used to say "check the live quote first — it may be one of the six free ids."
It was checked. It is not:

| id | live quote | what it is |
|---|---|---|
| `repo-health` | **402**, 200000 base units, eip155:8453 | the repo scorer this panel would call |
| `blue-audit` | **402**, 1000000 base units | the heavier audit, same answer |
| `blue-doctor` | 200, free | a diagnostic, not a repo scorer |

The six free ids are `blue-doctor`, `hood-live`, `hood-track-record`, `picks-check`,
`rh-rwa-verify` and `rh-token-scan`. **Not one of them scores a repo.** So nothing in
this panel can run until something here can answer a 402, which is T4.

Do not build it early. A purpose-built form with a live quote and a permanently disabled
button adds nothing the x402 window does not already do, and it would fail this task's
own done-condition on the day it shipped.

When T4 lands: `audit` is not new compute. It is an x402 call with a narrow form and a
readable result. Look at `X402Panel.tsx` for the quote → input → run → receipt shape and
build the one-tool version of it. Re-quote `repo-health` then rather than trusting the
table above — the amount is a dated measurement, and the panel must show the live price
regardless.

**Done when:** it scores a real repo from a real source, and it does not invent a
number when the source has nothing to say. "Cannot assess" is the correct answer to
absent data — never a fabricated low score.

---

## T22 — This app's own launchpad on Base — v1 ✅ DEPLOYED 2026-10-02 (`0xcDb2…B8a5`); v2 (stock pairs) ✅ DEPLOYED 2026-10-02 (`0xef1F…0c03`), ⏳ no stock enabled yet; v3 (anti-sniper hook) 🔨 BUILT 2026-10-14, NOT deployed; ⚠️ NOT AUDITED

**v3, 2026-10-14:** `LaunchFactoryV3.sol` + `LaunchHook.sol` — 1% or 3% chosen by the creator, an
anti-sniper fee decaying 50% → that fee over 15 s (first buy exempt), the hook deployed by the
factory at a mined CREATE2 salt, factory-only liquidity during the window, `beforeInitialize`
refusing foreign pools (closes a v2 front-run gap). 47 tests at 100%. Simulated: sniper at +1 s paid
46.7%, buyer at +20 s 1%; gas +8.5% over v2.
- [ ] Owner: deploy (`contracts/script/DeployLaunchFactoryV3.s.sol`) — and an audit
- [ ] Wire the app: `launch(… fee)`, pool key fee = `0x800000` (dynamic), new `LAUNCHPAD_EXPECTS`

The owner, 2026-10-02, after a test launch on o1 succeeded: "not o1 as the launchpad — build our
own on Base". Chosen: own contracts (factory + locked liquidity), 1% pool fee, 80% launcher / 20%
this app. Built: `contracts/src/LaunchFactory.sol` (+ 21 Foundry tests at 100%, `gate:contracts`),
`scripts/simulate-launchpad.sh` (since replaced by the `.ts`; deploy → launch → collect on real mainnet state — MEASURED,
the launcher got 90.5M tokens for 0.5 ETH, collect paid 0.004 ETH / 0.001 ETH), the deploy script
for the owner, and the Launch window's "Base launchpad" half. Read contracts/README.md.

**Deployed by the owner 2026-10-02** at `0xcDb2eC1c487fbcB6B4AF25cCD86aFf8120FaB8a5` (tx
0xc51a517c…, block 52,066,273, 0.0000123 ETH). Checked before it went into `CONTRACTS.launchFactory`:
fully verified on Blockscout, bytecode identical to this repo's build, every parameter read back.
**First real launch, by the owner, 2026-10-02:** tx 0x58762159…, token `0xB200…0dF9` — read back from
the chain: supply 1e27, no roles held, pool at tick 191200, creator = the owner's address (sent via
MetaMask's 7702 DelegationManager); a bot bought one block later through Uniswap's UniversalRouter.
An audit before real money at scale is advised.
**Done after the deploy (2026-10-02):** Token Verdict recognises launchpad tokens (the contract's
guarantees as rows, the creator from the factory — the generic path had said "through
DelegationManager" for a MetaMask 7702 launch); the radar names this launchpad; the Launch window
lists the wallet's own launches with the fees `collect` would pay now, one Collect each. Trading
needed nothing: MEASURED, Relay quoted both a buy and a sell of the first launch minutes after it.
Fixed on the way: a SELL refused by Relay as "impact too high" painted every fresh single-sided
launch red (Relay prices the sell before the simulated buy) — now "not checked".
**v2 — stock pairs, built 2026-10-02** (the owner: "pair with stocks on Base like o1, and take o1
out of Launch"). `contracts/src/LaunchFactory.sol` is v2: a quote admin (the deployer, two-step to
hand on) enables quote assets with an opening tick (`setQuote`); a launch names its quote — ETH or
an enabled asset — and its first buy in that quote (an asset pulled by `transferFrom` after an exact
approval); either pool orientation; fees in both currencies, anything a recipient or a stock's
policy refuses kept in `owed` for `withdraw(currency)`. 30 Foundry tests at 100%; the mainnet
simulation (`scripts/simulate-launchpad.ts`) ran deploy → enable NVDAc → buy NVDAc via Relay → an
ETH launch and an NVDAc launch with first buys → collect both, every call succeeding against
Coinbase's real NVDAc. `scripts/quote-ticks.ts` prices each stock's tick from live prices
(8 decimals — hard rule 3). v1's source is kept byte-for-byte in `contracts/deployed/`. The app
reads BOTH factories (`factories()` in `skills/launchpad.ts`): verdict, radar and "Your launches"
cover v1 and v2; the Launch window offers ETH plus every stock v2 has ENABLED (re-read at Review,
transfer-paused stocks never offered), approves exactly, and shows fees in the quote's own units.
o1 was taken out of Launch the same day and archived (`archive/o1/`, with how to bring it back).
**v2 deployed by the owner 2026-10-02** at `0xef1F427bB57e0ECd7BB8051cE8bC7AAb709a0c03` (tx
0xd05554c5…, block 52,068,913, ~0.0000166 ETH): verified, bytecode identical with immutables masked,
every value read back, set in `CONTRACTS.launchFactory`. **The owner's step left:** run the `setQuote`
lines `npx vite-node scripts/quote-ticks.ts 0xef1F427bB57e0ECd7BB8051cE8bC7AAb709a0c03` prints. Not built: a `withdraw(currency)` button (`owed`).
**Next, not started:** simulate the round trip for v4 pools whose key is known (a launchpad pool,
or one found by its Initialize log) through Uniswap's UniversalRouter, so a fresh pool's sell is
measured instead of "not checked".

---

## T23 — "Make it more fun" — ✅ BUILT in development 2026-10-14

The owner, 2026-10-14: "make it more fun", positioning kept. Tier A+B built (a "Base Apps"
directory dropped by the owner; `$QUADRA` stays postponed — T9). Details in CLAUDE.md's Layout.
- [x] Task Manager, block pulse (one poller, 4 s), tray block clock + sound (off by default)
- [x] Recycle Bin (≥90% liquidity gone in 3 h, unread receipts counted), Coming Soon folder
- [x] Q the assistant (real events only), Terminal easter eggs, screensaver
- [x] Rugsweeper, Achievements, Leaderboard, Base card (Profile)
- [x] Wallet "Your fees": Claim all + Withdraw what a factory owes; Coinbase Smart Wallet (passkey)
      as the no-extension path (non-custodial, owner 2026-10-03)
- [x] Trade a launchpad coin on its own v4 pool (Quoter + Universal Router + Permit2)
- [x] Launchpad indexer (dev server only) and launchpad recognition (basepad, Feel.cash/Doppler,
      Clanker, Zora); origin never names a 7702 relay or a bundler
- [ ] The indexer on Vercel (T3), off Tenderly's public gateway
- [ ] v4swap: keep revert data so "no liquidity" and "no pool" read differently

## T21 — Market-grade intelligence: Token Verdict + Launch Radar — ✅ PHASE 1 DONE in development 2026-10-01

The owner, 2026-10-01: Research, the x402 tools and the MCP tools must be worth paying for — not
what Basescan already shows. The seven basic skills of T12 were **deleted outright** ("Xóa hẳn");
their shared helpers stay as library code. Three phases, in the owner's order:

1. ✅ **Token Verdict** (`verdict 0x…`) and **Launch Radar** (`radar [minutes]`) — `src/skills/
   verdict.ts`, `simulate.ts`, `origin.ts`, `radar.ts`. Tested on real captures
   (`tests/fixtures/verdict/`, `tests/fixtures/radar/`), checked live in the browser. In the
   Research and Safety windows, the Terminal, the paid API and MCP (the bundle is rebuilt).
2. **Early buyers / snipers + Holder clusters** — who bought in the first blocks, and which
   holders share a funder. Next. The radar's busiest "no hook" launches already look like one
   bot farm (near-identical liquidity and trade counts) — clusters should be able to say so.
3. **Stock premium radar** (Coinbase stock tokens' DEX price vs NAV, Robinhood's quote beside it)
   and an **x402 Inspector**.

Not chosen this round: a wallet profiler / smart money. Proposed and waiting on the owner: a
Catalyst Watch (which notable X accounts mention or follow a token) — it needs X data, a server
key or a source bought over x402.

What measuring taught, in CLAUDE.md under `src/skills/`: Blockscout's etherscan-style API is
unusable (10 requests per ~45 min); launchpad tokens have no creator on Blockscout and are found
through their v4 pool; publicnode refuses old logs; Relay's "impact too high" is a measurement.

---

## T12 — Skills, the Terminal, Research and Safety — ✅ DONE 2026-09-30, ⚠️ SKILLS DELETED 2026-10-01

> The seven skills below were deleted on 2026-10-01 by the owner's decision (T21). The table is
> kept as history; none of these commands exists any more.

P0 and P1. **Built:** `src/skills/` — seven read skills, each a `Skill` that answers in a
`Report` (rows, notes, sources), reached from a window (`SkillWindow`), from the Terminal
(`parseLine` / `reportText`), and next from MCP (T18). Every source was measured live before
its parser was written, and the tests run against those captures (`tests/fixtures/base/`,
with the curl commands in its index) through a fake network (`tests/net.ts`) that fails any
test making a call no route answered.

| Skill | Terminal | Reads | Worth knowing |
|---|---|---|---|
| wallet | `wallet jesse` | RPC, Blockscout, DexScreener | only PRICED tokens are listed — a famous wallet had 12,737 entries, 262 priced; the rest are mostly airdropped lures |
| token | `token 0x…` (`scan`, `safety`, `honeypot`) | GoPlus, Blockscout, DexScreener | GoPlus's field set depends on the token (BRTC: no honeypot flags at all), so every flag is yes / no / **not checked**; traps are red, owner powers amber |
| holders | `whales 0x…` | Blockscout | holders carry no decimals; "contract" marks pools and bridges |
| tx | `tx 0x…` (`explain`) | Blockscout | the sentence is built from the transfers; an unverified call shows its raw selector |
| read | `read 0x… [fn] [args]` | Blockscout ABI, RPC | proxy + implementation ABIs merged, calls go to the proxy; arrays/tuples refused by name |
| name | `name jesse` | RPC (Basenames registry) | a reverse record is a claim — only shown as verified when the name resolves back |
| gas | `gas` | RPC, DexScreener | L2 execution fee only; the L1 data fee is not estimated, and the report says so |

Two real defects the tests caught while this was written, both of the "a missing answer read
as a negative one" kind: `deepest()` returned "no market" for a token whose only pool had no
liquidity figure, and `summary()` compared `undefined` with `undefined` and wrote "unknown
swapped …" about a transaction with no sender.

`npm run smoke -- "gas" "wallet jesse" "token 0x…"` runs skills against the live chain — the
hand-run measurement script, never part of the gate.

**Still open inside P1:** approvals (`revoke` reads them — T15), token price history, a wallet
risk score. None started.

---

## T13 — Send (public) — P2 — ✅ DONE in development 2026-09-30

Built: `panels/SendPanel.tsx` over `lib/transact.ts` + `lib/erc20.ts`. Review reads the token
from its contract, the balance, the Basename's address, and warns on a contract recipient, your
own address, or an ETH send that leaves no gas. `eth_sendTransaction` lives in `transact.ts`,
so `lib/wallet.ts`'s ban stayed. **Added the same day, at the owner's ask** ("show what the
wallet holds so the user can send/swap easily, and add %"): the wallet's own assets on Base
above the form (`WalletAssets` — ETH, then priced tokens by value; a click picks the token) and
25% / 50% / 75% / Max, read from the chain at the click, Max on ETH keeping 0.00005 ETH for gas.
Swap has both too. The original task text follows.

**Size:** medium. Send ETH or any ERC-20 from the connected wallet to an address or a
Basename. `resolveTarget` already turns either into a checksummed address, and the Basename
path is forward-resolved on chain. Amounts through `parseAmount` (hard rule 7); the token's
decimals read from the chain, never assumed (hard rule 3). Signed by the wallet with
`eth_sendTransaction` — which `tests/wallet.test.ts` currently BANS in `lib/wallet.ts`; lifting
that is a deliberate edit to that test, made in the same change, not a surprise.

**Done when:** a send of a small amount on Base goes through the connected wallet, the
window shows the transaction hash linked to Basescan, and a Basename recipient shows which
address it resolved to before the wallet is asked to sign.

---

## T14 — Swap through an aggregator, with an integrator fee — P2 — ✅ DONE in development 2026-09-30

Built on **Relay**, chosen by measurement (report in this session: KyberSwap 403s Vietnam;
0x/1inch/Uniswap need a server-side key; LI.FI takes 0.25%; Odos was down). `checkSwap` refuses
any step not to the pinned RelayApprovalProxyV3 / RelayRouterV3, any approval that is not EXACT,
any wrong value; the app fee is `appFees` in bps and OFF while the treasury is null. Not checked
before signing: the minimum inside Relay's calldata — measured afterwards instead. 🔴 **Fixed
2026-09-30 from the owner's screenshot:** a confirmed ETH→USDC swap said "Your USDC balance rose
by 0" in red. The after-balance was read at `latest` from a node a block behind the receipt.
Arrival is now read from the receipt itself — Transfer logs for a token, balances pinned to the
receipt's block for ETH — and tested against two real Relay receipts. The original task text
follows.

**Size:** large. Replaces the archived T8 (a swap from the private balance). Quote live from
an aggregator on Base, show the route, the minimum received and the fee, and hand the wallet
one transaction (plus an approval when needed). The fee goes to `CONTRACTS.treasury` and is
OFF while that is `null` — a quote with the fee switched off must say so, not hide it.

Before building: **measure** the aggregators' quote APIs (0x, KyberSwap, Uniswap's) the way
T11 measured x402 servers — CORS, key requirements, how the integrator fee is expressed —
and pick with the numbers in hand. A key, if one is needed, lives on the server (T3).

**Done when:** a small swap on Base completes through the wallet at a live quote, the
window shows what was received against what was quoted, and a stale quote refuses to sign.

---

## T15 — Revoke approvals — P2

**Size:** small–medium. Read the connected wallet's ERC-20 allowances (Approval logs, or an
indexer), show spender, token and amount — "unlimited" named as such — and prepare the
`approve(spender, 0)` for the wallet to sign. The read half is a P1 skill (`approvals`) and
belongs in the Terminal too.

---

## T16 — Bridge — P2 — ✅ DONE in development 2026-09-30, to Robinhood Chain (owner's choice)

Built on **Across**, Base → Robinhood Chain 4663 only. CCTP was not an option: Robinhood Chain is
not a CCTP domain and has no USDC — USDC arrives as **USDG** (Paxos, 6 decimals,
`0x5fc5…d168`, listed in Robinhood's docs and read on chain). Across over Relay because its
deposit calldata states the terms, so `checkBridge` decodes it with the verified ABI and checks
recipient = you, token, amounts, chain 4663 and an empty message. Across's own approval is
UNLIMITED and ignored. Refused from a smart-contract wallet. Tokenized stocks exist only on 4663
and cannot be bridged from Base. The original task text follows.

**Size:** large. USDC through Circle's CCTP (burn on Base, attest, mint on the destination —
two signatures and a wait, and the window must show all three states). Other tokens through
Li.Fi, with its integrator fee under the same `treasury` rule as T14. Every contract address
verified on Basescan before it is written into `config/` (hard rule 1); destination chains
named with their chain id, never by ticker (hard rule 2).

---

## T17 — Launch through o1 — P3 — 🗄 ARCHIVED 2026-10-02 (replaced by T22; `archive/o1/`)

**Rebuilt later on 2026-09-30, Base first, from o1's "Token creation" and "Stock-paired launches"
docs.** The pair is now a choice: ETH, USDC or cbBTC (`standard`) or any of the 10 stock tokens
o1's catalog registers on Base (`rwa`, quote = the stock token; creator fees arrive in it).
Profile editing (`editable_metadata`) and up to 16 extra key/value rows (`extra_metadata`) are
in the form, validated to o1's limits; so are o1's link patterns. The window reads o1's factory
ON BASE for the picked pair (`launchCreationEnabled`, `nativeLaunchFee`, `quoteConfig`, from its
verified ABI) — that half works while the API is down, and did in a real render. `prepareLaunch`
reads it again, then `checkPlan` refuses a plan for another pair/market/profile setting, a tax
launch, or a step above the factory's fee. MEASURED at block 51,992,427: ETH, USDC, cbBTC,
NVDA registered; WETH not; fee 0.001 ETH; catalog JSON stale (`configVersion` 12 vs 16 on chain).

⚠️ **The o1 API is still down** (500 on `/health`, `/config`, `/tokens`, `/launches`, with the key,
re-checked late on 2026-09-30). The owner launched through the o1.exchange website the same day —
it runs on o1's own backend, not this API. A way round it exists and is the owner's call: call the factory's `createLaunch` directly. It needs what o1's prepare does
for us — the metadata PINNED TO IPFS (a pinning service key, e.g. Pinata, server-side) and a
salt mined so the B20 address ends in `01` — so it is a server feature plus a new custody-free
signing path, not a panel tweak. Not started.

Built: `server/o1.ts` (key server-side, one POST route, `x-quadra` header), `adapters/http/o1.ts`
(`checkPlan`: Base only, this wallet, only o1's verified factory `0x1176…63dC`, no ETH beyond the
declared creation fee, no Permit2 signatures, no blocking issue), `panels/LaunchPanel.tsx`. The
key is in `.env.local` and read by the dev server; grep'd absent from the bundle. **o1's API
answered 500 on every route all day**, so nothing here has met a live response. Two corrections
to the plan below, from o1's own spec: there is **no referrer on a launch** (referral is per
trade), and Dev Buy is not in the public API. The original task text follows.

**Size:** medium–large. **Waiting on the o1 API key from ShunTr.** o1's public API
validates a launch, stores its metadata, simulates it and returns **unsigned steps**; Quadra
shows them and the wallet signs. Quadra registers as the referrer (0.2% of volume, fixed by
o1). **Always public** — the owner's rule.

- The key is **server-side only**: a Vercel function under `api/` holds it and calls o1;
  the browser never sees it. This is the first thing that makes T3 real.
- o1's site sits behind a Vercel security checkpoint that answers 429 to plain curl
  (measured 2026-09-30) — so the API is measured with the key, from the server, before any
  parser is written. Do not write the request shape from o1's docs alone.
- Researched facts (2026-09-30, from o1's own pages): 1% trading fee split 50/30/20
  (creator / protocol / referrer), 0.001 ETH creation fee, an anti-snipe tax falling from
  99% to 1% over 20 seconds, pairs against ETH or tokenized stocks. Re-check each against
  the live API; any of them may have moved.

**Done when:** a launch prepared through the server is signed in the wallet on Base, the
window tracks it to confirmation, and the referral shows Quadra.

---

## T19 — Trade: crypto and stocks on Base — ✅ DONE in development 2026-09-30

The owner's ask: "build trade for the tokens on Base, Crypto and Stocks". `panels/TradePanel.tsx`
— a Crypto tab (`TRADE_CRYPTO`, ten verified tokens plus ETH) and a Stocks tab (Coinbase's own
list), prices from DexScreener, Buy/Sell for USDC or ETH, then `SwapPanel` with a `fixed` pair, so
the quote, checks, exact approval, simulation and arrival measurement are Swap's own. Relay was
measured quoting B20 stocks both ways first. A stock shows shares per token, paused features and
the U.S.-eligibility line; one with transfers paused is not quoted. Not done: selling a stock by
share count (the amount is in tokens) and a chart inside Trade (Markets has it).

---

## Read from docs.base.org on 2026-09-30 — what it changes for Quadra

The owner asked for the "Build on Base" section to be read in full; it and the pages it links
for the foundation (RPC, Flashblocks, fees, finality, limits, Builder Codes, native AA,
Tokenized Stocks API) were. Most of it — issuing stablecoins and RWAs, payment escrow, Base
Ledgers — is for issuers and merchants, not a wallet-signing app. What applied was acted on:

- **Tokenized Stocks API** (`api.coinbase.com/v1/tokenized-stocks`) → the stock list in Markets,
  Trade and Launch. Its addresses are not all valid EIP-55 (see CLAUDE.md).
- **Simulate before every write** → `simulate` in `lib/transact.ts`.
- **B20: multiplier, pause, policies** → shown per stock; paused transfers block a quote; a
  policy block is caught by the simulation (the docs' own "definitive check").

What is left, each the owner's decision or dependent on something the owner holds:

1. **Builder Codes** (ERC-8021): register Quadra on base.dev and hand over the code; then one
   `dataSuffix` in `lib/transact.ts` attributes every transaction to Quadra ("potential future
   rewards"). Check first that Relay's and Across's calldata tolerate a trailing suffix.
2. **A production RPC provider** — the public endpoints are "not suitable for production traffic".
3. **L1 fee** via the GasPriceOracle predeploy, if a gas skill returns (verify the address on
   chain first).
4. **Earn (Morpho vault)** is the most natural DeFi addition (one asset, one pinned address,
   ERC-4626). The vault address printed in the docs FAILS EIP-55 — take it from the chain.
5. **Base Ledgers (private transfers)** need an operator holding keys and custody — hard rule 5,
   and no mainnet Portal is published. Not buildable as a keyless app.

---

## T20 — This app's own API, sold over x402 — ✅ BUILT 2026-09-30, NOT YET SELLING

The owner's decisions (asked, 2026-09-30): the skills over HTTP are PAID per call via x402; the
list is free; settlement goes through Coinbase CDP's facilitator (not a server hot wallet, which
would make the app hold a key). Built: `server/api.ts`, `server/cdp.ts`, `config/api.ts`, the x402
window's first mode (`X402Own.tsx`) and a live-probing API page. Verified end to end in the suite
(window → real handler → fake facilitator → report) and in the browser against the dev server.
**Waiting on the owner:** a CDP API key (`CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`) — then the first
real sale should be measured and its responses captured as fixtures, as every other upstream was.
And the prices: each skill is priced by `SKILL_PRICES` (verdict $0.05 … forensics $0.10;
`API_PRICE` $0.005 is only the fallback) — starting figures the owner should set.

---

## T18 — Every skill as an MCP tool, and an approval queue — P4 — HALF DONE 2026-09-30

✅ Every read-only skill is an MCP tool (`src/skills/mcp.ts`, bundled to `tools/quadra-mcp/skills.mjs`),
checked live by hand (`quadra_gas`, `quadra_wallet jesse.base.eth` — both since deleted; today the skill tools are `quadra_verdict`, `_gate`, `_radar`,
`_forensics`, `_launcher`, `_sendcheck` and `_launch` (prepared, unsigned)). ⏸ The approval queue for
prepared transactions is deferred by the owner's decision of 2026-09-30. The original text follows.

**Size:** medium. `tools/quadra-mcp/` holds no keys (hard rule 5) and stays that way: read
skills become tools that return `reportText`; write skills become tools that PREPARE an
unsigned transaction and put it in a queue the owner approves in the Quadra window, where
their own wallet signs it. An agent never signs.

---

## T9 — Launch `$QUADRA` — ⏸ POSTPONED 2026-09-29

**Postponed by ShunTr's decision on 2026-09-29.** A token attached to a privacy pool is
the largest legal and reputational exposure this project could take on while the Tornado
Cash retrial (Oct 2026) and the EU's AMLR (July 2027) are live, and it would arrive before
the product has users. Revisit only after phase 2 of "The direction" is done.

**Size:** large. **Blocked by T7 and by the product being finished.** **This is
ShunTr's call to trigger, not a session's.**

`CONTRACTS.token` in `src/config/chain.ts` is `null` and **no address may be guessed for
it.** What it pairs against is undecided: the tokenized-stock pair it was planned against
was removed from the codebase on 2026-09-29 on the owner's call, along with its config,
its reference price and the Swap window's trade. Whatever the quote side becomes, it
arrives verified on chain with its decimals asserted (hard rule 3), or not at all.

---

## T11 — Pay any x402 URL, not only one directory's catalog — ✅ DONE in development 2026-09-29

**Built:** the x402 window has two halves — BlueAgent's tools, and **Any x402 URL**, pasted or
picked from Coinbase's **x402 Bazaar** (the second directory). Live-checked in Chrome the same
day: x402.ottoai.services quoted directly (it answers CORS), x402uselessfacts.vercel.app through
the forwarder (it does not), the Bazaar listed 59 payable of its first 100. Nothing was paid —
no funded wallet in the session. What it took, each measured before it was written:

- **The x402 v2 transport, as the spec writes it** (`lib/x402http.ts`): `PAYMENT-REQUIRED` header
  (base64) read first, the body as fallback — spec servers send `{}` as the body, BlueAgent sends
  the requirements as the body. `PAYMENT-SIGNATURE` sent (`paymentSignatureHeader`, echoing the
  server's `accepts` entry VERBATIM), `PAYMENT-RESPONSE`'s `transaction` read. BlueAgent's path is
  unchanged: `X-Payment` out, `X-Payment-Response` in.
- **"Exactly one SIGNABLE offer"** replaced "exactly one offer" in `lib/requirements.ts`. Real
  servers offer several (ottoai: EIP-3009 on Base, permit2 on Base, Solana); the old rule refused
  them all. It still never picks by position and never between two prices. `permit2` is refused by
  name (`assertTransferMethod`).
- **User-confirmed payees** (`lib/pins.ts`): an unpinned origin is refused until the user ticks that
  the address was checked elsewhere and pins it. Shipped pins cannot be overridden.
- **The forwarder** (`src/server/forward.ts`): Fetch-API `Request → Response`, mounted on the dev
  server. Policy per target (`anyPublicHttps` in dev, `allowOrigins([...])` for production), a
  required `x-forward: 1` header against cross-site use, x402 headers only in both directions,
  redirects not followed.

**What is left is T3:** where production runs `forward`, and which origins its allowlist names.
The original notes follow for the reasoning behind each piece.

Phase 0 of "The direction". The payee check is already per origin (`config/payees.ts`,
2026-09-29), so `lib/requirements.ts` can check any server's 402. What was missing:

1. **A forwarder for arbitrary origins.** A run is a request with an `X-PAYMENT` header,
   which is a preflighted cross-origin request; most x402 servers do not answer the
   preflight for a browser. The dev proxy forwards to one host. A forwarder that forwards
   to ANY host is an open proxy — that is a decision for T3, not a config change. An
   allowlist of origins is the safe first version.
2. **A way to pin a payee the user has confirmed.** An unpinned origin is refused today
   (`Payee` kind `unpinned`), which is right, and means a new URL can never be paid until
   there is a deliberate "I have checked this address" step. Keep it deliberate: the
   payee named by the server asking to be paid is not evidence on its own.
3. **x402 envelope versions.** This build reads version 2 only and refuses others by name.
   Many servers still answer version 1; supporting it is a checked mapping, not a relaxed parse.

**Done when:** a pasted URL on an allowlisted origin can be quoted, its payee confirmed and
pinned, and a free call run end to end — and an unpinned or changed payee still refuses.

---

## Standing, every task

- **`npm run gate` green, all three parts.** Coverage thresholds are pinned at 100%
  and a drop fails the run. New code arrives with its tests.
- **Tests never touch the network.** `tests/setup.ts` makes `fetch` throw. Anything
  network-facing goes in a hand-run script — `scripts/measure-catalog.ts` is the
  pattern. That script must never invent a tool input; it measures what upstream
  really answers.
- **Look at visual changes in a real browser.** 473 green tests missed three real
  defects at once because jsdom has no layout. Recipe in `CLAUDE.md`.
- **Never edit anything in `blue-agent`.** Separate repo, separate product, owner's
  instruction. If a tool needs a file over there to work, use a different tool.
- **Repo stays private.** No publishing, no npm, no domain, no announcement.
- **Do not commit unless asked.**

---

## Decisions that belong to ShunTr, not to a session

Stop and ask rather than picking:

1. **The fee rate** — 0.1% on swap and bridge is in effect (`FEE_BPS`); the recipient was set on
   2026-09-30. Changing either is one line and the owner's call.
2. **Claiming Relay's fees** — they accrue as a balance at Relay for the treasury, not on chain.
3. *(Archived with o1, 2026-10-02.)* **Whether to earn the o1 referral** — per trade, not per
   launch; moot while o1 is out of the app (`archive/o1/`).
4. **The WalletConnect project id** — set by ShunTr on 2026-09-30 in `.env.local`; it must also be
   set in the Vercel project at deploy.
5. **T3** — the Vercel project itself, and the forwarder's production allowlist.
6. **Custody** — whether Quadra ever holds a key or signs on a user's behalf. Today it does
   not, and the MCP server holds no keys at all. Changing that is a custody decision, not a
   refactor (hard rule 5).
7. **Anything that moves real money in production**, and the deploy itself — the owner tests
   each feature locally first.
8. **T9** — `$QUADRA`, postponed.
9. **Reviving the privacy model** — it is archived, not deleted; bringing it back is the
   owner's call and would reopen the decisions recorded in the Archive.

---

## Archive — the privacy direction (2026-09-27 → 2026-09-30)

Everything below was the plan while Quadra was "private money for AI agents". It was
dropped on 2026-09-30 and its code moved to `archive/privacy/` (src, tests, contracts) and
`archive/previews/`. Kept because the reasoning and the measurements are still true, and
because reviving any of it should start from what was already learned, not from zero. **None
of it is current work.**

## [Archived] The direction — decided by ShunTr on 2026-09-29

**Read this before picking a task.** Everything below was written for a product that
was a hub: swaps, a router, launches, audits, hooks, all on BlueAgent's catalog. On
2026-09-29 the owner chose a single position, and the task order follows from it.

> **Quadra is private money for AI agents on Base: a USDC balance your agents spend on
> any x402 endpoint, with nothing on chain pointing back to you, and no key ever held
> here.**

Why this and not the alternatives, in one paragraph each, so nobody re-litigates it
without new evidence:

- **Not a consumer privacy wallet.** On Base that market already has Fluidkey (stealth
  addresses, ~24k users reported June 2026), Railgun (contracts on Base, activation
  proposed Aug 2026, ~$92M TVL on Ethereum), and Base's own privacy work (Base Ledgers,
  June 2026 — enterprise-only today). A new pool starting at zero users also has the
  smallest anonymity set on the chain, which is the one number a privacy product is sold on.
- **Agents paying x402 are unserved on exactly the axis Quadra is built for.** x402
  settled ~160M transactions by June 2026, >90% on Base, ~$0.3 average, ~all USDC — and
  every one of them publishes which agent bought which API. The private-x402 projects
  that exist hide the AMOUNT (TACEO's Confidential x402, early access; Mind Network's
  x402z, FHE, test assets) and leave the payer visible. Quadra's design hides the PAYER.
- **"Top up once, spend in many small payments" defuses the join-split weakness in T7.**
  A deposit of $20 and payments of $0.01 do not correlate by amount, which is the leak
  T7's decision is about. The use case and the pool shape fit each other.
- **The parts are already here.** `lib/requirements.ts` + `lib/eip712.ts` refuse to sign
  what they have not checked (a spend guard, which agents need regardless of privacy);
  `contracts/` has the pool; `tools/quadra-mcp/` is the agent surface and holds no key.

What was decided with it:

| Decision | Status |
|---|---|
| Position as above; BlueAgent is ONE directory of tools to spend on, not the platform | **done 2026-09-29** — copy, `config/upstream.ts`, `config/payees.ts` |
| Payee checked per ORIGIN (`config/payees.ts`), not against one BlueAgent constant | **done 2026-09-29** — `lib/requirements.ts` no longer imports anything BlueAgent |
| Switch off `audit` and `hooks` (off, not deleted — one line each to reverse) | **done 2026-09-29** |
| `router` becomes "agents pay from the private balance" — see T6 | **rewritten, not built** |
| Pay any x402 URL, with the Bazaar as a second directory — see T11 | **done 2026-09-29**, dev-complete; production needs T3 |
| Spending limits the user sets, enforced where the signature is made | **done 2026-09-29** — `lib/spendGuard.ts` |
| Evaluate Railgun on Base as the pool BEFORE finishing our own circuit — see T10 | **step 1 done 2026-09-29** (on chain: live, nearly unused); spike open |
| Postpone `$QUADRA` — see T9 | **decided 2026-09-29** |

The phases, in order. A phase does not start until the one before it is green:

0. **Stand alone** (no money at risk) — **done 2026-09-29** in development: the rows above,
   including **T11**. What is left of it is **T3**: the forwarder exists and is tested, and
   production needs somewhere to run it and an allowlist.
1. **Agents spend the local balance** — **T6**. Blocked on a custody decision (hard rule 5):
   where the key lives that signs an agent's payment.
2. **The balance becomes real** — **T10** decides Railgun vs our own pool; then T7 steps 2–3
   (circuit, verifier, Poseidon, audit) OR the Railgun integration. Base Sepolia first.
3. **Compliance posture** — view keys for users; an association-set or PPOI-style proof;
   and **legal advice before this project operates any relayer or forwarder**, since the
   one charge a jury convicted the Tornado Cash developer of (Aug 2025) was operating an
   unlicensed money-transmitting business. The EU's AMLR bars CASPs from anonymous accounts
   from 1 July 2027. Neither is a reason not to build; both are reasons to design it in.

---

## [Archived] T6 — Build `router`: agents pay from the private balance

**Size:** large. **Rewritten 2026-09-29** — this is now the product's core, not "pay any
service, any token". The "any token" question is **retired**: everything is USDC, which is
also what ~all x402 volume settles in.

What it is: an agent (through `tools/quadra-mcp/`) asks to pay an x402 endpoint; the payment
comes out of the user's private balance through an address that has never touched the
user's wallet, so the endpoint is paid normally and cannot see who paid. Server and
facilitator are unchanged — that is the difference from TACEO and x402z, which need both.

🔴 **Design constraint found while evaluating Railgun (T10), and it applies to our own pool
too: do NOT withdraw once per payment.** An x402 call averages ~$0.3 and often costs $0.01.
A withdrawal from a shielded pool costs gas plus a relayer premium (Railgun: 0.25% protocol
fee plus ~10% of gas to its broadcaster), which is more than a $0.01 payment. The shape that
works is a **session address**: withdraw a budget (say $5) once to a fresh address per agent
or per session, then pay many 402s from it with ordinary EIP-3009 signatures — the path
`lib/payment.ts` already has. Payments inside one session are linkable to each other; none
are linkable to the user. Say exactly that in the UI.

**Blocked by, in order:**
1. 🔴 **A custody decision (hard rule 5) — ShunTr's, not a session's.** A session address
   needs a key that signs without the user clicking each time, or the agent is not
   autonomous. Options: (a) the browser holds a session key with a hard budget and expiry,
   and the MCP server asks the browser to sign — the MCP server still holds nothing;
   (b) a smart-account session key with an on-chain spend limit; (c) the user approves every
   payment in their wallet, which is honest and not autonomous. Do not pick one alone.
2. The pool being real — T10, then T7 or the Railgun integration.

**Done when:** an agent pays a real x402 endpoint on Base Sepolia (then mainnet) from a
private balance, the receipt names the session address and says what it does and does not
hide, and nothing on chain links that address to the user's wallet.

---

## [Archived] T7 — Foundry scaffold + the shielded pool contract

**Size:** large. **Blocks T8.** Independent of T3–T6 — can be done in parallel.

### Step 1 of 3 is DONE (2026-09-27) — the Solidity exists and is fully tested

`contracts/` holds three contracts at 100% coverage on `src/`, gated by
`npm run gate:contracts`; the per-suite test counts are in the table at the bottom of
`contracts/README.md`, which that gate checks. Read `contracts/README.md` before touching
any of it — it has the traps measured while building it, including three that make a broken
config or a wrong-directory invocation look like a working one.

| file | what |
|---|---|
| `src/MerkleTreeWithHistory.sol` | append-only commitment tree + 30-root window |
| `src/SafeTransfer.sol` | ERC-20 moves that fail loudly, incl. non-standard tokens |
| `src/ShieldedPool.sol` | join-split pool, 2-in/2-out, one asset |

One real bug was found and fixed rather than documented: at `levels == 1` the
constructor's `zeros` loop never runs, so the field check on the hasher's output never
executed and an out-of-field hasher would have built a tree whose every root no circuit
could reference. Deposits would succeed and no withdrawal would ever be provable, with
nothing reverting anywhere. `test_everyLegalSizeChecksItsHasher` now asserts the fix at
every legal size.

### Step 1b also DONE (2026-09-27) — the browser now derives commitments instead of inventing them

Found by reading `src/adapters/local/pool.ts` rather than by a failing test. `deposit` set
`commitment: randomHex(32)` — a random number with no relationship to the note's amount or
its secret. It passed the suite, because the only assertion was that it differed from the
secret and any random value does. **A commitment that commits to nothing is not a
commitment:** there is no secret whose knowledge it proves, so the on-chain pool could never
accept one of those notes and no circuit could be written against them. This is precisely
the "stub you cannot tell from the real thing by looking at the output" the header of
`src/adapters/types.ts` warns about — except the type system did not catch it, because
`commitment: string` accepts anything.

| file | what |
|---|---|
| `src/lib/field.ts` | BN254 scalar field; `MAX_NOTE_VALUE`; hex codec; rejection-sampled secrets |
| `src/lib/hash.ts` | the `FieldHash` seam. SHA-256 stand-in, tagged. **No Poseidon — see rule 9** |
| `src/lib/note.ts` | `commitment = H("note.commitment", [amount, secret])`, nullifier likewise |

Three things about the shape, because each replaces a way this could have gone wrong:

- **`Note.commitment` is a discriminated union, not a string.** `{ scheme: "poseidon" }` or
  `{ scheme: "stand-in", why }` — so a value hashed with the stand-in cannot reach a chain
  boundary without the difference being handled. Same device as `Anchoring`, same reason.
- **`Note.secret` is a `bigint`, not hex.** The scheme's inputs are field elements, so
  carrying it as one means no parse step to get wrong and nowhere for a 33-byte "field
  element" to hide.
- **`tests/field.test.ts` reads `contracts/src/*.sol` and extracts `FIELD_SIZE` and
  `MAX_NOTE_VALUE`** rather than restating them. The constants exist on both sides of the
  boundary and a copy drifts silently. Do not replace that with a literal.

Measured while writing those tests, and worth knowing before you write similar ones — both
are in `CLAUDE.md`: `new URL(x, import.meta.url)` is rewritten by Vite and does not resolve
against the file, and a spy that delegates to the real `crypto.getRandomValues` re-enters
itself and cannot count calls (it reported 5 draws for 1).

One number came out of this that is worth having: **`FIELD_MODULUS / MAX_NOTE_VALUE` is 48**,
so 48 maximum-valued notes can be summed before the field wraps and 49 cannot. Pinned as an
equality in `tests/field.test.ts`. (The first version of that test asserted 64 fit, which is
false — 2^248 × 64 is 2^254 and the modulus is just under it. An over-confident inequality in
a test about overflow is the wrong place to guess.)

**What this does NOT do:** it does not make a note provable. `standInHash` is SHA-256, which
no circuit computes and none ever will — SHA-256 inside a SNARK costs tens of thousands of
constraints, which is why Poseidon exists. The gap is now one substitution wide and it is
tagged in every value, which is the honest version of the same gap rather than a smaller one.

### Step 1c also DONE (2026-09-28) — the double-spend rule is now the one the chain enforces

Same method as 1b: found by reading the code against the Solidity, not by a failing test. The
local pool refused a second spend with `if (note.spentAt !== null)`. The contract refuses one
with `mapping(bytes32 => bool) public isSpent`. Both work, and **only one of them is checkable
by anyone other than this browser** — a timestamp is a fact this tab wrote about its own
mutable object, and `notes()` copies the array but not the notes, so a caller already holds a
reference that can clear it. Under the old rule, clearing it re-armed a spent note.

So the rule is now: derive `nullifier = H("note.nullifier", [secret, leafIndex])`, refuse it if
the set already holds it, and record it. `spentAt` stays, demoted to what it always really was —
something to render. The type says so in as many words, and two tests force the two apart on
purpose rather than trusting that they agree:

- wipe `spentAt` on a spent note → the pool still refuses it
- stamp `spentAt` on an unspent note → the pool still spends it

Neither of those passes under the old rule, and the first one is the one that loses money.

| file | what changed |
|---|---|
| `src/adapters/types.ts` | `Note.leafIndex: number`; `nullifiers()` on the interface; `spentAt` re-documented as display |
| `src/adapters/local/pool.ts` | `spent: Set<string>`; monotonic `nextIndex`; `consume` writes both, in one place |

Three decisions in there worth not undoing:

- **`leafIndex` is stored on the note, not derived from its position.** The nullifier's
  preimage includes it, so two notes sharing a secret at different positions must nullify
  differently. It is also assigned the way `MerkleTreeWithHistory._insert` assigns it —
  monotonic, **never reused, including across spends**, because the tree is append-only and a
  spent leaf keeps its slot forever. Hand index 0 back out and the new note can derive a
  nullifier already in the set: unspendable from birth, with no error text that explains why.
- **`nextIndex` increments after the note literal, not before.** `deriveCommitment` throws on
  a bad amount, and an index consumed by a deposit that never happened is a permanent hole —
  harmless alone, and exactly the off-by-one that makes a later tree reconstruction disagree
  with the chain for no visible reason. Pinned by a test that refuses two deposits and then
  expects index 0.
- **The nullifier is derived once, in `spendable`, and handed to `consume`.** Deriving it
  again there would be two chances to disagree, and the derivation that decides "already
  spent" has to be the one that gets stored.

**What this does NOT do.** It mirrors the *rule*, not the *arity*: `transact` takes
`bytes32[2] inputNullifiers` and retires two notes per transaction, this spends one, so the
contract's `DuplicateNullifier` guard has no local counterpart — with one input the case cannot
arise. Whether the browser should join and split the same way is the open question at the
bottom of this file, and it is a product decision, not a bug. And the nullifiers are still
stand-in-hashed, so they are the right values in the wrong hash. Same one substitution as 1b.

### Step 1d also DONE (2026-09-28) — the browser has a commitment tree, and can serve paths

`src/lib/tree.ts`. The pool had a `nextIndex` counter and no tree, which meant the
browser could name a leaf position but could not compute a root or produce a path — the
two things a withdrawal proof is made of. `IncrementalMerkleTree` mirrors
`MerkleTreeWithHistory.sol` hash for hash: same insert loop, same empty-subtree
stand-ins, same 30-root circular history, same refusal of root zero.

It is a **superset**, not a copy. The contract keeps one node per level, because storing
a million leaves to serve a proof nobody asked for is not what block space is for.
Somebody still has to produce the path, and here that somebody is the browser, so this
keeps every leaf and derives paths on demand. `pathFor` is the load-bearing method: a
path whose siblings do not fold back to the root is a proof that will not verify, and
nothing about the numbers says so.

**That test was verified by breaking the code, not by watching it pass.** All 29 tests
went green on the first run, which is a reason for suspicion rather than confidence — so
two mutations were introduced deliberately: padding the path level with `0n` instead of
`zeros[i]`, and folding without consulting `isRight`. Each produced exactly one failure,
the round-trip. A test that only ever passes has not been shown to test anything.

Three decisions worth not undoing:

- **`emptyLeaf` is a required argument with no default.** The contract derives its empty
  leaf from `keccak256("quadra.shielded-pool.empty-leaf") % FIELD_SIZE`, and when this was
  written **there was no keccak in the browser** — no dependency provided one, and
  hard-coding a 32-byte constant that nothing local can re-derive is precisely hard rule
  9's hazard. So the caller supplies it: from a deployed pool's own `zeros(0)` when there
  is a deployment, from a declared constant when there is not. A wrong value fails a test;
  a missing one fails to compile.

  ⚠️ **The premise changed on 2026-09-28 and the decision did not.** `src/lib/keccak.ts`
  exists, and `tests/keccak.test.ts` pins `keccak256("quadra.shielded-pool.empty-leaf")` to
  the contract's own preimage, so the browser *can* now re-derive that constant — the rule-9
  hazard named above is gone. `emptyLeaf` stays a required argument anyway, and the pool
  keeps passing its own `"tree.empty-leaf"` stand-in. Reason: matching the empty leaf alone
  moves **every** local root without making a single one provable, because interior nodes
  still go through the stand-in hash — and it would invalidate every backup file already
  written, for no gain. The leaf becomes the contract's when Poseidon does, in one change.
  Do not take the half of this that is now possible.
- **Interior nodes are hashed under a domain tag** (`TREE_NODE_DOMAIN = "tree.node"`).
  `IHasher.hash(left, right)` takes no tag, so **a deployed hasher has to bake this one
  in** or its roots will not match the browser's. Untagged, a node hash and a two-input
  note commitment are the same function of the same pair.
- **Capacity is `2 ** levels`, never `1 << levels`.** `1 << 32` is **1** in JavaScript,
  so a shift would report a 32-level tree as full at its second leaf. Pinned by an
  assertion, because the wrong answer is a small plausible number rather than an error.

🔴 **Found while writing it, and NOT yet resolved: the contract is inconsistent with its
own stated principle, for exactly one value.** `MerkleTreeWithHistory`'s constructor
comment says empty subtrees are computed from the deployed hasher rather than tabulated,
because *"a hard-coded table is a copy of the answer for one specific hash function"* —
and then it takes the empty **leaf** from keccak, which is exactly that. It computes 19
of 20 zeros from the hasher and imports the 20th from a different hash function
entirely. The stated reason (so an all-zero calldata blob is not a valid empty leaf) is
served just as well by a domain-separated call to the hasher it already has.

Leaving the contract alone for now because changing it is a Solidity change with its own
gate and its own test file, and because the value has to agree with the circuit that
does not exist yet. **Resolve it as part of step 2, in one of two directions:** derive
the empty leaf from `IHasher` so both sides can compute it, or keep keccak and accept
that the browser must be handed the constant from the deployment and can never check it.
The first is better and the browser is already written for either.

⚠️ **One argument for the second direction got weaker on 2026-09-28, and it is the argument
that would have decided it wrongly.** "The browser can never check the keccak constant" was
half the case against keeping keccak, and `src/lib/keccak.ts` removes it — the browser
checks that value in `tests/keccak.test.ts` today. What survives untouched is the *whole*
of the case **for** deriving from `IHasher`: the contract's own comment gives the reason
(a tabulated value is a copy of the answer for one specific hash function), and one tree
whose leaf comes from keccak while its 19 other zeros come from Poseidon is two hash
functions in one root for no stated benefit. **Decide it on that, not on what the browser
can compute** — "we can now verify the inconsistent value" is not a reason to keep the
inconsistency, and it is the reason a future session is most likely to reach for.

### Step 1e also DONE (2026-09-28) — the tree is load-bearing, and the pool can serve a witness

`lib/tree.ts` existed but nothing imported it, so `leafIndex` still came from a bare
`nextIndex` counter on the pool. A counter is monotonic for the right reason and is still
only a *promise* that some tree somewhere agrees with it. Now `LocalShieldedPool` owns an
`IncrementalMerkleTree` and every index it hands out is the return value of an actual
`insert`, so the index and the tree cannot disagree — there is only one of them.

Two methods went onto the `ShieldedPool` **interface**, not just the local class, because
a pool that cannot state its root cannot be proven against and the on-chain adapter must
not be free to forget them:

- `root(): Promise<TreeRoot>` — tagged, so a root the stand-in hash produced cannot be
  mistaken for one a deployed pool would recognise.
- `witness(noteId): Promise<NoteWitness>` — the Merkle path a circuit consumes. Note this
  is the half the **contract cannot serve**: the chain stores only `filledSubtrees` and
  cannot reconstruct a path for an arbitrary leaf. That is why a client keeps its own copy
  of the tree, and putting it on the interface makes that obligation visible now instead
  of on deployment day.

`NoteWitness` tags its two ends (`root`, `leaf`) and leaves `siblings` as bare bigints:
those are interior nodes, meaningless except under a root that is already tagged, and
tagging twenty of them would be twenty copies of one fact about the whole witness. Tag
the boundary, not every node behind it.

**The bug this increment was really about is one nothing would have thrown for.**
`insert` awaits `levels` hashes. Two deposits in flight at once interleave inside it,
both write `filledSubtrees`, and the tree ends up with a root belonging to neither —
silently. Every note comes back looking correct and every proof fails later, on chain.
`Promise.all` over deposits is an ordinary thing for a caller to write, and
`tests/adapters.test.ts` already did it. So the pool serializes its writes rather than
documenting a rule about how it must be called. Measured, with the queue removed: eight
concurrent deposits all returned `leafIndex: 0`, and the pre-existing 40-deposit
uniqueness test **still passed** — it checks ids, commitments and secrets, all of which
stay distinct while the tree is being corrupted.

The public methods are thin wrappers over private `depositNow`/`sendNow`/`withdrawNow`.
That is not style: `send` mints its change note by calling `depositNow`, and if the inner
call went through the queue it would wait on a queue its own caller holds — a deadlock
with no error message, just a promise that never settles.

**A correction found by mutation, worth recording because the code read as careful.**
`serialize` was written as `this.queue.then(body, body)` *plus* advancing the queue with a
rejection-swallowed copy, and the comment called both load-bearing. They are
**alternatives, not layers**: removing either one alone broke no test, and only removing
both turned four red. Two mechanisms for one job is worse than one, because each makes the
other look necessary and so neither gets read carefully. Kept the swallowed advance, which
states its intent — `this.queue` is a sequencing token, never a result channel — and
dropped the clever arm. This is the same lesson as hard rule 10 in a different costume:
defensive code that cannot be reached is indistinguishable from defensive code that works.

**Verified by breaking it, not by watching it pass.** Four mutations, and the interesting
result is that two of them were *green*: dropping the deposit queue (3 tests red, the
silent-corruption case), dropping `then(body, body)` (**green — dead code**), dropping the
swallowed advance (**green — the other half of the same redundancy**), and dropping both
(4 tests red). A test suite that only ever passes has not been shown to test anything, and
a mutation that changes nothing is telling you about the code, not about the test.

### Step 1f also DONE (2026-09-28) — the notes survive a reload, which the premise required

Before this, `LocalShieldedPool` kept its notes in an array and a refresh destroyed every
one of them. The only `localStorage` reference in the whole repo was in `tests/setup.ts`.
For a product whose entire claim is *the secret lives in this browser and nowhere else*,
that is not a missing feature — it is the claim not being true yet.

`src/adapters/local/store.ts` is the new storage seam: a `NoteStore` interface with a
`MemoryNoteStore` (the default, so the class does not depend on `localStorage` existing)
and a `LocalStorageNoteStore`, which `resolvePool` injects — the one place that knows this
app runs in a browser.

**Three decisions worth defending:**

1. **The commitment is NOT stored. It is re-derived on load.** Storing it means storing its
   `scheme` tag, and a tag read back from disk is a *claim* — someone could write
   `scheme: "poseidon"` next to a stand-in value and the UI would believe it. Re-deriving
   means the tag always comes from the hash that actually ran. This is hard rule 10, and
   `note.ts`'s "derived, not invented", applied to the disk.
2. **The nullifier set IS stored, even though every entry is derivable from a note.** The
   redundancy is the point: without it, the guarantee "a note whose `spentAt` was wiped is
   still refused" would hold in memory and silently stop holding after a refresh. It is
   also the shape that migrates — the on-chain adapter fills the same set from chain events.
3. **Every inconsistency is refused, never quietly repaired.** Skipping a bad note reads as
   robustness and is how a user ends up with a pool that holds less money than it did
   yesterday, with nothing in the UI to say so. `SAFE_REPAIR` names the one repair that is
   safe, and it is asymmetric on purpose: the union of stored nullifiers *plus* one derived
   per note stamped spent. Erring toward refusing a spend cannot lose money; erring the
   other way can.

The set-level check matters as much as the per-field ones: `decodePool` sorts by
`leafIndex` and asserts the result is exactly `0..n-1`. A gap shifts every note after it,
so the witnesses would be rejected on chain — the worst possible place to find out.

🔴 **Found a real bug doing this, and its error message was the bad part.** `spendable` and
`witness` both read `this.store` directly, before hydration. On a freshly loaded page that
array is empty, so the first spend or witness request after *any* refresh answered
`No note with id … in this browser` — about a note sitting on disk three lines away. Of all
the things it could have said, it said the note does not exist. It survived review because
`notes()` and `nullifiers()` had already been given their `await this.ready()` and the two
lookups read as if covered by it. Fixed with a single `locate()` choke point rather than two
more `await`s, so a third lookup path cannot reintroduce it by forgetting.

**Verified by breaking it. Six mutations, six caught — and the fourth exposed a gap:**

| Mutation | Result |
|---|---|
| `ready()` assigns `this.tree` before hydrating | 1 red — "keeps failing on every retry instead of settling into an empty pool" |
| `decodePool` trusts file order (no sort) | 6 red |
| drop the `SAFE_REPAIR` derived union | 1 red — the stripped-nullifier test |
| `locate()` without hydrating | 3 red — **all three spend paths, and none for `witness`** |
| drop the leaf-contiguity check | 2 red — both gap-message tests |
| store the commitment and its `scheme` on disk | 1 red — the re-derivation test |

The fourth row is the finding. Three tests caught it, but the witness path was being
carried by its neighbours' side effects: those tests call `notes()` first, which hydrates,
so `witness` was never asked cold. A witness is the first thing a proof consumes and the
first call a real client makes on a fresh page. Added "serves a witness as the very first
call on a reopened pool", re-ran the mutation, and it now goes red on its own. **Coverage
was 100% under every one of these mutations** — line coverage cannot see call ordering.

**Two test-harness bugs worth knowing about, because both faked a pass:**

- **An `async` function flattens a promise it returns.** The `loading()` helper was
  `async` and returned `pool.notes()`, so the rejection landed on `loading(...)` itself and
  every `rejects.toThrow` below it was handed an already-settled value. **21 tests passed
  against a pool that threw, and would have passed just as happily against one that did
  not.** It is now deliberately not `async`, with a comment saying so.
- **`localStorage.setItem = fn` does not patch the method.** `Storage` has a named-property
  setter, so jsdom reinterprets the assignment as *storing data*: it writes a real entry
  under the key `"setItem"` whose value is the function's source text and leaves the method
  untouched. Measured — after the assignment `hasOwnProperty("setItem")` is still `false`
  and `getItem("setItem")` returns `"() => { throw ... }"`. Two tests silently asserted
  nothing, and the `finally` that "restored" the method wrote the junk key a second time.
  Patch `Object.getPrototypeOf(localStorage)` instead; there is now a test asserting the
  patch leaves no key behind.

**Follow-up, product not code: `localStorage` is not a backup, and the UI does not say so.**
Clearing site data, a private window closing, or a browser evicting storage under pressure
destroys every note, and the notes ARE the money — there is no server-side copy, by design.
The pool now refuses loudly when the file is *damaged*, but nothing warns a user before the
file is *gone*. That needs an export/restore path and a plain-language warning in the
deposit flow before this is shown to anyone holding real funds. Not started.

### Step 1g also DONE (2026-09-28) — the notes can leave this browser, which 1f made urgent

This closes the follow-up 1f ended on. Persistence made the app *look* durable without
making it durable: before 1f nobody could believe their notes would survive anything,
because nothing did. After 1f they survive a refresh and not a cleared-site-data dialog,
and the notes are the money. `src/lib/backup.ts` is the export/restore format;
`src/lib/download.ts` hands the file to a disk and reads one back.

**Decisions worth defending:**

1. **The file holds the secrets in plaintext, and every string in the UI says so.** A
   backup without secrets restores nothing, so the file is exactly as valuable as the pool.
   The warning is not behind a `<details>`: "keep it like cash — not in a shared folder,
   not in email."
2. **This does not weaken hard rule 4, and the distinction is written into the module
   header because it looks like it might.** Rule 4 is about a secret reaching a *third
   party* — a server, a URL, a log. A file the user saves to their own disk is the user
   taking custody of their own money. So nothing in either module touches `fetch`, nothing
   runs without an explicit click, and `download.ts` exists solely to keep `URL` and
   `document` out of `backup.ts` so rule 4 can be audited in one file.
3. **🔴 Not half-encrypted.** A passphrase wrapper (WebCrypto PBKDF2 + AES-GCM, no new
   dependency) is the obvious next step and is deliberately absent rather than stubbed: a
   half-built encryption path is worse than a plainly-labelled plaintext one, because the
   label is what makes the user careful. **Still an open decision — see the list below.**
4. **The export message says "Saving…", never "Saved" or "✓".** Nothing in a browser can
   observe whether a download reached a disk — that is decided by the download UI and the
   user, neither of which reports back. So the UI tells them to go and check, which is the
   action that makes the backup real. There is a test asserting the absence of those words.
5. **A successful backup is not rendered through `Anchor`.** It would print "Not on chain:
   …" in the warning colour, which is correct after a deposit and actively misleading after
   an export, where not being on chain is the entire feature. Hence the `Output` union.
6. **Three import refusals, in order** — not-a-backup-file, then already-holds-notes, then
   validated through `decodePool`, *the same function the loader uses*. That last one
   matters: validating with a looser check of its own would let an import report success and
   leave behind a pool that throws on open, which the user discovers on the next page load
   with the file possibly already deleted.
7. **Merging two pools is refused, not implemented.** Both number their leaves from zero, so
   a merge produces duplicate indices and a root belonging to nobody — which `decodePool`
   would then refuse forever.

🔴 **The write-back hazard is why these are pool methods and not free functions the UI
calls with a store.** A restore writes the pool file, but the live object has already
hydrated from the *old* one and never looks at the disk again, because `ready()`
short-circuits once `tree` is set. An import performed outside the pool therefore leaves the
object holding pre-restore state, and the next deposit calls `persist()` and writes it back
over the file. **The restored notes would be destroyed by the first thing the user does
after restoring them, silently.** Routing through the pool lets the cache be dropped in the
same serialized step as the write.

**Verified by breaking it. Six mutations — and three of the six taught something:**

| Mutation | Result |
|---|---|
| delete the cache-drop after a restore | 4 red; the plain-case test survives, as predicted — a pool never asked anything has no cache to be wrong |
| **M8** clear the cache *before* the write | **0 red — all 134 green. The source comment was wrong.** |
| **M9** drop the file-input reset | both halves of the re-pick test fail *independently* |
| **M10** template the hash domain tag from `BRAND.slug` | **0 red — all 722 green** |
| M11 template `STORE_KEY` from `BRAND.slug` | 2 red, after M10's fix |
| M12 encode field elements little-endian | 3 red — and *only* the three pinned vectors |

**M8 is the important one, and it was a comment bug rather than a test bug.** The comment
claimed the after-the-write order existed because "a refusal must leave this object exactly
as it was". False: clearing early is self-healing, because a refusal leaves the disk
untouched and `tree = null` sends the next `ready()` back to it. What the early order
actually costs is that the repair is **a second disk read that has to succeed** — and a
store may refuse a read, since `LocalStorageNoteStore.load` throws rather than answering
`null` on a record it cannot parse. So picking the wrong file, an operation that changed
nothing, would be what makes the notes unreadable. Fixed the comment to say the measured
thing, then wrote the one test that can tell the two orders apart: a store readable exactly
once.

**M10 is the other one, and it invalidated a guard I had just written.** Both `STORE_KEY`
and the hash domain tag were unpinned — every test imported the constant it was checking, so
changing either stayed green. The intuitive fix is a pinned output vector, and I added
those. **They do not catch this**: `BRAND.slug` is `"quadra"` today, so templating the tag
expands to a byte-identical string and no output moves. The defect is *dormant* — it
detonates at the rename, long after the commit, and the symptom is every note in existence
changing identity. A dormant defect can only be caught by its shape, so the real guard is
textual and lives in `tests/brand.test.ts`. Its first version then failed on `store.ts` and
`backup.ts` — against my own doc comments, which quote the forbidden form in order to warn
against it — so it strips comments first, which also strengthens the positive check from
"the literal is in the file" to "the literal is in the code".

M12 is why the vectors were kept anyway: an endianness flip in the input encoding is caught
by those three tests and **nothing else**, with the other 727 green. Every property test
survives it, because a byte-swapped hash is still deterministic, still in field, still
collision-free, and still distinguishes `H(1, 256)` from `H(256, 1)`.

**`brand.ts`'s header was false, and false in the expensive direction.** It said "nothing
else hardcodes a brand string", which reads as an invitation to grep for the slug and
template whatever turns up. Four strings are identifiers in data that already exists and
must keep their shipped value through a rename: `STORE_KEY`, the hash domain tag,
`BACKUP_FORMAT`, and the empty-leaf preimage. The distinction is not brand-vs-internal, it
is **prose vs identifier**. `backupFilename` went the other way — derived from the slug,
because nothing reads it back.

**Two measured environment facts, both of which rejected a plausible implementation:**

- **jsdom's `Blob` implements exactly `slice`, `size` and `type`.** No `.text()`, no
  `.arrayBuffer()`, no `.stream()`. So the one-line `await file.text()` is code no test in
  this repo can execute, and an untested read is not acceptable on the only path by which a
  user recovers their money.
- **`await new Response(jsdomFile).text()` resolves to the literal string
  `"[object File]"`** — a wrong answer with no error, which would have shipped a restore
  that reliably rejects every real backup.

`FileReader` reads correctly here and has the wider browser baseline of the two, so the
testable choice is also the more portable one. Its `Reader` constructor is injectable for
one reason: a real read failure has to arrive as a message rather than a promise that never
settles, and jsdom cannot be made to fail a read of a valid Blob.

**Three test-harness facts worth knowing:**

- **`vi.useFakeTimers()` hangs `FileReader`** — it resolves on a real task a fake clock
  never advances, so the tests time out instead of failing. Only `offerDownload` needs the
  fake clock; the `readTextFile` block gives real timers back.
- **jsdom has no `URL.createObjectURL`.** It must be assigned and `delete`d by hand —
  `vi.stubGlobal("URL", …)` would take `new URL()` with it, which jsdom needs internally,
  and `vi.unstubAllGlobals()` cannot restore a property that never existed.
- **`userEvent.upload` honours the input's `accept`.** A `.txt` file never reaches a handler
  behind `accept="application/json,.json"`, so the first wrong-content test passed by never
  running the code. Both fixtures are now `.json`, which is also the realistic case: a
  corrupt backup keeps the name it was exported under.

**Open decision, for ShunTr:** encrypt the backup with a passphrase? WebCrypto PBKDF2 +
AES-GCM, no new dependency. Against: a forgotten passphrase is unrecoverable money, and the
plaintext label is what currently makes users careful. For: the file is a spendable secret
and people put files in synced folders. Not started either way.

### Step 1h also DONE (2026-09-28) — there is a keccak-256 now, and it has no tables

`src/lib/keccak.ts`. Four separate things in this repo were blocked on the same missing
primitive: `extDataHash` (so `buildPublicInputs` could only ever return `incomplete`), EIP-55
checksum verification of a recipient address, the empty-leaf preimage in step 1d above, and
any future check of a deployed pool's `zeros(0)`. One 200-line file unblocks all four.

**Read `src/lib/keccak.ts`'s header before deciding this was a rule-9 violation** — it is the
reverse of one, and the distinction is the whole reason the file is allowed to exist. Rule 9
forbids the constant nothing local can check: a Poseidon constant recalled from a blog post
gives a hash that is deterministic, collision-free, in-field, passes every test in
`tests/hash.test.ts`, and matches no circuit — the failure is invisible until deployment day.
Keccak is the opposite: `cast keccak` is an oracle on this machine, so a single wrong bit
fails the first vector immediately. **The rule is about verifiability, not about whether
cryptography may be hand-written.**

**There are no tabulated constants at all, and that is the design.** The 24 round constants
come from the LFSR that defines them; the ρ offsets and the π permutation both fall out of the
single walk `(x, y) -> (y, 2x + 3y mod 5)`. A transcription typo is therefore *impossible*
rather than merely tested for — which matters because the usual failure here is one wrong
nibble in a 24-entry table, and that is exactly what a reader's eye slides over.

**Nine digests, from `cast keccak`, at the lengths where padding breaks.** The commands are in
the test header; regenerate a doubted vector with them. 🔴 **Never "fix" a vector by running
this code and pasting its answer back** — that converts the test into a tautology and it will
look greener than before. Lengths 0, 1, 135 (both pad bits in one byte, must be `0x81`), 136
(needs a whole extra block), 137, 272, 273 (the absorb loop runs more than twice).

**One of my assertions was wrong, and the way it was resolved is the point.** The test first
asserted all 24 round constants are distinct. It failed at **22** — while all nine `cast`
vectors passed in the same run. The vectors are the authority, so the *test* was wrong, not the
code: Keccak's constants genuinely collide twice, `RC[5] == RC[22]` and `RC[6] == RC[20]`. It is
now pinned by collision **position** rather than by count, which is independent of the table's
values and moves if the register mis-steps. "The round constants are distinct" is an assumption
the next person writing this test will also make.

**Four mutations, each reverted and `diff`-confirmed byte-identical:**

| mutation | red | what it proves |
|---|---|---|
| `PAD_FIRST` `0x01` → `0x06` (SHA-3's) | 10 | one pad bit is caught; keccak ≠ SHA-3-256 |
| `let register = 1` moved inside the round loop | 12 | the LFSR runs continuously across rounds |
| `2x + 3y` → `2x + 2y` in the walk | 9 | only the vectors pin *which* permutation |
| `nextX = y` → `nextX = x` | 12 | the permutation property itself bites |

⚠️ **Row 3 is the one worth reading.** `2x + 2y` also happens to permute the 24 non-centre
lanes, so the test named "makes π a permutation" stays **green** through it and only the `cast`
vectors catch it. Row 2 has the same shape from the other side: `rc(0) = 1` stays green through
a restarted LFSR, because round 0 is the one round a restart cannot corrupt — a suite holding
only that assertion would have reported healthy. Both are recorded at the assertions
themselves, because a test whose name promises more than it delivers is worse than no test.

**Its first consumer landed in the SAME commit, and not for tidiness.** `transaction.ts`
carried a user-facing string, `WHY_NO_KECCAK`, whose text asserted that this build has no
keccak-256. The moment keccak.ts existed that string was **false on screen**, so the choice
was a bigger commit or a self-contradicting one. `extDataHash` therefore returns a plain
bigint now, and the `ExtDataHash` union, the injected `Keccak256` type and `WHY_NO_KECCAK`
are **deleted** rather than kept "for flexibility" — they existed only to describe an
absence that has ended. The same staleness was fixed in `src/lib/tree.ts` (a doc comment
justifying its injected hash with "there is no keccak here") and in step 1d above.

⚠️ **That closed the loop the pinned vector left open.** `tests/transaction.test.ts` now
recomputes `keccak256(abiEncodeExtData(PINNED))` and compares it to `PINNED_DIGEST`, which
came out of Solidity. So our encoder agrees with `solc`'s `abi.encode`, our hasher agrees
with `solc`'s `keccak256`, and our fold agrees with the contract's `%` — with the middle
step independently anchored to `cast` rather than to `solc`. Two implementations, two
authorities, one answer.

⚠️ **The bundle is STILL byte-identical at 221.42 kB.** Not because keccak is unused, but
because its only importer is `transaction.ts` and nothing under `src/` imports *that* yet,
so the pair tree-shakes out together. Do not read the unchanged number as "the rewiring
did not take"; re-grep `from "@/lib/transaction"` instead.

⚠️ **…and that stopped being true one increment later — 224.51 kB.** Left above as the
dated measurement it was, rather than overwritten, because the *reasoning* is what to
keep: an unchanged bundle size was evidence about the import graph, not about whether the
code worked. `address.ts` imports keccak and three panels import `address.ts`, so the
permutation now ships. **Confirmed by grepping `dist/` rather than by inferring it from
the size:** the RATE expression `(1600-2*Cs*8)/8` and the LFSR fold `(s&256)&&(s^=369)`
are both in the minified output verbatim — esbuild declined to constant-fold either, which
is lucky, so they make usable needles. First time this code runs outside a test.

🔴 **Two of those three sentences are wrong, and the way they are wrong is the lesson.**
Caught 2026-09-28 while checking whether `abi.ts` shipped. (a) `(s&256)&&(s^=369)` is not
what is in the bundle; the real text is `(s&256)!==0&&(s^=369)`, so anyone pasting the
quoted form gets 0 hits and concludes the module was tree-shaken. (b) **A needle containing
a minified identifier is not reusable.** `Cs` and `s` are esbuild's names for *this* build
and are not promised to the next, so both needles are dated, not durable — `(1600-2*Cs*8)/8`
happened to survive and `s^=369` would not have. (c) Separately, `grep` without `-F`
reported **0** for `s^=369` on a bundle that contains it. Two attempts at this check have
now gone wrong in opposite directions, each time producing a confident answer about whether
code reaches users. The durable form: **`grep -cF` with a needle made only of operators and
literals.** For keccak those are `(1600-2*`, `^=369`, `&256)!==0` and `(1n<<64n)-1n`, all
four re-verified 2026-09-28. Where a module has a distinctive error string, prefer that.
And never a bare number: `369` also occurs inside the BN254 modulus.

**Step 1i is what keccak was for.** See below.

### Step 1i also DONE (2026-09-28) — a mistyped recipient is now caught before the money moves

`src/lib/address.ts`. Four live copies of `/^0x[0-9a-fA-F]{40}$/` (`SendPanel.tsx`,
`lib/verify.ts`, `lib/transaction.ts`, `lib/hooks.ts`) folded into one door that also
verifies the **EIP-55 checksum** — keccak over the ASCII of the lowercased 40 hex
characters, which is why this could not be built before step 1h.

**Shape checking was never the problem; it was that shape is all a regex can check.** All
four copies agreed on the answer and all four answers were nearly worthless: a typo in a
recipient address is still 40 hex characters, so every one of them said yes. On a real
chain that is an irreversible payment to an account nobody controls, and nothing in this
repo could have told you which of the two addresses you meant.

🔴 **`checkAddress` returns a four-valued union and must never be collapsed to a boolean.**
This is the load-bearing decision of the increment, and it follows from a fact about EIP-55
rather than from taste: **the checksum only exists when the address has mixed case.** An
all-lowercase address, an all-uppercase one, and one with no letters at all carry *zero*
checksum information. So a boolean has to pick a lie:

| collapse | what breaks |
|---|---|
| `unchecked → true` | a typo bypasses the check entirely by lowercasing it first — and lowercase is the form explorers hand out, so this is the common path, not the exotic one |
| `unchecked → false` | most legitimately-copied addresses are refused, the check gets ripped out within a day, and rightly so |

The union names all four (`malformed` / `unchecked` / `mismatch` / `checksummed`), so a
caller is forced to say what it does about each. This is rule 10 in a different costume: a
stand-in must carry its own reason, and `unchecked` is a stand-in for a verdict that does
not exist. **Pinned by EIP-55's own vectors** — `0xde709f…fb77` is *correctly checksummed
per the spec* and must still classify as `unchecked`, because agreement carries no
information when every address has a passing lowercase spelling.

🔴 **A mismatch is never offered a correction.** `toChecksumAddress` only changes case — it
cannot change a hex digit — so on a mismatch the recomputed "correct" spelling **is the
typo, capitalised to look verified**. Offering it as "did you mean…?" would take the one
signal that caught the error and use it to launder the error. A mismatch has two
indistinguishable causes (a wrong digit, or mangled case on a right address) and it has to
assume the expensive one, so the message says *copy it again from the source* and
explicitly says not to fix the capitalisation. `tests/address.test.ts` asserts the refusal
structurally: `Object.keys(checked).sort()` is exactly `["kind", "why"]`, so there is no
field a future panel could render as a suggestion.

🔴 **`assertChecksummedAddress` verifies BEFORE it lowercases, and reversing those two
lines would be invisible.** Lowercasing first destroys the evidence: a mistyped mixed-case
recipient becomes a *well-formed lowercase* one, `abiEncodeExtData` encodes it canonically,
`extDataHash` binds it, the proof verifies, and the money is gone. Every downstream check
passes. This is the same shape as the `extData: A` / `extDataHash(B)` hole step 1h closed —
a well-formed, fully-typed, internally-consistent artefact about the wrong transaction.

**Ten `cast to-check-sum-address` vectors, plus one raw digest.** All eight canonical EIP-55
vectors re-derived on this machine, plus the no-letters and zero addresses, plus
`cast keccak $(cast from-utf8 5aaeb6053f3e94c9b9a09f33669435e7ef1beaed)` to pin the digest
itself. Commands are in the test header. 🔴 **Same tautology warning as keccak: never
regenerate a doubted vector by running our code.**

🔴 **The suite's own mixed-case fixture was an address that cannot exist.**
`tests/transaction.test.ts` used `0xAbCdEf0123456789aBcDeF0123456789AbCdEf01` as its
example of a legitimate address. `cast` says the real spelling is
`0xabCDeF0123456789AbcdEf0123456789aBCDEF01`. The old one was hand-typed alternating case —
right length, right alphabet, plausible capitalisation, **wrong account**: precisely the
artefact a typo produces, sitting in the test suite as the example of correctness. It
survived because the code only ever checked shape. Fixed, and a test now asserts the old
fixture is refused. **Worth more than the fix: it is the measurement that says checking
shape alone lets a wrong address through, taken from this repo rather than from a
hypothetical.**

**The verdict is on screen BEFORE the button, not in the error path.** `SendPanel` renders
the line live under the To field (`.dim` for a match, `.caution` for anything else). After
`Send` on a real chain there is nothing left to warn about, so a warning that only appears
on failure is a warning about money that is already gone. Tests assert the timing, not just
the wording — a suite that only pressed Send and read the output would pass against a build
that says nothing until it is too late to matter.

⚠️ **The read-only Hooks panel checks it too, and that is not over-engineering.** Mistype a
hook address and the panel reads a *different* address's permission bits and reports them
with total confidence — most likely as `inert`, "the pool will not call it at any point".
"You are safe" about an address that is not the hook is worse than an error, because the
user acts on it and nothing on screen looks wrong. `tests/hooks.test.ts` asserts the
would-have-been reading, so the claim cannot rot. It also keeps two distinct messages: the
EIP-55 sentence for a mistyped address, `NOT_AN_ADDRESS` for a pasted word — telling
someone who mistyped a real address to "paste a 20-byte 0x… hook address" points them at
the one thing already correct, and they paste the same typo back.

⚠️ **`recognize` in `lib/verify.ts` still classifies on shape, deliberately.** A
bad-checksum string still *is* an address, and that page exists to name what you pasted;
calling it `unrecognized` would hide the one mistake somebody opens it to find. The verdict
rides along in a `checksum` field instead, so the page says both things at once.

**One wording bug found by writing the test rather than the code.** The `unchecked` line
read "Lowercase address: …", which is false for an all-uppercase address (one of EIP-55's
own vectors) and meaningless for a digits-only one — both land in `unchecked`. Now "This
address has no mixed case, …". A sentence that misdescribes what the user is looking at
gets skipped, and this is the one line in the send flow whose entire job is to be read.

**Audited every address in `src/config/` with `cast` while the oracle was open.** `0x8335…`
(USDC) and the other mixed-case addresses then in config are mixed-case and all checksum
correctly; `0xa3b1…` and `0x0295…` are all-lowercase so carry no checksum, digits verified
by eye; `0x4200…0006` has no letters. **No config bug** — recorded because a mismatch there
would have meant a shipped address that is possibly wrong, and "I checked and found
nothing" is a result.

### Step 1j also DONE (2026-09-28) — the digest a wallet will be asked to sign

`src/lib/eip712.ts` and `src/lib/abi.ts`. This is **step 3 of T4**, taken out of order on
purpose: steps 1 and 2 are a wallet connection, and a digest is pure keccak arithmetic over
values the caller already holds. No key, no wallet, no socket, no signature — so rule 5
stays intact, and the whole thing is checkable offline against `cast` with nothing deployed
and nobody's money at stake. T3/T5/T6/T8 are all waiting on somebody's decision; this was
the piece that was not.

🔴 **The strongest assertion in the increment is a closed loop against a contract nobody
here controls.** `USDC_DOMAIN` is assembled from `src/config/chain.ts`, and the separator
derived from it equals what the deployed USDC contract on Base reports:

```
cast call 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  'DOMAIN_SEPARATOR()(bytes32)' --rpc-url https://mainnet.base.org
→ 0x02fa7265e7c5d81118673727957699e4d68f74cd74b7db77da710fe8a2c7834f
domainSeparator(USDC_DOMAIN)
→ 0x02fa7265e7c5d81118673727957699e4d68f74cd74b7db77da710fe8a2c7834f
```

One equality, and it verifies the domain struct's shape, the fact that the two strings are
*hashed* rather than inlined, `name: "USD Coin"`, `version: "2"`, chainId 8453 and the token
address — **all at once, and all of them config values rather than test fixtures.** Five
claims became measurements. Edit any one of those config fields and this fails, which is the
behaviour wanted: every one of those edits changes what a signature authorizes.

⚠️ **`cast` cannot hash typed data in one shot** — `cast --help` matches "typed" only inside
`decode-transaction` — so the digest is pinned compositionally, one anchored step at a time:
both typehashes, `keccak("USD Coin")`, `keccak("2")`, the 160-byte domain encoding, the
224-byte struct encoding, the 66-byte `0x1901`-prefixed preimage, and the digest itself
(`0x770c97d3…18ea`). Same discipline `abiEncodeExtData`/`extDataHash` are pinned with. There
is **not one typehash hex literal in the source** — both are derived from their type strings
at module load, so the test's literals are an independent second opinion rather than the same
number written twice.

🔴 **An EIP-3009 authorization is a BEARER INSTRUMENT, and the validity window is the whole
of its safety.** Signing one does not move money; it mints a slip anybody holding it can
redeem, once, until `validBefore`. So `validBefore = 0` is fail-safe (never valid, useless,
harmless) and `2^256 - 1` is the dangerous one — not "a payment with no expiry" but **a
standing permission to withdraw `value`**, alive in every log and clipboard it ever touches.
`validityWindow` defaults to 10 minutes and refuses anything past `MAX_AUTHORIZATION_SECONDS`
(3600). Do not raise that cap to fix a settlement timeout; a facilitator needs a block or
two, and a timeout is a different bug.

⚠️ **`validAfter` is 0 deliberately, and "tightening" it would be a regression.** EIP-3009
checks `block.timestamp > validAfter`, so a lower bound only matters for *scheduling* a
future payment. Setting it from the browser's own clock buys nothing — `validBefore` already
closes the window from the side that matters — and costs a real failure: a clock a few
seconds fast produces an authorization the chain rejects as being from the future. Zero
cannot be early. Pinned by a test so it does not get "improved".

⚠️ **`validityWindow` also refuses a millisecond timestamp**, because `BigInt(Date.now())` is
the obvious thing to write and would sign a window roughly fifty thousand years wide — the
exact standing-permission failure the cap exists to prevent, arrived at through a unit
mistake rather than a policy one. The bound is the year 10000, so the check is about the
*unit* and never expires the way "not more than a year out" would.

🔴 **The nonce is drawn from a SET, not a sequence.** EIP-3009 nonces are arbitrary `bytes32`
with one used/unused bit each: no counter, no order, no "next". Two tidier-looking wrong
answers, both rejected:

| Tempting | What it actually does |
|---|---|
| A counter | Nothing on chain says where you are in it; two tabs disagree immediately; every collision is an authorization that silently never settles |
| `keccak(from‖to‖value)` | Makes paying the same amount to the same payee **twice impossible** — the second reuses a spent nonce — and publishes the payment's contents, since an observer who guesses the fields confirms the guess by recomputing the nonce |

`randomNonce` is `crypto.getRandomValues` over 32 bytes and nothing else. Unlike
`randomFieldElement` there is no rejection loop, because every 32-byte string is a legal
nonce: no field to land in, so no sampling bias to avoid.

**The type is the argument for the nonce.** `Authorization.nonce` is `Uint8Array`, not
`bigint`, because a number invites `nonce + 1n` and there is no next nonce. `wordFromBytes32`
refuses any length but 32 — a 31-byte nonce left-padded is a *different* nonce that encodes
without complaint, so the authorization would commit to a label the caller never generated.

**`src/lib/abi.ts` exists because `writeWord` was about to be written twice.** It was private
in `transaction.ts` and `eip712.ts` needed the identical loop. Two copies of a byte layout is
the four-copies-of-a-regex smell from step 1i, and worse in one respect: both copies feed a
hash that a signature or a proof commits to, so two layouts that agree today and diverge
later produce no error — they produce a valid signature over a different transaction. The
128-byte Solidity-pinned vector did not move, which is what made the extraction safe to do.

🔴 **`encodeWords` throws on an out-of-range word where the old `writeWord` masked.** Masking
is what falls out of writing the loop the obvious way — take 32 bytes, stop caring. Nothing
in the repo can reach it and it must still throw, because of what silence means *here*:
`2^256` masks to **zero**, and a zero `value` word is a *free* authorization that reads like
a deliberate one. The user sees one number on screen and signs another. Refusing is the only
behaviour that keeps the bytes and the screen describing the same thing.

⚠️ **Neither new module is in the production bundle, and that is measured, not assumed.**
`grep -cF 'TransferWithAuthorization' dist/assets/*.js` → 0, `grep -cF 'does not fit a
256-bit' …` → 0, bundle unchanged at 224.51 kB. The reason is one level deeper than
"eip712 has no consumer yet": **`transaction.ts` has exactly one importer in the entire
repo, `tests/transaction.test.ts`.** So the whole ext-data/public-input encoder is
test-only, `abi.ts` inherits that, and the unchanged byte count has a fully understood
cause rather than a worrying one. Both files carry a status block saying so; re-grep rather
than trusting either.

> **Half of that is SUPERSEDED by step 1k, same day.** Re-measured after the requirements
> check shipped: `TransferWithAuthorization` → **1**, `EIP712Domain(` → **1**, bundle
> **229.46 kB**. `eip712.ts` is in production now, because `requirements.ts` reads
> `USDC_DOMAIN`, `MAX_AUTHORIZATION_SECONDS` and `validityWindow` on the live price path.
> The `abi.ts` half is still 0 and for a precise reason worth keeping: `authorizationFor`
> is exported but has no caller, so rollup drops it and with it `authorizationDigest` →
> `encodeAuthorization` → `encodeWords`. The **digest** path still does not ship; the
> **domain** path does. Left as a correction rather than an edit — the original numbers are
> the evidence for a decision already taken, and overwriting them makes it unauditable.

### Step 1k also DONE (2026-09-28) — the 402 is checked before anything can display it

`src/lib/requirements.ts`, and a rewrite of `Price`. This is **step 2 of T4**, and it turned
out to be a bigger change than "assert some fields" because of what measuring the live 402
revealed.

🔴 **The brief was impossible as written, and the measurement is what showed it.** The plan
above says: take a live-parsed `Price` and assert its fields. But `parsePrice` kept only
**four** of the seven requirement fields and threw away `scheme`, `extra.{name,version}` and
`maxTimeoutSeconds` — which are exactly the three a signature's safety rests on. A checker
placed downstream of `Price` is therefore not merely inconvenient, it is **structurally
unable** to check the things worth checking, because the evidence is already gone. So the
check had to *become* the parse, and `Price`'s paid variant had to become the checker's
output type:

```ts
export type Price =
  | { kind: "paid"; requirements: PaymentRequirements }   // ← was four loose fields
  | { kind: "free"; why: string };
```

There is now no way to construct a displayed price that was not checked — not because a
developer must remember to check, but because the type of a price is the output of the
checker. Same device as `Attestation` and `Anchoring`.

**MEASURED 2026-09-28** — `GET https://blueagent.dev/api/x402/<id>` for `token-price`,
`wallet-risk` and `blue-audit`: three different prices, byte-identical shapes.

| field | value | note |
|---|---|---|
| `x402Version` | `2` | |
| `accepts` | **exactly 1** entry, on every id | |
| `scheme` | `"exact"` | was being dropped |
| `network` | `"eip155:8453"` | 🔴 **CAIP-2, not the bare number** |
| `asset` | `0x833589fC…02913` | checksummed USDC |
| `payTo` | `0x02950ad3…809205` | all-lowercase, matches `BLUEAGENT.knownPayTo` |
| `maxTimeoutSeconds` | `120` | was being dropped |
| `extra` | `{ name: "USD Coin", version: "2" }` | was being dropped |
| `amount` | `"10000"` / `"50000"` / `"1000000"` | |
| `decimals` | **absent entirely** | |

Also measured: `hood-live` answers `free: true`, and `hub-risk-gate` answers **501**
`TOOL_UNAVAILABLE` — confirming the phantom-id branch in `parsePrice` is real.

🔴 **`network` is CAIP-2 and this was nearly a shipped bug.** An assertion written against
`BASE.id` without measuring — `accept.network !== BASE.id` — would have refused *every real
402*. The parser now pins the form with `/^eip155:(\d+)$/` and then the id, refusing
`"8453"`, `"base"` and `"solana:8453"` alike. Lenient parsing is not available on this
field: the chain id is the thing that stops a signature being replayed on another chain.

🔴 **`maxTimeoutSeconds: 120` supersedes a guess.** `DEFAULT_AUTHORIZATION_SECONDS = 600n`
in `eip712.ts` was chosen before this field was ever read. Signing a ten-minute window for a
two-minute settlement is **5× the bearer-instrument exposure for nothing**. The live path
now reads upstream's number and caps it; the 600 stays only as the fallback for callers with
no requirements to read. The local stub carries its own `SETTLEMENT_SECONDS = 120` rather
than importing the fallback, because a stub using 600 would be quietly claiming upstream
asks for ten minutes.

🔴 **Authority differs PER FIELD, and the two directions are not interchangeable.** This is
the part to read before editing anything in that file:

| field | authoritative side | why the other direction is wrong |
|---|---|---|
| `payTo` | **upstream** | `BLUEAGENT.knownPayTo` is only ever an assertion. A constant used as the *destination* keeps paying the old payee after upstream rotates — a silent misroute, not an error |
| EIP-712 domain | **config** | Upstream's `extra.{name,version}` is only ever compared. A domain built from upstream's strings would let the payee choose the domain its own signature is verified under, and `domainSeparator` would dutifully produce a valid separator for it |

`assertDomain` returns `USDC_DOMAIN` **by identity**, and a test asserts `toBe` rather than
`toEqual` to pin exactly that.

⚠️ **An unrecognised payee is a VALUE, not a throw.** A rotated payee leaves the 402
perfectly readable, so throwing would make the price un-renderable over a problem the user
can actually be told about. `Payee` is a union (`known | unrecognised`) and not a
`recognised: boolean` — rule 10 — so the refusal has to be rendered rather than ignored.
`whyNotSign` refuses the `unrecognised` variant, and `authorizationFor` refuses it **again**,
so a panel that forgets to ask still cannot sign. `HttpCatalog.whyNot` reports it *after*
`NO_WALLET`, deliberately: the missing wallet is the reason that goes away, the payee is the
one that outlives it.

**The panel shows it today, while nothing can sign.** Suppressing the note until signing
exists would mean it first appears on the day signing lands — the worst possible day to
learn upstream moved its payee. A warning that stays silent for exactly the period when
reading it is free has spent its whole cheap life saying nothing. `.caution`, not the error
path: the price is real and the tool runs the moment a wallet exists.

**Every bound REFUSES. None of them clamp.** Amount over `MAX_TOOL_PRICE_BASE_UNITS`
(5 USDC, anchored to the live catalog's own maximum of $1.00), window over
`MAX_AUTHORIZATION_SECONDS`, more than one `accepts` entry — all throw. Clamping would show
a user one number and sign another, which is the `encodeWords` masking argument from step 1j
in a different costume. `accepts.length > 1` is refused rather than defaulting to
`accepts[0]`: which one to prefer is a decision nobody has made, and array order is the one
way of making it that cannot be reviewed.

**A duplicated payment rule was deleted, not left alongside.** `KNOWN_ASSETS` and `assetOf`
in `http/catalog.ts` were a second, independent opinion about which assets are acceptable,
sitting on the path whose output gets signed — the same two-copies hazard `lib/abi.ts` was
extracted to end. `assertAsset` is now the only one. Note it deliberately does **not** run
EIP-55: there *is* another copy of that address, and comparing against it is strictly
stronger than checking a checksum.

⚠️ **`payTo` is the one address on this path where EIP-55 cannot help.** Both upstream's
`payTo` and `BLUEAGENT.knownPayTo` are all-lowercase, so `checkAddress` returns `unchecked`
for both and there is no checksum to verify. The constant comparison is not a
belt-and-braces extra — it is the only check this field has.

**The local stub is now provably a shape production could produce.** `priceOf` assembles
upstream's envelope and hands it to `checkRequirements` instead of building a
`PaymentRequirements` literal. A literal would have been shorter and is exactly the drift
that file's own header forbids — *"a stub is a claim about upstream; copy it, do not compose
it"* — and it would pass a `toEqual` while proving nothing. Now if `PAY_TO`, `NETWORK` or the
domain ever drift out of agreement with `config/`, the test suite throws rather than a user
seeing it.

⚠️ **A doc comment that names the grep to run will match that grep.** The first version of
this module's status block said "to re-check, grep `src/` for an import of this module" — and
`grep -rln 'from "@/lib/requirements"' src/` returned `requirements.ts` itself, because the
sentence describing the grep matched it. Read the hits, never count them; the bundle needle
is the reliable answer. Now measured the other way round:
`grep -cF 'not the CAIP-2 form' dist/assets/*.js` → **1**.

**What is left of T4, in order:** step 1 (EIP-1193 connect, guard the chain to `0x2105`),
then `eth_signTypedData_v4` over the digest `authorizationFor` already returns plus the
`{v,r,s}` split, then step 4 (base64 `X-PAYMENT`), then step 5 (settlement — keep
`kind: "settled"` as the only variant carrying `txHash`; do **not** add `paid: boolean`).
Step 6 is partly done already: `whyNot` is per-price, not per-adapter.
*(Step 1 landed later the same day — see Step 1l below. The sentence above is left as
written, because it is the list the next steps were chosen from.)*

### Step 1l also DONE (2026-09-28) — a wallet can be connected, and no answer is taken on trust

`src/lib/wallet.ts` + `tests/wallet.test.ts` (65 tests). T4 step 1. Taken ahead of T3 on
the same reasoning as steps 2 and 3-digest: connecting a wallet needs no forwarder and no
owner decision, and only steps 4 and 5 genuinely wait on T3.

**The module asks and never holds** — no key, no signature, no transaction, the same
boundary `eip712.ts` and `requirements.ts` keep (rule 5). `tests/wallet.test.ts` enforces it
by reading the source and banning `eth_sign`, `personal_sign`, `eth_sendTransaction`,
`eth_sendRawTransaction`, `privateKey`, `PRIVATE_KEY` and `mnemonic`. ⚠️ It deliberately
does **not** ban `eth_signTypedData_v4`: that call is where T4 goes next, and a test that
forbids the next planned commit is a test somebody deletes without reading the reason. The
sharpest ban is `eth_sign` — signing a 32-byte digest through it yields *the same signature*
as `eth_signTypedData_v4` while showing the user opaque bytes instead of an amount and a
recipient. A companion test proves the regex can tell those two apart, so the ban cannot
rot into a no-op.

🔴 **The near-bug: comparing chain ids as strings.** The obvious implementation is
`answer === BASE.idHex`. It works. It passes every test in this repo. It is wrong, and it is
wrong in a way this codebase could not have caught, because Base is `0x2105` — four digits,
no letters, one canonical spelling. Any chain whose id contains `a`–`f` has two valid hex
spellings and a case-sensitive compare picks one. `parseChainId` returns a `bigint` and the
comparison downstream is numeric. **A decimal string is refused, not accepted generously:**
`"2105"` is chain 2105 read as decimal and chain 8453 read as hex a provider forgot to
prefix, and there is no way to tell which was meant. Guessing there means possibly signing
on the wrong chain. Compare `errorCode` in the same file, which *does* accept a numeric
string — the asymmetry is deliberate and documented in both places, because the cost of
misreading an error code is a less friendly sentence. **Strictness is priced per field.**

**Five states, not `{ address, chainId } | null`** (rule 10 again): `unavailable`, `failed`,
`disconnected`, `wrongChain`, `ready`. A null collapses four situations that need four
different sentences and three different buttons, and the panel would have to guess which —
the guess being "install a wallet" said to somebody who has one, which is the same class of
lie `lib/address.ts` documents when a mistyped address is told to paste an address.
`ready` carries the account and **no chain id**, reusing the decision `PaymentRequirements`
makes about `network`: a chain that has been checked has nothing left to report, so holding
a `ready` *is* holding "on Base". A test asserts `Object.keys(state)` is exactly
`["account", "kind"]`, so a later "just add chainId, the panel wants it" cannot land quietly.
`wrongChain` does carry its id, because that is the unverified fact the user must see.

**Every request ends by re-measuring.** EIP-3326 has `wallet_switchEthereumChain` resolve
`null` on success — and a wallet that decided to leave you where you were also resolves
`null`. The return value carries no information at all, so prompt-and-hope is not merely
sloppy here, it is unimplementable. `connectWallet` and `requestBaseChain` both finish with a
`readWallet`, and an error from the request they just made can only **relabel** that
measurement, never replace it: an error code describes the instant of a refusal, the
measurement describes now, and the user may have acted in between. `ready` and `failed` are
never relabelled. Codes handled: `4001` declined, `-32002` a prompt is already open
(MetaMask), `4902` the chain is not configured.

🔴 **This build never calls `wallet_addEthereumChain`, and the refusal is in the copy the
user reads.** Adding a chain is not a convenience, it is a write into the user's wallet that
**outlives this page**: an RPC endpoint, an explorer and a currency symbol stored under the
name "Base", after which every Base transaction they make *on any site* goes through
whatever we wrote. Saving one manual step by permanently repointing somebody's RPC is a
decision that is not ours to make. On `4902` the sentence says to add it in the wallet and
says why we will not.

**An unreadable chain id is not the wrong chain.** Collapsing the two tells somebody already
on Base to switch to Base — the one instruction they cannot follow. And a non-array
`eth_accounts` answer is `disconnected`, not `failed`: the only claim it supports is that
there is no account to pay from, connecting fixes it either way, and "unlock your wallet"
said to somebody whose wallet is not locked is unfollowable.

**Three test bugs found while writing the tests, all mine, all worth recording:**
1. ⚠️ **A negative assertion tripped on the module's own disclaimer.** `unreadableChain`
   says "It is not a claim that you are on the wrong network", so
   `not.toMatch(/wrong network/i)` failed on the sentence that *denies* the claim. Same trap
   as a doc comment matching the grep it recommends (Step 1k). **Assert on the instruction a
   user would act on**, not on a phrase the denial also contains.
2. `"0x".padEnd(300, "9")` is valid hex, so the "absurd chain id" test measured `wrongChain`
   rather than the refusal it was aiming at. Replaced with `"z".repeat(300)` — non-hex, and
   the more realistic shape anyway (an error page where a chain id belonged) — plus a new
   test that a merely enormous hex id reports as the wrong chain, which is correct.
3. **The unsubscribe test was measuring the fake.** It retained the handler references and
   called them after `stop()`; they still fire, because unsubscribing is the provider
   forgetting the handler, not the closure becoming inert. Rewritten to fire every listener
   before `stop()`, then assert the fake's listener array is empty — which, since the fake
   splices on reference equality, *is* the proof that `watchWallet` removed the same function
   object it added.

**`watchWallet` is a doorbell, and must not learn to reload.** Its handler takes no
arguments on purpose: `accountsChanged` carries accounts and no chain, `chainChanged`
carries a chain and no accounts, so each payload is half a verdict and acting on half is how
you end up displaying an account from one wallet with a chain from another. It requires
*both* `on` and `removeListener` before subscribing — subscribing with no way to unsubscribe
is a leak — and degrades to a no-op otherwise, because the events are a SHOULD in EIP-1193
and some embedded providers ship `request` alone.

⚠️ **`src/brand.ts` is the single rename point, and this module proved the guard works.**
`npm run gate` failed on `tests/brand.test.ts` with `expected [ '/src/lib/wallet.ts' ] to
deeply equal []` — four hardcoded "Quadra" literals, three in user-facing sentences and one
in a doc comment (the guard checks *file text*, so comments count). The three sentences now
template `${BRAND.name}`; the comment was reworded. The distinction the guard encodes is
**prose vs identifier**: a name a person reads may change, a name some byte on a disk or on
a chain is keyed to may not — which is why its four exemptions are a `localStorage` key, a
hash domain tag, a backup format marker and an empty-leaf preimage. None of this file's
strings are in that category. Note `tests/` is not scanned; the test-file comment was
normalised anyway, and no assertion in it contains the product name.

⚠️ **Nothing imports this yet, measured in the bundle rather than inferred.**
`grep -cF` on `dist/assets/*.js` returns **0** for `wallet_switchEthereumChain`,
`eth_requestAccounts`, `accountsChanged` and the literal `Free tools need no wallet`, while
the four keccak control needles (`(1600-2*`, `^=369`, `&256)!==0`, `(1n<<64n)-1n`) return 1
each, so the method itself is working. The bundle is **229.46 kB / gzip 75.21 kB before and
after, with the same content hash** — identical to Step 1k's. This is the **third** module
in that position, and the other two are why it is written down: `transaction.ts` still has
only its own test as an importer, and `eip712.ts`'s status block claimed nothing imported it
while `requirements.ts` had already been importing six names from it for a commit. That
block was corrected in this commit to say what is actually true — the *domain* half ships
(`TransferWithAuthorization`, `EIP712Domain` and `USD Coin` are each in the bundle once) and
the *digest* half has no caller outside tests. **A stale absence claim is worse than none:**
it reads as a measurement, so the next reader trusts it instead of grepping.

**Next increment (commit B):** wire it in. A React seam holding a `Wallet`, the x402 panel
rendering all five states, and T4 step 6's relaxation of `whyNot` — at which point re-read
the warning in step 6 above, because when `NO_WALLET` leaves that composed string the payee
refusal has to survive alone. Until then, the 65 tests say only that the verdicts are right
about a **fake** provider. No real wallet has answered this code.

### Steps 2 and 3 are NOT done, and step 2 is not a deployment step

**There is no verifier and there is no Poseidon.** `IVerifier` has no implementation
under `src/`. What exists is `test/doubles/TestVerifier.sol` and
`test/doubles/TestHasher.sol`, and neither is a step toward the real thing:

🔴 **`AcceptingVerifier` returns `true` for everything.** It compiles, the suite goes
green, the pool "works", and the only symptom is that anybody can drain it. **Nothing
under `src/` may import it, ever.** It exists so the pool's own logic can be tested.

🔴 **`TestHasher` is keccak**, and it satisfies every property the tree needs —
deterministic, in-field, collision-resistant — which is exactly what makes it
dangerous. A 20-level keccak Merkle path is a proof a browser cannot produce. Shipped,
it gives a pool whose deposits work, whose tree is valid, and whose withdrawals nobody
can afford to prove.

So what is actually left:

1. **A circuit**, and a Groth16 verifier generated from it. This is the large piece and
   it is not Solidity work.
2. **Poseidon deployed**, with the same parameters the circuit uses.
3. **A trusted setup whose provenance is written down.**
4. **An external audit.** 100% coverage says every branch has been executed, not that
   the design is sound. Those are different claims and only the first is measured.
5. **An `OnchainPool implements ShieldedPool`** alongside `src/adapters/local/pool.ts`.
   That interface in `src/adapters/types.ts` is the seam — an on-chain implementation
   drops in without the UI changing.
6. `CONTRACTS.shieldedPool` / `CONTRACTS.verifier` filled in from a **Basescan-verified**
   deployment, never from a deploy log. Until then they stay `null`.

### ⚠️ DECISION FOR SHUNTR — join-split leaks amounts, and the UI must not claim otherwise

This one is written down here rather than settled in the contract, and **it is the one
item in T7 a session must not decide alone.**

The pool is **join-split**: two notes in, two notes out, arbitrary signed net amount. A
note can be spent for part of its value with the rest coming back as change. It was
built that way because the UI already promises it — `ShieldedPool.send(noteId, to,
amount)` in `src/adapters/types.ts` takes an arbitrary amount and `LocalShieldedPool`
already makes change.

**Fixed denominations (Tornado's design) give a strictly stronger guarantee.** Every
withdrawal looks exactly like every other, so the anonymity set is everyone in the pool.
Join-split does not: deposit 137.42 and withdraw 137.42 and the link is visible to
anybody reading the chain, with **no cryptography broken**. Join-split makes that
*possible* to avoid rather than automatic — the user has to not do it.

Three options, none of them free:

- **(a) Keep join-split, and make the UI honest about it.** The product copy cannot say
  "nothing tying it to you" without qualification. Needs the note-merge move surfaced
  (see below) and probably a warning when an amount is round or matches a deposit.
- **(b) Switch to fixed denominations.** Stronger privacy, and it breaks the `send`
  interface and the change-making the local pool already does. A large UI change, not a
  contract tweak.
- **(c) Both** — denominated pools for the privacy claim, join-split for convenience,
  with the difference stated. Most work, and two things to audit.

Note what already exists in support of (a): `publicAmount == 0` with no fee is
deliberately **not** rejected. That is two notes in, two notes out, nothing crossing the
boundary — a merge or a re-split. It is how a wallet consolidates dust and the one move
a user has for repairing the amount correlation this shape leaks. An early version
refused it as "nothing to do"; the test `test_allowsANoteMergeThatMovesNoMoney` exists
to stop that coming back.

**Do not build T8 against a privacy claim this shape does not give.** That is the same
question T8 asks about the venue, arriving from the other side.

### Standing, for this task

**The rule that shapes this, from `types.ts`:** a stub that emits a plausible-looking
proof is worse than no stub, because you cannot tell it from the real thing by looking
at the output. `Anchoring` and `Attestation` are discriminated unions where only the
real variant has a `txHash` / `quote` / `measurement` field **at all**. Faking a proof
does not typecheck. Keep it that way.

**And the one that matters most:** a note's `secret` is the money. Never logged, never
in a URL, never sent to a server. Test that property, don't just intend it.

---

## [Archived] T8 — Build `swap`

**Size:** large. **Blocked by T7** — this is the panel that trades against a real venue.

**A local-pool simulation shipped 2026-09-28 and was withdrawn 2026-09-29.** It traded a
USDC note for a tokenized-stock note at a stale reference rate; the owner removed that pair
from the codebase, which removed the only price the window had, so `swap` went back to an
amber notice with an inert preview (`panels/SwapPanel.tsx`). `LocalShieldedPool.swap` is
still there and still tested — it is pair-agnostic note mechanics and trusts the caller's
`outAmount`, so whatever comes next needs only a token and a price source, not a new pool
method. WETH is already verified in `config/chain.ts` and is what the preview names.

**This task is still open**: `swap` — "trade with nothing tying it to you" — is the
product's headline claim and the heaviest thing left. It needs the deployed shielded pool
(T7) plus a venue on Base to actually trade against. Until both exist the *real* trade
path does not exist; the local simulation must keep saying, in its own copy, that it is a
reference price and not a market fill — a swap screen that looks like it is quoting a real
venue is the single worst thing this repo could ship.

**The pool contract existing does not unblock this.** As of 2026-09-27 `contracts/` is
written and fully tested, but there is no verifier and no Poseidon, so nothing is
deployed and `CONTRACTS.shieldedPool` is still `null`. `requireContract()` will throw
naming the unset constant, which is the correct behaviour and not a bug to route around.

**Open question for ShunTr before building:** which venue, and whether the privacy
claim survives it. Routing a shielded balance through a public pool can undo exactly
the unlinkability the panel promises, and that is a product decision, not an
implementation detail. **And a second one, new since 2026-09-29:** where a live price
comes from. A frozen number in source is ruled out — see `WAITING_ON.swap`.

---

## [Archived] T10 — Evaluate Railgun on Base as the pool, before finishing our own circuit

**Size:** medium (an evaluation with a spike, not an integration). **Next, and blocks the
choice between T7 steps 2–3 and an integration.** Decided 2026-09-29.

**Why this comes first:** our pool has contracts and tests but no circuit, no verifier and
no Poseidon (T7 step 2 — the larger half), and at launch it would have the smallest
anonymity set on Base. Railgun has audited circuits, years of use and ~$92M TVL. If it can
carry the T6 flow, building our own proving stack is months of risk for a worse result.

What was established 2026-09-29, from Railgun's own docs and L2BEAT — **re-check each line,
the Base part was moving that month:**

| Question | Finding |
|---|---|
| Live on Base? | **Yes — and nearly unused. MEASURED ON CHAIN 2026-09-29** (`cast call`, mainnet.base.org): `0x0047d1F97674614189E80566575FB615788AcF25` is a proxy (EIP-1967 implementation `0x8629b39134362fedc001636e0726570b8d2dffd1`); `getVerificationKey(1,2)` returns a populated key, so the August proposal took effect; `shieldFee()` and `unshieldFee()` are 25 bps; **`treeNumber()` 0, `nextLeafIndex()` 1** — one commitment ever. The same calls on Ethereum's proxy (`0xFA7093CD…4b9`) answer tree 4, leaf 17504. Railgun's own docs page still lists no Base address. Its Base treasury (`0x0AE354F8…69ae`) differs from Ethereum's. |
| Fees | 0.25% on shield, 0.25% on unshield, to the treasury. Broadcaster (relayer) premium "generally ~10% of the total gas". |
| Waiting period | 1-hour "Unshield-Only Standby Period" after a shield, during which funds can only go back to the depositing address. Fine for a top-up; fatal for pay-on-deposit. |
| Compliance | Private Proofs of Innocence against list providers (Elliptic, ScamSniffer, PureFi, SlowMist, Chainalysis Sanctions Oracle). |
| Browser SDK | `@railgun-community/wallet` (TypeScript, node + browsers) over the Engine; broadcasters via a Waku client with a web build. |
| Unshield to a fresh address | Yes — an unshield names its recipient, which is what a T6 session address needs. |

🔴 **What the measurement changes.** The argument for Railgun was two things: audited circuits,
and an anonymity set our new pool would not have. On Base the second is false today — Railgun
there holds one commitment, so it starts near zero exactly as ours would. What is left is
the circuits, the proving tooling, PPOI and a shared pool other Railgun apps will also fill
as they arrive on Base. That is still the larger half of T7 step 2 avoided, so the lean is
unchanged, but "join the bigger crowd" is not a reason on this chain yet — and Quadra's agent
traffic could be a meaningful share of the crowd that forms.

### 🔴 Veil Cash — a third candidate, and the closest competitor (researched 2026-09-30)

**Veil (veil.cash) already ships the product T6 describes, on Base.** A shielded pool for ETH and
USDC built on Tornado Nova (UTXO, Groth16, Poseidon, arbitrary amounts), and its MIT-licensed
`@veil-cash/sdk` 0.7.0 (commit 2026-06-03) adds `payX402Resource()`: pay a standard x402 v2
Base-USDC `exact` resource from the private balance by relay-withdrawing the exact price to a
fresh, deterministically derived payer EOA, with a `maxPayment` cap and `quoteX402Resource()` to
price first. It ships a CLI and an agent skill (`skills/veil/SKILL.md`). Browser proof generation
is supported.

MEASURED ON CHAIN 2026-09-30 (`cast`, mainnet.base.org): USDC pool
`0x5c50d58E49C59d112680c187De2Bf989d2a91242` `nextIndex()` **2322**, holding **2,592.45 USDC**;
ETH pool `0x293dCda114533FF8f477271c5cA517209FFDEEe7` `nextIndex()` **6110**, holding **6.6158
WETH**. Compare Railgun on Base: 1. Small TVL, but a real, used pool.

How it differs from what Quadra would build: deposits are **gated** — EAS attestation (Coinbase
Onchain Verification, Binance BABT, Ethos) for automatic approval, 0xbow manual review otherwise,
deposits wait in a queue and a declined one is refunded; 0.3% deposit fee; relayer withdrawals at
fee 0 (subsidised), minimum 0.001 USDC; a `$VEIL` token (25% of supply for incentives). Its x402
path withdraws **once per payment**, not per session (see T6's design constraint). Not established
here: audits of Veil's own changes (Nova's 2021 audit is not Veil's), and who ran Veil's trusted
setup — **check both before building on it.**

What it means: Quadra is no longer first to "private x402 for agents on Base". The defensible
layer is what Veil does not ship — a GUI and desktop app, approving an agent's payments, a spend
guard beyond a per-payment cap (daily limits, per-origin payee pins, full 402 checks), directories
(BlueAgent, Bazaar), and pool-agnostic multi-chain later. **Recommendation for this task: add a
Veil adapter behind `ShieldedPool` as the first candidate to spike, ahead of Railgun** — it has
the users, the x402 flow and the licence. The choice stays ShunTr's.

To finish the evaluation: (1) ~~confirm Base activation on chain~~ done, above; (2) spike: shield Sepolia
USDC in a browser, unshield to a fresh address through a broadcaster, time it and cost it;
(3) read the SDK and contract licences; (4) check bundle weight (the proving artifacts are
large) against this app's load; (5) decide what "no key held here" means when the Railgun
wallet key lives in the browser — it is the user's key in the user's browser, which fits
hard rule 5, but say so in writing.

**Done when:** a written recommendation — Railgun, our pool, or both behind the existing
`ShieldedPool` interface — with the spike's measured cost per session top-up.

---

