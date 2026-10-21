import { USDC, WETH } from "@/config/chain";
import { BLOCKSCOUT, type TokenBalance } from "@/skills/blockscout";
import { tokenAmount } from "@/skills/format";
import { getJson } from "@/skills/http";
import { bigOf, isObj, listOf, numOf, objAt, strOf } from "@/skills/json";
import type { Launch } from "@/skills/launchpad";

/**
 * A wallet as a person sees it: what it holds, what it launched here, and what moved through it —
 * with the LURES called out. MEASURED 2026-10-02 on the owner's own wallet: its token history was
 * an address-poisoning campaign — a token named "ETH" that is not ETH, and "E឵Τ឵H", "ꓴ឵ՏᎠ឵Ꮳ",
 * "U឵S឵Dꓚ" built from look-alike letters and the invisible U+17B5, each "sent" from the wallet to an
 * address made to share its first and last characters with one the owner really uses. Listing those
 * as ordinary activity would hand the attacker the click they paid for.
 */

export type Moved = {
  readonly at: Date | null;
  readonly token: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly from: string;
  readonly to: string;
  readonly raw: bigint;
  readonly tx: string;
  /** USD per whole token, as Blockscout has it */
  readonly price: number | null;
};

/** One page of Blockscout's token transfers for an address; a row missing what makes it a transfer is skipped. */
export function parseTransfers(body: unknown): Moved[] {
  return listOf(isObj(body) ? body.items : null).flatMap((i) => {
    if (!isObj(i)) return [];
    const token = objAt(i, "token");
    const address = strOf(token.address_hash);
    const from = strOf(objAt(i, "from").hash);
    const to = strOf(objAt(i, "to").hash);
    const raw = bigOf(objAt(i, "total").value);
    const decimals = numOf(objAt(i, "total").decimals) ?? numOf(token.decimals);
    if (!address || !from || !to || raw === null || decimals === null) return [];
    const at = Date.parse(strOf(i.timestamp) ?? "");
    return [
      {
        at: Number.isNaN(at) ? null : new Date(at),
        token: address,
        symbol: strOf(token.symbol) ?? "?",
        decimals,
        from,
        to,
        raw,
        tx: strOf(i.transaction_hash) ?? "",
        price: numOf(token.exchange_rate),
      },
    ];
  });
}

export async function transfersOf(address: string): Promise<Moved[]> {
  return parseTransfers(await getJson("Blockscout", `${BLOCKSCOUT}/addresses/${address}/token-transfers?type=ERC-20`));
}

/**
 * The symbols worth impersonating, and the one real contract behind each — from verified config
 * (hard rule 1). ETH has no contract at all: any TOKEN called ETH is not ETH.
 */
const REAL: ReadonlyMap<string, string | null> = new Map([
  ["ETH", null],
  ["WETH", WETH.address.toLowerCase()],
  ["USDC", USDC.address.toLowerCase()],
]);

/** Why a token is a lure, or `null`. A ticker never identifies a token (hard rule 2), so a famous one at the wrong address is the tell. */
export function lureOf(symbol: string, token: string): string | null {
  // anything outside printable ASCII: look-alike letters (Cyrillic, Lisu, Armenian…) and invisible marks
  if (/[^\x20-\x7e]/.test(symbol)) return "its name is built from look-alike or invisible characters";
  const real = REAL.get(symbol.toUpperCase());
  if (real === undefined) return null;
  if (real === null) return `it calls itself ${symbol}, but ETH is not a token`;
  return real === token.toLowerCase() ? null : `it calls itself ${symbol}, but it is not ${symbol}'s contract`;
}

export type ActivityItem = {
  readonly at: Date | null;
  readonly text: string;
  readonly tone?: "bad";
  readonly tx: string;
};

/** What moved, newest first, in words: launches here, the wallet's token movements, and every lure named as one. */
export function activityOf(address: string, moved: readonly Moved[], launched: readonly Launch[], coins: ReadonlySet<string>): ActivityItem[] {
  const me = address.toLowerCase();
  const items: ActivityItem[] = launched.map((l) => ({ at: l.at, text: `Launched a coin here — ${l.token}`, tx: l.tx }));
  for (const m of moved) {
    const out = m.from.toLowerCase() === me;
    const amount = `${tokenAmount(m.raw, m.decimals, 4)} ${m.symbol}`;
    const lure = lureOf(m.symbol, m.token);
    if (lure) {
      items.push({
        at: m.at,
        tone: "bad",
        text: out
          ? `Fake transfer of "${m.symbol}" made to look like you sent it to ${m.to} — ${lure}. Address poisoning: never copy an address from your history.`
          : `Fake "${m.symbol}" received from ${m.from} — ${lure}. Do not interact with it.`,
        tx: m.tx,
      });
      continue;
    }
    const coin = coins.has(m.token.toLowerCase());
    const note = coin ? " (a coin launched here)" : "";
    // something nobody asked for, with no price: the usual shape of an airdropped lure
    const airdrop = !out && !coin && m.price === null ? " — no price: an unsolicited airdrop, most likely; never approve it" : "";
    items.push({ at: m.at, text: out ? `Sent ${amount}${note} to ${m.to}` : `Received ${amount}${note} from ${m.from}${airdrop}`, tx: m.tx });
  }
  const when = (i: ActivityItem) => i.at?.getTime() ?? 0;
  return items.sort((a, b) => when(b) - when(a));
}

export type Holding = {
  readonly token: string;
  readonly symbol: string;
  readonly amount: string;
  /** USD, or `null` when the token has no price that could be read */
  readonly usd: number | null;
  readonly coin: boolean;
};

/**
 * What a wallet holds that is worth showing: priced tokens, and coins launched here (valued from
 * their pools by `coinUsd` — Blockscout has no price for them). Everything else is unpriced and
 * mostly airdropped lures (MEASURED: 35 of the owner's 36 tokens), so it is COUNTED, never listed.
 */
export function holdingsOf(
  balances: readonly TokenBalance[],
  coins: ReadonlySet<string>,
  coinUsd: (token: string) => number | null,
): { readonly shown: Holding[]; readonly hidden: number } {
  const shown: Holding[] = [];
  let hidden = 0;
  for (const b of balances) {
    if (b.raw === 0n) continue;
    const coin = coins.has(b.token.toLowerCase());
    if ((b.price === null && !coin) || lureOf(b.symbol, b.token)) {
      hidden++;
      continue;
    }
    const whole = Number(b.raw) / 10 ** b.decimals;
    const per = coin ? coinUsd(b.token) : b.price;
    shown.push({ token: b.token, symbol: b.symbol, amount: tokenAmount(b.raw, b.decimals, 4), usd: per === null ? null : whole * per, coin });
  }
  const worth = (h: Holding) => h.usd ?? -1;
  shown.sort((a, b) => worth(b) - worth(a));
  return { shown, hidden };
}
