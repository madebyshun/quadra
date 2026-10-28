import { describe, expect, it, vi } from "vitest";
import {
  allowOrigins,
  anyPublicHttps,
  forward,
  FORWARD_PATH,
  FORWARD_REQUEST_HEADER,
  FORWARDED_MARK,
  FORWARDED_VALUE,
} from "@/server/forward";

const TARGET = "https://x402uselessfacts.vercel.app/api/useless-fact";

function asking(target: string | null, init: RequestInit & { mark?: boolean } = {}): Request {
  const url = target === null ? `http://app.test${FORWARD_PATH}` : `http://app.test${FORWARD_PATH}?url=${encodeURIComponent(target)}`;
  const headers = new Headers(init.headers);
  if (init.mark !== false) headers.set(FORWARD_REQUEST_HEADER, "1");
  return new Request(url, { ...init, headers });
}

/** A fake upstream that records what it was sent and answers as told. */
function upstream(answer: Response | Error) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    if (answer instanceof Error) throw answer;
    return answer;
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

describe("what it refuses before touching the network", () => {
  it("refuses a caller that did not send the forward header — the cross-site defence", async () => {
    const { seen, fetchImpl } = upstream(new Response("{}"));
    const res = await forward(asking(TARGET, { mark: false }), anyPublicHttps, fetchImpl);
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatch(/Send x-forward: 1/);
    expect(seen).toEqual([]);
  });

  it("forwards GET and POST only", async () => {
    const { fetchImpl } = upstream(new Response("{}"));
    const res = await forward(asking(TARGET, { method: "PUT", body: "x" }), anyPublicHttps, fetchImpl);
    expect(res.status).toBe(405);
  });

  it("needs a target, and a target that parses", async () => {
    const { fetchImpl } = upstream(new Response("{}"));
    expect(await errorOf(await forward(asking(null), anyPublicHttps, fetchImpl))).toMatch(/\?url=/);
    expect(await errorOf(await forward(asking("not a url"), anyPublicHttps, fetchImpl))).toMatch(/is not a URL/);
  });

  it("stamps its own refusals too, so the app can tell them from a static host", async () => {
    const res = await forward(asking(null), anyPublicHttps, upstream(new Response("")).fetchImpl);
    expect(res.headers.get(FORWARDED_MARK)).toBe(FORWARDED_VALUE);
  });
});

describe("the development policy", () => {
  const verdict = (url: string) => anyPublicHttps(new URL(url));

  it("allows a public https host", () => {
    expect(verdict(TARGET)).toBeNull();
  });

  it("refuses http, credentials, and every private or local name", () => {
    expect(verdict("http://example.com/")).toMatch(/Only https/);
    expect(verdict("https://user:pw@example.com/")).toMatch(/credentials/);
    for (const host of [
      "localhost", "api.localhost", "printer.local", "db.internal", "127.0.0.1", "10.1.2.3",
      "192.168.0.1", "172.16.0.1", "172.31.255.255", "169.254.169.254", "0.0.0.0", "[::1]",
    ]) {
      expect(verdict(`https://${host}/x`), host).toMatch(/not a public host/);
    }
  });

  it("does not mistake a public 172.x outside the private block for a private one", () => {
    expect(verdict("https://172.32.0.1/")).toBeNull();
  });
});

describe("the production shape: an allowlist", () => {
  const policy = allowOrigins(["https://x402uselessfacts.vercel.app"]);

  it("allows exactly the listed origins", () => {
    expect(policy(new URL(TARGET))).toBeNull();
    expect(policy(new URL("https://x402.ottoai.services/crypto-news"))).toMatch(/not on this forwarder's list/);
  });

  it("still applies the public-https rule to a listed origin", () => {
    expect(allowOrigins(["http://x402uselessfacts.vercel.app"])(new URL("http://x402uselessfacts.vercel.app/"))).toMatch(/Only https/);
  });

  it("is enforced by forward itself", async () => {
    const { seen, fetchImpl } = upstream(new Response("{}"));
    const res = await forward(asking("https://x402.ottoai.services/crypto-news"), policy, fetchImpl);
    expect(res.status).toBe(403);
    expect(seen).toEqual([]);
  });
});

describe("what travels", () => {
  it("sends only the x402 headers, never cookies or authorization, and does not follow redirects", async () => {
    const { seen, fetchImpl } = upstream(new Response("{}"));
    await forward(
      asking(TARGET, {
        headers: {
          accept: "application/json",
          "payment-signature": "eyJ4",
          "x-payment": "eyJ5",
          cookie: "session=secret",
          authorization: "Bearer secret",
        },
      }),
      anyPublicHttps,
      fetchImpl,
    );
    const sent = new Headers(seen[0]?.init.headers);
    expect(seen[0]?.url).toBe(TARGET);
    expect(sent.get("payment-signature")).toBe("eyJ4");
    expect(sent.get("x-payment")).toBe("eyJ5");
    expect(sent.get("accept")).toBe("application/json");
    expect(sent.get("cookie")).toBeNull();
    expect(sent.get("authorization")).toBeNull();
    expect(seen[0]?.init.redirect).toBe("manual");
    expect(seen[0]?.init.body).toBeNull();
  });

  it("carries a POST body through", async () => {
    const { seen, fetchImpl } = upstream(new Response("{}"));
    await forward(
      asking(TARGET, { method: "POST", body: '{"q":1}', headers: { "content-type": "application/json" } }),
      anyPublicHttps,
      fetchImpl,
    );
    expect(seen[0]?.init.method).toBe("POST");
    expect(seen[0]?.init.body).toBe('{"q":1}');
  });

  it("returns the status, the body and the x402 headers, and drops the rest", async () => {
    const { fetchImpl } = upstream(
      new Response("{}", {
        status: 402,
        headers: { "payment-required": "eyJh", "set-cookie": "tracker=1", "content-type": "application/json" },
      }),
    );
    const res = await forward(asking(TARGET), anyPublicHttps, fetchImpl);
    expect(res.status).toBe(402);
    expect(await res.text()).toBe("{}");
    expect(res.headers.get("payment-required")).toBe("eyJh");
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get(FORWARDED_MARK)).toBe(FORWARDED_VALUE);
  });

  /** `new Response("", { status: 204 })` throws; a 204 must come back bodiless. */
  it("passes a no-content answer back without a body", async () => {
    const res = await forward(asking(TARGET), anyPublicHttps, upstream(new Response(null, { status: 204 })).fetchImpl);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("answers 502 naming the origin when the target cannot be reached", async () => {
    const res = await forward(asking(TARGET), anyPublicHttps, upstream(new Error("ECONNREFUSED")).fetchImpl);
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toBe("Could not reach https://x402uselessfacts.vercel.app: ECONNREFUSED");
  });

  it("says so plainly when the failure was not even an Error", async () => {
    const fetchImpl = (() => Promise.reject("socket hang up")) as unknown as typeof fetch;
    expect(await errorOf(await forward(asking(TARGET), anyPublicHttps, fetchImpl))).toMatch(/socket hang up/);
  });
});
