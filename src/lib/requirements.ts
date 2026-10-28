/**
 * The 402's payment requirements, parsed AND checked in one step.
 *
 * ── Why parsing and checking are the same function ───────────────────────────
 * `parsePrice` in `adapters/http/catalog.ts` already read this JSON, and it threw
 * three fields away: `scheme`, `extra.{name,version}` and `maxTimeoutSeconds`.
 * Those are exactly the three the safety of a signature rests on. So a checker
 * placed downstream of `Price` is not merely inconvenient — it is **structurally
 * unable** to check the things worth checking, because the evidence is already
 * gone. Parsing that discards a field is parsing that cannot be verified later,
 * and the fix is not a second pass; it is to never have a value that got as far as
 * the UI without being checked.
 *
 * ── 🔴 What is actually at stake ─────────────────────────────────────────────
 * Answering a 402 means signing an EIP-3009 authorization: a bearer instrument
 * over the caller's own USDC (see `lib/eip712.ts`). Every parameter of that
 * instrument is supplied by the party being paid. A changed or hostile upstream
 * that names a different token, a different chain, a different payee or a larger
 * amount gets a **valid signature for exactly what it named**. There is no later
 * stage that catches it: the wallet shows what it was handed, the facilitator
 * settles what verifies, and the chain has no opinion about whether the user meant
 * it. This module is the only place in the path where upstream's claims are
 * compared against something it does not control.
 *
 * ── 🔴 Which side is authoritative, and why it differs per field ─────────────
 * Two fields look symmetric and are not, and getting the direction backwards
 * defeats the check while looking like it passed:
 *
 *   `payTo`      comes FROM upstream. The payee pinned for that origin
 *                (`config/payees.ts`) is only ever an assertion — never a destination. A constant used as the
 *                destination keeps paying the old payee after upstream rotates,
 *                which is a silent misroute rather than an error.
 *
 *   the DOMAIN   comes FROM config. Upstream's `extra.{name,version}` is only ever
 *                compared. The domain binds a signature to one deployed contract;
 *                adopting upstream's version string would let it choose the domain
 *                its own signature is checked under.
 *
 * The asymmetry is not a style choice. A payee can legitimately change — it is an
 * account someone controls. A deployed token's EIP-712 domain **cannot** change
 * without a new contract at a new address, so upstream naming a different one is
 * evidence of a mistake somewhere, never of a legitimate update.
 *
 * ── ⚠️ Why an unrecognised payee is a VALUE and not a throw ──────────────────
 * Everything else here throws, because everything else means "this 402 is not one
 * I can read". A rotated payee is different: the 402 is perfectly readable, the
 * price is real, and the only thing wrong is that this build has not been told
 * about the new address. Throwing there would make the price un-renderable — the
 * panel would show an error where it should show *0.01 USDC, to an address this
 * build does not recognise*. So `payee` is a discriminant, `whyNotSign` refuses it,
 * and the two questions stay separate: **can I read this price** and **will I sign
 * it** have different answers and deserve different mechanisms.
 *
 * ── Measured live 2026-09-28 ─────────────────────────────────────────────────
 * `GET https://blueagent.dev/api/x402/<id>` for `token-price`, `wallet-risk` and
 * `blue-audit` — three different prices, byte-identical requirement shapes:
 *
 *     x402Version        2
 *     accepts            exactly 1 entry
 *     scheme             "exact"
 *     network            "eip155:8453"      ⬅️ CAIP-2, not the bare number
 *     asset              0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 *     payTo              0x02950ad38ada1d599375bd447e080cd404809205
 *     maxTimeoutSeconds  120
 *     extra              { name: "USD Coin", version: "2" }
 *     amount             "10000" | "50000" | "1000000"
 *
 * Re-measure rather than trusting that table. Each constant below names which line
 * of it the check is against.
 *
 * ── ⚠️ `maxTimeoutSeconds` supersedes a guess ────────────────────────────────
 * `DEFAULT_AUTHORIZATION_SECONDS` in `lib/eip712.ts` is 600, chosen before this
 * field had been measured. Upstream asks for **120**. Signing a ten-minute window
 * for a payment that settles in two would have been 5× the bearer-instrument
 * exposure in exchange for nothing, so this path does not use the default at all:
 * upstream states the window it needs and this build caps it. That is the correct
 * relationship — the payee knows its own settlement latency, and the payer decides
 * how much standing permission it is willing to sign.
 *
 * ── 🔴 Every bound here REFUSES. None of them clamp. ─────────────────────────
 * A clamped amount is a valid authorization for a number nobody agreed to; a
 * clamped window is one that expires before it can settle and reads as a bug in
 * this app. In both cases the caller ends up with a well-formed signature over
 * something they did not choose, which is the same failure as masking an
 * out-of-range ABI word (see `lib/abi.ts`). Refusing is the only behaviour that
 * keeps the bytes and the screen describing the same thing.
 *
 * ── Status: this is the only way to hold a price ────────────────────────────────
 * Measured 2026-09-28: `grep -cF 'not the CAIP-2 form' dist/assets/*.js` → 1, so this
 * module is in the shipped bundle and not tree-shaken out. Worth confirming in the
 * bundle rather than by grepping `src/`, for two reasons: this repo has twice had a
 * module at 100% coverage that looked wired up and was not, and the obvious source
 * grep matches **this very sentence** (see `lib/keccak.ts` for why the needle must be
 * `-F` and must carry no identifier).
 *
 * It is reachable because `Price`'s `paid` variant now holds a `PaymentRequirements`
 * and nothing else — so `checkRequirements` is not a check a caller may remember to
 * run, it is the only constructor of a displayable price. `adapters/http/catalog.ts`
 * delegates to it for every live 402, and `adapters/local/catalog.ts` runs its stub
 * envelope through it too, which is what makes the stub provably a shape production
 * could produce.
 */

import { sameAddress } from "@/lib/address";
import { BASE, USDC } from "@/config/chain";
import { pinnedPayee } from "@/config/payees";
import {
  authorizationDigest,
  MAX_AUTHORIZATION_SECONDS,
  SETTLEMENT_SLACK_SECONDS,
  randomNonce,
  USDC_DOMAIN,
  validityWindow,
  type Authorization,
  type Eip712Domain,
} from "@/lib/eip712";
import type { TokenRef } from "@/adapters/types";

/**
 * The x402 envelope version this build understands. Measured: 2.
 *
 * A major version is a statement about what every field below *means*. Reading a
 * version 3 envelope with version 2 rules would produce requirements that parse
 * cleanly and describe something else, so the version is checked first and nothing
 * after it runs on an envelope this code has never seen.
 */
export const SUPPORTED_X402_VERSION = 2;

/**
 * The only settlement scheme this build will sign. Measured: `"exact"` everywhere.
 *
 * `exact` means the amount is the amount. A scheme that meant "up to" would make
 * the same signature a ceiling rather than a price, and the panel's one job is to
 * show the number that will actually be taken.
 */
export const SUPPORTED_SCHEME = "exact";

/**
 * The most this build will sign for one tool call.
 *
 * Anchored, not invented: the whole live catalog was quoted on 2026-09-27 and the
 * most expensive id is `blue-audit` at 1_000_000 base units ($1.00). Five dollars
 * is 5× that — comfortably above every real price and far below any amount that
 * could be anything but a mistake or an attack.
 *
 * ⚠️ The panel does display the amount, so in principle a user could catch this.
 * In practice "Run for 10000.00 USDC" under a tool that cost a cent yesterday is
 * exactly the button people click, which is why the refusal is in code and not in
 * the copy. Re-measure the catalog before moving it.
 */
export const MAX_TOOL_PRICE_BASE_UNITS = 5_000_000n;

/**
 * CAIP-2 for an EVM chain: `eip155:<decimal id>`.
 *
 * Anchored so the *form* is checked and not just the digits. Upstream sends
 * `"eip155:8453"`; a bare `"8453"` or a friendly `"base"` would be a shape this
 * build has never seen, and "I cannot tell which chain this is" is the right answer
 * where a lenient parse would guess. The chain id is the only thing standing
 * between a signature and its replay on another chain, so it is the last field to
 * be generous about.
 */
const CAIP2_EIP155 = /^eip155:(\d+)$/;

/** Digits only. `BigInt("1e4")` throws and `BigInt(" 1")` does not — neither is a price. */
const WHOLE = /^\d+$/;

/**
 * Who gets paid, and whether this build recognises them.
 *
 * ⚠️ There is deliberately no `recognised: boolean`. Same rule as `Attestation` and
 * `Settlement` in `adapters/types.ts`: a false boolean is a field that gets ignored,
 * whereas the `unrecognised` variant carries a `why` a panel has to render and
 * `whyNotSign` has to refuse. The failure explains itself or it does not exist.
 */
export type Payee =
  /** Matches the payee pinned for the origin that sent the 402. */
  | { readonly kind: "known"; readonly address: string }
  /**
   * A real address, but not the one pinned for this origin. Upstream may have rotated
   * its payee, or this build's pin may be stale — from here both look identical,
   * which is exactly why this is not signed automatically.
   */
  | { readonly kind: "unrecognised"; readonly address: string; readonly why: string }
  /**
   * An origin nobody has pinned a payee for, so there is nothing to compare against.
   *
   * Its own variant rather than folded into `unrecognised`, because the two call for
   * different reactions: "this changed" is a warning about a known server, "this is
   * new" is a first meeting. A merged message would have to be vague about which, and
   * the payee check is the one place on the path where vagueness costs money.
   */
  | { readonly kind: "unpinned"; readonly address: string; readonly why: string };

/**
 * A 402's requirements, after every check in this file has passed.
 *
 * Holding one of these is a claim: the envelope version is understood, there is
 * exactly one way to pay, the scheme is `exact`, the chain is Base, the asset is
 * the USDC whose decimals this repo verified, the EIP-712 domain upstream named is
 * the one in config, and the amount and window are within bounds. Nothing here is
 * optional, because an optional checked field is an unchecked field.
 */
export type PaymentRequirements = {
  readonly toolId: string;
  readonly payee: Payee;
  /**
   * The `accepts` entry this was read from, VERBATIM — every field, including the ones
   * this file does not check (`extra.credentialTypes`, `currency`, …).
   *
   * Kept because the standard x402 v2 client header echoes it back as `accepted`, and a
   * server matches that echo against its own list. Rebuilding it from the checked fields
   * drops whatever the server added and turns a correct payment into "no matching
   * requirement". MEASURED 2026-09-29: api.onesource.io's entry carries `currency`,
   * `maxAmountRequired`, `recipient` and `extra.credentialTypes` beside the fields checked
   * here. Safe to echo precisely because every field that decides the money — scheme,
   * network, asset, amount, payee, window, domain — was checked on THIS object.
   */
  readonly accepted: Readonly<Record<string, unknown>>;
  /** The 402's own `resource` block, echoed in the v2 payment header when there was one. */
  readonly resource: Readonly<Record<string, unknown>> | null;
  /**
   * How many other ways to pay the server offered that this build does not sign — shown,
   * so "0.01 USDC" is not mistaken for the only price on the table.
   */
  readonly passedOver: number;
  /** Base units of `asset`, exact. Never a display string. */
  readonly value: bigint;
  /** The asset, with decimals from this repo's verified table — never from upstream. */
  readonly asset: TokenRef;
  /** Built from config. Upstream's `extra` was compared against it, not copied into it. */
  readonly domain: Eip712Domain;
  /**
   * Upstream's `maxTimeoutSeconds`, verbatim. **Not the window that gets signed** — it
   * is what the payee said it needs, and it goes back out in the header's `accepted`
   * block where it has to mirror the 402 field for field.
   */
  readonly askedSeconds: bigint;
  /**
   * The window this build actually signs: `askedSeconds + SETTLEMENT_SLACK_SECONDS`,
   * checked against the cap.
   *
   * 🔴 **Two fields rather than one, because they are two different numbers and the
   * difference is the whole point.** A single `lifetimeSeconds` had to be either the ask
   * (and then the signature expires before the payee's own deadline — see
   * `SETTLEMENT_SLACK_SECONDS`) or the signed window (and then the header's `accepted`
   * block no longer mirrors the 402, which is the one thing a facilitator diffs). The
   * failure of collapsing them is silent in both directions, so the type keeps both and
   * names which is which — the same reason `Payee` is a union rather than a boolean.
   *
   * Anything describing *exposure* to a user reads this one. It is the larger number.
   */
  readonly lifetimeSeconds: bigint;
};

/* ── reading upstream's json without trusting its shape ───────────────────────── */

type Json = Record<string, unknown>;

function obj(value: unknown, what: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Upstream sent ${what} that is not a JSON object.`);
  }
  return value as Json;
}

function str(value: unknown, what: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`Upstream sent no ${what}.`);
  }
  return value;
}

/* ── the checks, one per field ────────────────────────────────────────────────── */

/**
 * Whether this build could sign an `accepts` entry at all: the `exact` scheme, on Base,
 * in USDC, by EIP-3009. A cheap sieve over a list, NOT the check — whatever it lets
 * through still goes through every assertion below.
 */
function couldSign(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
  const e = entry as Json;
  const extra = typeof e.extra === "object" && e.extra !== null ? (e.extra as Json) : {};
  return (
    e.scheme === SUPPORTED_SCHEME &&
    e.network === `eip155:${BASE.id}` &&
    typeof e.asset === "string" &&
    sameAddress(e.asset, USDC.address) &&
    (extra.assetTransferMethod === undefined || extra.assetTransferMethod === EIP3009)
  );
}

/** `"exact on eip155:8453"`, or `?` for whatever a field turned out not to be. */
function describeOffer(entry: unknown): string {
  const e = typeof entry === "object" && entry !== null ? (entry as Json) : {};
  const text = (v: unknown) => (typeof v === "string" ? v : "?");
  return `${text(e.scheme)} on ${text(e.network)}`;
}

/**
 * The `accepts` entry to read, and how many others were passed over.
 *
 * 🔴 **Exactly one SIGNABLE entry — never "the first of however many".** This rule used
 * to be "exactly one entry, full stop", measured against the one upstream that sent one.
 * MEASURED 2026-09-29 across x402 servers listed on Coinbase's Bazaar, that is not what
 * the ecosystem sends: x402.ottoai.services offers three (exact by EIP-3009 on Base,
 * exact by permit2 on Base, exact on Solana), api.onesource.io offers two (exact and
 * batch-settlement). "Exactly one" refused them all.
 *
 * What the old rule protected is kept: this never picks by array order, and never picks
 * between two prices. When several entries are offered, the ones this build could not
 * sign are set aside; if exactly one remains, it is not a choice — it is the only way
 * this build can pay — and `passedOver` says the others existed. If two or more remain,
 * that IS a choice between prices, and it is refused as before. A single entry skips the
 * sieve and goes straight to the field checks, so its refusal names the field that was
 * wrong rather than a generic "none signable".
 */
function chooseAccept(body: Json, toolId: string): { accept: Json; passedOver: number } {
  const accepts = body.accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) {
    throw new Error(
      `${toolId} asked for payment but named no way to pay it, so there is nothing here to agree to.`,
    );
  }
  if (accepts.length === 1) {
    return { accept: obj(accepts[0], "a payment requirement"), passedOver: 0 };
  }
  const signable = accepts.filter(couldSign);
  const [only] = signable;
  if (signable.length === 1) {
    return { accept: only as Json, passedOver: accepts.length - 1 };
  }
  if (signable.length === 0) {
    throw new Error(
      `${toolId} offered ${accepts.length} ways to pay and this build can sign none of them — ` +
        `it signs only "exact" EIP-3009 transfers of ${USDC.symbol} on ${BASE.name}. Offered: ` +
        `${accepts.map(describeOffer).join(", ")}.`,
    );
  }
  throw new Error(
    `${toolId} offered ${signable.length} ways to pay that this build could sign, and it will ` +
      "not choose between them for you: picking one would show you a price that was only one " +
      "of several.",
  );
}

/** The envelope version, checked before anything inside the envelope is read. */
function assertVersion(body: Json, toolId: string): void {
  const version = body.x402Version;
  if (version !== SUPPORTED_X402_VERSION) {
    throw new Error(
      `${toolId} answered with x402 version ${JSON.stringify(version)}, and this build reads ` +
        `version ${SUPPORTED_X402_VERSION}. A different version can redefine what every field ` +
        "below means, so the requirements were not read rather than read under the wrong rules.",
    );
  }
}

/** `exact` or a refusal. See `SUPPORTED_SCHEME`. */
function assertScheme(accept: Json, toolId: string): void {
  const scheme = str(accept.scheme, "payment scheme");
  if (scheme !== SUPPORTED_SCHEME) {
    throw new Error(
      `${toolId} wants to be paid under the "${scheme}" scheme, and this build only signs ` +
        `"${SUPPORTED_SCHEME}". Another scheme can give the same signature a different meaning ` +
        "— a ceiling instead of a price, say — and nothing here would show you the difference.",
    );
  }
}

/**
 * The chain id out of a CAIP-2 string, asserted to be Base.
 *
 * Both halves matter. An unparseable network means this build cannot say which
 * chain the signature would be valid on; a parseable one naming another chain means
 * it knows, and the answer is wrong.
 */
function assertNetwork(accept: Json, toolId: string): void {
  const network = str(accept.network, "network");
  const matched = CAIP2_EIP155.exec(network);
  if (!matched) {
    throw new Error(
      `${toolId} named its network as "${network}", which is not the CAIP-2 form ` +
        `"eip155:<id>" this build reads. The chain id is what stops a signature from being ` +
        "replayed on another chain, so it is not a field to guess at.",
    );
  }
  const id = Number(matched[1] as string);
  if (id !== BASE.id) {
    throw new Error(
      `${toolId} wants payment on chain ${id}, and this build signs only for ${BASE.name} ` +
        `(${BASE.id}). A signature carries its chain id, so one made here would be useless ` +
        "there — and one made for the wrong chain is exactly what a replay needs.",
    );
  }
}

/**
 * The asset, resolved to this repo's verified entry.
 *
 * ⚠️ A 402 names its asset by address and carries **no decimals** — measured. So the
 * number that turns `"10000"` into `0.01` cannot come from upstream, and assuming 6
 * because the symbol looks familiar is how a price ends up wrong by 10^12. The
 * returned `TokenRef` is the one from `config/chain.ts`, never a shape built here.
 *
 * ⚠️ Note what this deliberately does NOT do: run the address through EIP-55. It
 * would add nothing. EIP-55 catches a typo in an address nobody has another copy
 * of; here there *is* another copy, and comparing against it is strictly stronger —
 * if it lowercases to USDC it is USDC, and if it does not it is refused whatever
 * its capitalisation. Checking the checksum as well could only reject the right
 * token for a cosmetic reason.
 */
function assertAsset(accept: Json, toolId: string): TokenRef {
  const address = str(accept.asset, "asset address");
  if (!sameAddress(address, USDC.address)) {
    throw new Error(
      `${toolId} asked to be paid in ${address}. This build has verified the decimals of ` +
        `exactly one asset — ${USDC.symbol} at ${USDC.address} — and for anything else there ` +
        "is nothing to divide by, so the price cannot be shown and must not be signed.",
    );
  }
  return USDC;
}

/** The one asset-transfer method this build signs. See `assertTransferMethod`. */
const EIP3009 = "eip3009";

/**
 * EIP-3009 or nothing. Absent means EIP-3009 — that is the `exact` scheme's default and
 * what every entry measured before 2026-09-29 meant by omission.
 *
 * MEASURED 2026-09-29: x402.ottoai.services offers `exact` on Base twice, the second with
 * `extra.assetTransferMethod: "permit2"`. Same scheme, same chain, same asset, same amount
 * — and a different contract call with a different signature. Signing an EIP-3009
 * authorization against a permit2 requirement produces a well-formed payment the server
 * cannot use, so it is refused by name rather than attempted.
 */
function assertTransferMethod(accept: Json, toolId: string): void {
  const extra = obj(accept.extra, "the EIP-712 domain fields");
  const method = extra.assetTransferMethod;
  if (method !== undefined && method !== EIP3009) {
    throw new Error(
      `${toolId} wants payment through ${JSON.stringify(method)}, and this build signs only ` +
        "EIP-3009 transfer authorizations. A signature for one method is useless — and " +
        "misleading — against the other, so nothing was signed.",
    );
  }
}

/**
 * The EIP-712 domain, taken from config once upstream's claim about it has matched.
 *
 * 🔴 Read the return value carefully: it is `USDC_DOMAIN`, not a domain assembled
 * from `extra`. Upstream's `name` and `version` are **compared and discarded**. That
 * direction is the whole point — a domain built from upstream's strings would let
 * the payee pick the domain its own signature is verified under, and
 * `domainSeparator` would dutifully produce a valid separator for it.
 *
 * The comparison is still worth making, because a mismatch is information: the
 * deployed contract's domain cannot change, so upstream naming a different one means
 * either upstream is wrong about the token it is charging in or this build's config
 * is stale. Neither is a state to sign in.
 */
function assertDomain(accept: Json, toolId: string): Eip712Domain {
  const extra = obj(accept.extra, "the EIP-712 domain fields");
  const name = str(extra.name, "EIP-712 domain name");
  const version = str(extra.version, "EIP-712 domain version");
  if (name !== USDC.eip712.name || version !== USDC.eip712.version) {
    throw new Error(
      `${toolId} named the EIP-712 domain "${name}" version "${version}", and this build has ` +
        `"${USDC.eip712.name}" version "${USDC.eip712.version}" verified against the deployed ` +
        "contract. A token's domain cannot change without a new contract, so this is a mistake " +
        "somewhere and not an update — nothing was signed under either one.",
    );
  }
  return USDC_DOMAIN;
}

/** The amount in base units: whole, positive, and under the cap. */
function assertValue(accept: Json, toolId: string, asset: TokenRef): bigint {
  const text = str(accept.amount, "amount");
  if (!WHOLE.test(text)) {
    throw new Error(
      `${toolId} asked for "${text}", which is not a whole number of base units.`,
    );
  }
  const value = BigInt(text);
  if (value === 0n) {
    throw new Error(
      `${toolId} asked for payment of zero. A tool that wants nothing answers without a 402 ` +
        "at all; an authorization for zero would spend gas to move no money, so this is a " +
        "malformed requirement rather than a free tool.",
    );
  }
  if (value > MAX_TOOL_PRICE_BASE_UNITS) {
    throw new Error(
      `${toolId} asked for ${value} base units of ${asset.symbol}, above the ` +
        `${MAX_TOOL_PRICE_BASE_UNITS} this build will sign for one tool call. Nothing was ` +
        "reduced to fit — a smaller authorization would be a valid signature for an amount " +
        "you were never shown.",
    );
  }
  return value;
}

/**
 * The window upstream asks for, and the longer one this build will sign.
 *
 * Refused rather than clamped, in both directions. Clamping down signs a window
 * that expires before upstream can settle, which fails and reads as a bug here;
 * clamping up signs more standing permission than anyone asked for.
 *
 * 🔴 **The cap is applied to the SIGNED total, not to the ask.** Checking `raw` and then
 * adding slack afterwards would let a payee asking for exactly
 * `MAX_AUTHORIZATION_SECONDS` receive a signature `SETTLEMENT_SLACK_SECONDS` past it —
 * a bound defeated by the line after the bound, which is the shape of bug that survives
 * review because both halves read correctly on their own. The error names both numbers so
 * the arithmetic is visible to whoever hits it.
 */
function assertWindow(
  accept: Json,
  toolId: string,
): { readonly askedSeconds: bigint; readonly lifetimeSeconds: bigint } {
  const raw = accept.maxTimeoutSeconds;
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw <= 0) {
    throw new Error(
      `${toolId} gave its settlement window as ${JSON.stringify(raw)}, which is not a whole ` +
        "number of seconds. That number is how long the authorization stays spendable, so it " +
        "is not something to default.",
    );
  }
  const askedSeconds = BigInt(raw);
  const lifetimeSeconds = askedSeconds + SETTLEMENT_SLACK_SECONDS;
  if (lifetimeSeconds > MAX_AUTHORIZATION_SECONDS) {
    throw new Error(
      `${toolId} wants an authorization valid for ${askedSeconds} seconds, which this build ` +
        `would sign as ${lifetimeSeconds} to leave it room to settle — longer than the ` +
        `${MAX_AUTHORIZATION_SECONDS} it will sign at all. An authorization is a bearer ` +
        "instrument: anyone holding it can spend it until it expires, so a long window is a " +
        "standing withdrawal permission rather than a payment.",
    );
  }
  return { askedSeconds, lifetimeSeconds };
}

/**
 * The payee, classified rather than approved.
 *
 * ⚠️ This is the one address on the whole path where EIP-55 cannot help: BlueAgent's
 * `payTo` and its pin are both all-lowercase, which carries no checksum to verify
 * (`checkAddress` returns `unchecked` for both). The comparison against the pin is
 * therefore not a belt-and-braces extra — it is the only check this field has.
 *
 * Keyed by `origin` — where the 402 actually came from — because that is the only
 * identity the browser verified. See `config/payees.ts`.
 */
function classifyPayee(
  accept: Json,
  toolId: string,
  origin: string,
  lookup: PinLookup,
): Payee {
  const address = str(accept.payTo, "payee");
  const pinned = lookup(origin);
  if (pinned === null) {
    return {
      kind: "unpinned",
      address,
      /**
       * Names the ORIGIN, not the tool id: for a pasted URL the id is the whole URL, and a
       * sentence that repeats it before getting to the point was measured in a browser
       * wrapping to seven lines above the one control that resolves it.
       */
      why:
        `This build has no record of who ${origin} gets paid to, so ${address} cannot be checked ` +
        "against anything — the server asking to be paid is the only one naming it. Confirm it " +
        "somewhere else before anything signs to it.",
    };
  }
  if (sameAddress(address, pinned)) {
    return { kind: "known", address };
  }
  return {
    kind: "unrecognised",
    address,
    why:
      `${toolId} wants to be paid to ${address}, and this build expects ${origin} to be paid ` +
      `to ${pinned}. Upstream may have moved its payee, or this build's record of it may be ` +
      "out of date — from here those look identical, and one of them means the money goes " +
      "somewhere nobody chose. Confirm the new address before signing to it.",
  };
}

/* ── the whole check ─────────────────────────────────────────────────────────── */

/**
 * Read a 402 body into checked requirements, or throw explaining what stopped it.
 *
 * Order is deliberate: the envelope version first, since it governs the meaning of
 * everything else; then the choice of payment method, since there must be exactly
 * one before any of its fields mean anything; then the fields. The payee is last
 * because it is the only one that produces a value instead of a refusal, and a
 * caller should not be handed a rotated-payee warning about a 402 that was also on
 * the wrong chain.
 */
/**
 * Who an origin is pinned to be paid to, or `null`. `config/payees.ts` is the default;
 * the x402 window passes one that also knows the payees its user has confirmed.
 */
export type PinLookup = (origin: string) => string | null;

export function checkRequirements(
  toolId: string,
  origin: string,
  body: unknown,
  lookup: PinLookup = pinnedPayee,
): PaymentRequirements {
  const envelope = obj(body, "a payment requirement");
  assertVersion(envelope, toolId);

  const { accept, passedOver } = chooseAccept(envelope, toolId);
  assertScheme(accept, toolId);
  assertNetwork(accept, toolId);
  const asset = assertAsset(accept, toolId);
  assertTransferMethod(accept, toolId);
  const domain = assertDomain(accept, toolId);
  const value = assertValue(accept, toolId, asset);
  const { askedSeconds, lifetimeSeconds } = assertWindow(accept, toolId);
  const resource = envelope.resource;

  return {
    toolId,
    payee: classifyPayee(accept, toolId, origin, lookup),
    accepted: accept,
    resource:
      typeof resource === "object" && resource !== null && !Array.isArray(resource)
        ? (resource as Json)
        : null,
    passedOver,
    value,
    asset,
    domain,
    askedSeconds,
    lifetimeSeconds,
  };
}

/**
 * Why these requirements will not be signed, or `null` when they will.
 *
 * Mirrors `Catalog.whyNot` on purpose — same shape, same reason: a button that reads
 * "Run for 0.01 USDC" and refuses every time promises something it knows it will not
 * do. This is for the refusals known before the click.
 *
 * The only reasons are the payee's, and that is the whole reason `Payee` is a union:
 * everything else that could go wrong threw during `checkRequirements`, so holding a
 * `PaymentRequirements` already means the chain, asset, domain, amount and window
 * are good. A changed payee and an unpinned one both refuse, each in its own words.
 */
export function whyNotSign(requirements: PaymentRequirements): string | null {
  const { payee } = requirements;
  return payee.kind === "known" ? null : payee.why;
}

/**
 * The authorization to send, and the digest to sign, together.
 *
 * 🔴 **Both at once, deliberately.** They are two views of one set of bytes: the
 * authorization is what goes in the `X-PAYMENT` header, the digest is what the
 * wallet signs. Returning them separately invites the failure this repo has already
 * named once — pairing `extData: A` with `extDataHash(B)` — where each half is
 * well-formed and together they authorise a payment nobody agreed to. Here that
 * would be a signature valid over an authorization the header does not contain.
 *
 * `nonce` and `nowSeconds` are parameters rather than read from the environment so
 * a test can state the instant and the bytes it is reasoning about. The default
 * nonce is a fresh 32 random bytes; see `randomNonce` for why it is not a counter.
 *
 * ⚠️ Refuses when `whyNotSign` has something to say, so a panel that forgets to ask
 * still cannot sign to an unrecognised payee. The check is cheap and the failure it
 * prevents is irreversible.
 */
export function authorizationFor(
  requirements: PaymentRequirements,
  from: string,
  nowSeconds: bigint,
  nonce: Uint8Array = randomNonce(),
): { readonly authorization: Authorization; readonly digest: bigint } {
  const refusal = whyNotSign(requirements);
  if (refusal) {
    throw new Error(`Nothing was signed. ${refusal}`);
  }
  const { validAfter, validBefore } = validityWindow(nowSeconds, requirements.lifetimeSeconds);
  const authorization: Authorization = {
    from,
    to: requirements.payee.address,
    value: requirements.value,
    validAfter,
    validBefore,
    nonce,
  };
  return { authorization, digest: authorizationDigest(requirements.domain, authorization) };
}
