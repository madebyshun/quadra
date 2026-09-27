/**
 * The MCP server's manifest, typed, for the app to read.
 *
 * One file describes the agent surface, and both halves read it: this module for
 * the panel, and `tools/quadra-mcp/index.mjs` with `readFileSync`. The server is
 * plain `.mjs` on purpose — it has to run under bare `node` with no build step —
 * so it cannot import from `src/`, and the direction has to be this way round:
 * the shared data lives next to the server, and TypeScript reaches out to it.
 *
 * The point is that the panel cannot advertise a tool the server does not serve.
 * A hand-kept second list is the version of this that drifts, and it drifts
 * silently: nothing fails, the window just describes a server that isn't there.
 *
 * This is the only relative path out of `src/`. Keep it that way.
 */

import manifest from "../../tools/quadra-mcp/tools.json";

/**
 * Where a tool has to reach to answer.
 *
 * `offline` means it computes, full stop — no socket is opened. `public-read`
 * means it GETs something free and public. There is deliberately no third value:
 * a tool that spends money or signs anything cannot exist in a server that holds
 * no key, so the type has no way to say it.
 */
export type Reach = "offline" | "public-read";

export type McpTool = {
  name: string;
  reach: Reach;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: readonly string[];
    additionalProperties?: boolean;
  };
};

export const MCP_SERVER = manifest.server;

export const MCP_TOOLS: readonly McpTool[] = manifest.tools as readonly McpTool[];

export const MCP_BUILD = manifest.build;

/** The v4 flag table, shared with `lib/hooks.ts` so the server reads the same one. */
export const MCP_HOOK_PERMISSIONS = manifest.hookPermissions;

/**
 * How to run the server, exactly as it goes into a client's config file.
 *
 * Built from the manifest rather than written out in the panel, so the command
 * shown is the command the repo actually contains. A pasted config that points
 * at the wrong path fails with a spawn error that says nothing useful.
 */
export function mcpConfigSnippet(): string {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER.name]: { command: MCP_SERVER.command, args: MCP_SERVER.args },
      },
    },
    null,
    2,
  );
}
