import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletStatus } from "@/ui/WalletStatus";
import { WalletProvider } from "@/ui/WalletProvider";
import { WALLET_EVENTS, type Eip1193Provider, type Eip1193Request } from "@/lib/wallet";
import { BASE } from "@/config/chain";
import { toChecksumAddress } from "@/lib/address";

/**
 * `walletConnectProvider`/`coinbaseProvider` are mocked rather than driven for real —
 * `tests/connectors.test.ts` already covers what those functions do with the real SDKs
 * mocked out. This file only needs to know that `WalletStatus` hands whatever they
 * resolve to straight to `connectWallet`, and turns a rejection into a `failed` wallet.
 */
const walletConnectProvider = vi.fn();
const coinbaseProvider = vi.fn();
vi.mock("@/lib/connectors", () => ({
  walletConnectProvider: (...args: unknown[]) => walletConnectProvider(...args),
  coinbaseProvider: (...args: unknown[]) => coinbaseProvider(...args),
}));

/**
 * `WalletStatus` reads `globalThis.ethereum` through `lib/wallet.ts`'s own default
 * parameter, so these tests stub that global rather than passing a provider in —
 * that is the one path a component actually exercises, and `tests/wallet.test.ts`
 * already covers every verdict `readWallet`/`connectWallet`/`requestBaseChain` can
 * reach from a fake provider. This file is only about what the component does with
 * a verdict, not about re-deriving the verdicts themselves.
 */

const ACCOUNT = "0xabcdef0123456789abcdef0123456789abcdef01";

/**
 * The tray as the app mounts it. The session moved into `WalletProvider` the day
 * the Connect wallet window needed the same one, so a bare `<WalletStatus />` now
 * throws — which is the point of that throw, and is asserted in
 * `tests/walletPanel.test.tsx` rather than worked around here.
 */
function Tray() {
  return (
    <WalletProvider>
      <WalletStatus />
    </WalletProvider>
  );
}

type Answers = Record<string, unknown>;

function fake(answers: Answers) {
  const listeners: { event: string; handler: (...args: unknown[]) => void }[] = [];
  const provider: Eip1193Provider = {
    request(args: Eip1193Request) {
      if (!(args.method in answers)) return Promise.reject(new Error(`unstubbed ${args.method}`));
      const answer = answers[args.method];
      return typeof answer === "function"
        ? Promise.resolve((answer as () => unknown)())
        : Promise.resolve(answer);
    },
    on: (event, handler) => void listeners.push({ event, handler }),
    removeListener: (event, handler) => {
      const at = listeners.findIndex((l) => l.event === event && l.handler === handler);
      if (at >= 0) listeners.splice(at, 1);
    },
  };
  return { provider, listeners };
}

function stub(answers: Answers) {
  const wallet = fake(answers);
  vi.stubGlobal("ethereum", wallet.provider);
  return wallet;
}

async function settle(): Promise<void> {
  await act(async () => {});
}

/** Press the tray button, which is how the balloon opens for every state but one. */
async function openFromTray(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "connect wallet" }));
  return screen.getByRole("dialog", { name: "Wallet" });
}

describe("WalletStatus: reading before anything is known", () => {
  it("says it is checking before the read resolves", () => {
    stub({ eth_accounts: [] });
    render(<Tray />);
    expect(screen.getByText("checking wallet…")).toBeInTheDocument();
  });
});

describe("WalletStatus: no wallet installed", () => {
  it("still offers a way in from the tray, and a balloon with no injected-connect action", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("ethereum", undefined);
    render(<Tray />);
    await settle();
    expect(screen.getByRole("button", { name: "connect wallet" })).toBeEnabled();
    expect(await openFromTray(user)).toHaveTextContent(/Install a browser wallet/);
    expect(screen.queryByRole("button", { name: "Connect wallet" })).not.toBeInTheDocument();
  });

  /**
   * 🔴 The bug this pins: the balloon used to open on every load for every visitor
   * without a wallet, and in a real browser it covered the Send window's own Send
   * button. Having no wallet is not a problem here — a balance in this browser works
   * without one — so it must not interrupt. See `opensItself`.
   */
  it("does not open by itself just because there is no wallet", async () => {
    vi.stubGlobal("ethereum", undefined);
    render(<Tray />);
    await settle();
    expect(screen.queryByRole("dialog", { name: "Wallet" })).not.toBeInTheDocument();
  });

  /**
   * The bug this pins: the tray said "no wallet found" and was `disabled`, so a
   * visitor with no extension who dismissed the banner had no route back to
   * WalletConnect or Coinbase for the rest of the page's life. A sign-in that
   * exists and cannot be reached is a sign-in that does not exist.
   */
  it("re-opens the banner from the tray after it has been dismissed", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("ethereum", undefined);
    render(<Tray />);
    await settle();
    await openFromTray(user);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("dialog", { name: "Wallet" })).not.toBeInTheDocument();

    await openFromTray(user);
    expect(screen.getByRole("button", { name: "WalletConnect" })).toBeEnabled();
  });

  it("says a browser wallet is not the only way in", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("ethereum", undefined);
    render(<Tray />);
    await settle();
    const banner = await openFromTray(user);
    expect(banner).toHaveTextContent(/You can still sign in/);
    expect(banner.textContent).not.toMatch(/there is nothing to ask\./);
  });

  it("still offers WalletConnect and Coinbase Smart Wallet, which need no injected provider", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("ethereum", undefined);
    render(<Tray />);
    await settle();
    await openFromTray(user);
    expect(screen.getByRole("button", { name: "WalletConnect" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Coinbase Smart Wallet" })).toBeEnabled();
  });
});

describe("WalletStatus: disconnected", () => {
  it("offers Connect wallet in the tray, and in the balloon once it is opened", async () => {
    const user = userEvent.setup();
    stub({ eth_accounts: [] });
    render(<Tray />);
    await settle();
    /** An installed wallet that is not connected is still an absence, not a problem. */
    expect(screen.queryByRole("dialog", { name: "Wallet" })).not.toBeInTheDocument();
    expect(await openFromTray(user)).toHaveTextContent(/nothing is charged until you sign/);
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
  });

  it("connects on click, disables while busy, and lands on ready", async () => {
    const user = userEvent.setup();
    let resolveRequest: (accounts: string[]) => void = () => {};
    const wallet = fake({
      eth_accounts: [],
      // the account picker (EIP-2255) is what Connect opens now — see chooseAccount
      wallet_requestPermissions: () => new Promise((resolve) => (resolveRequest = resolve)),
      eth_chainId: BASE.idHex,
    });
    vi.stubGlobal("ethereum", wallet.provider);
    render(<Tray />);
    await settle();
    await openFromTray(user);

    const connect = screen.getByRole("button", { name: "Connect wallet" });
    await user.click(connect);
    expect(connect).toBeDisabled();
    expect(screen.getByRole("button", { name: "connect wallet" })).toBeDisabled();

    // the underlying eth_accounts answer flips once the request resolves, matching a
    // wallet that authorises the account it was just asked for
    wallet.provider.request = ((args: Eip1193Request) =>
      args.method === "eth_accounts"
        ? Promise.resolve([ACCOUNT])
        : args.method === "eth_chainId"
          ? Promise.resolve(BASE.idHex)
          : Promise.resolve(undefined)) as Eip1193Provider["request"];
    resolveRequest([ACCOUNT]);
    await settle();

    await waitFor(() => expect(screen.getByTitle(/^Connected with [^:]+: 0x/)).toBeInTheDocument());
    expect(screen.queryByRole("dialog", { name: "Wallet" })).not.toBeInTheDocument();
  });
});

describe("WalletStatus: wrong chain", () => {
  /**
   * The one state the balloon opens for by itself: the user has already engaged a
   * wallet, and every payment will fail until the chain is fixed.
   */
  it("opens the balloon by itself, offering Switch to Base, and names the wrong chain in the tray", async () => {
    stub({ eth_accounts: [ACCOUNT], eth_chainId: "0x1" });
    render(<Tray />);
    await settle();
    expect(screen.getByRole("dialog", { name: "Wallet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Switch to ${BASE.name}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "wrong chain" })).toBeInTheDocument();
  });

  it("switches chain on click and lands on ready", async () => {
    const user = userEvent.setup();
    let switched = false;
    const wallet = fake({
      eth_accounts: [ACCOUNT],
      eth_chainId: () => (switched ? BASE.idHex : "0x1"),
      wallet_switchEthereumChain: () => {
        switched = true;
        return null;
      },
    });
    vi.stubGlobal("ethereum", wallet.provider);
    render(<Tray />);
    await settle();

    await user.click(screen.getByRole("button", { name: `Switch to ${BASE.name}` }));
    await waitFor(() => expect(screen.getByTitle(/^Connected with [^:]+: 0x/)).toBeInTheDocument());
  });
});

describe("WalletStatus: ready", () => {
  it("shows the shortened address and no banner, and opens the wallet window when clicked if onOpen is given", async () => {
    const user = userEvent.setup();
    stub({ eth_accounts: [ACCOUNT], eth_chainId: BASE.idHex });
    const a = render(<Tray />);
    await settle();
    // printed with its EIP-55 checksum, the way the wallet and Basescan print it
    const shown = toChecksumAddress(ACCOUNT);
    expect(screen.getByText(`${shown.slice(0, 6)}…${shown.slice(-4)}`)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Wallet" })).not.toBeInTheDocument();
    a.unmount();

    const onOpen = vi.fn();
    render(
      <WalletProvider>
        <WalletStatus onOpen={onOpen} />
      </WalletProvider>,
    );
    await settle();
    await user.click(screen.getByRole("button", { name: `${shown.slice(0, 6)}…${shown.slice(-4)}` }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("WalletStatus: the banner", () => {
  it("can be dismissed, and stays gone for the rest of this mount", async () => {
    const user = userEvent.setup();
    stub({ eth_accounts: [ACCOUNT], eth_chainId: "0x1" });
    render(<Tray />);
    await settle();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("dialog", { name: "Wallet" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "wrong chain" })).toBeInTheDocument();
  });
});

describe("WalletStatus: noticing the wallet moved", () => {
  it("re-reads when the provider fires an event, and unsubscribes on unmount", async () => {
    const wallet = fake({ eth_accounts: [] });
    vi.stubGlobal("ethereum", wallet.provider);
    const { unmount } = render(<Tray />);
    await settle();
    expect(screen.getByRole("button", { name: "connect wallet" })).toBeInTheDocument();

    wallet.provider.request = ((args: Eip1193Request) => {
      if (args.method === "eth_accounts") return Promise.resolve([ACCOUNT]);
      if (args.method === "eth_chainId") return Promise.resolve(BASE.idHex);
      return Promise.resolve(null);
    }) as Eip1193Provider["request"];

    expect(wallet.listeners.map((l) => l.event)).toEqual([...WALLET_EVENTS]);
    await act(async () => {
      for (const l of wallet.listeners) l.handler();
    });
    await waitFor(() => expect(screen.getByTitle(/^Connected with [^:]+: 0x/)).toBeInTheDocument());

    unmount();
    expect(wallet.listeners).toEqual([]);
  });
});

describe("WalletStatus: connecting through WalletConnect", () => {
  it("adopts the resolved provider, reads through it, and lands on ready", async () => {
    const user = userEvent.setup();
    const alt = fake({ eth_accounts: [ACCOUNT], eth_chainId: BASE.idHex });
    walletConnectProvider.mockResolvedValueOnce(alt.provider);
    vi.stubGlobal("ethereum", undefined);
    render(<Tray />);
    await settle();
    await openFromTray(user);

    await user.click(screen.getByRole("button", { name: "WalletConnect" }));
    await waitFor(() => expect(screen.getByTitle(/^Connected with [^:]+: 0x/)).toBeInTheDocument());
  });

  it("shows the rejection as a failed wallet, without touching the injected provider", async () => {
    const user = userEvent.setup();
    walletConnectProvider.mockRejectedValueOnce(new Error("WalletConnect needs a Project ID"));
    vi.stubGlobal("ethereum", undefined);
    render(<Tray />);
    await settle();
    await openFromTray(user);

    await user.click(screen.getByRole("button", { name: "WalletConnect" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Wallet" })).toHaveTextContent(/WalletConnect needs a Project ID/),
    );
  });
});

describe("WalletStatus: connecting through Coinbase Smart Wallet", () => {
  it("adopts the resolved provider and lands on ready", async () => {
    const user = userEvent.setup();
    const alt = fake({ eth_accounts: [ACCOUNT], eth_chainId: BASE.idHex });
    coinbaseProvider.mockResolvedValueOnce(alt.provider);
    vi.stubGlobal("ethereum", undefined);
    render(<Tray />);
    await settle();
    await openFromTray(user);

    await user.click(screen.getByRole("button", { name: "Coinbase Smart Wallet" }));
    await waitFor(() => expect(screen.getByTitle(/^Connected with [^:]+: 0x/)).toBeInTheDocument());
  });

  it("turns a non-Error rejection into readable banner text", async () => {
    const user = userEvent.setup();
    coinbaseProvider.mockRejectedValueOnce("popup blocked");
    vi.stubGlobal("ethereum", undefined);
    render(<Tray />);
    await settle();
    await openFromTray(user);

    await user.click(screen.getByRole("button", { name: "Coinbase Smart Wallet" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Wallet" })).toHaveTextContent("popup blocked"));
  });
});
