import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { erc20Abi } from "viem";
import { BASE, USDC, WETH } from "@/config/chain";
import { SHOWN, WalletAssets } from "@/features/panels/WalletAssets";
import { amountFor, choiceFor } from "@/features/panels/TokenPicker";
import { SendPanel } from "@/features/panels/SendPanel";
import { SwapPanel } from "@/features/panels/SwapPanel";
import { ETH_GAS_RESERVE } from "@/lib/erc20";
import { WalletProvider } from "@/ui/WalletProvider";
import type { Eip1193Provider, Eip1193Request } from "@/lib/wallet";
import { ADDR, FX, JESSE_WEI, walletReads } from "./fixtures/base";
import { contractAt, DOWN, ethCalls, net, RpcError, useNet } from "./net";

/**
 * The wallet's own assets above Send and Swap, and the 25% / 50% / 75% / Max shortcuts — the
 * owner's ask of 2026-09-30: "show how many assets the wallet has so the user can easily
 * send/swap, and add %". The list is jesse.base.eth's real balances (Blockscout capture) and
 * its real ETH balance from the same session.
 */

useNet();

vi.mock("@/lib/connectors", () => ({ walletConnectProvider: vi.fn(), coinbaseProvider: vi.fn() }));

const CBETH = "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22";

/** Base as the list and the shortcuts read it, for jesse. */
function base(o: { eth?: bigint | typeof DOWN; get?: (url: string) => unknown; usdc?: bigint } = {}) {
  const calls = ethCalls({
    [USDC.address]: contractAt(erc20Abi, { decimals: 6, symbol: "USDC", balanceOf: o.usdc ?? 4_244_385_701n }),
    [WETH.address]: contractAt(erc20Abi, { decimals: 18, symbol: "WETH", balanceOf: 2_281_807_347_495_925_534n }),
    [CBETH]: contractAt(erc20Abi, { decimals: 18, symbol: "cbETH", balanceOf: 3n }),
  });
  const reads = walletReads();
  return net({
    get: (url) => o.get?.(url) ?? reads(url),
    rpc: (m, p) => {
      if (m === "eth_getBalance") return o.eth === DOWN ? new RpcError("node is down") : `0x${(o.eth ?? JESSE_WEI).toString(16)}`;
      if (m === "eth_getCode") return "0x";
      return calls(m, p);
    },
  });
}

function connect() {
  const provider: Eip1193Provider = {
    request: (args: Eip1193Request) =>
      args.method === "eth_accounts" ? Promise.resolve([ADDR.jesse]) : args.method === "eth_chainId" ? Promise.resolve(BASE.idHex) : Promise.reject(new Error(args.method)),
  };
  vi.stubGlobal("ethereum", provider);
}

async function settle() {
  await act(async () => {});
  await act(async () => {});
}

const rows = (label: string) => within(screen.getByRole("list", { name: label })).getAllByRole("button");

describe("the wallet's assets", () => {
  it("lists ETH first, then priced tokens by value — never an unpriced one", async () => {
    base();
    render(<WalletAssets account={ADDR.jesse} label="Yours" onPick={() => {}} />);
    expect(screen.getByText("Reading your wallet…")).toBeInTheDocument();
    await settle();
    const list = rows("Yours");
    expect(list).toHaveLength(1 + SHOWN);
    expect(list[0]).toHaveTextContent(/^ETH7\.6269/);
    expect(list[0]).toHaveTextContent("$20,289.70");
    // then by value: 64.48 cbETH (~$196k), JESSE, ZORA, WETH … down to the eighth, DRB
    expect(list.slice(1).map((b) => b.querySelector("strong")!.textContent)).toEqual(["CBETH", "JESSE", "ZORA", "WETH", "CBBTC", "USDC", "TIBBIR", "DIME"]);
    expect(list[1]).toHaveTextContent(/^CBETH64\.482/);
    // airdropped lures with no price stay off a list one click from a transfer
    const text = screen.getByRole("list", { name: "Yours" }).textContent!;
    expect(text).not.toContain("Melon Usk");
    expect(text).not.toContain("SHIBASE");
    expect(FX.tokenBalancesJesse.length).toBeGreaterThan(SHOWN);
  });

  it("hands the pick up: null for ETH, the contract for a token", async () => {
    base();
    const onPick = vi.fn();
    render(<WalletAssets account={ADDR.jesse} label="Yours" onPick={onPick} />);
    await settle();
    await userEvent.click(rows("Yours")[0]!);
    await userEvent.click(rows("Yours")[1]!);
    expect(onPick.mock.calls).toEqual([[null, "ETH"], [CBETH, "CBETH"]]);
  });

  it("shows ETH without a dollar value when there is no ETH price, and ETH alone when Blockscout is down", async () => {
    base({ get: (url) => (url.startsWith("https://api.dexscreener.com/") || url.startsWith("https://base.blockscout.com/") ? DOWN : undefined) });
    render(<WalletAssets account={ADDR.jesse} label="Yours" onPick={() => {}} />);
    await settle();
    const list = rows("Yours");
    expect(list).toHaveLength(1);
    expect(list[0]).toHaveTextContent(/^ETH7\.6269\d*—$/);
    expect(screen.getByText(/^Your tokens could not be read: /)).toHaveTextContent("Blockscout could not be reached");
  });

  it("says why ETH could not be read, and still lists the tokens", async () => {
    base({ eth: DOWN });
    render(<WalletAssets account={ADDR.jesse} label="Yours" onPick={() => {}} />);
    await settle();
    expect(screen.getByText(/^Your ETH balance could not be read: /)).toHaveTextContent("node is down");
    expect(rows("Yours")).toHaveLength(SHOWN);
  });

  /** MEASURED: Blockscout took 3.6–8.7 s; ETH is one RPC call. The list must not wait for the slow half. */
  it("shows ETH the moment it is read, while the tokens are still coming", async () => {
    base();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const answered = globalThis.fetch;
    vi.stubGlobal("fetch", (u: string, i?: RequestInit) => (u.startsWith("https://base.blockscout.com/") ? gate.then(() => answered(u, i)) : answered(u, i)));
    render(<WalletAssets account={ADDR.jesse} label="Yours" onPick={() => {}} />);
    await settle();
    expect(rows("Yours")).toHaveLength(1);
    expect(screen.getByText("Reading your tokens…")).toBeInTheDocument();
    release();
    await settle();
    expect(rows("Yours")).toHaveLength(1 + SHOWN);
    expect(screen.queryByText("Reading your tokens…")).not.toBeInTheDocument();
  });

  it("drops an answer for an account it is no longer showing", async () => {
    base();
    const THEM = "0x1111111111111111111111111111111111111111";
    const view = render(<WalletAssets account={ADDR.jesse} label="Yours" onPick={() => {}} />);
    view.rerender(<WalletAssets account={THEM} label="Yours" onPick={() => {}} />);
    view.unmount();
    await settle();
    base({ eth: DOWN, get: (u) => (u.startsWith("https://base.blockscout.com/") ? DOWN : undefined) });
    const failing = render(<WalletAssets account={ADDR.jesse} label="Yours" onPick={() => {}} />);
    failing.unmount();
    await settle();
  });
});

describe("the amount shortcuts", () => {
  it("names the picker's choice for a token address", () => {
    expect(choiceFor(null)).toBe("ETH");
    expect(choiceFor(USDC.address.toLowerCase())).toBe("USDC");
    expect(choiceFor(WETH.address)).toBe("WETH");
    expect(choiceFor(CBETH)).toBe("other");
  });

  it("reads the balance from the chain and takes a share of it, truncated", async () => {
    base({ usdc: 10_000_001n });
    expect(await amountFor("USDC", "", "Token", ADDR.jesse, 25)).toBe("2.5");
    expect(await amountFor("USDC", "", "Token", ADDR.jesse, 75)).toBe("7.5");
    expect(await amountFor("USDC", "", "Token", ADDR.jesse, 100)).toBe("10.000001");
    expect(await amountFor("other", CBETH, "Token", ADDR.jesse, 50)).toBe("0.000000000000000001");
  });

  it("keeps some ETH back for gas on Max, and never goes below zero", async () => {
    base({ eth: 10n ** 18n });
    expect(await amountFor("ETH", "", "Token", ADDR.jesse, 100)).toBe("0.99995");
    expect(10n ** 18n - ETH_GAS_RESERVE).toBe(999_950_000_000_000_000n);
    expect(await amountFor("ETH", "", "Token", ADDR.jesse, 50)).toBe("0.5");
    base({ eth: ETH_GAS_RESERVE - 1n });
    expect(await amountFor("ETH", "", "Token", ADDR.jesse, 100)).toBe("0");
  });
});

describe("Send and Swap start from the wallet's assets", () => {
  it("Send: a pick fills the token, and a shortcut fills the amount", async () => {
    base();
    connect();
    render(
      <WalletProvider>
        <SendPanel />
      </WalletProvider>,
    );
    await settle();
    const label = `Your assets on ${BASE.name} — pick one to send`;
    const list = within(screen.getByRole("list", { name: label }));
    await userEvent.click(list.getByRole("button", { name: /^USDC/ }));
    expect(screen.getByLabelText("Token")).toHaveValue("USDC");
    await userEvent.click(screen.getByRole("button", { name: "50%" }));
    await waitFor(() => expect(screen.getByLabelText("Amount")).toHaveValue("2122.19285"));
    await userEvent.click(list.getByRole("button", { name: /^CBETH/ }));
    expect(screen.getByLabelText("Token")).toHaveValue("other");
    expect(screen.getByLabelText("Token address")).toHaveValue(CBETH);
    // an amount read for USDC means nothing for cbETH
    expect(screen.getByLabelText("Amount")).toHaveValue("");
    await userEvent.click(list.getByRole("button", { name: /^ETH/ }));
    expect(screen.getByLabelText("Token")).toHaveValue("ETH");
    await userEvent.click(screen.getByRole("button", { name: "Max" }));
    await waitFor(() => expect(screen.getByLabelText("Amount")).toHaveValue("7.626854801941975387"));
  });

  it("Send: the shortcuts wait for a token address, and say why one cannot be read", async () => {
    base();
    connect();
    render(
      <WalletProvider>
        <SendPanel />
      </WalletProvider>,
    );
    await settle();
    await userEvent.selectOptions(screen.getByLabelText("Token"), "other");
    expect(screen.getByRole("button", { name: "25%" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Token address"), "0x12");
    await userEvent.click(screen.getByRole("button", { name: "25%" }));
    expect(await screen.findByLabelText("Send error")).toHaveTextContent(/Token address/);
  });

  it("Swap: a pick fills what you pay, and a shortcut fills the amount", async () => {
    base();
    connect();
    render(
      <WalletProvider>
        <SwapPanel />
      </WalletProvider>,
    );
    await settle();
    const list = within(screen.getByRole("list", { name: `Pay with one of your assets on ${BASE.name}` }));
    await userEvent.click(list.getByRole("button", { name: /^WETH/ }));
    expect(screen.getByLabelText("You pay")).toHaveValue("WETH");
    await userEvent.click(screen.getByRole("button", { name: "25%" }));
    await waitFor(() => expect(screen.getByLabelText("Amount")).toHaveValue("0.570451836873981383"));
    await userEvent.click(list.getByRole("button", { name: /^CBETH/ }));
    expect(screen.getByLabelText("You pay")).toHaveValue("other");
    expect(screen.getByLabelText("You pay address")).toHaveValue(CBETH);
    expect(screen.getByLabelText("Amount")).toHaveValue("");
    await userEvent.clear(screen.getByLabelText("You pay address"));
    await userEvent.type(screen.getByLabelText("You pay address"), "0x12");
    await userEvent.click(screen.getByRole("button", { name: "75%" }));
    expect(await screen.findByLabelText("Swap error")).toHaveTextContent(/Token you pay/);
  });

  it("marks the shortcut being read at once, and holds the others until it answers", async () => {
    base();
    connect();
    render(
      <WalletProvider>
        <SendPanel />
      </WalletProvider>,
    );
    await settle();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const answered = globalThis.fetch;
    vi.stubGlobal("fetch", (u: string, i?: RequestInit) => (i?.method === "POST" ? gate.then(() => answered(u, i)) : answered(u, i)));
    await userEvent.click(screen.getByRole("button", { name: "75%" }));
    const busy = screen.getByRole("button", { name: "75%" });
    expect(busy).toHaveTextContent("…");
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Max" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByLabelText("Amount")).not.toHaveValue(""));
    expect(screen.getByRole("button", { name: "75%" })).toHaveTextContent("75%");
    expect(screen.getByRole("button", { name: "Max" })).toBeEnabled();
  });

  it("reads USDC and WETH from verified config, not from the chain, when a shortcut is pressed", async () => {
    const calls = base({ usdc: 10_000_001n });
    await amountFor("USDC", "", "Token", ADDR.jesse, 50);
    await amountFor("WETH", "", "Token", ADDR.jesse, 50);
    // one balanceOf each — no decimals() and no symbol() round-trips
    expect(calls.filter((c) => c.rpc === "eth_call")).toHaveLength(2);
  });
});
