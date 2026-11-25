import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, within } from "@testing-library/react";
import { BRAND } from "@/brand";
import { renderAt, settle } from "./helpers";
import { WELCOME_KEY } from "@/lib/welcome";
import { BUYBACK, gauge } from "@/pages/About";

/**
 * The About page: one scroll that says what the app is, with every number read when it opens — the
 * launchpad's index for coins, launchers and trades, the token's furnace for what was burnt. A number
 * that could not be read says "not read", never zero.
 */
const launchpadCoins = vi.fn();
vi.mock("@/adapters/http/indexer", async (orig) => ({ ...(await orig<typeof import("@/adapters/http/indexer")>()), launchpadCoins: () => launchpadCoins() }));
const launchOf = vi.fn();
vi.mock("@/skills/launchpad", async (orig) => ({ ...(await orig<typeof import("@/skills/launchpad")>()), launchOf: (t: string) => launchOf(t) }));
const furnaceOf = vi.fn();
vi.mock("@/lib/furnace", async (orig) => ({ ...(await orig<typeof import("@/lib/furnace")>()), furnaceOf: (...a: unknown[]) => furnaceOf(...a) }));

const FURNACE = "0x78386A3c1888f89EF4C874675069Cb930536a44c";
const coin = (trades: number) => ({ trades }) as never;
/** A launchpad or furnace row: its label (dt) and the number beside it (dd). */
const figure = (label: string) => screen.getByText(label).nextElementSibling!.textContent;
/** The furnace's headline: how much of the token is burnt. */
const burntHead = () => document.querySelector(".about__burnt strong")!.textContent;

beforeEach(() => {
  vi.clearAllMocks();
  launchpadCoins.mockResolvedValue({ syncedTo: 1, behind: 0, error: null, coins: [coin(7), coin(8), coin(0)], creators: [{}, {}] });
  launchOf.mockResolvedValue({ factory: "0x006Da367654a487bb277fe25ff54f0fE0f741377", creator: "0x1", creatorRecipient: FURNACE });
  furnaceOf.mockResolvedValue({ address: FURNACE, treasury: "0xD5C1", burnBps: 5_000, toBuy: 0n, burnedFromFees: 135_484n * 10n ** 18n, burnedFromBuybacks: 1_677_632n * 10n ** 18n, quoteSpent: 0n });
});

describe("the About page", () => {
  it("says what the app is, and opens the computer", async () => {
    renderAt("/about");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(BRAND.name);
    expect(screen.getAllByRole("link", { name: "Open the computer" })[0]).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Browse coins" })).toHaveAttribute("href", "/?do=coins");
    expect(screen.getByRole("link", { name: "Check a token" })).toHaveAttribute("href", "/?do=safety");
    expect(screen.getByRole("link", { name: "Build a basket" })).toHaveAttribute("href", "/?do=basket");
    expect(screen.getByRole("link", { name: "Launch a coin" })).toHaveAttribute("href", "/?do=launch");
    expect(screen.getByRole("heading", { name: "What it never does" })).toBeInTheDocument();
    expect(figure("coins launched here")).toBe("…");
    await settle();
  });

  it("fills the buyback gauge toward its threshold, capped at full", () => {
    expect([0n, BUYBACK.minWei / 2n, BUYBACK.minWei, BUYBACK.minWei * 3n].map(gauge)).toEqual([0, 50, 100, 100]);
  });

  it("reads its numbers from the index and the furnace", async () => {
    renderAt("/about");
    await settle();
    expect(figure("coins launched here")).toBe("3");
    expect(figure("launchers")).toBe("2");
    expect(figure("trades on their pools")).toBe("15");
    expect(burntHead()).toBe("1,813,116");
    expect(screen.getByText(/burnt · 0\.1813% of the supply/)).toBeInTheDocument();
    expect(screen.getByText(/Its creator fees go to the furnace/)).toHaveTextContent("50% burnt/buyback");
    // what waits to be bought back, what was spent, what the buybacks burnt — and when they happen
    expect(figure("burnt from fees, at once")).toBe("135,484");
    expect(figure("burnt by buybacks")).toBe("1,677,632");
    expect(figure("ETH spent on buybacks")).toBe("0 ETH");
    expect(screen.getByText("0 / 0.05 ETH")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "ETH waiting toward the next buyback" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText(/Each Monday, once 0\.05 ETH or more is waiting/)).toBeInTheDocument();
  });

  it("says a number it could not read is not read — never zero — and has no furnace figure when there is none", async () => {
    launchpadCoins.mockRejectedValue(new Error("index down"));
    furnaceOf.mockRejectedValue(new Error("rpc down"));
    const a = renderAt("/about");
    await settle();
    expect(figure("coins launched here")).toBe("not read");
    expect(burntHead()).toBe("not read");
    expect(figure("burnt by buybacks")).toBe("not read");
    expect(screen.getByText("not read", { selector: ".about__gauge-head span" })).toBeInTheDocument();
    expect(screen.queryByText(/Its creator fees go to the furnace/)).toBeNull();
    a.unmount();
    launchOf.mockResolvedValue(null);
    renderAt("/about");
    await settle();
    expect(burntHead()).toBe("—");
    expect(figure("ETH spent on buybacks")).toBe("—");
  });

  it("is linked from the Welcome screen", async () => {
    // the suite switches the Welcome screen off (tests/setup.ts); this test wants it
    localStorage.removeItem(WELCOME_KEY);
    renderAt("/");
    await settle();
    expect(screen.getByRole("button", { name: "what is quadra /" })).toBeInTheDocument();
  });
});

describe("the fee flow", () => {
  it("keeps the launch split, token furnace and planned connection distinct", async () => {
    const a = renderAt("/about");
    await settle();
    const map = screen.getByRole("figure", { name: "Where every fee goes" });
    expect(map).toHaveTextContent("20% without a referrer.");
    expect(map).toHaveTextContent("15% with one.");
    expect(map).toHaveTextContent("Approved referrers only");
    expect(map).toHaveTextContent("Built, not deployed");
    expect(map).toHaveTextContent("Not live");
    expect(map).toHaveTextContent("50%");
    expect(map).toHaveTextContent("To furnace");
    expect(map.textContent).not.toMatch(/[→↓]/);
    expect(map).toHaveTextContent("Contracts not audited");
    a.unmount();
  });
});


describe("in-app read me", () => {
  it("opens read me as a desktop document", async () => {
    renderAt("/?do=readme");
    await settle();
    expect(screen.getByRole("heading", { name: "your desktop for coins and stocks on base." })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "About navigation" })).toBeNull();
    expect(screen.getByRole("link", { name: "quadra / product tour - opens a new tab" })).toHaveAttribute("target", "_blank");
  });

  it("keeps an unfinished basket when read me opens and closes", async () => {
    renderAt("/?do=basket");
    await settle();
    const asset = screen.getByLabelText("Asset 1");
    await userEvent.clear(asset);
    await userEvent.type(asset, "NVDA");
    await userEvent.click(screen.getByRole("button", { name: "read me / about" }));
    await userEvent.click(within(screen.getByLabelText("Read Me", { selector: "section" })).getByRole("button", { name: "Close" }));
    expect(screen.getByLabelText("Asset 1")).toHaveValue("NVDA");
  });

  it("opens each getting-started action inside the desktop", async () => {
    renderAt("/?do=readme");
    await settle();
    for (const title of ["explore coins", "build a basket", "launch a coin", "your wallet"]) {
      await userEvent.click(screen.getByRole("button", { name: "open " + title }));
      await userEvent.click(screen.getByRole("button", { name: "read me / about" }));
    }
    expect(screen.getByRole("heading", { name: "your desktop for coins and stocks on base." })).toBeInTheDocument();
  });

  it("opens help from welcome without navigating to marketing", async () => {
    localStorage.removeItem(WELCOME_KEY);
    renderAt("/");
    await settle();
    await userEvent.click(screen.getByRole("button", { name: "what is quadra /" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: "your desktop for coins and stocks on base." })).toBeInTheDocument();
  });
});
