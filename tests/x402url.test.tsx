import { describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdaptersProvider } from "@/adapters/AdaptersProvider";
import { LocalEnclave } from "@/adapters/local/enclave";
import { LocalCatalog } from "@/adapters/local/catalog";
import type { Adapters } from "@/adapters/types";
import { BAZAAR } from "@/adapters/http/bazaar";
import { X402Panel } from "@/features/panels/X402Panel";
import { useSpending } from "@/features/panels/X402Parts";
import { BASE } from "@/config/chain";
import { loadPins, PINS_KEY } from "@/lib/pins";
import { loadSpend, SPEND_KEY } from "@/lib/spendGuard";
import { jsonFromBase64, PAYMENT_REQUIRED, PAYMENT_RESPONSE, PAYMENT_SIGNATURE, toBase64Utf8 } from "@/lib/x402http";
import { FORWARD_PATH, FORWARDED_MARK, FORWARDED_VALUE } from "@/server/forward";
import { WalletProvider } from "@/ui/WalletProvider";

/** The x402 window's BlueAgent and any-URL halves are HIDDEN in the product (FLAGS.x402Others, 2026-10-02) but kept — and tested here switched on. */
vi.mock("@/config/chain", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/config/chain")>();
  return { ...real, FLAGS: { ...real.FLAGS, x402Others: true } };
});


/**
 * The any-URL half of the x402 window, and the spending limits both halves share.
 *
 * The network is a fake keyed by URL — the real endpoint (which may "refuse CORS" by
 * throwing, as a browser does) and the forwarder path — so every route the window can
 * take is exercised without leaving the test. The 402 is the one measured from
 * x402uselessfacts.vercel.app on 2026-09-29 (see `tests/x402http.test.ts`).
 */

const URL_ = "https://x402uselessfacts.vercel.app/api/useless-fact";
const ORIGIN = "https://x402uselessfacts.vercel.app";
const PAYEE = "0xD7d49D6a12Ee3852f29A52A40908069bF4e48914";
const ACCOUNT = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const SIGNATURE = `0x${"a".repeat(130)}`;

const EXACT = {
  scheme: "exact",
  network: "eip155:8453",
  amount: "1000",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: PAYEE,
  maxTimeoutSeconds: 300,
  extra: { name: "USD Coin", version: "2" },
};
const REQUIRED = { x402Version: 2, error: "Payment required", resource: { url: URL_ }, accepts: [EXACT] };
const encoded = (v: unknown) => toBase64Utf8(JSON.stringify(v));

type Answer = Response | "cors";
type Seen = { url: string; headers: Headers };

/**
 * Route by URL. `direct[url]` answers the endpoint itself ("cors" throws, as a browser
 * does on a server that sends no CORS headers); `forwarded[url]` answers the forwarder's
 * `?url=` for that target. Factories, because a Response body can be read once.
 */
function network(direct: Record<string, () => Answer>, forwarded: Record<string, () => Response> = {}): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    seen.push({ url, headers: new Headers(init?.headers) });
    if (url.startsWith(FORWARD_PATH)) {
      const target = new URL(url, "http://app.test").searchParams.get("url") ?? "";
      const make = forwarded[target];
      if (!make) throw new TypeError("Failed to fetch");
      return make();
    }
    const make = direct[url.split("?")[0] ?? url] ?? direct[url];
    const answer = make ? make() : "cors";
    if (answer === "cors") throw new TypeError("Failed to fetch");
    return answer;
  });
  return seen;
}

const quote402 = () => new Response("{}", { status: 402, headers: { [PAYMENT_REQUIRED]: encoded(REQUIRED) } });

function fakeWallet(answers: Record<string, unknown>) {
  return {
    request: (args: { method: string }) =>
      args.method in answers ? Promise.resolve(answers[args.method]) : Promise.reject(new Error(`unstubbed ${args.method}`)),
    on: () => {},
    removeListener: () => {},
  };
}

const ready = () =>
  vi.stubGlobal("ethereum", fakeWallet({ eth_accounts: [ACCOUNT], eth_chainId: BASE.idHex, eth_signTypedData_v4: SIGNATURE }));

function adapters(): Adapters {
  return { enclave: new LocalEnclave(), catalog: new LocalCatalog() };
}

async function mount() {
  render(
    <AdaptersProvider value={adapters()}>
      <WalletProvider>
        <X402Panel />
      </WalletProvider>
    </AdaptersProvider>,
  );
  await act(async () => {});
}

async function urlHalf() {
  await mount();
  await userEvent.click(screen.getByRole("button", { name: "Any x402 URL" }));
}

/** The BlueAgent directory — no longer the first way in, since Quadra sells its own tools. */
async function directoryHalf() {
  await mount();
  await userEvent.click(screen.getByRole("button", { name: "BlueAgent tools" }));
}

async function read(url = URL_) {
  await userEvent.type(screen.getByLabelText("Endpoint URL"), url);
  await userEvent.click(screen.getByRole("button", { name: "Read price" }));
}

const crt = () => screen.getByRole("group", { name: "x402 output" });

function pinned() {
  localStorage.setItem(PINS_KEY, JSON.stringify([{ origin: ORIGIN, address: PAYEE, pinnedAt: "2026-09-29T08:00:00.000Z" }]));
}

describe("the three ways in", () => {
  it("opens on Quadra's own tools, and switches to the directory, to any URL and back", async () => {
    await mount();
    expect(screen.getByRole("button", { name: "Quadra tools" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Quadra tool")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "BlueAgent tools" }));
    expect(screen.getByRole("button", { name: "BlueAgent tools" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Tool")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Any x402 URL" }));
    expect(screen.getByRole("button", { name: "Any x402 URL" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Endpoint URL")).toBeInTheDocument();
    expect(within(crt()).getByText("// paste an x402 URL, or browse the Bazaar")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "BlueAgent tools" }));
    expect(screen.getByLabelText("Tool")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Quadra tools" }));
    expect(screen.getByLabelText("Quadra tool")).toBeInTheDocument();
  });
});

describe("quoting a URL", () => {
  it("has nothing to read until a URL is typed", async () => {
    await urlHalf();
    expect(screen.getByRole("button", { name: "Read price" })).toBeDisabled();
  });

  /** 🔴 A payee named by the server asking to be paid is not evidence: refused until confirmed. */
  it("shows the price and refuses to pay a payee nobody has confirmed", async () => {
    network({ [URL_]: quote402 });
    await urlHalf();
    await read();
    await waitFor(() => expect(screen.getByText(/0.001 USDC on Base, to/)).toBeInTheDocument());
    expect(screen.getByText(/no record of who https:\/\/x402uselessfacts\.vercel\.app gets paid to/)).toHaveClass("caution");
    expect(screen.getByRole("button", { name: "Pay 0.001 USDC and fetch" })).toBeDisabled();
    expect(screen.getByRole("button", { name: `Pin this payee for ${ORIGIN}` })).toBeDisabled();
  });

  /** Two deliberate actions: tick that it was checked elsewhere, then pin. */
  it("pins a confirmed payee, re-reads, and can forget it again", async () => {
    network({ [URL_]: quote402 });
    await urlHalf();
    await read();
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: `Pin this payee for ${ORIGIN}` }));

    await waitFor(() => expect(screen.getByText(/You confirmed this origin's payee on \d{4}-\d{2}-\d{2}/)).toBeInTheDocument());
    expect(screen.queryByText(/no record of who/)).not.toBeInTheDocument();
    expect(loadPins(localStorage).map((p) => [p.origin, p.address])).toEqual([[ORIGIN, PAYEE]]);

    await userEvent.click(screen.getByRole("button", { name: "Forget" }));
    await waitFor(() => expect(screen.getByText(/no record of who/)).toBeInTheDocument());
    expect(loadPins(localStorage)).toEqual([]);
  });

  it("says how many other ways to pay it passed over", async () => {
    const permit2 = { ...EXACT, extra: { ...EXACT.extra, assetTransferMethod: "permit2" } };
    const solana = { ...EXACT, network: "solana:5eykt4", asset: "EPjF" };
    network({ [URL_]: () => new Response("{}", { status: 402, headers: { [PAYMENT_REQUIRED]: encoded({ ...REQUIRED, accepts: [EXACT, permit2, solana] }) } }) });
    await urlHalf();
    await read();
    await waitFor(() => expect(screen.getByText(/It also offered 2 other ways to pay that this build does not sign/)).toBeInTheDocument());
  });

  it("says one other way, in the singular", async () => {
    const permit2 = { ...EXACT, extra: { ...EXACT.extra, assetTransferMethod: "permit2" } };
    network({ [URL_]: () => new Response("{}", { status: 402, headers: { [PAYMENT_REQUIRED]: encoded({ ...REQUIRED, accepts: [EXACT, permit2] }) } }) });
    await urlHalf();
    await read();
    await waitFor(() => expect(screen.getByText(/It also offered one other way to pay/)).toBeInTheDocument());
  });

  /** Measured: uselessfacts sends no CORS header, so the forwarder asked on the browser's behalf. */
  it("says when the price was read through the forwarder", async () => {
    network({ [URL_]: () => "cors" }, {
      [URL_]: () => new Response("{}", { status: 402, headers: { [PAYMENT_REQUIRED]: encoded(REQUIRED), [FORWARDED_MARK]: FORWARDED_VALUE } }),
    });
    await urlHalf();
    await read();
    await waitFor(() => expect(screen.getByText(/Read through this app's forwarder/)).toBeInTheDocument());
  });

  it("shows a free answer in the output rather than asking twice", async () => {
    network({ [URL_]: () => new Response('{"fact":"flamingos"}', { status: 200 }) });
    await urlHalf();
    await read();
    await waitFor(() => expect(within(crt()).getByText(/flamingos/)).toBeInTheDocument());
    expect(screen.getByText(/Free. It answered without asking to be paid/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pay / })).not.toBeInTheDocument();
  });

  it("puts a refusal in the output, in the reader's own words", async () => {
    await urlHalf();
    await read("nope");
    await waitFor(() => expect(within(crt()).getByText(/"nope" is not a URL/)).toBeInTheDocument());
  });

  it("says so when the confirmed payees cannot be read, and trusts none of them", async () => {
    localStorage.setItem(PINS_KEY, "not json");
    await urlHalf();
    expect(screen.getByText(/could not be read, so none of them are being trusted/)).toHaveClass("caution");
  });
});

describe("the Bazaar", () => {
  const listing = {
    items: [
      {
        type: "http",
        x402Version: 2,
        resource: URL_,
        description: "One useless fact.",
        accepts: [EXACT],
        extensions: { bazaar: { info: { input: { type: "http", method: "GET" } } } },
      },
    ],
    pagination: { total: 19106 },
  };

  /** Measured: the directory API sends no CORS header, so this goes through the forwarder too. */
  it("lists what this build can pay, and quotes the one picked — from the endpoint, not the list", async () => {
    network({ [URL_]: quote402 }, {
      [`${BAZAAR.resources}?limit=100`]: () => new Response(JSON.stringify(listing), { headers: { [FORWARDED_MARK]: FORWARDED_VALUE } }),
    });
    await urlHalf();
    await userEvent.click(screen.getByRole("button", { name: "Browse the x402 Bazaar" }));
    await waitFor(() => expect(screen.getByLabelText("Bazaar listing")).toBeInTheDocument());
    expect(screen.getByText(/1 of the first 1 listed \(of 19106 in the directory\) can be paid by this build/)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Bazaar listing"), URL_);
    expect(screen.getByLabelText("Endpoint URL")).toHaveValue(URL_);
    await waitFor(() => expect(screen.getByText(/0.001 USDC on Base/)).toBeInTheDocument());
  });

  it("leaves the directory's own total out when it gave none", async () => {
    network({}, {
      [`${BAZAAR.resources}?limit=100`]: () => new Response(JSON.stringify({ items: listing.items }), { headers: { [FORWARDED_MARK]: FORWARDED_VALUE } }),
    });
    await urlHalf();
    await userEvent.click(screen.getByRole("button", { name: "Browse the x402 Bazaar" }));
    await waitFor(() => expect(screen.getByText(/1 of the first 1 listed can be paid by this build/)).toBeInTheDocument());
  });

  it("says why when the list cannot be read", async () => {
    network({});
    await urlHalf();
    await userEvent.click(screen.getByRole("button", { name: "Browse the x402 Bazaar" }));
    await waitFor(() => expect(screen.getByText(/no forwarder on this host/)).toHaveClass("caution"));
  });
});

describe("paying a URL", () => {
  it("signs, records the signature, sends PAYMENT-SIGNATURE, and shows the answer and the settlement", async () => {
    pinned();
    ready();
    const seen = network({
      [URL_]: () => {
        const paying = seen.at(-1)?.headers.get(PAYMENT_SIGNATURE);
        return paying
          ? new Response('{"fact":"f"}', { status: 200, headers: { [PAYMENT_RESPONSE]: encoded({ success: true, transaction: "0xfeed" }) } })
          : quote402();
      },
    });
    await urlHalf();
    await read();
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay 0.001 USDC and fetch" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Pay 0.001 USDC and fetch" }));

    await waitFor(() => expect(within(crt()).getByText(/"fact": "f"/)).toBeInTheDocument());
    const payload = jsonFromBase64(seen.at(-1)!.headers.get(PAYMENT_SIGNATURE)!, "x") as { accepted: unknown; payload: { signature: string } };
    expect(payload.accepted).toEqual(EXACT);
    expect(payload.payload.signature).toBe(SIGNATURE);
    expect(loadSpend(localStorage).ledger.map((p) => [p.value, p.resource])).toEqual([[1000n, URL_]]);
  });

  it("refuses above the user's own limit, with the reason beside the button", async () => {
    pinned();
    ready();
    localStorage.setItem(SPEND_KEY, JSON.stringify({ limits: { perPayment: "500", perDay: "5000" }, ledger: [] }));
    network({ [URL_]: quote402 });
    await urlHalf();
    await read();
    await waitFor(() => expect(screen.getByText(/above your limit of 0.0005 USDC per payment/)).toHaveClass("caution"));
    expect(screen.getByRole("button", { name: "Pay 0.001 USDC and fetch" })).toBeDisabled();
  });

  it("will not pay without a ready wallet, and offers to connect one", async () => {
    pinned();
    network({ [URL_]: quote402 });
    await urlHalf();
    await read();
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay 0.001 USDC and fetch" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
  });

  /** The connect button in this half reaches the same one wallet session as the rest of the page. */
  it("connects from this half, and the button comes alive once the wallet is ready", async () => {
    pinned();
    let connected = false;
    vi.stubGlobal("ethereum", {
      request: (args: { method: string }) => {
        if (args.method === "eth_accounts") return Promise.resolve(connected ? [ACCOUNT] : []);
        if (args.method === "wallet_requestPermissions") {
          connected = true;
          return Promise.resolve([ACCOUNT]);
        }
        if (args.method === "eth_chainId") return Promise.resolve(BASE.idHex);
        return Promise.reject(new Error(`unstubbed ${args.method}`));
      },
      on: () => {},
      removeListener: () => {},
    });
    network({ [URL_]: quote402 });
    await urlHalf();
    await read();
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay 0.001 USDC and fetch" })).toBeEnabled());
  });

  it("puts a refused payment in the output", async () => {
    pinned();
    ready();
    const seen = network({
      [URL_]: () =>
        seen.at(-1)?.headers.get(PAYMENT_SIGNATURE)
          ? new Response("{}", { status: 402, headers: { [PAYMENT_REQUIRED]: encoded({ ...REQUIRED, error: "invalid_signature" }) } })
          : quote402(),
    });
    await urlHalf();
    await read();
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay 0.001 USDC and fetch" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Pay 0.001 USDC and fetch" }));
    await waitFor(() => expect(within(crt()).getByText(/refused the payment: invalid_signature/)).toBeInTheDocument());
  });
});

describe("the limits line", () => {
  async function paidQuote() {
    pinned();
    network({ [URL_]: quote402 });
    await urlHalf();
    await read();
    await waitFor(() => expect(screen.getByText(/Your limits:/)).toBeInTheDocument());
  }

  it("states the limits and what was signed today", async () => {
    await paidQuote();
    expect(screen.getByText(/Your limits: 1 USDC per payment, 5 USDC per 24 hours — 0 USDC signed in the last 24 hours/)).toBeInTheDocument();
  });

  it("changes them, refusing nonsense in its own words", async () => {
    await paidQuote();
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByLabelText("Limit per payment")).toHaveValue("1");
    expect(screen.getByLabelText("Limit per day")).toHaveValue("5");

    await userEvent.clear(screen.getByLabelText("Limit per day"));
    await userEvent.type(screen.getByLabelText("Limit per day"), "0.5");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/below the per-payment limit/)).toHaveClass("caution");

    await userEvent.clear(screen.getByLabelText("Limit per payment"));
    await userEvent.type(screen.getByLabelText("Limit per payment"), "0.25");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/Your limits: 0.25 USDC per payment, 0.5 USDC per 24 hours/)).toBeInTheDocument();
    expect(loadSpend(localStorage).limits).toEqual({ perPayment: 250_000n, perDay: 500_000n });
  });

  it("can be left unchanged", async () => {
    await paidQuote();
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(/Your limits: 1 USDC per payment/)).toBeInTheDocument();
  });

  /** 🔴 Fails closed, and the way out is deliberate. */
  it("refuses to pay on an unreadable record until the user resets it", async () => {
    ready();
    localStorage.setItem(SPEND_KEY, "not json");
    pinned();
    network({ [URL_]: quote402 });
    await urlHalf();
    await read();
    await waitFor(() => expect(screen.getAllByText(/today's total is unknown/)[0]).toHaveClass("caution"));
    expect(screen.getByRole("button", { name: "Pay 0.001 USDC and fetch" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Reset the record" }));
    expect(screen.getByText(/Your limits: 1 USDC per payment/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay 0.001 USDC and fetch" })).toBeEnabled();
  });
});

describe("the directory half under the same limits", () => {
  it("refuses a tool above the per-payment limit", async () => {
    localStorage.setItem(SPEND_KEY, JSON.stringify({ limits: { perPayment: "5000", perDay: "50000" }, ledger: [] }));
    await directoryHalf();
    await userEvent.selectOptions(screen.getByLabelText("Tool"), "gas-tracker");
    await waitFor(() => expect(screen.getByText(/above your limit of 0.005 USDC per payment/)).toHaveClass("caution"));
    expect(screen.getByRole("button", { name: "Run for 0.01 USDC" })).toBeDisabled();
  });

  it("records what the directory half signs, so the other half's daily total sees it", async () => {
    ready();
    await directoryHalf();
    await userEvent.selectOptions(screen.getByLabelText("Tool"), "gas-tracker");
    await waitFor(() => expect(screen.getByRole("button", { name: "Run for 0.01 USDC" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Run for 0.01 USDC" }));
    await waitFor(() => expect(loadSpend(localStorage).ledger).toHaveLength(1));
    expect(loadSpend(localStorage).ledger[0]?.resource).toBe("gas-tracker");
  });
});

describe("useSpending, on its own", () => {
  it("enforces the limit on the signing path, not only on the button", () => {
    const { result } = renderHook(() => useSpending());
    expect(() => result.current.assertAllowed(1_000_000n)).not.toThrow();
    expect(() => result.current.assertAllowed(1_000_001n)).toThrow(/^Nothing was signed. This asks for 1.000001 USDC/);
  });

  /** Two payments in one tick must each see the other — the reason `latest` is a ref. */
  it("counts a signature recorded a moment ago before the next render", () => {
    const { result } = renderHook(() => useSpending());
    act(() => {
      result.current.record({ value: 4_500_000n, payee: PAYEE, resource: "a" });
      expect(result.current.refusal(1_000_000n)).toMatch(/past your daily limit/);
    });
  });

  it("throws when the record cannot be stored, so the caller never sends", () => {
    const { result } = renderHook(() => useSpending());
    const full = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      expect(() => result.current.record({ value: 1n, payee: PAYEE, resource: "a" })).toThrow("QuotaExceededError");
    } finally {
      full.mockRestore();
    }
    expect(result.current.ledger).toEqual([]);
  });
});
