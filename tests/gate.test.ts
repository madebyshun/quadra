import { describe, expect, it, vi } from "vitest";
import { codeOf, gateOf, gateSkill, tokenGate } from "@/skills/gate";
import { row, type Report } from "@/skills/types";

/**
 * Token Gate is Token Verdict reshaped for a machine. The verdict itself is tested against real
 * captures in `verdict.test.ts`; here it is stood in for, so these tests are about the reshaping.
 */

const verdict = vi.hoisted(() => ({ report: null as unknown as Report }));
vi.mock("@/skills/verdict", () => ({ tokenVerdict: () => Promise.resolve(verdict.report) }));

const report = (rows: Report["rows"], score = "70/100"): Report => ({
  title: "DEGEN — Token Verdict",
  rows: [row("Token", "Degen (DEGEN)"), row("Verdict", `Caution — ${score}, some lines raised a flag or could not be checked`, { tone: "warn" }), ...rows],
  notes: ["Red: Code.", "The trade is simulated on Base."],
  sources: ["Base (eth_simulateV1)", "Relay"],
});

describe("Token Gate", () => {
  it("names a reason by its row, lowercased and dashed", () => {
    expect(codeOf("Buy → sell, simulated now")).toBe("buy-sell-simulated-now");
    expect(codeOf("Launcher's track record")).toBe("launcher-s-track-record");
  });

  it("blocks on a red line, cautions on an amber one, allows on neither — ignoring the verdict's own title rows", () => {
    expect(gateOf(report([row("Code", "can mint", { tone: "bad" }), row("Pool age", "1 hour", { tone: "warn" })]).rows)).toEqual({
      decision: "block",
      reasons: ["code:block", "pool-age:caution"],
    });
    expect(gateOf(report([row("Pool age", "1 hour", { tone: "warn" })]).rows).decision).toBe("caution");
    expect(gateOf(report([row("Code", "nothing", { tone: "ok" }), row("Price", "$1")]).rows)).toEqual({ decision: "allow", reasons: [] });
  });

  it("answers the decision first, then the score, the codes and only the flagged lines — the verdict's red-note dropped", async () => {
    verdict.report = report([row("Code", "can mint", { tone: "bad" }), row("Price", "$1"), row("Pool age", "1 hour", { tone: "warn" })], "55/100");
    const g = await tokenGate("0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", 0);
    expect(g.title).toBe("DEGEN — Token Gate");
    expect(g.rows).toEqual([
      row("Decision", "block", { tone: "bad" }),
      row("Score", "55/100"),
      row("Reasons", "code:block, pool-age:caution"),
      row("Token", "Degen (DEGEN)"),
      row("Code", "can mint", { tone: "bad" }),
      row("Pool age", "1 hour", { tone: "warn" }),
    ]);
    expect(g.notes[0]).toMatch(/^allow = no red or amber line/);
    expect(g.notes).not.toContain("Red: Code.");
    expect(g.sources).toEqual(["Base (eth_simulateV1)", "Relay"]);
    verdict.report = report([], "100/100");
    expect((await gateSkill.run(["0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed"])).rows.slice(0, 3)).toEqual([
      row("Decision", "allow", { tone: "ok" }),
      row("Score", "100/100"),
      row("Reasons", "none"),
    ]);
  });
});
