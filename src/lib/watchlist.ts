import { DEFAULT_WATCH, watchKey, type Watch } from "@/config/markets";
import { checkAddress } from "@/lib/address";

/**
 * The assets the Markets gadget and window watch, kept in this browser.
 *
 * `WATCH_KEY` is a frozen identifier like `PINS_KEY` (tests/brand.test.ts) — written out, never
 * templated from the brand. Unlike pins and spending limits this is a display preference, not a
 * safety record, so an unreadable or tampered value falls back to the default list instead of
 * throwing: the worst outcome is seeing ETH and TSLA again. Each entry is re-validated on load —
 * a token by a readable address, a stock by a plain symbol — so nothing odd reaches a URL.
 */
export const WATCH_KEY = "quadra.watch.v1";

const SYMBOL = /^[A-Z0-9.]{1,12}$/;

function valid(v: unknown): Watch | null {
  if (typeof v !== "object" || v === null) return null;
  const w = v as Record<string, unknown>;
  if ((w.kind === "stock" || w.kind === "basestock") && typeof w.symbol === "string" && SYMBOL.test(w.symbol)) {
    return { kind: w.kind, symbol: w.symbol };
  }
  if (w.kind === "token" && typeof w.address === "string" && typeof w.label === "string") {
    const checked = checkAddress(w.address);
    if (checked.kind === "checksummed" || checked.kind === "unchecked") {
      return { kind: "token", address: w.address, label: w.label.slice(0, 12) };
    }
  }
  return null;
}

export function loadWatch(storage: Storage = localStorage): Watch[] {
  try {
    const raw = storage.getItem(WATCH_KEY);
    if (raw === null) return [...DEFAULT_WATCH];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [...DEFAULT_WATCH];
    const seen = new Set<string>();
    return list.flatMap((v) => {
      const w = valid(v);
      if (w === null || seen.has(watchKey(w))) return [];
      seen.add(watchKey(w));
      return [w];
    });
  } catch {
    return [...DEFAULT_WATCH];
  }
}

export function saveWatch(list: readonly Watch[], storage: Storage = localStorage): void {
  try {
    storage.setItem(WATCH_KEY, JSON.stringify(list));
  } catch {
    // a browser that refuses storage just does not remember the list
  }
}
