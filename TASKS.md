# TASKS — what is left to finish Quadra

Handoff document. Written 2026-09-27 for a session that has never seen this repo.
Read `CLAUDE.md` first — it has the constraints and the rules that exist because
something broke. This file is only the work.

**Before you start anything:** `npm install`, then `npm run gate`. It must be green
(tsc clean, 473 tests, 100% on statements/branches/functions/lines, build succeeds).
If it is not green on a fresh checkout, fix that before touching a task — you are
looking at drift, not at your own change.

**Before you report anything done:** `npm run gate` again, green, all three parts.
Say which three. "Build is green" has been used to mean "tsc passed" and it was not.

---

## Where the product actually is

| Panel | Flag | State |
|---|---|---|
| `send` | on | built, works against the local pool |
| `inference` | on | built, works against the local enclave |
| `x402` | on | built, **free runs work end to end against the live catalog; paid runs cannot** |
| `hooks` | on | built, read-only |
| `mcp` | on | built, read-only |
| `swap` | on | **not built** — renders an honest amber notice |
| `router` | on | **not built** — same |
| `audit` | on | **not built** — same |
| `bridge` | off | rendered dimmed |
| `launch` | off | rendered dimmed |

Flags live in `src/config/chain.ts` → `FLAGS`. The "built" set is `BUILT` in
`src/features/FeaturePanel.tsx`. A panel is honest today; the failure mode to avoid
is making one *look* finished before it is.

Every contract address in `src/config/chain.ts` → `CONTRACTS` is `null`. That is
deliberate and load-bearing. `requireContract()` throws naming the unset constant.
**Do not put a zero address anywhere.** A zero address in a payment path looks real
and fails silently.

---

## T1 — Stop `/api` describing endpoints that do not exist

**Size:** small. **Blocks:** nothing. **Do this first** — it is the one task where
the current state is actively untrue.

`src/pages/ApiPage.tsx` documents `https://quadra.computer/api/services` as public
and free to read. There is no such endpoint, no such deployment, and no such domain
pointed anywhere. It is harmless while the repo is private and a live falsehood the
day it ships.

Pick one:
- **(a)** Reword the page to describe what exists — an SPA with no server API — and
  move the endpoint table under a heading that says it is the intended shape, not a
  live surface. Cheapest, honest, reversible.
- **(b)** Build the endpoints. Requires a server, which the static build does not
  have. See T3; do not start here.

**Done when:** no page in `src/pages/` claims a URL that does not resolve, and the
tests in `tests/` assert that rather than just rendering it.

---

## T2 — The document overflows the viewport at 390px

**Size:** small-to-medium, unknown until measured. **Blocks:** nothing.

At a 390px viewport the document is wider than the window on both `/` and `/api`,
so the page scrolls sideways. This predates the recent CSS work — it reproduces on
the bare card grid.

Already ruled out, do not re-check these:
- `.cards` is `repeat(auto-fill, minmax(168px, 1fr))` and is correctly responsive.
- `.taskbar` is `position: fixed; inset: auto 0 0 0` and cannot widen the document.
  Its tray overflows the fixed bar because flex items don't shrink below min-content,
  which is a separate and smaller problem.

You need real layout measurement, not jsdom — jsdom has no layout and cannot see
this. Use headless Chrome (recipe in `CLAUDE.md`) or `getBoundingClientRect` through
a real browser.

**Judgement call inside this task:** making a Windows-XP-desktop metaphor work on a
phone is a design decision nobody has made. Fixing the overflow is fine. Redesigning
the desktop for mobile is not — flag it and stop.

---

## T3 — Decide and build the production forwarder

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

**Done when:** a production build, served the way it will really be served, runs a
free tool end to end — and the honest-failure path still works when the forwarder is
absent.

---

## T4 — Wallet + EIP-3009 signing, so paid runs work

**Size:** large. This is the biggest remaining piece of the product. **Blocked by T3**
(a signed payment still has to reach upstream through a same-origin POST).

Today `catalog.whyNot(price)` refuses every paid price because there is no signing
code. 109 of the 115 catalog tools are paid. Making them run means:

1. **Connect a wallet.** EIP-1193 injected provider. Guard the chain — Base is 8453,
   `BASE.idHex` is `0x2105` in `src/config/chain.ts`. A signature produced on the
   wrong chain is a silent failure, so refuse rather than prompt-and-hope.
2. **Read the payment requirements off the live 402.** They are already parsed —
   `Price` in `src/adapters/types.ts` carries `payTo`, `amountBaseUnits`, `asset`,
   `network`. **Never assemble a price locally.** `BLUEAGENT.knownPayTo` exists only
   to assert against, never to send to; if the live `payTo` ever differs from it,
   that is a signal, not a default.
3. **Sign an EIP-3009 `TransferWithAuthorization`.** USDC on Base, EIP-712 domain
   `{ name: "USD Coin", version: "2" }`, verifying contract `USDC.address`, 6 decimals.
   All in `src/config/chain.ts`.
4. **Base64 the authorization into an `X-PAYMENT` header** and re-POST the tool.
5. **Read the settlement back.** `Settlement` in `types.ts` has three variants and only
   `kind: "settled"` carries a `txHash` — by design, so an unsettled run cannot render
   as paid. Keep that property. Do not add a `paid: boolean`.
6. **Relax `whyNot`** so a paid price is refused only when there is genuinely no wallet
   or no chain — not unconditionally. Read the long comment on `Catalog.whyNot` before
   you change it; it explains why this is per-price and not per-adapter.

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

## T5 — Build `audit`

**Size:** small-to-medium. **Blocked by T4** if the underlying tool is paid; check the
live quote first — it may be one of the six free ids.

`audit` — "score any GitHub repo" — is not new compute. BlueAgent's catalog already
has repo-health tooling, so this panel is an x402 call with a purpose-built form and a
readable result, not a new backend. Look at `X402Panel.tsx` for the quote → input →
run → receipt shape and build the narrow version of it.

**Done when:** it scores a real repo from a real source, and it does not invent a
number when the source has nothing to say. "Cannot assess" is the correct answer to
absent data — never a fabricated low score.

---

## T6 — Build `router`

**Size:** medium. **Blocked by T4.**

`router` — "pay any service, any token" — is the general case of what the x402 panel
does for one catalog. Needs: an arbitrary 402 endpoint as input, a quote read off that
endpoint's own 402, and the same signing path as T4.

**Open question you must not answer alone:** "any token" implies a swap or a
multi-asset settlement path. Today everything is USDC. Ask ShunTr what "any token"
means here before building a swap into the payment path.

---

## T7 — Foundry scaffold + the shielded pool contract

**Size:** large. **Blocks T8.** Independent of T3–T6 — can be done in parallel.

There are no contracts yet. `src/adapters/local/pool.ts` is a browser-local
implementation behind the `ShieldedPool` interface in `src/adapters/types.ts`. That
interface is the seam: an on-chain implementation drops in without the UI changing.

1. Foundry project, anvil for local tests.
2. Shielded pool + verifier. `CONTRACTS.shieldedPool` and `CONTRACTS.verifier` stay
   `null` until each is deployed **and verified on Basescan**.
3. An `OnchainPool implements ShieldedPool` alongside the local one.

**The rule that shapes this, from `types.ts`:** a stub that emits a plausible-looking
proof is worse than no stub, because you cannot tell it from the real thing by looking
at the output. `Anchoring` and `Attestation` are discriminated unions where only the
real variant has a `txHash` / `quote` / `measurement` field **at all**. Faking a proof
does not typecheck. Keep it that way.

**And the one that matters most:** a note's `secret` is the money. Never logged, never
in a URL, never sent to a server. Test that property, don't just intend it.

---

## T8 — Build `swap`

**Size:** large. **Blocked by T7** — this is the panel that needs the pool to exist.

`swap` — "trade with nothing tying it to you" — is the product's headline claim and
the heaviest thing left. It needs the deployed shielded pool (T7) plus a venue on
Base to actually trade against. Until both exist the panel must keep saying it is not
built; a swap screen that looks operational and cannot swap is the single worst thing
this repo could ship.

**Open question for ShunTr before building:** which venue, and whether the privacy
claim survives it. Routing a shielded balance through a public pool can undo exactly
the unlinkability the panel promises, and that is a product decision, not an
implementation detail.

---

## T9 — Launch `$QUADRA` against AAPLc

**Size:** large. **Blocked by T7 and by the product being finished.** **This is
ShunTr's call to trigger, not a session's.**

`LAUNCH_TOKEN` in `src/config/pair.ts` is `null` and **no address may be guessed for
it.** AAPLc is verified and asserted on chain — `0xb200000000000000000000C2e324d24d7eEcd1fb`,
8 decimals not 18, a native B20 precompile with no Solidity source. Re-assert all four
checks in that file's header before anything holds funds; the numbers in
`AAPL_REFERENCE_POOL` are a dated measurement, not a constant.

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

1. **T3** — the deployment target. Converting to Next/Workers changes what this repo is.
2. **T4** — whether Quadra ever holds a key or signs on a user's behalf. Today it does
   not, and the MCP server in `tools/quadra-mcp/` holds no keys at all. Changing that
   is a custody decision, not a refactor.
3. **T6** — what "any token" means in the router.
4. **T8** — which venue `swap` trades against, and whether the privacy claim survives it.
5. **`bridge` and `launch`** — both flags are off. Whether they get built at all.
6. **T9** — the launch itself, and anything that moves real money.
