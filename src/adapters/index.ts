import type { Adapters } from "@/adapters/types";
import { HttpCatalog } from "@/adapters/http/catalog";
import { LocalEnclave } from "@/adapters/local/enclave";

/**
 * Picks which implementation the app runs against: take whatever actually exists.
 *
 * The catalog resolves LIVE. It needs a free, unauthenticated, CORS-open GET, and that
 * answers today — so returning the stub instead would be choosing to show four invented
 * tools over the real ones. It does not fall back to the stub when the network is down.
 * The enclave stays local because there is no TEE running to return.
 *
 * (A `pool` adapter and its `resolvePool`/`onchainReady` lived here until 2026-09-30, when
 * the privacy model was archived — see `archive/privacy/`.)
 */
export function adapters(): Adapters {
  return {
    enclave: new LocalEnclave(),
    catalog: new HttpCatalog(),
  };
}

export type { Adapters };
