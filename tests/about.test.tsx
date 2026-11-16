import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { BRAND } from "@/brand";
import { renderAt, settle } from "./helpers";
import { WELCOME_KEY } from "@/lib/welcome";

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
const figure = (label: string) => screen.getByText(label).previousElementSibling!.textContent;

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

  it("reads its numbers from the index and the furnace", async () => {
    renderAt("/about");
    await settle();
    expect(figure("coins launched here")).toBe("3");
    expect(figure("launchers")).toBe("2");
    expect(figure("trades on their pools")).toBe("15");
    expect(figure(`${BRAND.ticker} burnt`)).toBe("1,813,116");
    expect(screen.getByText(/Its fees go to the furnace/)).toHaveTextContent("50% burnt");
  });

  it("says a number it could not read is not read — never zero — and has no furnace figure when there is none", async () => {
    launchpadCoins.mockRejectedValue(new Error("index down"));
    furnaceOf.mockRejectedValue(new Error("rpc down"));
    const a = renderAt("/about");
    await settle();
    expect(figure("coins launched here")).toBe("not read");
    expect(figure(`${BRAND.ticker} burnt`)).toBe("not read");
    expect(screen.queryByText(/Its fees go to the furnace/)).toBeNull();
    a.unmount();
    launchOf.mockResolvedValue(null);
    renderAt("/about");
    await settle();
    expect(figure(`${BRAND.ticker} burnt`)).toBe("—");
  });

  it("is linked from the Welcome screen", async () => {
    // the suite switches the Welcome screen off (tests/setup.ts); this test wants it
    localStorage.removeItem(WELCOME_KEY);
    renderAt("/");
    await settle();
    expect(screen.getByRole("link", { name: `What is ${BRAND.name}? /` })).toHaveAttribute("href", "/about");
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
    expect(map).toHaveTextContent("Not connected");
    expect(map).toHaveTextContent("Planned");
    expect(map).toHaveTextContent("50%");
    expect(map).toHaveTextContent("Contracts not audited");
    a.unmount();
  });
});
