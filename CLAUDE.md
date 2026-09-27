# CLAUDE.md — Quadra

A private, non-custodial money app for Base 8453, named after the 1991 Macintosh Quadra
and dressed like the software of that era. One page, Windows-XP chrome, `?do=<id>` opens
a window. It is built **on top of** BlueAgent's x402 catalog, but it is a separate product
in a separate repo and must stay that way.

---

## Standing constraints from the owner

These came from ShunTr directly. They are not preferences.

- **Separate repo. Never build it inside `blue-agent`.** The two live side by side at
  `~/projects/quadra` and `~/projects/blue-agent`. Do not edit anything in `blue-agent` on
  Quadra's behalf — not its config, not its `.claude/launch.json`, nothing. If a tool needs
  a file over there to work, use a different tool.
- **Not public yet.** The GitHub repo is **private**. Do not make it public, do not publish
  to npm, do not announce it, do not point a domain at it.
- **100% tested before launch.** `npm run gate` must be green, and coverage thresholds are
  pinned at 100% for statements, branches, functions and lines. A drop fails the run.
- **Perfect it locally first.** Nothing deploys until the product is finished and tested.
- **Do not commit unless asked.** The owner decides when work lands.

---

## The gate

From the repo root:

```
npm run gate
```

That is `tsc --noEmit` → `vitest run --coverage` → `tsc --noEmit && vite build`. All three,
in one go. Do not report "done" on a subset. 473 tests, 16 files, 100% on all four metrics
as of 2026-09-27.

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
- **CSS cascade order beats intent at equal specificity.** `.dim` was declared after
  `.shell__hint` and silently won. Check where a rule sits, not just what it says.
- **A shared class sized for one panel breaks another.** `max-height` belongs on a modifier
  (`.notes--scroll`) applied to the one list a user can grow, not on every list that wants a
  sunken box.
- **A JSX ternary branch in parentheses cannot hold a comment block plus an element.** Eight
  confusing `TS2657`/`TS1005`/`TS1382` errors come from exactly that. Put the note in the CSS
  or above the ternary.

---

## Hard rules in the code

1. **No invented addresses, ever.** Every address in `src/config/` is either verified on
   Basescan or `null`. `null` is load-bearing: `requireContract()` throws naming the unset
   constant rather than handing back a plausible-looking zero address. A zero address in a
   payment path looks like a real address and fails silently.
2. **A ticker string never identifies a token.** NVDA, META, GOOGL and AAPL all exist on
   Base 8453 *and* on Robinhood Chain 4663, as different contracts in different pools. Chain
   + address, always. An explorer link without its chain is meaningless.
3. **B20 share tokens have 8 decimals, not 18.** Code that assumes an 18-decimal ERC-20
   misprices AAPLc by 10^10 — which reads as a 10-billion-x move, not as a bug, so it will
   not announce itself.
4. **A note's `secret` never leaves the browser.** Not logged, not in a URL, not sent to a
   server. This is the entire point of the product.
5. **The `quadra_*` MCP server holds no keys.** Every tool in `tools/quadra-mcp/` reads. If
   one ever needs to sign, that is a custody change and the owner's call, not a refactor.
6. **`scripts/measure-catalog.ts` must never invent a tool input.** It measures what upstream
   actually answers; a fabricated input turns a measurement into a guess.
7. **Amounts go through `parseAmount`.** Either an exact base-unit bigint or a thrown error
   the user reads. No path where a typo becomes a silently rounded number.

---

## Layout

```
src/
  adapters/        ShieldedPool + Enclave + Catalog behind one interface
    local/         in-browser implementations used today
    http/          the live BlueAgent x402 catalog client
  config/          chain.ts (Base 8453, flags), pair.ts (AAPLc), upstream.ts
  features/        registry.ts (the 10 ?do= ids) + panels/
  lib/             amount, hooks, manifest, status, verify
  pages/           /docs /api /verify /404
  ui/              Window, Taskbar, Gel (button), Crt (output box)
  styles/          reset.css + theme.css — the XP/Aqua design system
tests/             16 files, mirrors src/
tools/quadra-mcp/  stdio MCP server, read-only
scripts/           measure-catalog.ts — hand-run, hits the network
```

`@/` → `src/`. Tests never touch the network: `tests/setup.ts` makes `fetch` throw, so
anything network-facing lives in a hand-run script instead of the suite.

---

## What is real and what is not

**Built and working:** `send`, `inference`, `x402`, `hooks`, `mcp`.

**Flag on, not built:** `swap`, `router`, `audit`. These render an amber notice that names
what each one is waiting on — `swap` a deployed pool, `router` and `audit` the same missing
signing code. `WAITING_ON` in `features/FeaturePanel.tsx`, with `UNBUILT` derived from
`FLAGS` and `BUILT` so a hand-kept list cannot go stale in the flattering direction, and a
test asserting the two agree both ways. Measured 2026-09-27: `repo-health`, the tool `audit`
would call, quotes 402 — it is not one of the six free ids, so that panel is genuinely
blocked and not merely unwritten. **Do not make them look finished, and do not write a price
into that map** — the live quote is the only price this repo displays.

**Flag off:** `bridge`, `launch`. Rendered dimmed.

**x402 status:** `tools()` and `quote()` are live against BlueAgent's real catalog (115
tools, 6 of them $0.00). The dev-only Vite proxy at `/upstream` is what makes a run possible
at all — upstream opens GET to any origin and does not open POST, so every run is blocked by
the browser unless it is same-origin. Free runs work end to end. **Paid runs do not**: they
need an EIP-3009 authorization signed into a base64 `X-PAYMENT` header and settled through
CDP, which is wallet and signing code this build does not have.

`parseTools` sorts the six free ids to the front, deliberately — upstream's own order opens
the panel on a paid tool with a permanently dead button. The sort is stable, so upstream's
declaration order survives inside each half. It reads `priceUsdcUnits` only to *order* the
list; the displayed price is always the live quote.

---

## Known open items

- **The document overflows the viewport horizontally at 390px** on `/` and `/api`. Predates
  the CSS work above — reproduced on the card grid. `.cards` and `.taskbar` are both ruled
  out. Not fixed, because making a Windows-XP-desktop metaphor work on a phone is a design
  decision nobody has made yet.
- **`/api` documents `https://quadra.computer/api/services` as public and free to read.**
  Those endpoints do not exist. Harmless while the site is unpublished; a live falsehood the
  day it ships. Fix before launch.
- **No contracts yet.** Foundry scaffold + anvil tests for the shielded pool are unwritten.
- **`$QUADRA` does not exist.** It is intended to pair against AAPLc on Base. No address may
  be guessed for it — `LAUNCH_TOKEN` stays `null` until something is deployed and verified.
