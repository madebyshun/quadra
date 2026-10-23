import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { decodeFunctionData } from "viem";
import { LAUNCHPAD_ABI } from "@/config/launchpad";
import { parseTokenBalances } from "@/skills/blockscout";
import type { Launch } from "@/skills/launchpad";
import { activityOf, holdingsOf, lureOf, parseTransfers } from "@/skills/profile";
import { OpenWindowProvider } from "@/features/openWindow";
import { kindText, nameText, ProfilePanel } from "@/features/panels/ProfilePanel";
import { WalletProvider } from "@/ui/WalletProvider";
import { USDC, WETH } from "@/config/chain";
import { LAUNCHPAD, LX } from "./fixtures/launchpad";
import { ADDR } from "./fixtures/base";
import { LOG_PAGES } from "@/skills/launchpad";
import { FAKE_ETH, OWNER, PX } from "./fixtures/profile";
import { DOWN, basenames, ethCalls, net, useNet, type Answer } from "./net";
import { chainRoutes, getRoutes, T, V1_LOGS, wallet } from "./launchpadChain";
import { withoutV3 } from "./v2only";

// Its fixtures are real v2/v1 captures, so it runs as the app did before v3 was set.
withoutV3();

useNet();
vi.mock("@/lib/connectors", () => ({ walletConnectProvider: vi.fn(), coinbaseProvider: vi.fn() }));

/**
 * Profile — a wallet as a person sees it — against the owner's REAL wallet as Blockscout had it
 * (an address-poisoning campaign in its history, MEASURED) and the first real launch.
 */

const TEST2 = PX.transfersOwner.items.find((i) => i.token.symbol === "test2")!.token.address_hash;
/** The SHAPE of the owner's account code, MEASURED 2026-09-30: 0xef0100 ‖ a delegate — here a stand-in delegate, not a real one. */
const DELEGATED = `0xef0100${"11".repeat(20)}`;
/** Base's L2 resolver, as measured for the Basenames tests. */
const RESOLVER = ADDR.l2Resolver;
const names = ethCalls(basenames({ resolver: RESOLVER }));

function routes(over: { balances?: Answer; transfers?: Answer; v1?: Answer; holding?: bigint } = {}) {
  return {
    rpc: chainRoutes({ code: DELEGATED, holding: over.holding ?? 5n * 10n ** 24n, calls: names }),
    // the owner's captured lists, answered for whichever address is looked at
    get: (u: string) =>
      u.endsWith("/token-balances") ? (over.balances ?? PX.balancesOwner) : u.endsWith("/token-transfers?type=ERC-20") ? (over.transfers ?? PX.transfersOwner) : getRoutes(over.v1 ? { v1: over.v1 } : {})(u),
  };
}

function Where() {
  const l = useLocation();
  return <output aria-label="url">{l.search}</output>;
}

function mount(path: string, open: ((id: string) => void) | null = vi.fn()) {
  const panel = (
    <WalletProvider>
      <ProfilePanel />
      <Where />
    </WalletProvider>
  );
  return render(<MemoryRouter initialEntries={[path]}>{open ? <OpenWindowProvider open={open}>{panel}</OpenWindowProvider> : panel}</MemoryRouter>);
}

const firstLaunch: Launch = { factory: LAUNCHPAD.factory, token: T, creator: OWNER, block: 52_066_747, at: new Date("2026-10-02T06:34:01Z"), tx: LAUNCHPAD.launchTx };

describe("reading a wallet's history", () => {
  it("reads Blockscout's transfers, skipping a row that is not one", () => {
    const moved = parseTransfers(PX.transfersOwner);
    expect(moved).toHaveLength(PX.transfersOwner.items.length);
    expect(moved.find((m) => m.symbol === "test2")).toMatchObject({ token: TEST2, decimals: 18, raw: 7_240_617_127_768_094_861_783n, to: OWNER });
    const [real] = PX.transfersOwner.items;
    const odd = [
      "junk",
      { ...real, token: { ...real!.token, address_hash: null } },
      { ...real, total: { value: "x" } },
      { ...real, total: { value: "1" }, token: { ...real!.token, decimals: null } },
      { ...real, timestamp: null, transaction_hash: null, token: { ...real!.token, symbol: null } },
    ];
    expect(parseTransfers({ items: odd })).toEqual([expect.objectContaining({ at: null, tx: "", symbol: "?" })]);
    expect(parseTransfers(null)).toEqual([]);
  });

  it("names a lure by its look-alike characters, or by a famous ticker at the wrong contract", () => {
    expect(lureOf("ETH", FAKE_ETH)).toBe("it calls itself ETH, but ETH is not a token");
    expect(lureOf("E឵Τ឵H", FAKE_ETH)).toBe("its name is built from look-alike or invisible characters");
    expect(lureOf("ꓴ឵ՏᎠ឵Ꮳ", FAKE_ETH)).toBe("its name is built from look-alike or invisible characters");
    expect(lureOf("USDC", USDC.address)).toBeNull();
    expect(lureOf("usdc", FAKE_ETH)).toBe("it calls itself usdc, but it is not usdc's contract");
    expect(lureOf("WETH", WETH.address.toUpperCase())).toBeNull();
    expect(lureOf("VRAX", FAKE_ETH)).toBeNull();
  });

  it("tells the owner's real history from the poisoning: launches, a buy, airdrops, and every fake named", () => {
    const items = activityOf(OWNER, parseTransfers(PX.transfersOwner), [firstLaunch], new Set([TEST2.toLowerCase()]));
    const bad = items.filter((i) => i.tone === "bad");
    // MEASURED: 11 of the first 16 transfers are look-alikes or a fake "ETH"
    expect(bad).toHaveLength(PX.transfersOwner.items.filter((i) => lureOf(i.token.symbol, i.token.address_hash)).length);
    expect(bad.some((i) => i.text.startsWith('Fake transfer of "ETH" made to look like you sent it to 0x00FDCd'))).toBe(true);
    expect(bad.some((i) => i.text.startsWith('Fake "ETH" received from'))).toBe(true);
    expect(items.find((i) => i.text.includes("test2"))!.text).toMatch(/^Received 7,240\.6171 test2 \(a coin launched here\) from 0x0a2854/);
    expect(items.find((i) => i.text.startsWith("Sent 0.1 USDC"))).toBeDefined();
    expect(items.find((i) => i.text.includes("VRAX"))!.text).toContain("an unsolicited airdrop, most likely; never approve it");
    expect(items.find((i) => i.text.startsWith("Launched a coin here"))).toMatchObject({ tx: LAUNCHPAD.launchTx });
    // newest first, and a row with no time last
    const times = items.map((i) => i.at?.getTime() ?? 0);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(activityOf(OWNER, [{ ...parseTransfers(PX.transfersOwner)[0]!, at: null }], [firstLaunch], new Set()).at(-1)!.at).toBeNull();
  });

  it("shows priced tokens and coins launched here, and counts the rest — lures never listed", () => {
    const balances = parseTokenBalances(PX.balancesOwner);
    const cobee = balances.find((b) => b.symbol === "cobee")!.token;
    const none = holdingsOf(balances, new Set(), () => null);
    expect(none.shown.map((h) => h.symbol)).toEqual(["USDC"]);
    expect(none.hidden).toBe(balances.length - 1);
    // the same B20, treated as a coin launched here: valued from its pool, listed above USDC when worth more
    const asCoin = holdingsOf(balances, new Set([cobee.toLowerCase()]), () => 1);
    expect(asCoin.shown.map((h) => [h.symbol, h.coin, h.usd])).toEqual([
      ["cobee", true, 25],
      ["USDC", false, 7.690836 * 0.999876],
    ]);
    // a coin whose pool could not be valued still shows, without a figure, after the priced ones
    expect(holdingsOf(balances, new Set([cobee.toLowerCase()]), () => null).shown.at(-1)).toMatchObject({ symbol: "cobee", usd: null });
    // a priced token with a lure's name, and an empty balance, are not shown
    const lure = { ...balances[0]!, symbol: "ETH", token: FAKE_ETH };
    expect(holdingsOf([lure, { ...balances[0]!, raw: 0n }], new Set(), () => null)).toEqual({ shown: [], hidden: 1 });
  });

  it("says what an account is and whether its Basename is true", () => {
    expect(kindText(null)).toBe("not read");
    expect(kindText({ kind: "wallet" })).toBe("a wallet");
    expect(kindText({ kind: "delegated", to: OWNER })).toBe("a wallet with a smart-account delegation (EIP-7702)");
    expect(kindText({ kind: "contract" })).toBe("a contract");
    expect(nameText(null)).toEqual({ text: "not read", bad: false });
    expect(nameText({ kind: "none" })).toEqual({ text: "no Basename", bad: false });
    expect(nameText({ kind: "verified", name: "shun.base.eth" })).toEqual({ text: "shun.base.eth", bad: false });
    expect(nameText({ kind: "unverified", name: "shun.base.eth", pointsTo: null })).toEqual({ text: "shun.base.eth — unverified: it points to nothing", bad: true });
    expect(nameText({ kind: "unverified", name: "x.base.eth", pointsTo: T }).text).toContain(`it points to ${T}`);
  });
});

describe("the Profile window", () => {
  it("asks for a wallet or an address when it has neither", async () => {
    wallet(null);
    net({});
    mount("/?do=profile");
    await act(async () => {});
    expect(screen.getByText(/^Connect a wallet to see your own profile/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Look up" })).toBeDisabled();
  });

  it("shows anybody's profile by its link: who, holdings, coins launched, and the poisoned history", async () => {
    wallet(null);
    net(routes());
    const open = vi.fn();
    mount(`/?do=profile&a=${OWNER}`, open);
    const who = await screen.findByLabelText("Who");
    await waitFor(() => expect(who).toHaveTextContent("Launched here1 coin"));
    expect(who).toHaveTextContent(`Address${OWNER}`);
    expect(who).toHaveTextContent("Basenameno Basename");
    expect(who).toHaveTextContent("Accounta wallet with a smart-account delegation (EIP-7702)");
    expect(who).not.toHaveTextContent("— you");

    const holdings = await screen.findByLabelText("Holdings");
    expect(holdings).toHaveTextContent(/^0\.001 ETH\$\d/);
    expect(holdings).toHaveTextContent("7.6908 USDCcheck$7.69");
    // the coin, read from the chain (5,000,000 of the billion) and valued from its pool
    expect(within(holdings).getByRole("button", { name: "5,000,000 test" })).toBeInTheDocument();
    expect(holdings).toHaveTextContent("a coin launched here — valued from its own pool");
    expect(screen.getByText(/more hidden: tokens with no price or a look-alike name/)).toBeInTheDocument();
    await userEvent.click(within(holdings).getByRole("button", { name: "5,000,000 test" }));
    // the coin's own page, by its address
    expect(open).toHaveBeenCalledWith("coins", { t: T });
    // a priced token is one click from its verdict, in the Safety window
    await userEvent.click(within(holdings).getByRole("button", { name: `verdict ${USDC.address}` }));
    expect(open).toHaveBeenCalledWith("safety", { "run-safety": `verdict ${USDC.address}` });

    await userEvent.click(screen.getByRole("button", { name: "Coins launched" }));
    const coins = screen.getByLabelText("Coins launched", { selector: "ul" });
    expect(coins).toHaveTextContent("test (test)");
    expect(coins).toHaveTextContent("vs ETH");
    expect(coins).toHaveTextContent(" ETH + 0 tokens waiting");
    // not the viewer's own: nothing to collect
    expect(screen.queryByRole("button", { name: /Collect all/ })).not.toBeInTheDocument();
    await userEvent.click(within(coins).getByRole("button", { name: "test (test)" }));
    expect(open).toHaveBeenLastCalledWith("coins", { t: T });

    await userEvent.click(screen.getByRole("button", { name: "Activity" }));
    const activity = await screen.findByLabelText("Activity", { selector: "ul" });
    expect(activity).toHaveTextContent("Launched a coin here");
    expect(activity).toHaveTextContent("Address poisoning: never copy an address from your history.");
    expect(activity.querySelectorAll("li.tx__bad").length).toBeGreaterThan(5);
  });

  it("is your own when the wallet is connected: marked as you, with Collect all", async () => {
    const sent = wallet(OWNER);
    net(routes());
    mount("/?do=profile");
    const who = await screen.findByLabelText("Who");
    await waitFor(() => expect(who).toHaveTextContent(`${OWNER} — you`));
    await userEvent.click(screen.getByRole("button", { name: "Coins launched" }));
    const collect = await screen.findByRole("button", { name: "Collect all — 1 with fees waiting" });
    await userEvent.click(collect);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(decodeFunctionData({ abi: LAUNCHPAD_ABI, data: sent[0]!.data as `0x${string}` }).args).toEqual([T]);
  });

  it("offers nothing to collect on your own profile when no fees are waiting", async () => {
    wallet(OWNER);
    const zero = `0x${"0".repeat(128)}`;
    const r = routes();
    net({ rpc: (m, p) => ((p[0] as { data?: string } | undefined)?.data?.startsWith("0x06ec16f8") ? zero : r.rpc(m, p)), get: r.get });
    mount("/?do=profile");
    await screen.findByLabelText("Who");
    await userEvent.click(screen.getByRole("button", { name: "Coins launched" }));
    expect(await screen.findByRole("button", { name: "No fees waiting" })).toBeDisabled();
  });

  it("says a Basename that does not point back is unverified, in red, and an account it could not read", async () => {
    wallet(null);
    const claims = ethCalls(basenames({ resolver: RESOLVER, reverse: { [OWNER]: "shun.base.eth" }, forward: { "shun.base.eth": T } }));
    const r = routes();
    net({
      rpc: (m, p) => (m === "eth_getCode" ? DOWN : chainRoutes({ holding: 0n, calls: claims })(m, p)),
      get: r.get,
    });
    mount(`/?do=profile&a=${OWNER}`);
    const who = await screen.findByLabelText("Who");
    await waitFor(() => expect(who).toHaveTextContent(`Basenameshun.base.eth — unverified: it points to ${T}`));
    expect(within(who).getByText(/unverified/)).toHaveClass("tx__bad");
    expect(who).toHaveTextContent("Accountnot read");
  });

  it("opens the Base card program, which asks for an X handle — no address is passed", async () => {
    wallet(null);
    net(routes());
    const open = vi.fn();
    mount(`/?do=profile&a=${OWNER}`, open);
    await screen.findByLabelText("Holdings");
    await userEvent.click(screen.getByRole("button", { name: "Base card" }));
    await userEvent.click(screen.getByRole("button", { name: "Make my Base card" }));
    expect(open).toHaveBeenCalledWith("card");
  });

  it("says when the launchpad's index ran out of pages, and shows an undated, unlinked movement plainly", async () => {
    wallet(null);
    const endless = { ...LX.blockscoutFactoryLogs, next_page_params: { block_number: 1, index: 1 } };
    const [first] = PX.transfersOwner.items;
    const r = routes({ transfers: { items: [{ ...first, timestamp: null, transaction_hash: null }] }, balances: PX.balancesOwner.filter((b) => b.token.symbol === "USDC") });
    net({ rpc: r.rpc, get: (u) => (u.startsWith(V1_LOGS) ? endless : r.get(u)) });
    mount(`/?do=profile&a=${OWNER}`);
    const who = await screen.findByLabelText("Who");
    await waitFor(() => expect(who).toHaveTextContent("in the launchpad's newest logs"));
    // nothing hidden: no "more hidden" line
    await screen.findByLabelText("Holdings");
    expect(screen.queryByText(/more hidden/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Activity" }));
    const activity = await screen.findByLabelText("Activity", { selector: "ul" });
    expect(activity.querySelectorAll("a")).toHaveLength(LOG_PAGES);
    expect(activity).toHaveTextContent(/^.*Received 99 VRAX/);
  });

  it("looks up another address, and goes back to your own", async () => {
    wallet(OWNER);
    net(routes());
    mount("/?do=profile");
    await screen.findByLabelText("Who");
    await userEvent.type(screen.getByLabelText("Look up"), T);
    await userEvent.click(screen.getByRole("button", { name: "Look up" }));
    expect(screen.getByLabelText("url")).toHaveTextContent(`a=${T}`);
    await userEvent.click(screen.getByRole("button", { name: "Mine" }));
    expect(screen.getByLabelText("url")).not.toHaveTextContent("a=");
  });

  it("says when a name does not resolve, and when each part could not be read", async () => {
    wallet(null);
    net(routes());
    const a = mount("/?do=profile&a=nobody");
    expect(screen.getByText("Finding nobody…")).toBeInTheDocument();
    expect(await screen.findByText("Profile: no Basename called nobody.base.eth points to an address.")).toBeInTheDocument();
    a.unmount();

    // Blockscout down: the launchpad, the holdings and the history all say so
    net({ rpc: routes().rpc, get: () => DOWN });
    const b = mount(`/?do=profile&a=${OWNER}`);
    const who = await screen.findByLabelText("Who");
    await waitFor(() => expect(who).toHaveTextContent("Launched herenot read"));
    expect(screen.getByText(/^Could not read the holdings: /)).toBeInTheDocument();
    b.unmount();

    // the launchpad read, the wallet's own lists not
    net(routes({ balances: DOWN, transfers: DOWN }));
    mount(`/?do=profile&a=${OWNER}`);
    expect(await screen.findByText(/^Could not read the holdings: /)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Activity" }));
    expect(await screen.findByText(/^Could not read the activity: /)).toBeInTheDocument();
  });

  it("says when an address launched nothing and moved nothing, and leaves a coin's page unlinked outside the desktop", async () => {
    wallet(null);
    net(routes({ transfers: { items: [] }, holding: 0n }));
    mount(`/?do=profile&a=${LAUNCHPAD.factory}`, null);
    await screen.findByLabelText("Who");
    await userEvent.click(screen.getByRole("button", { name: "Coins launched" }));
    expect(await screen.findByText("This address has launched no coin here.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Activity" }));
    expect(await screen.findByText("No token movements on record.")).toBeInTheDocument();
  });

  it("values nothing it could not read: a coin with no pool, an ETH price that did not come", async () => {
    wallet(null);
    // the captured WETH market gone, the coin's pool, name and fees unreadable
    const r = routes();
    const chain = chainRoutes({ code: "0x", holding: 10n ** 24n, calls: names, pool: `0x${"0".repeat(64)}` });
    net({
      rpc: (m, p) => {
        const call = p[0] as { to?: string; data?: string } | undefined;
        const tokenRead = m === "eth_call" && call?.to?.toLowerCase() === T.toLowerCase() && !call.data!.startsWith("0x70a08231");
        return tokenRead || call?.data?.startsWith("0x06ec16f8") ? DOWN : chain(m, p);
      },
      get: (u) => (u.includes(WETH.address) ? DOWN : r.get(u)),
    });
    mount(`/?do=profile&a=${OWNER}`);
    const holdings = await screen.findByLabelText("Holdings");
    await waitFor(() => expect(holdings).toHaveTextContent("price not read"));
    expect(holdings).toHaveTextContent("value not read");
    expect(holdings).toHaveTextContent("1,000,000 unnamed");
    expect(screen.getByLabelText("Who")).toHaveTextContent("Accounta wallet");
    await userEvent.click(screen.getByRole("button", { name: "Coins launched" }));
    const coins = screen.getByLabelText("Coins launched", { selector: "ul" });
    expect(coins).toHaveTextContent("pair not read");
    expect(coins).toHaveTextContent("0xB200…0dF9");
    expect(coins).toHaveTextContent("fees could not be read");
  });
});
