import { describe, expect, it } from "vitest";
import { loadPins, lookupWith, PINS_KEY, savePins, userPinFor, withoutPin, withPin, type UserPin } from "@/lib/pins";
import { BLUEAGENT } from "@/config/upstream";

const ORIGIN = "https://x402uselessfacts.vercel.app";
const PAYEE = "0xD7d49D6a12Ee3852f29A52A40908069bF4e48914";
const NOW = new Date("2026-09-29T08:00:00.000Z");

describe("confirming a payee", () => {
  it("pins an origin to an address, dated", () => {
    expect(withPin([], ORIGIN, PAYEE, NOW)).toEqual([{ origin: ORIGIN, address: PAYEE, pinnedAt: NOW.toISOString() }]);
  });

  it("replaces an earlier confirmation for the same origin rather than keeping two", () => {
    const first = withPin([], ORIGIN, "0x1111111111111111111111111111111111111111", NOW);
    const second = withPin(first, ORIGIN, PAYEE, NOW);
    expect(second).toHaveLength(1);
    expect(userPinFor(second, ORIGIN)?.address).toBe(PAYEE);
  });

  /** 🔴 A page must not be able to talk the user into overriding a shipped pin. */
  it("refuses to replace a payee the build ships with", () => {
    expect(() => withPin([], BLUEAGENT.origin, PAYEE, NOW)).toThrow(/already has a payee this build ships with/);
  });

  it("refuses something that is not an address", () => {
    expect(() => withPin([], ORIGIN, "0x123", NOW)).toThrow(/is not an address/);
  });

  it("forgets one origin and keeps the others", () => {
    const two = withPin(withPin([], ORIGIN, PAYEE, NOW), "https://x402.ottoai.services", PAYEE, NOW);
    expect(withoutPin(two, ORIGIN).map((p) => p.origin)).toEqual(["https://x402.ottoai.services"]);
    expect(userPinFor(withoutPin(two, ORIGIN), ORIGIN)).toBeNull();
  });
});

describe("the lookup the checker uses", () => {
  it("answers shipped pins first, then the user's, then nothing", () => {
    const lookup = lookupWith(withPin([], ORIGIN, PAYEE, NOW));
    expect(lookup(BLUEAGENT.origin)).toBe(BLUEAGENT.knownPayTo);
    expect(lookup(ORIGIN)).toBe(PAYEE);
    expect(lookup("https://nobody.example")).toBeNull();
  });

  /** Even a record that somehow holds a BlueAgent entry cannot outrank the shipped pin. */
  it("never lets a stored pin override a shipped one", () => {
    const smuggled: UserPin[] = [{ origin: BLUEAGENT.origin, address: PAYEE, pinnedAt: NOW.toISOString() }];
    expect(lookupWith(smuggled)(BLUEAGENT.origin)).toBe(BLUEAGENT.knownPayTo);
  });
});

describe("keeping them in the browser", () => {
  it("is empty when nothing was ever stored", () => {
    expect(loadPins(localStorage)).toEqual([]);
  });

  it("round-trips", () => {
    const pins = withPin([], ORIGIN, PAYEE, NOW);
    savePins(localStorage, pins);
    expect(loadPins(localStorage)).toEqual(pins);
  });

  /** Unreadable is said out loud, not quietly treated as "you confirmed nobody". */
  it("throws a reason for anything it cannot read", () => {
    for (const raw of ["not json", "{}", "[1]", JSON.stringify([{ origin: ORIGIN, address: "0x1", pinnedAt: "x" }]), JSON.stringify([{ origin: ORIGIN, address: PAYEE }])]) {
      localStorage.setItem(PINS_KEY, raw);
      expect(() => loadPins(localStorage), raw).toThrow(/could not be read, so none of them are being trusted/);
    }
  });

  it("uses the frozen key, not one built from the brand", () => {
    expect(PINS_KEY).toBe("quadra.pins.v1");
  });
});
