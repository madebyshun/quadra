import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { forgetRegion } from "@/lib/region";

/**
 * No test reaches the network.
 *
 * `adapters()` returns `HttpCatalog`, so any test that mounts the real app would
 * otherwise call blueagent.dev for real — slow, flaky, and worse than either: a
 * panel that catches its own load failure would keep passing on a plane while
 * silently asserting nothing. A throwing `fetch` turns an unstubbed call into a
 * visible failure, and the tests that want a response stub this same global
 * themselves.
 */
/**
 * The Welcome screen opens on every bare desktop load; a test about something else would find a
 * dialog over it (and Q silent). It is switched off here, as a visitor who unticked it would; the
 * Welcome screen's own tests clear this.
 */
function installMemoryStorage() {
  if (typeof window === "undefined") return;
  const winStorage = window.localStorage;
  if (winStorage && typeof winStorage.getItem === "function") {
    Object.defineProperty(globalThis, "localStorage", { value: winStorage, configurable: true, writable: true });
    return;
  }
  const stores = new WeakMap<object, Map<string, string>>();
  const mapOf = (self: object) => {
    let m = stores.get(self);
    if (!m) {
      m = new Map<string, string>();
      stores.set(self, m);
    }
    return m;
  };
  const proto = typeof Storage !== "undefined" ? Storage.prototype : Object.prototype;
  Object.defineProperties(proto, {
    length: { get(this: object) { return mapOf(this).size; }, configurable: true },
    clear: { value(this: object) { mapOf(this).clear(); }, configurable: true, writable: true },
    getItem: { value(this: object, key: string) { return mapOf(this).get(String(key)) ?? null; }, configurable: true, writable: true },
    key: { value(this: object, index: number) { return Array.from(mapOf(this).keys())[index] ?? null; }, configurable: true, writable: true },
    removeItem: { value(this: object, key: string) { mapOf(this).delete(String(key)); }, configurable: true, writable: true },
    setItem: { value(this: object, key: string, value: string) { mapOf(this).set(String(key), String(value)); }, configurable: true, writable: true },
  });
  const storage = Object.create(proto) as Storage;
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true, writable: true });
}
installMemoryStorage();

beforeEach(() => {
  if (typeof localStorage !== "undefined") localStorage.setItem("quadra.welcome.v1", "off");
});

beforeEach(() => {
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("fetch", () => {
    throw new Error(
      "This test called fetch without stubbing it. Stub globalThis.fetch with the response you mean to test.",
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  // the visitor's country is read once per page (lib/region.ts) — once per test here
  forgetRegion();
  // a server-side test runs under `@vitest-environment node`, which has no localStorage
  if (typeof localStorage !== "undefined") localStorage.clear();
});

/**
 * The page-wide block pulse (`lib/pulse.ts`) polls Base for as long as the taskbar is mounted —
 * which is every test that renders the desktop. Those tests are about something else, so the shared
 * store is swapped for one that never asks; a test about the pulse builds its own `pulseStore` and
 * hands it in through `PulseContext`.
 */
vi.mock("@/lib/pulse", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/pulse")>();
  return { ...real, PULSE: real.pulseStore(() => new Promise(() => {}), { set: () => 0, clear: () => {} }) };
});

/** jsdom does not lay out, so it has no scrollIntoView; every browser this app runs in does. */
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
/** jsdom does not implement 2d canvas; return null cleanly so canvas effects no-op without stderr noise. */
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}
