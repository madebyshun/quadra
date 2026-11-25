import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdaptersProvider } from "@/adapters/AdaptersProvider";
import { LocalEnclave } from "@/adapters/local/enclave";
import { LocalCatalog } from "@/adapters/local/catalog";
import { parseEndpoint } from "@/adapters/http/endpoint";
import { BRAND } from "@/brand";
import { BASE, CONTRACTS } from "@/config/chain";
import { pinnedPayee } from "@/config/payees";
import { jsonFromBase64, PAYMENT_SIGNATURE } from "@/lib/x402http";
import { apiHandler, NO_FACILITATOR } from "@/server/api";
import { API_PATH } from "@/server/apiPath";
import type { Facilitator } from "@/server/cdp";
import { X402Panel } from "@/features/panels/X402Panel";
import { ownApiUrl } from "@/features/panels/X402Own";
import { WalletProvider } from "@/ui/WalletProvider";
import { SKILLS } from "@/skills";
import { quietRadar } from "./fixtures/radar";
import { net, useNet } from "./net";

/** The x402 window's BlueAgent and any-URL halves are HIDDEN in the product (FLAGS.x402Others, 2026-10-02) but kept — and tested here switched on. */
vi.mock("@/config/chain", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/config/chain")>();
  return { ...real, FLAGS: { ...real.FLAGS, x402Others: true } };
});


/**
 * The x402 window's first way in: this app's own tools, paid through this app's own API.
 * The API answering here is the real handler (`server/api.ts`) with a fake facilitator, so
 * the whole sale — 402, signature, verify, run, settle, report — runs inside the test.
 */

useNet();

const ACCOUNT = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const SIGNATURE = `0x${"a".repeat(130)}`;
const TX = `0x${"cd".repeat(32)}`;

function ready() {
  vi.stubGlobal("ethereum", {
    request: (args: { method: string }) =>
      ({ eth_accounts: [ACCOUNT], eth_chainId: BASE.idHex, eth_signTypedData_v4: SIGNATURE })[args.method] !== undefined
        ? Promise.resolve(({ eth_accounts: [ACCOUNT], eth_chainId: BASE.idHex, eth_signTypedData_v4: SIGNATURE } as Record<string, unknown>)[args.method])
        : Promise.reject(new Error(`unstubbed ${args.method}`)),
    on: () => {},
    removeListener: () => {},
  });
}

/** A quiet radar from the captures, and this app's API answered by its real handler. */
function world(facilitator: Facilitator | null) {
  net({ rpc: quietRadar });
  const handle = apiHandler({ facilitator });
  const payments: string[] = [];
  const outside = globalThis.fetch;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (!url.startsWith(`${location.origin}${API_PATH}`)) return outside(url, init);
    const signature = new Headers(init?.headers).get(PAYMENT_SIGNATURE);
    if (signature) payments.push(signature);
    return handle(new Request(url, init));
  });
  return payments;
}

function facilitator(): Facilitator & { calls: string[] } {
  const f = {
    calls: [] as string[],
    async verify() {
      f.calls.push("verify");
      return { isValid: true };
    },
    async settle() {
      f.calls.push("settle");
      return { success: true, transaction: TX, network: "eip155:8453" };
    },
  };
  return f;
}

async function mount() {
  render(
    <AdaptersProvider value={{ enclave: new LocalEnclave(), catalog: new LocalCatalog() }}>
      <WalletProvider>
        <X402Panel />
      </WalletProvider>
    </AdaptersProvider>,
  );
  await act(async () => {});
}

describe("this app's own API URL", () => {
  it("puts each argument in order, trimmed, and drops blanks from the end", () => {
    expect(ownApiUrl("https://app.test", "radar", [])).toBe(`https://app.test${API_PATH}/radar`);
    expect(ownApiUrl("https://app.test", "verdict", [" 0xabc ", "", "  "])).toBe(`https://app.test${API_PATH}/verdict?arg=0xabc`);
    expect(ownApiUrl("https://app.test", "probe", ["0xabc", "", "x y"])).toBe(`https://app.test${API_PATH}/probe?arg=0xabc&arg=&arg=x+y`);
  });

  it("is paid over the page's own connection, while any other http endpoint is still refused", () => {
    expect(parseEndpoint(`${location.origin}${API_PATH}/radar`).origin).toBe(location.origin);
    expect(() => parseEndpoint("http://elsewhere.test/api")).toThrow(/Only https endpoints are paid/);
  });

  it("pins this app's own origin to its own fee address, and nothing else to it", () => {
    expect(pinnedPayee(location.origin)).toBe(CONTRACTS.treasury);
    expect(pinnedPayee("https://elsewhere.test")).toBeNull();
  });
});

describe("the x402 window's first way in", () => {
  it("offers every skill, with a field per argument, and names the one still missing", async () => {
    world(facilitator());
    await mount();
    const tool = screen.getByLabelText(`${BRAND.name} tool`);
    expect(within(tool).getAllByRole("option")).toHaveLength(SKILLS.length);
    expect(screen.getByRole("button", { name: "Enter the token address" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("token address"), "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed");
    expect(screen.getByRole("button", { name: "Read price" })).toBeEnabled();
    await userEvent.selectOptions(tool, "radar");
    expect(screen.queryByLabelText("token address")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read price" })).toBeEnabled();
    expect(screen.getByText(/This one costs about 0.02 USDC a call/)).toBeInTheDocument();
  });

  it("copies the tool's URL, says so for a moment, and does nothing without a clipboard", async () => {
    world(facilitator());
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await mount();
    await userEvent.selectOptions(screen.getByLabelText(`${BRAND.name} tool`), "radar");
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Copy URL" }));
      await act(async () => {});
      expect(writeText).toHaveBeenCalledWith(`${location.origin}${API_PATH}/radar`);
      expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1800));
      expect(screen.getByRole("button", { name: "Copy URL" })).toBeInTheDocument();
      vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
      fireEvent.click(screen.getByRole("button", { name: "Copy URL" }));
      await act(async () => {});
      expect(screen.getByRole("button", { name: "Copy URL" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks an optional argument as optional", async () => {
    world(facilitator());
    await mount();
    const optional = SKILLS.flatMap((s) => s.args.map((a) => [s.id, a] as const)).find(([, a]) => a.optional);
    if (!optional) return;
    await userEvent.selectOptions(screen.getByLabelText(`${BRAND.name} tool`), optional[0]);
    expect(screen.getByLabelText(optional[1].name)).toHaveAttribute("placeholder", `${optional[1].hint} (optional)`);
  });

  it("reads the price from this app's own 402, to its own fee address, with no pin to confirm", async () => {
    world(facilitator());
    await mount();
    await userEvent.selectOptions(screen.getByLabelText(`${BRAND.name} tool`), "radar");
    await userEvent.click(screen.getByRole("button", { name: "Read price" }));
    expect(await screen.findByRole("button", { name: "Pay 0.02 USDC and fetch" })).toBeInTheDocument();
    expect(screen.getByText(`${location.origin}${API_PATH}/radar`)).toBeInTheDocument();
    expect(screen.queryByText(/Pin this payee/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Endpoint URL")).not.toBeInTheDocument();
  });

  it("pays, and shows the report and the settlement — the whole sale, end to end", async () => {
    ready();
    const f = facilitator();
    const payments = world(f);
    await mount();
    await userEvent.selectOptions(screen.getByLabelText(`${BRAND.name} tool`), "radar");
    await userEvent.click(screen.getByRole("button", { name: "Read price" }));
    await userEvent.click(await screen.findByRole("button", { name: "Pay 0.02 USDC and fetch" }));
    await waitFor(() => expect(within(screen.getByRole("group", { name: "x402 output" })).getByText(/Launch Radar/)).toBeInTheDocument());
    expect(f.calls).toEqual(["verify", "settle"]);
    const signed = jsonFromBase64(payments[0]!, PAYMENT_SIGNATURE) as { accepted: { payTo: string; amount: string } };
    expect(signed.accepted).toMatchObject({ payTo: CONTRACTS.treasury, amount: "20000" });
  });

  it("asks for a wallet when there is none, from the same place the other ways in do", async () => {
    vi.stubGlobal("ethereum", undefined);
    world(facilitator());
    await mount();
    await userEvent.selectOptions(screen.getByLabelText(`${BRAND.name} tool`), "radar");
    await userEvent.click(screen.getByRole("button", { name: "Read price" }));
    const connect = await screen.findByRole("button", { name: "Connect wallet" });
    await userEvent.click(connect);
    expect(screen.getByRole("button", { name: "Pay 0.02 USDC and fetch" })).toBeDisabled();
  });

  it("says in the server's own words why nothing is for sale yet", async () => {
    world(null);
    await mount();
    await userEvent.selectOptions(screen.getByLabelText(`${BRAND.name} tool`), "radar");
    await userEvent.click(screen.getByRole("button", { name: "Read price" }));
    await waitFor(() => expect(screen.getByRole("group", { name: "x402 output" })).toHaveTextContent(`${location.origin} answered 503: ${NO_FACILITATOR.replace(/\.$/, "")}. Nothing was paid.`));
  });

  it("forgets the price when the tool or an argument changes", async () => {
    world(facilitator());
    await mount();
    await userEvent.type(screen.getByLabelText("token address"), "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed");
    await userEvent.click(screen.getByRole("button", { name: "Read price" }));
    await screen.findByText(`${location.origin}${API_PATH}/verdict?arg=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed`);
    await userEvent.type(screen.getByLabelText("token address"), "x");
    expect(screen.queryByText(/\/verdict\?arg=/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Read price" }));
    await screen.findByText(/\/verdict\?arg=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefedx/);
    await userEvent.selectOptions(screen.getByLabelText(`${BRAND.name} tool`), "radar");
    expect(screen.queryByText(/\/verdict\?arg=/)).not.toBeInTheDocument();
  });
});
