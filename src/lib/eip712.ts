/**
 * The EIP-712 digest for an EIP-3009 `TransferWithAuthorization` — the 32 bytes a
 * wallet is asked to sign so that a paid x402 run can be settled in USDC.
 *
 * ── What this file is and is not ─────────────────────────────────────────────
 * It computes a hash. It holds no key, touches no wallet, opens no socket, and
 * produces no signature. That boundary is hard rule 5 in `CLAUDE.md`, and it is why
 * this piece could be built while the rest of T4 waits on a decision: a digest is
 * pure arithmetic over values the caller already has, so it is testable to the last
 * byte against `cast` with nothing deployed and nobody's money at risk.
 *
 * ── 🔴 The digest IS the authorization. Everything it commits to is load-bearing ──
 * A signature is meaningless on its own; what confines it is the digest it was made
 * over. Get one field wrong and the signature is still perfectly valid — for
 * something else:
 *
 *   - Wrong `chainId` → the same signature authorizes the same transfer on a
 *     *different* chain. This is the entire reason EIP-712 has a domain.
 *   - Wrong `verifyingContract` → the signature is valid against another token
 *     contract that happens to implement EIP-3009.
 *   - Wrong `value` → the user reads one number on screen and signs another.
 *
 * So no member of the domain is a formality and none may be defaulted. Every one of
 * them is pinned in `tests/eip712.test.ts` against ground truth, including the
 * closed loop below, which is the strongest check available offline.
 *
 * ── 🔴 An authorization is a BEARER INSTRUMENT, not a payment ─────────────────
 * Signing one does not move money. It produces a slip that *anybody* who holds it
 * can hand to the token contract, once, at any moment until `validBefore`. So the
 * window is not a formality either:
 *
 *   - `validBefore = 0` is fail-safe — never valid, useless, harmless.
 *   - `validBefore = 2^256 - 1` is the dangerous one. It is not "no expiry on a
 *     payment", it is a **standing permission to withdraw `value`**, surviving in
 *     any log, any clipboard and any compromised facilitator indefinitely.
 *
 * `validityWindow` therefore caps the lifetime and will not build a window past
 * `MAX_AUTHORIZATION_SECONDS`. A facilitator settles within a block or two; minutes
 * are generous and hours are somebody else's option to exercise later.
 *
 * ── 🔴 The nonce is drawn from a SET, not a sequence ──────────────────────────
 * EIP-3009 nonces are arbitrary `bytes32` with a used/unused bit each — there is no
 * counter, no ordering, and no "next" one. Two ways to get this wrong, both of which
 * look tidier than the right answer:
 *
 *   - **A counter.** Nothing on chain tells you where you are in it, two tabs
 *     disagree instantly, and every collision is an authorization that silently
 *     never settles.
 *   - **Deriving it from the payment fields**, e.g. `keccak(from‖to‖value)`. This is
 *     the tempting one because it is reproducible. It makes paying the same amount
 *     to the same payee twice *impossible* — the second authorization reuses a spent
 *     nonce — and it publishes the payment's contents, since an observer who guesses
 *     the fields can confirm the guess by recomputing the nonce.
 *
 * `randomNonce` draws 32 bytes from the CSPRNG and that is the whole story. It does
 * not need to be unpredictable for secrecy; it needs to be unique, and uniqueness
 * out of 2^256 is what randomness buys with no state to keep.
 *
 * ── 🔴 `value` and `to` come off the live 402, never from here ────────────────
 * This module takes them as arguments and asserts nothing about where they came
 * from, because it cannot. The rule lives with the caller: the router reads `payTo`
 * and the amount out of the 402 response it is answering, and the payee pinned
 * per origin in `config/payees.ts` exists **only to assert against** —
 * a constant used as the destination is a constant that keeps paying the old payee
 * after upstream moves.
 *
 * ── Typehashes are derived, never tabulated ──────────────────────────────────
 * The two type strings are written out and hashed at module load. Not one hex
 * literal for a typehash appears in this file. A tabulated `0x7c7c6cdb…` is a
 * recalled constant, which is exactly what hard rule 9 forbids: it would be
 * deterministic, would look right, and would match no struct. The string is legible,
 * a wrong character in it changes the hash, and `tests/eip712.test.ts` pins both
 * against `cast keccak $(cast from-utf8 …)`.
 *
 * ⚠️ The member list in a type string is **order-sensitive and whitespace-sensitive**:
 * one space after a comma changes the typehash. They are single-line string literals
 * rather than templates assembled from parts, so there is nothing to reformat.
 *
 * ── Measured against the deployed contract, 2026-09-27 ───────────────────────
 * The domain separator this file derives from `src/config/chain.ts` equals the one
 * the real USDC contract on Base reports:
 *
 *   cast call 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
 *     'DOMAIN_SEPARATOR()(bytes32)' --rpc-url https://mainnet.base.org
 *   → 0x02fa7265e7c5d81118673727957699e4d68f74cd74b7db77da710fe8a2c7834f
 *
 * One equality, and it verifies the struct shape, the string hashing, `name:
 * "USD Coin"`, `version: "2"`, chainId 8453 and the token address all at once —
 * against a contract nobody here controls. That turns five config claims into
 * measurements, which is why the test that asserts it is worth more than the rest of
 * the file's tests combined.
 *
 * ⚠️ `cast` has no typed-data hasher (`cast --help` matches "typed" only in
 * `decode-transaction`), so the digest cannot be pinned in one shot. Every step is
 * anchored separately instead — typehash, string hashes, the 160-byte domain
 * encoding, the 224-byte struct encoding, the 66-byte prefixed preimage — which is
 * the same discipline `abiEncodeExtData` and `extDataHash` are pinned with.
 *
 * ── Status: HALF OF THIS SHIPS. The digest does not run ──────────────────────
 * 🔴 This block said "NOTHING IMPORTS THIS YET" until 2026-09-28, and by then that
 * was false — `lib/requirements.ts` imports six names from here and *is* reached by
 * a panel. Re-measured in the bundle that day: `TransferWithAuthorization`,
 * `EIP712Domain` and `USD Coin` are each present once in `dist/assets/*.js`. The
 * consumer named in the old paragraph as "the next increment" had already landed and
 * nobody came back to delete the claim. **A stale absence claim is worse than no
 * claim**: it reads as a measurement, so the next reader trusts it instead of
 * grepping, and it understates what a change to this file can break.
 *
 * What is true now is narrower and splits the file in two. The **domain** half ships:
 * `USDC_DOMAIN` and `domainSeparator` are what `checkRequirements` asserts the live
 * 402's `asset` and `extra.{name,version}` against, so editing either changes whether
 * a real 402 is accepted. The **digest** half does not run: `authorizationDigest` has
 * exactly one caller, `authorizationFor` in `lib/requirements.ts`, and that function's
 * only callers are in `tests/requirements.test.ts`. Nothing a user can click has ever
 * produced a digest from this code, and nothing has ever signed one — that is T4's
 * `eth_signTypedData_v4` step, which `lib/wallet.ts` deliberately stops short of.
 *
 * So: treat a change to `USDC_DOMAIN` as a change to the payment path, and a change to
 * the encoders as still covered only by vectors. Re-grep `from "@/lib/eip712"` and the
 * callers of `authorizationDigest` rather than trusting this paragraph either.
 */

import { addressToUint } from "@/lib/address";
import { encodeWords, wordFromBytes32, WORD_BYTES } from "@/lib/abi";
import { BASE, USDC } from "@/config/chain";
import { keccak256Uint, utf8 } from "@/lib/keccak";

/**
 * The EIP-712 domain type, exactly as USDC declares it.
 *
 * ⚠️ EIP-712 lets a domain omit members, and the omitted ones must be left out of
 * the type string too — a domain with a `salt` or without a `version` has a
 * *different* typehash. These four, in this order, are what the deployed contract
 * uses; the separator match above is what proves it rather than asserting it.
 */
export const DOMAIN_TYPE =
  "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";

/** The EIP-3009 authorization type. Six members, order fixed by the standard. */
export const AUTHORIZATION_TYPE =
  "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)";

/** `keccak256` of a type string — the first word of every EIP-712 struct encoding. */
export function typeHash(type: string): bigint {
  return keccak256Uint(utf8(type));
}

export const DOMAIN_TYPEHASH = typeHash(DOMAIN_TYPE);
export const AUTHORIZATION_TYPEHASH = typeHash(AUTHORIZATION_TYPE);

/**
 * EIP-191's two leading bytes: `0x19` marks a non-RLP signed message and `0x01` is
 * the version byte for structured data.
 *
 * ⚠️ Without them an EIP-712 digest could collide with a signature over a raw
 * transaction, which is the attack the prefix exists to prevent — so they are not
 * decoration and a digest computed without them is a different, unsafe digest that
 * no wallet will produce and no contract will accept.
 */
const EIP191_PREFIX = Uint8Array.from([0x19, 0x01]);

export type Eip712Domain = {
  readonly name: string;
  readonly version: string;
  readonly chainId: number;
  readonly verifyingContract: string;
};

/**
 * An EIP-3009 authorization, in the order the standard hashes it.
 *
 * `nonce` is `Uint8Array` rather than `bigint` on purpose: the type is the argument.
 * A number invites `nonce + 1n`, and there is no next nonce — see the header. Thirty-two
 * opaque bytes is what it is, and `wordFromBytes32` refuses any other length.
 */
export type Authorization = {
  readonly from: string;
  readonly to: string;
  readonly value: bigint;
  readonly validAfter: bigint;
  readonly validBefore: bigint;
  readonly nonce: Uint8Array;
};

/**
 * `abi.encode` of the domain struct — 160 bytes, five static words.
 *
 * ⚠️ `name` and `version` are **hashed**, not written inline. EIP-712 encodes a
 * dynamic member as `keccak256` of its contents, and inlining the UTF-8 instead
 * produces an encoding of the wrong length whose hash matches nothing. The 160-byte
 * length is asserted in the tests for exactly this reason: an inline "USD Coin"
 * cannot fit a word and could not be quietly wrong.
 */
export function encodeDomain(domain: Eip712Domain): Uint8Array {
  return encodeWords([
    DOMAIN_TYPEHASH,
    keccak256Uint(utf8(domain.name)),
    keccak256Uint(utf8(domain.version)),
    assertChainId(domain.chainId),
    addressToUint(domain.verifyingContract, "verifyingContract"),
  ]);
}

/** `keccak256(abi.encode(domain))` — the `domainSeparator` a contract stores. */
export function domainSeparator(domain: Eip712Domain): bigint {
  return keccak256Uint(encodeDomain(domain));
}

/**
 * `abi.encode` of the authorization struct — 224 bytes, seven static words
 * (the typehash plus six members).
 *
 * Every member goes through a checked conversion rather than a cast: the two
 * addresses through `addressToUint`, which refuses a contradicted EIP-55 checksum
 * before it ever reaches a hash; the three amounts through `assertUint256`; the
 * nonce through `wordFromBytes32`. A struct hash is the last point at which a wrong
 * field is still a readable error instead of a signature.
 */
export function encodeAuthorization(auth: Authorization): Uint8Array {
  return encodeWords([
    AUTHORIZATION_TYPEHASH,
    addressToUint(auth.from, "from"),
    addressToUint(auth.to, "to"),
    assertUint256(auth.value, "value"),
    assertUint256(auth.validAfter, "validAfter"),
    assertUint256(auth.validBefore, "validBefore"),
    wordFromBytes32(auth.nonce, "nonce"),
  ]);
}

/** `keccak256(abi.encode(AUTHORIZATION_TYPEHASH, …members))` — EIP-712's `hashStruct`. */
export function authorizationStructHash(auth: Authorization): bigint {
  return keccak256Uint(encodeAuthorization(auth));
}

/**
 * The 32 bytes to sign: `keccak256(0x19 ‖ 0x01 ‖ domainSeparator ‖ hashStruct)`.
 *
 * 66 bytes in, and the length is asserted in the tests because it is the one part
 * of this function a mistake would leave looking fine. Concatenating hex *strings*
 * instead of bytes, or letting the two hashes through as 64-character text, gives a
 * 130-byte preimage and a digest that is stable, plausible and wrong.
 */
export function authorizationDigest(domain: Eip712Domain, auth: Authorization): bigint {
  const body = encodeWords([domainSeparator(domain), authorizationStructHash(auth)]);
  const preimage = new Uint8Array(EIP191_PREFIX.length + body.length);
  preimage.set(EIP191_PREFIX, 0);
  preimage.set(body, EIP191_PREFIX.length);
  return keccak256Uint(preimage);
}

/**
 * The domain of the USDC contract this app pays in, assembled from `config/chain.ts`.
 *
 * Built from the config rather than written out here, so that the separator test is
 * checking the config's own values against the deployed contract. If somebody edits
 * `USDC.address`, `USDC.eip712` or `BASE.id`, the equality in `tests/eip712.test.ts`
 * fails — which is the behaviour wanted, because every one of those edits changes
 * what a signature authorizes.
 */
export const USDC_DOMAIN: Eip712Domain = {
  name: USDC.eip712.name,
  version: USDC.eip712.version,
  chainId: BASE.id,
  verifyingContract: USDC.address,
};

/**
 * A fresh 32-byte nonce from the CSPRNG.
 *
 * `crypto.getRandomValues` and nothing else — no timestamp, no counter, no hash of
 * the payment. See the header for why each of those alternatives breaks. Unlike
 * `randomFieldElement` in `lib/field.ts` there is no rejection loop, because every
 * 32-byte string is a legal nonce: there is no field to land in, so there is nothing
 * to reject and no sampling bias to avoid.
 */
export function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(WORD_BYTES);
  crypto.getRandomValues(nonce);
  return nonce;
}

/**
 * How long an authorization may stay spendable. Ten minutes by default.
 *
 * Long enough that a facilitator with a slow block, a retry and a clock a little off
 * still settles; short enough that a leaked authorization is worth nothing by the
 * time anybody finds it in a log.
 */
export const DEFAULT_AUTHORIZATION_SECONDS = 600n;

/** The cap. Past this it stops being a payment and becomes a standing permission. */
export const MAX_AUTHORIZATION_SECONDS = 3600n;

/**
 * Slack added to the window a payee asks for, so its own deadline fits inside ours.
 *
 * 🔴 **Signing a window exactly equal to the advertised `maxTimeoutSeconds` leaves the
 * payee none of it.** The number upstream sends means "I may need up to this long to
 * settle", measured from the moment it *receives* the payment — but `validBefore` is
 * measured from the moment this browser *signs* it, and between those two instants sits
 * a POST, a facilitator, and a block. A window of exactly 120 seconds gives a payee that
 * asked for 120 whatever is left after the round trip, so the last requests before
 * expiry fail intermittently and look like a flaky endpoint rather than a clock problem.
 *
 * MEASURED 2026-09-28, from the only client of this payee that has actually been paid
 * (`apps/hub/HubView.tsx` in the upstream repo, read for its wire format): it signs
 * `now + maxTimeoutSeconds + 60`, and its own comment gives this reason plus clock skew
 * against a facilitator neither side runs. Sixty seconds is copied from a working
 * implementation rather than picked, which is the only reason it is a number and not a
 * question.
 *
 * ⚠️ It widens a bearer instrument, so it is bounded like one: the **signed** total is
 * what `MAX_AUTHORIZATION_SECONDS` caps, never the asked figure. Capping the ask would
 * let a payee asking for exactly the maximum receive a signature above it.
 */
export const SETTLEMENT_SLACK_SECONDS = 60n;

/**
 * The `validAfter` / `validBefore` pair for an authorization signed now.
 *
 * ⚠️ **`validAfter` is 0, deliberately, and that is not laziness.** EIP-3009 checks
 * `block.timestamp > validAfter`, so a lower bound only matters for *scheduling* a
 * payment for later — and this one is being signed to settle immediately. Setting it
 * to the caller's own clock buys no security whatsoever, because `validBefore`
 * already bounds the window from the side that matters, and it costs a real failure
 * mode: a browser clock a few seconds ahead of the chain produces an authorization
 * that is rejected for being from the future. Zero cannot be early.
 *
 * `now` is passed in rather than read from `Date.now()` so a test can state the
 * instant it is reasoning about. Seconds, not milliseconds — EIP-3009 compares
 * against `block.timestamp`, and a millisecond value silently reads as a window
 * roughly fifty thousand years wide, which is precisely the standing-permission
 * failure the cap exists to prevent. Hence the upper bound on `now` too: a value
 * that large is milliseconds, and saying so is more useful than capping the
 * lifetime of a window anchored fifty millennia from now.
 */
export function validityWindow(
  nowSeconds: bigint,
  lifetimeSeconds: bigint = DEFAULT_AUTHORIZATION_SECONDS,
): { readonly validAfter: bigint; readonly validBefore: bigint } {
  if (nowSeconds < 0n) {
    throw new Error(`The current time cannot be negative, got ${nowSeconds}.`);
  }
  if (nowSeconds > MAX_PLAUSIBLE_SECONDS) {
    throw new Error(
      `${nowSeconds} is too large to be a Unix time in seconds — it looks like ` +
        "milliseconds. EIP-3009 compares validBefore against block.timestamp, which is " +
        "in seconds, so a millisecond value would sign a window thousands of years wide.",
    );
  }
  if (lifetimeSeconds <= 0n) {
    throw new Error(
      `An authorization needs a positive lifetime, got ${lifetimeSeconds} seconds. ` +
        "A window that has already closed can never settle.",
    );
  }
  if (lifetimeSeconds > MAX_AUTHORIZATION_SECONDS) {
    throw new Error(
      `${lifetimeSeconds} seconds is longer than the ${MAX_AUTHORIZATION_SECONDS} this ` +
        "app will sign for. An authorization is a bearer instrument: anyone holding it " +
        "can spend it until it expires, so a long window is a standing withdrawal " +
        "permission rather than a payment.",
    );
  }
  return { validAfter: 0n, validBefore: nowSeconds + lifetimeSeconds };
}

/**
 * An upper bound on a Unix time in seconds, used only to catch milliseconds.
 *
 * The year 10000, which no clock reports and every `Date.now()` exceeds by three
 * orders of magnitude. A bound of "next year" would be tighter and would turn this
 * app into something that stops working on a date, so the check is deliberately
 * about the *unit* and not about the calendar.
 */
const MAX_PLAUSIBLE_SECONDS = 253_402_300_800n;

/** A `uint256` member, or a thrown error naming the field it came from. */
function assertUint256(value: bigint, label: string): bigint {
  if (value < 0n) {
    throw new Error(
      `${label} is ${value}, and every amount in an EIP-3009 authorization is a uint256. ` +
        "A negative value has no encoding here.",
    );
  }
  return value;
}

/**
 * The chain id as a word.
 *
 * Checked rather than converted because `BigInt(8453.5)` throws a bare `RangeError`
 * with no mention of which field caused it, and because a zero or negative chain id
 * is not a typo that fails later — it is a domain that no contract will agree with,
 * so the signature is simply unusable and the reason needs saying once, here.
 */
function assertChainId(chainId: number): bigint {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error(
      `${chainId} is not a chain id. The chain id is what stops a signature made for ` +
        "one chain from being replayed on another, so it has to be the real one.",
    );
  }
  return BigInt(chainId);
}
