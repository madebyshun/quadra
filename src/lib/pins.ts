import { checkAddress } from "@/lib/address";
import { pinnedPayee } from "@/config/payees";
import type { PinLookup } from "@/lib/requirements";

/**
 * Payees the USER has confirmed, per origin, kept in this browser.
 *
 * `config/payees.ts` pins what this build ships knowing. That covers one directory; the
 * x402 window can now pay any URL, and an origin nobody pinned is refused (`Payee` kind
 * `unpinned`) — which is right, and would mean no new server could ever be paid. This is
 * the deliberate way through: the user checks the address somewhere other than the
 * server's own reply and pins it. From then on a CHANGE of payee at that origin is caught
 * the same way a shipped pin catches one.
 *
 * 🔴 A shipped pin always wins. `withPin` refuses an origin `config/payees.ts` already
 * pins, and `lookupWith` asks config first — otherwise a user could be talked into
 * "confirming" a different payee for BlueAgent and override the one check this build
 * was shipped with.
 *
 * 🔴 An unreadable record THROWS rather than reading as empty. Empty would be safe here —
 * every origin would be unpinned and refused — but it would also be silent: the user's
 * confirmations would vanish with no reason given. The caller shows the reason and treats
 * every origin as unpinned, which is the same safety with the explanation attached.
 */

/**
 * A frozen identifier, like `STORE_KEY` — it names data already on users' disks, so it
 * is written out and never templated from the brand. See `brand.ts`'s header.
 */
export const PINS_KEY = "quadra.pins.v1";

export type UserPin = {
  readonly origin: string;
  readonly address: string;
  /** ISO time the user confirmed it. Shown, so an old confirmation reads as old. */
  readonly pinnedAt: string;
};

function isPin(value: unknown): value is UserPin {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.origin === "string" &&
    typeof p.address === "string" &&
    checkAddress(p.address).kind !== "malformed" &&
    typeof p.pinnedAt === "string"
  );
}

/** The confirmed payees in `storage`, `[]` when there are none, or a thrown reason. */
export function loadPins(storage: Storage): UserPin[] {
  const raw = storage.getItem(PINS_KEY);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!Array.isArray(parsed) || !parsed.every(isPin)) {
    throw new Error(
      "The payees you confirmed in this browser could not be read, so none of them are being " +
        "trusted. Every new server will ask to be confirmed again.",
    );
  }
  return parsed;
}

export function savePins(storage: Storage, pins: readonly UserPin[]): void {
  storage.setItem(PINS_KEY, JSON.stringify(pins));
}

/** `pins` with `origin` pinned to `address`, replacing any earlier confirmation for it. */
export function withPin(
  pins: readonly UserPin[],
  origin: string,
  address: string,
  now: Date,
): UserPin[] {
  if (pinnedPayee(origin) !== null) {
    throw new Error(
      `${origin} already has a payee this build ships with. It cannot be replaced from the ` +
        "browser — a shipped check that a page could overwrite would not be a check.",
    );
  }
  if (checkAddress(address).kind === "malformed") {
    throw new Error(`${address} is not an address, so it cannot be pinned.`);
  }
  return [...withoutPin(pins, origin), { origin, address, pinnedAt: now.toISOString() }];
}

export function withoutPin(pins: readonly UserPin[], origin: string): UserPin[] {
  return pins.filter((p) => p.origin !== origin);
}

/** The pin the user set for `origin`, if any. Shipped pins are not in here. */
export function userPinFor(pins: readonly UserPin[], origin: string): UserPin | null {
  return pins.find((p) => p.origin === origin) ?? null;
}

/** A lookup for `checkRequirements`: shipped pins first, then the user's. */
export function lookupWith(pins: readonly UserPin[]): PinLookup {
  return (origin) => pinnedPayee(origin) ?? userPinFor(pins, origin)?.address ?? null;
}
