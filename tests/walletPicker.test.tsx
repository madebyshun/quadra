import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ANNOUNCE, discoverWallets, parseAnnouncement, REQUEST, type Discovered } from "@/lib/discovery";
import { WALLET_KEY, WalletProvider, useWalletSession, type WalletSession } from "@/ui/WalletProvider";
import { WalletPanel } from "@/features/panels/WalletPanel";
import { WalletStatus } from "@/ui/WalletStatus";
import { toChecksumAddress } from "@/lib/address";
import { BASE } from "@/config/chain";
import type { Eip1193Provider, Eip1193Request } from "@/lib/wallet";
import { walletConnectProvider } from "@/lib/connectors";

/**
 * EIP-6963: every installed wallet announces itself, and the user picks one.
 *
 * The announcements here are dispatched the way a wallet extension dispatches them — a
 * `CustomEvent` on `window` whose `detail` is `{ info, provider }` — so the code under test
 * is the same listener a real MetaMask or Rabby would reach.
 */

vi.mock("@/lib/connectors", () => ({
  walletConnectProvider: vi.fn(),
  coinbaseProvider: vi.fn(),
}));

const A = "0xabcdef0123456789abcdef0123456789abcdef01";
const B = "0x1111111111111111111111111111111111111111";
const ICON = "data:image/svg+xml;base64,PHN2Zy8+";

type Fake = Eip1193Provider & { calls: string[]; disconnect?: () => unknown };

function fake(accounts: string[], extra: Record<string, unknown> = {}): Fake {
  const calls: string[] = [];
  return {
    calls,
    request(args: Eip1193Request) {
      calls.push(args.method);
      if (args.method === "eth_accounts" || args.method === "eth_requestAccounts") return Promise.resolve(accounts);
      if (args.method === "eth_chainId") return Promise.resolve(BASE.idHex);
      return Promise.reject(new Error(`unstubbed ${args.method}`));
    },
    on: () => {},
    removeListener: () => {},
    ...extra,
  };
}

const info = (name: string, rdns: string, icon: string | null = ICON) => ({
  uuid: `uuid-${rdns}`,
  name,
  icon,
  rdns,
});

/** A wallet that answers every request for providers, and announces once now. */
function install(name: string, rdns: string, provider: Eip1193Provider): () => void {
  const detail = Object.freeze({ info: info(name, rdns), provider });
  const answer = () => window.dispatchEvent(new CustomEvent(ANNOUNCE, { detail }));
  window.addEventListener(REQUEST, answer);
  answer();
  return () => window.removeEventListener(REQUEST, answer);
}

const uninstall: (() => void)[] = [];
afterEach(() => {
  for (const u of uninstall.splice(0)) u();
});

let session: WalletSession;
function Probe() {
  session = useWalletSession();
  return null;
}

function mount() {
  return render(
    <WalletProvider>
      <Probe />
      <WalletPanel />
    </WalletProvider>,
  );
}

async function settle(): Promise<void> {
  await act(async () => {});
}

describe("parseAnnouncement", () => {
  const provider = fake([]);

  it("reads a well-formed announcement", () => {
    expect(parseAnnouncement({ info: info("MetaMask", "io.metamask"), provider })).toEqual({
      info: { uuid: "uuid-io.metamask", name: "MetaMask", icon: ICON, rdns: "io.metamask" },
      provider,
    });
  });

  /** The spec requires a data URI; anything else would be a request to wherever the announcer chose. */
  it("drops an icon that is not a data:image URI", () => {
    for (const icon of ["https://evil.example/pixel.png", "data:text/html,<b>x</b>", 7]) {
      expect(parseAnnouncement({ info: { ...info("X", "x.y"), icon }, provider })?.info.icon, String(icon)).toBeNull();
    }
  });

  it("caps a long name so a wallet cannot fill the window with one", () => {
    const long = "W".repeat(60);
    expect(parseAnnouncement({ info: { ...info(long, "x.y") }, provider })?.info.name).toBe(`${"W".repeat(32)}…`);
  });

  it("refuses anything that is not an announcement it can use", () => {
    const good = info("X", "x.y");
    for (const detail of [
      null,
      "x",
      { provider },
      { info: null, provider },
      { info: good },
      { info: good, provider: null },
      { info: good, provider: {} },
      { info: { ...good, uuid: " " }, provider },
      { info: { ...good, name: 3 }, provider },
      { info: { ...good, rdns: undefined }, provider },
    ]) {
      expect(parseAnnouncement(detail), JSON.stringify(detail)).toBeNull();
    }
  });
});

describe("discoverWallets", () => {
  it("asks wallets to announce, lists each once, and stops listening when told to", () => {
    const target = new EventTarget();
    const provider = fake([]);
    const detail = { info: info("Rabby Wallet", "io.rabby"), provider };
    target.addEventListener(REQUEST, () => target.dispatchEvent(new CustomEvent(ANNOUNCE, { detail })));
    const seen: (readonly Discovered[])[] = [];
    const stop = discoverWallets((w) => seen.push(w), target);
    expect(seen).toHaveLength(1);
    // the same wallet again changes nothing
    target.dispatchEvent(new CustomEvent(ANNOUNCE, { detail }));
    expect(seen).toHaveLength(1);
    // a late wallet is added; junk is ignored
    target.dispatchEvent(new CustomEvent(ANNOUNCE, { detail: { info: info("Late", "late.wallet"), provider: fake([]) } }));
    target.dispatchEvent(new Event(ANNOUNCE));
    expect(seen.at(-1)?.map((w) => w.info.name)).toEqual(["Rabby Wallet", "Late"]);
    stop();
    target.dispatchEvent(new CustomEvent(ANNOUNCE, { detail: { info: info("After", "after.wallet"), provider } }));
    expect(seen).toHaveLength(2);
  });

  it("listens on window by default", () => {
    const seen: string[] = [];
    uninstall.push(install("MetaMask", "io.metamask", fake([])));
    const stop = discoverWallets((w) => seen.push(...w.map((x) => x.info.name)));
    stop();
    expect(seen).toEqual(["MetaMask"]);
  });
});

describe("picking a wallet", () => {
  it("lists every announced wallet by name and icon, and drops the generic button", async () => {
    vi.stubGlobal("ethereum", fake([]));
    uninstall.push(install("MetaMask", "io.metamask", fake([])), install("Rabby Wallet", "io.rabby", fake([])));
    mount();
    await settle();
    const signIn = within(screen.getByRole("group", { name: "Sign in" }));
    expect(signIn.getByRole("button", { name: "MetaMask" })).toBeEnabled();
    expect(signIn.getByRole("button", { name: "Rabby Wallet" }).querySelector("img")).toHaveAttribute("src", ICON);
    expect(signIn.queryByRole("button", { name: "Connect wallet" })).not.toBeInTheDocument();
    expect(signIn.getByRole("button", { name: "WalletConnect" })).toBeInTheDocument();
  });

  it("renders a wallet with no usable icon by name alone", async () => {
    const provider = fake([]);
    const detail = { info: info("Plain", "plain.wallet", null), provider };
    const answer = () => window.dispatchEvent(new CustomEvent(ANNOUNCE, { detail }));
    window.addEventListener(REQUEST, answer);
    uninstall.push(() => window.removeEventListener(REQUEST, answer));
    mount();
    await settle();
    expect(screen.getByRole("button", { name: "Plain" }).querySelector("img")).toBeNull();
  });

  /** 🔴 The pick decides where requests go — not whichever extension won `window.ethereum`. */
  it("connects the wallet the user picked, and says which one it is", async () => {
    const injected = fake([]);
    const rabby = fake([A]);
    vi.stubGlobal("ethereum", injected);
    uninstall.push(install("Rabby Wallet", "io.rabby", rabby));
    mount();
    await settle();
    await userEvent.click(screen.getByRole("button", { name: "Rabby Wallet" }));
    await waitFor(() => expect(screen.getByText(toChecksumAddress(A))).toBeInTheDocument());
    // the picker opens in the wallet the user chose, and in no other
    expect(rabby.calls).toContain("wallet_requestPermissions");
    expect(injected.calls).not.toContain("wallet_requestPermissions");
    expect(screen.getByText("Rabby Wallet").tagName).toBe("STRONG");
    expect(localStorage.getItem(WALLET_KEY)).toBe("io.rabby");
    expect(session.signingProvider()).toBe(rabby);
  });

  it("links the checksummed address to Basescan", async () => {
    vi.stubGlobal("ethereum", fake([A]));
    mount();
    await settle();
    const link = screen.getByRole("link", { name: toChecksumAddress(A) });
    expect(link).toHaveAttribute("href", `${BASE.explorer}/address/${toChecksumAddress(A)}`);
  });

  it("names the injected wallet when it is one that announced itself, and falls back otherwise", async () => {
    const metamask = fake([A]);
    vi.stubGlobal("ethereum", metamask);
    uninstall.push(install("MetaMask", "io.metamask", metamask));
    const first = mount();
    await settle();
    expect(session.connectedWith.name).toBe("MetaMask");
    first.unmount();

    vi.stubGlobal("ethereum", fake([A]));
    mount();
    await settle();
    await waitFor(() => expect(session.connectedWith).toEqual({ name: "Browser wallet", icon: null }));
  });

  it("adopts the wallet picked on an earlier visit as soon as it announces", async () => {
    localStorage.setItem(WALLET_KEY, "io.rabby");
    const rabby = fake([A]);
    vi.stubGlobal("ethereum", fake([B]));
    uninstall.push(install("Rabby Wallet", "io.rabby", rabby));
    mount();
    await settle();
    await waitFor(() => expect(screen.getByText(toChecksumAddress(A))).toBeInTheDocument());
    expect(session.connectedWith.name).toBe("Rabby Wallet");
    // read with eth_accounts only — adopting a remembered pick never prompts
    expect(rabby.calls).not.toContain("eth_requestAccounts");
  });

  it("offers the other wallets from a connected session", async () => {
    vi.stubGlobal("ethereum", fake([A]));
    uninstall.push(install("Rabby Wallet", "io.rabby", fake([B])));
    mount();
    await settle();
    expect(screen.queryByRole("group", { name: "Other wallets" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use another wallet" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Other wallets" })).getByRole("button", { name: "Rabby Wallet" }));
    await waitFor(() => expect(screen.getByText(toChecksumAddress(B))).toBeInTheDocument());
    // picking closes the list; the button toggles it
    expect(screen.queryByRole("group", { name: "Other wallets" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use another wallet" }));
    await userEvent.click(screen.getByRole("button", { name: "Use another wallet" }));
    expect(screen.queryByRole("group", { name: "Other wallets" })).not.toBeInTheDocument();
  });

  it("goes back to the injected wallet, and forgets the pick, through the generic button", async () => {
    localStorage.setItem(WALLET_KEY, "io.gone");
    vi.stubGlobal("ethereum", fake([A]));
    mount();
    await settle();
    await userEvent.click(screen.getByRole("button", { name: "Use another wallet" }));
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(localStorage.getItem(WALLET_KEY)).toBeNull();
  });
});

describe("disconnecting", () => {
  it("stops reading the wallet, even when it fires an event, and says to revoke it there too", async () => {
    const handlers = new Set<() => void>();
    const injected = {
      ...fake([A]),
      on: (_e: string, h: () => void) => void handlers.add(h),
      removeListener: (_e: string, h: () => void) => void handlers.delete(h),
    };
    vi.stubGlobal("ethereum", injected);
    render(
      <WalletProvider>
        <Probe />
        <WalletPanel />
        <WalletStatus />
      </WalletProvider>,
    );
    await settle();
    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(screen.getByRole("group", { name: "Sign in" })).toHaveTextContent(/Disconnected\..*disconnect it inside the wallet too/);
    // unsubscribed: a wallet event after Disconnect reaches nothing that would re-read
    expect(handlers.size).toBe(0);
    expect(() => session.signingProvider()).toThrow("No wallet provider is available to sign with.");
  });

  it("ends a WalletConnect session, survives one that refuses to end, and offers no account picker for it", async () => {
    for (const disconnect of [vi.fn(() => Promise.resolve()), vi.fn(() => Promise.reject(new Error("relay down")))]) {
      const phone = fake([A], { disconnect });
      vi.mocked(walletConnectProvider).mockResolvedValue(phone);
      vi.stubGlobal("ethereum", undefined);
      const { unmount } = mount();
      await settle();
      await userEvent.click(screen.getByRole("button", { name: "WalletConnect" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument());
      // a phone wallet switches accounts in its own app
      expect(screen.queryByRole("button", { name: "Switch account" })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
      await settle();
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(phone.calls).not.toContain("wallet_revokePermissions");
      unmount();
    }
  });

  /** MEASURED by the owner: Disconnect then Connect gave back the same MetaMask account. */
  it("revokes a browser wallet's access, so the next connect opens the picker", async () => {
    const picked = fake([A]);
    vi.stubGlobal("ethereum", undefined);
    uninstall.push(install("MetaMask", "io.metamask", picked));
    mount();
    await settle();
    await userEvent.click(screen.getByRole("button", { name: "MetaMask" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await settle();
    expect(picked.calls).toContain("wallet_revokePermissions");
  });

  it("opens the wallet's account picker from a connected session", async () => {
    const injectedWallet = fake([A]);
    vi.stubGlobal("ethereum", injectedWallet);
    mount();
    await settle();
    await userEvent.click(screen.getByRole("button", { name: "Switch account" }));
    await settle();
    expect(injectedWallet.calls).toContain("wallet_requestPermissions");
  });
});

describe("a browser that refuses storage", () => {
  it("still connects, and simply does not remember", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    try {
      vi.stubGlobal("ethereum", fake([B]));
      uninstall.push(install("Rabby Wallet", "io.rabby", fake([A])));
      mount();
      await settle();
      await userEvent.click(screen.getByRole("button", { name: "Use another wallet" }));
      await userEvent.click(screen.getByRole("button", { name: "Rabby Wallet" }));
      await waitFor(() => expect(screen.getByText(toChecksumAddress(A))).toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
      expect(screen.getByRole("group", { name: "Sign in" })).toHaveTextContent(/Disconnected/);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
