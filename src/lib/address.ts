/**
 * One door for every address string in this app, and the EIP-55 checksum behind it.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * `/^0x[0-9a-fA-F]{40}$/` was written out four separate times — in `SendPanel.tsx`,
 * `lib/verify.ts`, `lib/transaction.ts` and `lib/hooks.ts`. Four copies of a regex is
 * a mild smell on its own. What made it worth an increment is that all four checked
 * **shape only**, and one of them sits on the path that moves money: a recipient that
 * is 42 characters of hex is not a recipient that exists, and a payment to a mistyped
 * address is irreversible and silent. Nothing in the repo could tell the difference.
 *
 * EIP-55 can, for most addresses, and it became possible on 2026-09-28 when
 * `lib/keccak.ts` landed — the checksum is keccak over the lowercased hex, so before
 * that it was not a thing anybody had chosen not to do. It was undoable.
 *
 * ── The verdict is FOUR-valued, and that is the whole design ─────────────────
 * 🔴 **Do not reduce this to a boolean.** The tempting signature is
 * `isValidAddress(s): boolean`, and it is wrong in a way that quietly removes the
 * protection this file was written for. EIP-55 stores its checksum in the *letter
 * case* of the hex digits, so:
 *
 *   - An address with **mixed case** carries a checksum, and it either matches or it
 *     does not. A mismatch means at least one character is wrong.
 *   - An address that is **all lowercase** (or all uppercase, or has no letters at
 *     all) carries **no checksum information whatsoever**. There is nothing to
 *     verify. Explorers, block explorers' copy buttons, and half the tooling in the
 *     ecosystem hand out lowercase addresses, so refusing them is not an option.
 *
 * Fold those two into one boolean and you get whichever failure you picked:
 * `unchecked → true` means an attacker or a typo bypasses the check by lowercasing,
 * and the caller cannot know it happened; `unchecked → false` rejects most
 * legitimately-copied addresses. Neither is acceptable, so the distinction is in the
 * type and a caller has to write the word `unchecked` to ignore it. Hard rule 10:
 * a stand-in value carries its own reason, and the type makes that unavoidable.
 *
 * ── 🔴 Never offer the recomputed checksum as a suggestion ───────────────────
 * `toChecksumAddress` only changes **case**, never a hex digit. So on a mismatch,
 * `toChecksumAddress(whatTheUserTyped)` is *the typo, correctly cased* — a string
 * that now passes every check and still points at the wrong account. Rendering it as
 * "did you mean …?" would take the one mechanism that catches a typo and use it to
 * launder the typo into a valid-looking address. `mismatch` therefore carries no
 * suggested value, only the fact and the advice to re-copy from the source.
 *
 * It is worth being precise about why it cannot be done safely even in principle.
 * A mismatch has two possible causes — a wrong hex digit, or right digits whose case
 * was mangled in transit — and the checksum is exactly the thing that cannot tell
 * them apart. One of those is harmless to re-case and the other is a lost payment.
 * When a check conflates a safe case with an expensive one, it has to assume the
 * expensive one.
 *
 * ── What `hasAddressShape` is for, and the bypass it makes possible ──────────
 * ⚠️ `hasAddressShape` deliberately does **not** look at the checksum, and exists for
 * exactly one caller: `lib/verify.ts`, whose job is to name what you pasted. A
 * bad-checksum string still **is** an address, and telling the user "that is not a
 * hash, an address, or a note" when they paste one would hide the very mistake they
 * came to check. It needs the shape verdict and the checksum verdict separately so it
 * can say "that is an address, and its checksum is wrong".
 *
 * That makes it a bypass by construction. On any path where money moves, call
 * `checkAddress` or `assertChecksummedAddress` — and note that `verify.ts` is the
 * only importer of `hasAddressShape`, which is a thing to keep true rather than a
 * thing that is guaranteed.
 */

import { keccak256, toHex, utf8 } from "@/lib/keccak";

/** 20 bytes, the width of an account. Named because `{40}` in a regex reads as a typo. */
export const ADDRESS_HEX_CHARS = 40;

/**
 * Shape only: `0x` and 40 hex digits, any case.
 *
 * ⚠️ **Not a validity check.** See the header — this is the deliberate bypass, for
 * `verify.ts`'s benefit. It answers "is this string shaped like an address", which is
 * a different and much weaker question than "is this an address somebody owns".
 */
const SHAPE = new RegExp(`^0x[0-9a-fA-F]{${ADDRESS_HEX_CHARS}}$`);

export function hasAddressShape(value: string): boolean {
  return SHAPE.test(value.trim());
}

/**
 * EIP-55: uppercase hex digit *i* exactly when nibble *i* of
 * `keccak256(lowercased 40 hex characters)` is 8 or above.
 *
 * Three things here are easy to get subtly wrong, and each produces a plausible
 * wrong answer rather than an error:
 *
 *  1. The hash is over the **ASCII of the hex string**, not over the 20 address
 *     bytes. `keccak256(utf8("5aaeb…"))` — 40 bytes of text, not 20 of address.
 *     Hashing the bytes gives a stable, wrong-for-every-address casing.
 *  2. The digits `0`–`9` have no case, so they are copied through untouched. Only
 *     `a`–`f` can carry a bit.
 *  3. Nibble *i* is the **high** nibble of byte `i >> 1` when *i* is even and the low
 *     nibble when it is odd. Swapping them gives a casing that is right for half the
 *     characters, which is the kind of bug that passes a spot check.
 *
 * Returns the canonical spelling, `0x` prefix included. Throws on anything not
 * address-shaped, rather than returning a checksummed version of nonsense.
 */
export function toChecksumAddress(value: string): string {
  const trimmed = value.trim();
  if (!hasAddressShape(trimmed)) {
    throw new Error(notAnAddress(trimmed));
  }
  const lower = trimmed.slice(2).toLowerCase();
  const digest = keccak256(utf8(lower));
  let out = "0x";
  for (let i = 0; i < ADDRESS_HEX_CHARS; i++) {
    const char = lower[i] as string;
    const byte = digest[i >> 1] as number;
    const nibble = i % 2 === 0 ? byte >> 4 : byte & 0xf;
    out += nibble >= 8 ? char.toUpperCase() : char;
  }
  return out;
}

/**
 * Whether a string carries checksum information at all.
 *
 * True only when the 40 hex characters contain **both** an uppercase letter and a
 * lowercase one. An all-lowercase address, an all-uppercase one, and one made
 * entirely of digits are all indistinguishable from the lowercased form of any
 * address, so none of them says anything about correctness.
 *
 * ⚠️ Note what this does NOT do: it does not ask whether the string happens to equal
 * its own checksum. Some addresses' canonical spelling *is* all lowercase (EIP-55's
 * own vector `0xde709f…` is one), and it would be tempting to call those
 * "checksummed — and correct". They are not: every address has a lowercase spelling
 * that passes that test, so passing it carries no information. The question is
 * whether a checksum is *present*, not whether one coincidentally agrees.
 */
function carriesChecksum(hex: string): boolean {
  return hex !== hex.toLowerCase() && hex !== hex.toUpperCase();
}

function notAnAddress(value: string): string {
  return (
    `That is not a 20-byte hex address: "${value}". ` +
    "Chain plus address identifies an account; a name or a ticker never does."
  );
}

/**
 * What can be said about an address string, in four mutually exclusive cases.
 *
 * `malformed` and `mismatch` both carry `why` — a sentence written for the person who
 * typed it, because both appear next to a text field. `unchecked` and `checksummed`
 * both carry `address`, lowercased, which is the canonical spelling for ABI encoding
 * and for comparing two addresses to each other.
 */
export type AddressCheck =
  /** Not 0x plus 40 hex digits. Nothing else can be said. */
  | { readonly kind: "malformed"; readonly why: string }
  /**
   * Well-formed, but with no case information, so **the checksum was not checked**.
   * This is the common case for an address copied from an explorer, and accepting it
   * is correct — but a caller that treats it as verified is claiming something this
   * string cannot support.
   */
  | { readonly kind: "unchecked"; readonly address: string }
  /** Mixed case, and the case disagrees with the checksum: a character is wrong. */
  | { readonly kind: "mismatch"; readonly why: string }
  /** Mixed case, and the checksum matches. The strongest verdict available offline. */
  | { readonly kind: "checksummed"; readonly address: string };

/**
 * Classify an address string. Never throws — the failures are values, because every
 * caller has something to render for each of them.
 */
export function checkAddress(value: string): AddressCheck {
  const trimmed = value.trim();
  if (!hasAddressShape(trimmed)) {
    return { kind: "malformed", why: notAnAddress(trimmed) };
  }
  const hex = trimmed.slice(2);
  const lowercased = `0x${hex.toLowerCase()}`;
  if (!carriesChecksum(hex)) {
    return { kind: "unchecked", address: lowercased };
  }
  if (toChecksumAddress(trimmed) !== trimmed) {
    return {
      kind: "mismatch",
      why:
        `The EIP-55 checksum in "${trimmed}" does not match, which means at least one ` +
        "character is wrong. Copy it again from wherever you got it — do not fix the " +
        "capitalisation, because the capitalisation is what caught this.",
    };
  }
  return { kind: "checksummed", address: lowercased };
}

/**
 * The canonical lowercase address, or a thrown error naming the field.
 *
 * Accepts `unchecked` and `checksummed`, refuses `malformed` and `mismatch`. The
 * asymmetry is the point: a lowercase address is the ecosystem's normal currency and
 * refusing it would make the app unusable, while a *contradicted* checksum is
 * positive evidence of a typo and there is no reading under which it should proceed.
 *
 * 🔴 **The checksum is verified BEFORE the lowercasing, and the order is the reason
 * this function exists rather than a bare `.toLowerCase()`.** Lowercasing destroys the
 * evidence. Do it first and a mistyped mixed-case address becomes a perfectly
 * well-formed lowercase one, every downstream check passes, the ABI encoding is
 * canonical, the proof is valid, and the money is gone. This is the same shape of bug
 * as pairing `extData: A` with `extDataHash(B)`: a well-formed statement about the
 * wrong transaction.
 */
export function assertChecksummedAddress(value: string, label: string): string {
  const checked = checkAddress(value);
  switch (checked.kind) {
    case "malformed":
      throw new Error(`${label}: ${checked.why}`);
    case "mismatch":
      throw new Error(`${label}: ${checked.why}`);
    case "unchecked":
    case "checksummed":
      return checked.address;
  }
}

/**
 * One line naming the checksum situation, for a panel to put under an input.
 *
 * ⚠️ `unchecked` says so out loud rather than staying silent. Silence there reads as
 * approval, and the difference between "checksum verified" and "this address cannot
 * be checked" is exactly the information a user needs before sending money they
 * cannot get back. It is not an error and must not be styled as one.
 *
 * ⚠️ The `unchecked` line says **no mixed case**, not "lowercase". It read "Lowercase
 * address:" until it was checked against the union it describes, and that was wrong for
 * two of the three inputs that land here: an all-UPPERCASE address is `unchecked` too —
 * `0x52908400098527886E0F7030069857D2E4169EE7` is one of EIP-55's own vectors — and so
 * is an address with no letters at all, like `0x1111…1111`, where "lowercase" is not
 * false so much as meaningless. A sentence that misdescribes the input teaches the user
 * to stop reading it, which costs exactly the attention this line exists to buy.
 */
export function describeChecksum(checked: AddressCheck): string {
  switch (checked.kind) {
    case "malformed":
      return checked.why;
    case "mismatch":
      return checked.why;
    case "unchecked":
      return (
        "This address has no mixed case, so there is no EIP-55 checksum to verify. " +
        "Nothing here can catch a typo in it — check it against wherever you copied it from."
      );
    case "checksummed":
      return "EIP-55 checksum matches.";
  }
}

/**
 * The 20 address bytes, big-endian, as the `uint160` the ABI encodes.
 *
 * Here rather than in `transaction.ts` so that the parse from text to number happens
 * once, in the same file that decides what counts as an address. Goes through
 * `assertChecksummedAddress`, so a bad checksum cannot reach an encoder.
 */
export function addressToUint(value: string, label: string): bigint {
  return BigInt(assertChecksummedAddress(value, label));
}

/** The zero address, lowercase. Named because `0x0` and 40 zeros are different strings. */
export const ZERO_ADDRESS = `0x${"0".repeat(ADDRESS_HEX_CHARS)}`;

/**
 * Whether two address strings name the same account, ignoring case.
 *
 * ⚠️ Deliberately tolerant of spelling and deliberately **not** tolerant of shape: it
 * throws on a malformed input rather than answering `false`. "These are different
 * accounts" and "one of these is not an address" must not look the same at a call
 * site that is about to branch on the answer.
 */
export function sameAddress(a: string, b: string): boolean {
  return (
    assertChecksummedAddress(a, "first address") === assertChecksummedAddress(b, "second address")
  );
}

/**
 * The digest EIP-55 hashes, as hex — exported for the tests alone.
 *
 * `tests/address.test.ts` pins it against `cast keccak $(cast from-utf8 <lowercased>)`,
 * which is what makes point 1 of `toChecksumAddress`'s comment an assertion rather than
 * a claim: hashing the 20 address bytes instead of the 40 text characters would give a
 * different number here while still producing a stable casing that looks plausible.
 */
export function checksumDigestHex(value: string): string {
  const trimmed = value.trim();
  if (!hasAddressShape(trimmed)) {
    throw new Error(notAnAddress(trimmed));
  }
  return toHex(keccak256(utf8(trimmed.slice(2).toLowerCase())));
}
