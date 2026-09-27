// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "./interfaces/IERC20.sol";
import {IHasher} from "./interfaces/IHasher.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";
import {MerkleTreeWithHistory} from "./MerkleTreeWithHistory.sol";
import {SafeTransfer} from "./SafeTransfer.sol";

/**
 * The pool the product's privacy claim rests on: money goes in against a
 * commitment, comes out against a proof, and nothing on chain links the two.
 *
 * ── Shape: join-split, not fixed denominations ───────────────────────────────
 * Two notes in, two notes out, with a signed net amount that is positive on the
 * way in and negative on the way out. That is what lets a note be spent for part
 * of its value with the rest coming back as change, and it is chosen because the
 * UI already promises it — `ShieldedPool.send(noteId, to, amount)` in
 * `src/adapters/types.ts` takes an arbitrary amount, and `LocalShieldedPool`
 * already makes change.
 *
 * ⚠️ **The honest caveat, because it is a real weakening and not a detail.** A
 * fixed-denomination pool (Tornado's design) gives a stronger guarantee: every
 * withdrawal looks exactly like every other, so the anonymity set is everyone.
 * Arbitrary amounts leak. Deposit 137.42 and withdraw 137.42 and the link is
 * visible to anybody reading the chain, no cryptography broken. Join-split makes
 * that *possible* to avoid rather than automatic — the user has to not do it.
 *
 * That trade belongs to ShunTr, not to this file. It is written down in
 * `TASKS.md` under T7 rather than settled here, and the UI must not claim a
 * guarantee this shape does not give.
 *
 * ── What this contract checks, and what it cannot ────────────────────────────
 * On chain, and therefore trustworthy:
 *   - the root was one this tree really had, recently
 *   - neither nullifier has been seen before, and both are now spent
 *   - the proof verifies against the public inputs, in the verifier's own words
 *   - the external data really is the data that was proven over
 *   - the tokens moved, or the whole transaction reverted
 *
 * Only the circuit can check the rest: that the inputs exist under the root,
 * that the nullifiers derive from them, and that value is conserved. A verifier
 * that returns true without proving those turns this contract into a faucet, and
 * nothing here could tell. That is why `IVerifier` has no implementation in this
 * repo and why the constructor refuses the zero address.
 *
 * ── Single token, deliberately ───────────────────────────────────────────────
 * One pool, one ERC-20, fixed at construction. A multi-asset pool has to put the
 * asset in the note and in the circuit, and until it does, two assets sharing one
 * tree means a proof for a note of asset A can be redeemed in asset B. Deploy a
 * pool per asset.
 */
contract ShieldedPool is MerkleTreeWithHistory {
    using SafeTransfer for IERC20;

    /**
     * What a withdrawal is for, hashed into the proof so it cannot be edited in
     * the mempool.
     *
     * Without this binding a relayer could lift a valid proof out of a pending
     * transaction, swap `recipient` for their own address and submit it first.
     * The proof still verifies — the recipient was never part of what it proved.
     */
    struct ExtData {
        address recipient;
        address relayer;
        uint256 fee;
    }

    /** Everything the verifier is asked about, in one argument. */
    struct Proof {
        bytes32 root;
        bytes32[2] inputNullifiers;
        bytes32[2] outputCommitments;
        /** Signed: positive is a deposit, negative is a withdrawal. */
        int256 publicAmount;
        bytes proof;
    }

    IERC20 public immutable token;
    IVerifier public immutable verifier;

    /**
     * Spent notes. A nullifier is derived from a note and its owner's key, so it
     * identifies the note without revealing which leaf it was — which is the
     * whole trick: double-spending is prevented without anyone learning what was
     * spent.
     */
    mapping(bytes32 => bool) public isSpent;

    /**
     * The largest value a single note may hold.
     *
     * Not a policy limit. Amounts are field elements, and the circuit proves
     * `sum(in) + public == sum(out)` in field arithmetic, which wraps. Without a
     * bound well below the field size an attacker picks amounts that overflow
     * into a valid-looking equation and mints value out of nothing. 2^248 leaves
     * room for any real token balance and no room to reach the modulus by adding
     * a handful of notes.
     */
    uint256 public constant MAX_NOTE_VALUE = 1 << 248;

    event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp);
    event NewCommitment(bytes32 indexed commitment, uint32 leafIndex);
    event NewNullifier(bytes32 indexed nullifier);
    event Withdrawal(address indexed recipient, uint256 amount, uint256 fee);

    error VerifierNotSet();
    error TokenNotSet();
    error UnknownRoot(bytes32 root);
    error AlreadySpent(bytes32 nullifier);
    error DuplicateNullifier(bytes32 nullifier);
    error InvalidProof();
    error AmountTooLarge(uint256 amount);
    error FeeExceedsWithdrawal(uint256 fee, uint256 amount);
    error RecipientIsZero();
    error TokenDidNotDeliver(uint256 asked, uint256 delivered);

    constructor(uint32 _levels, IHasher _hasher, IVerifier _verifier, IERC20 _token)
        MerkleTreeWithHistory(_levels, _hasher)
    {
        /**
         * Both refusals are the same rule as `CONTRACTS.shieldedPool` being
         * `null` in `src/config/chain.ts`: a zero address is not an unset value,
         * it is a plausible-looking one that fails later and quietly. There is no
         * configuration in which this pool runs without a verifier.
         */
        if (address(_verifier) == address(0)) revert VerifierNotSet();
        if (address(_token) == address(0)) revert TokenNotSet();
        verifier = _verifier;
        token = _token;
    }

    /**
     * Move value in, out, or between notes.
     *
     * One entry point for all three because on chain they are the same
     * operation, and because separate `deposit` and `withdraw` functions would
     * make the two distinguishable by selector — which is exactly the link the
     * pool exists to break.
     */
    function transact(Proof calldata args, ExtData calldata extData) external {
        _checkNullifiers(args.inputNullifiers);
        if (!isKnownRoot(args.root)) revert UnknownRoot(args.root);

        /**
         * `publicAmountFor` below applies the same bound, so this looks
         * redundant — it is not. That call happens inside `_publicInputs`, which
         * runs *after* the token pull. Checking here means an over-sized amount
         * reverts before any money has moved, rather than relying on the revert
         * to unwind a transfer that already happened.
         */
        uint256 magnitude = _magnitude(args.publicAmount);
        if (magnitude > MAX_NOTE_VALUE) revert AmountTooLarge(magnitude);

        /**
         * `publicAmount == 0` with no fee is NOT a no-op and must not be
         * rejected: it is two notes in, two notes out, nothing crossing the
         * boundary — a merge or a re-split. That is how a wallet consolidates
         * dust, and how it breaks the amount correlation this pool's shape
         * otherwise leaks (see the caveat at the top). An early version refused
         * it as "nothing to do", which would have removed the one move a user
         * has for repairing their own privacy.
         */

        /**
         * Pull first, and prove afterwards.
         *
         * A deposit that reverts on the token transfer must not have spent its
         * nullifiers or grown the tree, and doing the pull before any state is
         * written is what guarantees that without an explicit unwind. The
         * verification below still gates every commitment and every payout.
         */
        if (args.publicAmount > 0) _pullExactly(magnitude);

        if (!verifier.verifyProof(args.proof, _publicInputs(args, extData))) {
            revert InvalidProof();
        }

        _spend(args.inputNullifiers);
        _appendOutputs(args.outputCommitments);

        if (args.publicAmount < 0) _payOut(magnitude, extData);
        else if (extData.fee != 0) _payFee(extData);

        if (args.publicAmount > 0) {
            emit Deposit(args.outputCommitments[0], nextIndex - 2, block.timestamp);
        }
    }

    /**
     * The public-input vector, in the order `IVerifier` documents.
     *
     * `public` so the circuit author and a client can build exactly what this
     * contract will build. A client computing this vector differently produces
     * proofs that verify locally and revert on chain, and the mismatch is
     * invisible from either side alone.
     */
    function publicInputs(Proof calldata args, ExtData calldata extData)
        external
        pure
        returns (uint256[7] memory)
    {
        return _publicInputs(args, extData);
    }

    /**
     * A signed amount as the field element the circuit sees.
     *
     * Negative values are represented as `FIELD_SIZE - magnitude`, which is what
     * subtraction means inside the field. Exposed because a client that encodes
     * this differently is the single most likely reason a correct proof is
     * rejected, and a shared function is cheaper than a shared convention.
     */
    function publicAmountFor(int256 amount) public pure returns (uint256) {
        uint256 magnitude = _magnitude(amount);
        if (magnitude > MAX_NOTE_VALUE) revert AmountTooLarge(magnitude);
        return amount >= 0 ? magnitude : FIELD_SIZE - magnitude;
    }

    /**
     * |amount|, unsigned.
     *
     * The only two signed-to-unsigned casts in the contract, gathered here so the
     * justification sits beside them rather than being repeated at each call
     * site — and so there is one line to re-read if the bound ever moves. The
     * linter is right to ask about these by default; the answer is just specific.
     */
    function _magnitude(int256 amount) private pure returns (uint256) {
        if (amount >= 0) {
            // casting to 'uint256' is safe because the branch has already proven
            // the value non-negative, and int256 and uint256 are the same width,
            // so every non-negative int256 is representable exactly.
            // forge-lint: disable-next-line(unsafe-typecast)
            return uint256(amount);
        }
        // casting to 'uint256' is safe because negating a negative int256 yields a
        // positive one, and checked arithmetic reverts on the single input that
        // cannot be negated — type(int256).min — instead of wrapping it to itself.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint256(-amount);
    }

    /**
     * Bind the payout details to the proof.
     *
     * Reduced into the field because the circuit has to be able to hold it, and
     * keccak's full 256-bit range does not fit. Folding rather than truncating:
     * the top bits still affect the result.
     */
    function hashExtData(ExtData calldata extData) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(extData))) % FIELD_SIZE;
    }

    /* ── internals ──────────────────────────────────────────────────────────── */

    function _publicInputs(Proof calldata args, ExtData calldata extData)
        private
        pure
        returns (uint256[7] memory input)
    {
        input[0] = uint256(args.root);
        input[1] = publicAmountFor(args.publicAmount);
        input[2] = hashExtData(extData);
        input[3] = uint256(args.inputNullifiers[0]);
        input[4] = uint256(args.inputNullifiers[1]);
        input[5] = uint256(args.outputCommitments[0]);
        input[6] = uint256(args.outputCommitments[1]);
    }

    /**
     * Neither nullifier may be spent, and they may not be each other.
     *
     * The second check is the one that is easy to leave out. Spending a note
     * twice inside a single transaction writes the same slot twice, so a loop
     * that only consults `isSpent` before the transaction began sees both as
     * unspent — and the circuit, which proves each input independently, has no
     * reason to object either.
     */
    function _checkNullifiers(bytes32[2] calldata nullifiers) private view {
        if (nullifiers[0] == nullifiers[1]) revert DuplicateNullifier(nullifiers[0]);
        if (isSpent[nullifiers[0]]) revert AlreadySpent(nullifiers[0]);
        if (isSpent[nullifiers[1]]) revert AlreadySpent(nullifiers[1]);
    }

    function _spend(bytes32[2] calldata nullifiers) private {
        isSpent[nullifiers[0]] = true;
        isSpent[nullifiers[1]] = true;
        emit NewNullifier(nullifiers[0]);
        emit NewNullifier(nullifiers[1]);
    }

    function _appendOutputs(bytes32[2] calldata commitments) private {
        uint32 first = _insert(commitments[0]);
        uint32 second = _insert(commitments[1]);
        emit NewCommitment(commitments[0], first);
        emit NewCommitment(commitments[1], second);
    }

    /**
     * Take exactly `amount`, and refuse a token that delivers anything else.
     *
     * Measuring instead of trusting is what keeps a fee-on-transfer or rebasing
     * token out. The note about to be created records `amount`; if the pool
     * received less, that note is a claim on money that is not there, and the
     * shortfall surfaces as a failed withdrawal for whoever is last — someone who
     * did nothing wrong and cannot tell what happened.
     */
    function _pullExactly(uint256 amount) private {
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 delivered = token.balanceOf(address(this)) - before;
        if (delivered != amount) revert TokenDidNotDeliver(amount, delivered);
    }

    function _payOut(uint256 amount, ExtData calldata extData) private {
        if (extData.recipient == address(0)) revert RecipientIsZero();
        if (extData.fee > amount) revert FeeExceedsWithdrawal(extData.fee, amount);

        uint256 net = amount - extData.fee;
        if (net != 0) token.safeTransfer(extData.recipient, net);
        if (extData.fee != 0) token.safeTransfer(extData.relayer, extData.fee);
        emit Withdrawal(extData.recipient, net, extData.fee);
    }

    /**
     * A fee on a transfer that moves nothing in or out — the shape a relayer
     * takes for submitting a note-to-note payment on someone's behalf. It comes
     * out of the pool's balance, which is sound only because the circuit proved
     * the inputs exceeded the outputs by exactly this much.
     */
    function _payFee(ExtData calldata extData) private {
        token.safeTransfer(extData.relayer, extData.fee);
        emit Withdrawal(extData.relayer, 0, extData.fee);
    }
}
