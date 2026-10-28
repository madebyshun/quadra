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
     * What actually moves, hashed into the proof so it cannot be edited in the
     * mempool.
     *
     * Without this binding a relayer could lift a valid proof out of a pending
     * transaction, swap `recipient` for their own address and submit it first.
     * The proof still verifies — the recipient was never part of what it proved.
     *
     * `extAmount` is what crosses the contract's boundary: positive is pulled in
     * from `msg.sender`, negative is paid out to `recipient`. It is **not** the
     * number the circuit proves over; see `publicAmountFor` for why those are two
     * different quantities and what went wrong when they were one.
     */
    struct ExtData {
        address recipient;
        address relayer;
        int256 extAmount;
        uint256 fee;
    }

    /**
     * Everything the verifier is asked about, in one argument.
     *
     * 🔴 There is deliberately no `publicAmount` field. It is **derived** from
     * `ExtData` by `publicAmountFor`, so the calldata cannot state one value while
     * the token movement implies another. An earlier version took it as a
     * parameter, which made the two independent and let them disagree — see the
     * history in `publicAmountFor`. The same reasoning as the commitment tree
     * assigning leaf indices instead of a counter promising to agree with one: if
     * two things must be equal, have one of them.
     */
    struct Proof {
        bytes32 root;
        bytes32[2] inputNullifiers;
        bytes32[2] outputCommitments;
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

    /**
     * Two events, not one with a zero in it.
     *
     * These used to be a single `Withdrawal(recipient, amount, fee)`, emitted with
     * `recipient` set to the relayer and `amount` set to zero when the only thing
     * that moved was a fee. An indexed field that sometimes names the payee and
     * sometimes names the relayer cannot be filtered on, and the reader has to know
     * which case they are in before they can interpret either number. Each event now
     * fires exactly when its own transfer happens, and a transaction can emit
     * neither, either, or both.
     */
    event Withdrawal(address indexed recipient, uint256 amount);
    event FeePaid(address indexed relayer, uint256 fee);

    error VerifierNotSet();
    error TokenNotSet();
    error UnknownRoot(bytes32 root);
    error AlreadySpent(bytes32 nullifier);
    error DuplicateNullifier(bytes32 nullifier);
    error InvalidProof();
    error AmountTooLarge(uint256 amount);
    error RecipientIsZero();
    error RelayerIsZero();
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
         * Every bound applied before any money moves.
         *
         * `publicAmountFor` bounds `extAmount` and `fee` individually and
         * `fieldEncode` bounds the derived result, and both are reached again from
         * inside `_publicInputs` — which runs *after* the token pull. Checking here
         * as well means an over-sized amount reverts before a transfer has
         * happened, rather than relying on the revert to unwind one.
         */
        int256 publicAmount = publicAmountFor(extData);
        fieldEncode(publicAmount);
        uint256 outward = _magnitude(extData.extAmount);

        /**
         * There is deliberately no "nothing to do" check here.
         *
         * `extAmount == 0` with no fee is not a no-op: it is two notes in, two notes
         * out, nothing crossing the boundary — a merge or a re-split. That is how a
         * wallet consolidates dust, and how it breaks the amount correlation this
         * pool's shape otherwise leaks (see the caveat at the top). Rejecting it as
         * pointless would remove the one move a user has for repairing their own
         * privacy, and it is not free to the caller either way: it still spends two
         * nullifiers and still costs gas, so there is nothing to protect them from.
         */

        /**
         * Pull first, and prove afterwards.
         *
         * A deposit that reverts on the token transfer must not have spent its
         * nullifiers or grown the tree, and doing the pull before any state is
         * written is what guarantees that without an explicit unwind. The
         * verification below still gates every commitment and every payout.
         */
        if (extData.extAmount > 0) _pullExactly(outward);

        if (!verifier.verifyProof(args.proof, _publicInputs(args, extData))) {
            revert InvalidProof();
        }

        _spend(args.inputNullifiers);
        _appendOutputs(args.outputCommitments);

        /**
         * Both payments, independently, and **not** as an if/else.
         *
         * This was `if (publicAmount < 0) _payOut(...); else if (fee != 0)
         * _payFee(...)`, which is where the insolvency in `publicAmountFor`'s
         * history came from: on a withdrawal the fee was carved out of the payout,
         * and on a deposit or a transfer it was paid on top, so one field meant two
         * different things depending on the sign of another. Now the recipient gets
         * exactly `extAmount` and the relayer gets exactly `fee`, always, and the
         * sum of the two is what `publicAmount` says left the pool.
         */
        if (extData.extAmount < 0) _payOut(outward, extData);
        if (extData.fee != 0) _payFee(extData);

        if (extData.extAmount > 0) {
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
     * What the circuit proves the pool's balance changed by.
     *
     * 🔴 **This is not `extAmount`, and conflating the two was a real insolvency.**
     * The version before this one took `publicAmount` as a calldata field and paid
     * the fee out of it on a withdrawal but on top of it on a deposit, so the
     * conservation law the circuit enforced was
     * `sumIns + publicAmount - (publicAmount < 0 ? 0 : fee) == sumOuts` — a
     * different equation depending on the sign of one of its own terms. Meanwhile
     * `IVerifier` documented the unconditional `sumIns + publicAmount == sumOuts`,
     * which is the equation any sane circuit would implement. Built to that spec,
     * every relayed deposit would have skimmed its fee from *other depositors'*
     * money, and every relayed internal transfer (`extAmount == 0`, `fee > 0`)
     * would have been a repeatable withdrawal from a pool that had proven nothing
     * left it. Nothing reverts; the shortfall lands on whoever withdraws last —
     * the exact failure `_pullExactly` exists to prevent, arriving by the other
     * door.
     *
     * The fix is subtraction, once, here: whatever leaves the pool leaves it,
     * whether a recipient or a relayer receives it. `extAmount` is the recipient's
     * side of the boundary and `fee` is the relayer's; their difference from the
     * pool's perspective is what the notes must account for.
     *
     * Both terms are bounded before the subtraction so it cannot come near
     * `int256`'s range — `MAX_NOTE_VALUE` is 2^248 and `int256` holds 2^255, so
     * two bounded values cannot overflow even summed.
     */
    function publicAmountFor(ExtData calldata extData) public pure returns (int256) {
        if (extData.fee > MAX_NOTE_VALUE) revert AmountTooLarge(extData.fee);
        uint256 outward = _magnitude(extData.extAmount);
        if (outward > MAX_NOTE_VALUE) revert AmountTooLarge(outward);

        // casting to 'int256' is safe because the line above has proven the value
        // at most 2^248, which is far inside int256's positive range.
        // forge-lint: disable-next-line(unsafe-typecast)
        return extData.extAmount - int256(extData.fee);
    }

    /**
     * A signed amount as the field element the circuit sees.
     *
     * Negative values are represented as `FIELD_SIZE - magnitude`, which is what
     * subtraction means inside the field. Exposed because a client that encodes
     * this differently is the single most likely reason a correct proof is
     * rejected, and a shared function is cheaper than a shared convention.
     *
     * The bound is re-applied rather than assumed. `publicAmountFor` bounds its two
     * inputs individually, so the derived value can reach `-2·MAX_NOTE_VALUE`; the
     * circuit sees one field element and has one bound, so that is where it has to
     * be checked. In practice this only forbids `extAmount` and `fee` both sitting
     * near the ceiling at once, which is 2^248 base units of an 8-decimal token —
     * about 10^66 whole tokens. One constant for the circuit to agree with is worth
     * more than that edge.
     */
    function fieldEncode(int256 amount) public pure returns (uint256) {
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
     *
     * Note that `extAmount` is now bound twice — once here inside the hash, and
     * once as `input[1]` via `publicAmountFor`. That is redundancy, not confusion:
     * `input[1]` is the number the circuit does arithmetic with, and this hash is
     * what stops a relayer editing the *destination* of money whose quantity is
     * already proven. Removing `extAmount` from the struct would leave the hash
     * unable to distinguish two transactions that pay different amounts to the same
     * recipient, which is a thing a client may legitimately sign twice.
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
        input[1] = fieldEncode(publicAmountFor(extData));
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

    /**
     * The recipient's side of the boundary, in full.
     *
     * No fee arithmetic here, deliberately. A withdrawal of 75 with a fee of 25
     * pays the recipient 75 and the relayer 25, and the proof says 100 left the
     * pool. The previous version paid the recipient 50 and called the difference a
     * fee, which meant a user could not name the amount they wanted to receive
     * without first knowing what the relayer would charge.
     */
    function _payOut(uint256 amount, ExtData calldata extData) private {
        if (extData.recipient == address(0)) revert RecipientIsZero();
        token.safeTransfer(extData.recipient, amount);
        emit Withdrawal(extData.recipient, amount);
    }

    /**
     * The relayer's side, independently of whether anything else moved.
     *
     * A fee with `extAmount == 0` is the shape a relayer takes for submitting a
     * note-to-note payment on someone's behalf: nothing crosses the boundary for
     * the user, and the fee comes out of the pool's balance. That is sound only
     * because `publicAmount` is `-fee` in that case, so the circuit proved the
     * inputs exceeded the outputs by exactly this much. When the same equation was
     * not enforced for this case, this function was the drain.
     *
     * The zero-address check is not symmetry with `_payOut`. A burn address here
     * would destroy a fee the pool has already accounted as spent, leaving notes
     * backed by tokens nobody can ever move.
     */
    function _payFee(ExtData calldata extData) private {
        if (extData.relayer == address(0)) revert RelayerIsZero();
        token.safeTransfer(extData.relayer, extData.fee);
        emit FeePaid(extData.relayer, extData.fee);
    }
}
