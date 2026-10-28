/**
 * Coinbase CDP's x402 facilitator: the service that checks an x402 payment and settles it on
 * Base, so this app sells over x402 without holding a key of its own (the owner's choice,
 * 2026-09-30, over a server hot wallet that would pay the gas itself).
 *
 * Written from CDP's own sources, read 2026-09-30, not from memory:
 *   • base URL `https://api.cdp.coinbase.com/platform/v2/x402`, POST `/verify` and `/settle`
 *     (`CDP_FACILITATOR_URL`, cdp-sdk `src/x402/facilitator.ts`);
 *   • body `{ x402Version, paymentPayload, paymentRequirements }` for both (x402 core
 *     `HTTPFacilitatorClient`), answers `{ isValid, invalidReason?, payer? }` and
 *     `{ success, errorReason?, transaction, network, payer? }` (`types/facilitator.ts`);
 *   • auth `Authorization: Bearer <JWT>`, one JWT per request, bound to it by a `uris` claim of
 *     `"POST api.cdp.coinbase.com/platform/v2/x402/verify"` (cdp-sdk `auth/utils/jwt.ts`):
 *     claims `sub` = key id, `iss` = "cdp", `iat`/`nbf` = now, `exp` = now + 120; header `alg`,
 *     `kid` = key id, `typ` "JWT", `nonce` = 16 random bytes in hex. `alg` is EdDSA for an
 *     Ed25519 secret (base64 of 64 bytes: seed ‖ public key) and ES256 for an EC secret (PEM).
 *
 * WebCrypto signs both, so no JWT library is added. The keys are the server's
 * (`CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`, read by `vite.config.ts` from `.env.local`); nothing
 * here reaches the browser, and this file imports nothing from the app.
 */

export const CDP_FACILITATOR = "https://api.cdp.coinbase.com/platform/v2/x402";

export type CdpCredentials = { readonly keyId: string; readonly secret: string };

export type VerifyResponse = { readonly isValid: boolean; readonly invalidReason?: string; readonly invalidMessage?: string; readonly payer?: string };

export type SettleResponse = {
  readonly success: boolean;
  readonly errorReason?: string;
  readonly errorMessage?: string;
  readonly payer?: string;
  readonly transaction: string;
  readonly network: string;
};

/** What the API needs from a facilitator — CDP's in the app, a fake in the tests. */
export type Facilitator = {
  verify(paymentPayload: unknown, paymentRequirements: unknown): Promise<VerifyResponse>;
  settle(paymentPayload: unknown, paymentRequirements: unknown): Promise<SettleResponse>;
};

const b64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (text: string): string => b64url(new TextEncoder().encode(text));

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

/** The DER bytes inside a PEM block, and which kind of block it was. */
function pem(secret: string): { readonly label: string; readonly der: Uint8Array } | null {
  const m = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/.exec(secret.replace(/\\n/g, "\n"));
  return m ? { label: m[1]!, der: fromBase64(m[2]!.replace(/\s+/g, "")) } : null;
}

/** DER length octets. */
function derLength(n: number): number[] {
  return n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
}

/**
 * A SEC1 `EC PRIVATE KEY` wrapped as PKCS#8 for P-256 — the only EC form WebCrypto imports.
 * PrivateKeyInfo ::= SEQUENCE { INTEGER 0, SEQUENCE { id-ecPublicKey, prime256v1 }, OCTET STRING sec1 }.
 */
export function sec1ToPkcs8(sec1: Uint8Array): Uint8Array {
  const algorithm = [0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];
  const octets = [0x04, ...derLength(sec1.length), ...sec1];
  const body = [0x02, 0x01, 0x00, ...algorithm, ...octets];
  return Uint8Array.from([0x30, ...derLength(body.length), ...body]);
}

/** The signing key and its JOSE `alg`, from either secret form CDP issues. */
async function signingKey(secret: string): Promise<{ readonly alg: "EdDSA" | "ES256"; readonly key: CryptoKey }> {
  const block = pem(secret);
  if (block) {
    const pkcs8 = block.label === "EC PRIVATE KEY" ? sec1ToPkcs8(block.der) : block.der;
    const key = await crypto.subtle.importKey("pkcs8", new Uint8Array(pkcs8), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    return { alg: "ES256", key };
  }
  let raw: Uint8Array;
  try {
    raw = fromBase64(secret.trim());
  } catch {
    raw = new Uint8Array();
  }
  if (raw.length !== 64) {
    throw new Error("CDP_API_KEY_SECRET is neither an EC key in PEM form nor a base64 Ed25519 key of 64 bytes. Copy it again from the CDP portal.");
  }
  const jwk = { kty: "OKP", crv: "Ed25519", d: b64url(raw.subarray(0, 32)), x: b64url(raw.subarray(32)) };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
  return { alg: "EdDSA", key };
}

/** A CDP API JWT for one request: `method` on `host` + `path`, valid 120 seconds from `now`. */
export async function cdpJwt(creds: CdpCredentials, method: string, host: string, path: string, now: number = Date.now()): Promise<string> {
  const { alg, key } = await signingKey(creds.secret);
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const iat = Math.floor(now / 1000);
  const header = { alg, kid: creds.keyId, typ: "JWT", nonce };
  const claims = { sub: creds.keyId, iss: "cdp", uris: [`${method} ${host}${path}`], iat, nbf: iat, exp: iat + 120 };
  const input = `${b64urlText(JSON.stringify(header))}.${b64urlText(JSON.stringify(claims))}`;
  const algorithm = alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "Ed25519" };
  const signature = new Uint8Array(await crypto.subtle.sign(algorithm, key, new TextEncoder().encode(input)));
  return `${input}.${b64url(signature)}`;
}

/** CDP's facilitator, authenticated per request. Its refusals come back as values; only an unreadable answer throws. */
export function cdpFacilitator(creds: CdpCredentials, fetchImpl: typeof fetch = fetch, base: string = CDP_FACILITATOR): Facilitator {
  const url = new URL(base);
  const call = async (op: "verify" | "settle", paymentPayload: unknown, paymentRequirements: unknown): Promise<unknown> => {
    const path = `${url.pathname.replace(/\/$/, "")}/${op}`;
    const jwt = await cdpJwt(creds, "POST", url.host, path);
    let res: Response;
    try {
      res = await fetchImpl(`${url.origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements }),
      });
    } catch {
      throw new Error(`Coinbase's x402 facilitator could not be reached to ${op} the payment.`);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new Error(`Coinbase's x402 facilitator answered ${res.status} with something that is not JSON when asked to ${op}.`);
    }
    return body;
  };
  return {
    async verify(paymentPayload, paymentRequirements) {
      const b = (await call("verify", paymentPayload, paymentRequirements)) as Partial<VerifyResponse> | null;
      if (typeof b !== "object" || b === null || typeof b.isValid !== "boolean") throw new Error("Coinbase's x402 facilitator gave no verdict on the payment.");
      return b as VerifyResponse;
    },
    async settle(paymentPayload, paymentRequirements) {
      const b = (await call("settle", paymentPayload, paymentRequirements)) as Partial<SettleResponse> | null;
      if (typeof b !== "object" || b === null || typeof b.success !== "boolean") throw new Error("Coinbase's x402 facilitator gave no settlement result.");
      return { transaction: "", network: "", ...b } as SettleResponse;
    },
  };
}
