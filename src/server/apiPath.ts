/**
 * Where this app's own API lives. Its own file because `vite.config.ts` needs the path and
 * cannot import `server/api.ts`, which imports the skills — the config pass is bundled
 * without the app's `@/` alias, so the API handler is loaded through Vite's SSR loader instead.
 */
export const API_PATH = "/api/skills";
