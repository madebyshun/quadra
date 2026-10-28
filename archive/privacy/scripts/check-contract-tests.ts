/**
 * Fail if the suite table in `contracts/README.md` disagrees with the suite that
 * actually ran.
 *
 * ── Why a test count deserves a guard when coverage already has one ───────────
 * It looks redundant: `check-contract-coverage.ts` already fails if anything under
 * `src/` drops below 100%, so surely a deleted test shows up there? Only sometimes.
 * Coverage measures which *lines* were executed, not how many ways. Delete ten of
 * the seventeen `SafeTransfer` tests and the remaining seven still touch every line
 * of `SafeTransfer.sol` — coverage stays green and the README goes on claiming "one
 * test per real-world token misbehaviour" while most of those tokens are no longer
 * tested. That claim is the reason the file is trustworthy, and it is exactly the
 * kind of claim coverage cannot check.
 *
 * So the number is not decoration. It is the count of distinct behaviours somebody
 * asserted, and the only thing that can notice it falling is something that counts.
 *
 * ── Why the README, and why only there ───────────────────────────────────────
 * The count used to appear in six places across four files and was stale in all six
 * (they said 90; the real number was 104). Six copies of a fact is not six times the
 * documentation, it is one fact and five opportunities to be wrong. Everything else
 * now describes the property and points here, so there is one authoritative table,
 * and this script is what makes it authoritative.
 *
 * Per-suite rather than a single total, because a total hides the interesting
 * change: 104 stays 104 when you delete twelve `SafeTransfer` tests and add twelve
 * to `ShieldedPool`.
 *
 * ── Why zero suites is a failure and not a pass ──────────────────────────────
 * MEASURED 2026-09-28, both ways forge can run nothing while **exiting 0**:
 *
 *   wrong directory   `forge test --json` from the repo root  → `Nothing to compile`
 *   nothing matched   `--match-path test/NoSuchFile.t.sol`    → `No tests found in project!`
 *
 * The first happens because the repo root has no `foundry.toml`, so forge treats the
 * TypeScript `src/` as an empty Solidity project. A gate that trusted that exit code
 * would be green having verified nothing.
 *
 * Note what the measurement says about *which* guard below catches it: in both cases
 * forge emits **no JSON object at all**, so the `start === -1` branch is the one that
 * fires, and it is the one verified. The later `actual.size === 0` check is
 * defence-in-depth against a future forge that emits a bare `{}` — today unreachable,
 * kept because the failure it prevents is a silent pass. `cwd` is pinned for the same
 * reason the coverage script pins it.
 *
 * ── Why this is not in `npm run gate` ────────────────────────────────────────
 * Same reason as the coverage script: `npm run gate` has to run on a bare clone
 * with nothing installed and no network, and this needs Foundry. Both gates are
 * required before a deploy.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTRACTS = join(REPO_ROOT, "contracts");
const README = join(CONTRACTS, "README.md");

/** Same resolution as the coverage script: `foundryup` installs outside a script's PATH. */
function resolveForge(): string {
  const home = process.env.HOME ?? "";
  const candidates = [join(home, ".foundry", "bin", "forge")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return "forge";
}

/**
 * `forge test --json` emits one object keyed by `<path>:<ContractName>`, each with a
 * `test_results` map of test name to result. The count of that map is the number of
 * test functions in the suite, which is what the README table states.
 *
 * Only the file name is kept. The contract name is redundant with it here (one test
 * contract per file) and pinning both would make renaming the contract a README edit
 * for no gain.
 */
function runCounts(): Map<string, number> {
  const forge = resolveForge();
  let raw: string;
  try {
    raw = execFileSync(forge, ["test", "--json"], {
      cwd: CONTRACTS,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    console.error(
      `\n✗ \`${forge} test --json\` failed. Install Foundry (https://getfoundry.sh) or fix the ` +
        `failing tests first — this script only counts a suite that already passes.`,
    );
    process.exit(1);
  }

  // forge prints build chatter ("Nothing to compile") on stdout ahead of the JSON,
  // so the object has to be sliced out rather than parsed from byte zero.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    console.error(
      "✗ `forge test --json` produced no JSON object. It printed:\n\n" +
        `${raw.trim() || "(nothing)"}\n\n` +
        "If that says \"Nothing to compile\", forge ran against the wrong directory and " +
        "tested nothing while exiting 0.",
    );
    process.exit(1);
  }

  const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
  if (typeof parsed !== "object" || parsed === null) {
    console.error("✗ `forge test --json` did not return an object.");
    process.exit(1);
  }

  const counts = new Map<string, number>();
  for (const [suiteKey, body] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof body !== "object" || body === null) continue;
    const { test_results: results } = body as { test_results?: unknown };
    if (typeof results !== "object" || results === null) continue;
    // "test/ShieldedPool.t.sol:ShieldedPoolTest" -> "ShieldedPool.t.sol"
    const [path = ""] = suiteKey.split(":");
    const [file = path] = path.split("/").slice(-1);
    counts.set(file, Object.keys(results as Record<string, unknown>).length);
  }
  return counts;
}

/**
 * Pull `| \`Name.t.sol\` | 25 | ... |` rows out of the README.
 *
 * Deliberately keyed off the backticked `.t.sol` filename rather than the table's
 * position in the document, so the table can be moved or reworded without this
 * script caring, and so a row cannot be hidden from the check by rewriting the
 * heading above it.
 */
function documentedCounts(text: string): Map<string, number> {
  const rows = new Map<string, number>();
  const rowPattern = /^\|\s*`([A-Za-z0-9_]+\.t\.sol)`\s*\|\s*(\d+)\s*\|/gm;
  for (const match of text.matchAll(rowPattern)) {
    const [, file, count] = match;
    if (file === undefined || count === undefined) continue;
    rows.set(file, Number(count));
  }
  return rows;
}

function main(): void {
  if (!existsSync(join(CONTRACTS, "foundry.toml"))) {
    console.error("no contracts/foundry.toml — nothing to check");
    process.exit(1);
  }

  const actual = runCounts();
  if (actual.size === 0) {
    console.error(
      "✗ `forge test --json` reported no test suites at all. That is not a pass — forge " +
        "exits 0 when it finds nothing to run.",
    );
    process.exit(1);
  }

  const documented = documentedCounts(readFileSync(README, "utf8"));
  if (documented.size === 0) {
    console.error(
      "✗ contracts/README.md has no suite table rows matching | `Name.t.sol` | <count> |. " +
        "Either the table was removed or its shape changed; this check cannot pass vacuously.",
    );
    process.exit(1);
  }

  const failures: string[] = [];

  for (const [file, count] of [...actual].sort(([a], [b]) => a.localeCompare(b))) {
    const claimed = documented.get(file);
    if (claimed === undefined) {
      failures.push(
        `  ${file} ran ${count} tests and is not in the README table — a new suite has to say ` +
          `what it is for, or nobody reading the table knows it exists.`,
      );
    } else if (claimed !== count) {
      const direction = count > claimed ? "added" : "removed";
      failures.push(`  ${file}: README says ${claimed}, ${count} ran (${direction})`);
    }
  }

  for (const file of documented.keys()) {
    if (!actual.has(file)) {
      failures.push(`  ${file} is in the README table but ran no tests — deleted or renamed?`);
    }
  }

  if (failures.length > 0) {
    const total = [...actual.values()].reduce((sum, n) => sum + n, 0);
    console.error("\n✗ contracts/README.md disagrees with the suite that ran:\n");
    console.error(failures.join("\n"));
    console.error(
      `\nThe table is the only place this repo states these counts, which is why it is checked. ` +
        `Update it (${total} tests total) — and if a count went DOWN, say in the commit message ` +
        `which behaviour stopped being asserted, because coverage will not tell you.\n`,
    );
    process.exit(1);
  }

  const total = [...actual.values()].reduce((sum, n) => sum + n, 0);
  console.log(`✓ contracts/README.md matches the suite (${actual.size} suites, ${total} tests)`);
}

main();
