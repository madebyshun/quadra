import { useEffect, useState } from "react";
import { baseStocks } from "@/adapters/http/markets";

/**
 * Is this visitor somewhere Coinbase's stock tokens are not offered? (2026-11-13.) Coinbase: its
 * tokenized stocks are "only for eligible persons outside the U.S." The country comes from the host
 * (`/api/region`, server/region.ts). The United States and its territories are restricted.
 *
 * 🔴 A country that could not be read is NOT a pass and NOT a block: the windows keep saying who
 * may hold a stock, exactly as before, and the visitor decides. Only a read "US" closes the door.
 */

/** The U.S. and its territories, as ISO 3166-1 alpha-2. */
export const RESTRICTED: ReadonlySet<string> = new Set(["US", "PR", "GU", "VI", "AS", "MP", "UM"]);

export const RESTRICTED_TEXT = "Coinbase's tokenized stocks are not offered where you are (the U.S. and its territories), so this app does not quote, trade or launch them here.";

let asked: Promise<string | null> | null = null;

/** The visitor's country as the host read it, once per page; `null` when it could not be read. */
export function countryOf(): Promise<string | null> {
  // started inside a promise, so even a fetch that throws at once reads as "unread", never as a crash
  asked ??= Promise.resolve()
    .then(() => fetch("/api/region", { headers: { "x-quadra": "1" } }))
    .then((r) => (r.ok ? (r.json() as Promise<{ country?: unknown }>) : { country: null }))
    .then((b) => (typeof b.country === "string" ? b.country : null))
    .catch(() => null);
  return asked;
}

/** For tests: ask again. */
export function forgetRegion(): void {
  asked = null;
}

/** Coinbase's stocks are B20 tokens, all at addresses starting with this (MEASURED on every listed one). */
const B20_PREFIX = "0xb2000000000000000000";

/**
 * Is `address` a Coinbase stock, as far as this page can tell? Against Coinbase's own list when it was
 * read; while it is not, any B20 address counts — when the door is shut, a doubt keeps it shut.
 */
export function isStock(address: string, stocks: ReadonlySet<string> | null): boolean {
  const a = address.trim().toLowerCase();
  return stocks ? stocks.has(a) : a.startsWith(B20_PREFIX);
}

export const isRestricted = (country: string | null): boolean => country !== null && RESTRICTED.has(country);

/** Whether stocks are closed to this visitor: `false` until the country is read, and whenever it cannot be. */
export function useStocksClosed(): boolean {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    let live = true;
    countryOf().then((c) => live && setClosed(isRestricted(c)));
    return () => {
      live = false;
    };
  }, []);
  return closed;
}

/** Coinbase's stock tokens on Base, lowercase — read only when `wanted`; `null` until then, and when the list could not be read. */
export function useStockAddresses(wanted: boolean): ReadonlySet<string> | null {
  const [set, setSet] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    baseStocks().then(
      (m) => live && setSet(new Set([...m.values()].map((s) => s.address.toLowerCase()))),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [wanted]);
  return set;
}
