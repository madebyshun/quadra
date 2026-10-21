/**
 * Turning checked requirements into the `X-PAYMENT` header a 402 will accept.
 *
 * ── The line this module sits on ──────────────────────────────────────────────────
 * It asks a wallet to sign; it never signs. No key, no secp256k1, no `eth_sign` —
 * the same boundary `lib/wallet.ts`, `lib/eip712.ts` and `lib/requirements.ts` keep
 * (hard rule 5). What is new here is that this is the module that actually *spends*
 * something, so the question it has to keep answering is narrower than "is this
 * correct": **is the thing the user was shown the thing the wallet was asked to sign,
 * and is that the thing the header carries?** Three views of one authorization, and
 * every divergence between them is invisible to the user and irreversible.
 *
 * ── The wire format is MEASURED, not read off a spec ─────────────────────────────
 * 🔴 The x402 v2 envelope below was taken from the only client of this payee that has
 * demonstrably been paid — the upstream repo's own Hub view, read on 2026-09-28 for
 * its wire format and nothing else. That matters because the spec and the
 * facilitator's schema are not the same document, and the difference is not academic:
 * upstream's own code carries a 🔴 recording that its `accepted` key was missing until
 * 2026-09-26, that native tools never noticed because its *server* re-injects the key
 * before calling the facilitator, and that an external facilitator answered
 * `400 invalid_payload — accepted: expected object, received undefined`. So a header
 * that works against one endpoint proves very little about the format, and the shape
 * here is deliberately the full one including `accepted`, even though this build's
 * payee would patch it in for us. Relying on the server to fix our payload is how that
 * bug survived for months.
 *
 * ── What is deliberately NOT here ────────────────────────────────────────────────
 * 🔴 **No `{v, r, s}` split.** The plan in `TASKS.md` said to split the signature, and
 * measuring says otherwise: the working client passes the packed 65-byte hex string
 * from `signTypedData` straight into `payload.signature`, and the facilitator recovers
 * the signer. Splitting it would produce three fields nothing reads, and the
 * `v`-normalisation question (27/28 versus 0/1) that a split invites is a real source
 * of silently-invalid signatures. There is nothing to split.
 *
 * 🔴 **No settlement read, and no POST.** Building the header is where this stops.
 * Sending it is the adapter's job, because the adapter is what owns the forwarder.
 */

import { BASE } from "@/config/chain";
import { formatAmount } from "@/lib/amount";
import {
  AUTHORIZATION_TYPE,
  DOMAIN_TYPE,
  type Authorization,
  type Eip712Domain,
} from "@/lib/eip712";
import { toHex } from "@/lib/keccak";
import { toBase64Utf8 } from "@/lib/x402http";
import type { PaymentRequirements } from "@/lib/requirements";
import type { Eip1193Provider } from "@/lib/wallet";

/* ── the typed-data types, derived from the strings the typehashes are made of ──── */

/** One EIP-712 struct member, in the shape `eth_signTypedData_v4` expects. */
export type TypedDataField = { readonly name: string; readonly type: string };

/** Everything `eth_signTypedData_v4` is handed, before it is stringified. */
export type TypedData = {
  readonly types: Readonly<Record<string, readonly TypedDataField[]>>;
  readonly primaryType: string;
  readonly domain: Readonly<Record<string, string | number>>;
  readonly message: Readonly<Record<string, string>>;
};

const TYPE_STRING = /^([A-Za-z_$][\w$]*)\((.*)\)$/;

/**
 * Split `"Name(type a,type b)"` into its struct name and its members.
 *
 * 🔴 **This exists so there is exactly one list of members in the codebase.** EIP-712
 * hashes `keccak256("TransferWithAuthorization(address from,…)")` and the wallet hashes
 * the `types` array it is given — if those two describe different structs, or the same
 * fields in a different order, the wallet produces a valid signature over something
 * this build never computed and never displayed. The fields are therefore *parsed out
 * of* `AUTHORIZATION_TYPE`, the same string `AUTHORIZATION_TYPEHASH` is the keccak of,
 * rather than written out a second time next to it. A second copy would agree on the
 * day it was written, which is the only day anybody checks.
 *
 * Refuses anything it cannot parse instead of returning a partial list: an empty or
 * short `types` entry is a signature over fewer fields, and a wallet will sign it
 * without complaint.
 */
export function typedDataType(type: string): {
  readonly name: string;
  readonly fields: readonly TypedDataField[];
} {
  const shape = TYPE_STRING.exec(type);
  if (shape === null) {
    throw new Error(`Not an EIP-712 type string: ${JSON.stringify(type)}.`);
  }
  const name = shape[1] as string;
  const body = shape[2] as string;
  const fields = body.split(",").map((member) => {
    const parts = member.trim().split(/\s+/);
    if (parts.length !== 2) {
      throw new Error(
        `"${member}" in ${name} is not a "<type> <name>" pair. A member this build cannot ` +
          "read is a member a wallet would sign anyway, so nothing is signed.",
      );
    }
    return { type: parts[0] as string, name: parts[1] as string };
  });
  return { name, fields };
}

const DOMAIN = typedDataType(DOMAIN_TYPE);
const AUTHORIZATION = typedDataType(AUTHORIZATION_TYPE);

/**
 * The `types` map, with `EIP712Domain` present.
 *
 * ⚠️ `EIP712Domain` is required in `types` for `eth_signTypedData_v4` even though it is
 * never the `primaryType`. Omitting it is rejected by some wallets and silently
 * tolerated by others, which is the worse half: the tolerant ones supply their own
 * domain type, and if theirs differs from `DOMAIN_TYPE` by one member the domain
 * separator changes and the signature verifies against nothing.
 */
const TYPES: Readonly<Record<string, readonly TypedDataField[]>> = {
  [DOMAIN.name]: DOMAIN.fields,
  [AUTHORIZATION.name]: AUTHORIZATION.fields,
};

/* ── the typed data for one authorization ─────────────────────────────────────── */

/**
 * Every `uint256` as a decimal string, never a JSON number.
 *
 * A `value` of 1 USDC is 1e6 and fits; a `validBefore` fits; but `JSON.stringify` of a
 * number is lossy from 2^53 and this repo deals in `bigint` precisely so that nothing
 * silently rounds. A string is exact at every magnitude and is what the working client
 * sends. There is no branch here on "is it small enough" — the point of the rule is
 * that the size never has to be considered.
 */
const uint = (value: bigint): string => value.toString(10);

/**
 * What the wallet will be asked to sign, built from one `Authorization`.
 *
 * 🔴 Takes the *authorization object*, not its fields. `authorizationFor` returns the
 * authorization and its digest together, and its own comment gives the reason: two
 * views of one set of bytes, assembled apart, is how `extData: A` gets paired with
 * `extDataHash(B)`. This is the third view, so it takes the same object rather than
 * re-deriving anything — passing `to` and `value` separately would make a header that
 * pays a different payee than the prompt showed a *possible* program.
 */
export function typedDataFor(domain: Eip712Domain, auth: Authorization): TypedData {
  return {
    types: TYPES,
    primaryType: AUTHORIZATION.name,
    domain: {
      name: domain.name,
      version: domain.version,
      chainId: domain.chainId,
      verifyingContract: domain.verifyingContract,
    },
    message: {
      from: auth.from,
      to: auth.to,
      value: uint(auth.value),
      validAfter: uint(auth.validAfter),
      validBefore: uint(auth.validBefore),
      nonce: toHex(auth.nonce),
    },
  };
}

/* ── asking the wallet ────────────────────────────────────────────────────────── */

/** 65 bytes: r, s, and the recovery byte, as `0x` + 130 hex characters. */
export const SIGNATURE_HEX_LENGTH = 132;

const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

/**
 * The wallet's answer, checked to be a signature at all.
 *
 * ⚠️ Checked because an unchecked one travels a long way before failing. A wallet that
 * answers `null`, or `{}`, or a 64-byte signature missing its recovery byte, produces a
 * header that is well-formed JSON and settles nothing — and the error comes back from a
 * facilitator, about a field, with no hint that the local wallet is what misbehaved.
 * Refusing here names the wallet.
 *
 * ⚠️ It checks the *shape* and cannot check the *signer*: recovering an address needs
 * secp256k1, which this repo does not have and will not hand-roll. So this says "that is
 * a signature", never "that is your signature over what we showed you". The guarantee
 * that it covers the right bytes comes from structure — one `Authorization` feeding the
 * digest, the prompt and the header — not from verification here.
 */
export function parseSignature(raw: unknown): string {
  if (typeof raw !== "string" || !SIGNATURE.test(raw)) {
    const saw = typeof raw === "string" ? `${raw.length} characters` : typeof raw;
    throw new Error(
      `Your wallet returned ${saw} where a 65-byte signature was expected, so nothing can be ` +
        "paid with it. Nothing was charged. Reload and try again; if it persists, the wallet " +
        "extension is misbehaving.",
    );
  }
  return raw;
}

const USER_REJECTED = 4001;

function rejected(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code: unknown = (err as { code?: unknown }).code;
  return code === USER_REJECTED || code === String(USER_REJECTED);
}

/**
 * Ask the connected wallet to sign one authorization.
 *
 * `eth_signTypedData_v4` and nothing else. The JSON is stringified by this function
 * rather than passed as an object, because that is what the method's second parameter
 * is specified to be and wallets differ on whether they will accept an object — and the
 * one that accepts both is not the one to design for.
 *
 * 🔴 The account is passed rather than re-read from the provider. `readWallet` already
 * measured it, and asking again here would open a window where the user switches
 * accounts between the digest being built and the prompt being shown: the prompt would
 * say one account, the authorization's `from` would say another, and the signature would
 * be over an authorization from an account that did not agree to it.
 */
export async function signAuthorization(
  provider: Eip1193Provider,
  domain: Eip712Domain,
  auth: Authorization,
): Promise<string> {
  const typedData = typedDataFor(domain, auth);
  let answer: unknown;
  try {
    answer = await provider.request({
      method: "eth_signTypedData_v4",
      params: [auth.from, JSON.stringify(typedData)],
    });
  } catch (err) {
    if (rejected(err)) {
      throw new Error(
        "You declined the signature, so nothing was paid and nothing was charged. The " +
          "authorization was never created.",
      );
    }
    const said = err instanceof Error && err.message !== "" ? ` (${err.message})` : "";
    throw new Error(
      `Your wallet did not sign the payment${said}. Nothing was charged. An unsigned ` +
        "authorization cannot move any USDC, so it is safe to try again.",
    );
  }
  return parseSignature(answer);
}

/* ── the header ───────────────────────────────────────────────────────────────── */

/** The envelope version this build writes, and the one it was measured against. */
export const X402_VERSION = 2;

/** The only scheme this build knows how to produce. */
export const SCHEME = "exact";

/**
 * Base64 of ASCII, which is all this header ever contains.
 *
 * ⚠️ `btoa` throws on any code point above 255, and that is a feature here rather than
 * a limitation to work around: every field below is an address, a decimal string, a hex
 * string, or `extra.{name,version}` compared against `USDC_DOMAIN` by
 * `checkRequirements`. A non-ASCII byte reaching this point would mean one of those
 * checks did not happen, and a `TextEncoder` dance that encoded it faithfully would
 * carry the problem to the facilitator instead of stopping it here.
 */
function base64(json: string): string {
  return btoa(json);
}

/**
 * The `X-PAYMENT` header value for one signed authorization.
 *
 * 🔴 **`accepted` mirrors the 402 field for field, and `network` is CAIP-2.** Both are
 * measured (see the module header, and `lib/requirements.ts` for the 402 itself):
 * `network` is `"eip155:8453"` and not the bare chain number, `asset` is the USDC
 * address, `amount` is base units as a decimal string, and `extra` is
 * `{ name, version }`. `accepted.maxTimeoutSeconds` is `askedSeconds` — upstream's own
 * figure — while the signed `validBefore` inside `authorization` is the longer window;
 * see `SETTLEMENT_SLACK_SECONDS` for why those two differ on purpose and why sending
 * the signed figure here would be the wrong one of the two.
 *
 * ⚠️ Every value comes from `requirements` and `auth`, and nothing is recomputed.
 * `to` is `auth.to`, not `requirements.payee.address`, even though `authorizationFor`
 * guarantees they are equal today: the header must carry what was *signed*, and reading
 * the payee from the requirements again would mean a future change that touched only
 * one of them produces a signature and a header that disagree — the single failure mode
 * a wallet prompt cannot warn a user about, because the prompt showed the signed one.
 */
export function paymentHeader(
  requirements: PaymentRequirements,
  auth: Authorization,
  signature: string,
): string {
  if (requirements.payee.kind !== "known") {
    throw new Error(`Nothing was paid. ${requirements.payee.why}`);
  }
  const network = `eip155:${BASE.id}`;
  return base64(
    JSON.stringify({
      x402Version: X402_VERSION,
      scheme: SCHEME,
      network,
      accepted: {
        scheme: SCHEME,
        network,
        asset: requirements.asset.address,
        amount: uint(requirements.value),
        payTo: requirements.payee.address,
        maxTimeoutSeconds: Number(requirements.askedSeconds),
        extra: { name: requirements.domain.name, version: requirements.domain.version },
      },
      payload: {
        signature: parseSignature(signature),
        authorization: {
          from: auth.from,
          to: auth.to,
          value: uint(auth.value),
          validAfter: uint(auth.validAfter),
          validBefore: uint(auth.validBefore),
          nonce: toHex(auth.nonce),
        },
      },
    }),
  );
}

/**
 * The standard x402 v2 `PAYMENT-SIGNATURE` value: base64 of a PaymentPayload.
 *
 * A sibling of `paymentHeader`, not a replacement. `paymentHeader` is what BlueAgent was
 * measured to accept as `X-Payment` and stays byte-for-byte what it was. This one is
 * the spec's shape, for every other server: `{ x402Version, resource?, accepted, payload }`.
 *
 * 🔴 `accepted` is the server's own `accepts` entry, VERBATIM (`requirements.accepted`),
 * not rebuilt from checked fields — see that field's note for the server that carries
 * extra keys a rebuild would drop. The money-deciding fields in it are the ones
 * `checkRequirements` checked on that very object, and the `payload.authorization` below
 * is what was signed, so the two cannot describe different payments.
 *
 * `resource` is echoed when the 402 carried one. UTF-8 base64 because both blocks are the
 * server's own text (see `lib/x402http.ts`), unlike `paymentHeader`, whose fields are all
 * checked ASCII.
 */
export function paymentSignatureHeader(
  requirements: PaymentRequirements,
  auth: Authorization,
  signature: string,
): string {
  if (requirements.payee.kind !== "known") {
    throw new Error(`Nothing was paid. ${requirements.payee.why}`);
  }
  return toBase64Utf8(
    JSON.stringify({
      x402Version: X402_VERSION,
      ...(requirements.resource === null ? {} : { resource: requirements.resource }),
      accepted: requirements.accepted,
      payload: {
        signature: parseSignature(signature),
        authorization: {
          from: auth.from,
          to: auth.to,
          value: uint(auth.value),
          validAfter: uint(auth.validAfter),
          validBefore: uint(auth.validBefore),
          nonce: toHex(auth.nonce),
        },
      },
    }),
  );
}

/**
 * What a person should read before they approve a signature, as plain sentences.
 *
 * Here rather than in the panel because every line is derived from the same
 * `Authorization` the wallet is handed — the third view again — and because the panel is
 * the wrong place to own the wording of an irreversible thing.
 *
 * ⚠️ **No `checkAddress` call, deliberately.** The first draft ran the payee through it
 * so a checksummed address could be labelled verified. That is theatre for this field:
 * `lib/requirements.ts` records that both upstream's `payTo` and the constant it is
 * compared against are all-lowercase, so EIP-55 returns `unchecked` and has nothing to
 * say. The check that actually happened is the comparison against the known-payee
 * constant, so that is what the sentence claims. A second, weaker check displayed next
 * to it would read as corroboration.
 *
 * The window is stated as a duration rather than as a Unix second, because the exposure
 * is "how long is this spendable" and nobody reads an epoch. `validBefore` itself is in
 * the header and in the wallet's own prompt for anyone who wants the raw number.
 *
 * ⚠️ The duration comes from `requirements.lifetimeSeconds` and **cannot** be computed
 * from the authorization. The obvious `validBefore - validAfter` is wrong, and wrong in
 * the direction that looks plausible: `validAfter` is 0 by design (see `validityWindow`
 * — a zero lower bound cannot be early), so that subtraction returns the absolute epoch
 * second and would have printed a window of about 1.7 billion seconds as though it were
 * a duration. **An authorization does not record when it was signed**, which is a real
 * consequence of the `validAfter: 0` decision: the only place the duration exists is the
 * requirements it was built from.
 */
export function signingSummary(
  requirements: PaymentRequirements,
  auth: Authorization,
): readonly string[] {
  return [
    `Paying ${formatAmount(auth.value, requirements.asset.decimals)} ` +
      `${requirements.asset.symbol} on ${BASE.name} — ${uint(auth.value)} base units exactly.`,
    `To ${auth.to}, which matches the payee this build has recorded for ` +
      `${requirements.toolId}. That comparison is the only check this address has.`,
    `Spendable for ${uint(requirements.lifetimeSeconds)} seconds, worthless after that. ` +
      "Anyone holding it can redeem it once before then.",
  ];
}
