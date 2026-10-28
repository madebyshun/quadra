import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BASE } from "@/config/chain";
import { ACROSS, RELAY } from "@/config/routes";
import { SwapPanel } from "@/features/panels/SwapPanel";
import { pinnedPayee } from "@/config/payees";
import { BridgePanel } from "@/features/panels/BridgePanel";
import { WalletProvider } from "@/ui/WalletProvider";
import type { Eip1193Provider, Eip1193Request } from "@/lib/wallet";
import { erc20Abi } from "viem";
import { copy, walletReads } from "./fixtures/base";
import { ROUTES_FX, USER } from "./fixtures/routes";
import { contractAt, ethCalls, json, net, simulated, useNet } from "./net";

/**
 * 🔴 Hard rule 15, from the other side. The owner set `CONTRACTS.treasury` on 2026-09-30, so
 * every other test sees the fee ON. This file takes the address away in a mocked config and
 * checks the fee turns OFF — no `appFees`/`appFee` in the request, and the review saying so —
 * so clearing the address is always a safe way to stop charging.
 */
vi.mock("@/config/chain", async (original) => {
  const real = await original<typeof import("@/config/chain")>();
  return { ...real, CONTRACTS: { ...real.CONTRACTS, treasury: null } };
});
vi.mock("@/lib/connectors", () => ({ walletConnectProvider: vi.fn(), coinbaseProvider: vi.fn() }));

useNet();

function setUp(quote: unknown) {
  const provider: Eip1193Provider = {
    request: (args: Eip1193Request) =>
      args.method === "eth_accounts" ? Promise.resolve([USER]) : args.method === "eth_chainId" ? Promise.resolve(BASE.idHex) : Promise.reject(new Error(args.method)),
  };
  vi.stubGlobal("ethereum", provider);
  const calls = ethCalls({
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913": contractAt(erc20Abi, { decimals: 6, symbol: "USDC", balanceOf: 10n ** 9n, allowance: 0n }),
    "0x4200000000000000000000000000000000000006": contractAt(erc20Abi, { decimals: 18, symbol: "WETH", balanceOf: 0n }),
  });
  net({ get: walletReads(), rpc: (m, p) => simulated()(m, p) ?? (m === "eth_getCode" ? "0x" : m === "eth_getBalance" ? `0x${(10n ** 18n).toString(16)}` : calls(m, p)) });
  const rpcFetch = globalThis.fetch;
  const asked: string[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url.startsWith(RELAY.api) || url.startsWith(ACROSS.api)) {
      asked.push(`${url} ${String(init?.body ?? "")}`);
      return Promise.resolve(json(quote));
    }
    return rpcFetch(url, init);
  });
  return asked;
}

describe("with no fee address", () => {
  it("pins this app's own origin to nobody, so nothing is paid to it", () => {
    expect(pinnedPayee(location.origin)).toBeNull();
  });

  it("asks Relay for no app fee and says the fee is off in the swap review", async () => {
    const asked = setUp(ROUTES_FX.relayUsdcWeth);
    render(<WalletProvider><SwapPanel /></WalletProvider>);
    await act(async () => {});
    await userEvent.selectOptions(screen.getByLabelText("You get"), "WETH");
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Get a quote" }));
    expect(await screen.findByRole("region", { name: "Review" })).toHaveTextContent("off — no fee address is set");
    expect(asked[0]).not.toContain("appFees");
  });

  it("asks Across for no app fee and says the fee is off in the bridge review", async () => {
    const q = copy(ROUTES_FX.acrossUsdc) as Record<string, unknown>;
    q.quoteExpiryTimestamp = Math.floor(Date.now() / 1000) + 600;
    const asked = setUp(q);
    render(<WalletProvider><BridgePanel /></WalletProvider>);
    await act(async () => {});
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Get a quote" }));
    expect(await screen.findByRole("region", { name: "Review" })).toHaveTextContent("off — no fee address is set");
    expect(asked[0]).not.toContain("appFee");
  });
});
