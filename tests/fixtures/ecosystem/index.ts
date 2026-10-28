/**
 * Captured 2026-10-22 from base.org's own ecosystem list — the file behind https://www.base.org/ecosystem:
 *
 *     curl -s https://raw.githubusercontent.com/base/web/master/apps/web/src/data/ecosystem.json
 *
 * 598 entries; the file's last commit was 82b0f0a (2026-03-03). `picked.json` is those entries trimmed
 * to the 84 Explore Base was built from, NOT edited — `src/config/baseApps.ts` is tested against it.
 * Two of them (Aerodrome Finance, Uniswap) list an `http://` URL and are left out of the folder on
 * purpose: a link from this app opens https only.
 */
import picked from "./picked.json";

export type EcosystemEntry = {
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly imageUrl: string;
  readonly category: string;
  readonly subcategory: string;
};

export const ECOSYSTEM: readonly EcosystemEntry[] = picked;
