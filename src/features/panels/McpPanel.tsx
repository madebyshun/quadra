import { MCP_BUILD, MCP_SERVER, MCP_TOOLS, mcpConfigSnippet, type Reach } from "@/lib/manifest";
import { Crt } from "@/ui/Crt";

/**
 * What another agent can do with this, and what it cannot.
 *
 * Every word here is read out of the same `tools.json` the stdio server serves
 * from, so this window cannot advertise a tool that does not exist. A hand-written
 * list would be the version that drifts, and it would drift silently: nothing
 * fails, the page just describes a server nobody has.
 *
 * The panel leads with the limits rather than burying them. An agent surface is
 * the one place where an overstated capability costs someone money — the agent
 * believes the list, picks the tool, and fails somewhere the user is not looking.
 */

const REACH: Record<Reach, string> = {
  offline: "no network",
  "public-read": "public read",
};

/**
 * Takes `published` rather than reading the manifest, so the installed wording is
 * checked now instead of first appearing on the day it publishes. Same reason as
 * `poolBadge` in lib/status: a sentence that only renders once something ships
 * should not make its debut untested.
 */
export function installLine(published: boolean, name: string): string {
  return published
    ? `Installed as ${name}. Your client starts it; nothing else to do.`
    : "Not published yet, so there is nothing to install. Run it out of this repo, and make that path absolute — your client starts the server from its own working directory, not from here.";
}

export function McpPanel() {
  return (
    <div className="stack">
      <fieldset className="group">
        <legend>What your agent gets</legend>
        <ul className="notes" aria-label="MCP tools">
          {MCP_TOOLS.map((tool) => (
            <li key={tool.name}>
              <span className="notes__row">
                <code className="notes__id">{tool.name}</code>
                <span className={tool.reach === "offline" ? "chip chip--ok" : "chip"}>
                  {REACH[tool.reach]}
                </span>
              </span>
              <span className="notes__why">{tool.description}</span>
            </li>
          ))}
        </ul>
        <p className="dim">
          All five of these read. None can sign, send or pay — the server holds no key, and that is
          checked by a test that reads its source, not promised in a comment.
        </p>
      </fieldset>

      <fieldset className="group">
        <legend>How to run it</legend>
        <Crt label="MCP server config">
          <span className="crt__pre">{mcpConfigSnippet()}</span>
        </Crt>
        <p className="dim">{installLine(MCP_SERVER.published, MCP_SERVER.name)}</p>
      </fieldset>

      <Crt label="What it cannot do">
        <span>
          {MCP_BUILD.chain.name} {MCP_BUILD.chain.id}, and only that one.
        </span>
        <ul className="notes" aria-label="Limits">
          {MCP_BUILD.limits.map((limit) => (
            <li key={limit}>
              <span className="crt__amber">{limit}</span>
            </li>
          ))}
        </ul>
        <span className="crt__dim">
          {"// quoting a tool is free and needs no wallet. Running one is not, and that is why it is absent."}
        </span>
      </Crt>
    </div>
  );
}
