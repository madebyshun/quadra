/**
 * Where Swap and Bridge send money, pinned — and Robinhood Chain, the one bridge destination.
 *
 * 🔴 Every address below is an ASSERTION, never a destination (the authority split of
 * `config/payees.ts` and `config/launchpad.ts`). The quote says where the transaction goes; the
 * browser refuses to ask the wallet to sign it unless that address is one of these. A pinned
 * address used AS the destination would keep sending to an old contract after the service
 * moved; used as an assertion, a move shows up as a refusal that names both addresses.
 *
 * VERIFIED 2026-09-30, each on Base's Blockscout (`/api/v2/addresses/<a>`: `is_contract` and
 * `is_verified` both true, the name as given) — hard rule 1:
 *   RelayApprovalProxyV3  0xCcC88a9d…315bE   token swaps: the approval spender AND the tx target
 *   RelayRouterV3         0xb92fe925…4fFf4f  ETH swaps: the tx target (MEASURED in a live quote)
 *   Across SpokePool      0x09aea4b2…7bEC64  ERC1967Proxy → OP_SpokePool; USDC deposits + spender
 *   SpokePoolPeriphery    0x97CCDBea…b15fD4  ETH deposits
 *
 * 🔴 RELAY MOVED, 2026-10-26 (MEASURED 2026-10-29: every ETH swap quote now targets the v3.2 Router, and
 * the app refused them — rightly, by this file). docs.relay.link "Contract Addresses" lists, for Base,
 * the v3.2 pair — Router 0x0729E2a4…97f7 and ApprovalProxy 0x5567954c…2E58 — and says to allow BOTH
 * pairs during the transition. Both are Sourcify-verified ("RelayRouter", "RelayApprovalProxy"; Blockscout
 * answered a Cloudflare 403 that day). A quote must stay within ONE pair: a v3 approval for a v3.2 swap
 * is refused.
 *
 * Robinhood Chain (hard rule 2 — a chain id, never a name alone): MEASURED 2026-09-30,
 * `eth_chainId` on its public RPC answered `0x1237` = 4663, with `access-control-allow-origin:
 * *`. Its two tokens here are listed on docs.robinhood.com/chain/contracts AND answered on
 * chain: USDG "Global Dollar", 6 decimals; WETH, 18 decimals. There is NO USDC on Robinhood
 * Chain — USDC bridged from Base arrives as USDG. Several unverified tokens there call
 * themselves "USDC" (18 decimals) and a second "USDG" exists; neither is these addresses.
 */

export const RELAY = {
  api: "https://api.relay.link",
  approvalProxy: "0xCcC88a9d1B4ED6b0EABA998850414b24f1c315bE",
  router: "0xb92fe925DC43a0ECdE6c8b1a2709c170Ec4fFf4f",
} as const;

/** Relay's v3.2 pair on Base, live since 2026-10-26 — see the note above. */
export const RELAY_V32 = {
  approvalProxy: "0x5567954cD026CEbFE486062cb75848e0f1c12E58",
  router: "0x0729E2a4716d9f7dD17858d5d504426D228697f7",
} as const;

/** Every Relay pair a quote may use, each a router (ETH in) and an approval proxy (a token in). */
export const RELAY_PAIRS: readonly { readonly router: string; readonly approvalProxy: string }[] = [RELAY, RELAY_V32];

export const ACROSS = {
  api: "https://app.across.to/api",
  spokePool: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
  periphery: "0x97CCDBea4632140639aD5eA9b944aa034eb15fD4",
} as const;

export const ROBINHOOD = {
  id: 4663,
  idHex: "0x1237",
  name: "Robinhood Chain",
  rpc: "https://rpc.mainnet.chain.robinhood.com",
  explorer: "https://robinhoodchain.blockscout.com",
  usdg: { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", symbol: "USDG", decimals: 6 },
  weth: { address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", symbol: "WETH", decimals: 18 },
} as const;

/** The zero address: how Relay and Across both name a chain's native currency (ETH). */
export const NATIVE = "0x0000000000000000000000000000000000000000";

/**
 * This product's integrator fee, in basis points, for swaps and bridges. 10 bps = 0.1%, as
 * proposed to the owner on 2026-09-30 and NOT yet confirmed. It is only ever charged when
 * `CONTRACTS.treasury` is set (hard rule 15) — today it is `null`, so every fee is off.
 */
export const FEE_BPS = 10;

/**
 * The two Across entry points a bridge may call, copied from their VERIFIED ABIs on Base
 * (the SpokePool implementation `0xf23C6C04…` and SpokePoolPeriphery) — the selectors
 * `0xad5425c6` and `0x609ea081` a live quote actually used. Written out rather than
 * fetched, so the decoder cannot be changed by whoever serves the ABI.
 */
export const ACROSS_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [
      { name: "depositor", type: "bytes32" },
      { name: "recipient", type: "bytes32" },
      { name: "inputToken", type: "bytes32" },
      { name: "outputToken", type: "bytes32" },
      { name: "inputAmount", type: "uint256" },
      { name: "outputAmount", type: "uint256" },
      { name: "destinationChainId", type: "uint256" },
      { name: "exclusiveRelayer", type: "bytes32" },
      { name: "quoteTimestamp", type: "uint32" },
      { name: "fillDeadline", type: "uint32" },
      { name: "exclusivityParameter", type: "uint32" },
      { name: "message", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "depositNative",
    stateMutability: "payable",
    inputs: [
      { name: "spokePool", type: "address" },
      { name: "depositor", type: "address" },
      { name: "recipient", type: "bytes32" },
      { name: "inputToken", type: "address" },
      { name: "inputAmount", type: "uint256" },
      { name: "outputToken", type: "bytes32" },
      { name: "outputAmount", type: "uint256" },
      { name: "destinationChainId", type: "uint256" },
      { name: "exclusiveRelayer", type: "bytes32" },
      { name: "quoteTimestamp", type: "uint32" },
      { name: "fillDeadline", type: "uint32" },
      { name: "exclusivityParameter", type: "uint32" },
      { name: "message", type: "bytes" },
    ],
    outputs: [],
  },
] as const;
