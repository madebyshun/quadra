import { describe, it, expect, vi } from "vitest";
import { CORNER, FEATURES, comingSoon, desktopFeatures, visibleFeatures, resolveFeature, isEnabled } from "@/features/registry";
import { FLAGS } from "@/config/chain";

const flags = vi.hoisted(() => ({ robinhood: false, allOn: false }));
vi.mock("@/config/chain", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/config/chain")>();
  return { ...real, FLAGS: new Proxy(real.FLAGS, { get: (t, k) => (flags.allOn ? true : k === "robinhood" ? flags.robinhood : t[k as keyof typeof t]) }) };
});

/**
 * Feature ids are permanent: they are the `?do=` in every link anyone saved.
 * The list below is pinned literally so that renaming an id fails here instead
 * of silently 404-ing a link that is already out in the world.
 *
 * One id was dropped on 2026-09-30: `router`, the private-balance agent payer, archived
 * with the privacy model. That was only acceptable because nothing is public yet — no
 * link to it exists outside this repo. Once the site is live, an id is removed by
 * redirecting it, never by deleting it.
 */
const SHIPPED_IDS = [
  "wallet",
  "terminal",
  "research",
  "safety",
  "markets",
  "trade",
  "send",
  "swap",
  "bridge",
  "launch",
  "coins",
  "profile",
  "taskmgr",
  "rugsweeper",
  "achievements",
  "leaderboard",
  "x402",
  "mcp",
  "inference",
  "audit",
  "hooks",
  "soon",
  "trash",
] as const;

describe("the feature registry", () => {
  it("has exactly the ids that have shipped", () => {
    expect(FEATURES.map((f) => f.id)).toEqual([...SHIPPED_IDS]);
  });

  it("has no duplicate ids", () => {
    const ids = FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every feature a title, a blurb and a window name", () => {
    for (const f of FEATURES) {
      expect(f.title.length, f.id).toBeGreaterThan(0);
      expect(f.blurb.length, f.id).toBeGreaterThan(0);
      expect(f.window.length, f.id).toBeGreaterThan(0);
    }
  });

  it("points every feature at a flag that exists", () => {
    for (const f of FEATURES) {
      expect(Object.keys(FLAGS), f.id).toContain(f.flag);
    }
  });

  it("keeps ids url-safe, since they go in a query string", () => {
    for (const f of FEATURES) {
      expect(f.id).toMatch(/^[a-z0-9]+$/);
      expect(encodeURIComponent(f.id)).toBe(f.id);
    }
  });

  it("writes blurbs in lower case, the way the cards render them", () => {
    for (const f of FEATURES) {
      expect(f.blurb[0], f.id).toBe(f.blurb[0]?.toLowerCase());
    }
  });
});

describe("resolveFeature", () => {
  it("resolves every shipped id", () => {
    for (const id of SHIPPED_IDS) {
      expect(resolveFeature(id)?.id).toBe(id);
    }
  });

  it("returns null for no id, so the desktop shows", () => {
    expect(resolveFeature(null)).toBeNull();
    expect(resolveFeature("")).toBeNull();
  });

  it("returns null for an unknown id rather than throwing", () => {
    expect(resolveFeature("nope")).toBeNull();
    expect(resolveFeature("SWAP")).toBeNull();
  });

  it("does not resolve inherited Object keys", () => {
    expect(resolveFeature("constructor")).toBeNull();
    expect(resolveFeature("__proto__")).toBeNull();
    expect(resolveFeature("toString")).toBeNull();
  });
});

describe("isEnabled", () => {
  it("reads the flag table, not a field on the feature", () => {
    for (const f of FEATURES) {
      expect(isEnabled(f), f.id).toBe(FLAGS[f.flag] && (f.id !== "bridge" || FLAGS.robinhood));
    }
  });

  /**
   * `audit` and `hooks` went off on 2026-09-29 as off-thesis. On 2026-09-30 `launch` came
   * back on (it goes out in public through o1) and `inference` went off — it is a stub
   * with no enclave behind it, and an on-chain supercomputer does not need one to start.
   * Pinned as a list so turning one back on is a visible decision rather than a flag
   * nobody noticed flipping.
   */
  it("reports the switched-off features as off", () => {
    const off = FEATURES.filter((f) => !isEnabled(f)).map((f) => f.id);
    // bridge: on its own flag, but its only destination is Robinhood Chain, hidden 2026-10-02
    expect(off).toEqual(["bridge", "inference", "audit", "hooks"]);
  });

  it("no longer resolves the archived router id", () => {
    expect(resolveFeature("router")).toBeNull();
  });
});

describe("visibleFeatures", () => {
  it("shows off features too, rather than hiding them — all but Robinhood Chain's", () => {
    expect(visibleFeatures().map((f) => f.id)).toEqual(FEATURES.map((f) => f.id).filter((id) => id !== "bridge"));
    expect(resolveFeature("bridge")?.robinhood).toBe(true);
  });

  it("brings Bridge back, on, the day Robinhood Chain is switched on", () => {
    flags.robinhood = true;
    expect(visibleFeatures()).toHaveLength(FEATURES.length);
    expect(isEnabled(resolveFeature("bridge")!)).toBe(true);
    flags.robinhood = false;
  });
});

describe("the desktop's icons (2026-10-14)", () => {
  it("puts the switched-off programs in Coming Soon, not on the desktop", () => {
    expect(comingSoon().map((f) => f.id)).toEqual(["inference", "audit", "hooks"]);
    const desk = desktopFeatures().map((f) => f.id);
    for (const id of ["inference", "audit", "hooks", "bridge"]) expect(desk).not.toContain(id);
    expect(desk).toContain("soon");
  });

  it("keeps the Recycle Bin in its own corner", () => {
    expect([...CORNER]).toEqual(["trash"]);
    expect(desktopFeatures().map((f) => f.id)).not.toContain("trash");
  });

  it("hides the Coming Soon folder when nothing is waiting in it", () => {
    flags.allOn = true;
    try {
      expect(comingSoon()).toEqual([]);
      const desk = desktopFeatures().map((f) => f.id);
      expect(desk).not.toContain("soon");
      expect(desk).toContain("bridge");
    } finally {
      flags.allOn = false;
    }
  });
});
