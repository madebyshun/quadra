/**
 * Fail if any contract under `contracts/src/` is below 100% coverage.
 *
 * ── Why this is a script and not a config flag ───────────────────────────────
 * `forge coverage` prints a table and exits 0 no matter how bad the numbers are.
 * There is no `--fail-under`. So the only way coverage can be a gate rather than a
 * report is to parse it, and the only way it stays a gate is if something runs the
 * parse. Hence this file.
 *
 * ── Why `src/` only, and why that is not a loophole ──────────────────────────
 * The doubles in `contracts/test/` (a recipient that refuses ETH, one that re-enters) are
 * deliberately NOT held to 100%, and neither are the libraries in `contracts/lib/` (base-std,
 * Uniswap v4) — those are measured by their own authors. `src/` is the part that holds other
 * people's liquidity and fees. That is where the number has to be 100.
 *
 * Revived 2026-10-02 for the launchpad (it first guarded the archived shielded pool).
 *
 * ── Why this is not in `npm run gate` ────────────────────────────────────────
 * The gate must run on a bare clone with nothing installed and no network. This
 * needs Base Foundry (`base-forge`). Keeping them separate is what lets `npm run gate` stay the thing
 * you can always run; `npm run gate:contracts` is the thing you run when you have
 * touched Solidity. Both are required before a deploy — see contracts/README.md.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTRACTS = join(REPO_ROOT, "contracts");

/** The metrics lcov reports, and the label each gets in the failure message. */
const METRICS = [
  { key: "lines", label: "lines" },
  { key: "functions", label: "functions" },
  { key: "branches", label: "branches" },
] as const;

type Metric = (typeof METRICS)[number]["key"];

interface FileCoverage {
  readonly path: string;
  readonly hit: Record<Metric, number>;
  readonly total: Record<Metric, number>;
}

/**
 * Locate `base-forge` — Base's build of Foundry, the one that knows the B20 precompile. Stock
 * `forge` compiles these contracts but every test that launches a token aborts with
 * "call to non-contract address".
 *
 * `~/.foundry/bin` is where `foundryup` puts it and is frequently missing from a
 * non-interactive shell's PATH, which produces a confusing "command not found" for
 * a tool the developer can clearly run in their terminal. Checking both and saying
 * which one was tried is cheaper than the round of debugging that otherwise
 * follows.
 */
function resolveForge(): string {
  const home = process.env.HOME ?? "";
  const candidates = [join(home, ".foundry", "bin", "base-forge")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return "base-forge";
}

function parseLcov(text: string): FileCoverage[] {
  const files: FileCoverage[] = [];
  let path: string | null = null;
  let hit: Record<Metric, number> = { lines: 0, functions: 0, branches: 0 };
  let total: Record<Metric, number> = { lines: 0, functions: 0, branches: 0 };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      path = line.slice(3);
      hit = { lines: 0, functions: 0, branches: 0 };
      total = { lines: 0, functions: 0, branches: 0 };
      continue;
    }
    if (path === null) continue;

    // LH/LF = lines hit/found, FNH/FNF = functions, BRH/BRF = branches.
    const pairs: ReadonlyArray<readonly [string, Metric, "hit" | "total"]> = [
      ["LH:", "lines", "hit"],
      ["LF:", "lines", "total"],
      ["FNH:", "functions", "hit"],
      ["FNF:", "functions", "total"],
      ["BRH:", "branches", "hit"],
      ["BRF:", "branches", "total"],
    ];
    for (const [prefix, metric, which] of pairs) {
      if (!line.startsWith(prefix)) continue;
      const value = Number(line.slice(prefix.length));
      if (Number.isNaN(value)) continue;
      if (which === "hit") hit[metric] = value;
      else total[metric] = value;
    }

    if (line === "end_of_record") {
      files.push({ path, hit: { ...hit }, total: { ...total } });
      path = null;
    }
  }
  return files;
}

function main(): void {
  if (!existsSync(join(CONTRACTS, "foundry.toml"))) {
    console.error("no contracts/foundry.toml — nothing to check");
    process.exit(1);
  }

  const forge = resolveForge();
  const workDir = mkdtempSync(join(tmpdir(), "contracts-cov-"));
  const report = join(workDir, "lcov.info");

  try {
    execFileSync(forge, ["coverage", "--report", "lcov", "--report-file", report, "--no-match-coverage", "(test|lib)"], {
      cwd: CONTRACTS,
      stdio: ["ignore", "ignore", "inherit"],
    });
  } catch {
    console.error(
      `\n✗ \`${forge} coverage\` failed. Install Base Foundry (docs.base.org/sdks/base-anvil) or fix the ` +
        `failing tests first — this script only grades a suite that already passes.`,
    );
    rmSync(workDir, { recursive: true, force: true });
    process.exit(1);
  }

  const lcov = readFileSync(report, "utf8");
  rmSync(workDir, { recursive: true, force: true });

  const graded = parseLcov(lcov).filter((f) => f.path.startsWith("src/"));

  if (graded.length === 0) {
    console.error(
      "✗ coverage report contained no files under contracts/src/. That is not a pass — " +
        "either the report format changed or nothing was measured.",
    );
    process.exit(1);
  }

  const failures: string[] = [];
  for (const file of graded) {
    for (const { key, label } of METRICS) {
      const { [key]: hit } = file.hit;
      const { [key]: total } = file.total;
      // A file with no branches at all reports 0/0, which is complete, not empty.
      if (total === 0) continue;
      if (hit < total) {
        const pct = ((hit / total) * 100).toFixed(2);
        failures.push(`  ${file.path}  ${label}: ${pct}% (${hit}/${total})`);
      }
    }
  }

  if (failures.length > 0) {
    console.error("\n✗ contracts/src is not fully covered:\n");
    console.error(failures.join("\n"));
    console.error(
      "\nThese contracts hold other people's liquidity. An uncovered branch in one of them is a " +
        "path nobody has ever executed.\n",
    );
    process.exit(1);
  }

  console.log(`✓ contracts/src fully covered (${graded.length} files, lines/functions/branches)`);
}

main();
