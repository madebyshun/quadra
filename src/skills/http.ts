import { BASE } from "@/config/chain";

/**
 * The two ways a skill reaches the outside: a JSON GET to a named service, and a Base
 * JSON-RPC call. Both throw sentences that NAME the service, because "Failed to fetch"
 * does not tell a person whether Blockscout, GoPlus or the RPC is the one that is down.
 */

/** GET `url` as JSON. `null` for a 404 — "no such thing" is an answer, not an outage. */
export async function getJson(service: string, url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch {
    throw new Error(`${service} could not be reached. Nothing was read from it.`);
  }
  if (res.status === 404) return null;
  /**
   * MEASURED 2026-09-30: Blockscout's holder list for USDC answered 524 — its CDN gave up
   * waiting — while the same query for a small token took a second. A timeout is worth
   * naming as one: "try a smaller token" is actionable, a bare status is not.
   */
  if (res.status === 504 || res.status === 524) {
    throw new Error(`${service} timed out on this query — it may be too large for it (a very widely held token, say).`);
  }
  if (!res.ok) throw new Error(`${service} answered ${res.status}. Nothing was read from it.`);
  try {
    return (await res.json()) as unknown;
  } catch {
    throw new Error(`${service} answered with something that is not JSON.`);
  }
}

type RpcBody = { result?: unknown; error?: { message?: unknown } };

/** Tried in order; the next one only when the one before could not answer at all. */
export const RPC_ENDPOINTS: readonly string[] = [BASE.rpc, BASE.rpcFallback];

/**
 * One JSON-RPC call to Base.
 *
 * MEASURED 2026-09-30: `base.publicnode.com` and `mainnet.base.org` both answer CORS
 * (`access-control-allow-origin: *`), so the browser calls them directly. Both are public and
 * rate-limited — `mainnet.base.org` sent a burst of a few `eth_call`s back 429 in the same
 * minute — so a 429, a 403 (an endpoint refusing the METHOD), a 5xx or an unreachable endpoint
 * moves on to the next. A JSON-RPC `error` does
 * NOT: that is the chain's answer (a revert, a bad parameter), and asking another node
 * the same question gets the same answer.
 */
export async function rpc(method: string, params: readonly unknown[] = []): Promise<unknown> {
  return rpcOn(BASE.name, RPC_ENDPOINTS, method, params);
}

/**
 * The same call against another chain's endpoints — Robinhood Chain, for a bridge's arrival.
 * `chain` is the name every sentence uses, so a failure says WHICH chain's RPC failed.
 */
/** HTTP statuses that are ONE endpoint's limit rather than the chain's answer: the next endpoint is asked. */
export const ENDPOINT_LIMITS: ReadonlySet<number> = new Set([400, 403, 413, 429]);

/** JSON-RPC error messages that indicate an endpoint's own range/rate/archive limit rather than a chain revert. */
const RPC_LIMIT_MSG = /limit|range|too large|too many|invalid params|archive|pruned|exceed|rate|distance|timeout/i;

export async function rpcOn(chain: string, endpoints: readonly string[], method: string, params: readonly unknown[]): Promise<unknown> {
  let last = `The ${chain} RPC could not be reached for ${method}.`;
  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i]!;
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
    } catch {
      continue;
    }
    if (res.ok) {
      try {
        return readRpc(chain, method, (await res.json()) as RpcBody);
      } catch (e) {
        if (e instanceof RpcRefusal && i < endpoints.length - 1 && RPC_LIMIT_MSG.test(e.said)) {
          last = e.message;
          continue;
        }
        throw e;
      }
    }
    last = `The ${chain} RPC answered ${res.status} to ${method}.`;
    if (!ENDPOINT_LIMITS.has(res.status) && res.status < 500) break;
  }
  throw new Error(last);
}

/**
 * The chain's own "no" — a JSON-RPC `error`, such as a revert — as distinct from an RPC that
 * could not answer. A caller that simulates a transaction needs the two apart: a revert is a
 * reason not to send, an unreachable node is not evidence of anything.
 */
export class RpcRefusal extends Error {
  constructor(
    message: string,
    /** the node's own words */
    readonly said: string,
  ) {
    super(message);
  }
}

function readRpc(chain: string, method: string, body: RpcBody): unknown {
  if (body.error) {
    const said = typeof body.error.message === "string" ? body.error.message : "no reason given";
    throw new RpcRefusal(`The ${chain} RPC refused ${method}: ${said}.`, said);
  }
  return body.result;
}

/** A hex quantity from the RPC as a bigint, or a thrown sentence naming what it was. */
export function quantity(value: unknown, what: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`The Base RPC sent ${what} as ${JSON.stringify(value)}, which is not a hex number.`);
  }
  return BigInt(value);
}

/** Hex bytes from the RPC — `0x` alone is valid and means "empty" — or a thrown sentence. */
export function hexData(value: unknown, what: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`The Base RPC sent ${what} that is not hex data.`);
  }
  return value as `0x${string}`;
}

/** `eth_call` against the latest block; the raw return data. */
export async function ethCall(to: string, data: string): Promise<`0x${string}`> {
  return hexData(await rpc("eth_call", [{ to, data }, "latest"]), "a call result");
}
