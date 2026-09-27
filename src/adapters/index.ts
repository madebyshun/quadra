import type { Adapters } from "@/adapters/types";
import { HttpCatalog } from "@/adapters/http/catalog";
import { LocalEnclave } from "@/adapters/local/enclave";
import { LocalShieldedPool } from "@/adapters/local/pool";
import { CONTRACTS } from "@/config/chain";

/**
 * Picks which implementation the app runs against.
 *
 * The choice is made from `CONTRACTS`, not from an env var or a build mode. That
 * is the point: there is no switch anyone can flip to make the UI *say* it is
 * live. A deployed address is the only thing that changes the answer, and until
 * `shieldedPool` is set there is no on-chain implementation to return — so
 * `resolvePool` cannot be made to lie by configuration alone.
 *
 * `onchainReady` is exported separately so the UI can show the truth without
 * having to construct an adapter to find it out.
 */

export function onchainReady(): boolean {
  return bothDeployed(CONTRACTS.shieldedPool, CONTRACTS.verifier);
}

/**
 * Takes both addresses rather than reading them, so all four combinations can be
 * checked while both are still null. The half-deployed cases are the dangerous
 * ones — a pool without its verifier accepts deposits it cannot prove — and a
 * short-circuited `&&` over two null constants leaves them untested.
 */
export function bothDeployed(pool: string | null, verifier: string | null): boolean {
  return pool !== null && verifier !== null;
}

/**
 * Why this throws instead of falling back: a caller asking for the on-chain pool
 * while nothing is deployed has a bug, and silently handing back the local one
 * would make that bug invisible — the UI would report local state as settled.
 */
export function resolvePool(ready: boolean): LocalShieldedPool {
  if (ready) {
    throw new Error(
      "The pool is deployed, but no on-chain ShieldedPool is implemented yet. Implement it in src/adapters/onchain/ before setting CONTRACTS.shieldedPool.",
    );
  }
  return new LocalShieldedPool();
}

/**
 * The catalog is the one adapter that resolves LIVE, and by the same rule that
 * keeps the other two local: take whatever actually exists.
 *
 * Nothing gates it. The pool needs a contract that is not deployed and the enclave
 * needs a TEE that is not running, so for those there is nothing real to return.
 * The catalog needs a free, unauthenticated, CORS-open GET, and that answers today
 * — so returning the stub instead would be choosing to show four invented tools
 * over the 115 real ones. Runs are live for the six ids that cost nothing and
 * refused for the 109 that want a signature, which `whyNot` reports per price; it
 * does not pretend otherwise, and it does not fall back to the stub when the
 * network is down.
 */
export function adapters(): Adapters {
  return {
    pool: resolvePool(onchainReady()),
    enclave: new LocalEnclave(),
    catalog: new HttpCatalog(),
  };
}

export type { Adapters };
