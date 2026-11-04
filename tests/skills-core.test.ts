import { describe, expect, it, vi } from "vitest";
import { BASE } from "@/config/chain";
import { ethCall, getJson, hexData, quantity, rpc, RPC_ENDPOINTS, RpcRefusal } from "@/skills/http";
import { bigOf, isObj, listOf, numOf, objAt, strOf } from "@/skills/json";
import { explorer, price, short, tokenAmount, usd } from "@/skills/format";
import { row } from "@/skills/types";
import { DOWN, json, net, RpcError, urls, useNet } from "./net";

useNet();

const URL_ = "https://example.test/thing";

describe("getJson", () => {
  it("returns the body", async () => {
    net({ get: urls({ [URL_]: { a: 1 } }) });
    expect(await getJson("Svc", URL_)).toEqual({ a: 1 });
  });

  it("asks for JSON", async () => {
    let accept: string | null = null;
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      accept = new Headers(init?.headers).get("accept");
      return json({});
    });
    await getJson("Svc", URL_);
    expect(accept).toBe("application/json");
  });

  /** "No such thing" is an answer, and a skill turns it into a sentence of its own. */
  it("reads a 404 as null, not as an outage", async () => {
    net({ get: urls({ [URL_]: json({ message: "Not found" }, 404) }) });
    expect(await getJson("Svc", URL_)).toBeNull();
  });

  it("names the service when it cannot be reached", async () => {
    net({ get: urls({ [URL_]: DOWN }) });
    await expect(getJson("Blockscout", URL_)).rejects.toThrow("Blockscout could not be reached. Nothing was read from it.");
  });

  /** MEASURED: Blockscout's holder list for USDC came back 524. */
  it("calls a gateway timeout a timeout, with what to try instead", async () => {
    for (const status of [504, 524]) {
      net({ get: urls({ [URL_]: json({}, status) }) });
      await expect(getJson("Blockscout", URL_)).rejects.toThrow(/Blockscout timed out on this query — it may be too large/);
    }
  });

  it("names any other failing status", async () => {
    net({ get: urls({ [URL_]: json({}, 500) }) });
    await expect(getJson("GoPlus", URL_)).rejects.toThrow("GoPlus answered 500. Nothing was read from it.");
  });

  it("refuses a body that is not JSON", async () => {
    net({ get: urls({ [URL_]: new Response("<html>", { status: 200 }) }) });
    await expect(getJson("DexScreener", URL_)).rejects.toThrow("DexScreener answered with something that is not JSON.");
  });
});

describe("rpc", () => {
  it("tries Base's own endpoint first, then the fallback", () => {
    expect(RPC_ENDPOINTS).toEqual([BASE.rpc, BASE.rpcFallback]);
  });

  it("returns the result, sending the method and params", async () => {
    const calls = net({ rpc: (m, p) => (m === "eth_getBalance" && p[0] === "0xabc" ? "0x10" : undefined) });
    expect(await rpc("eth_getBalance", ["0xabc", "latest"])).toBe("0x10");
    expect(calls).toEqual([{ url: BASE.rpc, rpc: "eth_getBalance" }]);
  });

  it("sends no params when given none", async () => {
    let params: unknown = "unset";
    net({ rpc: (_m, p) => ((params = p), "0x1") });
    await rpc("eth_gasPrice");
    expect(params).toEqual([]);
  });

  /** MEASURED: mainnet.base.org answered 429 to a burst of a few eth_calls. */
  it("moves to the fallback on a rate limit, a 5xx or an unreachable endpoint", async () => {
    for (const first of [json({}, 429), json({}, 502), DOWN]) {
      const calls = net({ rpc: (_m, _p, endpoint) => (endpoint === BASE.rpc ? first : "0x2") });
      expect(await rpc("eth_blockNumber")).toBe("0x2");
      expect(calls.map((c) => c.url)).toEqual([BASE.rpc, BASE.rpcFallback]);
    }
  });

  /** MEASURED 2026-10-14: publicnode answers eth_getTransactionReceipt 403 "Archive requests require a personal token". */
  it("moves to the fallback when the first endpoint refuses the method with a 403", async () => {
    const calls = net({
      rpc: (_m, _p, endpoint) => (endpoint === BASE.rpc ? new Response("Archive requests require a personal token", { status: 403 }) : { from: "0x1" }),
    });
    expect(await rpc("eth_getTransactionReceipt", ["0xab"])).toEqual({ from: "0x1" });
    expect(calls.map((c) => c.url)).toEqual([BASE.rpc, BASE.rpcFallback]);
  });

  /**
   * MEASURED 2026-11-04: Alchemy's free tier answers eth_getLogs over more than 10 blocks with HTTP 400 —
   * one endpoint's limit, so the next is asked. Any other client error (401, 404…) still stops the call.
   */
  it("moves on from a 400, and stops at any other client error", async () => {
    const moved = net({ rpc: (_m, _p, endpoint) => (endpoint === BASE.rpc ? json({}, 400) : "0x3") });
    expect(await rpc("eth_blockNumber")).toBe("0x3");
    expect(moved.map((c) => c.url)).toEqual([BASE.rpc, BASE.rpcFallback]);
    const calls = net({ rpc: () => json({}, 401) });
    await expect(rpc("eth_blockNumber")).rejects.toThrow("The Base RPC answered 401 to eth_blockNumber.");
    expect(calls).toHaveLength(1);
  });

  it("reports the last status when every endpoint is failing", async () => {
    net({ rpc: () => json({}, 503) });
    await expect(rpc("eth_blockNumber")).rejects.toThrow("The Base RPC answered 503 to eth_blockNumber.");
  });

  it("says it could not reach the RPC when no endpoint answers", async () => {
    net({ rpc: () => DOWN });
    await expect(rpc("eth_blockNumber")).rejects.toThrow("The Base RPC could not be reached for eth_blockNumber.");
  });

  /** A revert is the chain's answer — and it is not retried either. */
  it("passes on the chain's refusal, once", async () => {
    const calls = net({ rpc: () => new RpcError("execution reverted") });
    await expect(rpc("eth_call")).rejects.toThrow("The Base RPC refused eth_call: execution reverted.");
    // the chain's "no" is its own kind of error, carrying its words — a simulation needs it apart from an outage
    const refusal = await rpc("eth_call").catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(RpcRefusal);
    expect((refusal as RpcRefusal).said).toBe("execution reverted");
    // one call each — the refusal was not retried at the second endpoint
    expect(calls).toHaveLength(2);
  });

  it("still refuses when the error carries no readable message", async () => {
    net({ rpc: () => new RpcError({ nested: true }) });
    await expect(rpc("eth_call")).rejects.toThrow("The Base RPC refused eth_call: no reason given.");
  });
});

describe("quantity and hexData", () => {
  it("reads a hex quantity", () => {
    expect(quantity("0x5b8d80", "gas")).toBe(6_000_000n);
  });

  it("refuses anything that is not one, naming what it was", () => {
    expect(() => quantity(12, "the nonce")).toThrow("The Base RPC sent the nonce as 12, which is not a hex number.");
    expect(() => quantity("0x", "the nonce")).toThrow(/not a hex number/);
    expect(() => quantity("12", "the nonce")).toThrow(/not a hex number/);
  });

  it("accepts empty bytes, which is how an account with no code answers", () => {
    expect(hexData("0x", "code")).toBe("0x");
    expect(hexData("0x60806040", "code")).toBe("0x60806040");
  });

  it("refuses non-hex data", () => {
    expect(() => hexData(null, "the account's code")).toThrow("The Base RPC sent the account's code that is not hex data.");
    expect(() => hexData("0xzz", "code")).toThrow(/not hex data/);
  });
});

describe("ethCall", () => {
  it("calls against the latest block and returns the data", async () => {
    let seen: unknown;
    net({ rpc: (m, p) => (m === "eth_call" ? ((seen = p), "0x01") : undefined) });
    expect(await ethCall("0xabc", "0x1234")).toBe("0x01");
    expect(seen).toEqual([{ to: "0xabc", data: "0x1234" }, "latest"]);
  });

  it("refuses a result that is not hex", async () => {
    net({ rpc: () => 7 });
    await expect(ethCall("0xabc", "0x")).rejects.toThrow("The Base RPC sent a call result that is not hex data.");
  });
});

describe("json accessors", () => {
  it("tells objects from arrays and null", () => {
    expect(isObj({})).toBe(true);
    expect(isObj([])).toBe(false);
    expect(isObj(null)).toBe(false);
    expect(isObj("x")).toBe(false);
  });

  it("reads a nested object or gives an empty one", () => {
    expect(objAt({ a: { b: 1 } }, "a")).toEqual({ b: 1 });
    expect(objAt({ a: 1 }, "a")).toEqual({});
    expect(objAt(null, "a")).toEqual({});
  });

  it("reads a non-empty string", () => {
    expect(strOf("x")).toBe("x");
    expect(strOf("")).toBeNull();
    expect(strOf(1)).toBeNull();
  });

  it("reads decimal digits as a bigint, and nothing else", () => {
    expect(bigOf("36083622668802065124373821514")).toBe(36083622668802065124373821514n);
    expect(bigOf("1.5")).toBeNull();
    expect(bigOf("-1")).toBeNull();
    expect(bigOf(5)).toBeNull();
  });

  /** MEASURED: Blockscout sends decimals and holder counts as strings ("18", "1225549"). */
  it("reads a finite number from a number or a numeric string", () => {
    expect(numOf(3)).toBe(3);
    expect(numOf("18")).toBe(18);
    expect(numOf("0.00108986")).toBe(0.00108986);
    expect(numOf("")).toBeNull();
    expect(numOf("  ")).toBeNull();
    expect(numOf("abc")).toBeNull();
    expect(numOf(Infinity)).toBeNull();
    expect(numOf(null)).toBeNull();
  });

  it("reads a list or gives an empty one", () => {
    expect(listOf([1])).toEqual([1]);
    expect(listOf({ 0: 1 })).toEqual([]);
  });
});

describe("format", () => {
  it("shortens an address to its two ends", () => {
    expect(short("0x2211d1D0020DAEA8039E46Cf1367962070d77DA9")).toBe("0x2211…7DA9");
  });

  it("groups thousands and keeps at most four decimals", () => {
    expect(tokenAmount(1_234_567_891_234_567_891_234n, 18)).toBe("1,234.5678");
    expect(tokenAmount(5_000_000n, 6)).toBe("5");
    expect(tokenAmount(0n, 18)).toBe("0");
  });

  /** A balance must never read as more than it is. */
  it("truncates rather than rounding up", () => {
    expect(tokenAmount(1_999_999n, 6, 2)).toBe("1.99");
  });

  it("says dust is dust instead of printing zero", () => {
    expect(tokenAmount(1n, 18)).toBe("<0.0001");
    expect(tokenAmount(1n, 18, 2)).toBe("<0.01");
  });

  it("prints dollars to the cent, and dust as under a cent", () => {
    expect(usd(1234.567)).toBe("$1,234.57");
    expect(usd(0)).toBe("$0.00");
    expect(usd(0.004)).toBe("<$0.01");
  });

  it("keeps four significant digits on a small price, in positional notation", () => {
    expect(price(2660.28)).toBe("$2,660.28");
    expect(price(0.00108986)).toBe("$0.00109");
    expect(price(0.5)).toBe("$0.5");
    expect(price(0)).toBe("$0");
    // Number#toString would print 2.74e-8 here
    expect(price(2.74e-8)).toBe("$0.0000000274");
  });

  it("links to Basescan", () => {
    expect(explorer.address("0xa")).toBe("https://basescan.org/address/0xa");
    expect(explorer.token("0xb")).toBe("https://basescan.org/token/0xb");
    expect(explorer.tx("0xc")).toBe("https://basescan.org/tx/0xc");
  });
});

describe("row", () => {
  /** `exactOptionalPropertyTypes` rejects `tone: undefined`, so absent means absent. */
  it("leaves tone and link off a plain fact", () => {
    expect(row("A", "b")).toEqual({ label: "A", value: "b" });
    expect(Object.keys(row("A", "b"))).toEqual(["label", "value"]);
  });

  it("carries them when given", () => {
    expect(row("A", "b", { tone: "bad", href: "https://x" })).toEqual({ label: "A", value: "b", tone: "bad", href: "https://x" });
  });
});
