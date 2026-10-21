import { describe, expect, it } from "vitest";
import { argKey, callSkillTool, skillTools } from "@/skills/mcp";
import { SKILLS } from "@/skills";
import type { Skill } from "@/skills/types";
import { quietRadar } from "./fixtures/radar";
import { net, useNet } from "./net";

/**
 * The skills as MCP tools — the definitions the stdio server advertises and the call it makes,
 * tested here against captured answers (the spawned server itself cannot be pointed at a fake
 * network; `tests/mcp.test.ts` checks what it can offline).
 */

useNet();

/** A skill with three arguments, the last two optional — the shape argument order matters for. */
function threeArgs(seen: (readonly string[])[]): Skill {
  return {
    id: "probe",
    title: "Probe",
    summary: "Takes three.",
    args: [
      { name: "contract", hint: "0x…" },
      { name: "function", hint: "name", optional: true },
      { name: "arguments", hint: "a,b", optional: true },
    ],
    run: async (args) => {
      seen.push(args);
      return { title: "x", rows: [], notes: [], sources: [] };
    },
  };
}

describe("skill tools", () => {
  it("turns an argument's name into a JSON property name", () => {
    expect(argKey("address or name")).toBe("address_or_name");
    expect(argKey(" Token address! ")).toBe("token_address");
    expect(argKey("function")).toBe("function");
  });

  it("offers one tool per skill, named for the product, with a closed schema and the required arguments", () => {
    const tools = skillTools();
    expect(tools.map((t) => t.name)).toEqual(SKILLS.map((s) => `quadra_${s.id}`));
    const verdict = tools.find((t) => t.name === "quadra_verdict")!;
    expect(verdict.inputSchema).toEqual({
      type: "object",
      properties: { token_address: { type: "string", description: "token address — 0x…" } },
      required: ["token_address"],
      additionalProperties: false,
    });
    const radar = tools.find((t) => t.name === "quadra_radar")!;
    expect(radar.inputSchema.required).toEqual([]);
    const [probe] = skillTools([threeArgs([])]);
    expect(Object.keys(probe!.inputSchema.properties)).toEqual(["contract", "function", "arguments"]);
    expect(probe!.inputSchema.required).toEqual(["contract"]);
    for (const t of tools) expect(t.description).toMatch(/Read live from Base \(8453\)\. Returns the same report/);
  });

  it("runs the skill a tool names and answers with the Terminal's own text", async () => {
    net({ rpc: quietRadar });
    const text = await callSkillTool("quadra_radar", { minutes: "5" });
    expect(text).toMatch(/^== Launch Radar — last 5 min ==/);
    expect(text).toContain("sources: Base (eth_getLogs: v4 pools, and basepad's and Doppler's launch logs), Blockscout, DexScreener");
  });

  it("answers null for a name that is not a skill tool, so the server's own tools can", async () => {
    expect(await callSkillTool("quadra_read_hook", {})).toBeNull();
  });

  it("passes arguments in the skill's order, as text, with trailing blanks dropped", async () => {
    const seen: (readonly string[])[] = [];
    const probe = [threeArgs(seen)];
    await callSkillTool("quadra_probe", { arguments: 7, contract: "0xabc" }, probe);
    await callSkillTool("quadra_probe", { contract: "0xabc", function: null, arguments: "" }, probe);
    await callSkillTool("quadra_probe", { contract: "0xabc", function: "balanceOf" }, probe);
    expect(seen).toEqual([["0xabc", "", "7"], ["0xabc"], ["0xabc", "balanceOf"]]);
  });

  it("lets a skill's own refusal through as a thrown sentence", async () => {
    await expect(callSkillTool("quadra_verdict", {})).rejects.toThrow(/Token/);
  });
});
