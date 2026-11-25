import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { USDC } from "@/config/chain";
import { TRADE_CRYPTO } from "@/config/markets";
import type { BaseStock } from "@/adapters/http/markets";
import type { WalletRow } from "@/features/panels/WalletAssets";
import { USER } from "./fixtures/routes";

/** The token picker's menu: your wallet first, then a search over Base tokens, stocks and any address. */
const NVDA = "0xb2000000000000000000000000000000000000aa";
const FOREIGN = "0x1234567890123456789012345678901234567890";
const stock = (over: Partial<BaseStock>): BaseStock => ({ address: NVDA, symbol: "NVDAc", name: "NVIDIA", decimals: 8, nav: 180, paused: [], ...over }) as unknown as BaseStock;
const h = vi.hoisted(() => ({
  account: null as string | null,
  closed: false,
  rows: [] as WalletRow[],
  stocks: null as Map<string, unknown> | null,
}));
vi.mock("@/ui/WalletProvider", () => ({ useOptionalWalletSession: () => (h.account ? { wallet: { kind: "ready", account: h.account } } : null) }));
vi.mock("@/lib/region", () => ({ useStocksClosed: () => h.closed }));
vi.mock("@/features/panels/WalletAssets", () => ({ loadFastWalletRows: vi.fn(async () => h.rows) }));
vi.mock("@/adapters/http/markets", () => ({ baseStocks: vi.fn(async () => { if (h.stocks === null) throw new Error("down"); return h.stocks; }) }));
const { TokenPicker } = await import("@/features/panels/TokenPicker");
const { baseStocks } = await import("@/adapters/http/markets");

function Harness({ start = "ETH", startAddress = "", customLabel = null, spy = vi.fn() }: { start?: "ETH" | "USDC" | "WETH" | "other"; startAddress?: string; customLabel?: string | null; spy?: (...a: unknown[]) => void }) {
  const [choice, setChoice] = useState<"ETH" | "USDC" | "WETH" | "other">(start);
  const [address, setAddress] = useState(startAddress);
  return (
    <div>
      <TokenPicker label="Token" choice={choice} address={address} customLabel={customLabel} onChoice={(c) => { spy("choice", c); setChoice(c); }} onAddress={(a) => { spy("address", a); setAddress(a); }} />
      <p>outside</p>
    </div>
  );
}
const trigger = () => screen.getAllByRole("button")[0]!;
const menu = () => screen.getByRole("dialog", { name: "Select Token" });
const search = () => screen.getByRole("textbox", { name: "Search Token" });

beforeEach(() => {
  h.account = null;
  h.closed = false;
  h.rows = [];
  h.stocks = new Map([[NVDA, stock({})], ["0xb2000000000000000000000000000000000000bb", stock({ address: "0xb2000000000000000000000000000000000000bb", symbol: "PAUSc", paused: [0] })], ["0xb2000000000000000000000000000000000000cc", stock({ address: "0xb2000000000000000000000000000000000000cc", symbol: "ANAVc", nav: null })], ["0xb2000000000000000000000000000000000000dd", stock({ address: "0xb2000000000000000000000000000000000000dd", symbol: "AAPLc", name: "Apple" })]]);
  vi.mocked(baseStocks).mockClear();
});

describe("TokenPicker", () => {
  it("reads nothing while closed; without a wallet it offers the three verified tokens", async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    expect(baseStocks).not.toHaveBeenCalled();
    expect(trigger()).toHaveTextContent("ETH");
    fireEvent.click(trigger());
    await act(async () => {});
    expect(within(menu()).getByText("Base tokens")).toBeInTheDocument();
    expect(within(menu()).getAllByRole("option").map((o) => o.querySelector("strong")!.textContent)).toEqual(["ETH", "USDC", "WETH"]);
    fireEvent.click(within(menu()).getByRole("option", { name: /USDC/ }));
    expect(spy).toHaveBeenCalledWith("choice", "USDC");
    expect(spy).toHaveBeenCalledWith("address", "");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger()).toHaveTextContent("USDC");
  });

  it("searches Base crypto and open stocks by name or symbol, offers a pasted address, and picks the first on Enter", async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    fireEvent.click(trigger());
    await act(async () => {});
    fireEvent.change(search(), { target: { value: "nvid" } });
    expect(within(menu()).getByText("Matching tokens")).toBeInTheDocument();
    expect(within(menu()).getAllByRole("option").map((o) => o.querySelector("strong")!.textContent)).toEqual(["NVDAc"]);
    // a paused stock and one with no NAV are not offered
    fireEvent.change(search(), { target: { value: "c" } });
    const symbols = within(menu()).getAllByRole("option").map((o) => o.querySelector("strong")!.textContent);
    expect(symbols).toContain("AAPLc");
    expect(symbols).not.toContain("PAUSc");
    expect(symbols).not.toContain("ANAVc");
    fireEvent.change(search(), { target: { value: "zzzz" } });
    expect(within(menu()).getByText(/No token found/)).toBeInTheDocument();
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(spy).not.toHaveBeenCalled();
    // a listed address matches itself; an unlisted one is offered as itself
    fireEvent.change(search(), { target: { value: TRADE_CRYPTO.find((c) => c.address !== USDC.address)!.address } });
    expect(within(menu()).getAllByRole("option")).toHaveLength(1);
    fireEvent.change(search(), { target: { value: FOREIGN } });
    expect(within(menu()).getByRole("option", { name: /Custom token on Base/ })).toBeInTheDocument();
    fireEvent.keyDown(search(), { key: "a" });
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(spy).toHaveBeenCalledWith("choice", "other");
    expect(spy).toHaveBeenCalledWith("address", FOREIGN);
    // the address stays in view, editable, below the picker
    expect(screen.getByLabelText("Token address")).toHaveValue(FOREIGN);
    fireEvent.change(screen.getByLabelText("Token address"), { target: { value: "0xabc" } });
    expect(spy).toHaveBeenLastCalledWith("address", "0xabc");
  });

  it("lists the wallet first, with values, and names the selection from it", async () => {
    h.account = USER;
    h.rows = [
      { address: null, symbol: "ETH", amount: "0.1", value: "$300", sortUsd: 0 },
      { address: NVDA, symbol: "NVDAc", amount: "0.002", value: null, sortUsd: 0 },
      { address: FOREIGN, symbol: "ODD", amount: "5", value: "$1", sortUsd: 0 },
      { address: "0x9999999999999999999999999999999999999999", symbol: "NAMED", name: "Its Own Name", amount: "1", value: null, sortUsd: 0 },
    ];
    render(<Harness start="other" startAddress={FOREIGN} />);
    fireEvent.click(trigger());
    await waitFor(() => expect(within(menu()).getByText("In your wallet")).toBeInTheDocument());
    const rows = within(menu()).getAllByRole("option");
    expect(rows[0]).toHaveTextContent("ETHEther$3000.1 ETH");
    expect(rows[1]).toHaveTextContent("NVDAcNVIDIA—0.002 NVDAc");
    expect(rows[2]).toHaveTextContent("ODD0x1234…7890");
    expect(rows[2]).toHaveAttribute("aria-selected", "true");
    expect(rows[3]).toHaveTextContent("NAMEDIts Own Name");
    expect(trigger()).toHaveTextContent("ODD — 0x1234…7890");
    // searching keeps a wallet row once, ahead of the catalog's copy
    fireEvent.change(search(), { target: { value: "nvd" } });
    expect(within(menu()).getAllByRole("option")).toHaveLength(1);
    expect(within(menu()).getByRole("option")).toHaveTextContent("0.002 NVDAc");
  });

  it("words a selection it cannot name, closes on Escape or a click outside, and skips stocks where they are closed", async () => {
    h.closed = true;
    const view = render(<Harness start="other" startAddress={FOREIGN} customLabel="Mystery" />);
    expect(trigger()).toHaveTextContent("Mystery (0x1234…7890)");
    fireEvent.click(trigger());
    await act(async () => {});
    expect(baseStocks).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "x" });
    fireEvent.mouseDown(menu());
    expect(menu()).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(screen.queryByRole("dialog")).toBeNull();
    view.unmount();
    render(<Harness start="other" startAddress={FOREIGN} />);
    expect(trigger()).toHaveTextContent("0x1234…7890");
  });

  it("says what is missing when nothing is typed yet, and survives an unreadable stock list", async () => {
    h.stocks = null;
    const view = render(<Harness start="other" customLabel="Coin" />);
    expect(trigger()).toHaveTextContent("Coin");
    view.unmount();
    render(<Harness start="other" />);
    expect(trigger()).toHaveTextContent("Select token");
    fireEvent.click(trigger());
    await act(async () => {});
    fireEvent.change(search(), { target: { value: "nvd" } });
    expect(within(menu()).getByText(/No token found/)).toBeInTheDocument();
    for (const c of ["ETH", "WETH"] as const) {
      fireEvent.change(screen.getByLabelText("Token"), { target: { value: c } });
      expect(trigger()).toHaveTextContent(c);
    }
  });

  it("drops an answer that arrives after the menu closed", async () => {
    h.account = USER;
    h.rows = [{ address: null, symbol: "ETH", amount: "2", value: null, sortUsd: 0 }];
    let release!: () => void;
    const { loadFastWalletRows } = await import("@/features/panels/WalletAssets");
    vi.mocked(loadFastWalletRows).mockImplementationOnce(() => new Promise((r) => { release = () => r([{ address: null, symbol: "ETH", amount: "1", value: null, sortUsd: 0 }]); }));
    render(<Harness />);
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    await act(async () => { release(); });
    fireEvent.click(trigger());
    // the reopened menu shows its own fresh read, not the late one
    await waitFor(() => expect(within(menu()).getByRole("option")).toHaveTextContent("2 ETH"));
  });
});
