import { CONTRACTS, USDC } from "@/config/chain";

/**
 * What this app's own API charges, over x402 — the owner's decision of 2026-09-30: every skill
 * call is paid per request in USDC to `CONTRACTS.treasury`; the list of skills is free.
 *
 * Priced PER SKILL since 2026-10-02 (owner: build all six market tools; no preference on price),
 * from the market as MEASURED that day on Coinbase's Bazaar and x402scan: a token verdict sells at
 * $0.01–0.06 (cyberwarex), smart-money and launch forensics at $0.05–0.15 (Nansen, Deepnets), a
 * pre-sign check at ~$0.005. Starting figures for the owner to change — set here and nowhere else.
 * `API_PRICE` is the price of a skill not named below.
 */
export const API_PRICE = 5_000n;

/** USDC base units (6 decimals) per call, by skill id. */
export const SKILL_PRICES: Readonly<Record<string, bigint>> = {
  verdict: 50_000n,
  gate: 10_000n,
  sendcheck: 5_000n,
  forensics: 100_000n,
  launcher: 50_000n,
  radar: 20_000n,
  launch: 50_000n,
};

/** What one call to `skill` costs, in USDC base units. */
export function priceOf(skill: string): bigint {
  return SKILL_PRICES[skill] ?? API_PRICE;
}

/** How long a payment authorization may take to settle — the figure measured on real x402 sellers. */
export const API_TIMEOUT_SECONDS = 120;

/**
 * The one x402 `accepts` entry this app's API offers, or `null` while no fee address is set
 * (hard rule 15: without a treasury there is nobody to pay, so nothing is sold).
 */
export function apiRequirements(treasury: string | null = CONTRACTS.treasury, skill: string | null = null) {
  if (treasury === null) return null;
  return {
    scheme: "exact",
    network: "eip155:8453",
    asset: USDC.address,
    amount: (skill === null ? API_PRICE : priceOf(skill)).toString(),
    payTo: treasury,
    maxTimeoutSeconds: API_TIMEOUT_SECONDS,
    extra: { name: USDC.eip712.name, version: USDC.eip712.version },
  } as const;
}

export type ApiRequirements = NonNullable<ReturnType<typeof apiRequirements>>;
