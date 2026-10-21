import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { row, type Report } from "@/skills/types";
import { USDC } from "@/config/chain";
import { SwapPanel } from "@/features/panels/SwapPanel";
import { TerminalPanel } from "@/features/panels/TerminalPanel";
import { WalletProvider } from "@/ui/WalletProvider";
import { renderAt, settle } from "./helpers";
import { DOWN, net, useNet } from "./net";

useNet();

/**
 * Everything linked together (2026-10-02, the owner): the Terminal opens windows, a report's next
 * steps open the window they name or run a skill in its own window, and a window opened with an
 * address shows it. The whole app runs here; the radar is stood in for, so its report — with next
 * steps of every kind — is known.
 */

const WHO = "0xD5C1dFc036F9911348EA8065F73c8123f4013FAB";
const TOKEN = "0x2222222222222222222222222222222222222222";
const REPORT: Report = {
  title: "Stand-in radar",
  rows: [row("A launch", "busy", { next: `profile ${WHO}` }), row("Quiet", "nothing next")],
  notes: [],
  sources: ["a test"],
  next: [
    { label: "Every coin", command: "coins" },
    { label: "Nonsense", command: "frobnicate" },
    { label: "Help", command: "help" },
    { label: "Gate it", command: `gate ${TOKEN}` },
    { label: "Audit", command: "open audit" },
  ],
};
vi.mock("@/skills/radar", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/skills/radar")>();
  return { ...real, radarSkill: { ...real.radarSkill, run: () => Promise.resolve(REPORT) } };
});
vi.mock("@/lib/connectors", () => ({ walletConnectProvider: vi.fn(), coinbaseProvider: vi.fn() }));

/** Every read the windows make is down — what is tested here is where things go, not what they read. */
const offline = () => net({ get: () => DOWN, rpc: () => DOWN, post: () => DOWN });
const win = (title: string) => screen.queryByLabelText(title, { selector: ".win" });
async function type(line: string) {
  await userEvent.type(screen.getByLabelText("Command"), `${line}{Enter}`);
  await settle();
}

describe("the Terminal reaches every window", () => {
  it("lists the windows, opens one by name or shortcut, and says when one is off", async () => {
    offline();
    renderAt("/?do=terminal");
    await settle();
    await type("windows");
    expect(screen.getByLabelText("Terminal output")).toHaveTextContent("coin [0x…]");
    await type("profile");
    expect(win("Profile")).not.toBeNull();
    expect(screen.getByLabelText("Terminal output")).toHaveTextContent("Opened Profile.");
    await type("open audit");
    expect(screen.getByLabelText("Terminal output")).toHaveTextContent("Audit is not switched on.");
    await type("help");
    expect(screen.getByLabelText("Terminal output")).toHaveTextContent("Windows — open one from here:");
  });

  it("answers the words people type into any terminal, in the machine's own voice", async () => {
    offline();
    renderAt("/?do=terminal");
    await settle();
    await type("sudo");
    expect(screen.getByLabelText("Terminal output")).toHaveTextContent("There is no root here");
  });

  it("opens Send with the recipient filled in, and Swap with the token to get", async () => {
    offline();
    renderAt("/?do=terminal");
    await settle();
    await type(`send ${WHO}`);
    expect(within(win("Send")!).getByLabelText("Recipient")).toHaveValue(WHO);
    await userEvent.click(within(screen.getByLabelText("Taskbar")).getByRole("button", { name: "Terminal" }));
    await type(`swap ${TOKEN}`);
    expect(within(win("Swap")!).getByDisplayValue(TOKEN)).toBeInTheDocument();
    // a token the picker knows by name is picked by name
    await userEvent.click(within(screen.getByLabelText("Taskbar")).getByRole("button", { name: "Terminal" }));
    await type(`swap ${USDC.address}`);
    expect(within(win("Swap")!).queryByDisplayValue(TOKEN)).not.toBeInTheDocument();
  });

  it("puts a report's next steps under it, and runs one when clicked", async () => {
    offline();
    renderAt("/?do=terminal");
    await settle();
    await type("radar");
    const steps = screen.getByRole("group", { name: "Next after radar" });
    expect(within(steps).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "↳ Every coin",
      "↳ Nonsense",
      "↳ Help",
      "↳ Gate it",
      "↳ Audit",
      `↳ profile ${WHO}`,
    ]);
    await userEvent.click(within(steps).getByRole("button", { name: `↳ profile ${WHO}` }));
    await settle();
    expect(win("Profile")).not.toBeNull();
  });
});

describe("a report's next steps in a window", () => {
  it("runs the command it was opened with, then follows each kind of next step", async () => {
    offline();
    renderAt("/?do=research&run-research=radar%205");
    await settle();
    const research = win("Research")!;
    // the instruction chose the tab and ran it
    expect(within(research).getByRole("button", { name: "Launch Radar" })).toHaveAttribute("aria-pressed", "true");
    expect(within(research).getByLabelText("Stand-in radar")).toBeInTheDocument();
    const next = within(research).getByRole("group", { name: "Next" });

    await userEvent.click(within(next).getByRole("button", { name: "Nonsense" }));
    expect(within(research).getByText('No command "frobnicate".')).toBeInTheDocument();
    await userEvent.click(within(next).getByRole("button", { name: "Audit" }));
    expect(within(research).getByText("Audit is not switched on.")).toBeInTheDocument();

    await userEvent.click(within(next).getByRole("button", { name: "Every coin" }));
    await settle();
    expect(win("Coins")).not.toBeNull();
    // a row's own next step: the small button beside it
    await userEvent.click(within(research).getByRole("button", { name: `profile ${WHO}` }));
    await settle();
    expect(win("Profile")).not.toBeNull();
    // a skill in another window: Safety opens on Token Gate and runs it
    await userEvent.click(within(next).getByRole("button", { name: "Gate it" }));
    await settle();
    await waitFor(() => expect(within(win("Safety")!).getByRole("button", { name: "Token Gate" })).toHaveAttribute("aria-pressed", "true"));
    // asked again while it is open: run again, afresh
    await userEvent.click(within(next).getByRole("button", { name: "Gate it" }));
    await settle();
    expect(within(win("Safety")!).getByLabelText("token address")).toHaveValue(TOKEN);
    // a Terminal-only command opens the Terminal, which runs it
    await userEvent.click(within(next).getByRole("button", { name: "Help" }));
    await settle();
    expect(within(win("Terminal")!).getByLabelText("Terminal output")).toHaveTextContent("Windows — open one from here:");
  });

  it("ignores an instruction meant for a skill that is not in this window, or no skill at all", async () => {
    offline();
    const first = renderAt(`/?do=research&run-research=gate%20${TOKEN}`);
    await settle();
    expect(within(win("Research")!).queryByLabelText("Stand-in radar")).not.toBeInTheDocument();
    first.unmount();
    offline();
    renderAt("/?do=research&run-research=frobnicate");
    await settle();
    expect(screen.getAllByRole("button", { name: "Launch Radar" }).at(-1)).toHaveAttribute("aria-pressed", "true");
  });
});

function Where() {
  return <output aria-label="url">{useLocation().search}</output>;
}

describe("outside the desktop", () => {
  it("a Terminal on its own says windows open from the desktop", async () => {
    offline();
    render(
      <MemoryRouter>
        <TerminalPanel />
      </MemoryRouter>,
    );
    await type("coins");
    expect(screen.getByLabelText("Terminal output")).toHaveTextContent("Windows open from the desktop; this Terminal is on its own here.");
  });

  it("a Swap embedded in another window leaves an instruction for the Swap window alone", async () => {
    offline();
    render(
      <MemoryRouter initialEntries={[`/?buy=${TOKEN}`]}>
        <WalletProvider>
          <SwapPanel fixed={{ sell: { choice: "ETH", address: "", symbol: "ETH" }, buy: { choice: "USDC", address: "", symbol: "USDC" } }} />
        </WalletProvider>
        <Where />
      </MemoryRouter>,
    );
    await settle();
    expect(screen.getByLabelText("url")).toHaveTextContent(`buy=${TOKEN}`);
    expect(screen.getByText("ETH → USDC on Base")).toBeInTheDocument();
  });
});
