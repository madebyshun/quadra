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
in one go. Do not report "done" on a subset. **779 tests in 24 files**, 100% on all four
metrics, measured 2026-09-28.

That count is a dated measurement, not a target — it is here so a fresh clone that comes
back with *fewer* tests tells you something is wrong with the checkout rather than with
your change. It had drifted to 473/16 in this file and in `TASKS.md` before being
re-measured, which is the ordinary way a written-down number goes stale: the suite grew
and nobody re-ran the count. **If you add tests, re-measure both files in the same
commit.**

Solidity has its **own** gate, and the two are deliberately separate:

```
npm run gate:contracts
```

That is `forge build` → `forge test` → `scripts/check-contract-coverage.ts` →
`scripts/check-contract-tests.ts`: 100% on lines/functions/branches for every file in
`contracts/src/`, and the per-suite table in `contracts/README.md` matching what ran.

**No test count is written here.** It is stated once, per suite, in that table, because the
guard checks the table and can only check one place. Six copies of this number existed
across four files and all six said 90 after the real figure had reached 104 — a number
repeated is a number that rots, and the fix is one location plus something that reads it.

⚠️ Run forge from `contracts/`, never the repo root: the root has no `foundry.toml`, so
forge there compiles nothing, runs nothing and **exits 0**. The npm scripts pin the
directory, which is the reason to use them over bare `forge`.

🔴 **Do not merge them.** `npm run gate` must stay runnable on a bare clone with nothing
installed and no network; `gate:contracts` needs Foundry. Folding Solidity into the main
gate would break the one property that makes the main gate always-runnable. Both are
required before anything is deployed. Details in `contracts/README.md`.

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
  exists and must keep their shipped value forever: `STORE_KEY`, the hash domain tag,
  `BACKUP_FORMAT`, and the empty-leaf preimage. A name shown to a person may change; a name
  some byte on a disk or on chain is already keyed to may not. `backupFilename` is the
  counter-example — derived from the slug, because nothing reads it back.
- **A comment that quotes a forbidden pattern will trip a textual check on that pattern.** The
  frozen-string test above failed first on the two doc comments warning against the thing it
  forbids. Strip comments before checking — which also strengthens a presence check from "the
  literal is somewhere in the file" to "the literal is in the code".
- **A test may read a constant out of the Solidity, and one does.** `tests/field.test.ts` extracts
  `FIELD_SIZE` and `MAX_NOTE_VALUE` from `contracts/src/` rather than restating them, because a
  copied constant drifts silently and only disagrees where the two halves meet. Consequence worth
  knowing: `npm run gate` now needs `contracts/src/*.sol` to be present. It does **not** need
  Foundry — the files are committed and it only reads them — so the offline-bare-clone rule still
  holds. Do not "simplify" that test into a hard-coded number; the hard-coded number is the bug it
  exists to catch.

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
8. **The accepting verifier lives under `contracts/test/` and nowhere else.**
   `AcceptingVerifier` in `contracts/test/doubles/TestVerifier.sol` returns `true` for every
   proof. Nothing under `contracts/src/` may import it. It compiles, the suite goes green, the
   pool "works", and the only symptom is that anybody can drain it — there is no error message
   and no failing test, which is what makes it the single most dangerous file in the repo. Same
   for `TestHasher`: keccak satisfies every property the tree checks, so it passes everything
   and yields a pool whose withdrawals nobody can afford to prove.
9. **Never write Poseidon constants from memory, a blog post, or another chain.** Its round
   constants and MDS matrix come from a specified derivation (a Grain LFSR) for one field, width
   and round count. Recalled constants give a hash that is deterministic, collision-free, in-field
   and therefore passes every test in `tests/hash.test.ts` — while matching no circuit anybody
   will generate. Money in, nothing out, no error: the browser half of rule 8's hazard. Poseidon
   arrives with checked-in test vectors that a generated circuit reproduces, or it does not
   arrive. Until then `standInHash` is SHA-256 and says so in every value it tags.
10. **A stand-in value must carry its own reason, and the type must make that unavoidable.**
   `Commitment` and `Nullifier` are discriminated unions where only the `stand-in` variant has a
   `why`, so code needing a provable value narrows and cannot ignore a boolean. Same device as
   `Anchoring`. Do not add a `verified: boolean` anywhere in this codebase — `verified: false` is
   a field that gets ignored; a missing `quote` is a type error.
11. **Where the contract and the browser enforce the same rule, the browser enforces it the
   contract's way — even when a local shortcut is correct.** A spend was refused by
   `note.spentAt !== null`; on chain it is refused by `mapping(bytes32 => bool) isSpent`. The
   timestamp was not wrong, it was **unverifiable and locally mutable** — `notes()` copies the
   array but not the notes, so a caller already held a reference that could clear it and re-arm a
   spent note. The tell is that the shortcut reads state nobody outside this tab can check. When
   you find one, keep the convenience for display and move the authority; then write the test
   that forces the two apart (wipe the timestamp, the spend must still be refused), because a
   test where they agree passes under both rules and proves nothing.

---

## Layout

```
src/
  adapters/        ShieldedPool + Enclave + Catalog behind one interface
    local/         in-browser implementations used today. pool.ts owns the tree and
                   serializes its writes — read the note on `serialize` before touching
                   it, concurrent inserts corrupt the root WITHOUT throwing.
                   store.ts persists the notes; it re-derives each commitment on load
                   rather than storing one, because a `scheme` tag read off disk is a
                   claim and not a derivation (rule 10). Look a note up through
                   `locate()` only — a bare `this.store.find` skips hydration and tells
                   the user their note does not exist
    http/          the live BlueAgent x402 catalog client
  config/          chain.ts (Base 8453, flags), pair.ts (AAPLc), upstream.ts
  features/        registry.ts (the 10 ?do= ids) + panels/
  lib/             amount, hooks, manifest, status, verify
                   field.ts  — BN254 scalar field, mirrors the contracts' constants
                   hash.ts   — the FieldHash seam; SHA-256 stand-in, NO Poseidon (rule 9)
                   note.ts   — commitment + nullifier derivation over that hash
                   tree.ts   — the commitment tree, mirroring MerkleTreeWithHistory.sol,
                               plus the Merkle paths the contract cannot serve
                   transaction.ts — the (Proof, ExtData) pair `transact` takes. Mirrors
                               four contract functions by name and says so at each. Two
                               things to know before editing: it has NO keccak, so
                               `extDataHash` returns a union whose `unavailable` arm is
                               the honest state of this build and not an error path
                               (substituting SHA-256 would be rule 9 one layer up); and
                               a negative amount is encoded TWO different ways on
                               purpose — field negation for the public input, two's
                               complement for `abi.encode` — so conflating them yields
                               a proof that verifies for the wrong transaction
                   backup.ts — the backup file format. localStorage is not a backup;
                               this is. Plaintext secrets by necessity and labelled as
                               such, never half-encrypted. Validates an import through
                               `decodePool`, the same function the loader uses, so an
                               import cannot succeed into a pool that will not open
                   download.ts — handing that file to a disk and reading one back. The
                               only DOM in the backup path, kept out of backup.ts so
                               rule 4 can be audited without a `URL` or `document` in
                               view. There is no `fetch` here and must never be one
  pages/           /docs /api /verify /404
  ui/              Window, Taskbar, Gel (button), Crt (output box)
  styles/          reset.css + theme.css — the XP/Aqua design system
tests/             24 files, mirrors src/. TWO of them read Solidity rather than
                   restating its numbers: field.test.ts extracts FIELD_SIZE and
                   MAX_NOTE_VALUE from contracts/src/*.sol, and transaction.test.ts
                   extracts the pinned abi.encode vector from contracts/test/
                   ShieldedPool.t.sol. Both fail by naming the file that moved
tools/quadra-mcp/  stdio MCP server, read-only
scripts/           measure-catalog.ts — hand-run, hits the network
                   check-contract-coverage.ts — the forge coverage gate
                   check-contract-tests.ts — pins the README suite table to the run
contracts/         Foundry. src/ is 3 contracts; test/ is 3 suites, counted in
                   contracts/README.md and nowhere else.
                   No forge-std and no lib/ — runs on a bare clone.
                   Read contracts/README.md before editing any of it.
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

*(Two entries lived here until 2026-09-27 and are gone because they were resolved, not
because they were tidied away: the 390px overflow was **withdrawn as a false finding** — see
the `--window-size` rule above, the measuring tool produced it — and `/api` no longer claims
endpoints this origin does not serve. Both are written up in `TASKS.md` as T2 and T1. **Close
an item here in the same edit that closes the work.** A resolved entry left in a
known-open-items list is worse than a missing one: the next reader spends their session
re-chasing something that was already fixed, and the list stops being believed.)*

- **No verifier and no Poseidon**, so nothing is deployed and `CONTRACTS.shieldedPool` stays
  `null`. *(This entry replaced "No contracts yet" on 2026-09-27 — the Solidity is written and
  fully tested, so leaving the old wording would have been the exact rot the note above warns
  about. But it is narrowed, not closed: what remains is a circuit and a hash function, which
  is the larger half and is not Solidity work.)* The two doubles that stand in for them are
  the most dangerous files here — see hard rule 8. `contracts/README.md` lists everything that
  must exist before this holds money.
  **Narrowed again later the same day, on the browser side:** notes now carry a commitment
  derived by the real scheme (`src/lib/note.ts`) over a real hash (`src/lib/hash.ts`) instead of
  the `randomHex(32)` they used to carry, and `Note.commitment` is a discriminated union tagged
  with the scheme that produced it. So the arithmetic is honest and the gap is one substitution
  wide. **The missing piece is still Poseidon, and it is missing on purpose** — round constants
  written from memory produce a hash that passes every property test in `tests/hash.test.ts` and
  matches no circuit, which is the same failure as `TestHasher` with none of the warning labels.
  See hard rule 9 and the 🔴 block in `src/lib/hash.ts`.
- ⚠️ **Join-split leaks amounts, and the shape is still ShunTr's decision.** The pool takes
  arbitrary amounts, so a deposit and a withdrawal of the same size are linkable by anyone
  reading the chain with no cryptography broken. Fixed denominations are strictly stronger and
  would break the `send` interface. **The UI must not claim a guarantee this shape does not
  give** — three options and their costs are in `TASKS.md` T7.
- **`$QUADRA` does not exist.** It is intended to pair against AAPLc on Base. No address may
  be guessed for it — `LAUNCH_TOKEN` stays `null` until something is deployed and verified.
