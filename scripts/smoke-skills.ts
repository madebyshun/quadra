/**
 * Run skills against the LIVE chain and print their reports. Hand-run only — it hits the
 * network, which the test suite never does (see tests/setup.ts).
 *
 *   npm run smoke -- "radar 20" "verdict 0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed"
 *
 * Each argument is one Terminal line. Use it to measure a source's real answer before
 * writing or changing a parser — CLAUDE.md's "a protocol rule measured against one server
 * is a sample of one" is the reason this exists.
 */
import { parseLine, reportText } from "@/skills";

for (const line of process.argv.slice(2)) {
  const parsed = parseLine(line);
  if (parsed.kind !== "run") {
    console.log(`${line} => ${parsed.kind}`);
    continue;
  }
  const started = Date.now();
  try {
    console.log(`${reportText(await parsed.skill.run(parsed.args))}\n  (${Date.now() - started} ms)\n`);
  } catch (e) {
    console.log(`>> ${line}\n!! ${(e as Error).message}\n`);
  }
}
