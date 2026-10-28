// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVerifier} from "../../src/interfaces/IVerifier.sol";

/**
 * 🔴 VERIFIERS THAT DO NOT VERIFY. THESE MAY ONLY EXIST UNDER `test/`.
 *
 * ── Read this before moving, importing, or deploying anything in this file ────
 * `AcceptingVerifier.verifyProof` returns `true` for every input. Wire it into a
 * live `ShieldedPool` and the pool works perfectly: deposits land, the tree
 * grows, roots advance, events fire. It also lets anybody withdraw the entire
 * balance by submitting an empty proof, because the one thing standing between a
 * caller and the money is the function that now always says yes.
 *
 * There is no revert, no failed transaction, and no log line that looks wrong.
 * The test suite goes green *because* of this contract, which is the trap: a
 * green suite is the evidence you would normally reach for.
 *
 * So the rule is structural rather than advisory. Nothing under `src/` may import
 * this file, and `forge build` on `src/` alone would fail if it tried, because
 * this path is outside it. Keep it that way — do not "temporarily" move a double
 * into `src/` to get a deploy script compiling.
 *
 * ── What the real one must do ────────────────────────────────────────────────
 * Groth16 verification against the circuit's own verifying key, over the seven
 * public inputs in the order `IVerifier` documents. It is generated from the
 * circuit, not written by hand. The circuit is not in this repo.
 *
 * ── What these doubles are legitimately for ──────────────────────────────────
 * Everything in `ShieldedPool` that is not the proof: nullifier bookkeeping, root
 * history, the field bounds, the token accounting, the payout and fee split, the
 * event stream. Those are the parts with the bugs a fuzzer can find, and they are
 * only reachable if verification can be made to pass and fail on demand.
 */
contract AcceptingVerifier is IVerifier {
    function verifyProof(bytes calldata, uint256[7] calldata) external pure returns (bool) {
        return true;
    }
}

/**
 * Rejects everything. The other half of the pair.
 *
 * Proves that a failed verification reverts with `InvalidProof` and — the part
 * that actually matters — leaves no trace: no nullifier marked spent, no
 * commitment appended, no root advanced, and no tokens moved.
 */
contract RejectingVerifier is IVerifier {
    function verifyProof(bytes calldata, uint256[7] calldata) external pure returns (bool) {
        return false;
    }
}

/**
 * Accepts only the exact public-input vector it was told to expect.
 *
 * ── What this pins ──────────────────────────────────────────────────────────
 * `ShieldedPool` assembles the seven inputs internally, so nothing outside it can
 * otherwise observe whether it assembled the vector `IVerifier` documents. That
 * matters more than it sounds: a client that orders the inputs differently
 * produces proofs which verify in its own suite and revert on chain, and neither
 * side can see the mismatch alone. Calling `pool.publicInputs(...)` and checking
 * the result does not close the gap — it only proves the public helper agrees with
 * the test, not that `transact` feeds the verifier the same thing.
 *
 * So: `expect()` the vector, then call `transact`. Success means the contract
 * built precisely that, element for element. A reordering shows up as
 * `InvalidProof`.
 *
 * ── Why this is a comparator and not a recorder ──────────────────────────────
 * The obvious double records what it was handed and lets the test read it back.
 * It cannot be written: `IVerifier.verifyProof` is `view`, so no implementation
 * may write storage. That is the interface being right, not an obstacle — a
 * verifier that could record could also return a different answer for the same
 * proof depending on what it had seen before. `expect()` is a separate,
 * non-`view` function, which is why it is allowed to write at all.
 */
contract ExpectingVerifier is IVerifier {
    uint256[7] private _expected;
    bytes private _expectedProof;

    function expect(uint256[7] calldata input, bytes calldata proof) external {
        _expected = input;
        _expectedProof = proof;
    }

    function verifyProof(bytes calldata proof, uint256[7] calldata input)
        external
        view
        returns (bool)
    {
        if (keccak256(proof) != keccak256(_expectedProof)) return false;
        for (uint256 i = 0; i < 7; i++) {
            if (input[i] != _expected[i]) return false;
        }
        return true;
    }
}
