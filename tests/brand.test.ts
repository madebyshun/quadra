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

  /**
   * `index.html` is static and cannot import `brand.ts`, so the page's own description
   * and link preview are copies. They had drifted into describing a product with swaps,
   * a router and MCP tools as its headline; this keeps the copies equal to the source.
   */
  it("serves the same pitch in index.html that the app shows", () => {
    const html = readFileSync(join(ROOT, "index.html"), "utf8");
    expect(html).toContain(`name="description"\n      content="${BRAND.tagline}"`);
    expect(html).toContain(`property="og:description"\n      content="${BRAND.blurb}"`);
  });

  /**
   * MEASURED 2026-10-02: `index.html` named `/manifest.webmanifest` and `/brand/icon.svg` from the
   * first commit and neither file existed — the dev server answered both with the page itself, so
   * every load logged a manifest syntax error and the tab had no icon. A link must name a real file.
   */
  it("links only files that exist in public/", () => {
    const html = readFileSync(join(ROOT, "index.html"), "utf8");
    const linked = [...html.matchAll(/<link[^>]*href="\/([^"]+)"/g)].map((m) => m[1]!);
    expect(linked).toEqual(["brand/icon.svg", "manifest.webmanifest"]);
    for (const path of linked) expect(statSync(join(ROOT, "public", path)).isFile(), path).toBe(true);
    const manifest = JSON.parse(readFileSync(join(ROOT, "public", "manifest.webmanifest"), "utf8"));
    expect(manifest.name).toBe(BRAND.name);
    for (const icon of manifest.icons) expect(statSync(join(ROOT, "public", icon.src)).isFile()).toBe(true);
  });

  /** Nothing is deployed, so the link preview must not read as a finished product. */
  it("says the product is still in development", () => {
    expect(BRAND.blurb).toMatch(/In development/);
  });

  /** The one promise every money window is built around, in the pitch where it is checkable. */
  it("says every action is checked before the wallet, and signed there", () => {
    expect(BRAND.tagline).toMatch(/checked before it reaches your wallet, and signed there/);
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
     *
     * Same care for the other discarded name. It used to be the bare substring
     * `supercompute`, which since 2026-09-30 also matches the product's own positioning
     * ("an on-chain supercomputer") — an ordinary English word. The guard is the old
     * brand, spelled as a brand: its domain, or the two capitalised words.
     */
    const stale = /\$PHOS\b|\bPhosphor\b|supercompute\.live|\bSuper ?Compute\b/;
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
    const stale = /\$PHOS\b|\bPhosphor\b|supercompute\.live|\bSuper ?Compute\b/;
    expect(stale.test("token: $PHOS")).toBe(true);
    expect(stale.test("Phosphor pays in USDC")).toBe(true);
    expect(stale.test("see https://www.supercompute.live/?do=launch")).toBe(true);
    expect(stale.test("Built like Super Compute")).toBe(true);
    expect(stale.test("/** The phosphor panel */")).toBe(false);
    expect(stale.test("An on-chain supercomputer for Base.")).toBe(false);
  });
});

/**
 * The other direction, and the one that costs money.
 *
 * The describe above pins that no user-visible string hardcodes the brand. This one
 * pins the opposite: three strings are **identifiers in data that already exists** and
 * must keep their shipped value through a rename. `brand.ts` lists them and says why.
 * The danger is that its own header invites the mistake — a reader who greps for the
 * slug, finds these, and "finishes the rename" by templating them from `BRAND.slug`
 * silently forgets every payee a user confirmed and resets their spending record to
 * "nothing signed today" — a limit that stops limiting. (Four more lived here until the
 * privacy model was archived on 2026-09-30: the note store key, the hash domain tag, the
 * backup format and the empty-leaf preimage.)
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
      file: "src/lib/pins.ts",
      literal: '"quadra.pins.v1"',
      what: "the localStorage key every payee the user confirmed is stored under",
    },
    {
      file: "src/lib/spendGuard.ts",
      literal: '"quadra.spend.v1"',
      what: "the localStorage key the spending record is stored under",
    },
    {
      file: "src/ui/WalletProvider.tsx",
      literal: '"quadra.wallet.v1"',
      what: "the localStorage key the picked wallet is remembered under",
    },
    {
      file: "src/lib/watchlist.ts",
      literal: '"quadra.watch.v1"',
      what: "the localStorage key the Markets watchlist is kept under",
    },
    {
      file: "src/lib/welcome.ts",
      literal: '"quadra.welcome.v1"',
      what: "the localStorage key the Welcome screen's \"show next time\" is kept under",
    },
    // `quadra.pools.v1` (remembered chart pools) was RETIRED on 2026-09-30, when DexScreener
    // began naming each token's pool. Browsers may still hold it: never reuse that key for
    // another shape — pick a new one.
  ] as const;

  /**
   * Comments stripped before either check, and the reason is not tidiness.
   *
   * A frozen literal tends to sit under a comment that quotes the forbidden interpolated
   * form in order to warn against it — which is exactly the documentation you want, and it
   * made the first version of the negative check below fail on the files it protected. The
   * check has to tell prose from code, which is the same distinction this describe is about.
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

  /**
   * Any `${BRAND...}` in front of a versioned namespace: `${BRAND.slug}.v1` or
   * `${BRAND.slug}.pins.v1`. It was `\.(v1|pool)` while the frozen strings were the pool's,
   * and that shape would have let `${BRAND.slug}.pins.v1` straight through — widened when
   * the list changed, and the mutation test below is what shows it now reaches.
   */
  const TEMPLATED = /\$\{BRAND\.\w+\}\.(\w+\.)?v\d/;

  const code = new Map(
    frozen.map(({ file }) => [file, withoutComments(readFileSync(join(ROOT, file), "utf8"))]),
  );

  frozen.forEach(({ file, literal, what }) => {
    it(`keeps ${what} as a literal in ${file}`, () => {
      expect(code.get(file)).toContain(literal);
    });
  });

  /**
   * The pair to the checks above, because presence alone is not enough: a file could
   * keep the old literal as a dead export and interpolate the one actually in use.
   */
  frozen.forEach(({ file }) => {
    it(`does not build a frozen identifier from the brand in ${file}`, () => {
      expect(code.get(file)).not.toMatch(TEMPLATED);
    });
  });

  /**
   * The checks can fail, demonstrated on the exact mutation a pinned value would miss
   * while `BRAND.slug` is still "quadra". Without this, passing assertions about absence
   * would be indistinguishable from a regex that matches nothing.
   */
  it("would catch a templated storage key, which no pinned value can see today", () => {
    const mutated = "export const PINS_KEY = `${BRAND.slug}.pins.v1`;";
    expect(mutated).not.toContain('"quadra.pins.v1"');
    expect(mutated).toMatch(TEMPLATED);
    expect("return `${BRAND.slug}.v1.${domain}`;").toMatch(TEMPLATED);
  });

  /** And that it is not so broad it would reject the brand used for prose. */
  it("still allows the brand in a user-visible string", () => {
    const fine = "throw new Error(`That is not a ${BRAND.name} record.`);";
    expect(fine).not.toMatch(TEMPLATED);
  });
});
