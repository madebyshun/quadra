/**
 * The wallets whose stock loans this browser watches (2026-11-13, step 3 of the stocks plan:
 * liquidation alerts). Each entry is a wallet and the distance from liquidation, in percent, under
 * which Q speaks up. Kept in this browser only — nothing is sent anywhere, and nothing about a
 * wallet is stored but its address.
 *
 * `LOAN_WATCH_KEY` is a frozen identifier like `WATCH_KEY` (tests/brand.test.ts) — written out,
 * never templated: a byte on someone's disk is already keyed to it. An unreadable record is a
 * display preference lost, so it reads as "watching nothing", never as an error.
 */

export const LOAN_WATCH_KEY = "quadra.loanwatch.v1";
/** The most wallets watched — each is a full Collateral Watch read every `EVERY_MS`. */
export const MAX_WATCHED = 5;
/** Q speaks when the nearest loan is closer to liquidation than this, in percent. */
export const DEFAULT_THRESHOLD = 15;

export type Watched = { readonly wallet: string; readonly threshold: number };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function loadLoanWatch(storage: Storage | undefined = globalThis.localStorage): Watched[] {
  try {
    const raw = storage?.getItem(LOAN_WATCH_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter((w): w is Watched => typeof w === "object" && w !== null && ADDRESS.test(String((w as Watched).wallet)) && Number.isFinite((w as Watched).threshold) && (w as Watched).threshold > 0)
      .slice(0, MAX_WATCHED);
  } catch {
    return [];
  }
}

function save(list: readonly Watched[], storage: Storage | undefined): void {
  try {
    storage?.setItem(LOAN_WATCH_KEY, JSON.stringify(list));
  } catch {
    // a watch that cannot be saved is said by the caller: `watchLoan` returns what was kept
  }
}

/** Watch `wallet` (replacing its threshold if already watched). Returns the list as now kept. */
export function watchLoan(wallet: string, threshold = DEFAULT_THRESHOLD, storage: Storage | undefined = globalThis.localStorage): Watched[] {
  const rest = loadLoanWatch(storage).filter((w) => w.wallet.toLowerCase() !== wallet.toLowerCase());
  const list = [...rest, { wallet, threshold }].slice(-MAX_WATCHED);
  save(list, storage);
  return loadLoanWatch(storage);
}

export function unwatchLoan(wallet: string, storage: Storage | undefined = globalThis.localStorage): Watched[] {
  save(
    loadLoanWatch(storage).filter((w) => w.wallet.toLowerCase() !== wallet.toLowerCase()),
    storage,
  );
  return loadLoanWatch(storage);
}

export const isWatched = (wallet: string, list: readonly Watched[]): boolean => list.some((w) => w.wallet.toLowerCase() === wallet.toLowerCase());
