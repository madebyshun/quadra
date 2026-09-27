/**
 * The only file that knows the product's name. Renaming the project is this
 * file plus `mv` on the repo directory — nothing else hardcodes a brand string.
 *
 * Named after the Macintosh Quadra (1991). The name is load-bearing twice: it
 * sets the era the whole interface is drawn in, and the token pairs against
 * tokenized Apple stock on Base.
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
