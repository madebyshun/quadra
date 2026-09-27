import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { BRAND } from "@/brand";

// process.cwd() is the vite root. `import.meta.url` is not a file: url under
// the jsdom environment, so URL-relative resolution silently yields "/src".
const ROOT = resolve(process.cwd());
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const sources = walk(SRC).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));

describe("BRAND is internally consistent", () => {
  it("derives the slug from the name", () => {
    expect(BRAND.slug).toBe(BRAND.name.toLowerCase());
  });

  it("derives the ticker from the name", () => {
    expect(BRAND.ticker).toBe(`$${BRAND.name.toUpperCase()}`);
  });

  it("keeps the slug url and package safe", () => {
    expect(BRAND.slug).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("namespaces the note prefix and versions it", () => {
    expect(BRAND.notePrefix.startsWith(BRAND.slug)).toBe(true);
    expect(BRAND.notePrefix).toMatch(/-v\d+:$/);
  });

  it("names the mcp server and tool prefix after the slug", () => {
    expect(BRAND.mcpServer).toBe(BRAND.slug);
    expect(BRAND.toolPrefix).toBe(BRAND.slug);
  });

  it("uses a domain, not a url", () => {
    expect(BRAND.domain).not.toMatch(/^https?:/);
    expect(BRAND.domain).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
  });

  it("keeps the blurb short enough for a link preview", () => {
    expect(BRAND.blurb.length).toBeLessThanOrEqual(160);
  });

  it("states what it does rather than announcing that it is honest", () => {
    const cheap = /\b(no hallucinat|never fake|real data|we don't lie|trustless)\b/i;
    expect(BRAND.tagline).not.toMatch(cheap);
    expect(BRAND.blurb).not.toMatch(cheap);
  });

  it("names the chain in the pitch, since a claim without one is unverifiable", () => {
    expect(BRAND.tagline).toContain("Base");
  });
});

/**
 * brand.ts claims to be the only file that knows the product's name. This is
 * the check that makes the claim true. It caught a real leftover: after the
 * Phosphor → Quadra rename, config/chain.ts still said "$PHOS, once launched".
 */
describe("brand.ts is the single rename point", () => {
  const others = sources.filter((f) => !f.endsWith("/brand.ts"));
  const rel = (f: string) => f.replace(ROOT, "");

  it("is the only source file containing the product name", () => {
    const offenders = others.filter((f) => readFileSync(f, "utf8").includes(BRAND.name));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("is the only source file containing the ticker", () => {
    // Caught a real one: config/pair.ts hardcoded "QUADRA" as LAUNCH_PAIR.base,
    // a runtime value the lowercase check above cannot see.
    const bare = BRAND.ticker.replace("$", "");
    const offenders = others.filter((f) => {
      const text = readFileSync(f, "utf8");
      return text.includes(BRAND.ticker) || text.includes(bare);
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it("leaves no trace of a previous name anywhere in the repo's own files", () => {
    /**
     * Case-sensitive on purpose. "phosphor" lower-case is the real name of the
     * coating on a CRT and is used correctly in Crt.tsx and theme.css; capital
     * "Phosphor" was the discarded product name. An /i flag here erases exactly
     * the distinction the check exists to make, and reports two false positives.
     */
    const stale = /\$PHOS\b|\bPhosphor\b|supercompute/;
    const files = [
      ...sources,
      join(SRC, "styles/theme.css"),
      join(SRC, "styles/reset.css"),
      join(ROOT, "index.html"),
      join(ROOT, "package.json"),
      join(ROOT, ".env.example"),
    ];
    const offenders = files.filter((f) => stale.test(readFileSync(f, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("still catches the discarded name if it comes back as a brand", () => {
    const stale = /\$PHOS\b|\bPhosphor\b|supercompute/;
    expect(stale.test("token: $PHOS")).toBe(true);
    expect(stale.test("Phosphor pairs against AAPLc")).toBe(true);
    expect(stale.test("/** The phosphor panel */")).toBe(false);
  });
});
