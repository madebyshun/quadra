/**
 * The only file that knows the product's *name*. Everything a user reads — copy,
 * titles, error messages, the token ticker — routes through here, so renaming the
 * product is this file plus `mv` on the repo directory.
 *
 * Named after the Macintosh Quadra (1991). The name sets the era the whole
 * interface is drawn in.
 *
 * ── 🔴 Some strings deliberately do NOT come from here, and must not ──────────
 * These are identifiers written into data that already exists, so they are frozen at
 * the value they shipped with and a rename must leave them alone: `PINS_KEY` in
 * `lib/pins.ts`, `SPEND_KEY` in `lib/spendGuard.ts` and `WALLET_KEY` in
 * `ui/WalletProvider.tsx` — localStorage keys. Template one and a rename silently forgets
 * every payee a user confirmed, resets their spending record to "nothing signed today",
 * or forgets which wallet they picked.
 *
 * (Four more — the note store key, the hash domain tag, the backup format and the
 * empty-leaf preimage — belonged to the privacy model and were archived with it on
 * 2026-09-30; see archive/privacy/.)
 *
 * The distinction is not "brand vs internal", it is **prose vs identifier**: a
 * name shown to a person may change, a name that some byte on a disk or on chain
 * is already keyed to may not. `tests/brand.test.ts` catches the leak in the first
 * direction.
 */
export const BRAND = {
  name: "Quadra",
  /** lowercase, url + package safe */
  slug: "quadra",
  ticker: "$QUADRA",
  domain: "quadra.computer",
  /**
   * The one-line pitch, second person, no jargon.
   *
   * Rewritten 2026-09-30 when the owner repositioned the product as an "on-chain
   * supercomputer" and dropped the privacy model, and again the same day when send, swap,
   * bridge and launch were built; on 2026-10-02 bridge (hidden with Robinhood Chain) and
   * transaction lookups (deleted with the basic skills) left it. "In development" in the blurb
   * stays load-bearing: nothing is deployed and nothing has been audited.
   * `index.html` repeats this and the blurb verbatim; `tests/brand.test.ts` keeps them equal.
   */
  tagline:
    "An on-chain supercomputer for Base. Look up any token or wallet, scan for traps before you act, then send, swap or launch a coin — every action checked before it reaches your wallet, and signed there. It never holds your key.",
  /** shorter, for og:description and link previews — and says it is not finished */
  blurb: "An on-chain supercomputer for Base: research, safety scans, send, swap and launch — signed in your own wallet. In development.",
  /** name the MCP server registers itself under */
  mcpServer: "quadra",
  /** tool namespace: every MCP tool is `quadra_<verb>` */
  toolPrefix: "quadra",
  x: "@quadra_computer",
} as const;

export type Brand = typeof BRAND;
