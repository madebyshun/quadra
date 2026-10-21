/**
 * Where the launchpad index lives. Its own file for the same reason as `apiPath.ts`: `vite.config.ts`
 * and the browser client need the path, and `server/indexer.ts` imports the skills through the app's
 * `@/` alias, which Vite's config pass does not have — so the handler is loaded through the SSR loader.
 */
export const INDEXER_PATH = "/api/launchpad";
