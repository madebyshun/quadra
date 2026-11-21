import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { EASTER, parseCommand, runKey, SHORTCUTS, SKILL_HOME, skillOpening, windowsText } from "@/features/commands";
import { OpenWindowProvider, useRunCommand, type OpenWindowFn } from "@/features/openWindow";
import { SKILLS } from "@/skills";
import type { Skill } from "@/skills/types";

/**
 * One command language for the app (2026-10-02, "link everything together"): a line runs a skill
 * or opens a window with what it should show. The Terminal, a report's next step and a button all
 * go through `parseCommand`, so this is where they are pinned.
 */

const flags = vi.hoisted(() => ({ x402: true }));
vi.mock("@/config/chain", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/config/chain")>();
  return { ...real, FLAGS: new Proxy(real.FLAGS, { get: (t, k) => (k === "x402" ? flags.x402 : t[k as keyof typeof t]) }) };
});

const T = "0xb20000000000000000000036f9a2788834bCE124";
const opened = (line: string) => {
  const c = parseCommand(line);
  if (c.kind !== "open") throw new Error(`${line} is ${c.kind}`);
  return c.opening;
};

describe("a command line", () => {
  it("reads the Terminal's own words, case aside", () => {
    expect(parseCommand("  ")).toEqual({ kind: "empty" });
    expect(parseCommand("HELP").kind).toBe("help");
    expect(parseCommand("?").kind).toBe("help");
    expect(parseCommand("cls").kind).toBe("clear");
    expect(parseCommand("windows").kind).toBe("windows");
    expect(parseCommand("apps").kind).toBe("windows");
  });

  it("opens a window by its shortcut, its id or its title, with what it should show", () => {
    expect(opened(`coin ${T}`)).toEqual({ window: "coins", params: { t: T } });
    expect(opened("coins")).toEqual({ window: "coins", params: {} });
    expect(opened("profile jesse.base.eth")).toEqual({ window: "profile", params: { a: "jesse.base.eth" } });
    expect(opened("me")).toEqual({ window: "profile", params: {} });
    expect(opened(`send ${T}`)).toEqual({ window: "send", params: { to: T } });
    expect(opened(`buy ${T}`)).toEqual({ window: "swap", params: { buy: T } });
    expect(opened("open Markets")).toEqual({ window: "markets", params: {} });
    expect(opened("open markets")).toEqual({ window: "markets", params: {} });
    expect(opened(`open coin ${T}`)).toEqual({ window: "coins", params: { t: T } });
    expect(opened("open Coins")).toEqual({ window: "coins", params: {} });
    expect(opened("open docs")).toEqual({ window: "docs", params: {} });
    expect(opened("open API")).toEqual({ window: "api", params: {} });
  });

  it("runs Launch bare as its window and with arguments as the prepared launch", () => {
    expect(opened("launch")).toEqual({ window: "launch", params: {} });
    expect(parseCommand(`launch Cat CAT ${T}`)).toMatchObject({ kind: "skill", skill: { id: "launch" }, args: ["Cat", "CAT", T] });
  });

  it("runs every skill by its id or alias", () => {
    for (const s of SKILLS) expect(parseCommand(`${s.id} x`)).toMatchObject({ kind: "skill", skill: { id: s.id } });
    expect(parseCommand(`snipers ${T}`)).toMatchObject({ kind: "skill", skill: { id: "forensics" }, args: [T] });
  });

  it("says when a window is off — hidden Bridge included — and when a word means nothing", () => {
    expect(parseCommand("open audit")).toEqual({ kind: "off", title: "Audit" });
    expect(parseCommand("open bridge")).toEqual({ kind: "off", title: "Bridge" });
    expect(parseCommand("open nowhere")).toEqual({ kind: "unknown", word: "nowhere" });
    expect(parseCommand("open")).toEqual({ kind: "unknown", word: "open" });
    expect(parseCommand("frobnicate 1")).toEqual({ kind: "unknown", word: "frobnicate" });
  });
});

describe("a skill run from a window", () => {
  it("opens the skill's own window, told — by a key only that window reads — to run it", () => {
    expect(skillOpening(SKILLS.find((s) => s.id === "verdict")!, [T])).toEqual({ window: "safety", params: { [runKey("safety")]: `verdict ${T}` } });
    expect(skillOpening(SKILLS.find((s) => s.id === "forensics")!, [T]).window).toBe("safety");
    expect(skillOpening({ id: "elsewhere" } as Skill, []).window).toBe("terminal");
    // every skill has a home
    for (const s of SKILLS) expect(SKILL_HOME[s.id], s.id).toBeDefined();
  });

  it("lists every window a command opens, and only those that are on", () => {
    const text = windowsText();
    expect(text).toContain("coin [0x…]");
    expect(text).toContain("Coins — every coin launched here");
    expect(text).toContain("Docs — how it works");
    expect(text).toMatch(/open <window> +any window by its name$/);
    expect(text).not.toContain("Bridge");
    expect(Object.keys(SHORTCUTS)).not.toContain("bridge");
    // a window with a shortcut, switched off, leaves the list — and says it is off when asked for
    flags.x402 = false;
    expect(windowsText()).not.toMatch(/^ +x402 /m);
    expect(parseCommand("x402")).toEqual({ kind: "off", title: "x402" });
    flags.x402 = true;
    expect(windowsText()).toMatch(/^ +x402 /m);
  });
});

describe("the desktop's folders (2026-10-21)", () => {
  it("opens a folder by its word; a bare `research` stays the Research window", () => {
    expect(opened("open research")).toEqual({ window: "folder-research", params: {} });
    expect(opened("open Money")).toEqual({ window: "folder-money", params: {} });
    expect(opened("money")).toEqual({ window: "folder-money", params: {} });
    expect(opened("launchpad")).toEqual({ window: "folder-launchpad", params: {} });
    expect(opened("games")).toEqual({ window: "folder-games", params: {} });
    expect(opened("agents")).toEqual({ window: "folder-agents", params: {} });
    expect(opened("computer")).toEqual({ window: "computer", params: {} });
    expect(opened("open computer")).toEqual({ window: "computer", params: {} });
    expect(opened("control")).toEqual({ window: "control", params: {} });
    expect(opened("readme")).toEqual({ window: "readme", params: {} });
    expect(opened("open folder-games")).toEqual({ window: "folder-games", params: {} });
    expect(opened("research")).toEqual({ window: "research", params: {} });
  });

  it("lists the windows by folder, the way the desktop shows them", () => {
    const lines = windowsText().split("\n");
    expect(lines[0]).toBe("On the desktop:");
    expect(lines).toContain("Folders:");
    const money = lines.findIndex((l) => l.startsWith("  open money"));
    expect(lines[money]).toContain("Money — treasury basket, bridge");
    expect(lines[money + 1]).toMatch(/^ {4}open basket /);
    expect(windowsText()).toMatch(/^ {2}send /m);
    expect(windowsText()).toMatch(/^ {2}wallet +Wallet — connect one you control$/m);
    expect(windowsText()).toMatch(/^ {4}(open )?readme +Read Me — start here$/m);
    expect(windowsText()).toMatch(/^ {2}trash +Trash/m);
    // a program with no shortcut word of its own is opened by id
    expect(windowsText()).toMatch(/^ {4}open soon +Coming Soon/m);
  });
});

describe("the new windows' shortcuts (2026-10-14)", () => {
  it("open Task Manager, the Trash, Rugsweeper, Achievements and the Leaderboard", () => {
    expect(opened("taskmgr")).toEqual({ window: "taskmgr", params: {} });
    expect(opened("top")).toEqual({ window: "taskmgr", params: {} });
    expect(opened("trash")).toEqual({ window: "trash", params: {} });
    expect(opened("rugs")).toEqual({ window: "trash", params: {} });
    expect(opened("rugsweeper")).toEqual({ window: "rugsweeper", params: {} });
    expect(opened("sweep")).toEqual({ window: "rugsweeper", params: {} });
    expect(opened("achievements")).toEqual({ window: "achievements", params: {} });
    expect(opened("leaderboard")).toEqual({ window: "leaderboard", params: {} });
  });
});

describe("easter eggs", () => {
  it("answer with words and run nothing, case aside", () => {
    for (const [word, text] of Object.entries(EASTER)) expect(parseCommand(word.toUpperCase())).toEqual({ kind: "say", text });
    expect(parseCommand("sudo rm -rf /")).toEqual({ kind: "say", text: EASTER.sudo });
  });

  it("never shadow a skill or a shortcut", () => {
    const eggs = EASTER as Record<string, string>;
    for (const word of Object.keys(EASTER)) {
      expect(SKILLS.some((s) => s.id === word), word).toBe(false);
      expect(SHORTCUTS[word], word).toBeUndefined();
    }
    eggs.radar = "an egg";
    eggs.coins = "an egg";
    try {
      expect(parseCommand("radar").kind).toBe("skill");
      expect(parseCommand("coins").kind).toBe("open");
    } finally {
      delete eggs.radar;
      delete eggs.coins;
    }
  });
});

describe("useRunCommand", () => {
  const rig = () => {
    const opens: [string, unknown][] = [];
    const open: OpenWindowFn = (id, params) => void opens.push([id, params]);
    const wrapper = ({ children }: { children: ReactNode }) => createElement(OpenWindowProvider, { open, children });
    const run = renderHook(() => useRunCommand(), { wrapper }).result.current!;
    return { run, opens };
  };

  it("answers an easter egg with its text and opens nothing", () => {
    const { run, opens } = rig();
    expect(run("ver")).toBe(EASTER.ver);
    expect(opens).toEqual([]);
  });

  it("opens windows and skills' homes, and says why when it cannot", () => {
    const { run, opens } = rig();
    expect(run("taskmgr")).toBeNull();
    expect(run(`verdict ${T}`)).toBeNull();
    expect(run("help")).toBeNull();
    expect(run("frobnicate")).toBe('No command "frobnicate".');
    expect(run("open audit")).toBe("Audit is not switched on.");
    expect(opens).toEqual([
      ["taskmgr", {}],
      ["safety", { [runKey("safety")]: `verdict ${T}` }],
      ["terminal", { [runKey("terminal")]: "help" }],
    ]);
  });

  it("is null outside the desktop", () => {
    expect(renderHook(() => useRunCommand()).result.current).toBeNull();
  });
});
