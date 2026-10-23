import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { decodeFunctionData } from "viem";
import { UNISWAP_V4_POOL_MANAGER } from "@/config/chain";
import { LAUNCHPAD_ABI } from "@/config/launchpad";
import type { Market } from "@/skills/dexscreener";
import type { Launch, PoolValue } from "@/skills/launchpad";
import { row } from "@/skills/types";
import { OpenWindowProvider } from "@/features/openWindow";
import { ago, assetsOf, CoinsPanel, coinReport, filterCoins, SHOWN_COINS, sortCoins, statsOf, versionOf, type Listed } from "@/features/panels/CoinsPanel";
import { WalletProvider } from "@/ui/WalletProvider";
import { ADDR, copy, FX } from "./fixtures/base";
import { BLOCKSCOUT } from "@/skills/blockscout";
import { LAUNCHPAD, LX, NO_LOGS } from "./fixtures/launchpad";
import { DOWN, net, useNet } from "./net";
import { served } from "./indexerPage";
import { chainRoutes, getRoutes, HASH, marketsOf, ME, T, V1_LOGS, wallet } from "./launchpadChain";
import { withoutV3 } from "./v2only";

// Its fixtures are real v2/v1 captures, so it runs as the app did before v3 was set.
withoutV3();

useNet();

/**
 * Coins — this app's launchpad as one window. The list and the coin page are read against the REAL
 * first launch: v1's captured log page, its captured launch record, its pool's captured slot0, and the
 * captured WETH market for the ETH price. v2 is the real deployed address with an empty index.
 */

const verdictMock = vi.hoisted(() => ({ fn: null as null | ((t: string) => Promise<unknown>) }));
vi.mock("@/skills/verdict", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/skills/verdict")>();
  return { ...real, tokenVerdict: (t: string, now: number) => (verdictMock.fn ? verdictMock.fn(t) : real.tokenVerdict(t, now)) };
});
vi.mock("@/lib/connectors", () => ({ walletConnectProvider: vi.fn(), coinbaseProvider: vi.fn() }));

/** Where the window has put the URL — the coin page's link. */
function Where() {
  const l = useLocation();
  return <output aria-label="url">{l.search}</output>;
}

function mount(path = "/?do=coins", open: ((id: string) => void) | null = vi.fn()) {
  const panel = (
    <WalletProvider>
      <CoinsPanel />
      <Where />
    </WalletProvider>
  );
  return render(<MemoryRouter initialEntries={[path]}>{open ? <OpenWindowProvider open={open}>{panel}</OpenWindowProvider> : panel}</MemoryRouter>);
}

// ── the pure parts ────────────────────────────────────────────────────────────

const launch = (token: string, minutesAgo: number): Launch => ({
  factory: LAUNCHPAD.factory,
  token,
  creator: ME,
  block: 1,
  at: new Date(Date.parse("2026-10-02T08:00:00Z") - minutesAgo * 60_000),
  tx: "",
});
const market = (volume24h: number | null, buys: number | null, liquidityUsd: number | null): Market =>
  ({ volume24h, buys24h: buys, sells24h: buys === null ? null : 0, liquidityUsd }) as Market;
const value = (quoteSymbol: string, quoteUsd: number | null = 100, supplyInQuote = 10): PoolValue => ({ quote: T, quoteSymbol, quoteDecimals: 8, supplyInQuote, quoteUsd });

const A: Listed = { ...launch("0xa", 10), value: value("ETH", 2000, 5), market: market(50, 3, 900), facts: { name: "Alpha", symbol: "A" } };
const B: Listed = { ...launch("0xb", 5), value: value("AAPLc", 330, 40), market: market(10, 9, null) };
const C: Listed = { ...launch("0xc", 1), value: null, market: null };
const D: Listed = { ...launch("0xd", 20), value: value("NVDAc", null), market: undefined };

describe("the coins, sorted and filtered", () => {
  it("sorts by trades, volume, age or liquidity — an unread figure last, never as a zero", () => {
    expect(sortCoins([A, B, C, D], "trending").map((c) => c.token)).toEqual(["0xb", "0xa", "0xc", "0xd"]);
    expect(sortCoins([A, B, C, D], "volume").map((c) => c.token)).toEqual(["0xa", "0xb", "0xc", "0xd"]);
    expect(sortCoins([A, B, C, D], "new").map((c) => c.token)).toEqual(["0xc", "0xb", "0xa", "0xd"]);
    expect(sortCoins([A, B, C, D], "liquidity").map((c) => c.token)).toEqual(["0xa", "0xc", "0xb", "0xd"]);
    // a coin whose launch time was not read sorts as the oldest
    expect(sortCoins([{ ...C, at: null }, B], "new").map((c) => c.token)).toEqual(["0xb", "0xc"]);
    // a market with no trade counts reads as zero trades, not as unread
    expect(sortCoins([{ ...A, market: market(1, null, 1) }, C], "trending").map((c) => c.token)).toEqual(["0xa", "0xc"]);
    // either order in, the same order out — both unread, or one read and one not
    for (const pair of [[C, D], [D, C]]) expect(sortCoins(pair, "volume").map((c) => c.token)).toEqual(["0xc", "0xd"]);
    for (const pair of [[A, C], [C, A]]) expect(sortCoins(pair, "volume").map((c) => c.token)).toEqual(["0xa", "0xc"]);
  });

  it("splits Crypto (ETH) from Stocks, narrows to one asset, and keeps an unread pair under All only", () => {
    expect(filterCoins([A, B, C, D], "all", null)).toHaveLength(4);
    expect(filterCoins([A, B, C, D], "crypto", null).map((c) => c.token)).toEqual(["0xa"]);
    expect(filterCoins([A, B, C, D], "stocks", null).map((c) => c.token)).toEqual(["0xb", "0xd"]);
    expect(filterCoins([A, B, C, D], "stocks", "NVDAc").map((c) => c.token)).toEqual(["0xd"]);
    expect(assetsOf([B, D, A, C, B])).toEqual(["ETH", "AAPLc", "NVDAc"]);
    expect(assetsOf([B, D])).toEqual(["AAPLc", "NVDAc"]);
    expect(assetsOf([A, B])).toEqual(["ETH", "AAPLc"]);
    expect(assetsOf([B, A])).toEqual(["ETH", "AAPLc"]);
  });

  it("totals what was read, and says — rather than $0 — when nothing was", () => {
    expect(statsOf([A, B, C, D], 4, true)).toEqual({ launched: "4", volume: "$60.00", trades: "12", top: "$13,200.00" });
    expect(statsOf([A], 25, false)).toEqual({ launched: "25+", volume: "$50.00", trades: "3", top: "$10,000.00 · A" });
    expect(statsOf([C, D], 2, true)).toEqual({ launched: "2", volume: "—", trades: "—", top: "—" });
    expect(statsOf([{ ...A, market: market(null, 1, null) }], 1, true).volume).toBe("$0.00");
  });

  it("names the launchpad version and the time since a launch", () => {
    expect(versionOf(LAUNCHPAD.factory)).toBe("version 1");
    expect(versionOf(LAUNCHPAD.factoryV2)).toBe("version 2");
    const at = Date.parse("2026-10-02T08:00:00Z");
    expect(ago(null, at)).toBe("time not read");
    expect(ago(new Date(at - 5 * 60_000), at)).toBe("5 min ago");
    expect(ago(new Date(at + 60_000), at)).toBe("0 min ago");
    expect(ago(new Date(at - 3 * 3_600_000), at)).toBe("3 h ago");
    expect(ago(new Date(at - 72 * 3_600_000), at)).toBe("3 days ago");
  });

  it("writes a coin's page: an unread pool and fees are amber rows, a stock pair links the stock and says who may hold it", () => {
    const record = { factory: LAUNCHPAD.factoryV2, creator: ME, creatorRecipient: ME };
    const r = coinReport(T, null, record, null, null, null);
    expect(r.title).toBe(`Coin ${T}`);
    const by = (rep: typeof r, label: string) => rep.rows.find((x) => x.label === label);
    expect(by(r, "Paired with")).toEqual(row("Paired with", "not read — its pool could not be read", { tone: "warn" }));
    expect(by(r, "Fees waiting")).toEqual(row("Fees waiting", "fees could not be read", { tone: "warn" }));
    expect(by(r, "Launched")?.value).toBe("time not read");
    expect(by(r, "Launchpad")?.value).toMatch(/^version 2/);
    const stock = coinReport(T, { name: "test", symbol: "test" }, record, value("AAPLc"), { quote: T, inQuote: 10n ** 6n, inToken: 0n }, { ...launch(T, 1), tx: HASH });
    expect(by(stock, "Paired with")).toEqual(row("Paired with", "AAPLc — a Coinbase stock token on Base", { href: `https://basescan.org/token/${T}` }));
    expect(by(stock, "Fees waiting")?.value).toBe("0.01 AAPLc + 0 tokens waiting — 80% of it to you");
    expect(by(stock, "Launched")?.href).toBe(`https://basescan.org/tx/${HASH}`);
    expect(stock.notes.join(" ")).toContain("eligible persons outside the U.S.");
    expect(coinReport(T, null, record, value("ETH"), null, null).notes.join(" ")).not.toContain("eligible");
  });
});

// ── the window ────────────────────────────────────────────────────────────────

describe("the Coins window", () => {
  it("lists the launchpad's coins with their numbers, and opens Launch", async () => {
    wallet(null);
    net({ rpc: chainRoutes(), get: getRoutes() });
    const open = vi.fn();
    mount("/?do=coins", open);
    const list = await screen.findByLabelText("Coins", { selector: "ul" });
    await waitFor(() => expect(list).toHaveTextContent("test (test)"));
    // MEASURED: ≈ 4.974 ETH for the supply × the captured WETH price, $2,670.91
    expect(list).toHaveTextContent(/vs ETH.*market cap ≈ \$13,28\d\.\d\d · not traded yet · .* · by 0xD5C1…3FAB/);
    const stats = screen.getByLabelText("Launchpad numbers");
    expect(within(stats).getByText("Coins launched").nextSibling).toHaveTextContent("1");
    expect(within(stats).getByText("Volume 24h").nextSibling).toHaveTextContent("—");
    expect(within(stats).getByText("Highest market cap").nextSibling).toHaveTextContent(/^\$13,28\d\.\d\d · test$/);
    expect(screen.getByText(/^The newest 1\. Market caps are read/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Launch a token" }));
    expect(open).toHaveBeenCalledWith("launch");
  });

  it("filters by tab and asset, sorts, and says when nothing matches", async () => {
    wallet(null);
    net({ rpc: chainRoutes(), get: getRoutes() });
    mount("/?do=coins", null);
    // outside the desktop there is no window to open, so no button pretends to
    await screen.findByLabelText("Coins", { selector: "ul" });
    expect(screen.queryByRole("button", { name: "Launch a token" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("option", { name: "ETH" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Stocks" }));
    expect(screen.getByText("No coin matches — try All.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Crypto" }));
    await userEvent.selectOptions(screen.getByLabelText("Paired with"), "ETH");
    expect(screen.getByLabelText("Coins", { selector: "ul" })).toHaveTextContent("test (test)");
    await userEvent.selectOptions(screen.getByLabelText("Paired with"), "");
    for (const label of ["⚡ Vol 24h", "🌱 New", "💧 Liquidity", "🔥 Trending"]) {
      await userEvent.click(screen.getByRole("button", { name: label }));
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
    }
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByLabelText("Coins", { selector: "ul" })).toBeInTheDocument();
  });

  it("shows a listed coin's volume and trades, a pool it could not read, and DexScreener down as nothing", async () => {
    wallet(null);
    // the captured WETH pair, re-pointed at the coin — a variant, built here
    const traded = copy(marketsOf("WETH")) as unknown as { baseToken: { address: string }; txns?: unknown }[];
    traded[0]!.baseToken.address = T;
    traded[0]!.txns = { h24: { buys: 1, sells: 0 } };
    net({ rpc: chainRoutes({ pool: `0x${"0".repeat(64)}` }), get: getRoutes({ coinMarkets: traded }) });
    const a = mount();
    const list = await screen.findByLabelText("Coins", { selector: "ul" });
    await waitFor(() => expect(list).toHaveTextContent(/pair not read/));
    expect(list).toHaveTextContent(/value not read · vol \$[\d,.]+ · 1 trade · /);
    a.unmount();

    // two trades and no volume figure: said as trades, the volume as $0.00 rather than left out
    traded[0]!.txns = { h24: { buys: 2, sells: 0 } };
    (traded[0] as { volume?: unknown }).volume = {};
    net({ rpc: chainRoutes(), get: getRoutes({ coinMarkets: traded }) });
    const b = mount();
    const two = await screen.findByLabelText("Coins", { selector: "ul" });
    await waitFor(() => expect(two).toHaveTextContent("vol $0.00 · 2 trades · "));
    b.unmount();

    net({ rpc: chainRoutes(), get: getRoutes({ coinMarkets: DOWN }) });
    mount();
    const again = await screen.findByLabelText("Coins", { selector: "ul" });
    await waitFor(() => expect(again).toHaveTextContent(/market cap ≈ \$[\d,.]+ · \d+ min ago|market cap ≈ \$[\d,.]+ · \d+ (h|days) ago/));
    expect(again).not.toHaveTextContent("not traded yet");
  });

  it("says when there are none, when the index ran out of pages, and when it could not be read", async () => {
    wallet(null);
    net({ rpc: chainRoutes(), get: getRoutes({ v1: NO_LOGS }) });
    const a = mount();
    expect(await screen.findByText("No coin has been launched here yet.")).toBeInTheDocument();
    a.unmount();

    const endless = { ...copy(LX.blockscoutFactoryLogs), next_page_params: { block_number: 1, index: 1 } };
    net({ rpc: chainRoutes(), get: (u) => (u.startsWith(V1_LOGS) ? endless : getRoutes()(u)) });
    const b = mount();
    expect(await screen.findByText(/from the launchpad's newest logs/)).toBeInTheDocument();
    expect(screen.getByLabelText("Launchpad numbers")).toHaveTextContent(/Coins launched\d+\+/);
    b.unmount();

    net({ rpc: chainRoutes(), get: getRoutes({ v1: DOWN }) });
    mount();
    expect(await screen.findByText(/^The launches could not be read:/)).toBeInTheDocument();
  });

  it("shows at most the newest few", async () => {
    wallet(null);
    const many = copy(LX.blockscoutFactoryLogs) as { items: { topics: string[] }[] };
    many.items = Array.from({ length: SHOWN_COINS + 3 }, (_, i) => ({ ...copy(LX.blockscoutFactoryLogs.items[0]!), transaction_hash: `0x${i.toString(16).padStart(64, "0")}` }));
    // every row is the same coin, so only the count matters; the list is cut, not the total
    net({ rpc: chainRoutes(), get: (u) => (u === V1_LOGS ? many : getRoutes()(u)) });
    mount();
    await screen.findByLabelText("Coins", { selector: "ul" });
    expect(screen.getByLabelText("Launchpad numbers")).toHaveTextContent(`Coins launched${SHOWN_COINS + 3}`);
    expect(screen.getByText(new RegExp(`^The newest ${SHOWN_COINS}\\.`))).toBeInTheDocument();
  });

  it("opens a coin's page by its link, trades it, and goes back to the list", async () => {
    wallet(null);
    net({ rpc: chainRoutes(), get: getRoutes() });
    const open = vi.fn();
    mount("/?do=coins", open);
    await userEvent.click(await screen.findByRole("button", { name: `Open ${T}` }));
    expect(screen.getByLabelText("url")).toHaveTextContent(`t=${T}`);
    await waitFor(() => expect(screen.getByText(/· vs ETH · market cap ≈/)).toBeInTheDocument());
    expect(screen.getByText("test (test)", { selector: "strong" })).toBeInTheDocument();
    // the coin's own pool is the default route (2026-10-14): Relay may not route a minutes-old pool
    expect(screen.getByRole("button", { name: "ETH · its pool" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByLabelText("Amount of ETH")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ETH · Relay" }));
    expect(screen.getByText("ETH → test on Base")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sell test" }));
    await userEvent.click(screen.getByRole("button", { name: "USDC · Relay" }));
    expect(screen.getByText("test → USDC on Base")).toBeInTheDocument();
    // the launcher, one click away: their profile
    await userEvent.click(screen.getByRole("button", { name: `Profile of ${ME}` }));
    expect(open).toHaveBeenCalledWith("profile", { a: ME });
    // the full page, with its sources, folded below the trade
    expect(screen.getByText("Everything about test, with sources")).toBeInTheDocument();
    expect(screen.getByLabelText("test (test)")).toHaveTextContent(/Fees waiting.* ETH \+ 0 tokens waiting/);
    // not the creator's wallet: no collect
    expect(screen.queryByRole("group", { name: "Your fees" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "← All coins" }));
    expect(screen.getByLabelText("url")).not.toHaveTextContent("t=");
    expect(await screen.findByLabelText("Coins", { selector: "ul" })).toBeInTheDocument();
  });

  it("names the launcher without a link outside the desktop", async () => {
    wallet(null);
    net({ rpc: chainRoutes(), get: getRoutes() });
    mount(`/?do=coins&t=${T}`, null);
    await waitFor(() => expect(screen.getByText(/· by 0xD5C1…3FAB$/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: `Profile of ${ME}` })).not.toBeInTheDocument();
  });

  it("lets the creator collect from the coin's page, and runs a verdict on demand", async () => {
    const sent = wallet(ME);
    net({ rpc: chainRoutes(), get: getRoutes() });
    mount(`/?do=coins&t=${T}`);
    const collect = await screen.findByRole("button", { name: "Collect" });
    await waitFor(() => expect(collect).toBeEnabled());
    await userEvent.click(collect);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.to!.toLowerCase()).toBe(LAUNCHPAD.factory.toLowerCase());
    expect(decodeFunctionData({ abi: LAUNCHPAD_ABI, data: sent[0]!.data as `0x${string}` }).args).toEqual([T]);

    verdictMock.fn = () => Promise.resolve({ title: "test — Token Verdict", rows: [row("Verdict", "Caution — 70/100")], notes: [], sources: [] });
    await userEvent.click(screen.getByRole("button", { name: "Run a full verdict on test" }));
    expect(await screen.findByLabelText("test — Token Verdict")).toHaveTextContent("Caution — 70/100");
    verdictMock.fn = null;
  });

  it("says when the verdict could not run, and offers nothing to collect when nothing is waiting", async () => {
    wallet(ME);
    const zero = `0x${"0".repeat(128)}`;
    const routes = chainRoutes();
    net({ rpc: (m, p) => ((p[0] as { data?: string } | undefined)?.data?.startsWith("0x06ec16f8") ? zero : routes(m, p)), get: getRoutes() });
    let fail!: (e: Error) => void;
    verdictMock.fn = () => new Promise((_, reject) => (fail = reject));
    mount(`/?do=coins&t=${T}`);
    const none = await screen.findByRole("button", { name: "No fees waiting" });
    expect(none).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Run a full verdict on test" }));
    expect(screen.getByText(/^Simulating a buy and a sell/)).toBeInTheDocument();
    await act(async () => fail(new Error("Relay could not be reached.")));
    expect(screen.getByText("The verdict could not run: Relay could not be reached.")).toBeInTheDocument();
    verdictMock.fn = null;
  });

  it("refuses a token the launchpad did not launch, shows the list for a link that is not an address, and says when the launchpad is unreachable", async () => {
    wallet(null);
    const OTHER = ADDR.degen;
    // the page asks Blockscout for the token's holders before the launchpad answers: DEGEN's real record
    net({ rpc: chainRoutes(), get: (u) => (u === `${BLOCKSCOUT}/tokens/${OTHER}` ? FX.tokenDegen : getRoutes()(u)) });
    const a = mount(`/?do=coins&t=${OTHER}`);
    expect(await screen.findByText(`${OTHER} was not launched on this app's launchpad. Token Verdict (Safety) can check any token.`)).toBeInTheDocument();
    a.unmount();

    // a mistyped checksum is not a coin's link: the list opens instead
    const b = mount(`/?do=coins&t=${OTHER.replace("4ed4E8", "4ED4E8")}`);
    expect(await screen.findByLabelText("Coins", { selector: "ul" })).toBeInTheDocument();
    b.unmount();

    net({ rpc: (m) => (m === "eth_call" ? DOWN : undefined), get: getRoutes() });
    mount(`/?do=coins&t=${T}`);
    expect(screen.getByText(/^Reading 0xB200…0dF9 from the launchpad/)).toBeInTheDocument();
    expect(await screen.findByText(/^The launchpad could not be read:/)).toBeInTheDocument();
  });

  it("lets go of the list and a coin's page when the window closes mid-read", async () => {
    wallet(null);
    net({ rpc: chainRoutes(), get: getRoutes() });
    // closed before the launches arrive, then before the coins' details do
    mount().unmount();
    await act(async () => {});
    const b = mount();
    await screen.findByLabelText("Coins", { selector: "ul" });
    b.unmount();
    await act(async () => {});
    // a coin's page closed before its record arrives, then before its details do
    mount(`/?do=coins&t=${T}`).unmount();
    await act(async () => {});
    const d = mount(`/?do=coins&t=${T}`);
    await screen.findByText("← All coins");
    await waitFor(() => expect(screen.queryByText(/^Reading 0xB200/)).not.toBeInTheDocument());
    d.unmount();
    await act(async () => {});
  });

  it("still opens a coin's page when its name, pool and fees cannot be read", async () => {
    wallet(null);
    const routes = chainRoutes();
    net({
      rpc: (m, p) => {
        const to = (p[0] as { to?: string } | undefined)?.to?.toLowerCase();
        return to === T.toLowerCase() || to === UNISWAP_V4_POOL_MANAGER.toLowerCase() || (p[0] as { data?: string } | undefined)?.data?.startsWith("0x06ec16f8") ? DOWN : routes(m, p);
      },
      get: getRoutes(),
    });
    mount(`/?do=coins&t=${T}`);
    await waitFor(() => expect(screen.getByText(/vs \? · value not read/)).toBeInTheDocument());
    expect(screen.getByText("0xB200…0dF9", { selector: "strong" })).toBeInTheDocument();
  });

  it("reads the coin's page from the index when it runs, and its holder count from Blockscout", async () => {
    wallet(null);
    // the index's answer is built from its real captures; Blockscout's token record is DEGEN's real one
    // (no capture of this coin's exists), reused only for its holder count
    net({ rpc: chainRoutes(), get: getRoutes({ index: (u) => (u === `/api/launchpad/coin?token=${T}` ? served() : undefined), blockscout: (u) => (u === `${BLOCKSCOUT}/tokens/${T}` ? FX.tokenDegen : undefined) }) });
    mount(`/?do=coins&t=${T}`);
    await waitFor(() => expect(screen.getByLabelText("Numbers")).toHaveTextContent("Holders1,225,549"));
    expect(screen.getByLabelText("Info")).toHaveTextContent("CreatedOct 2, 2026");
  });

  it("an unknown token on Blockscout is holders not read", async () => {
    wallet(null);
    net({ rpc: chainRoutes(), get: getRoutes({ blockscout: (u) => (u === `${BLOCKSCOUT}/tokens/${T}` ? new Response("{}", { status: 404 }) : undefined) }) });
    mount(`/?do=coins&t=${T}`);
    await screen.findByLabelText("Numbers");
    await act(async () => {});
    expect(screen.getByLabelText("Numbers")).toHaveTextContent("Holdersnot read");
  });

  it("opens a listed coin whose launch time was not read, and the newest-launches strip opens a coin", async () => {
    wallet(null);
    // the captured log page with its timestamps removed — a variant, visibly
    const untimed = copy(LX.blockscoutFactoryLogs) as { items: Record<string, unknown>[] };
    for (const i of untimed.items) delete i.block_timestamp;
    const row = (served() as { coin: unknown }).coin;
    net({ rpc: chainRoutes(), get: (u) => (u === V1_LOGS ? untimed : getRoutes({ index: (x) => (x === "/api/launchpad/coins" ? { coins: [row] } : undefined) })(u)) });
    const open = vi.fn();
    mount("/?do=coins", open);
    await userEvent.click(await screen.findByRole("button", { name: `Open ${T}` }));
    expect(await screen.findByLabelText("Info")).toHaveTextContent("Creatednot read");
    const strip = await screen.findByRole("group", { name: "Newest launches" });
    await userEvent.click(within(strip).getByRole("button"));
    expect(open).toHaveBeenCalledWith("coins", { t: T });
  });
});
