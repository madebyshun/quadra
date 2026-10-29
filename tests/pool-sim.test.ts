import { describe, expect, it, vi } from "vitest";
import { UNISWAP_V4 } from "@/config/uniswap";
import { approveData } from "@/lib/erc20";
import { buildSwap, permit2ApproveData, type LaunchPool } from "@/lib/v4swap";

const quoteV4 = vi.fn();
vi.mock("@/lib/v4swap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/v4swap")>()),
  quoteV4: (...a: unknown[]) => quoteV4(...a),
}));

const { poolRouter } = await import("@/skills/simulate");

/**
 * The verdict's trade, through a coin's OWN pool (2026-10-29): Relay routes no v3 pool, so a coin
 * launched here is bought with the Quoter's figure and sold back with a one-wei floor, inside the
 * same simulated block — the sell is never quoted against the pool as it was before the buy.
 */

const ETH = "0x0000000000000000000000000000000000000000";
const COIN = "0xb200000000000000000000694E3F5A4AB150b283";
const pool: LaunchPool = {
  factory: "0x006Da367654a487bb277fe25ff54f0fE0f741377",
  token: COIN,
  quote: ETH,
  tokenIs0: false,
  key: { currency0: ETH, currency1: COIN, fee: 0x800000, tickSpacing: 200, hooks: "0x0D9DdcC907658E3C61318d0F979F978e600AA880" },
};
const NOW = Date.parse("2026-10-29T00:00:00Z");
const deadline = NOW / 1000 + 3600;

describe("the round trip through a coin's own pool", () => {
  it("buys with ETH at the Quoter's figure, less 5%", async () => {
    quoteV4.mockResolvedValue({ amountOut: 1000n, gasEstimate: 1n });
    const route = poolRouter(pool, () => NOW);
    const buy = await route(ETH, COIN, 10n ** 16n);
    expect(quoteV4).toHaveBeenCalledWith(pool.key, true, 10n ** 16n);
    expect(buy).toEqual({ out: 1000n, steps: [buildSwap({ key: pool.key, zeroForOne: true, amountIn: 10n ** 16n, minOut: 950n, deadline })] });
    expect(buy.steps[0]!.value).toBe(10n ** 16n);
  });

  it("sells back unquoted: exact approvals, then the swap with a one-wei floor", async () => {
    quoteV4.mockClear();
    const sell = await poolRouter(pool, () => NOW)(COIN, ETH, 500n);
    expect(quoteV4).not.toHaveBeenCalled();
    expect(sell).toEqual({
      out: 0n,
      steps: [
        { to: COIN, data: approveData(UNISWAP_V4.permit2, 500n), value: 0n },
        { to: UNISWAP_V4.permit2, data: permit2ApproveData(COIN, UNISWAP_V4.universalRouter, 500n, deadline), value: 0n },
        buildSwap({ key: pool.key, zeroForOne: false, amountIn: 500n, minOut: 1n, deadline }),
      ],
    });
  });

  it("keeps time from the clock by default", async () => {
    quoteV4.mockResolvedValue({ amountOut: 100n, gasEstimate: 1n });
    const [swap] = (await poolRouter(pool)(ETH, COIN, 1n)).steps;
    expect(swap!.to).toBe(UNISWAP_V4.universalRouter);
  });
});
