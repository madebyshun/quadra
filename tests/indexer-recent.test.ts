import { describe, expect, it, vi } from "vitest";
import { CONTRACTS } from "@/config/chain";
import { launchpadCoins } from "@/adapters/http/indexer";
import { LAUNCHED_TOPIC } from "@/skills/launchpad";
import { json } from "./net";

/**
 * When the server's index is behind the chain, the newest v3 launches are read from Blockscout's
 * record of the factory's `Launched` logs and put first — known by their address, creator and pool
 * only; everything the index would have measured stays absent.
 */
const word = (hex: string) => `0x${hex.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
const TOKEN = "0xb200000000000000000000000000000000000001";
const OLD = "0xb200000000000000000000000000000000000002";
const CREATOR = "0x1111111111111111111111111111111111111111";
const launched = (token: string, block: unknown, tx?: string) => ({ topics: [LAUNCHED_TOPIC, word(token), word(CREATOR), word("ab")], block_number: block, ...(tx ? { transaction_hash: tx } : {}) });
const indexed = { token: OLD, factory: CONTRACTS.launchFactoryV3, creator: CREATOR, poolId: word("cd"), launchBlock: 100, launchedAt: 1, launchTx: "0x01", trades: 0, trades24h: 0, traders24h: 0, tradersPending24h: 0 };

function serve(behind: number, logs: unknown) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(url);
    if (url.startsWith("/api/launchpad/coins")) return json({ syncedTo: 100, behind, error: null, coins: [indexed], creators: [] });
    return logs instanceof Error ? (() => { throw logs; })() : logs instanceof Response ? logs : json(logs);
  });
  return asked;
}

describe("the index, caught up from the factory's own logs", () => {
  it("puts launches the index has not read yet first, once each, and skips what is not a launch", async () => {
    const asked = serve(50, {
      items: [
        launched(TOKEN, "200", "0xbeef"),
        launched(TOKEN, "200"), // the same launch twice
        launched(OLD, "100"), // already indexed
        { topics: ["0xdead", word(TOKEN), word(CREATOR), word("ab")] }, // another event
        { topics: [LAUNCHED_TOPIC, word(TOKEN)] }, // too short
        { topics: [LAUNCHED_TOPIC, "0xzz", word(CREATOR), word("ab")] }, // no token address in it
        { topics: [LAUNCHED_TOPIC, word(TOKEN), "0xzz", word("ab")] }, // no creator address in it
        "not an object",
        { ...launched("0xb200000000000000000000000000000000000003", null) }, // no block: read as 0, last
      ],
    });
    const index = await launchpadCoins();
    expect(asked[1]).toBe(`https://base.blockscout.com/api/v2/addresses/${CONTRACTS.launchFactoryV3}/logs`);
    expect(index.coins.map((c) => [c.token.toLowerCase(), c.launchBlock])).toEqual([[TOKEN, 200], [OLD, 100], ["0xb200000000000000000000000000000000000003", 0]]);
    expect(index.coins[0]).toMatchObject({ creator: CREATOR, launchTx: "0xbeef", symbol: null, price: null, trades: 0 });
    expect(index.coins[2]!.launchTx).toBe("");
  });

  it("leaves the index as it is when it is current, or the logs are refused, empty, malformed or unreachable", async () => {
    for (const [behind, logs] of [[0, { items: [launched(TOKEN, "200")] }], [50, new Response("", { status: 429 })], [50, { items: [] }], [50, []], [50, new Error("offline")]] as const) {
      const asked = serve(behind, logs);
      const index = await launchpadCoins();
      expect(index.coins.map((c) => c.token.toLowerCase())).toEqual([OLD]);
      expect(asked).toHaveLength(behind === 0 ? 1 : 2);
    }
  });
});
