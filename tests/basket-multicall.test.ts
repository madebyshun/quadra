import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeAbiParameters, erc20Abi, parseAbi, parseAbiParameters } from "viem";
import { USDC } from "@/config/chain";
import {
  AERO_SLIPSTREAM_QUOTER,
  AERO_SLIPSTREAM_ROUTER,
  buildBasketMulticallPlan,
  UNISWAP_V3_QUOTER,
  UNISWAP_V3_ROUTER,
} from "@/lib/basketMulticall";
import { AAPL_ON_BASE, NVDA_ON_BASE } from "./fixtures/markets";
import { USER } from "./fixtures/routes";
import { contractAt, net, useNet } from "./net";

useNet();

const MULTICALL_ABI = parseAbi(["function multicall(bytes[] data) external payable returns (bytes[] results)"]);
const QUOTE_RETURN = parseAbiParameters("uint256, uint160, uint32, uint256");

describe("buildBasketMulticallPlan", () => {
  it("packs multiple Aerodrome Slipstream stock legs into 1 multicall tx and 1 exact USDC approval", async () => {
    const usdc = contractAt(erc20Abi, { allowance: 0n });
    net({
      rpc: (m, p) => {
        if (m !== "eth_call") return undefined;
        const { to, data } = p[0] as { to: string; data: `0x${string}` };
        if (to.toLowerCase() === USDC.address.toLowerCase()) return usdc(data);
        if (to.toLowerCase() === AERO_SLIPSTREAM_QUOTER.toLowerCase()) {
          return encodeAbiParameters(QUOTE_RETURN, [50_000_000n, 0n, 0, 150_000n]);
        }
        return undefined;
      },
    });

    const plan = await buildBasketMulticallPlan(
      USER,
      [
        { address: NVDA_ON_BASE, symbol: "NVDAc", amountUsdc: 6_000_000n },
        { address: AAPL_ON_BASE, symbol: "AAPLc", amountUsdc: 4_000_000n },
      ],
      100,
    );

    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]!.dex).toBe("aerodrome");
    expect(plan.groups[0]!.router).toBe(AERO_SLIPSTREAM_ROUTER);
    expect(plan.groups[0]!.totalUsdc).toBe(10_000_000n);
    const decoded = decodeFunctionData({ abi: MULTICALL_ABI, data: plan.groups[0]!.tx.data! });
    expect(decoded.functionName).toBe("multicall");
    expect(decoded.args[0]).toHaveLength(2);
    expect(plan.approvals).toHaveLength(1);
    expect(plan.approvals[0]!.amount).toBe(10_000_000n);
  });

  it("skips USDC approval when allowance already covers total and falls back to Uniswap V3 when Aerodrome has no pool", async () => {
    const usdc = contractAt(erc20Abi, { allowance: 20_000_000n });
    net({
      rpc: (m, p) => {
        if (m !== "eth_call") return undefined;
        const { to, data } = p[0] as { to: string; data: `0x${string}` };
        if (to.toLowerCase() === USDC.address.toLowerCase()) return usdc(data);
        if (to.toLowerCase() === AERO_SLIPSTREAM_QUOTER.toLowerCase()) return "0x";
        if (to.toLowerCase() === UNISWAP_V3_QUOTER.toLowerCase()) {
          return encodeAbiParameters(QUOTE_RETURN, [25_000_000n, 0n, 0, 120_000n]);
        }
        return undefined;
      },
    });

    const plan = await buildBasketMulticallPlan(
      USER,
      [{ address: NVDA_ON_BASE, symbol: "NVDAc", amountUsdc: 5_000_000n }],
      100,
    );

    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]!.dex).toBe("uniswapv3");
    expect(plan.groups[0]!.router).toBe(UNISWAP_V3_ROUTER);
    expect(plan.approvals).toHaveLength(0);
  });
});
