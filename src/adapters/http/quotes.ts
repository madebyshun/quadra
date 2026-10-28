import { isObj, strOf } from "@/skills/json";

/**
 * One request to a quote API (Relay, Across), with every failure turned into a sentence that
 * names the service. MEASURED 2026-09-30: both answer a refusal as JSON with a `message`
 * ("Amount is too small to be swapped", "Bridge amount 1 is too low to cover bridge fees
 * 8998"), which is exactly what the person needs to read — so that is what is thrown.
 */
export async function askQuote(service: string, url: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error(`${service} could not be reached. Nothing was quoted.`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`${service} answered with something that is not JSON. Nothing was quoted.`);
  }
  if (!res.ok) {
    const said = isObj(body) ? strOf(body.message) : null;
    throw new Error(`${service}: ${said ?? `it answered ${res.status}`}.`);
  }
  return body;
}

/** A base-10 integer string as a bigint, or `null` — how both APIs send amounts. */
export function rawAmount(v: unknown): bigint | null {
  return typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v) ? BigInt(v) : null;
}
