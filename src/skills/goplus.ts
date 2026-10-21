import { getJson } from "@/skills/http";
import { isObj, listOf, numOf, objAt, strOf } from "@/skills/json";

/**
 * GoPlus Security's token scan for Base (chain id 8453).
 *
 * MEASURED 2026-09-30 — and the part that shapes every line below: the set of fields
 * GoPlus returns DEPENDS ON THE TOKEN. For DEGEN it returned the full set (`is_honeypot`,
 * `is_mintable`, `hidden_owner`, `transfer_pausable`, …, all "0"/"1" strings). For BRTC, a
 * native B20, it returned fourteen fields and none of the honeypot flags. An unknown
 * address answers `{"result": {}}`. So a flag is three-valued — yes / no / NOT CHECKED —
 * and "not checked" must never render as "no": a scan that could not look reads exactly
 * like a clean one otherwise. It answers CORS by echoing the requesting origin.
 */

const SERVICE = "GoPlus";

/** "1" is yes, "0" is no, anything else — absent, empty — is not checked. */
export type Flag = "yes" | "no" | "unknown";

export function flagOf(v: unknown): Flag {
  return v === "1" ? "yes" : v === "0" ? "no" : "unknown";
}

export type Scan = {
  readonly honeypot: Flag;
  readonly cannotSellAll: Flag;
  readonly mintable: Flag;
  readonly hiddenOwner: Flag;
  readonly ownerCanChangeBalance: Flag;
  readonly takeBackOwnership: Flag;
  readonly transferPausable: Flag;
  readonly blacklist: Flag;
  readonly slippageModifiable: Flag;
  readonly proxy: Flag;
  readonly openSource: Flag;
  readonly selfdestruct: Flag;
  /** fractions, e.g. 0.05 for 5% — `null` when not reported */
  readonly buyTax: number | null;
  readonly sellTax: number | null;
  readonly holders: number | null;
  /** the largest holder's share of supply, 0..1 */
  readonly topHolderShare: number | null;
  readonly owner: string | null;
};

/** The scan for `token`, or `null` when GoPlus has nothing on it. */
export function parseScan(body: unknown, token: string): Scan | null {
  const result = objAt(body, "result");
  const r = objAt(result, token.toLowerCase());
  if (Object.keys(r).length === 0) return null;
  const top = listOf(r.holders)[0];
  return {
    honeypot: flagOf(r.is_honeypot),
    cannotSellAll: flagOf(r.cannot_sell_all),
    mintable: flagOf(r.is_mintable),
    hiddenOwner: flagOf(r.hidden_owner),
    ownerCanChangeBalance: flagOf(r.owner_change_balance),
    takeBackOwnership: flagOf(r.can_take_back_ownership),
    transferPausable: flagOf(r.transfer_pausable),
    blacklist: flagOf(r.is_blacklisted),
    slippageModifiable: flagOf(r.slippage_modifiable),
    proxy: flagOf(r.is_proxy),
    openSource: flagOf(r.is_open_source),
    selfdestruct: flagOf(r.selfdestruct),
    buyTax: numOf(r.buy_tax),
    sellTax: numOf(r.sell_tax),
    holders: numOf(r.holder_count),
    topHolderShare: isObj(top) ? numOf(top.percent) : null,
    owner: strOf(r.owner_address),
  };
}

export async function scan(token: string): Promise<Scan | null> {
  const body = await getJson(
    SERVICE,
    `https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${token}`,
  );
  return parseScan(body, token);
}
