# TASKS — what is left to finish Quadra

Handoff document. Written 2026-09-27 for a session that has never seen this repo.
Read `CLAUDE.md` first — it has the constraints and the rules that exist because
something broke. This file is only the work.

**Before you start anything:** `npm install`, then `npm run gate`. It must be green
(tsc clean, **730 tests in 23 files**, 100% on statements/branches/functions/lines, build
succeeds). If it is not green on a fresh checkout, fix that before touching a task — you
are looking at drift, not at your own change.

If you are touching Solidity, `npm run gate:contracts` is the second, separate gate:
`forge build` → `forge test` (**90 tests**) → 100% coverage on `contracts/src/`. It needs
Foundry, which is exactly why it is not part of `npm run gate` — that one has to stay
runnable on a bare clone with no network. Both counts are dated measurements from
2026-09-27; re-measure them in the same commit that changes them.

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
| `swap` | on | **not built** — amber notice, waiting on a deployed pool (T7) |
| `router` | on | **not built** — amber notice, waiting on wallet signing (T4) |
| `audit` | on | **not built** — amber notice, waiting on wallet signing (T4) |
| `bridge` | off | rendered dimmed |
| `launch` | off | rendered dimmed |

Flags live in `src/config/chain.ts` → `FLAGS`. The "built" set is `BUILT` in
`src/features/FeaturePanel.tsx`. A panel is honest today; the failure mode to avoid
is making one *look* finished before it is.

Each amber notice names its own blocker — `WAITING_ON` in the same file, with `UNBUILT`
derived from `FLAGS` and `BUILT` rather than typed out, and a test asserting the two
agree in both directions. That matters for this handoff specifically: **two of the three
are waiting on the same piece**, which the old shared wording hid, and which changes
what to build first.

Every contract address in `src/config/chain.ts` → `CONTRACTS` is `null`. That is
deliberate and load-bearing. `requireContract()` throws naming the unset constant.
**Do not put a zero address anywhere.** A zero address in a payment path looks real
and fails silently.

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

### Step 1 of 3 is DONE (2026-09-27) — the Solidity exists and is fully tested

`contracts/` holds three contracts, 90 tests and 100% coverage on `src/`, gated by
`npm run gate:contracts`. Read `contracts/README.md` before touching any of it; it has
the four traps measured while building it, including two that make a broken config look
like a working one.

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
  leaf from `keccak256("quadra.shielded-pool.empty-leaf") % FIELD_SIZE`, and **there is
  no keccak in the browser** — no dependency provides one, and hard-coding a 32-byte
  constant that nothing local can re-derive is precisely hard rule 9's hazard. So the
  caller supplies it: from a deployed pool's own `zeros(0)` when there is a deployment,
  from a declared constant when there is not. A wrong value fails a test; a missing one
  fails to compile.
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

## T8 — Build `swap`

**Size:** large. **Blocked by T7** — this is the panel that needs the pool to exist.

`swap` — "trade with nothing tying it to you" — is the product's headline claim and
the heaviest thing left. It needs the deployed shielded pool (T7) plus a venue on
Base to actually trade against. Until both exist the panel must keep saying it is not
built; a swap screen that looks operational and cannot swap is the single worst thing
this repo could ship.

**The pool contract existing does not unblock this.** As of 2026-09-27 `contracts/` is
written and fully tested, but there is no verifier and no Poseidon, so nothing is
deployed and `CONTRACTS.shieldedPool` is still `null`. `requireContract()` will throw
naming the unset constant, which is the correct behaviour and not a bug to route around.

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
4. **T7** — **join-split vs fixed denominations.** The pool as built takes arbitrary
   amounts, which is a genuinely weaker privacy guarantee than Tornado-style fixed
   denominations — amounts correlate deposits to withdrawals with no cryptography
   broken. The contract is written and tested; the shape is still a product decision,
   and the UI copy depends on the answer. Three options and their costs are in T7.
5. **T8** — which venue `swap` trades against, and whether the privacy claim survives it.
   Note this is the same question as item 4 arriving from the other side.
6. **`bridge` and `launch`** — both flags are off. Whether they get built at all.
7. **T9** — the launch itself, and anything that moves real money.
