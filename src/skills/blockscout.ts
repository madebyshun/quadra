import { getJson } from "@/skills/http";
import { bigOf, isObj, listOf, numOf, objAt, strOf } from "@/skills/json";

/**
 * Blockscout's public API for Base: the indexer behind wallet lookups, token holders,
 * contract ABIs and decoded transactions.
 *
 * MEASURED 2026-09-30 (`base.blockscout.com/api/v2`): every endpoint used here answers
 * `access-control-allow-origin: *`, so the browser reads it directly with no key. A
 * wallet's token list for a busy address came back with 12,736 entries in about six
 * seconds — 63 of them with `token: null`, 453 ERC-721 and 473 ERC-1155, and only 264
 * with a price. `holders` pages 50 at a time and does NOT carry the token's decimals.
 * `decoded_input` is `null` for calls into unverified contracts.
 *
 * Everything here is an INDEXER's view: seconds behind the chain, and only as complete as
 * what Blockscout has indexed. Reports say "Blockscout" in their sources for that reason.
 */

export const BLOCKSCOUT = "https://base.blockscout.com/api/v2";
const SERVICE = "Blockscout";

export type Party = {
  readonly address: string;
  /** an indexer label or a Basename, whichever Blockscout has — `null` when neither */
  readonly label: string | null;
  readonly isContract: boolean;
};

export function partyOf(v: unknown): Party | null {
  if (!isObj(v)) return null;
  const address = strOf(v.hash);
  if (!address) return null;
  return {
    address,
    label: strOf(v.ens_domain_name) ?? strOf(v.name),
    isContract: v.is_contract === true,
  };
}

export type TokenBalance = {
  readonly token: string;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly raw: bigint;
  /** USD per whole token, as Blockscout has it — `null` when it has no price */
  readonly price: number | null;
};

/**
 * ERC-20 balances only. NFTs (ERC-721/1155) and the entries whose `token` is `null` are
 * dropped here — a balance in "units" of an NFT collection is not money.
 */
export function parseTokenBalances(body: unknown): TokenBalance[] {
  const out: TokenBalance[] = [];
  for (const item of listOf(body)) {
    const token = objAt(item, "token");
    const address = strOf(token.address_hash);
    const decimals = numOf(token.decimals);
    const raw = bigOf(isObj(item) ? item.value : null);
    if (token.type !== "ERC-20" || !address || decimals === null || raw === null) continue;
    out.push({
      token: address,
      symbol: strOf(token.symbol) ?? "?",
      name: strOf(token.name) ?? "?",
      decimals,
      raw,
      price: numOf(token.exchange_rate),
    });
  }
  return out;
}

/**
 * Priced ERC-20s by USD value, largest first. Only PRICED, because MEASURED 2026-09-30 a famous
 * wallet held 12,736 token entries and a price for 264: the rest are unsolicited airdrops, some
 * named to lure the holder into approving a drain, and listing them would put the lure on screen.
 */
export function priced(balances: readonly TokenBalance[]): { token: TokenBalance; value: number }[] {
  return balances
    .filter((b) => b.price !== null && b.raw > 0n)
    .map((b) => ({ token: b, value: (Number(b.raw) / 10 ** b.decimals) * (b.price as number) }))
    .sort((a, b) => b.value - a.value);
}

export async function tokenBalances(address: string): Promise<TokenBalance[]> {
  return parseTokenBalances(await getJson(SERVICE, `${BLOCKSCOUT}/addresses/${address}/token-balances`));
}

export type TokenInfo = {
  readonly address: string;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly totalSupply: bigint | null;
  readonly holders: number | null;
  readonly price: number | null;
  readonly type: string | null;
};

export function parseToken(body: unknown): TokenInfo | null {
  if (!isObj(body)) return null;
  const address = strOf(body.address_hash);
  const decimals = numOf(body.decimals);
  if (!address || decimals === null) return null;
  return {
    address,
    symbol: strOf(body.symbol) ?? "?",
    name: strOf(body.name) ?? "?",
    decimals,
    totalSupply: bigOf(body.total_supply),
    holders: numOf(body.holders_count),
    price: numOf(body.exchange_rate),
    type: strOf(body.type),
  };
}

export async function tokenInfo(address: string): Promise<TokenInfo | null> {
  return parseToken(await getJson(SERVICE, `${BLOCKSCOUT}/tokens/${address}`));
}

export type Holding = { readonly holder: Party; readonly raw: bigint };

export function parseHolders(body: unknown): Holding[] {
  const out: Holding[] = [];
  for (const item of listOf(isObj(body) ? body.items : null)) {
    const holder = partyOf(isObj(item) ? item.address : null);
    const raw = bigOf(isObj(item) ? item.value : null);
    if (holder && raw !== null) out.push({ holder, raw });
  }
  return out;
}

export async function topHolders(token: string): Promise<Holding[]> {
  return parseHolders(await getJson(SERVICE, `${BLOCKSCOUT}/tokens/${token}/holders`));
}
