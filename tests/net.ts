import { afterEach, expect, vi } from "vitest";
import { decodeFunctionData, encodeFunctionResult, namehash, type Abi } from "viem";
import { BASENAMES } from "@/config/chain";

/**
 * A fake network for the skills: routes each `fetch` to a GET handler or a JSON-RPC handler.
 *
 * 🔴 An UNROUTED call must fail the test, and it cannot do that by throwing. The skills
 * catch a throwing `fetch` and turn it into "Blockscout could not be reached" — a perfectly
 * plausible answer that a test could assert on without noticing it never reached the route
 * it meant to. So an unrouted call is recorded, answered as a network failure, and
 * `useNet()` fails the test after it ends by naming every URL nobody answered.
 */

/** Answer with a network failure — `fetch` rejects, as it does when a host is unreachable. */
export const DOWN = Symbol("network down");

/** Answer a JSON-RPC call with an `error` instead of a `result`. */
export class RpcError {
  constructor(readonly message: unknown) {}
}

/** A route's answer: a JSON body (or RPC result), a full `Response` for a status, or `DOWN`. */
export type Answer = unknown;

export type Routes = {
  get?: (url: string) => Answer | undefined;
  /** a POST that is not JSON-RPC — a quote API — by URL and parsed body */
  post?: (url: string, body: unknown) => Answer | undefined;
  rpc?: (method: string, params: readonly unknown[], endpoint: string) => Answer | undefined;
};

export type Call = { readonly url: string; readonly rpc: string | null };

const unrouted: string[] = [];

/** Register the after-each check that no call went unanswered. Call once per test file. */
export function useNet(): void {
  afterEach(() => {
    const missed = unrouted.splice(0);
    expect(missed, "fetch calls that no route answered").toEqual([]);
  });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Install the routes as `fetch`. Returns the calls made, in order. */
export function net(routes: Routes): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = String(input);
    let answer: Answer | undefined;
    const posted = init?.method === "POST" ? (JSON.parse(String(init.body)) as { method?: unknown; params: unknown[] }) : null;
    if (posted !== null && typeof posted.method !== "string") {
      calls.push({ url, rpc: null });
      answer = routes.post?.(url, posted);
      if (answer === undefined) unrouted.push(`POST ${url}`);
      else if (answer !== DOWN && !(answer instanceof Response)) answer = json(answer);
    } else if (posted !== null) {
      const body = posted as { method: string; params: unknown[] };
      calls.push({ url, rpc: body.method });
      answer = routes.rpc?.(body.method, body.params, url);
      if (answer === undefined) unrouted.push(`RPC ${body.method} at ${url}`);
      else if (answer !== DOWN && !(answer instanceof Response)) {
        answer = json(
          answer instanceof RpcError
            ? { jsonrpc: "2.0", id: 1, error: { code: -32000, message: answer.message } }
            : { jsonrpc: "2.0", id: 1, result: answer },
        );
      }
    } else {
      calls.push({ url, rpc: null });
      answer = routes.get?.(url);
      // the visitor's country (lib/region.ts): unread unless a test says otherwise — never a block by default
      if (answer === undefined && url === "/api/weekend/live") answer = new Response(JSON.stringify({ detail: "stock data unavailable in this fixture" }), { status: 503 });
      if (answer === undefined && url === "/api/region") answer = { country: null };
      if (answer === undefined) unrouted.push(`GET ${url}`);
      else if (answer !== DOWN && !(answer instanceof Response)) answer = json(answer);
    }
    if (answer === undefined || answer === DOWN) throw new TypeError("Failed to fetch");
    return answer as Response;
  });
  return calls;
}

/**
 * Answer the `eth_call` a transaction is SIMULATED with before it is sent (`lib/transact.ts`) —
 * it carries a `from`, which a read never does. `answer` is what the chain says: "0x" (it would
 * go through) by default, or an `RpcError` for a revert.
 */
export function simulated(answer: Answer = "0x"): (method: string, params: readonly unknown[]) => Answer | undefined {
  return (method, params) => (method === "eth_call" && typeof (params[0] as { from?: unknown } | undefined)?.from === "string" ? answer : undefined);
}

/** A GET router from exact URLs. */
export function urls(table: Record<string, Answer>): (url: string) => Answer | undefined {
  return (url) => table[url];
}

// ── eth_call ─────────────────────────────────────────────────────────────────

type EthCall = { to: string; data: `0x${string}` };

/** Route `eth_call` by destination, lowercased; each handler returns encoded return data. */
export function ethCalls(
  byAddress: Record<string, (data: `0x${string}`) => `0x${string}` | RpcError>,
): (method: string, params: readonly unknown[]) => Answer | undefined {
  const table = new Map(Object.entries(byAddress).map(([a, h]) => [a.toLowerCase(), h]));
  return (method, params) => {
    if (method !== "eth_call") return undefined;
    const { to, data } = params[0] as EthCall;
    return table.get(to.toLowerCase())?.(data);
  };
}

/** A contract that answers read calls from a table of decoded values, by function name. */
export function contractAt(abi: Abi, answers: Record<string, unknown>): (data: `0x${string}`) => `0x${string}` {
  return (data) => {
    const { functionName } = decodeFunctionData({ abi, data });
    if (!(functionName in answers)) throw new Error(`the fake contract has no answer for ${functionName}`);
    return encodeFunctionResult({ abi, functionName, result: answers[functionName] as never });
  };
}

// ── Basenames ────────────────────────────────────────────────────────────────

const ZERO = "0x0000000000000000000000000000000000000000";

const REGISTRY_ABI = [
  { type: "function", name: "resolver", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }], outputs: [{ type: "address" }] },
] as const;

const RESOLVER_ABI = [
  { type: "function", name: "addr", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }], outputs: [{ type: "address" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }], outputs: [{ type: "string" }] },
] as const;

export type NameBook = {
  /** full name → address it resolves to (`null`: has a resolver, but no address set) */
  readonly forward?: Record<string, string | null>;
  /** address → the name its reverse record claims */
  readonly reverse?: Record<string, string>;
  readonly resolver: string;
};

const reverseNode = (address: string) => namehash(`${address.toLowerCase().slice(2)}.${BASENAMES.reverseSuffix}`);

/**
 * The registry and one resolver, answering from a name book. Every node not in the book
 * has no resolver — the registry's real answer for an unregistered name.
 */
export function basenames(book: NameBook): Record<string, (data: `0x${string}`) => `0x${string}`> {
  const forward = new Map(Object.entries(book.forward ?? {}).map(([n, a]) => [namehash(n), a]));
  const reverse = new Map(Object.entries(book.reverse ?? {}).map(([a, n]) => [reverseNode(a), n]));
  return {
    [BASENAMES.registry]: (data) => {
      const { args } = decodeFunctionData({ abi: REGISTRY_ABI, data });
      const known = forward.has(args[0]) || reverse.has(args[0]);
      return encodeFunctionResult({ abi: REGISTRY_ABI, functionName: "resolver", result: known ? (book.resolver as `0x${string}`) : ZERO });
    },
    [book.resolver]: (data) => {
      const call = decodeFunctionData({ abi: RESOLVER_ABI, data });
      if (call.functionName === "addr") {
        const found = forward.get(call.args[0]) ?? ZERO;
        return encodeFunctionResult({ abi: RESOLVER_ABI, functionName: "addr", result: (found ?? ZERO) as `0x${string}` });
      }
      return encodeFunctionResult({ abi: RESOLVER_ABI, functionName: "name", result: reverse.get(call.args[0]) ?? "" });
    },
  };
}
