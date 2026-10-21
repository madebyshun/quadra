import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletPanel } from "@/features/panels/WalletPanel";
import { X402Panel } from "@/features/panels/X402Panel";
import { AdaptersProvider } from "@/adapters/AdaptersProvider";
import { LocalEnclave } from "@/adapters/local/enclave";
import { LocalCatalog } from "@/adapters/local/catalog";
import { WalletStatus } from "@/ui/WalletStatus";
import { WalletProvider, useWalletSession } from "@/ui/WalletProvider";
import { BASE } from "@/config/chain";
import { toChecksumAddress } from "@/lib/address";
import type { Eip1193Provider, Eip1193Request } from "@/lib/wallet";

/** The x402 window's BlueAgent and any-URL halves are HIDDEN in the product (FLAGS.x402Others, 2026-10-02) but kept — and tested here switched on. */
vi.mock("@/config/chain", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/config/chain")>();
  return { ...real, FLAGS: { ...real.FLAGS, x402Others: true } };
});


/**
 * The Connect wallet window, and the thing that makes it a window rather than a
 * second copy of the tray: one `WalletProvider` session shared by both.
 *
 * Same mocking posture as `tests/walletStatus.test.tsx` — the connectors are
 * stubbed (`tests/connectors.test.ts` drives the real SDKs) and the injected
 * provider is a fake on `globalThis.ethereum`, because that is the path
 * `lib/wallet.ts` takes by default.
 */
const walletConnectProvider = vi.fn();
const coinbaseProvider = vi.fn();
vi.mock("@/lib/connectors", () => ({
  walletConnectProvider: (...args: unknown[]) => walletConnectProvider(...args),
  coinbaseProvider: (...args: unknown[]) => coinbaseProvider(...args),
}));

const ACCOUNT = "0xabcdef0123456789abcdef0123456789abcdef01";

function fake(answers: Record<string, unknown>): Eip1193Provider {
  return {
    request(args: Eip1193Request) {
      if (!(args.method in answers)) return Promise.reject(new Error(`unstubbed ${args.method}`));
      const answer = answers[args.method];
      return typeof answer === "function"
        ? Promise.resolve((answer as () => unknown)())
        : Promise.resolve(answer);
    },
    on: () => {},
    removeListener: () => {},
  };
}

function mountPanel() {
  return render(
    <WalletProvider>
      <WalletPanel />
    </WalletProvider>,
  );
}

async function settle(): Promise<void> {
  await act(async () => {});
}

describe("WalletPanel", () => {
  it("says it is still reading before the first answer comes back", () => {
    vi.stubGlobal("ethereum", fake({ eth_accounts: [] }));
    mountPanel();
    expect(screen.getByText(/reading the wallet on this device/)).toBeInTheDocument();
  });

  it("offers every way in when nothing is injected, not just the one that is missing", async () => {
    vi.stubGlobal("ethereum", undefined);
    mountPanel();
    await settle();
    expect(screen.getByRole("button", { name: "WalletConnect" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Coinbase Smart Wallet" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Connect wallet" })).not.toBeInTheDocument();
  });

  it("offers the injected wallet when there is one to ask", async () => {
    vi.stubGlobal("ethereum", fake({ eth_accounts: [] }));
    mountPanel();
    await settle();
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeEnabled();
  });

  it("offers the chain switch, and only that, when the chain is the only thing wrong", async () => {
    vi.stubGlobal("ethereum", fake({ eth_accounts: [ACCOUNT], eth_chainId: "0x1" }));
    mountPanel();
    await settle();
    expect(screen.getByRole("button", { name: `Switch to ${BASE.name}` })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "WalletConnect" })).not.toBeInTheDocument();
  });

  it("shows the whole address as well as the short one, once connected", async () => {
    vi.stubGlobal("ethereum", fake({ eth_accounts: [ACCOUNT], eth_chainId: BASE.idHex }));
    mountPanel();
    await settle();
    expect(screen.getByText(toChecksumAddress(ACCOUNT))).toBeInTheDocument();
    expect(screen.getByText(`${ACCOUNT.slice(0, 6)}…${ACCOUNT.slice(-4)}`, { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect wallet" })).not.toBeInTheDocument();
  });

  /**
   * ⚠️ The one claim on this screen that must never soften. A sign-in page is where
   * somebody decides how much to trust an app, and this one takes no custody: hard
   * rule 5 (nothing here holds a key) is stated here because this is where it is acted on.
   */
  it("says outright that it holds no key and that looking things up needs no wallet", async () => {
    vi.stubGlobal("ethereum", undefined);
    mountPanel();
    await settle();
    expect(screen.getByText(/never holds a key/)).toBeInTheDocument();
    expect(screen.getByText(/read the chain with no wallet connected at all/)).toBeInTheDocument();
  });

  it("connects through WalletConnect from the window", async () => {
    const user = userEvent.setup();
    walletConnectProvider.mockResolvedValueOnce(
      fake({ eth_accounts: [ACCOUNT], eth_chainId: BASE.idHex }),
    );
    vi.stubGlobal("ethereum", undefined);
    mountPanel();
    await settle();

    await user.click(screen.getByRole("button", { name: "WalletConnect" }));
    await waitFor(() => expect(screen.getByText(toChecksumAddress(ACCOUNT))).toBeInTheDocument());
  });
});

describe("one session, two places to see it", () => {
  /**
   * The bug this pins, and the reason `WalletProvider` exists at all: with the
   * state inside `WalletStatus`, the window and the tray each held their own
   * `provider`, so connecting through WalletConnect in the window left the tray
   * still saying "connect wallet" — and the injected-provider events that keep
   * two copies in step never fire for a provider one of them has never seen.
   */
  it("shows a connection made in the window in the tray as well", async () => {
    const user = userEvent.setup();
    coinbaseProvider.mockResolvedValueOnce(
      fake({ eth_accounts: [ACCOUNT], eth_chainId: BASE.idHex }),
    );
    vi.stubGlobal("ethereum", undefined);
    render(
      <WalletProvider>
        <WalletPanel />
        <WalletStatus />
      </WalletProvider>,
    );
    await settle();
    expect(screen.getByRole("button", { name: "connect wallet" })).toBeInTheDocument();

    // scoped to the window: the tray banner is showing the same three buttons,
    // which is itself the point — one session, rendered twice
    const signIn = within(screen.getByRole("group", { name: "Sign in" }));
    await user.click(signIn.getByRole("button", { name: "Coinbase Smart Wallet" }));
    await waitFor(() => expect(screen.getByTitle(/^Connected with [^:]+: 0x/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "connect wallet" })).not.toBeInTheDocument();
  });
});

/**
 * 🔴 The bug a user hit: "kết nối ví rồi mà khi chạy x402 vẫn phải kết nối lại" —
 * already connected, and the x402 window asked again.
 *
 * `X402Panel` predated `WalletProvider` and kept its own `useState<Wallet>` fed by
 * `readWallet()` with no argument, which reads the INJECTED provider and only that.
 * So a WalletConnect or Coinbase session was invisible to it. The silent half was
 * worse than the visible one: `go()` signed with `injectedProvider()`, so with both
 * a WalletConnect session and an extension present it would have asked a DIFFERENT
 * wallet to sign than the account it was displaying.
 *
 * `globalThis.ethereum` is left `undefined` throughout on purpose. It is what makes
 * this a measurement rather than a coincidence: there is no injected provider to
 * fall back to, so both the address on screen and the signature can only have come
 * from the connected Coinbase session.
 */
describe("a connector session reaches the panels that spend it", () => {
  const PAID = "gas-tracker";
  /** EIP-55 checksummed, so `authorizationFor` accepts it as the signer. */
  const SIGNER = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
  const SIGNATURE = `0x${"b".repeat(130)}`;

  it("does not ask again in x402 once the wallet is connected elsewhere", async () => {
    const user = userEvent.setup();
    const signed: unknown[] = [];
    coinbaseProvider.mockResolvedValueOnce({
      request(args: Eip1193Request) {
        if (args.method === "eth_accounts" || args.method === "eth_requestAccounts") {
          return Promise.resolve([SIGNER]);
        }
        if (args.method === "eth_chainId") return Promise.resolve(BASE.idHex);
        if (args.method === "eth_signTypedData_v4") {
          signed.push(args.params);
          return Promise.resolve(SIGNATURE);
        }
        return Promise.reject(new Error(`unstubbed ${args.method}`));
      },
      on: () => {},
      removeListener: () => {},
    } satisfies Eip1193Provider);
    vi.stubGlobal("ethereum", undefined);

    render(
      <AdaptersProvider
        value={{
          enclave: new LocalEnclave(),
          catalog: new LocalCatalog(),
        }}
      >
        <WalletProvider>
          <WalletPanel />
          <X402Panel start="directory" />
        </WalletProvider>
      </AdaptersProvider>,
    );
    await settle();
    await user.selectOptions(screen.getByLabelText("Tool"), PAID);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument(),
    );

    const signIn = within(screen.getByRole("group", { name: "Sign in" }));
    await user.click(signIn.getByRole("button", { name: "Coinbase Smart Wallet" }));

    /*
      Scoped to x402's own "Wallet connected:" line, not to the address text: the
      Connect wallet window is showing the same account on the same screen, which
      is the point of the fix and would make a bare address query ambiguous.
    */
    await waitFor(() =>
      expect(screen.getByText(/Wallet connected:/)).toHaveTextContent(SIGNER.toLowerCase()),
    );
    expect(screen.queryByRole("button", { name: "Connect wallet" })).not.toBeInTheDocument();

    // and the signature goes to THAT provider, with no injected one to fall back to
    await user.click(screen.getByRole("button", { name: /^Run for / }));
    await waitFor(() => expect(signed).toHaveLength(1));
  });
});

describe("useWalletSession outside the provider", () => {
  /**
   * A default session would have been the easy way out, and it would have silently
   * rebuilt the exact bug above: a component mounted outside the provider would get
   * its own unconnected wallet and look fine.
   */
  it("throws rather than handing back a second, private session", () => {
    function Orphan() {
      useWalletSession();
      return null;
    }
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<Orphan />)).toThrow("must be called inside <WalletProvider>");
    } finally {
      quiet.mockRestore();
    }
  });
});
