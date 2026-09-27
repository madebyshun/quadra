import { describe, it, expect } from "vitest";
import { FEATURES, VISIBLE_FEATURES, resolveFeature, isEnabled } from "@/features/registry";
import { FLAGS } from "@/config/chain";

/**
 * Feature ids are permanent: they are the `?do=` in every link anyone saved.
 * The list below is pinned literally so that renaming an id fails here instead
 * of silently 404-ing a link that is already out in the world.
 */
const SHIPPED_IDS = [
  "swap",
  "inference",
  "router",
  "send",
  "mcp",
  "bridge",
  "launch",
  "audit",
  "hooks",
  "x402",
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
      expect(isEnabled(f), f.id).toBe(FLAGS[f.flag]);
    }
  });

  it("reports the two unbuilt features as off", () => {
    const off = FEATURES.filter((f) => !isEnabled(f)).map((f) => f.id);
    expect(off).toEqual(["bridge", "launch"]);
  });
});

describe("VISIBLE_FEATURES", () => {
  it("shows off features too, rather than hiding them", () => {
    expect(VISIBLE_FEATURES).toHaveLength(FEATURES.length);
  });
});
