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

/**
 * The other direction, and the one that costs money.
 *
 * The describe above pins that no user-visible string hardcodes the brand. This one
 * pins the opposite: four strings are **identifiers in data that already exists** and
 * must keep their shipped value through a rename. `brand.ts` lists them and says why.
 * The danger is that its own header invites the mistake — a reader who greps for the
 * slug, finds these, and "finishes the rename" by templating them from `BRAND.slug`
 * makes every existing pool invisible, every existing note unspendable, and every
 * existing backup un-importable.
 *
 * 🔴 **This has to be a textual check, and that is a MEASURED conclusion rather than a
 * preference.** The intuitive guard is a pinned output vector — assert the hash of a
 * known input, assert the store key's value — and `tests/hash.test.ts` and
 * `tests/adapters.test.ts` both now carry one. Neither catches this. The mutation was
 * applied (`` `quadra.v1.${domain}` `` → `` `${BRAND.slug}.v1.${domain}` ``) and **all
 * 722 tests passed**, because `BRAND.slug` is `"quadra"` today: the template expands to
 * a byte-identical string, so no output moves and nothing can observe the change. The
 * defect is dormant until someone edits `brand.ts`, at which point the commit that
 * introduced it is long merged and the symptom is "all my money is gone".
 *
 * A dormant defect can only be caught by its shape, not by its behaviour. Hence: read
 * the source, require the literal.
 */
describe("the strings a rename must NOT touch stay literal", () => {
  /**
   * Each entry is the exact source text that must be present. Not a regex and not a
   * `.includes("quadra")` — the whole failure mode is a string that still *contains*
   * the slug while no longer being frozen, so anything looser passes the mutation.
   */
  const frozen = [
    {
      file: "src/lib/hash.ts",
      literal: "`quadra.v1.${domain}`",
      what: "the hash domain tag, mixed into every commitment and nullifier",
    },
    {
      file: "src/adapters/local/store.ts",
      literal: '"quadra.pool.v1"',
      what: "the localStorage key every existing pool is stored under",
    },
    {
      file: "src/lib/backup.ts",
      literal: '"quadra.pool.backup.v1"',
      what: "the format tag matched against backup files already on disk",
    },
  ] as const;

  /**
   * Comments stripped before either check, and the reason is not tidiness.
   *
   * Each of these three literals sits directly under a comment that quotes the
   * forbidden interpolated form in order to warn against it — which is exactly the
   * documentation you want, and it made the first version of the negative check below
   * fail on `store.ts` and `backup.ts`. The check has to tell prose from code, which is
   * the same distinction this whole describe is about.
   *
   * Stripping also *strengthens* the positive check, rather than merely unblocking the
   * negative one: "the literal is somewhere in the file" is satisfied by a file that
   * only mentions it in a comment while the code interpolates. Against stripped source
   * it means the literal is in the code.
   *
   * ⚠️ Regex comment-stripping is not a parser. Line comments are only stripped when
   * they start a line, so a `https://` inside a string cannot be eaten. The positive
   * check doubles as the sanity check on this function: if stripping ever mangles one
   * of these files, the literal goes missing and that test fails by name.
   */
  function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  }

  const code = new Map(
    frozen.map(({ file }) => [file, withoutComments(readFileSync(join(ROOT, file), "utf8"))]),
  );

  frozen.forEach(({ file, literal, what }) => {
    it(`keeps ${what} as a literal in ${file}`, () => {
      expect(code.get(file)).toContain(literal);
    });
  });

  /**
   * The pair to the three above, because presence alone is not enough: a file could
   * keep the old literal as a dead export and interpolate the one actually in use.
   */
  frozen.forEach(({ file }) => {
    it(`does not build a frozen identifier from the brand in ${file}`, () => {
      /** Any `${BRAND...}` sitting in front of a frozen version or namespace part. */
      expect(code.get(file)).not.toMatch(/\$\{BRAND\.\w+\}\.(v1|pool)/);
    });
  });

  /**
   * The checks can fail, demonstrated on the exact mutation the pinned vectors missed.
   * Without this, three passing assertions about absence would be indistinguishable
   * from a regex that matches nothing.
   */
  it("would catch the templated domain tag that the pinned vectors missed", () => {
    const mutated = "return new TextEncoder().encode(`${BRAND.slug}.v1.${domain}`);";
    expect(mutated).not.toContain("`quadra.v1.${domain}`");
    expect(mutated).toMatch(/\$\{BRAND\.\w+\}\.(v1|pool)/);
  });

  /** And that it is not so broad it would reject the brand used for prose. */
  it("still allows the brand in a user-visible string", () => {
    const fine = "throw new Error(`That file is not a ${BRAND.name} backup.`);";
    expect(fine).not.toMatch(/\$\{BRAND\.\w+\}\.(v1|pool)/);
  });
});
