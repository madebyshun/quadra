import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdaptersProvider, useAdapters } from "@/adapters/AdaptersProvider";
import { LocalEnclave } from "@/adapters/local/enclave";
import { LOCAL_TOOLS, LocalCatalog, priceOf } from "@/adapters/local/catalog";
import { NO_WALLET } from "@/adapters/http/catalog";
import { BLUEAGENT } from "@/config/upstream";
import type { Adapters, Model, Quote, Tool } from "@/adapters/types";
import { notBuiltNotice, UNBUILT, WAITING_ON } from "@/features/FeaturePanel";
import { Attested, Settled } from "@/features/panels/Anchor";
import { InferencePanel } from "@/features/panels/InferencePanel";
import { X402Panel } from "@/features/panels/X402Panel";
import { HooksPanel } from "@/features/panels/HooksPanel";
import { installLine, McpPanel } from "@/features/panels/McpPanel";
import { HOOK_PERMISSIONS } from "@/lib/hooks";
import { MCP_BUILD, MCP_TOOLS, mcpConfigSnippet } from "@/lib/manifest";
import { checkRequirements } from "@/lib/requirements";
import { WalletProvider } from "@/ui/WalletProvider";
import { BASE, USDC } from "@/config/chain";
import { renderAt, settle } from "./helpers";

/** The x402 window's BlueAgent and any-URL halves are HIDDEN in the product (FLAGS.x402Others, 2026-10-02) but kept — and tested here switched on. */
vi.mock("@/config/chain", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/config/chain")>();
  return { ...real, FLAGS: { ...real.FLAGS, x402Others: true } };
});


const PAYEE = "0x1111111111111111111111111111111111111111";

/** The stub's own record for an id, so a test can price it the way the stub does. */
const byId = (id: string) => LOCAL_TOOLS.find((t) => t.id === id)!;

function stub(): Adapters {
  return {
    enclave: new LocalEnclave(),
    catalog: new LocalCatalog(),
  };
}

/**
 * Mount one panel against fresh adapters, the way a window does.
 *
 * Awaits a flush inside `act` because both panels load from their adapter in an
 * effect: without it the resolution lands outside act, React warns, and every
 * assertion races the first paint. Returning a promise makes that unavoidable at
 * the call site rather than something each test must remember.
 */
/**
 * The provider stack a panel really sits in, as one value.
 *
 * Exported as a function rather than inlined because the `rerender` calls below
 * have to rebuild the SAME stack — they rebuilt only `AdaptersProvider`, so the
 * moment a panel started reading the wallet session they threw on the second
 * render instead of the first, which reads as a re-render bug rather than a
 * missing provider. `WalletProvider` wraps every panel, not just the ones that
 * currently need it, because that is what `App.tsx` does.
 */
function wrap(node: React.ReactNode, value: Adapters) {
  return (
    <AdaptersProvider value={value}>
      <WalletProvider>{node}</WalletProvider>
    </AdaptersProvider>
  );
}

async function mount(node: React.ReactNode, value: Adapters = stub()) {
  const rendered = render(wrap(node, value));
  await act(async () => {});
  return { ...rendered, adapters: value };
}

/**
 * Replace one method on an adapter, keeping the rest working.
 *
 * `{ ...instance, method: fn }` does NOT do this. The adapters are class
 * instances, so their methods live on the prototype and a spread copies only the
 * own fields — the result silently loses every method not overridden, and the
 * failure surfaces later as "x is not a function" inside a React effect, nowhere
 * near the line that caused it. Going through the prototype keeps the rest.
 */
function patch<T extends object>(base: T, overrides: Partial<T>): T {
  const proto = Object.getPrototypeOf(base) as object;
  return Object.assign(Object.create(proto) as T, base, overrides);
}

const amount = (label: string) => screen.getByLabelText(label);
const out = (label: string) => screen.getByRole("group", { name: label });

describe("AdaptersProvider", () => {
  it("refuses to hand out adapters to a component outside it", () => {
    function Orphan() {
      useAdapters();
      return null;
    }
    // React re-logs a render-time throw to console.error. Muted so this expected
    // stack does not sit in the output where a real failure would be looked for.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<Orphan />)).toThrow("must be called inside <AdaptersProvider>");
    } finally {
      quiet.mockRestore();
    }
  });

  it("builds real adapters when no value is passed", () => {
    function Show() {
      const { catalog, enclave } = useAdapters();
      return <span>{`${catalog.isLive} ${enclave.isLive}`}</span>;
    }
    render(
      <AdaptersProvider>
        <Show />
      </AdaptersProvider>,
    );
    expect(screen.getByText("false false")).toBeInTheDocument();
  });

  /**
   * The fallback is built once per provider, not once per render. A panel that re-read
   * the catalog on every render would refetch it on every keystroke.
   */
  it("keeps the same adapters across re-renders", () => {
    const seen: Adapters[] = [];
    function Record() {
      seen.push(useAdapters());
      return null;
    }
    const { rerender } = render(
      <AdaptersProvider>
        <Record />
      </AdaptersProvider>,
    );
    rerender(
      <AdaptersProvider>
        <Record />
      </AdaptersProvider>,
    );
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
  });
});

describe("Attested", () => {
  it("shows the measurement to check, not a verified tick", () => {
    render(
      <Attested
        attestation={{
          kind: "enclave",
          quote: "0xquote",
          measurement: "0xabc123",
          attestedAt: "2026-09-27T00:00:00.000Z",
        }}
      />,
    );
    expect(screen.getByText("0xabc123")).toBeInTheDocument();
    expect(screen.getByText(/check it against the build you expected/)).toBeInTheDocument();
  });

  it("says it was attested by nothing, rather than showing a false flag", () => {
    render(<Attested attestation={{ kind: "local-dev", why: "no enclave is running" }} />);
    expect(screen.getByText("Not attested: no enclave is running.")).toBeInTheDocument();
  });
});

describe("Settled", () => {
  /**
   * The `settled` branch is the one no local adapter can produce, so it is
   * rendered directly here. It first runs for real the day the router pays
   * something, and by then it is printing a number next to a payee address.
   */
  it("prints the amount, the payee and a link to the payment", () => {
    render(
      <Settled
        settlement={{
          kind: "settled",
          txHash: `0x${"b".repeat(64)}`,
          payTo: PAYEE,
          amountBaseUnits: 50_000n,
        }}
      />,
    );
    expect(screen.getByText(new RegExp(`Paid 0.05 USDC to ${PAYEE}`))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the payment" })).toHaveAttribute(
      "href",
      `https://basescan.org/tx/0x${"b".repeat(64)}`,
    );
  });

  it("formats the amount in USDC decimals, not as raw base units", () => {
    render(
      <Settled
        settlement={{
          kind: "settled",
          txHash: `0x${"b".repeat(64)}`,
          payTo: PAYEE,
          amountBaseUnits: 1_000_000n,
        }}
      />,
    );
    expect(screen.getByText(/Paid 1 USDC/)).toBeInTheDocument();
    expect(screen.queryByText(/1000000/)).not.toBeInTheDocument();
  });

  it("says a free call was free, which is not the same as unpaid", () => {
    render(<Settled settlement={{ kind: "free", why: "this tool asks for nothing" }} />);
    expect(screen.getByText("No charge: this tool asks for nothing.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("says unpaid without a link, because there is no transaction to link to", () => {
    render(<Settled settlement={{ kind: "unsettled", why: "nothing was charged" }} />);
    expect(screen.getByText("Not paid: nothing was charged.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("InferencePanel", () => {
  it("loads the models and preselects the cheapest", async () => {
    await mount(<InferencePanel />);
    await waitFor(() => expect(amount("Model")).toHaveValue("quadra-small"));
    expect(screen.getByText(/0.001 USDC per question/)).toBeInTheDocument();
  });

  it("prices each model as it is chosen", async () => {
    await mount(<InferencePanel />);
    await waitFor(() => expect(amount("Model")).toHaveValue("quadra-small"));
    await userEvent.selectOptions(amount("Model"), "quadra-large");
    expect(screen.getByText(/0.1 USDC per question/)).toBeInTheDocument();
  });

  it("will not ask on an empty prompt", async () => {
    await mount(<InferencePanel />);
    await waitFor(() => expect(amount("Model")).toHaveValue("quadra-small"));
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();

    await userEvent.type(amount("Prompt"), "   ");
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
  });

  it("answers, and says outright that nothing attested it", async () => {
    await mount(<InferencePanel />);
    await waitFor(() => expect(amount("Model")).toHaveValue("quadra-small"));
    await userEvent.type(amount("Prompt"), "what are you");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));

    const panel = out("Answer");
    await waitFor(() => expect(within(panel).getByText(/\[no model ran\]/)).toBeInTheDocument());
    expect(within(panel).getByText(/Not attested:/)).toBeInTheDocument();
    expect(panel.textContent).toContain('"what are you"');
  });

  it("surfaces a failure from the enclave instead of inventing an answer", async () => {
    const value = stub();
    value.enclave = {
      isLive: false,
      models: async () => [{ id: "only", label: "Only", priceBaseUnits: 1n }],
      infer: async () => {
        throw new Error("The enclave did not answer.");
      },
    };
    await mount(<InferencePanel />, value);
    await waitFor(() => expect(amount("Model")).toHaveValue("only"));
    await userEvent.type(amount("Prompt"), "hi");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() =>
      expect(within(out("Answer")).getByText("The enclave did not answer.")).toBeInTheDocument(),
    );
  });

  it("reports a non-Error rejection rather than swallowing it", async () => {
    const value = stub();
    value.enclave = {
      isLive: false,
      models: async () => [{ id: "only", label: "Only", priceBaseUnits: 1n }],
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      infer: async () => Promise.reject("upstream sent a string"),
    };
    await mount(<InferencePanel />, value);
    await waitFor(() => expect(amount("Model")).toHaveValue("only"));
    await userEvent.type(amount("Prompt"), "hi");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() =>
      expect(within(out("Answer")).getByText("upstream sent a string")).toBeInTheDocument(),
    );
  });

  it("keeps the model you chose when the list reloads", async () => {
    const value = stub();
    const { rerender } = await mount(<InferencePanel />, value);
    await waitFor(() => expect(amount("Model")).toHaveValue("quadra-small"));
    await userEvent.selectOptions(amount("Model"), "quadra-large");

    // A fresh enclave object re-runs the load effect, as switching windows would.
    rerender(wrap(<InferencePanel />, { ...value, enclave: new LocalEnclave() }));
    await waitFor(() => expect(amount("Model")).toHaveValue("quadra-large"));
  });

  it("shows no price line while the model list is still empty", async () => {
    const value = stub();
    value.enclave = patch(value.enclave, { models: async () => [] });
    await mount(<InferencePanel />, value);
    expect(screen.queryByText(/per question/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
  });

  /**
   * The load effect's cleanup, checked by its only observable symptom. A resolution
   * that lands after unmount would set state on a gone component, and React reports
   * that on console.error — so the spy asserting nothing was logged IS the assertion.
   */
  it("does not set state after unmounting, so a slow load cannot warn", async () => {
    let release!: (found: Model[]) => void;
    const value = stub();
    value.enclave = patch(value.enclave, {
      models: () =>
        new Promise<Model[]>((resolve) => {
          release = resolve;
        }),
    });
    const { unmount } = await mount(<InferencePanel />, value);
    unmount();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await act(async () => release([{ id: "late", label: "Late", priceBaseUnits: 1n }]));
      expect(quiet).not.toHaveBeenCalled();
    } finally {
      quiet.mockRestore();
    }
  });
});

describe("X402Panel", () => {
  it("loads the catalog and picks the first tool", async () => {
    await mount(<X402Panel start="directory" />);
    expect(amount("Tool")).toHaveValue("hood-live");
  });

  it("offers every tool with its own one-line summary", async () => {
    await mount(<X402Panel start="directory" />);
    const options = within(amount("Tool")).getAllByRole("option");
    expect(options).toHaveLength(LOCAL_TOOLS.length);
    expect(options[0]).toHaveTextContent(
      "Blue Hood Live Board — Every tokenized stock Blue Hood is watching right now",
    );
  });

  /**
   * The button is the promise. A single "Run" that sometimes costs money and
   * sometimes does not is the wording this asserts against.
   */
  it("says on the button what the run will cost", async () => {
    await mount(<X402Panel start="directory" />);
    expect(screen.getByRole("button", { name: "Run — free" })).toBeInTheDocument();
    await userEvent.selectOptions(amount("Tool"), "liquidity-depth");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Run for 0.03 USDC" })).toBeInTheDocument(),
    );
  });

  /**
   * ⚠️ "on Base", not "on eip155:8453", and the change is the point rather than
   * cosmetic. The panel now renders a price that `checkRequirements` returned, and that
   * check refuses any network but `eip155:8453` and then keeps no string — so the name
   * on screen is a restatement of an assertion that passed. Printing the raw field was
   * the weaker rendering: it looked precise while proving only that a string had been
   * copied from the wire to the screen.
   */
  it("names the payee and the chain before anything is signed", async () => {
    await mount(<X402Panel start="directory" />);
    await userEvent.selectOptions(amount("Tool"), "token-price");
    await waitFor(() => expect(screen.getByText(/0\.01 USDC on Base/)).toBeInTheDocument());
    expect(screen.getByText(BLUEAGENT.knownPayTo)).toBeInTheDocument();
  });

  /**
   * The window is on screen next to the price, because the amount alone understates
   * what is being agreed to: an EIP-3009 authorization is a bearer slip, so the risk is
   * the amount for as long as the slip stays live. Upstream asks for 120 seconds; this
   * build signs 180 (120 + `SETTLEMENT_SLACK_SECONDS`), which is the number the panel
   * must show — that is the window actually being agreed to, not the ask.
   */
  it("says how long the authorization it asks for stays spendable", async () => {
    await mount(<X402Panel start="directory" />);
    await userEvent.selectOptions(amount("Tool"), "token-price");
    await waitFor(() =>
      expect(screen.getByText(/stays spendable for 180 seconds/)).toBeInTheDocument(),
    );
  });

  it("says a free tool touches no wallet at all", async () => {
    await mount(<X402Panel start="directory" />);
    expect(screen.getByText(/Free\. No payment is sent/)).toBeInTheDocument();
    expect(screen.queryByText(BLUEAGENT.knownPayTo)).not.toBeInTheDocument();
    expect(screen.queryByText(/stays spendable/)).not.toBeInTheDocument();
  });

  /**
   * ⚠️ A rotated payee is shown TODAY, while this build still cannot sign anything.
   *
   * The tempting shortcut is to suppress the note until signing exists, on the grounds
   * that nothing can go wrong before then. It is the wrong call for a reason that has
   * nothing to do with today: the note would first appear on the day signing lands,
   * which is the single worst day to discover that upstream moved its payee. A warning
   * that stays silent for exactly the period when reading it is free has spent its
   * whole cheap life saying nothing.
   *
   * Note what the price does NOT do here: it still renders. The amount is real, the
   * asset is real, and the tool runs the moment a wallet exists — so this goes through
   * `.caution` and not the error path, and the run button's own refusal stays the
   * catalog's business rather than this component's.
   *
   * The requirements come from `checkRequirements` over a 402-shaped body rather than
   * from a hand-built struct, so the sentence asserted below is the checker's own. A
   * literal here could drift from what upstream's rotation actually produces and the
   * test would still pass, since it would be asserting against itself.
   */
  it("warns about a payee it does not recognise, without calling the price an error", async () => {
    const stranger = "0x1111111111111111111111111111111111111112";
    const rotated = checkRequirements("token-price", BLUEAGENT.origin, {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          asset: USDC.address,
          amount: "10000",
          payTo: stranger,
          maxTimeoutSeconds: 120,
          extra: USDC.eip712,
        },
      ],
    });
    const value = stub();
    value.catalog = patch(value.catalog, {
      quote: () => Promise.resolve({ toolId: "token-price", price: { kind: "paid", requirements: rotated } }),
    });
    await mount(<X402Panel start="directory" />, value);
    await waitFor(() => expect(screen.getByText(/0\.01 USDC on Base/)).toBeInTheDocument());
    expect(screen.getByText(new RegExp(`wants to be paid to ${stranger}`))).toBeInTheDocument();
    expect(screen.getByText(/Confirm the new address before signing/)).toBeInTheDocument();
    expect(screen.getByText(stranger)).toBeInTheDocument();
  });

  it("shows a field for each input the tool declares, and none otherwise", async () => {
    await mount(<X402Panel start="directory" />);
    await userEvent.selectOptions(amount("Tool"), "gas-tracker");
    await waitFor(() => expect(screen.queryByText("What it needs")).not.toBeInTheDocument());
    await userEvent.selectOptions(amount("Tool"), "competitor-scan");
    await waitFor(() => expect(amount("project")).toBeInTheDocument());
    expect(amount("description")).toBeInTheDocument();
    expect(amount("competitors")).toBeInTheDocument();
  });

  /**
   * Inputs are cleared with the tool. `token-price` and `liquidity-depth` both declare
   * `token` — really, not as a fixture convenience — so without this a value typed for
   * one is submitted to the other, and the user pays for a run against an argument they
   * did not type into the form in front of them.
   */
  it("clears the inputs when the tool changes, so nothing carries over", async () => {
    await mount(<X402Panel start="directory" />);
    await userEvent.selectOptions(amount("Tool"), "token-price");
    await waitFor(() => expect(amount("token")).toBeInTheDocument());
    await userEvent.type(amount("token"), "0xdead");
    expect(amount("token")).toHaveValue("0xdead");
    await userEvent.selectOptions(amount("Tool"), "liquidity-depth");
    await waitFor(() => expect(amount("token")).toHaveValue(""));
  });

  it("runs a free tool and says no charge was made", async () => {
    await mount(<X402Panel start="directory" />);
    await userEvent.click(screen.getByRole("button", { name: "Run — free" }));
    await waitFor(() =>
      expect(within(out("x402 output")).getByText(/No charge:/)).toBeInTheDocument(),
    );
  });

  it("runs a paid tool and says outright that nothing was paid", async () => {
    await mount(<X402Panel start="directory" />);
    await userEvent.selectOptions(amount("Tool"), "token-price");
    await waitFor(() => expect(amount("token")).toBeInTheDocument());
    await userEvent.type(amount("token"), "0xabc");
    await userEvent.click(screen.getByRole("button", { name: "Run for 0.01 USDC" }));
    await waitFor(() =>
      expect(within(out("x402 output")).getByText(/Not paid:/)).toBeInTheDocument(),
    );
  });

  it("never shows a payment link while the catalog is local", async () => {
    await mount(<X402Panel start="directory" />);
    await userEvent.click(screen.getByRole("button", { name: "Run — free" }));
    await waitFor(() =>
      expect(within(out("x402 output")).getByText(/nothing ran/)).toBeInTheDocument(),
    );
    expect(within(out("x402 output")).queryByRole("link")).not.toBeInTheDocument();
  });

  it("surfaces a missing input instead of running anyway", async () => {
    await mount(<X402Panel start="directory" />);
    await userEvent.selectOptions(amount("Tool"), "competitor-scan");
    await waitFor(() => expect(amount("project")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Run for 0.2 USDC" }));
    await waitFor(() =>
      expect(
        within(out("x402 output")).getByText("Competitor Scan needs project and description."),
      ).toBeInTheDocument(),
    );
  });

  it("clears a previous failure when the next run succeeds", async () => {
    await mount(<X402Panel start="directory" />);
    await userEvent.selectOptions(amount("Tool"), "blue-audit");
    await waitFor(() => expect(amount("prompt")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Run for 1 USDC" }));
    await waitFor(() =>
      expect(within(out("x402 output")).getByText(/needs prompt/)).toBeInTheDocument(),
    );
    await userEvent.type(amount("prompt"), "contract.sol");
    await userEvent.click(screen.getByRole("button", { name: "Run for 1 USDC" }));
    await waitFor(() =>
      expect(within(out("x402 output")).getByText(/nothing ran/)).toBeInTheDocument(),
    );
    expect(within(out("x402 output")).queryByText(/needs prompt/)).not.toBeInTheDocument();
  });

  it("reports a non-Error rejection from a run rather than swallowing it", async () => {
    const value = stub();
    value.catalog = patch(value.catalog, {
      run: () => Promise.reject("upstream said no"),
    });
    await mount(<X402Panel start="directory" />, value);
    await userEvent.click(screen.getByRole("button", { name: "Run — free" }));
    await waitFor(() =>
      expect(within(out("x402 output")).getByText("upstream said no")).toBeInTheDocument(),
    );
  });

  /**
   * A quote that fails must not leave the last tool's price on screen next to the
   * new tool's name. The panel shows the error and no price at all.
   */
  it("reports a failed quote without showing a stale price", async () => {
    const value = stub();
    value.catalog = patch(value.catalog, {
      quote: () => Promise.reject(new Error("the 402 could not be read")),
    });
    await mount(<X402Panel start="directory" />, value);
    await waitFor(() =>
      expect(
        within(out("x402 output")).getByText("the 402 could not be read"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/USDC on base/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
  });

  it("reports a non-Error rejection from a quote too", async () => {
    const value = stub();
    value.catalog = patch(value.catalog, { quote: () => Promise.reject("no quote") });
    await mount(<X402Panel start="directory" />, value);
    await waitFor(() =>
      expect(within(out("x402 output")).getByText("no quote")).toBeInTheDocument(),
    );
  });

  it("shows nothing to run when the catalog is empty", async () => {
    const value = stub();
    value.catalog = patch(value.catalog, { tools: async () => [] });
    await mount(<X402Panel start="directory" />, value);
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.queryByText("What it needs")).not.toBeInTheDocument();
  });

  it("keeps the tool you chose when the list reloads", async () => {
    const value = stub();
    const { rerender } = await mount(<X402Panel start="directory" />, value);
    await userEvent.selectOptions(amount("Tool"), "competitor-scan");
    rerender(wrap(<X402Panel start="directory" />, value));
    await settle();
    expect(amount("Tool")).toHaveValue("competitor-scan");
  });

  it("does not set state after unmounting, so a slow catalog cannot warn", async () => {
    let release!: (found: Tool[]) => void;
    const value = stub();
    value.catalog = patch(value.catalog, {
      tools: () =>
        new Promise<Tool[]>((resolve) => {
          release = resolve;
        }),
    });
    const { unmount } = await mount(<X402Panel start="directory" />, value);
    unmount();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await act(async () => release([{ id: "late", title: "Late", summary: "", inputs: [] }]));
      expect(quiet).not.toHaveBeenCalled();
    } finally {
      quiet.mockRestore();
    }
  });

  it("does not apply a quote that lands after the tool changed again", async () => {
    let release!: (found: Quote[]) => void;
    const value = stub();
    const real = value.catalog;
    value.catalog = patch(real, {
      quote: (id: string) =>
        id === "competitor-scan"
          ? new Promise<Quote>((resolve) => {
              release = (found) => resolve(found[0]!);
            })
          : real.quote(id),
    });
    await mount(<X402Panel start="directory" />, value);
    await userEvent.selectOptions(amount("Tool"), "competitor-scan");
    await userEvent.selectOptions(amount("Tool"), "token-price");
    await waitFor(() => expect(screen.getByText(/0\.01 USDC on Base/)).toBeInTheDocument());
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      /**
       * The late price is the stub's own, not a literal: `Price`'s paid variant carries a
       * `PaymentRequirements`, and the only way to hold one is to have run the checker.
       * `competitor-scan` is 0.2 USDC, which is what makes this test able to tell a
       * dropped quote from an applied one.
       */
      await act(async () =>
        release([{ toolId: "competitor-scan", price: priceOf(byId("competitor-scan")) }]),
      );
      expect(screen.queryByText(/0\.2 USDC/)).not.toBeInTheDocument();
      expect(screen.getByText(/0\.01 USDC on Base/)).toBeInTheDocument();
      expect(quiet).not.toHaveBeenCalled();
    } finally {
      quiet.mockRestore();
    }
  });

  /** 66 of the 115 tools upstream declare one. A form that demands them strands those tools. */
  it("marks an optional field as optional", async () => {
    await mount(<X402Panel start="directory" />);
    await userEvent.selectOptions(amount("Tool"), "competitor-scan");
    await waitFor(() => expect(amount("competitors")).toBeInTheDocument());
    expect(screen.getByText("project")).toBeInTheDocument();
    expect(screen.getByText("competitors — optional")).toBeInTheDocument();
  });

  /**
   * The real catalog is a network read, so it has a failure case the stub never had.
   * An empty select with the reason in the window is the honest answer; the wrong one
   * is a shorter list that looks like a catalog.
   */
  it("says why the catalog is empty when the list cannot be read", async () => {
    const value = stub();
    value.catalog = patch(value.catalog, {
      tools: () => Promise.reject(new Error("The catalog answered 503.")),
    });
    await mount(<X402Panel start="directory" />, value);
    expect(within(out("x402 output")).getByText("The catalog answered 503.")).toBeInTheDocument();
    expect(within(amount("Tool")).queryAllByRole("option")).toHaveLength(0);
  });

  it("reports a non-Error rejection from the catalog load too", async () => {
    const value = stub();
    value.catalog = patch(value.catalog, { tools: () => Promise.reject("upstream hung up") });
    await mount(<X402Panel start="directory" />, value);
    expect(within(out("x402 output")).getByText("upstream hung up")).toBeInTheDocument();
  });

  /**
   * A button reading "Run for 0.2 USDC" that throws on every click is the exact
   * dishonesty this panel is built to avoid, so the reason is on screen and the button
   * is not clickable. Over the live adapter this is the paid case: answering a 402
   * needs a signature nothing here can produce.
   */
  it("disables the button and gives the reason when a run is impossible", async () => {
    const value = stub();
    value.catalog = patch(value.catalog, { whyNot: () => NO_WALLET });
    await mount(<X402Panel start="directory" />, value);
    expect(screen.getByRole("button", { name: "Run — free" })).toBeDisabled();
    expect(screen.getByText(NO_WALLET)).toBeInTheDocument();
  });

  it("offers the button when the adapter says a run can be attempted", async () => {
    await mount(<X402Panel start="directory" />);
    expect(screen.getByRole("button", { name: "Run — free" })).toBeEnabled();
    expect(screen.queryByText(NO_WALLET)).not.toBeInTheDocument();
  });

  /**
   * Asked per price, so one tool can be refused while the next is offered. This is the
   * live shape: the six $0.00 ids run through the forwarder, the other 109 cannot. A
   * single per-adapter flag had to be wrong about one half of the catalog.
   */
  it("refuses the paid tool and still offers the free one", async () => {
    const value = stub();
    value.catalog = patch(value.catalog, {
      whyNot: (price) => (price.kind === "free" ? null : NO_WALLET),
    });
    await mount(<X402Panel start="directory" />, value);
    expect(screen.getByRole("button", { name: "Run — free" })).toBeEnabled();

    await userEvent.selectOptions(amount("Tool"), "competitor-scan");
    expect(screen.getByRole("button", { name: "Run for 0.2 USDC" })).toBeDisabled();
    expect(screen.getByText(NO_WALLET)).toBeInTheDocument();
  });

  /**
   * Nothing is clickable before the amount beside it is known. A run POSTs for real
   * now, and a bare "Run" offered while the quote is still in flight is a button that
   * does not say what it will do.
   */
  it("keeps the button disabled while the price is still being read", async () => {
    const value = stub();
    value.catalog = patch(value.catalog, { quote: () => new Promise<Quote>(() => {}) });
    await mount(<X402Panel start="directory" />, value);
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.getByText("Reading the price…")).toBeInTheDocument();
  });
});

/**
 * An injected wallet, driven by a method → answer map — the same shape as
 * `tests/wallet.test.ts`'s `fake`, kept local rather than shared because this file
 * only ever needs the happy path a `ready` wallet gives the panel.
 */
function fakeWallet(answers: Record<string, unknown>) {
  return {
    request: (args: { method: string }) => {
      if (!(args.method in answers)) {
        return Promise.reject(new Error(`test did not stub ${args.method}`));
      }
      const answer = answers[args.method];
      try {
        return Promise.resolve(typeof answer === "function" ? (answer as () => unknown)() : answer);
      } catch (err) {
        return Promise.reject(err);
      }
    },
  };
}

/** EIP-55 checksummed, so `authorizationFor` accepts it as the signer. */
const ACCOUNT = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const SIGNATURE = `0x${"a".repeat(130)}`;

describe("X402Panel: wallet + signing", () => {
  /**
   * The button no longer waits for a wallet to enable — see the note on `go` in
   * `X402Panel.tsx` — but a `ready` wallet changes what a click DOES: it signs first
   * and hands the adapter a payment, instead of calling `run` with none at all.
   */
  it("signs an authorization and attaches it before running, once a wallet is ready", async () => {
    vi.stubGlobal(
      "ethereum",
      fakeWallet({
        eth_accounts: [ACCOUNT],
        eth_chainId: BASE.idHex,
        eth_signTypedData_v4: SIGNATURE,
      }),
    );
    const value = stub();
    let sentPayment: string | undefined;
    const real = value.catalog;
    value.catalog = patch(real, {
      run: (toolId: string, input: Record<string, string>, payment?: string) => {
        sentPayment = payment;
        return real.run(toolId, input, payment);
      },
    });
    await mount(<X402Panel start="directory" />, value);
    await userEvent.selectOptions(amount("Tool"), "gas-tracker");
    await waitFor(() => expect(screen.getByText(ACCOUNT.toLowerCase())).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Run for 0.01 USDC" }));
    await waitFor(() => expect(sentPayment).toBeDefined());
    const decoded = JSON.parse(atob(sentPayment!)) as {
      payload: { authorization: { from: string }; signature: string };
    };
    expect(decoded.payload.authorization.from).toBe(ACCOUNT.toLowerCase());
    expect(decoded.payload.signature).toBe(SIGNATURE);
  });

  /** `wrongChain` gets a switch prompt, not a connect one — there is already an account. */
  it("offers to switch chains, not to connect, when the wallet is on the wrong one", async () => {
    let chainId = "0x1";
    vi.stubGlobal(
      "ethereum",
      fakeWallet({
        eth_accounts: [ACCOUNT],
        eth_chainId: () => chainId,
        wallet_switchEthereumChain: () => {
          chainId = BASE.idHex;
        },
      }),
    );
    await mount(<X402Panel start="directory" />);
    await userEvent.selectOptions(amount("Tool"), "gas-tracker");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Switch to Base" })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Switch to Base" }));
    await waitFor(() => expect(screen.getByText(ACCOUNT.toLowerCase())).toBeInTheDocument());
  });

  /** No account at all gets the generic connect prompt, and clicking it asks for one. */
  it("offers to connect when there is no account yet, and asks for one on click", async () => {
    let connected = false;
    const provider = fakeWallet({
      eth_accounts: () => (connected ? [ACCOUNT] : []),
      // Connect opens the wallet's account picker (EIP-2255), as MetaMask does
      wallet_requestPermissions: () => {
        connected = true;
        return [{ parentCapability: "eth_accounts" }];
      },
      eth_chainId: BASE.idHex,
    });
    vi.stubGlobal("ethereum", provider);
    await mount(<X402Panel start="directory" />);
    await userEvent.selectOptions(amount("Tool"), "gas-tracker");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    await waitFor(() => expect(screen.getByText(ACCOUNT.toLowerCase())).toBeInTheDocument());
  });

  /**
   * With no wallet ready at all, a click still runs — for the local stub that is a
   * documented no-op, not a refusal — rather than a click the panel silently eats.
   */
  it("still runs a paid tool with no wallet touched at all", async () => {
    await mount(<X402Panel start="directory" />);
    await userEvent.selectOptions(amount("Tool"), "gas-tracker");
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Run for 0.01 USDC" }));
    await waitFor(() =>
      expect(within(out("x402 output")).getByText(/Not paid:/)).toBeInTheDocument(),
    );
  });

  /**
   * Never trusts the event's own payload — see `watchWallet`'s header — so the doorbell
   * re-reads through `eth_accounts`/`eth_chainId` rather than acting on whatever
   * `accountsChanged` handed it. A provider that can subscribe (`on`/`removeListener`)
   * is what makes this doorbell fire at all; `fakeWallet` above has neither, which is
   * why every other test here only ever sees the state read on mount.
   */
  it("re-reads the wallet when the provider rings its doorbell, not from the event payload", async () => {
    let account = "" as string;
    const listeners: { event: string; handler: () => void }[] = [];
    const provider = {
      request: (args: { method: string }) => {
        if (args.method === "eth_accounts") return Promise.resolve(account ? [account] : []);
        if (args.method === "eth_chainId") return Promise.resolve(BASE.idHex);
        return Promise.reject(new Error(`test did not stub ${args.method}`));
      },
      on: (event: string, handler: () => void) => void listeners.push({ event, handler }),
      removeListener: (event: string, handler: () => void) => {
        const at = listeners.findIndex((l) => l.event === event && l.handler === handler);
        if (at >= 0) listeners.splice(at, 1);
      },
    };
    vi.stubGlobal("ethereum", provider);
    await mount(<X402Panel start="directory" />);
    await userEvent.selectOptions(amount("Tool"), "gas-tracker");
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument());
    account = ACCOUNT;
    await act(async () => {
      listeners.filter((l) => l.event === "accountsChanged").forEach((l) => l.handler());
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText(ACCOUNT.toLowerCase())).toBeInTheDocument());
  });

  /**
   * The window between `readWallet` reporting `ready` and the click can close on its
   * own — an extension disabled, a tab that lost `window.ethereum` — so `go` measures
   * again rather than trusting the state it already rendered.
   */
  it("refuses to sign with no wallet provider left to sign with, even though the state still says ready", async () => {
    vi.stubGlobal(
      "ethereum",
      fakeWallet({ eth_accounts: [ACCOUNT], eth_chainId: BASE.idHex }),
    );
    await mount(<X402Panel start="directory" />);
    await userEvent.selectOptions(amount("Tool"), "gas-tracker");
    await waitFor(() => expect(screen.getByText(ACCOUNT.toLowerCase())).toBeInTheDocument());
    vi.stubGlobal("ethereum", undefined);
    await userEvent.click(screen.getByRole("button", { name: "Run for 0.01 USDC" }));
    await waitFor(() =>
      expect(
        within(out("x402 output")).getByText("No wallet provider is available to sign with. Nothing was charged."),
      ).toBeInTheDocument(),
    );
  });
});

describe("HooksPanel", () => {
  const ZERO = `0x${"0".repeat(40)}`;
  const BEFORE_SWAP = `0x${"f".repeat(36)}0080`;

  /** No adapter, so no provider and no mount helper — the answer is in the address. */
  const paste = async (text: string) => {
    render(<HooksPanel />);
    await userEvent.type(screen.getByLabelText("Hook address"), text);
  };

  it("asks for an address before saying anything", () => {
    render(<HooksPanel />);
    expect(within(out("Hooks output")).getByText("// paste a hook address")).toBeInTheDocument();
  });

  it("says nothing was fetched, because nothing was", () => {
    render(<HooksPanel />);
    expect(screen.getByText(/Nothing is fetched and nothing is paid/)).toBeInTheDocument();
  });

  it("reports an address with no permissions as never called", async () => {
    await paste(ZERO);
    expect(
      within(out("Hooks output")).getByText(/carries no hook permissions/),
    ).toBeInTheDocument();
  });

  it("counts the granted permissions out of fourteen", async () => {
    await paste(BEFORE_SWAP);
    expect(within(out("Hooks output")).getByText(/call this hook at 1 of 14 points/)).toBeInTheDocument();
  });

  /**
   * All fourteen are listed whether granted or not. A list of only the granted
   * ones reads as a set of powers with nothing to weigh it against, and what a
   * hook cannot do is half of the answer.
   */
  it("lists every permission, not only the granted ones", async () => {
    await paste(BEFORE_SWAP);
    const rows = within(screen.getByLabelText("Hook permissions")).getAllByRole("listitem");
    expect(rows).toHaveLength(HOOK_PERMISSIONS.length);
    expect(rows.filter((r) => r.textContent?.startsWith("ON "))).toHaveLength(1);
  });

  it("marks the granted one on and the rest off", async () => {
    await paste(BEFORE_SWAP);
    const rows = within(screen.getByLabelText("Hook permissions")).getAllByRole("listitem");
    const on = rows.find((r) => r.textContent?.startsWith("ON "));
    expect(on).toHaveTextContent("beforeSwap");
    expect(on).toHaveTextContent("can change its price");
  });

  /**
   * The disclaimer is not decoration. Without it a short permission list reads as
   * a safety verdict, and these bits cannot support one.
   */
  it("says outright that the bits do not say what the code does", async () => {
    await paste(BEFORE_SWAP);
    expect(
      within(out("Hooks output")).getByText(/never what they do/),
    ).toBeInTheDocument();
  });

  it("refuses something that is not an address instead of reading it as safe", async () => {
    await paste("not-an-address");
    expect(within(out("Hooks output")).getByText(/not an address/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Hook permissions")).not.toBeInTheDocument();
  });

  /**
   * ⚠️ The two ways to fail need different sentences, and this is the test that keeps
   * them apart. A mistyped real address and a pasted word are both "not usable", but
   * telling the first user to "paste a 20-byte 0x… hook address" points them at the one
   * thing already correct — so they paste the same typo back and get the same answer.
   */
  it("distinguishes a mistyped address from a pasted word", async () => {
    await paste("0xA1b2C3d4e5F6a7B8C9d0e1f2a3b4C5d6E7f80080");
    const panel = within(out("Hooks output"));
    expect(panel.getByText(/EIP-55 checksum/)).toBeInTheDocument();
    expect(panel.queryByText(/Paste a 20-byte/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Hook permissions")).not.toBeInTheDocument();
  });

  /**
   * The checksum line sits with the caveats, not with the verdict. An `inert` reading of
   * an unchecked address is two separate uncertainties — which address, and what is in
   * it — and printing only the second would hide the weaker one.
   */
  it("says which address was read, alongside what was found in it", async () => {
    await paste(BEFORE_SWAP);
    const panel = within(out("Hooks output"));
    expect(panel.getByText(/call this hook at 1 of 14 points/)).toBeInTheDocument();
    expect(panel.getByText(/no EIP-55 checksum to verify/)).toBeInTheDocument();
  });

  it("confirms the checksum when the pasted address carries one", async () => {
    await paste("0xA1B2C3d4e5F6a7B8C9d0e1f2a3b4C5d6E7f80080");
    expect(within(out("Hooks output")).getByText(/EIP-55 checksum matches/)).toBeInTheDocument();
  });

  it("goes back to asking when the field is cleared", async () => {
    render(<HooksPanel />);
    const field = screen.getByLabelText("Hook address");
    await userEvent.type(field, ZERO);
    await userEvent.clear(field);
    expect(within(out("Hooks output")).getByText("// paste a hook address")).toBeInTheDocument();
  });
});

/**
 * The agent surface. No adapter and nothing fetched: the panel renders the same
 * `tools.json` the stdio server serves from, which is the entire point — see
 * `lib/manifest.ts`. The server side is covered by `tests/mcp.test.ts`.
 */
describe("McpPanel", () => {
  it("lists every skill as a tool, with what each takes and which arguments are optional", () => {
    render(<McpPanel />);
    const list = within(screen.getByLabelText("Skill tools"));
    expect(list.getByText("quadra_verdict").closest("li")).toHaveTextContent(/Takes: token_address\.$/);
    expect(list.getByText("quadra_radar").closest("li")).toHaveTextContent(/Takes: minutes \(optional\)\.$/);
  });

  it("lists every tool the server actually advertises", () => {
    render(<McpPanel />);
    const list = within(screen.getByLabelText("MCP tools"));
    for (const tool of MCP_TOOLS) {
      expect(list.getByText(tool.name), tool.name).toBeInTheDocument();
    }
    expect(list.getAllByRole("listitem")).toHaveLength(MCP_TOOLS.length);
  });

  it("says of each tool whether it touches the network", () => {
    render(<McpPanel />);
    const list = within(screen.getByLabelText("MCP tools"));
    expect(list.getAllByText("no network").length).toBeGreaterThan(0);
    expect(list.getAllByText("public read").length).toBeGreaterThan(0);
  });

  /**
   * The claim a user is most likely to act on. It is only worth printing because
   * `tests/mcp.test.ts` reads the server's source and checks it, so the sentence
   * has to point at that rather than just assert itself.
   */
  it("says it holds no key, and that the claim is checked", () => {
    render(<McpPanel />);
    expect(screen.getByText(/checked by a test/)).toHaveTextContent(/holds no key/);
  });

  it("shows a config a client can paste, matching the manifest", () => {
    render(<McpPanel />);
    const shown = within(out("MCP server config")).getByText(/mcpServers/).textContent ?? "";
    expect(JSON.parse(shown)).toEqual(JSON.parse(mcpConfigSnippet()));
  });

  it("does not offer to install something that is not published", () => {
    render(<McpPanel />);
    expect(screen.getByText(/Not published yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Installed as/)).not.toBeInTheDocument();
  });

  /**
   * The wording for the day it publishes, checked before that day. `installLine`
   * takes `published` for exactly this reason.
   */
  it("has the installed wording ready, and it names the server", () => {
    expect(installLine(true, "quadra")).toContain("Installed as quadra");
    expect(installLine(true, "quadra")).not.toContain("Not published");
  });

  it("lists what it cannot do, in the manifest's own words", () => {
    render(<McpPanel />);
    const limits = within(screen.getByLabelText("Limits"));
    for (const limit of MCP_BUILD.limits) {
      expect(limits.getByText(limit), limit).toBeInTheDocument();
    }
  });

  it("copies its config to the clipboard and says so for a moment; without a clipboard it does nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const writeText = vi.fn(async () => {});
      vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
      const a = render(<McpPanel />);
      fireEvent.click(screen.getByRole("button", { name: "Copy config JSON" }));
      await act(async () => {});
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("mcpServers"));
      expect(screen.getByRole("button", { name: "Copied config" })).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1800));
      expect(screen.getByRole("button", { name: "Copy config JSON" })).toBeInTheDocument();
      a.unmount();
      vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
      render(<McpPanel />);
      fireEvent.click(screen.getByRole("button", { name: "Copy config JSON" }));
      await act(async () => {});
      expect(screen.getByRole("button", { name: "Copy config JSON" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the one chain it targets", () => {
    render(<McpPanel />);
    expect(within(out("What it cannot do")).getByText(/Base 8453/)).toBeInTheDocument();
  });
});

describe("the whole app, through a window", () => {
  it("still says a switched-off feature is off, not unbuilt", () => {
    renderAt("/?do=inference");
    expect(screen.getByText(/Inference is not switched on/)).toBeInTheDocument();
  });
});

/**
 * An amber box used to say the same eleven words for every unbuilt window. That
 * was accurate and not actionable: each is waiting on a different thing, and a
 * reader cannot tell "nobody has built this" from "this needs a contract that
 * does not exist" without being told which.
 *
 * The assertions below are therefore about the property — every window that renders
 * the notice names its blocker — rather than about the wording, for the same reason
 * the API page's tests are about `live` and not about its lede.
 */
describe("why an unbuilt window is unbuilt", () => {
  /**
   * Since 2026-09-30 every switched-on window is built: send, swap, bridge and launch landed
   * in the same session. The notice machinery stays — the next feature switched on before it
   * is built gets it — and these pin that the list of excuses is empty rather than stale.
   */
  it("has no switched-on window with nothing behind it, and so no excuses", () => {
    expect(UNBUILT.map((f) => f.id)).toEqual([]);
    expect(WAITING_ON).toEqual({});
  });

  it("appends the reason to the notice, and stands alone without one", () => {
    expect(notBuiltNotice("Swap", "a live price.")).toBe(
      "Swap is switched on but not built yet. There is nothing here to click, and nothing here will move money. It is waiting on a live price.",
    );
    expect(notBuiltNotice("Swap", undefined)).toBe(
      "Swap is switched on but not built yet. There is nothing here to click, and nothing here will move money.",
    );
  });

  /** Switched off is its own state, and says so — not "not built", which would be an excuse. */
  it("renders a switched-off window as off, with no reason attached", () => {
    renderAt("/?do=audit");
    expect(screen.getByLabelText("Audit is off")).toHaveTextContent(/not switched on/);
    expect(screen.queryByLabelText("Audit is not built yet")).not.toBeInTheDocument();
  });
});
