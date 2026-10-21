import { BRAND } from "@/brand";
import { reportText, SKILLS } from "@/skills/index";
import type { Skill } from "@/skills/types";

/**
 * Every skill as an MCP tool — the owner's decision of 2026-09-30: the MCP server offers all
 * the read-only skills, free, running on the user's own machine and reading the chain itself.
 *
 * This module is the ONE definition of those tools. `npm run build:mcp` bundles it (with the
 * skills it imports) into `tools/quadra-mcp/skills.mjs`, which the stdio server loads — so the
 * server runs under bare `node` with no build step on the user's machine, and an agent gets the
 * exact report a person sees in the Research window or the Terminal. `tests/mcp.test.ts` fails
 * when the checked-in bundle and this source disagree.
 *
 * Read-only by construction: a skill reads, and nothing here signs (hard rule 5).
 */

export type McpTool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Record<string, { readonly type: "string"; readonly description: string }>;
    readonly required: readonly string[];
    readonly additionalProperties: false;
  };
};

/** "address or name" → "address_or_name": an argument's name as a JSON property. */
export function argKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

const toolName = (s: Skill) => `${BRAND.slug}_${s.id}`;

export function skillTools(skills: readonly Skill[] = SKILLS): McpTool[] {
  return skills.map((s) => ({
    name: toolName(s),
    description: `${s.title}: ${s.summary} Read live from Base (8453). Returns the same report ${BRAND.name}'s Research window and Terminal show, with every source named; a value that could not be read is said so, never omitted.`,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(s.args.map((a) => [argKey(a.name), { type: "string", description: `${a.name} — ${a.hint}` }])),
      required: s.args.filter((a) => !a.optional).map((a) => argKey(a.name)),
      additionalProperties: false,
    },
  }));
}

/**
 * Run the skill a tool names, with its arguments in the skill's own order. `null` when the name
 * is not a skill tool (the server's other tools answer it); a thrown sentence when the skill
 * refuses its input or a source is down — the server turns that into an MCP error result.
 */
export async function callSkillTool(name: string, input: Record<string, unknown>, skills: readonly Skill[] = SKILLS): Promise<string | null> {
  const skill = skills.find((s) => toolName(s) === name);
  if (!skill) return null;
  const args = skill.args.map((a) => {
    const v = input[argKey(a.name)];
    return typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
  });
  while (args.length > 0 && args.at(-1) === "") args.pop();
  return reportText(await skill.run(args));
}
