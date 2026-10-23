import { describe, expect, it, vi } from "vitest";
import { BRAND } from "@/brand";
import { FIXED_TIPS, WELCOME_KEY, activityTip, binTip, blocksTip, setWelcomeOn, showWelcome, tipsFor, welcomeOn } from "@/lib/welcome";
import { WHATS_NEW } from "@/lib/whatsnew";
import { resolveFeature } from "@/features/registry";
import type { Activity } from "@/skills/activity";
import type { Bin, Emptied } from "@/skills/rugs";

const act = (over: Partial<Activity> = {}): Activity => ({ latest: 1, minutes: 10, total: 0, processes: [], ...over });
const bin = (over: Partial<Bin> = {}): Bin => ({ latest: 1, minutes: 180, removals: 0, emptied: [], unread: 0, ...over });
const coin = {} as Emptied;

describe("whether the Welcome screen shows", () => {
  it("shows by default, not for a ?do= link, not once turned off, and on unreadable storage", () => {
    localStorage.removeItem(WELCOME_KEY);
    expect(welcomeOn()).toBe(true);
    expect(showWelcome("")).toBe(true);
    expect(showWelcome("do=send")).toBe(false);
    setWelcomeOn(false);
    expect(localStorage.getItem(WELCOME_KEY)).toBe("off");
    expect(showWelcome("")).toBe(false);
    setWelcomeOn(true);
    expect(welcomeOn()).toBe(true);
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(welcomeOn()).toBe(true);
    expect(() => setWelcomeOn(false)).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

describe("tips", () => {
  it("has at least twelve fixed tips, the brand by name", () => {
    expect(FIXED_TIPS.length).toBeGreaterThanOrEqual(12);
    expect(FIXED_TIPS.some((t) => t.includes(BRAND.name))).toBe(true);
  });

  it("words blocks since the page opened, one block, and none yet", () => {
    expect(blocksTip(100, 1100)).toBe("Base has made 1,000 blocks since you opened this page. The latest is #1,100.");
    expect(blocksTip(100, 101)).toMatch(/made 1 block since/);
    expect(blocksTip(100, 100)).toMatch(/^The latest Base block is #100, read/);
  });

  it("words the launch activity: none, one with no launchpad, many with the busiest named", () => {
    expect(activityTip(act())).toMatch(/^No pool opened on Uniswap v4 on Base in the last 10 minutes/);
    expect(activityTip(act({ total: 1, processes: [{ name: "no hook", launches: 1, ours: false }] }))).toBe(
      "1 pool opened on Uniswap v4 on Base in the last 10 minutes.",
    );
    const many = act({
      total: 30,
      processes: [
        { name: `${BRAND.name} launchpad`, launches: 2, ours: true },
        { name: "Zora", launches: 12, ours: false },
        { name: "Clanker", launches: 12, ours: false },
        { name: "everything else", launches: 14, ours: false },
      ],
    });
    expect(activityTip(many)).toBe("30 pools opened on Uniswap v4 on Base in the last 10 minutes. The busiest launchpad: Zora, with 12.");
  });

  it("words the Trash: empty, one, many, and the unread ones counted", () => {
    expect(binTip(bin())).toMatch(/^No pool on Uniswap v4 was emptied in the last 3 hours/);
    expect(binTip(bin({ emptied: [coin] }))).toMatch(/^1 coin's pool was emptied in the last 3 hours\. They/);
    expect(binTip(bin({ emptied: [coin, coin], unread: 2 }))).toMatch(/^2 coins' pools were emptied in the last 3 hours \(2 more could not be read\)/);
    expect(binTip(bin({ unread: 1 }))).toMatch(/^0 coins' pools were emptied .* \(1 more could not be read\)/);
  });

  it("orders live tips first, the Trash last, and leaves out what was not read", () => {
    expect(tipsFor({ blocks: null, activity: null, bin: null })).toEqual(FIXED_TIPS);
    const all = tipsFor({ blocks: { first: 1, latest: 3 }, activity: act(), bin: bin() });
    expect(all[0]).toMatch(/^No pool opened/);
    expect(all[1]).toMatch(/^Base has made 2 blocks/);
    expect(all.at(-1)).toMatch(/Trash is empty/);
    expect(all).toHaveLength(FIXED_TIPS.length + 3);
  });
});

describe("What's New", () => {
  it("names a window that exists for every item but the Base card (another program) and Q", () => {
    expect(WHATS_NEW.length).toBeGreaterThanOrEqual(10);
    for (const item of WHATS_NEW) if (item.window && item.window !== "card") expect(resolveFeature(item.window), item.title).not.toBeNull();
  });
});
