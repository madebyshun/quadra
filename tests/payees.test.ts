import { describe, expect, it } from "vitest";
import { pinnedPayee } from "@/config/payees";
import { BLUEAGENT } from "@/config/upstream";

describe("pinned payees", () => {
  it("pins BlueAgent's published payee to BlueAgent's origin", () => {
    expect(pinnedPayee(BLUEAGENT.origin)).toBe(BLUEAGENT.knownPayTo);
  });

  it("has no pin for an origin nobody pinned", () => {
    expect(pinnedPayee("https://elsewhere.example")).toBeNull();
  });

  /** An origin is compared exactly: a path or a trailing slash is a different string, not a looser match. */
  it("does not match a url that merely starts with a pinned origin", () => {
    expect(pinnedPayee(`${BLUEAGENT.origin}/`)).toBeNull();
    expect(pinnedPayee(`${BLUEAGENT.origin}.evil.example`)).toBeNull();
  });

  /**
   * 🔴 Why the table is a Map. On a plain object, `["constructor"]` is
   * `Object.prototype.constructor` — a function the type system calls a string — so an
   * origin nobody pinned would come back "pinned" to something that is not an address.
   */
  it("cannot be tricked into returning a prototype member", () => {
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(pinnedPayee(key)).toBeNull();
    }
  });
});
