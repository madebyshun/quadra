/**
 * The only file that knows the product's *name*. Everything a user reads — copy,
 * titles, error messages, the token ticker — routes through here, so renaming the
 * product is this file plus `mv` on the repo directory.
 *
 * Named after the Macintosh Quadra (1991). The name is load-bearing twice: it
 * sets the era the whole interface is drawn in, and the token pairs against
 * tokenized Apple stock on Base.
 *
 * ── 🔴 Four strings deliberately do NOT come from here, and must not ──────────
 * This header used to end "nothing else hardcodes a brand string", which was
 * false, and false in the expensive direction: it reads as an invitation to grep
 * for the slug and template whatever turns up. These four are identifiers written
 * into data that already exists, so they are frozen at the value they shipped
 * with and a rename must leave them alone:
 *
 * - `STORE_KEY` in `adapters/local/store.ts` — the localStorage key. Template it
 *   and a rename makes every existing user's pool invisible. Their money is still
 *   on disk under the old key, and the app reports an empty pool.
 * - the domain tag in `lib/hash.ts` — baked into every commitment and nullifier.
 *   Template it and every note ever created changes identity: unspendable notes,
 *   un-restorable backups, and a hash that no longer matches the deployed pool.
 * - `BACKUP_FORMAT` in `lib/backup.ts` — matched exactly against files on users'
 *   disks, so templating it rejects every backup taken before the rename.
 * - the empty-leaf preimage quoted in `lib/tree.ts` and `adapters/local/pool.ts` —
 *   it has to keep agreeing with the contract, which does not read this file.
 *
 * The distinction is not "brand vs internal", it is **prose vs identifier**: a
 * name shown to a person may change, a name that some byte on a disk or on chain
 * is already keyed to may not. `tests/brand.test.ts` catches the leak in the first
 * direction; `tests/hash.test.ts` and `tests/adapters.test.ts` pin the two worst
 * cases of the second with literal vectors, because a test that imports the
 * constant it is checking would stay green through exactly this mistake.
 */
export const BRAND = {
  name: "Quadra",
  /** lowercase, url + package safe */
  slug: "quadra",
  ticker: "$QUADRA",
  domain: "quadra.computer",
  /** the one-line pitch, second person, no jargon */
  tagline:
    "Quadra trades, pays and routes on Base without leaving a trail. Private swaps, private payments, a payment router for agents, and all of it as MCP tools.",
  /** shorter, for og:description and link previews */
  blurb: "Private swaps, private payments and a payment router for agents, on Base.",
  /** prefix for a serialized note handed between wallets */
  notePrefix: "quadra-note-v1:",
  /** name the MCP server registers itself under */
  mcpServer: "quadra",
  /** tool namespace: every MCP tool is `quadra_<verb>` */
  toolPrefix: "quadra",
  x: "@quadra_computer",
} as const;

export type Brand = typeof BRAND;
