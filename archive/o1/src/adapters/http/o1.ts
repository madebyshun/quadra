import { decodeFunctionResult, encodeFunctionData } from "viem";
import { baseStocks } from "@/adapters/http/markets";
import { BASE } from "@/config/chain";
import { CRYPTO_PAIRS, FACTORY_ABI, O1, type Pair } from "@/config/o1";
import { sameAddress } from "@/lib/address";
import { messageOf } from "@/lib/errors";
import type { TxRequest } from "@/lib/transact";
import { O1_PATH, O1_REQUEST_HEADER, SERVER_ORIGIN } from "@/server/o1";
import { ethCall } from "@/skills/http";

/**
 * Launch through o1: ask this app's server to prepare a launch, then CHECK the plan o1
 * returns before a single step reaches the wallet.
 *
 * ── What is checked, and why each ────────────────────────────────────────────────
 * o1 returns unsigned transactions and says "do not modify the calldata". Fine — nothing
 * here modifies it. But "do not modify" is not "do not look": a plan is refused unless
 *   • it is for Base, and for the wallet on screen (`actor`, and each step's `from`);
 *   • every step is a plain transaction to o1's verified factory (`config/o1.ts`) — a
 *     step to any other address, or a typed-data signature, is refused by name;
 *   • no step carries more native value than the creation fee the plan itself declares
 *     (MEASURED in the docs: `value` covers the launch fee only, not gas) — nor more than
 *     the factory itself charges, read from Base just before asking;
 *   • it is a plan for what was ASKED: the same pair, the same market, profile editing on
 *     or off as chosen, and not a tax launch — a plan for a different launch than the one on
 *     screen is refused even if every transaction in it is well-formed;
 *   • nothing in `issues` is blocking or needs an action this build does not take.
 * The same shape as `lib/requirements.ts` for x402: the server may propose, the browser
 * decides what it will ask the user to sign.
 *
 * ⚠️ Written against o1's OpenAPI spec (docs.o1.exchange/launchpad-api-openapi.yaml,
 * 2026-09-30). The live API answered 500 on every route that day, so no response here has
 * been measured yet — see `config/o1.ts`.
 */

/** One key/value row of a launch's public extra information. */
export type Extra = { readonly key: string; readonly value: string };

export type LaunchInput = {
  readonly creator: string;
  readonly pair: Pair;
  /** grant the creator authority to edit the token's profile later — nothing else */
  readonly editable: boolean;
  readonly extra: readonly Extra[];
  readonly name: string;
  readonly symbol: string;
  readonly description: string;
  readonly website: string;
  readonly x: string;
  readonly telegram: string;
  readonly imageBase64: string;
  readonly imageType: string;
};

export type LaunchStep = { readonly label: string; readonly tx: TxRequest };

export type LaunchPlan = {
  readonly steps: readonly LaunchStep[];
  readonly token: string;
  readonly name: string;
  readonly symbol: string;
  /** wei, native ETH */
  readonly creationFee: bigint;
  readonly editable: boolean;
  readonly metadataUri: string;
  readonly imageUrl: string | null;
  readonly expiresAt: Date;
  /** o1's own warnings, passed on word for word */
  readonly warnings: readonly string[];
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const RAW = /^(0|[1-9][0-9]*)$/;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** A call to this app's own launch server. Throws o1's (or the server's) `detail`, named. */
async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${O1_PATH}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), [O1_REQUEST_HEADER]: "1" },
    });
  } catch {
    throw new Error("This app's launch server could not be reached. Nothing was prepared.");
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(
      "The launch server is not running here — Launch needs this app's server, which holds the o1 key. Nothing was prepared.",
    );
  }
  if (!res.ok) {
    const p = isObj(body) ? body : {};
    /** MEASURED 2026-09-30: while o1 was down its host answered `{"error":{"message":…}}`, not a problem. */
    const hosted = isObj(p.error) ? str(p.error.message) : null;
    const detail = str(p.detail) ?? str(p.title) ?? hosted ?? `status ${res.status}`;
    const code = str(p.code);
    if (p.origin === SERVER_ORIGIN) throw new Error(`${detail} Nothing was prepared.`);
    if (res.status >= 500) {
      throw new Error(
        `o1's launch service is failing on its own side (HTTP ${res.status}: ${detail}). Nothing was prepared — this is not your wallet or this app. Try again later.`,
      );
    }
    throw new Error(`o1: ${detail}${code ? ` (${code})` : ""}. Nothing was prepared.`);
  }
  return body;
}

/**
 * Whether o1's launch service is answering, asked through this app's server. MEASURED
 * 2026-09-30: o1 answered 500 `FUNCTION_INVOCATION_FAILED` to `/health` from Vietnam and from
 * the US West coast alike, all day — so the Launch window checks before anyone fills a form.
 * Anything but a clear "up" reads as down: a check that cannot run proves nothing is working.
 */
export async function o1Up(): Promise<boolean> {
  try {
    const res = await fetch(`${O1_PATH}/health`, { headers: { [O1_REQUEST_HEADER]: "1" } });
    const body: unknown = await res.json();
    return isObj(body) && body.up === true;
  } catch {
    return false;
  }
}

function refuse(why: string): never {
  throw new Error(`This build will not sign o1's plan: ${why} Nothing was sent.`);
}

/** What was asked for, when the caller knows it — `prepareLaunch` always does. */
export type Asked = {
  readonly pair: Pair;
  readonly editable: boolean;
  /** what the factory charges, read from Base: no step may carry more */
  readonly feeCap: bigint;
};

/** o1's plan, checked. Throws a sentence naming the first thing that is wrong with it. */
export function checkPlan(body: unknown, creator: string, now: Date = new Date(), asked?: Asked): LaunchPlan {
  const d = isObj(body) && isObj(body.data) ? body.data : refuse("the answer has no plan in it.");
  if (d.chain_id !== BASE.id) refuse(`it is for chain ${String(d.chain_id)}, not ${BASE.name} (${BASE.id}).`);
  if (typeof d.actor !== "string" || !sameAddress(d.actor, creator)) refuse("it is for a different wallet than the one connected.");
  const expiresAt = new Date(typeof d.expires_at === "string" ? d.expires_at : NaN);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) refuse("it has expired. Prepare it again.");

  const issues = Array.isArray(d.issues) ? d.issues.filter(isObj) : [];
  const stop = issues.find((i) => i.severity === "blocking" || i.severity === "action_required");
  if (stop) refuse(`o1 reports "${str(stop.detail) ?? str(stop.code) ?? "an issue"}".`);

  const review = isObj(d.review) ? d.review : {};
  const reviewed = isObj(review.token) ? review.token : {};
  if (asked) {
    if (review.market !== asked.pair.market) refuse(`it is for o1's ${String(review.market)} market, not ${asked.pair.market} as asked.`);
    if (typeof review.quote_address !== "string" || !sameAddress(review.quote_address, asked.pair.address)) {
      refuse(`it pairs the token with ${String(review.quote_address)}, not ${asked.pair.symbol} as asked.`);
    }
    if (review.launch_product === "tax") refuse("it is a tax launch, which was not asked for.");
    const grants = reviewed.editable_metadata === true;
    if (grants !== asked.editable) refuse(`it ${grants ? "grants" : "does not grant"} profile editing, which is not what was asked.`);
  }

  const fee = isObj(d.creation_fee) ? d.creation_fee : null;
  const nativeFee =
    fee && typeof fee.currency_address === "string" && sameAddress(fee.currency_address, O1.nativeQuote) && typeof fee.amount_raw === "string" && RAW.test(fee.amount_raw)
      ? BigInt(fee.amount_raw)
      : 0n;

  const rawSteps = Array.isArray(d.steps) ? d.steps : [];
  if (rawSteps.length === 0) refuse("it has no steps.");
  const steps = rawSteps.map((s): LaunchStep => {
    if (!isObj(s) || s.kind !== "transaction" || !isObj(s.transaction)) {
      refuse("a step asks for a signature on typed data (Permit2), which this build does not sign.");
    }
    const t = s.transaction;
    if (t.chain_id !== BASE.id) refuse("a step is for another chain.");
    if (typeof t.from !== "string" || !sameAddress(t.from, creator)) refuse("a step is sent from a different wallet.");
    if (typeof t.to !== "string" || !sameAddress(t.to, O1.factory)) {
      refuse(`a step sends to ${String(t.to)}, not to o1's verified factory ${O1.factory}.`);
    }
    if (typeof t.data !== "string" || !HEX.test(t.data)) refuse("a step's calldata is not hex.");
    if (typeof t.value !== "string" || !RAW.test(t.value)) refuse("a step's value is not a whole number.");
    const value = BigInt(t.value);
    if (value > nativeFee) refuse(`a step sends ${value} wei, more than the ${nativeFee} wei creation fee it declares.`);
    if (asked && value > asked.feeCap) refuse(`a step sends ${value} wei, more than the ${asked.feeCap} wei o1's factory charges on ${BASE.name}.`);
    return { label: str(s.label) ?? "Launch on o1", tx: { to: t.to, data: t.data as `0x${string}`, value } };
  });

  const token = typeof d.predicted_token_address === "string" && ADDRESS.test(d.predicted_token_address) ? d.predicted_token_address : refuse("it names no token address.");
  const meta = isObj(body) && isObj(body.meta) && Array.isArray(body.meta.warnings) ? body.meta.warnings : [];
  return {
    steps,
    token,
    name: str(reviewed.name) ?? "?",
    symbol: str(reviewed.symbol) ?? "?",
    creationFee: nativeFee,
    editable: reviewed.editable_metadata === true,
    metadataUri: str(d.metadata_uri) ?? "",
    imageUrl: str(d.image_url),
    expiresAt,
    warnings: [
      ...issues.map((i) => str(i.detail) ?? str(i.code) ?? "").filter((w) => w !== ""),
      ...meta.filter((w): w is string => typeof w === "string"),
    ],
  };
}

/**
 * What o1's factory on Base says about launching with `quote`, read from the chain: whether
 * creation is open, the native fee, and whether the pair is registered. This works while o1's
 * API is down (MEASURED 2026-09-30: it was, all day) — the chain does not share its outage.
 */
export type FactoryState = { readonly open: boolean; readonly fee: bigint; readonly registered: boolean };

export async function factoryState(quote: string): Promise<FactoryState> {
  const at = (data: `0x${string}`) => ethCall(O1.factory, data);
  const [open, fee, config] = await Promise.all([
    at(encodeFunctionData({ abi: FACTORY_ABI, functionName: "launchCreationEnabled" })).then((data) =>
      decodeFunctionResult({ abi: FACTORY_ABI, functionName: "launchCreationEnabled", data }),
    ),
    at(encodeFunctionData({ abi: FACTORY_ABI, functionName: "nativeLaunchFee" })).then((data) =>
      decodeFunctionResult({ abi: FACTORY_ABI, functionName: "nativeLaunchFee", data }),
    ),
    at(encodeFunctionData({ abi: FACTORY_ABI, functionName: "quoteConfig", args: [quote as `0x${string}`] })).then((data) =>
      decodeFunctionResult({ abi: FACTORY_ABI, functionName: "quoteConfig", data }),
    ),
  ]);
  return { open, fee, registered: config[0] };
}

/**
 * Everything a Base launch can be paired with, Base first in every sense: the crypto pairs,
 * then Coinbase's stocks on Base (`market: "rwa"`) — from Coinbase's own list, since o1's catalog
 * file named 10 while o1's factory had registered ~50 stock quotes (MEASURED 2026-09-30 from its
 * `QuoteRegistered` events). The factory itself is read for whichever pair is picked, so a stock
 * it has not registered is refused before o1 is asked. A list that cannot be read leaves the
 * crypto pairs and says why — it never invents a stock.
 */
export async function launchPairs(): Promise<{ readonly pairs: readonly Pair[]; readonly problem: string | null }> {
  try {
    const stocks = [...(await baseStocks()).values()].map(
      (s): Pair => ({ market: "rwa", symbol: s.ticker, name: s.name, address: s.address }),
    );
    return { pairs: [...CRYPTO_PAIRS, ...stocks], problem: null };
  } catch (e) {
    return { pairs: CRYPTO_PAIRS, problem: messageOf(e) };
  }
}

/** Ask o1 (through this app's server) to prepare a launch, and check what comes back. */
export async function prepareLaunch(input: LaunchInput): Promise<LaunchPlan> {
  // read the factory first: a pair it would refuse, or a paused factory, costs o1 an IPFS pin
  // and the user one of 25 prepares a day for nothing
  let state: FactoryState;
  try {
    state = await factoryState(input.pair.address);
  } catch (e) {
    throw new Error(`o1's factory on ${BASE.name} could not be read (${messageOf(e)}). Nothing was prepared.`);
  }
  if (!state.open) throw new Error(`o1's factory on ${BASE.name} has launch creation switched off right now. Nothing was prepared.`);
  if (!state.registered) throw new Error(`${input.pair.symbol} is not registered as a pair on o1's factory on ${BASE.name}. Nothing was prepared.`);
  const body = await call("/launches/prepare", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      chain_id: BASE.id,
      creator: input.creator,
      market: input.pair.market,
      launch_product: "non-tax",
      quote_address: input.pair.address,
      token: {
        name: input.name,
        symbol: input.symbol,
        description: input.description,
        website: input.website,
        x: input.x,
        telegram: input.telegram,
        image_base64: input.imageBase64,
        image_type: input.imageType,
        editable_metadata: input.editable,
        extra_metadata: input.extra,
      },
    }),
  });
  return checkPlan(body, input.creator, new Date(), { pair: input.pair, editable: input.editable, feeCap: state.fee });
}
