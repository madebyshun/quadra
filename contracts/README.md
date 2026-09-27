# contracts — Quadra's shielded pool

Solidity for Base 8453. Three contracts, 90 tests, 100% coverage on `src/`.

**Nothing here is deployed.** `CONTRACTS.shieldedPool` and `CONTRACTS.verifier` in
`src/config/chain.ts` are still `null`, and they stay `null` until something is
deployed *and* verified on Basescan. See "What is missing" below — the gap is not
a deployment step, it is a circuit.

---

## Running it

Foundry only. No `lib/`, no submodules, no `npm install` for this half.

```
forge build          # lints as it compiles; warnings are errors
forge test           # 90 tests
forge coverage       # expects 100% on src/
```

From the repo root, all three plus the coverage gate in one command:

```
npm run gate:contracts
```

That is `forge build` → `forge test` → `scripts/check-contract-coverage.ts`.

🔴 **`npm run gate` and `npm run gate:contracts` are separate on purpose, and merging
them would break the first one.** `npm run gate` has to stay runnable on a bare clone
with nothing installed and no network; `gate:contracts` needs Foundry. Keeping them
apart is what lets `npm run gate` be the thing you can always run. Both are required
before anything is deployed.

If `forge` is not on your `PATH` in a non-interactive shell, it is probably at
`~/.foundry/bin/forge` — the coverage script already checks there, because
`foundryup` puts it somewhere a login shell finds and a script does not.

---

## No forge-std, deliberately

`test/Harness.sol` is a hand-written stand-in: the `Vm` interface methods this suite
actually uses, `assertTrue` / `assertFalse` / `assertEq` / `assertNotEq`, and nothing
else. It exists so `forge test` runs on a fresh clone with zero installs and no
`--recurse-submodules` — the same property the frontend gate has.

**The cost, stated rather than discovered later:** these assertions revert instead of
collecting, so a failing test reports its first bad assertion and stops. forge-std
would print all of them. That is a real loss and the trade is the offline property.
If the suite ever grows to where that hurts, adding forge-std is a legitimate change —
just do it knowing it makes a clean clone need a submodule.

The cheatcode address is written as the literal
`0x7109709ECfa91a80626fF3989D68f67F5b1DD12D` because computing it needs the very cast
the linter is configured to object to.

---

## What each contract is

### `MerkleTreeWithHistory.sol`

Append-only tree of note commitments, plus the last 30 roots.

The root history looks like a bug and is not. A withdrawal proves "my note is a leaf
under root R", and the prover has to choose R before building the proof. By the time
the transaction lands, someone else may have deposited and moved the root. Accepting
only the newest root means every proof races every deposit, and on a busy block nobody
wins — the pool appears broken precisely when it is being used.

That window is a **privacy parameter**, not a convenience: proving against an old root
narrows the anonymity set to deposits made before it. 30 is Tornado's number for the
same reason.

Empty-subtree roots are computed in the constructor from the deployed hasher rather
than hard-coded. A hard-coded table is the answer for one specific hash function, and
this contract does not know which one it was handed — a MiMC table in a Poseidon
deployment produces a tree whose roots no circuit agrees with, and nothing reverts.

### `SafeTransfer.sol`

ERC-20 moves that fail loudly. Empty return data is success (USDT's shape), `true` is
success, everything else including `false` is failure.

The dangerous direction is the second one. A token that returns `false` instead of
reverting gets read as success by code that ignores the return value, so a withdrawal
would verify the proof, burn the nullifiers, append the commitments, "pay" the
recipient and emit `Withdrawal` — with the note spent, the money still in the pool,
and no error anywhere for the user to point at.

Also refuses an address with no code, because a call to a codeless account succeeds
and returns nothing, which the empty-return-data rule would otherwise read as a
completed payment.

### `ShieldedPool.sol`

Join-split, 2-in/2-out, one ERC-20 fixed at construction. `transact` is the only entry
point: deposit, withdraw and note-to-note are the same operation with a different sign
on `publicAmount`. Separate `deposit` / `withdraw` functions would make the two
distinguishable by selector, which is the exact link the pool exists to break.

⚠️ **Join-split leaks amounts, and that is an open decision — see `TASKS.md` T7.**
Fixed denominations (Tornado's design) make every withdrawal look like every other.
Arbitrary amounts do not: deposit 137.42 and withdraw 137.42 and the link is visible
to anyone reading the chain, with no cryptography broken. The shape was chosen because
the UI already promises arbitrary amounts, but the guarantee is weaker and the UI must
not claim otherwise.

One pool, one asset, deliberately. Two assets sharing one tree means a proof for a
note of asset A can be redeemed in asset B until the asset is inside the note *and*
inside the circuit. Deploy a pool per asset.

---

## What is missing, and why it cannot be faked here

**There is no verifier.** `IVerifier` has no implementation under `src/`, and there
will not be one until a circuit is written and its Groth16 verifier generated.

🔴 **`contracts/test/doubles/TestVerifier.sol` contains `AcceptingVerifier`, which
returns `true` for everything. Nothing under `src/` may import it, ever.** It compiles,
the suite goes green, the pool "works", and the only symptom is that anybody can drain
it. It exists so the pool's own logic can be tested; it is not a placeholder for the
real thing and it is not a step on the way to one.

**`TestHasher` is keccak and cannot ship either.** It satisfies every property the tree
needs — deterministic, in-field, collision-resistant — which is exactly what makes it
dangerous. A 20-level keccak Merkle path is a proof a browser cannot produce. Shipped,
it gives a pool whose deposits work, whose tree is valid, and whose withdrawals nobody
can afford to prove. The real deployment needs Poseidon.

So what the on-chain code checks, and therefore what is trustworthy:

- the root was one this tree really had, recently
- neither nullifier has been seen before, and both are now spent
- the proof verifies against the public inputs, **in the verifier's own words**
- the external data really is the data that was proven over
- the tokens moved, or the whole transaction reverted

Only the circuit can check the rest: that the inputs exist under the root, that the
nullifiers derive from them, and that value is conserved. A verifier returning `true`
without proving those turns this contract into a faucet and nothing here could tell.

---

## Tests

| Suite | Tests | What it is for |
|---|---|---|
| `MerkleTreeWithHistory.t.sol` | 25 | tree mechanics, the 30-root window, capacity, field bounds |
| `SafeTransfer.t.sol` | 17 | one test per real-world token misbehaviour |
| `ShieldedPool.t.sol` | 48 | the pool's own rules, with the verifier as a double |

`test/doubles/TestTokens.sol` is eight token shapes, each a pattern that really shipped
on Ethereum or Base rather than an invented adversary: no-return (USDT), false-return
(old ZRX), non-boolean return, oversized return, fee-on-transfer, surplus-delivering,
reverting, and a well-behaved control. All at **8 decimals**, matching the B20 share
tokens this pool is aimed at — a double that lied about its decimals would let an
off-by-10^10 bug pass here and surface in production.

Fee-on-transfer and surplus are both **refused**, and the asymmetry is the point:
`_pullExactly` checks `!=`, not `<`. A shortfall makes a note a claim on money that is
not there; a surplus belongs to nobody and accumulates as an unaccounted balance that
every later solvency argument has to special-case.

**What these tests do not say anything about:** circuit soundness. Every proof in the
suite is accepted or rejected by a double because that is what the test told it to do.

### Coverage is a gate, not a report

`forge coverage` prints a table and exits 0 no matter how bad the numbers are — there
is no `--fail-under`. `scripts/check-contract-coverage.ts` parses the lcov and fails if
any file under `src/` is below 100% on lines, functions or branches.

It grades `src/` only. The doubles contain branches nothing should reach, which exist
so a real contract can be caught doing the wrong thing; chasing those to 100% means
writing tests for the test scaffolding, and the usual way that ends is by deleting the
unreached guard.

**The guard was verified by making it fail** — an uncovered function was added to
`MerkleTreeWithHistory.sol`, the script was confirmed to fail on lines, functions and
branches, and then it was reverted. A coverage gate that has never failed is not a
verified gate.

---

## Traps measured in this directory

🔴 **`deny = "warnings"` belongs in `[profile.default]`, not `[lint]`.** forge accepts
it under `[lint]` while resolving `deny` back to `"never"` — the strictness switches
itself off and the build goes green for the wrong reason. It prints one line about an
unknown config key and nothing else. **Verify with `forge config | grep deny`, never by
whether the build passed.**

🔴 **`[lint] ignore = ["test/**"]` matches nothing at all.** `test/*` covers the top
level only; `test/**/*` is what reaches `test/doubles/`. Both entries are required.
Measured by appending a deliberately bad cast to a file in `test/doubles/` and counting
warnings under each pattern. **An ignore list that silently matches nothing reads
exactly like a working one** — whenever you edit it, add a violation you expect it to
swallow and confirm the count goes to zero.

🔴 **`vm.expectRevert` binds to the next *external call*, not to the next statement.**
Any view call made while building arguments consumes the expectation, and the failure
message ("next call did not revert as expected") points at the wrong call entirely.
This cost 12 simultaneous failures in one run: the `_args()` helper calls
`pool.getLastRoot()`. Hoist all argument construction above the `expectRevert`.

**A `view` interface cannot be instrumented.** `IVerifier.verifyProof` is `view`, so no
implementation can record what it was called with — a recording double is impossible.
`ExpectingVerifier` inverts it instead: a non-view `expect()` setter stores the vector,
and `verifyProof` returns whether it matches. The `view` interface is right, not an
obstacle: a verifier that could record could also return a different answer for the
same proof depending on what it had seen before.

---

## Before any of this holds money

1. A real circuit, and a Groth16 verifier generated from it.
2. Poseidon, deployed, with the same parameters the circuit uses.
3. A trusted setup whose provenance is written down.
4. An external audit. 100% coverage says every branch has been executed, not that the
   design is sound — those are different claims and only the first one is measured here.
5. `CONTRACTS.*` filled in from a Basescan-verified deployment, never from a deploy log.
