/**
 * Re-measure the live catalog, and report where this repo's copy of it has drifted.
 *
 * ── Why this is a script and not a test ──────────────────────────────────────────
 * `tests/setup.ts` makes `fetch` throw, on purpose: a suite that reaches the network
 * passes or fails on someone else's uptime, and a panel that catches its own load
 * failure would keep passing on a plane while asserting nothing. So the 458 tests
 * prove the parser handles the shapes it was shown, and cannot prove those are the
 * shapes upstream still sends. This closes exactly that gap, and is run by hand:
 *
 *     npx vite-node scripts/measure-catalog.ts
 *
 * ── The three things it checks ───────────────────────────────────────────────────
 * 1. Every listed id parses and quotes. A tool with a missing `name`, an unfamiliar
 *    asset, or a fractional amount throws in `HttpCatalog`, and three fixtures cannot
 *    discover that — only all 115 can. First run found 115/115 clean.
 * 2. `LOCAL_TOOLS` still matches upstream, field by field. That list is the offline
 *    stub every panel test mounts against, which makes it a CLAIM about upstream: if
 *    a price or a field name drifts, the UI is tested against a form real users never
 *    see. It was invented once and was wrong in every column — ids upstream does not
 *    have, a 2x price error, field names no tool declares — and nothing caught it
 *    because a stub is the one thing a test suite cannot contradict.
 * 3. A POST still answers the way `HttpCatalog.run` branches on it: 200 with a JSON
 *    body for a free id, 402 for a paid one. Those two shapes are stubbed in the
 *    suite, so the suite would keep passing if upstream started sending a third.
 *    Safe to run: with no `X-PAYMENT` header a paid id cannot charge, and the free
 *    ids cost nothing by definition — nothing here holds a key or signs anything.
 *
 * Exits non-zero on any of them, so it can be wired into a release check later. It is
 * deliberately NOT in `npm run gate`; the gate must stay runnable offline.
 */

import { HttpCatalog, parseFields } from "@/adapters/http/catalog";
import { LOCAL_TOOLS } from "@/adapters/local/catalog";
import { BLUEAGENT } from "@/config/upstream";
import type { ToolField } from "@/adapters/types";

type RawTool = {
  id: string;
  name: string;
  priceUsdcUnits: number;
  input?: unknown;
};

const problems: string[] = [];
const note = (line: string) => problems.push(line);

async function liveRaw(): Promise<Map<string, RawTool>> {
  const res = await fetch(BLUEAGENT.catalog, { headers: { accept: "application/json" } });
  const body = (await res.json()) as { tools: RawTool[] };
  return new Map(body.tools.map((t) => [t.id, t]));
}

function sameFields(mine: readonly ToolField[], theirs: readonly ToolField[]): boolean {
  if (mine.length !== theirs.length) return false;
  return mine.every((f, i) => f.name === theirs[i]?.name && f.required === theirs[i]?.required);
}

const show = (fields: readonly ToolField[]) =>
  fields.map((f) => `${f.name}${f.required ? "" : "?"}`).join(", ") || "(none)";

const catalog = new HttpCatalog();

// 1. every id parses, and every id quotes
const tools = await catalog.tools();
console.log(`parsed ${tools.length} tools`);
console.log(`  no inputs:     ${tools.filter((t) => t.inputs.length === 0).length}`);
console.log(`  has optional:  ${tools.filter((t) => t.inputs.some((f) => !f.required)).length}`);

let paid = 0;
let free = 0;
for (const tool of tools) {
  try {
    const quote = await catalog.quote(tool.id);
    if (quote.price.kind === "free") free++;
    else paid++;
  } catch (e) {
    note(`${tool.id} is listed but did not quote: ${e instanceof Error ? e.message : String(e)}`);
  }
}
console.log(`quoted ${paid} paid, ${free} free, ${problems.length} refused`);

// 2. the offline stub still matches what it claims to be a subset of
const raw = await liveRaw();
for (const mine of LOCAL_TOOLS) {
  const theirs = raw.get(mine.id);
  if (!theirs) {
    note(`LOCAL_TOOLS has "${mine.id}", which the live catalog does not list.`);
    continue;
  }
  if (mine.title !== theirs.name) {
    note(`${mine.id} title: stub says "${mine.title}", upstream says "${theirs.name}".`);
  }
  if (mine.priceBaseUnits !== BigInt(theirs.priceUsdcUnits)) {
    note(`${mine.id} price: stub says ${mine.priceBaseUnits}, upstream says ${theirs.priceUsdcUnits}.`);
  }
  const live = parseFields(theirs.input);
  if (!sameFields(mine.inputs, live)) {
    note(`${mine.id} inputs: stub has ${show(mine.inputs)}, upstream has ${show(live)}.`);
  }
}

/**
 * 3. a POST still answers in one of the two shapes `run` knows how to read
 *
 * Direct to upstream, not through `FORWARD`: there is no browser here and so no CORS
 * to route around. What is being measured is upstream's answer, which is the same
 * either way — the forwarder changes who asks, not what comes back.
 */
let ran = 0;
let quoted402 = 0;
let skipped = 0;
for (const tool of tools) {
  const price = (await catalog.quote(tool.id)).price;

  /**
   * A free id with a required field cannot be exercised from here, and the first run
   * of this check reported that as drift: `rh-rwa-verify` and `rh-token-scan` both
   * demand a `contract`, so an empty body earns a 400 saying so. The fix is not to
   * make one up — a fabricated contract address is the one thing this repo will not
   * write — so these are counted as unexercised rather than quietly passed or
   * miscounted as broken. Their 400 is the reason `run` now repeats upstream's own
   * sentence instead of just the status: it names the field, and the status does not.
   */
  if (price.kind === "free" && tool.inputs.some((f) => f.required)) {
    skipped++;
    continue;
  }
  const res = await fetch(BLUEAGENT.tool(tool.id), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({}),
  });
  const text = await res.text();
  const parses = (() => {
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  })();

  if (!parses) {
    note(`${tool.id} POST answered ${res.status} with a body that is not JSON.`);
    continue;
  }
  if (price.kind === "free") {
    // A free id that stops answering 200 makes the one runnable half of the catalog
    // unrunnable, and `run` would report it as an upstream error rather than a change.
    if (res.status === 200) ran++;
    else note(`${tool.id} quotes free but POST answered ${res.status}, not 200.`);
  } else {
    // 402 is what `run` turns into NO_WALLET. A 200 here would mean a tool that
    // quotes a price answers without being paid, and the panel would call it free.
    if (res.status === 402) quoted402++;
    else note(`${tool.id} quotes paid but POST answered ${res.status}, not 402.`);
  }
}
console.log(
  `posted ${ran} free runs that answered, ${quoted402} paid ids that asked for payment, ${skipped} free ids not exercised (they require an input this script will not invent)`,
);

if (problems.length > 0) {
  console.error(`\n${problems.length} drift(s):`);
  for (const line of problems) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`\nno drift: all ${LOCAL_TOOLS.length} stub tools match upstream.`);
