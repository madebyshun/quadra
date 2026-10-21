import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

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
beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error(
      "This test called fetch without stubbing it. Stub globalThis.fetch with the response you mean to test.",
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
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
