#!/usr/bin/env node
/**
 * The Quadra MCP server. Five tools, over stdio, for another agent to call.
 *
 * ── It holds no key, and that is enforced, not promised ──────────────────────
 * This file reads no environment variable, opens no keystore, and has no signing
 * code in it. `tests/mcp.test.ts` asserts that by reading this source: no
 * `process.env`, no private key, no mnemonic. So the worst an agent can do
 * through this server is read something public. That is the whole design — an
 * agent surface that cannot lose your money is worth more than one that can do
 * more, and a server installed on someone else's machine is the last place a key
 * should live.
 *
 * ── Why the tool list is short ───────────────────────────────────────────────
 * Only what genuinely works today. Reading a v4 hook address is real arithmetic;
 * the catalog and the 402 quote are real free reads upstream; the amount
 * conversion is the exact one the app uses. There is no swap tool, no send tool
 * and no run-a-paid-tool tool, because the shielded pool is not deployed and
 * there is no wallet here. A tool that exists and cannot work is worse than an
 * absent one: the agent picks it, fails, and retries.
 *
 * ── The two duplications, on purpose ─────────────────────────────────────────
 * This runs under bare `node` with no build step, so it cannot import the app's
 * TypeScript. The v4 flag table is therefore not copied — it lives in
 * `tools.json` and both sides read it. The amount arithmetic and the address
 * mask cannot move into JSON, so they are reimplemented here, down to the
 * wording of each error, and `tests/mcp.test.ts` spawns this server and compares
 * its answers against `lib/amount.ts` and `lib/hooks.ts`. The test is what makes
 * the duplication safe; without it this file would drift within a month.
 *
 * ── Upstream shapes, measured 2026-09-27 ─────────────────────────────────────
 *   GET /api/catalog        → 200 { count, network, asset, payTo, tools[] }
 *   GET /api/x402/<paid>    → 402 { accepts: [{ amount, asset, payTo, … }], tool }
 *   GET /api/x402/<free>    → 200 { free: true, price: "$0.00", tool }
 *   GET /api/x402/<gone>    → 501 { code: "TOOL_UNAVAILABLE", hint }
 * That fourth case is real, but not for the reason first assumed here. Quoting all
 * 115 listed ids that day returned 109 paid, 6 free and 0 dead — a listed id is a
 * callable id. `honeypot` answers 501 because it is NOT in the list, while its hint
 * claims the opposite ("exists in the public catalog"). So this repeats the hint
 * without adopting its claim: an agent handed a phantom id must hear that nothing
 * implements it, not that it is momentarily down and worth a retry.
 * Re-measure before trusting these; do not treat them as fixed.
 */

import { readFileSync } from "node:fs";

const MANIFEST = JSON.parse(readFileSync(new URL("./tools.json", import.meta.url), "utf8"));

const PROTOCOL_VERSION = "2024-11-05";
const TIMEOUT_MS = 20_000;

/**
 * Where the two public reads go. Overridable on the command line, and
 * deliberately not through the environment — this file reads no environment
 * variable at all and a test asserts that, so adding one here would break the
 * guarantee for a convenience.
 *
 * It has two real uses: pointing at a preview deployment, and pointing the tests
 * at a fixture server so the shapes upstream can answer with are checked instead
 * of assumed. It only ever GETs and it holds no key, so the worst a wrong URL can
 * do is produce wrong text.
 */
const UPSTREAM = upstream(process.argv) ?? "https://blueagent.dev";

function upstream(argv) {
  const at = argv.indexOf("--upstream");
  const value = at === -1 ? argv.find((a) => a.startsWith("--upstream=")) : argv[at + 1];
  if (!value) return null;
  return value.replace(/^--upstream=/, "").replace(/\/+$/, "");
}

/* ── the offline tools ────────────────────────────────────────────────────── */

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ALL_HOOK_BITS = 14;
const NOT_AN_ADDRESS = "That is not an address. Paste a 20-byte 0x… hook address.";

function readHook(args) {
  const address = String(args.address ?? "").trim();
  if (!ADDRESS.test(address)) throw new Error(NOT_AN_ADDRESS);

  const bits = BigInt(address) & ((1n << BigInt(ALL_HOOK_BITS)) - 1n);
  const rows = MANIFEST.hookPermissions.map((p) => ({
    ...p,
    granted: (bits & (1n << BigInt(p.bit))) !== 0n,
  }));
  const granted = rows.filter((r) => r.granted);

  return [
    granted.length === 0
      ? `${address} carries no hook permissions. The pool will not call it at any point.`
      : `${address} — the pool will call this hook at ${granted.length} of ${ALL_HOOK_BITS} points.`,
    "",
    ...rows.map((r) => `${r.granted ? "ON " : "off"} ${r.name} — ${r.means}`),
    "",
    "These bits say which callbacks run, never what they do. A hook with one permission can still take everything in the swap.",
  ].join("\n");
}

/** Digits and at most one dot. Mirrors `DECIMAL` in src/lib/amount.ts. */
const DECIMAL = /^\d*\.?\d*$/;
const WHOLE = /^\d+$/;

function assertDecimals(decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`decimals must be an integer in 0..36, got ${decimals}.`);
  }
}

function parseAmount(input, decimals) {
  assertDecimals(decimals);

  const text = String(input).trim();
  if (!text || text === ".") throw new Error("Enter an amount.");
  if (!DECIMAL.test(text)) throw new Error(`"${input}" is not a plain decimal number.`);

  const [whole = "", fraction = ""] = text.split(".");
  if (fraction.length > decimals) {
    throw new Error(
      `This token has ${decimals} decimals, so ${fraction.length} decimal places cannot be represented. Nothing was rounded.`,
    );
  }

  return BigInt(`${whole || "0"}${fraction.padEnd(decimals, "0")}`);
}

function formatAmount(value, decimals) {
  assertDecimals(decimals);
  if (value < 0n) throw new Error("Amount cannot be negative.");
  if (decimals === 0) return value.toString();

  const unit = 10n ** BigInt(decimals);
  const fraction = (value % unit)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");

  return fraction ? `${value / unit}.${fraction}` : (value / unit).toString();
}

function convertAmount(args) {
  const { value, decimals, to } = args;
  if (to !== "base" && to !== "human") {
    throw new Error(`"to" must be "base" or "human", not ${JSON.stringify(to)}.`);
  }
  if (typeof decimals !== "number") {
    throw new Error("Pass the token's own decimals as a number. Read it from the token.");
  }

  if (to === "base") {
    const units = parseAmount(value, decimals);
    return `${value} with ${decimals} decimals is exactly ${units} base units.`;
  }

  const text = String(value).trim();
  if (!WHOLE.test(text)) throw new Error(`"${value}" is not a whole number of base units.`);
  return `${text} base units with ${decimals} decimals is exactly ${formatAmount(BigInt(text), decimals)}.`;
}

function status() {
  const { chain, contracts, limits } = MANIFEST.build;
  return [
    `Quadra ${MANIFEST.server.version}${MANIFEST.server.published ? "" : " — not published yet"}`,
    `Chain: ${chain.name} ${chain.id}, and only that one.`,
    "",
    "Its own contracts:",
    ...Object.entries(contracts).map(([name, addr]) => `  ${name}: ${addr ?? "not deployed"}`),
    "",
    "What it cannot do:",
    ...limits.map((l) => `  - ${l}`),
  ].join("\n");
}

/* ── the two public reads ─────────────────────────────────────────────────── */

async function getJson(url) {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: res.status, body: await res.json() };
}

async function listTools() {
  const { body } = await getJson(`${UPSTREAM}/api/catalog`);
  const tools = body.tools ?? [];
  return [
    `${tools.length} tools upstream on ${body.network}, paid in USDC to ${body.payTo}.`,
    "One line each: id, price, category. Call quadra_quote_tool with an id for its inputs and its exact price in base units.",
    "",
    ...tools.map((t) => `${t.id}  ${t.price}  ${t.category}`),
  ].join("\n");
}

async function quoteTool(args) {
  const toolId = String(args.toolId ?? "").trim();
  if (!toolId) throw new Error("Pass a tool id. quadra_list_tools has them all.");

  const { status: code, body } = await getJson(`${UPSTREAM}/api/x402/${encodeURIComponent(toolId)}`);

  if (code === 501 || body.code === "TOOL_UNAVAILABLE") {
    return `Nothing upstream implements ${toolId}, so it is not callable: ${body.hint ?? body.error}. Nothing to pay, and retrying will not help. Check quadra_list_tools for the live id — this one may be a renamed or dropped name.`;
  }
  if (body.free === true) {
    return `${toolId} is free. ${body.hint ?? "No payment, no wallet."}\n\nInputs: ${JSON.stringify(body.tool?.input ?? {})}`;
  }

  const accept = body.accepts?.[0];
  if (!accept) {
    return `${toolId} answered ${code} but named no price. Raw: ${JSON.stringify(body).slice(0, 400)}`;
  }

  return [
    `${toolId} costs ${accept.amount} base units of ${accept.asset} on ${accept.network}, paid to ${accept.payTo}.`,
    `Upstream labels that ${body.tool?.price ?? "unlabelled"}. The 402 does not carry the asset's decimals, so nothing here converts base units into dollars — that label is upstream's own.`,
    "",
    `Inputs: ${JSON.stringify(body.tool?.input ?? {})}`,
    "",
    "This is the quote only. Paying it needs a wallet, which this server does not have.",
  ].join("\n");
}

/* ── dispatch ─────────────────────────────────────────────────────────────── */

const IMPL = {
  quadra_read_hook: readHook,
  quadra_amount: convertAmount,
  quadra_status: status,
  quadra_list_tools: listTools,
  quadra_quote_tool: quoteTool,
};

async function callTool(name, args) {
  const impl = IMPL[name];
  if (!impl) {
    const known = Object.keys(IMPL).join(", ");
    return { content: [{ type: "text", text: `No tool called ${name}. There are: ${known}.` }], isError: true };
  }
  try {
    return { content: [{ type: "text", text: await impl(args ?? {}) }] };
  } catch (e) {
    return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
  }
}

/**
 * `reach` is ours, not MCP's, so it is stripped here rather than sent. The panel
 * uses it to say which tools touch the network; a client has no use for it.
 */
function advertised() {
  return MANIFEST.tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
}

async function handle(msg) {
  switch (msg.method) {
    case "initialize":
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: MANIFEST.server.name, version: MANIFEST.server.version },
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: advertised() };
    case "tools/call":
      return await callTool(msg.params?.name, msg.params?.arguments);
    default:
      return null;
  }
}

/* ── stdio framing ────────────────────────────────────────────────────────── */

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

/**
 * A notification has no id and must never be answered. Replying to one is the
 * mistake that makes a client hang up: `notifications/initialized` arrives right
 * after the handshake, and an answer to it is an unmatched response.
 */
async function receive(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }

  const result = await handle(msg);
  if (msg.id === undefined || msg.id === null) return;

  if (result === null) {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: `Method not found: ${msg.method}` },
    });
    return;
  }
  send({ jsonrpc: "2.0", id: msg.id, result });
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let cut = buffer.indexOf("\n");
  while (cut !== -1) {
    const line = buffer.slice(0, cut).trim();
    buffer = buffer.slice(cut + 1);
    if (line) void receive(line);
    cut = buffer.indexOf("\n");
  }
});
