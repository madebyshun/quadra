import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MCP_BUILD,
  MCP_HOOK_PERMISSIONS,
  MCP_SERVER,
  MCP_TOOLS,
  mcpConfigSnippet,
} from "@/lib/manifest";
import { HOOK_PERMISSIONS, NOT_AN_ADDRESS, readHookAddress } from "@/lib/hooks";
import { formatAmount, parseAmount } from "@/lib/amount";
import { BASE, CONTRACTS } from "@/config/chain";
import { skillTools } from "@/skills/mcp";

/**
 * The MCP server is the one part of this repo that runs outside the app.
 *
 * It is plain `.mjs` under bare `node`, so it cannot import the TypeScript the app
 * uses and it is not in the coverage denominator. Both of those mean the usual
 * gate does not see it, so these tests do two specific jobs a unit test would not:
 *
 *   1. They spawn the real server over real stdio, so the framing, the handshake
 *      and the notification rule are exercised rather than assumed.
 *   2. They compare its answers to the app's own `parseAmount`, `formatAmount` and
 *      `readHookAddress`. That arithmetic is reimplemented in the server because it
 *      cannot be shared, and comparing outputs is the only thing that keeps the two
 *      copies equal. Without these, the duplication is a slow leak.
 */

/**
 * Resolved from the working directory, not from `import.meta.url`. Vite rewrites
 * this file's own URL to an `http://` one inside jsdom, so `fileURLToPath` throws
 * on it — a real thing to know before reaching for the usual ESM idiom here.
 * Vitest's root is the package root, which is what `npm test` runs from.
 */
const ROOT = process.cwd();
const SERVER = resolve(ROOT, "tools/quadra-mcp/index.mjs");
const SOURCE = readFileSync(SERVER, "utf8");
/** The generated skill bundle the server loads — held to the same no-key rules as the server. */
const BUNDLE = readFileSync(resolve(ROOT, "tools/quadra-mcp/skills.mjs"), "utf8");

/**
 * The server's code with its block comments removed.
 *
 * The no-key check below looks for literal strings, and the first version of it
 * failed on the server's own header — a comment saying "no `process.env`, no
 * mnemonic" contains both. Explaining the guarantee should not violate it. Only
 * block comments are stripped, deliberately: that is where all the prose in that
 * file lives, and leaving line comments in scope keeps the check erring towards
 * failing rather than towards passing, which is the right direction for this one.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "");

type Reply = {
  id?: number | null;
  result?: { content?: { type: string; text: string }[]; isError?: boolean } & Record<
    string,
    unknown
  >;
  error?: { code: number; message: string };
};

/**
 * Drive the server the way a client does: newline-delimited JSON in, the same out.
 *
 * `stdin.end()` is what makes it exit — the process stays alive while stdin is
 * open, which is correct for a long-lived server and would hang a test that only
 * wrote and waited. Anything on stderr is a failure: a server sharing a pipe with
 * the protocol has nowhere safe to be chatty, so it should be silent.
 */
async function talk(requests: unknown[], args: string[] = []): Promise<Reply[]> {
  const child = spawn(process.execPath, [SERVER, ...args]);
  let out = "";
  let err = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d: string) => (out += d));
  child.stderr.on("data", (d: string) => (err += d));
  child.stdin.end(requests.map((r) => `${JSON.stringify(r)}\n`).join(""));

  await new Promise<void>((done) => child.on("close", () => done()));
  if (err) throw new Error(`the server wrote to stderr, which shares the protocol pipe:\n${err}`);
  return out.trim() ? out.trim().split("\n").map((line) => JSON.parse(line) as Reply) : [];
}

/** One `tools/call`, returning the text it produced and whether it failed. */
async function call(
  name: string,
  args: Record<string, unknown> = {},
  flags: string[] = [],
): Promise<{ text: string; failed: boolean }> {
  const [reply] = await talk([{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }], flags);
  const content = reply?.result?.content?.[0];
  if (!content) throw new Error(`no content came back: ${JSON.stringify(reply)}`);
  return { text: content.text, failed: reply?.result?.isError === true };
}

describe("the manifest", () => {
  it("advertises five tools, each named for this product", () => {
    expect(MCP_TOOLS).toHaveLength(5);
    for (const tool of MCP_TOOLS) expect(tool.name, tool.name).toMatch(/^quadra_[a-z_]+$/);
  });

  it("names each tool once", () => {
    const names = new Set(MCP_TOOLS.map((t) => t.name));
    expect(names.size).toBe(MCP_TOOLS.length);
  });

  /**
   * A tool that spends money cannot exist in a server with no key, so `reach` has
   * only two values. This is the assertion that would fail the day someone adds a
   * third — which is the day the no-key promise needs re-reading, not patching.
   */
  it("keeps every tool to reading, either offline or from a public endpoint", () => {
    for (const tool of MCP_TOOLS) {
      expect(["offline", "public-read"], tool.name).toContain(tool.reach);
    }
  });

  it("gives each tool a closed object schema, so an agent cannot smuggle a field", () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.inputSchema.type, tool.name).toBe("object");
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
    }
  });

  /**
   * The description is the entire basis on which an agent picks a tool, so a thin
   * one is a selection bug rather than a documentation gap. Each of these also has
   * to say what the tool will NOT do, which is why the floor is this high.
   */
  it("describes each tool at length, because that is what the agent chooses on", () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(120);
    }
  });

  it("targets the chain the app targets", () => {
    expect(MCP_BUILD.chain).toEqual({ id: BASE.id, name: BASE.name });
  });

  /**
   * The server cannot import `chain.ts`, so the contract list is stated twice. This
   * is the link between them: a contract deployed in one place and not the other
   * would have the agent report an address the app does not use, or the reverse.
   */
  it("reports the same contracts as the app, deployed or not", () => {
    expect(MCP_BUILD.contracts).toEqual(CONTRACTS);
  });

  /**
   * Not a copy of the flag table, the same object. The address reader imports it
   * from here, so there is nothing to keep in sync — this pins the direction of
   * that dependency, which is the thing a refactor would quietly reverse.
   */
  it("holds the one v4 flag table the address reader uses", () => {
    expect(HOOK_PERMISSIONS).toBe(MCP_HOOK_PERMISSIONS);
  });

  it("states its limits, since quadra_status is only the limits read back", () => {
    expect(MCP_BUILD.limits.length).toBeGreaterThan(0);
  });

  it("says it is not published, because it is not", () => {
    expect(MCP_SERVER.published).toBe(false);
  });

  it("points at a server file that is really there", () => {
    const [entry] = MCP_SERVER.args;
    expect(entry, "the manifest names no server file").toBeDefined();
    expect(existsSync(resolve(ROOT, entry ?? ""))).toBe(true);
  });

  it("writes a config snippet a client can paste", () => {
    const parsed = JSON.parse(mcpConfigSnippet()) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(parsed.mcpServers["quadra"]).toEqual({
      command: MCP_SERVER.command,
      args: MCP_SERVER.args,
    });
  });
});

/**
 * The no-key guarantee, checked rather than promised.
 *
 * The panel tells a user their agent never holds their keys. That sentence is only
 * worth printing if something enforces it, and the enforcement has to be a
 * property of the source: no environment read, no key material, no signing. A
 * comment saying "holds no key" is exactly as true as nobody having edited since.
 */
describe("holding no key", () => {
  it("reads no environment variable, only the command line — nor does the skill bundle it loads", () => {
    expect(CODE).not.toContain("process.env");
    expect(CODE).toContain("process.argv");
    expect(BUNDLE).not.toContain("process.env");
  });

  it.each(["PRIVATE_KEY", "MNEMONIC", "privateKey", "mnemonic", "signTypedData", "sendTransaction"])(
    "has no %s in its code or in the skill bundle",
    (forbidden) => {
      expect(CODE, "if this tripped on a comment, reword the comment — the check is literal").not.toContain(
        forbidden,
      );
      expect(BUNDLE).not.toContain(forbidden);
    },
  );

  it("says so out loud when asked", async () => {
    const { text, failed } = await call("quadra_status");
    expect(failed).toBe(false);
    expect(text).toContain("holds no key");
    for (const limit of MCP_BUILD.limits) expect(text).toContain(limit);
  });
});

describe("the protocol", () => {
  it("answers the handshake with the manifest's own name and version", async () => {
    const [reply] = await talk([{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }]);
    expect(reply?.result?.["serverInfo"]).toEqual({
      name: MCP_SERVER.name,
      version: MCP_SERVER.version,
    });
    expect(reply?.result?.["capabilities"]).toEqual({ tools: {} });
  });

  it("advertises exactly what the manifest lists, then every skill, and nothing more", async () => {
    const [reply] = await talk([{ jsonrpc: "2.0", id: 1, method: "tools/list" }]);
    const tools = reply?.result?.["tools"] as { name: string; description: string }[];
    expect(tools.map((t) => t.name)).toEqual([...MCP_TOOLS.map((t) => t.name), ...skillTools().map((t) => t.name)]);
    // the server advertises the bundle's definitions, and they are this source's
    expect(tools.slice(MCP_TOOLS.length)).toEqual(skillTools());
  });

  /**
   * `reach` is ours, not MCP's. Sending it would be a field no client asked for in
   * a schema clients validate, and the tidier failure is to strip it here.
   */
  it("keeps its own reach field to itself", async () => {
    const [reply] = await talk([{ jsonrpc: "2.0", id: 1, method: "tools/list" }]);
    const tools = reply?.result?.["tools"] as Record<string, unknown>[];
    for (const tool of tools) expect(Object.keys(tool).sort()).toEqual(["description", "inputSchema", "name"]);
  });

  it("answers a ping", async () => {
    const [reply] = await talk([{ jsonrpc: "2.0", id: 9, method: "ping" }]);
    expect(reply?.result).toEqual({});
  });

  /**
   * The mistake that hangs a client. `notifications/initialized` arrives right
   * after the handshake and carries no id; a reply to it is a response nothing is
   * waiting for, and a strict client treats that as a protocol violation.
   */
  it("never answers a notification", async () => {
    const replies = await talk([
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 1, method: "ping" },
    ]);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.id).toBe(1);
  });

  it("refuses a method it does not have", async () => {
    const [reply] = await talk([{ jsonrpc: "2.0", id: 1, method: "resources/list" }]);
    expect(reply?.error?.code).toBe(-32601);
    expect(reply?.error?.message).toContain("resources/list");
  });

  it("reports a parse error instead of dying on one bad line", async () => {
    const child = spawn(process.execPath, [SERVER]);
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (out += d));
    child.stdin.end(`{not json\n${JSON.stringify({ jsonrpc: "2.0", id: 4, method: "ping" })}\n`);
    await new Promise<void>((done) => child.on("close", () => done()));

    const replies = out.trim().split("\n").map((l) => JSON.parse(l) as Reply);
    expect(replies[0]?.error?.code).toBe(-32700);
    expect(replies[1]?.id).toBe(4);
  });

  it("names the tools it does have when asked for one it does not", async () => {
    const { text, failed } = await call("quadra_drain_wallet");
    expect(failed).toBe(true);
    expect(text).toContain("quadra_read_hook");
    expect(text).toContain("quadra_radar");
  });
});

/**
 * The skills as tools, through the real server. Only answers that need no network are
 * checked here — the spawned process reads the real chain, which no test may reach; the
 * skills' reports themselves are tested against captures in the skills suites and through
 * `callSkillTool` in `tests/mcpSkills.test.ts`.
 */
describe("the skills as tools", () => {
  it("refuses missing input in the skill's own words, as an MCP error rather than a crash", async () => {
    const radar = await call("quadra_radar", { minutes: "abc" });
    expect(radar).toEqual({ failed: true, text: "Minutes must be a whole number from 1 to 180." });
    const token = await call("quadra_verdict", { token_address: "0x12" });
    expect(token.failed).toBe(true);
    expect(token.text).toMatch(/not a 20-byte hex address/);
  });
});

/**
 * The cross-checks. Each of these compares the server's own answer to the
 * function the app calls for the same thing, because the server reimplements the
 * arithmetic and cannot import it.
 */
describe("reading a hook address, the same way the app does", () => {
  const cases = [
    `0x${"0".repeat(40)}`,
    `0x${"0".repeat(38)}c0`,
    `0x${"f".repeat(36)}0080`,
    `0x${"0".repeat(37)}3ff`,
    `0x${"f".repeat(40)}`,
  ];

  it.each(cases)("grants the same permissions as readHookAddress for %s", async (address) => {
    const { text, failed } = await call("quadra_read_hook", { address });
    expect(failed).toBe(false);

    const reading = readHookAddress(address);
    for (const p of reading.permissions) {
      expect(text, p.name).toContain(`${p.granted ? "ON " : "off"} ${p.name}`);
    }
    if (reading.inert) {
      expect(text).toContain("carries no hook permissions");
    } else {
      expect(text).toContain(`at ${reading.granted.length} of 14 points`);
    }
  });

  it("refuses a non-address with the app's own wording", async () => {
    const { text, failed } = await call("quadra_read_hook", { address: `0x${"f".repeat(64)}` });
    expect(failed).toBe(true);
    expect(text).toBe(NOT_AN_ADDRESS);
  });

  it("refuses a missing address rather than reading the empty string as inert", async () => {
    const { text, failed } = await call("quadra_read_hook");
    expect(failed).toBe(true);
    expect(text).toBe(NOT_AN_ADDRESS);
  });

  it("repeats the limit every time, so the answer never reads as an audit", async () => {
    const { text } = await call("quadra_read_hook", { address: `0x${"0".repeat(40)}` });
    expect(text).toContain("never what they do");
  });
});

describe("converting amounts, the same way the app does", () => {
  const cases: [string, number][] = [
    ["12.5", 8],
    ["0.000001", 6],
    ["1", 18],
    ["0", 6],
    ["1234.56789", 8],
  ];

  it.each(cases)("turns %s at %i decimals into the same base units as parseAmount", async (value, decimals) => {
    const { text, failed } = await call("quadra_amount", { value, decimals, to: "base" });
    expect(failed).toBe(false);
    expect(text).toContain(`${parseAmount(value, decimals)} base units`);
  });

  it.each(cases)("and turns those base units back into %s at %i decimals", async (value, decimals) => {
    const units = parseAmount(value, decimals);
    const { text, failed } = await call("quadra_amount", {
      value: units.toString(),
      decimals,
      to: "human",
    });
    expect(failed).toBe(false);
    expect(text).toContain(`exactly ${formatAmount(units, decimals)}`);
  });

  /**
   * The 10^10 hazard in one test. A tokenized share has 8 decimals and USDC has 6,
   * so the same string is two different amounts and the agent has to pass the right
   * decimals. This asserts the server does not quietly pick one.
   */
  it("gives a different answer for the same number at different decimals", async () => {
    const eight = await call("quadra_amount", { value: "1", decimals: 8, to: "base" });
    const six = await call("quadra_amount", { value: "1", decimals: 6, to: "base" });
    expect(eight.text).toContain("100000000 base units");
    expect(six.text).toContain("1000000 base units");
  });

  it("refuses to round, with the app's own wording", async () => {
    const { text, failed } = await call("quadra_amount", {
      value: "1.2345678",
      decimals: 6,
      to: "base",
    });
    expect(failed).toBe(true);
    expect(() => parseAmount("1.2345678", 6)).toThrow(text);
  });

  it.each([
    ["an empty amount", { value: "", decimals: 6, to: "base" }, "Enter an amount."],
    ["words", { value: "one dollar", decimals: 6, to: "base" }, "not a plain decimal number"],
    ["a bad direction", { value: "1", decimals: 6, to: "sideways" }, `"to" must be`],
    ["missing decimals", { value: "1", to: "base" }, "token's own decimals"],
    ["impossible decimals", { value: "1", decimals: 99, to: "base" }, "integer in 0..36"],
    ["a fraction as base units", { value: "1.5", decimals: 6, to: "human" }, "whole number of base units"],
  ])("refuses %s", async (_label, args, expected) => {
    const { text, failed } = await call("quadra_amount", args);
    expect(failed).toBe(true);
    expect(text).toContain(expected);
  });
});

/**
 * The two public reads, against a fixture serving the shapes measured on
 * 2026-09-27. Pointing at the real host would make this suite slow, offline-hostile
 * and dependent on someone else's deploy; pointing at a fixture pins the three
 * answers upstream can give, which is the part this server has to get right.
 *
 * The fourth shape is the interesting one, and it is not the one first assumed. All
 * 115 listed ids quoted cleanly on 2026-09-27 (109 paid, 6 free, 0 dead); the id that
 * answers 501 is `honeypot`, which the catalog does not list, and whose hint insists
 * it does. An agent told a price for a tool that cannot run will pay it, so the 501 is
 * reported as "nothing implements this", not as a temporary outage worth retrying.
 */
describe("reading the catalog and a quote", () => {
  let server: Server;
  let flags: string[] = [];

  const CATALOG = {
    count: 2,
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payTo: "0x02950ad38ada1d599375bd447e080cd404809205",
    tools: [
      { id: "token-price", name: "Token Price", price: "$0.01", category: "on-chain" },
      { id: "hood-live", name: "Blue Hood Live Board", price: "$0.00", category: "signal" },
    ],
  };

  const PAID = {
    x402Version: 2,
    error: "Payment Required",
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        amount: "10000",
        payTo: "0x02950ad38ada1d599375bd447e080cd404809205",
      },
    ],
    tool: { id: "token-price", price: "$0.01", input: { type: "object", required: ["token"] } },
  };

  const FREE = {
    x402Version: 2,
    free: true,
    price: "$0.00",
    hint: "Free — no payment, no wallet, no X-PAYMENT header.",
    tool: { id: "hood-live", input: { type: "object", required: [] } },
  };

  const GONE = {
    error: "Tool temporarily unavailable — you were not charged.",
    code: "TOOL_UNAVAILABLE",
    tool: "honeypot",
    hint: "This tool id exists in the public catalog but is not currently implemented.",
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const [body, code] =
        req.url === "/api/catalog"
          ? [CATALOG, 200]
          : req.url === "/api/x402/token-price"
            ? [PAID, 402]
            : req.url === "/api/x402/hood-live"
              ? [FREE, 200]
              : [GONE, 501];
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("no port");
    flags = ["--upstream", `http://127.0.0.1:${address.port}`];
  });

  afterAll(async () => {
    await new Promise<void>((closed) => server.close(() => closed()));
  });

  it("lists every tool as one line, and points at the quote for the detail", async () => {
    const { text, failed } = await call("quadra_list_tools", {}, flags);
    expect(failed).toBe(false);
    expect(text).toContain("token-price  $0.01  on-chain");
    expect(text).toContain("hood-live  $0.00  signal");
    expect(text).toContain("quadra_quote_tool");
  });

  it("names the payee and the network before any of it is acted on", async () => {
    const { text } = await call("quadra_list_tools", {}, flags);
    expect(text).toContain(CATALOG.payTo);
    expect(text).toContain(CATALOG.network);
  });

  it("quotes a paid tool in base units, not in dollars it cannot derive", async () => {
    const { text, failed } = await call("quadra_quote_tool", { toolId: "token-price" }, flags);
    expect(failed).toBe(false);
    expect(text).toContain("10000 base units");
    expect(text).toContain("does not carry the asset's decimals");
    expect(text).toContain("Paying it needs a wallet, which this server does not have.");
  });

  /**
   * Free has to come back as free and not as a price of zero. A zero price is a
   * number an agent can build a payment out of; "free" is not.
   */
  it("reports a free tool as free", async () => {
    const { text, failed } = await call("quadra_quote_tool", { toolId: "hood-live" }, flags);
    expect(failed).toBe(false);
    expect(text).toContain("is free");
    expect(text).not.toContain("base units");
  });

  it("says outright when nothing upstream implements the id", async () => {
    const { text, failed } = await call("quadra_quote_tool", { toolId: "honeypot" }, flags);
    expect(failed).toBe(false);
    expect(text).toContain("not callable");
    expect(text).toContain("retrying will not help");
  });

  /**
   * The id that 501s is an id the catalog omits, so the way out is the list — not a
   * retry, and not the hint's own claim that the catalog has it.
   */
  it("points a stale id back at the list instead of repeating upstream's claim", async () => {
    const { text } = await call("quadra_quote_tool", { toolId: "honeypot" }, flags);
    expect(text).toContain("quadra_list_tools");
    expect(text).not.toContain("honeypot is listed in the catalog");
  });

  it("asks for an id rather than fetching nothing", async () => {
    const { text, failed } = await call("quadra_quote_tool", { toolId: "  " }, flags);
    expect(failed).toBe(true);
    expect(text).toContain("Pass a tool id");
  });

  it("reports an unreachable upstream as a failure, not as an empty catalog", async () => {
    const { text, failed } = await call("quadra_list_tools", {}, ["--upstream=http://127.0.0.1:1"]);
    expect(failed).toBe(true);
    expect(text.length).toBeGreaterThan(0);
  });
});
