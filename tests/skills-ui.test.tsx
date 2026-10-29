import { describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ALIASES, findSkill, helpText, parseLine, reportText, SKILLS } from "@/skills";
import type { Report, Skill } from "@/skills/types";
import { ReportView } from "@/features/panels/ReportView";
import { SkillForm, SkillWindow } from "@/features/panels/SkillWindow";
import { TerminalPanel } from "@/features/panels/TerminalPanel";
import { quietRadar } from "./fixtures/radar";
import { verdictSkill } from "@/skills/verdict";
import { radarSkill } from "@/skills/radar";
import { net, useNet } from "./net";
import { renderAt, settle } from "./helpers";

useNet();

const REPORT: Report = {
  title: "Sample",
  rows: [
    { label: "Verdict", value: "High risk", tone: "bad" },
    { label: "Caution", value: "maybe", tone: "warn" },
    { label: "Fine", value: "yes", tone: "ok" },
    { label: "Plain", value: "fact", href: "https://basescan.org/address/0xa" },
  ],
  notes: ["A caveat.", "Another."],
  sources: ["Base RPC", "Blockscout"],
};

/** A skill whose answer the test controls — resolve or reject it when the test says. */
function controlled(args: Skill["args"] = [{ name: "address", hint: "0x…" }], id = "probe") {
  const seen: (readonly string[])[] = [];
  let settle: { resolve: (r: Report) => void; reject: (e: unknown) => void } | null = null;
  const skill: Skill = {
    id,
    title: `Probe ${id}`,
    summary: `What ${id} answers.`,
    args,
    run: (a) => {
      seen.push(a);
      return new Promise<Report>((resolve, reject) => (settle = { resolve, reject }));
    },
  };
  return {
    skill,
    seen,
    resolve: (r: Report = REPORT) => act(async () => settle!.resolve(r)),
    reject: (e: unknown) => act(async () => settle!.reject(e)),
  };
}

describe("the command line", () => {
  it("finds a skill by id or by any of its aliases", () => {
    expect(findSkill("verdict")?.id).toBe("verdict");
    for (const [alias, id] of Object.entries(ALIASES)) expect(findSkill(alias)?.id, alias).toBe(id);
    expect(findSkill("teleport")).toBeNull();
  });

  it("gives every alias a skill that exists", () => {
    const ids = new Set(SKILLS.map((s) => s.id));
    for (const id of Object.values(ALIASES)) expect(ids.has(id), id).toBe(true);
  });

  it("parses a line into a command and its arguments, case-insensitively", () => {
    const parsed = parseLine("  SCAN   0xabc  ");
    expect(parsed.kind).toBe("run");
    if (parsed.kind !== "run") return;
    expect(parsed.skill.id).toBe("verdict");
    expect(parsed.args).toEqual(["0xabc"]);
  });

  it("knows empty, help, clear and an unknown word", () => {
    expect(parseLine("   ")).toEqual({ kind: "empty" });
    expect(parseLine("help")).toEqual({ kind: "help" });
    expect(parseLine("?")).toEqual({ kind: "help" });
    expect(parseLine("clear")).toEqual({ kind: "clear" });
    expect(parseLine("CLS")).toEqual({ kind: "clear" });
    expect(parseLine("Teleport now")).toEqual({ kind: "unknown", word: "Teleport" });
  });

  it("lists every skill in help, with required and optional arguments marked", () => {
    const help = helpText();
    for (const s of SKILLS) expect(help).toContain(s.summary);
    expect(help).toContain("verdict <token address>");
    expect(help).toMatch(/^radar \[minutes\]\s+What launched on Base in the last hour/m);
    expect(help).toMatch(/clear\s+empty the screen$/);
  });

  it("writes a report as text: marks, aligned labels, notes and sources", () => {
    expect(reportText(REPORT).split("\n")).toEqual([
      "== Sample ==",
      "✗ Verdict    High risk",
      "! Caution    maybe",
      "✓ Fine       yes",
      "  Plain      fact",
      "",
      "  A caveat.",
      "  Another.",
      "  sources: Base RPC, Blockscout",
    ]);
  });

  /** A label longer than the column still gets a space before its value. */
  it("caps the label column and never runs a label into its value", () => {
    const long = { ...REPORT, rows: [{ label: "L".repeat(40), value: "v" }], notes: [] };
    expect(reportText(long).split("\n")).toEqual(["== Sample ==", `  ${"L".repeat(40)} v`, "  sources: Base RPC, Blockscout"]);
  });
});

describe("ReportView", () => {
  it("renders every row, with the verdict colour and the link on the value", () => {
    render(<ReportView report={REPORT} />);
    const section = screen.getByRole("region", { name: "Sample" });
    expect(within(section).getByRole("heading", { name: "Sample" })).toBeInTheDocument();
    expect(within(section).getByText("High risk").closest(".report__row")).toHaveClass("report__row--bad");
    expect(within(section).getByText("Plain").closest(".report__row")).toHaveClass("report__row");
    expect(within(section).getByText("Plain").closest(".report__row")?.className).toBe("report__row");
    const link = within(section).getByRole("link", { name: "fact" });
    expect(link).toHaveAttribute("href", "https://basescan.org/address/0xa");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
  });

  it("prints the notes and names the sources", () => {
    render(<ReportView report={REPORT} />);
    expect(screen.getByText("A caveat.")).toBeInTheDocument();
    expect(screen.getByText("Sources: Base RPC, Blockscout")).toBeInTheDocument();
  });
});

describe("SkillForm", () => {
  it("builds a field per argument, and the button names what is missing", async () => {
    const probe = controlled([
      { name: "contract", hint: "0x…" },
      { name: "function", hint: "e.g. totalSupply", optional: true },
    ]);
    render(<SkillForm skill={probe.skill} />);
    expect(screen.getByText("What probe answers.")).toBeInTheDocument();
    expect(screen.getByLabelText("function")).toHaveAttribute("placeholder", "e.g. totalSupply");
    expect(screen.getByText(/function — optional/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter contract" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("contract"), "0xabc");
    expect(screen.getByRole("button", { name: "Look up" })).toBeEnabled();
  });

  /** A form and a typed command reach the skill with the same arguments. */
  it("splits the fields the way the Terminal splits a line, dropping empty ones", async () => {
    const probe = controlled([
      { name: "contract", hint: "" },
      { name: "function", hint: "", optional: true },
      { name: "arguments", hint: "", optional: true },
    ]);
    render(<SkillForm skill={probe.skill} />);
    await userEvent.type(screen.getByLabelText("contract"), " 0xabc ");
    await userEvent.type(screen.getByLabelText("arguments"), "1  2");
    await userEvent.click(screen.getByRole("button", { name: "Look up" }));
    expect(probe.seen).toEqual([["0xabc", "1", "2"]]);
  });

  it("says it is reading, then shows the report", async () => {
    const probe = controlled();
    render(<SkillForm skill={probe.skill} />);
    await userEvent.type(screen.getByLabelText("address"), "0xabc");
    await userEvent.click(screen.getByRole("button", { name: "Look up" }));
    expect(screen.getByRole("button", { name: "Reading…" })).toBeDisabled();
    await probe.resolve();
    expect(screen.getByRole("region", { name: "Sample" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Look up" })).toBeEnabled();
  });

  it("shows a failure as the sentence the skill threw, and clears the old report", async () => {
    const probe = controlled();
    render(<SkillForm skill={probe.skill} />);
    await userEvent.type(screen.getByLabelText("address"), "0xabc");
    await userEvent.click(screen.getByRole("button", { name: "Look up" }));
    await probe.resolve();
    await userEvent.click(screen.getByRole("button", { name: "Look up" }));
    await probe.reject(new Error("Blockscout could not be reached. Nothing was read from it."));
    expect(screen.getByLabelText("Probe probe error")).toHaveTextContent("Blockscout could not be reached.");
    expect(screen.queryByRole("region", { name: "Sample" })).not.toBeInTheDocument();
  });

  it("runs on Enter, but not while an argument is missing or a read is under way", async () => {
    const probe = controlled();
    render(<SkillForm skill={probe.skill} />);
    const field = screen.getByLabelText("address");
    await userEvent.type(field, "{Enter}");
    expect(probe.seen).toHaveLength(0);
    await userEvent.type(field, "0xabc{Enter}");
    expect(probe.seen).toHaveLength(1);
    await userEvent.type(field, "{Enter}");
    expect(probe.seen).toHaveLength(1);
    await userEvent.type(field, "d");
    expect(probe.seen).toHaveLength(1);
    await probe.resolve();
  });

  it("offers Check now for a skill that takes nothing", () => {
    render(<SkillForm skill={controlled([]).skill} />);
    expect(screen.getByRole("button", { name: "Check now" })).toBeEnabled();
  });
});

describe("SkillWindow", () => {
  it("shows no tabs for a single skill", () => {
    render(<SkillWindow label="Safety" window="research" skills={[controlled().skill]} />);
    expect(screen.queryByRole("group", { name: "Safety" })).not.toBeInTheDocument();
  });

  /** An address typed for one skill must not quietly become another's input. */
  it("switches skills with tabs and resets the form when it does", async () => {
    const a = controlled(undefined, "a");
    const b = controlled(undefined, "b");
    render(<SkillWindow label="Research" window="research" skills={[a.skill, b.skill]} />);
    const tabs = within(screen.getByRole("group", { name: "Research" }));
    expect(tabs.getByRole("button", { name: "Probe a" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.type(screen.getByLabelText("address"), "0xabc");
    await userEvent.click(tabs.getByRole("button", { name: "Probe b" }));
    expect(tabs.getByRole("button", { name: "Probe b" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("What b answers.")).toBeInTheDocument();
    expect(screen.getByLabelText("address")).toHaveValue("");
  });
});

describe("TerminalPanel", () => {
  const command = () => screen.getByLabelText("Command");
  const output = () => screen.getByLabelText("Terminal output");

  it("greets with what to type", () => {
    render(<TerminalPanel />);
    expect(output()).toHaveTextContent("Type a command. `help` lists them");
  });

  it("prints help under the command that asked for it, and clears the line", async () => {
    render(<TerminalPanel />);
    await userEvent.type(command(), "help{Enter}");
    expect(output()).toHaveTextContent("> help");
    expect(output()).toHaveTextContent("empty the screen");
    expect(command()).toHaveValue("");
  });

  it("ignores an empty line and names an unknown command", async () => {
    render(<TerminalPanel />);
    await userEvent.type(command(), "   {Enter}");
    expect(within(output()).queryByText(/^>/)).not.toBeInTheDocument();
    await userEvent.type(command(), "teleport{Enter}");
    expect(within(output()).getByText('No command "teleport". Type help for the list.')).toHaveClass("crt__amber");
  });

  it("empties the screen on clear", async () => {
    render(<TerminalPanel />);
    await userEvent.type(command(), "help{Enter}");
    await userEvent.type(command(), "clear{Enter}");
    expect(output()).not.toHaveTextContent("> help");
    expect(output()).toHaveTextContent("Type a command.");
  });

  it("does nothing until Enter", async () => {
    render(<TerminalPanel />);
    await userEvent.type(command(), "help");
    expect(output()).not.toHaveTextContent("> help");
  });

  /** A real skill, over the fake network: the radar over a quiet window of the captured chain. */
  it("runs a skill, shows it reading, then prints the report as text", async () => {
    net({ rpc: quietRadar });
    render(<TerminalPanel />);
    await userEvent.type(command(), "help{Enter}");
    await userEvent.type(command(), "radar 5{Enter}");
    await settle();
    await settle();
    expect(output()).toHaveTextContent("== Launch Radar — last 5 min ==");
    expect(output()).toHaveTextContent("sources: Base (eth_getLogs: v4 pools");
    // the answer settles onto its own entry and leaves the earlier one alone
    expect(output()).toHaveTextContent("empty the screen");
  });

  it("prints a skill's failure in amber, under its command", async () => {
    render(<TerminalPanel />);
    await userEvent.type(command(), "token nope{Enter}");
    await settle();
    const failure = within(output()).getByText(/Token/);
    expect(failure).toHaveClass("crt__amber");
  });

  it("shows reading… while a skill is still answering", async () => {
    // a fetch that never answers — the net fake answers everything, so this stubs past it
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    render(<TerminalPanel />);
    await userEvent.type(command(), "radar{Enter}");
    expect(within(output()).getByText("reading…")).toBeInTheDocument();
  });

  it("scrolls to the newest output", async () => {
    render(<TerminalPanel />);
    const screenEl = output().querySelector(".terminal") as HTMLDivElement;
    Object.defineProperty(screenEl, "scrollHeight", { configurable: true, value: 480 });
    await userEvent.type(command(), "help{Enter}");
    expect(screenEl.scrollTop).toBe(480);
  });
});

describe("the skill windows on the desktop", () => {
  it("opens Radar on its own, and Check with every way to check something as a tab (2026-10-29)", async () => {
    renderAt("/?do=research");
    await settle();
    // one skill, so no tabs: the form alone
    expect(screen.queryByRole("group", { name: "Radar" })).toBeNull();
    expect(screen.getByText(radarSkill.summary)).toBeInTheDocument();
    cleanup();
    renderAt("/?do=safety");
    await settle();
    const tabs = within(screen.getByRole("group", { name: "Check" }));
    expect(tabs.getAllByRole("button").map((b) => b.textContent)).toEqual(["Token Verdict", "Send Check", "Launch Forensics", "Launcher", "Token Gate"]);
  });

  it("opens Check straight onto the Token Verdict", async () => {
    renderAt("/?do=safety");
    await settle();
    expect(screen.getByText(verdictSkill.summary)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter token address" })).toBeDisabled();
  });

  it("opens the Terminal", async () => {
    renderAt("/?do=terminal");
    await settle();
    expect(screen.getByLabelText("Command")).toBeInTheDocument();
  });
});
