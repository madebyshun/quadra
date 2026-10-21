// @vitest-environment node
import { createPrivateKey, generateKeyPairSync, verify, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CDP_FACILITATOR, cdpFacilitator, cdpJwt, sec1ToPkcs8 } from "@/server/cdp";

/**
 * The CDP facilitator client. Keys are generated here, so every JWT is checked the way CDP
 * would check it: against the public key, with Node's own crypto rather than this module's.
 */

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

function ed25519(): { secret: string; publicKey: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  // CDP's form: base64 of the 32-byte seed followed by the 32-byte public key
  const secret = Buffer.from([...Buffer.from(jwk.d!, "base64url"), ...Buffer.from(jwk.x!, "base64url")]).toString("base64");
  return { secret, publicKey };
}

function ec(type: "pkcs8" | "sec1"): { secret: string; publicKey: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { secret: privateKey.export({ type, format: "pem" }).toString(), publicKey };
}

function checks(jwt: string, publicKey: KeyObject, alg: "EdDSA" | "ES256"): boolean {
  const [h, p, s] = jwt.split(".") as [string, string, string];
  const data = new Uint8Array(Buffer.from(`${h}.${p}`));
  const sig = new Uint8Array(Buffer.from(s, "base64url"));
  return alg === "EdDSA" ? verify(null, data, publicKey, sig) : verify("sha256", data, { key: publicKey, dsaEncoding: "ieee-p1363" }, sig);
}

describe("CDP JWTs", () => {
  const NOW = 1_790_000_000_000;

  it("signs with an Ed25519 key in CDP's base64 form, bound to one request", async () => {
    const { secret, publicKey } = ed25519();
    const jwt = await cdpJwt({ keyId: "key-1", secret }, "POST", "api.cdp.coinbase.com", "/platform/v2/x402/verify", NOW);
    const [h, p] = jwt.split(".") as [string, string];
    expect(decode(h)).toMatchObject({ alg: "EdDSA", kid: "key-1", typ: "JWT" });
    expect(decode(h).nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(decode(p)).toEqual({
      sub: "key-1",
      iss: "cdp",
      uris: ["POST api.cdp.coinbase.com/platform/v2/x402/verify"],
      iat: NOW / 1000,
      nbf: NOW / 1000,
      exp: NOW / 1000 + 120,
    });
    expect(checks(jwt, publicKey, "EdDSA")).toBe(true);
  });

  it("signs ES256 with an EC key as PKCS#8 PEM, as SEC1 PEM, or with its newlines escaped", async () => {
    for (const type of ["pkcs8", "sec1"] as const) {
      const { secret, publicKey } = ec(type);
      const jwt = await cdpJwt({ keyId: "k", secret }, "POST", "h", "/p");
      expect(decode(jwt.split(".")[0]!).alg).toBe("ES256");
      expect(checks(jwt, publicKey, "ES256"), type).toBe(true);
      // a .env value keeps a PEM on one line with literal \n
      const escaped = secret.replace(/\n/g, "\\n");
      expect(checks(await cdpJwt({ keyId: "k", secret: escaped }, "POST", "h", "/p"), publicKey, "ES256")).toBe(true);
    }
  });

  it("wraps SEC1 as a PKCS#8 key that is the same key", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const sec1 = new Uint8Array(privateKey.export({ type: "sec1", format: "der" }));
    const wrapped = createPrivateKey({ key: Buffer.from(sec1ToPkcs8(sec1)), format: "der", type: "pkcs8" });
    expect(wrapped.export({ format: "jwk" })).toEqual(privateKey.export({ format: "jwk" }));
  });

  it("names a secret it cannot use, instead of signing with nothing", async () => {
    await expect(cdpJwt({ keyId: "k", secret: "not a key" }, "POST", "h", "/p")).rejects.toThrow(/CDP_API_KEY_SECRET is neither/);
    await expect(cdpJwt({ keyId: "k", secret: Buffer.alloc(32).toString("base64") }, "POST", "h", "/p")).rejects.toThrow(/64 bytes/);
    await expect(cdpJwt({ keyId: "k", secret: "%%%" }, "POST", "h", "/p")).rejects.toThrow(/CDP_API_KEY_SECRET/);
  });

  it("writes a DER length in one, two or three bytes as it needs", () => {
    expect(sec1ToPkcs8(new Uint8Array(90)).subarray(0, 2)).toEqual(new Uint8Array([0x30, 0x74]));
    expect(sec1ToPkcs8(new Uint8Array(110)).subarray(0, 2)).toEqual(new Uint8Array([0x30, 0x81]));
    expect(sec1ToPkcs8(new Uint8Array(300)).subarray(0, 2)).toEqual(new Uint8Array([0x30, 0x82]));
  });
});

describe("the CDP facilitator", () => {
  const { secret, publicKey } = ed25519();
  const creds = { keyId: "key-9", secret };
  const payload = { x402Version: 2, accepted: { amount: "5000" }, payload: {} };
  const requirements = { amount: "5000" };

  function fake(answer: (url: string) => Response | Promise<Response>) {
    const seen: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return answer(url);
    }) as unknown as typeof fetch;
    return { seen, impl };
  }

  it("verifies and settles at CDP's own paths, each with its own JWT", async () => {
    const { seen, impl } = fake((url) =>
      url.endsWith("/verify")
        ? new Response(JSON.stringify({ isValid: true, payer: "0xabc" }))
        : new Response(JSON.stringify({ success: true, transaction: "0x12", network: "eip155:8453" })),
    );
    const f = cdpFacilitator(creds, impl);
    expect(await f.verify(payload, requirements)).toEqual({ isValid: true, payer: "0xabc" });
    expect(await f.settle(payload, requirements)).toEqual({ success: true, transaction: "0x12", network: "eip155:8453" });
    expect(seen.map((s) => s.url)).toEqual([`${CDP_FACILITATOR}/verify`, `${CDP_FACILITATOR}/settle`]);
    for (const [i, op] of (["verify", "settle"] as const).entries()) {
      const headers = seen[i]!.init.headers as Record<string, string>;
      const jwt = headers.authorization!.replace(/^Bearer /, "");
      expect(decode(jwt.split(".")[1]!).uris).toEqual([`POST api.cdp.coinbase.com/platform/v2/x402/${op}`]);
      expect(checks(jwt, publicKey, "EdDSA")).toBe(true);
      expect(JSON.parse(String(seen[i]!.init.body))).toEqual({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements });
    }
  });

  it("passes CDP's refusals on as values, and fills what a failed settlement leaves out", async () => {
    const { impl } = fake((url) =>
      url.endsWith("/verify")
        ? new Response(JSON.stringify({ isValid: false, invalidReason: "insufficient_funds" }), { status: 400 })
        : new Response(JSON.stringify({ success: false, errorReason: "invalid_payload" }), { status: 400 }),
    );
    const f = cdpFacilitator(creds, impl, "https://staging.example/platform/v2/x402/");
    expect(await f.verify(payload, requirements)).toEqual({ isValid: false, invalidReason: "insufficient_funds" });
    expect(await f.settle(payload, requirements)).toEqual({ success: false, errorReason: "invalid_payload", transaction: "", network: "" });
  });

  it("says when CDP cannot be reached, answers with something that is not JSON, or gives no verdict", async () => {
    const down = cdpFacilitator(creds, fake(() => Promise.reject(new TypeError("offline"))).impl);
    await expect(down.verify(payload, requirements)).rejects.toThrow("Coinbase's x402 facilitator could not be reached to verify the payment.");
    const html = cdpFacilitator(creds, fake(() => new Response("<html>", { status: 502 })).impl);
    await expect(html.settle(payload, requirements)).rejects.toThrow("answered 502 with something that is not JSON when asked to settle");
    const empty = cdpFacilitator(creds, fake(() => new Response("null")).impl);
    await expect(empty.verify(payload, requirements)).rejects.toThrow("gave no verdict");
    await expect(empty.settle(payload, requirements)).rejects.toThrow("gave no settlement result");
    const odd = cdpFacilitator(creds, fake(() => new Response(JSON.stringify({ isValid: "yes", success: "yes" }))).impl);
    await expect(odd.verify(payload, requirements)).rejects.toThrow("gave no verdict");
    await expect(odd.settle(payload, requirements)).rejects.toThrow("gave no settlement result");
    expect(typeof cdpFacilitator(creds)).toBe("object");
  });
});
