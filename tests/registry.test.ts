import { describe, it, expect, vi } from "vitest";
import {
  CORNER,
  DESKTOP,
  FEATURES,
  FOLDERS,
  FOLDER_IDS,
  comingSoon,
  desktopItems,
  entryOf,
  folderItems,
  folderOf,
  isFolder,
  visibleFeatures,
  resolveFeature,
  isEnabled,
} from "@/features/registry";
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
  "card",
  // a directory of projects on Base, 2026-10-22
  "explore",
  "x402",
  "mcp",
  "inference",
  "audit",
  "hooks",
  "soon",
  "trash",
  // the desktop reorganised into folders, 2026-10-21
  "computer",
  "folder-research",
  "folder-money",
  "folder-launchpad",
  "folder-games",
  "folder-agents",
  "control",
  "readme",
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
      if (f.flag !== undefined) expect(Object.keys(FLAGS), f.id).toContain(f.flag);
    }
    // only the desktop's furniture goes without one: a folder is never the thing that is off — and
    // Explore Base, a fixed directory that reads nothing live
    expect(FEATURES.filter((f) => f.flag === undefined).map((f) => f.id)).toEqual(["explore", ...FOLDER_IDS, "control", "readme"]);
  });

  it("keeps ids url-safe, since they go in a query string", () => {
    for (const f of FEATURES) {
      expect(f.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)?$/);
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
      expect(isEnabled(f), f.id).toBe((f.flag === undefined || FLAGS[f.flag]) && (f.id !== "bridge" || FLAGS.robinhood));
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

describe("the desktop's folders (2026-10-21)", () => {
  const ids = () => desktopItems().map((e) => e.id);

  it("keeps only the folders, four shortcuts and README.TXT on the desktop", () => {
    expect(ids()).toEqual([
      "computer",
      "folder-research",
      "folder-money",
      "folder-launchpad",
      "folder-games",
      "folder-agents",
      "terminal",
      "launch",
      "coins",
      "wallet",
      "readme",
    ]);
    expect(DESKTOP).toEqual(ids());
  });

  it("files every switched-on program somewhere: a folder, the desktop, or the Trash's corner", () => {
    const filed = new Set([...DESKTOP, ...CORNER, ...FOLDER_IDS.flatMap((f) => FOLDERS[f])]);
    for (const f of FEATURES.filter(isEnabled)) expect(filed.has(f.id), f.id).toBe(true);
    for (const d of ["docs", "api", "verify"] as const) expect(folderOf(d)).toBe("folder-agents");
    expect(folderOf("terminal")).toBeNull();
    expect(folderOf("safety")).toBe("folder-research");
  });

  it("lists a folder's switched-on programs only, and Coming Soon while it holds something", () => {
    expect(folderItems("folder-money").map((e) => e.id)).toEqual(["wallet", "send", "swap", "trade"]);
    expect(folderItems("computer").map((e) => e.id)).toEqual(["taskmgr", "control", "soon"]);
    expect(folderItems("folder-agents").map((e) => e.title)).toEqual(["MCP", "x402", "API", "Docs", "Verify"]);
    expect(entryOf("docs").doc?.path).toBe("/docs");
    expect(entryOf("wallet").doc).toBeNull();
  });

  it("tells a folder from anything else, inherited keys included", () => {
    expect(isFolder("folder-games")).toBe(true);
    expect(isFolder("games")).toBe(false);
    expect(isFolder("constructor")).toBe(false);
  });

  it("puts the switched-off programs in Coming Soon, not on the desktop", () => {
    expect(comingSoon().map((f) => f.id)).toEqual(["inference", "audit", "hooks"]);
    for (const id of ["inference", "audit", "hooks", "bridge"]) expect(ids()).not.toContain(id);
  });

  it("keeps the Trash in its own corner", () => {
    expect([...CORNER]).toEqual(["trash"]);
    expect(ids()).not.toContain("trash");
  });

  it("hides the Coming Soon folder when nothing is waiting in it, and shows Bridge in Money", () => {
    flags.allOn = true;
    try {
      expect(comingSoon()).toEqual([]);
      expect(folderItems("computer").map((e) => e.id)).not.toContain("soon");
      expect(folderItems("folder-money").map((e) => e.id)).toContain("bridge");
    } finally {
      flags.allOn = false;
    }
  });
});
