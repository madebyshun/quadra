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

/** The Blob calls the store makes — the SDK's `head`, `get` and `put`, passed in so a test can stand in. */
export type BlobCalls = {
  /** the blob's metadata from the Blob API — its etag is the one `put`'s `ifMatch` is compared with; throws `BlobNotFoundError` when absent */
  readonly head: (path: string, options: { token?: string }) => Promise<{ readonly url: string; readonly etag: string }>;
  readonly get: (path: string, options: { access: "public" | "private"; useCache: false; token?: string }) => Promise<{ stream: ReadableStream | null; blob?: { etag: string } } | null>;
  readonly put: (
    path: string,
    body: string,
    options: { access: "public" | "private"; allowOverwrite: boolean; ifMatch?: string; addRandomSuffix: false; contentType: string; token?: string },
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
  let expected: string | null | undefined;
  return {
    /**
     * 🔴 MEASURED 2026-11-25: production answered every save with "Precondition failed: ETag mismatch" and
     * the index stood still 7.4M blocks behind. The etag was taken from the GET response's header — the
     * blob's DOWNLOAD, which a CDN may cache or re-encode — while `put`'s `ifMatch` is compared with the
     * Blob API's own etag. The version is now read from the API (`head`), and a public store's copy is
     * fetched keyed by that version, so the CDN cannot hand back an older one under it.
     */
    load: async () => {
      expected = undefined;
      let meta: { readonly url: string; readonly etag: string } | null;
      try {
        meta = await calls.head(STATE_PATH, auth);
      } catch (e) {
        if ((e as { name?: unknown } | null)?.name !== "BlobNotFoundError") throw e;
        meta = null;
      }
      if (meta === null) {
        expected = null;
        return null;
      }
      const where = access === "public" ? `${meta.url}?v=${encodeURIComponent(meta.etag)}` : STATE_PATH;
      const found = await calls.get(where, { access, useCache: false, ...auth });
      // gone between the two reads: nothing to build on, so nothing may be saved over it
      if (!found?.stream) return null;
      const text = await new Response(found.stream).text();
      expected = meta.etag;
      return text;
    },
    save: async (text) => {
      if (expected === undefined) throw new Error("The index needs a versioned storage read before saving. Nothing was overwritten.");
      await calls.put(STATE_PATH, text, { access, allowOverwrite: expected !== null, ...(expected === null ? {} : { ifMatch: expected }), addRandomSuffix: false, contentType: "application/json", ...auth });
      // The next save must read its own new version first.
      expected = undefined;
    },
  };
}
