import { CONTRACTS } from "@/config/chain";
import { BLUEAGENT } from "@/config/upstream";

/**
 * Who each origin is known to be paid to — the one thing a 402's `payTo` is
 * checked against before anything signs it.
 *
 * ── Why this is keyed by ORIGIN and not by a directory name ─────────────────────
 * The 402 is what names the payee, and the 402 comes from an origin. That is the
 * only identity the browser actually verified (TLS, same-origin rules), so it is the
 * only honest key for "who does this server say should be paid". A directory name is
 * a label this repo wrote; an origin is a fact about where the bytes came from.
 *
 * It used to be one constant, `BLUEAGENT.knownPayTo`, compared inside
 * `lib/requirements.ts` — which welded the product's payment checker to a single
 * upstream. With pins per origin the checker is generic, and BlueAgent is one row.
 *
 * ── Why a `Map` and not an object literal ───────────────────────────────────────
 * `obj["constructor"]` is `Object.prototype.constructor` — a function, typed here as
 * a string, for an origin nobody pinned. A lookup keyed by attacker-influenced text
 * must not be able to land on the prototype, and a `Map` has none.
 *
 * ⚠️ A pin is an ASSERTION, never a destination — same rule as before (see
 * `lib/requirements.ts`). The payee always comes from the live 402; this only says
 * whether it is the one expected. Paying the pin instead of the 402 would keep paying
 * an old address after a rotation, which is a silent misroute rather than an error.
 */
const PINNED: ReadonlyMap<string, string> = new Map([[BLUEAGENT.origin, BLUEAGENT.knownPayTo]]);

/**
 * The payee pinned for this origin, or `null` when nobody has pinned one. This app's OWN
 * origin is pinned to its own fee address: this app's paid API (`server/api.ts`) asks to be paid
 * there, and `CONTRACTS.treasury` is verified config — the pin is this build asserting its own
 * constant, not trusting a reply.
 */
export function pinnedPayee(origin: string): string | null {
  if (typeof location !== "undefined" && origin === location.origin && CONTRACTS.treasury !== null) return CONTRACTS.treasury;
  return PINNED.get(origin) ?? null;
}
