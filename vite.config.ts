import { defineConfig, type Plugin } from "vitest/config";
import { loadEnv, type Connect } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { anyPublicHttps, forward, FORWARD_PATH } from "./src/server/forward";
import { stocksHandler, STOCKS_PATH } from "./src/server/stocks";
import { chartsHandler, CHARTS_PATH } from "./src/server/charts";
import { logoHandler, LOGO_PATH } from "./src/server/logo";
import { weekendHandler, WEEKEND_PATH } from "./src/server/weekend";
import { regionHandler, REGION_PATH } from "./src/server/region";
import { EXPLAIN_PATH } from "./src/server/explainPath";
import type { explainHandler } from "./src/server/explain";
import { cdpFacilitator, type CdpCredentials } from "./src/server/cdp";
import { API_PATH } from "./src/server/apiPath";
import type { apiHandler } from "./src/server/api";
import { INDEXER_PATH } from "./src/server/indexerPath";
import type { indexerHandler } from "./src/server/indexer";

/** Node plumbing: an `IncomingMessage` as a `Request`, a `Response` written back as bytes. */
function asMiddleware(base: string, handle: (request: Request) => Promise<Response>): Connect.NextHandleFunction {
  return (req, res) => {
    const chunks: string[] = [];
    req.setEncoding("utf8");
    req.on("data", (c: string) => chunks.push(c));
    req.on("end", () => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(name, value);
      }
      const method = req.method ?? "GET";
      const request = new Request(`http://localhost${base}${req.url ?? ""}`, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? null : chunks.join(""),
      });
      void handle(request).then(async (answer) => {
        res.statusCode = answer.status;
        answer.headers.forEach((value, name) => res.setHeader(name, value));
        res.end(Buffer.from(await answer.arrayBuffer()));
      });
    });
  };
}

/**
 * The dev server's own small routes: Robinhood's and Coinbase's stock APIs (no CORS) and the
 * shared chart cache. (o1's launch route lived here until 2026-10-02 — see archive/o1/.)
 */
function devRoutes(): Plugin {
  return {
    name: "dev-routes",
    configureServer(server) {
      /** Robinhood's stock prices, which send no CORS header — `src/server/stocks.ts`. */
      server.middlewares.use(STOCKS_PATH, asMiddleware(STOCKS_PATH, stocksHandler()));
      /** GeckoTerminal's candles, cached and shared across tabs — `src/server/charts.ts`. */
      server.middlewares.use(CHARTS_PATH, asMiddleware(CHARTS_PATH, chartsHandler()));
      /** A token's logo for the share card, from this origin — `src/server/logo.ts`. */
      server.middlewares.use(LOGO_PATH, asMiddleware(LOGO_PATH, logoHandler()));
      /** Blue Agent's weekend record, which sends no CORS header — `src/server/weekend.ts`. */
      server.middlewares.use(WEEKEND_PATH, asMiddleware(WEEKEND_PATH, weekendHandler()));
      /** The visitor's country — Vercel's header; none on the dev server — `src/server/region.ts`. */
      server.middlewares.use(REGION_PATH, asMiddleware(REGION_PATH, regionHandler()));
    },
  };
}

/**
 * Plain-English report explanation via Venice (`src/server/explain.ts`): loaded through the SSR
 * loader because it runs skills server-side, with ONE handler kept per loaded module for cache and rate limit.
 */
function devExplain(env: Record<string, string>): Plugin {
  return {
    name: "dev-explain",
    configureServer(server) {
      let held: { mod: unknown; handle: ReturnType<typeof explainHandler> } | null = null;
      server.middlewares.use(EXPLAIN_PATH, (req, res, next) => {
        server.ssrLoadModule("/src/server/explain.ts").then((mod) => {
          const make = (mod as { explainHandler: typeof explainHandler }).explainHandler;
          if (held?.mod !== make) held = { mod: make, handle: make({ apiKey: env.VENICE_API_KEY, model: env.VENICE_MODEL }) };
          asMiddleware(EXPLAIN_PATH, held.handle)(req, res, next);
        }, next);
      });
    },
  };
}

/**
 * Quadra's own paid API (`src/server/api.ts`), with the CDP facilitator built from the owner's
 * key in `.env.local` — server-only (hard rule 14). The handler imports the
 * skills, which use the app's `@/` alias, so it is loaded through Vite's SSR loader per request
 * rather than imported here (this file is bundled without that alias).
 */
function devApi(creds: CdpCredentials | null): Plugin {
  return {
    name: "dev-api",
    configureServer(server) {
      const facilitator = creds ? cdpFacilitator(creds) : null;
      server.middlewares.use(API_PATH, (req, res, next) => {
        server.ssrLoadModule("/src/server/api.ts").then(
          (mod) => asMiddleware(API_PATH, (mod as { apiHandler: typeof apiHandler }).apiHandler({ facilitator }))(req, res, next),
          next,
        );
      });
    },
  };
}

/**
 * The launchpad index (`src/server/indexer.ts`): loaded through the SSR loader like the API (it
 * imports the skills), and ONE handler kept per loaded module, because its state is the index.
 */
function devIndexer(): Plugin {
  return {
    name: "dev-indexer",
    configureServer(server) {
      let held: { mod: unknown; handle: ReturnType<typeof indexerHandler> } | null = null;
      server.middlewares.use(INDEXER_PATH, (req, res, next) => {
        server.ssrLoadModule("/src/server/indexer.ts").then((mod) => {
          // the module's FUNCTION identifies a reload — the namespace object is a new one per call (MEASURED)
          const make = (mod as { indexerHandler: typeof indexerHandler }).indexerHandler;
          if (held?.mod !== make) held = { mod: make, handle: make() };
          asMiddleware(INDEXER_PATH, held.handle)(req, res, next);
        }, next);
      });
    },
  };
}

/** The CDP key pair when BOTH halves are set — one without the other is no key. */
function cdpCredentials(env: Record<string, string>): CdpCredentials | null {
  return env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET ? { keyId: env.CDP_API_KEY_ID, secret: env.CDP_API_KEY_SECRET } : null;
}

/**
 * The forwarder, mounted on the dev server. All of the logic — policy, header allowlist,
 * refusals — is `src/server/forward.ts`, which is tested; this is only the Node plumbing
 * that turns an `IncomingMessage` into a `Request` and a `Response` back into bytes.
 *
 * Development only, and with the development policy (any public https host). A static
 * production build has no server; where production runs `forward`, and with which
 * allowlist, is TASKS.md T3.
 */
function devForwarder(): Plugin {
  return {
    name: "dev-forwarder",
    configureServer(server) {
      server.middlewares.use(FORWARD_PATH, asMiddleware(FORWARD_PATH, (request) => forward(request, anyPublicHttps)));
    },
  };
}

/**
 * Kept as a literal rather than imported from `@/config/upstream`, because this file
 * is loaded by Vite's own config pass, outside the `@` alias it is the one defining.
 */
const UPSTREAM = "https://blueagent.dev";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
  plugins: [react(), devForwarder(), devRoutes(), devApi(cdpCredentials(env)), devIndexer(), devExplain(env)],
  /**
   * Tests read NO .env file. MEASURED 2026-09-30: once the owner put a WalletConnect id in
   * `.env.local`, Vitest loaded it and the suite's behaviour (and coverage) depended on whose
   * machine ran it. The gate must behave the same on a bare clone, so in test mode the env dir
   * is `tests/`, which holds no .env file; a test that needs a value stubs it.
   */
  ...(mode === "test" ? { envDir: fileURLToPath(new URL("./tests", import.meta.url)) } : {}),
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
};
});
