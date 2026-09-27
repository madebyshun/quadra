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
  localStorage.clear();
});
