import { emptyState, type Coin, type IndexState, type Swap } from "@/server/indexer";

/**
 * The launchpad index, kept between function runs (T3, 2026-11-04). A Vercel Function forgets its
 * memory between invocations, and the index re-read from the first launch is over a million blocks —
 * so the state is written to a Vercel Blob after each step and read back before the next.
 *
 * The state is plain data with Maps and bigints; JSON has neither, so it is encoded as arrays and
 * decimal strings. `decodeState` refuses a document of another version or shape rather than half
 * reading it: a wrong index starts over from the first launch, which is slow but never wrong.
 */

/** Bumped whenever the encoded shape changes — an old document is then read as "no index yet". */
export const STATE_VERSION = 1;
/** Where the index lives in the store. */
export const STATE_PATH = "launchpad/index.json";

type Encoded = {
  readonly v: number;
  readonly syncedTo: number;
  readonly coins: readonly (readonly [string, unknown])[];
  readonly swaps: readonly (readonly [string, readonly unknown[]])[];
  readonly traders: readonly (readonly [string, string])[];
  readonly quotes: readonly (readonly [string, { readonly symbol: string; readonly decimals: number }])[];
  readonly referrers: readonly (readonly [string, string])[];
};

const BIG = "$big:";
/** bigints as tagged strings, everything else as it is */
const replacer = (_: string, v: unknown) => (typeof v === "bigint" ? `${BIG}${v.toString()}` : v);
const reviver = (_: string, v: unknown) => (typeof v === "string" && v.startsWith(BIG) ? BigInt(v.slice(BIG.length)) : v);

export function encodeState(state: IndexState): string {
  const body: Encoded = {
    v: STATE_VERSION,
    syncedTo: state.syncedTo,
    coins: [...state.coins],
    swaps: [...state.swaps],
    traders: [...state.traders],
    quotes: [...state.quotes],
    referrers: [...state.referrers],
  };
  return JSON.stringify(body, replacer);
}

/** The stored index, or `null` when there is none worth using (absent, unreadable, another version). */
export function decodeState(text: string | null): IndexState | null {
  if (text === null) return null;
  let body: Encoded;
  try {
    body = JSON.parse(text, reviver) as Encoded;
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || body.v !== STATE_VERSION || typeof body.syncedTo !== "number") return null;
  const state = emptyState();
  state.syncedTo = body.syncedTo;
  for (const [k, c] of body.coins ?? []) state.coins.set(k, c as Coin);
  for (const [k, s] of body.swaps ?? []) state.swaps.set(k, s as Swap[]);
  for (const [k, t] of body.traders ?? []) state.traders.set(k, t);
  for (const [k, q] of body.quotes ?? []) state.quotes.set(k, q);
  for (const [k, r] of body.referrers ?? []) state.referrers.set(k, r);
  return state;
}

/** Where the index is kept: read the text back, or write it over what is there. */
export type Store = {
  readonly load: () => Promise<string | null>;
  readonly save: (text: string) => Promise<void>;
};

/** The two Blob calls the store makes — the SDK's `get` and `put`, passed in so a test can stand in. */
export type BlobCalls = {
  readonly get: (path: string, options: { access: "public" | "private"; useCache: false; token?: string }) => Promise<{ stream: ReadableStream | null } | null>;
  readonly put: (
    path: string,
    body: string,
    options: { access: "public" | "private"; allowOverwrite: true; addRandomSuffix: false; contentType: string; token?: string },
  ) => Promise<unknown>;
};

/**
 * The index in a Vercel Blob store. `access` must be the store's own ("private" unless the owner made it
 * public); reads bypass the CDN cache, so a run never steps forward from an older copy than the last one saved.
 */
export function blobStore(calls: BlobCalls, token: string | null, access: "public" | "private" = "private"): Store {
  // no token: the SDK authenticates itself — Vercel's OIDC token with BLOB_STORE_ID, how a store connected
  // to a project may arrive (MEASURED 2026-11-04: a connected store and no BLOB_READ_WRITE_TOKEN yet)
  const auth = token === null ? {} : { token };
  return {
    load: async () => {
      const found = await calls.get(STATE_PATH, { access, useCache: false, ...auth });
      return found?.stream ? await new Response(found.stream).text() : null;
    },
    save: async (text) => {
      await calls.put(STATE_PATH, text, { access, allowOverwrite: true, addRandomSuffix: false, contentType: "application/json", ...auth });
    },
  };
}
