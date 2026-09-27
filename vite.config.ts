import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Kept as a literal rather than imported from `@/config/upstream`, because this file
 * is loaded by Vite's own config pass, outside the `@` alias it is the one defining.
 */
const UPSTREAM = "https://blueagent.dev";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5273,
    /**
     * The forwarder a run needs. Upstream opens GET to any origin and does not open
     * POST at all, so every run — including the six that cost nothing — is blocked by
     * the browser unless it is same-origin. See `FORWARD` in `src/config/upstream.ts`
     * for the measured headers.
     *
     * Development only. A static production build has no server here, which is why
     * `HttpCatalog.run` inspects the body instead of the status: measured against this
     * repo's own `dist/`, an absent forwarder answers 501 with an HTML error page on a
     * plain static host and 200 with `index.html` on one doing SPA rewrites. Neither
     * status says "no forwarder", so only "does it parse as JSON" identifies it.
     */
    proxy: {
      "/upstream": {
        target: UPSTREAM,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/upstream/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // main.tsx is the createRoot call: nothing to assert that jsdom would not
      // just be re-running React itself.
      exclude: ["src/main.tsx", "src/**/*.d.ts"],
      // Reached on 2026-09-27 and pinned so it cannot slip back quietly. This
      // is a pre-launch product ("100% tested before launch"), so a drop here
      // should fail the run rather than show up as a slightly smaller number
      // nobody reads.
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
