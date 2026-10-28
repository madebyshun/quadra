import { describe, expect, it, vi } from "vitest";

/**
 * Both SDKs are mocked, never imported for real — this file exists to check what
 * `lib/connectors.ts` does with a Project ID and with whatever the SDKs hand back, not
 * to exercise `@walletconnect/ethereum-provider` or `@coinbase/wallet-sdk` themselves.
 * `tests/setup.ts` makes `fetch` throw project-wide for the same reason: a real
 * `EthereumProvider.init` call reaches a relay server, and that can never run in this
 * suite (rule: tests never touch the network).
 */

const init = vi.fn();
vi.mock("@walletconnect/ethereum-provider", () => ({
  EthereumProvider: { init: (...args: unknown[]) => init(...args) },
}));

const getProvider = vi.fn();
const createCoinbaseWalletSDK = vi.fn((..._args: unknown[]) => ({ getProvider }));
vi.mock("@coinbase/wallet-sdk", () => ({
  createCoinbaseWalletSDK: (...args: unknown[]) => createCoinbaseWalletSDK(...args),
}));

describe("connectors: WalletConnect", () => {
  it("refuses before touching the SDK when no Project ID is configured", async () => {
    vi.resetModules();
    vi.doMock("@/config/connectors", () => ({ WALLETCONNECT_PROJECT_ID: null }));
    const { walletConnectProvider } = await import("@/lib/connectors");
    await expect(walletConnectProvider()).rejects.toThrow(/Project ID/);
    expect(init).not.toHaveBeenCalled();
  });

  it("initialises the SDK with the configured id, scoped to Base, and returns what it resolves", async () => {
    vi.resetModules();
    vi.doMock("@/config/connectors", () => ({ WALLETCONNECT_PROJECT_ID: "abc123" }));
    const fakeProvider = { request: vi.fn() };
    init.mockResolvedValueOnce(fakeProvider);

    const { walletConnectProvider } = await import("@/lib/connectors");
    const provider = await walletConnectProvider();

    expect(provider).toBe(fakeProvider);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "abc123", chains: [8453], showQrModal: true }),
    );
  });
});

describe("connectors: Coinbase Smart Wallet", () => {
  it("needs no Project ID, and hands back the SDK's own provider", async () => {
    vi.resetModules();
    vi.doMock("@/config/connectors", () => ({ WALLETCONNECT_PROJECT_ID: null }));
    const fakeProvider = { request: vi.fn() };
    getProvider.mockReturnValueOnce(fakeProvider);

    const { coinbaseProvider } = await import("@/lib/connectors");
    const provider = await coinbaseProvider();

    expect(provider).toBe(fakeProvider);
    expect(createCoinbaseWalletSDK).toHaveBeenCalledWith(expect.objectContaining({ appChainIds: [8453] }));
  });
});
