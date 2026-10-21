import { UNISWAP_V4_POOL_MANAGER } from "@/config/chain";

/**
 * Uniswap v4 on Base — the contracts a direct swap through a launchpad pool touches (`lib/v4swap.ts`).
 * The PoolManager is `UNISWAP_V4_POOL_MANAGER` in config/chain.ts, re-exported here, not restated.
 *
 * Hard rule 1. CHECKED 2026-10-14, three ways, before any of these was written here:
 *  1. Uniswap's own list, docs.uniswap.org/contracts/v4/deployments, "Base: 8453": PoolManager
 *     0x498581ff…2b2b, Quoter 0x0d5e0f97…048d, Universal Router 0x6ff5693b…9b43, Permit2
 *     0x00000000…8BA3 (the page also lists Universal Router 2.1.1 and 2.1.2 — not used here).
 *  2. Sourcify (`sourcify.dev/server/v2/contract/8453/<address>`): every one an exact `match` on
 *     runtime AND creation bytecode — PoolManager (lib/v4-core/src/PoolManager.sol, block
 *     25,350,988), Quoter (src/lens/Quoter.sol, block 25,350,995), UniversalRouter
 *     (src/pkgs/universal-router/contracts/UniversalRouter.sol, block 25,350,999), Permit2
 *     (src/Permit2.sol, block 1,425,180). Base's Blockscout answered this machine with a Cloudflare
 *     challenge (HTTP 403) on 2026-10-14, so its `is_verified` could not be read that day — the
 *     PoolManager's was read on 2026-10-01 (config/chain.ts).
 *  3. The chain itself, on mainnet.base.org: `poolManager()` on the Quoter AND on the
 *     UniversalRouter both answer 0x498581fF…2b2b, so the three belong together; Permit2 and the
 *     router have code. And `scripts/simulate-v4swap.ts` runs real swaps through them on mainnet
 *     state (eth_simulateV1), matching the Quoter's figures.
 *
 * 🔴 The Quoter here is v4-periphery's `Quoter` as deployed with v4: `quoteExactInputSingle` catches
 * its own internal revert and RETURNS `(amountOut, gasEstimate)` — MEASURED, an ordinary return
 * value from `eth_call`. A quote it cannot fill is a real revert (`UnexpectedRevertBytes` wrapping
 * `NotEnoughLiquidity(poolId)` or `PoolNotInitialized()`, MEASURED both).
 */
export const UNISWAP_V4 = {
  poolManager: UNISWAP_V4_POOL_MANAGER,
  /** v4-periphery `Quoter` (named "V4Quoter" in Uniswap's SDKs) */
  quoter: "0x0d5e0F971ED27FBfF6c2837bf31316121532048D",
  /** the Universal Router deployed with v4 — `execute(commands, inputs, deadline)`, command V4_SWAP */
  universalRouter: "0x6fF5693b99212Da76ad316178A184AB56D299b43",
  /** Permit2 — the same address on every chain; the router pulls a token in through it */
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
} as const;
