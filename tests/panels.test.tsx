import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdaptersProvider, useAdapters } from "@/adapters/AdaptersProvider";
import { LocalShieldedPool } from "@/adapters/local/pool";
import { LocalEnclave } from "@/adapters/local/enclave";
import { LOCAL_TOOLS, LocalCatalog } from "@/adapters/local/catalog";
import { NO_WALLET } from "@/adapters/http/catalog";
import { BLUEAGENT } from "@/config/upstream";
import type { Adapters, Model, Quote, Tool } from "@/adapters/types";
import { Anchor, Attested, Settled } from "@/features/panels/Anchor";
import { SendPanel } from "@/features/panels/SendPanel";
import { InferencePanel } from "@/features/panels/InferencePanel";
import { X402Panel } from "@/features/panels/X402Panel";
import { HooksPanel } from "@/features/panels/HooksPanel";
import { installLine, McpPanel } from "@/features/panels/McpPanel";
import { HOOK_PERMISSIONS } from "@/lib/hooks";
import { MCP_BUILD, MCP_TOOLS, mcpConfigSnippet } from "@/lib/manifest";
import { USDC } from "@/config/chain";
import { renderAt, settle } from "./helpers";

const PAYEE = "0x1111111111111111111111111111111111111111";

function stub(): Adapters {
  return {
    pool: new LocalShieldedPool(),
    enclave: new LocalEnclave(),
    catalog: new LocalCatalog(),
  };
}

/**
 * Mount one panel against a fresh pool, the way a window does.
 *
 * Awaits a flush inside `act` because both panels load from their adapter in an
 * effect: without it the resolution lands outside act, React warns, and every
 * assertion races the first paint. Returning a promise makes that unavoidable at
 * the call site rather than something each test must remember.
 */
async function mount(node: React.ReactNode, value: Adapters = stub()) {
  const rendered = render(<AdaptersProvider value={value}>{node}</AdaptersProvider>);
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
  it("refuses to hand out a private pool to a component outside it", () => {
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
      const { pool, enclave } = useAdapters();
      return <span>{`${pool.isLive} ${enclave.isLive}`}</span>;
    }
    render(
      <AdaptersProvider>
        <Show />
      </AdaptersProvider>,
    );
    expect(screen.getByText("false false")).toBeInTheDocument();
  });

  it("keeps one pool across re-renders, so notes are not lost", async () => {
    const value = stub();
    const { rerender } = await mount(<SendPanel />, value);
    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    await waitFor(() => expect(screen.getByLabelText(/^Note 0x/)).toBeInTheDocument());

    rerender(
      <AdaptersProvider value={value}>
        <SendPanel />
      </AdaptersProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText(/^Note 0x/)).toBeInTheDocument());
  });
});

describe("SendPanel: putting money in", () => {
  it("starts with no notes and says so", async () => {
    await mount(<SendPanel />);
    expect(screen.getByText("No notes yet. Put something in above.")).toBeInTheDocument();
    expect(within(out("Send output")).getByText("// nothing run yet")).toBeInTheDocument();
  });

  it("disables both spend buttons while there is nothing to spend", async () => {
    await mount(<SendPanel />);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Withdraw all of it" })).toBeDisabled();
  });

  it("deposits the typed amount and lists it as a note", async () => {
    await mount(<SendPanel />);
    await userEvent.clear(amount("Amount to deposit"));
    await userEvent.type(amount("Amount to deposit"), "12.5");
    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));

    await waitFor(() => expect(screen.getByText("12.5 USDC")).toBeInTheDocument());
    expect(within(out("Send output")).getByText(/You put 12.5 USDC in/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("says the note is the money, because losing it loses the funds", async () => {
    await mount(<SendPanel />);
    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    await waitFor(() =>
      expect(within(out("Send output")).getByText(/it is the money/)).toBeInTheDocument(),
    );
  });

  it("totals the notes in the legend", async () => {
    await mount(<SendPanel />);
    const field = amount("Amount to deposit");
    for (const value of ["4", "6.25"]) {
      await userEvent.clear(field);
      await userEvent.type(field, value);
      await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    }
    await waitFor(() => expect(screen.getByText(/10.25 USDC in 2/)).toBeInTheDocument());
  });

  it("selects the note it just created, so Send works without a second click", async () => {
    await mount(<SendPanel />);
    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    await waitFor(() => expect(screen.getByRole("radio")).toBeChecked());
  });

  it("refuses an over-precise amount and says nothing was rounded", async () => {
    await mount(<SendPanel />);
    await userEvent.clear(amount("Amount to deposit"));
    await userEvent.type(amount("Amount to deposit"), "1.0000001");
    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));

    await waitFor(() =>
      expect(within(out("Send output")).getByText(/Nothing was rounded/)).toBeInTheDocument(),
    );
    expect(screen.getByText("No notes yet. Put something in above.")).toBeInTheDocument();
  });

  it("refuses a non-numeric amount", async () => {
    await mount(<SendPanel />);
    await userEvent.clear(amount("Amount to deposit"));
    await userEvent.type(amount("Amount to deposit"), "ten");
    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    await waitFor(() =>
      expect(within(out("Send output")).getByText(/not a plain decimal number/)).toBeInTheDocument(),
    );
  });

  it("refuses an empty amount", async () => {
    await mount(<SendPanel />);
    await userEvent.clear(amount("Amount to deposit"));
    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    await waitFor(() =>
      expect(within(out("Send output")).getByText("Enter an amount.")).toBeInTheDocument(),
    );
  });
});

describe("SendPanel: paying out", () => {
  async function withNote(value = "10") {
    const mounted = await mount(<SendPanel />);
    await userEvent.clear(amount("Amount to deposit"));
    await userEvent.type(amount("Amount to deposit"), value);
    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    await waitFor(() => expect(screen.getByRole("radio")).toBeChecked());
    return mounted;
  }

  it("pays an address and returns the change as a new note", async () => {
    await withNote("10");
    await userEvent.type(amount("Address to pay"), PAYEE);
    await userEvent.type(amount("Amount to send"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(within(out("Send output")).getByText(/You paid 3 USDC/)).toBeInTheDocument(),
    );
    expect(screen.getByText("7 USDC")).toBeInTheDocument();
    expect(screen.getByText(/7 USDC in 1/)).toBeInTheDocument();
  });

  it("says the pool paid, so the payee cannot see which note it came from", async () => {
    await withNote();
    await userEvent.type(amount("Address to pay"), PAYEE);
    await userEvent.type(amount("Amount to send"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(within(out("Send output")).getByText(/The pool paid it/)).toBeInTheDocument(),
    );
  });

  it("rejects something that is not an address before touching the note", async () => {
    await withNote();
    await userEvent.type(amount("Address to pay"), "vitalik.eth");
    await userEvent.type(amount("Amount to send"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(within(out("Send output")).getByText(/not an address/)).toBeInTheDocument(),
    );
    expect(screen.getByText("10 USDC")).toBeInTheDocument();
  });

  it("refuses to overspend a note, naming both amounts", async () => {
    await withNote("2");
    await userEvent.type(amount("Address to pay"), PAYEE);
    await userEvent.type(amount("Amount to send"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(
        within(out("Send output")).getByText("That note holds 2 USDC, which is less than 5."),
      ).toBeInTheDocument(),
    );
  });

  it("withdraws the whole note and says the amount is now public", async () => {
    await withNote("5");
    await userEvent.type(amount("Address to pay"), PAYEE);
    await userEvent.click(screen.getByRole("button", { name: "Withdraw all of it" }));

    await waitFor(() =>
      expect(
        within(out("Send output")).getByText(/the amount is now public/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("No notes yet. Put something in above.")).toBeInTheDocument();
  });

  it("will not withdraw to a non-address", async () => {
    await withNote();
    await userEvent.type(amount("Address to pay"), "0x123");
    await userEvent.click(screen.getByRole("button", { name: "Withdraw all of it" }));
    await waitFor(() =>
      expect(within(out("Send output")).getByText(/not an address/)).toBeInTheDocument(),
    );
  });

  it("asks for a note when a second one exists and none is chosen", async () => {
    const { adapters } = await mount(<SendPanel />);
    // Two notes deposited behind the UI's back: neither is selected.
    await adapters.pool.deposit(
      { address: "0x0", symbol: "USDC", decimals: 6 },
      1_000_000n,
    );
    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    await waitFor(() => expect(screen.getAllByRole("radio")).toHaveLength(2));

    await userEvent.click(screen.getAllByRole("radio")[1] as HTMLElement);
    await userEvent.type(amount("Address to pay"), PAYEE);
    await userEvent.type(amount("Amount to send"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(within(out("Send output")).getByText(/You paid 1 USDC/)).toBeInTheDocument(),
    );
  });

  /**
   * Reachable by closing the window and opening it again: the pool is shared, so
   * the notes come back but the panel's own selection does not.
   */
  it("asks you to pick a note when one exists but none is chosen", async () => {
    const value = stub();
    await value.pool.deposit({ address: USDC.address, symbol: "USDC", decimals: 6 }, 5_000_000n);
    await mount(<SendPanel />, value);
    await waitFor(() => expect(screen.getByRole("radio")).not.toBeChecked());

    await userEvent.type(amount("Address to pay"), PAYEE);
    await userEvent.type(amount("Amount to send"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(within(out("Send output")).getByText("Pick a note to spend.")).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole("button", { name: "Withdraw all of it" }));
    await waitFor(() =>
      expect(within(out("Send output")).getByText("Pick a note to withdraw.")).toBeInTheDocument(),
    );
  });

  it("reports a non-Error rejection from the pool rather than swallowing it", async () => {
    const value = stub();
    value.pool = patch(value.pool, {
      isLive: false,
      notes: async () => [],
      deposit: () => Promise.reject("the pool rejected with a string"),
    });
    await mount(<SendPanel />, value);
    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    await waitFor(() =>
      expect(
        within(out("Send output")).getByText("the pool rejected with a string"),
      ).toBeInTheDocument(),
    );
  });

  it("clears a previous error when the next action succeeds", async () => {
    await withNote();
    await userEvent.type(amount("Address to pay"), "nope");
    await userEvent.type(amount("Amount to send"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(within(out("Send output")).getByText(/not an address/)).toBeInTheDocument(),
    );

    await userEvent.clear(amount("Address to pay"));
    await userEvent.type(amount("Address to pay"), PAYEE);
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(within(out("Send output")).getByText(/You paid 1 USDC/)).toBeInTheDocument(),
    );
    expect(within(out("Send output")).queryByText(/not an address/)).not.toBeInTheDocument();
  });

  it("never shows an on-chain claim while the pool is local", async () => {
    await withNote();
    await userEvent.type(amount("Address to pay"), PAYEE);
    await userEvent.type(amount("Amount to send"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    const panel = out("Send output");
    await waitFor(() => expect(within(panel).getByText(/Not on chain/)).toBeInTheDocument());
    expect(panel.textContent).not.toMatch(/basescan/i);
    expect(within(panel).queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("Anchor", () => {
  it("links a real transaction to Basescan", () => {
    render(<Anchor anchoring={{ kind: "onchain", txHash: `0x${"a".repeat(64)}`, block: 33 }} />);
    expect(screen.getByText(/block/)).toHaveTextContent("On chain in block 33.");
    const link = screen.getByRole("link", { name: "See it on Basescan" });
    expect(link).toHaveAttribute("href", `https://basescan.org/tx/0x${"a".repeat(64)}`);
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("says why, when there is nothing on chain", () => {
    render(<Anchor anchoring={{ kind: "local", why: "the pool is not deployed" }} />);
    expect(screen.getByText("Not on chain: the pool is not deployed.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
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
    rerender(
      <AdaptersProvider value={{ ...value, enclave: new LocalEnclave() }}>
        <InferencePanel />
      </AdaptersProvider>,
    );
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
    await mount(<X402Panel />);
    expect(amount("Tool")).toHaveValue("hood-live");
  });

  it("offers every tool with its own one-line summary", async () => {
    await mount(<X402Panel />);
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
    await mount(<X402Panel />);
    expect(screen.getByRole("button", { name: "Run — free" })).toBeInTheDocument();
    await userEvent.selectOptions(amount("Tool"), "liquidity-depth");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Run for 0.03 USDC" })).toBeInTheDocument(),
    );
  });

  it("names the payee and the network before anything is signed", async () => {
    await mount(<X402Panel />);
    await userEvent.selectOptions(amount("Tool"), "token-price");
    await waitFor(() => expect(screen.getByText(/0\.01 USDC on eip155:8453/)).toBeInTheDocument());
    expect(screen.getByText(BLUEAGENT.knownPayTo)).toBeInTheDocument();
  });

  it("says a free tool touches no wallet at all", async () => {
    await mount(<X402Panel />);
    expect(screen.getByText(/Free\. No payment is sent/)).toBeInTheDocument();
    expect(screen.queryByText(BLUEAGENT.knownPayTo)).not.toBeInTheDocument();
  });

  it("shows a field for each input the tool declares, and none otherwise", async () => {
    await mount(<X402Panel />);
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
    await mount(<X402Panel />);
    await userEvent.selectOptions(amount("Tool"), "token-price");
    await waitFor(() => expect(amount("token")).toBeInTheDocument());
    await userEvent.type(amount("token"), "0xdead");
    expect(amount("token")).toHaveValue("0xdead");
    await userEvent.selectOptions(amount("Tool"), "liquidity-depth");
    await waitFor(() => expect(amount("token")).toHaveValue(""));
  });

  it("runs a free tool and says no charge was made", async () => {
    await mount(<X402Panel />);
    await userEvent.click(screen.getByRole("button", { name: "Run — free" }));
    await waitFor(() =>
      expect(within(out("x402 output")).getByText(/No charge:/)).toBeInTheDocument(),
    );
  });

  it("runs a paid tool and says outright that nothing was paid", async () => {
    await mount(<X402Panel />);
    await userEvent.selectOptions(amount("Tool"), "token-price");
    await waitFor(() => expect(amount("token")).toBeInTheDocument());
    await userEvent.type(amount("token"), "0xabc");
    await userEvent.click(screen.getByRole("button", { name: "Run for 0.01 USDC" }));
    await waitFor(() =>
      expect(within(out("x402 output")).getByText(/Not paid:/)).toBeInTheDocument(),
    );
  });

  it("never shows a payment link while the catalog is local", async () => {
    await mount(<X402Panel />);
    await userEvent.click(screen.getByRole("button", { name: "Run — free" }));
    await waitFor(() =>
      expect(within(out("x402 output")).getByText(/nothing ran/)).toBeInTheDocument(),
    );
    expect(within(out("x402 output")).queryByRole("link")).not.toBeInTheDocument();
  });

  it("surfaces a missing input instead of running anyway", async () => {
    await mount(<X402Panel />);
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
    await mount(<X402Panel />);
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
    await mount(<X402Panel />, value);
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
    await mount(<X402Panel />, value);
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
    await mount(<X402Panel />, value);
    await waitFor(() =>
      expect(within(out("x402 output")).getByText("no quote")).toBeInTheDocument(),
    );
  });

  it("shows nothing to run when the catalog is empty", async () => {
    const value = stub();
    value.catalog = patch(value.catalog, { tools: async () => [] });
    await mount(<X402Panel />, value);
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.queryByText("What it needs")).not.toBeInTheDocument();
  });

  it("keeps the tool you chose when the list reloads", async () => {
    const value = stub();
    const { rerender } = await mount(<X402Panel />, value);
    await userEvent.selectOptions(amount("Tool"), "competitor-scan");
    rerender(
      <AdaptersProvider value={value}>
        <X402Panel />
      </AdaptersProvider>,
    );
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
    const { unmount } = await mount(<X402Panel />, value);
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
    await mount(<X402Panel />, value);
    await userEvent.selectOptions(amount("Tool"), "competitor-scan");
    await userEvent.selectOptions(amount("Tool"), "token-price");
    await waitFor(() => expect(screen.getByText(/0\.01 USDC on eip155:8453/)).toBeInTheDocument());
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await act(async () =>
        release([
          {
            toolId: "competitor-scan",
            price: {
              kind: "paid",
              payTo: PAYEE,
              amountBaseUnits: 999_000n,
              asset: USDC,
              network: "eip155:8453",
            },
          },
        ]),
      );
      expect(screen.queryByText(/0\.999 USDC/)).not.toBeInTheDocument();
      expect(screen.getByText(/0\.01 USDC on eip155:8453/)).toBeInTheDocument();
      expect(quiet).not.toHaveBeenCalled();
    } finally {
      quiet.mockRestore();
    }
  });

  /** 66 of the 115 tools upstream declare one. A form that demands them strands those tools. */
  it("marks an optional field as optional", async () => {
    await mount(<X402Panel />);
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
    await mount(<X402Panel />, value);
    expect(within(out("x402 output")).getByText("The catalog answered 503.")).toBeInTheDocument();
    expect(within(amount("Tool")).queryAllByRole("option")).toHaveLength(0);
  });

  it("reports a non-Error rejection from the catalog load too", async () => {
    const value = stub();
    value.catalog = patch(value.catalog, { tools: () => Promise.reject("upstream hung up") });
    await mount(<X402Panel />, value);
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
    await mount(<X402Panel />, value);
    expect(screen.getByRole("button", { name: "Run — free" })).toBeDisabled();
    expect(screen.getByText(NO_WALLET)).toBeInTheDocument();
  });

  it("offers the button when the adapter says a run can be attempted", async () => {
    await mount(<X402Panel />);
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
    await mount(<X402Panel />, value);
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
    await mount(<X402Panel />, value);
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.getByText("Reading the price…")).toBeInTheDocument();
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

  it("names the one chain it targets", () => {
    render(<McpPanel />);
    expect(within(out("What it cannot do")).getByText(/Base 8453/)).toBeInTheDocument();
  });
});

describe("the whole app, through a window", () => {
  it("opens Send from the desktop and can put money in", async () => {
    renderAt("/?do=send");
    await settle();
    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    await waitFor(() =>
      expect(within(out("Send output")).getByText(/You put 10 USDC in/)).toBeInTheDocument(),
    );
  });

  it("opens Inference from the desktop", async () => {
    renderAt("/?do=inference");
    await settle();
    await waitFor(() => expect(amount("Model")).toHaveValue("quadra-small"));
  });

  it("says outright when a switched-on feature is not built yet", () => {
    renderAt("/?do=swap");
    expect(
      screen.getByText(/Swap is switched on but not built yet/),
    ).toBeInTheDocument();
  });

  it("still says a switched-off feature is off, not unbuilt", () => {
    renderAt("/?do=bridge");
    expect(screen.getByText(/Bridge is not switched on/)).toBeInTheDocument();
  });
});
