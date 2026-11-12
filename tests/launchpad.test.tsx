import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, erc20Abi, parseAbiParameters } from "viem";
import { BASE, UNISWAP_V4_POOL_MANAGER } from "@/config/chain";
import { LAUNCHPAD_ABI, LAUNCHPAD_EXPECTS } from "@/config/launchpad";
import {
  checkFactory,
  collectTx,
  contractUri,
  launchedIn,
  launchFactory,
  launchPairs,
  launchTx,
  metadataProblem,
  newSalt,
  openingValue,
  openingValueEth,
  predictToken,
  quoteOf,
  startTickFor,
  type Metadata,
  type Pair,
} from "@/adapters/http/launchpad";
import { forgetCatalog } from "@/adapters/http/markets";
import { STOCKS_PATH } from "@/server/stocks";
import { BaseLaunch, feesText, quoteAmount, readFirstBuy, reviewReport, SHOWN_LAUNCHES, STOCK_PAIR_PRICE_NOTE, SUGGESTIONS, suggestion, valueText } from "@/features/panels/BaseLaunch";
import { LaunchPanel } from "@/features/panels/LaunchPanel";
import { OpenWindowProvider } from "@/features/openWindow";
import { WalletProvider } from "@/ui/WalletProvider";
import { toChecksumAddress } from "@/lib/address";
import type { Eip1193Provider, Eip1193Request } from "@/lib/wallet";
import type { Receipt } from "@/lib/transact";
import { contractAt, DOWN, ethCalls, net, simulated, useNet, type Answer } from "./net";
import { copy } from "./fixtures/base";
import { LX } from "./fixtures/launchpad";
import { MARKETS_FX } from "./fixtures/markets";
import { BLOCKSCOUT } from "@/skills/blockscout";
import { withoutV3 } from "./v2only";

// Its fixtures are real v2/v1 captures, so it runs as the app did before v3 was set.
withoutV3();

useNet();

/**
 * The launchpad's browser half. The contract itself is tested in Solidity (contracts/test) and
 * against real Base state (scripts/simulate-launchpad.ts); what is tested here is that this
 * window talks to THAT contract — the same signatures, the same numbers — and refuses anything
 * that is not it.
 */

const pinned = vi.hoisted(() => ({
  factory: null as string | null,
  v1: null as string | null,
  treasury: "0xD5C1dFc036F9911348EA8065F73c8123f4013FAB" as string | null,
}));

vi.mock("@/config/chain", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/config/chain")>();
  const CONTRACTS = new Proxy(real.CONTRACTS, {
    get: (target, key) =>
      key === "launchFactory"
        ? pinned.factory
        : key === "launchFactoryV1"
          ? pinned.v1
          : key === "treasury"
            ? pinned.treasury
            : target[key as keyof typeof target],
  });
  return { ...real, CONTRACTS };
});
vi.mock("@/lib/connectors", () => ({ walletConnectProvider: vi.fn(), coinbaseProvider: vi.fn() }));

const FACTORY = "0x5b73C5498c1E3b4dbA84de0F1833c4a029d90519";
/** A stand-in for v1 — not an address anything is deployed at. */
const V1 = "0x00000000000000000000000000000000000000F1";
const ETH_Q = "0x0000000000000000000000000000000000000000";
/** Apple's stock token on Base, from Coinbase's captured list: 8 decimals */
const AAPL = toChecksumAddress("0xb200000000000000000000C2e324d24d7eEcd1fb".toLowerCase());
/** DraftKings': its transfers were paused in the capture */
const DKNG = toChecksumAddress("0xb2000000000000000000009b870441031d4d8a41");
/** NVDAc's tick as scripts/quote-ticks.ts measured it on 2026-10-02 */
const STOCK_TICK = 396_800;
const ETH_PAIR: Pair = { address: ETH_Q, symbol: "ETH", name: "Ether", decimals: 18, startTick: LAUNCHPAD_EXPECTS.startTick };
const AAPL_PAIR: Pair = { address: AAPL, symbol: "AAPLc", name: "Apple Inc.", decimals: 8, startTick: STOCK_TICK };
const TOKEN = "0xB200000000000000000000e326469391488619D9";
const ME = "0xabcdef0123456789abcdef0123456789abcdef01";
const HASH = `0x${"ef".repeat(32)}`;
const SALT = `0x${"11".repeat(32)}` as const;
const META: Metadata = { name: "Night Cat", symbol: "NCAT", description: "a cat 🐈", image: "https://img.example/cat.png", website: "https://cat.example" };

type Quotes = Record<string, readonly [boolean, number]>;
/** The quotes the factory has enabled: ETH at the deploy's tick, and Apple's stock. */
const QUOTES: Quotes = { [ETH_Q]: [true, LAUNCHPAD_EXPECTS.startTick], [AAPL.toLowerCase()]: [true, STOCK_TICK] };

/** A launch record as `launches(token)` answers it — the token sorted against its quote by address. */
function record(token: string, quote = ETH_Q) {
  const [currency0, currency1] = BigInt(token) < BigInt(quote) ? [token, quote] : [quote, token];
  return { creator: ME, creatorRecipient: ME, key: { currency0, currency1, fee: 10_000, tickSpacing: 200, hooks: ETH_Q } };
}

/** What the deployed factory answers — the owner's choices — with any field overridden. */
function factory(over: Partial<Record<string, unknown>> = {}, quotes: Quotes = QUOTES, launched: Record<string, unknown> = {}) {
  const getters = contractAt(LAUNCHPAD_ABI, {
    TOTAL_SUPPLY: LAUNCHPAD_EXPECTS.supply,
    LP_FEE: LAUNCHPAD_EXPECTS.lpFee,
    CREATOR_SHARE_BPS: LAUNCHPAD_EXPECTS.creatorShareBps,
    protocolRecipient: pinned.treasury ?? ME,
    predictToken: TOKEN,
    // what `collect` would pay right now, read as a call
    collect: [10n ** 15n, 0n],
    ...over,
  });
  return (data: `0x${string}`): `0x${string}` => {
    const { functionName, args } = decodeFunctionData({ abi: LAUNCHPAD_ABI, data });
    const key = String(args?.[0]).toLowerCase();
    if (functionName === "quotes") return encodeFunctionResult({ abi: LAUNCHPAD_ABI, functionName, result: quotes[key] ?? [false, 0] });
    if (functionName === "launches") {
      const r = launched[key] ?? record(toChecksumAddress(key));
      return encodeFunctionResult({ abi: LAUNCHPAD_ABI, functionName, result: r as never });
    }
    return getters(data);
  };
}

/** Apple's stock token as a contract: one balance for anyone, 8 decimals, its symbol. */
function erc20(balance: bigint) {
  return contractAt(erc20Abi, { balanceOf: balance, decimals: 8, symbol: "AAPLc" });
}

/** A v4 pool's slot0 word at a tick: sqrtPriceX96 = sqrt(1.0001^tick) · 2^96, in the low 160 bits. */
function slot0At(tick: number): `0x${string}` {
  const sqrt = BigInt(Math.round(Math.sqrt(1.0001 ** tick) * 2 ** 48)) << 48n;
  return `0x${sqrt.toString(16).padStart(64, "0")}`;
}

function launchedLog(token = TOKEN, eth = 10n ** 17n, tokens = 9n * 10n ** 25n) {
  return {
    address: FACTORY,
    topics: encodeEventTopics({
      abi: LAUNCHPAD_ABI,
      eventName: "Launched",
      args: { token: token as `0x${string}`, creator: ME as `0x${string}`, poolId: `0x${"22".repeat(32)}` },
    }) as string[],
    data: encodeAbiParameters(parseAbiParameters("uint256, uint256"), [eth, tokens]),
  };
}

describe("held to the Solidity", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const source = readFileSync(resolve(root, "contracts/src/LaunchFactory.sol"), "utf8").replace(/\s+/g, " ");
  const script = readFileSync(resolve(root, "contracts/script/DeployLaunchFactory.s.sol"), "utf8");

  /** A signature that drifted would send a call the contract does not have — found only on chain. */
  it("finds every function and event this window calls, word for word, in the contract", () => {
    for (const piece of [
      "function launch( string calldata name, string calldata symbol, string calldata contractURI, bytes32 salt, address quote, uint256 quoteIn ) external payable nonReentrant returns (address token)",
      "function collect(address token) external nonReentrant returns (uint256 amount0, uint256 amount1)",
      "function predictToken(address caller, bytes32 salt) external view returns (address)",
      "uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;",
      "uint24 public constant LP_FEE = 10_000;",
      "uint16 public constant CREATOR_SHARE_BPS = 8_000;",
      "struct Quote { bool enabled;",
      "int24 startTick; }",
      "mapping(address quote => Quote) public quotes;",
      "address public protocolRecipient;",
      "address creatorRecipient; PoolKey key; }",
      "function launches(address token) external view returns (Launch memory)",
      "event Launched( address indexed token, address indexed creator, PoolId indexed poolId, uint256 devBuyIn, uint256 devBuyTokens );",
    ]) {
      expect(source, piece).toContain(piece);
    }
    expect(LAUNCHPAD_EXPECTS.supply).toBe(1_000_000_000n * 10n ** 18n);
  });

  it("expects the opening tick and the fee address the deploy script deploys with", () => {
    expect(script).toContain(`int24 internal constant START_TICK = ${LAUNCHPAD_EXPECTS.startTick.toLocaleString("en-US").replace(/,/g, "_")};`);
    expect(script).toContain(`address internal constant TREASURY = ${pinned.treasury};`);
  });
});

describe("the launch transaction", () => {
  it("names the first thing a launch would be refused for", () => {
    const ok = { ...META };
    expect(metadataProblem(ok)).toBeNull();
    expect(metadataProblem({ ...ok, name: " " })).toBe("Enter a name");
    expect(metadataProblem({ ...ok, name: "x".repeat(51) })).toBe("Name is over 50 characters");
    expect(metadataProblem({ ...ok, symbol: "N CAT" })).toBe("Enter a symbol (1–11 characters, no spaces)");
    expect(metadataProblem({ ...ok, description: "x".repeat(281) })).toBe("Description is over 280 characters");
    expect(metadataProblem({ ...ok, image: "http://img.example/cat.png" })).toBe("Image must be an https:// link");
    expect(metadataProblem({ ...ok, website: "cat.example" })).toBe("Website must be an https:// link");
    expect(metadataProblem({ ...ok, image: "", website: "", description: "" })).toBeNull();
  });

  it("stores the metadata on the token itself, as a data: URI, UTF-8 intact, without empty fields", () => {
    const decode = (uri: string) => {
      expect(uri.startsWith("data:application/json;base64,")).toBe(true);
      const bytes = Uint8Array.from(atob(uri.slice(uri.indexOf(",") + 1)), (c) => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, string>;
    };
    expect(decode(contractUri({ ...META, name: " Night Cat " }))).toEqual({
      name: "Night Cat",
      symbol: "NCAT",
      description: "a cat 🐈",
      image: "https://img.example/cat.png",
      external_link: "https://cat.example",
    });
    expect(decode(contractUri({ ...META, description: "", image: "", website: "" }))).toEqual({ name: "Night Cat", symbol: "NCAT" });
  });

  it("draws a new 32-byte salt every time", () => {
    const a = newSalt();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(newSalt()).not.toBe(a);
  });

  it("sends to the factory, an ETH first buy as its value and a stock's as an argument only", () => {
    const tx = launchTx(FACTORY, META, SALT, ETH_PAIR, 5n);
    expect(tx.to).toBe(FACTORY);
    expect(tx.value).toBe(5n);
    const { functionName, args } = decodeFunctionData({ abi: LAUNCHPAD_ABI, data: tx.data! });
    expect(functionName).toBe("launch");
    expect(args).toEqual(["Night Cat", "NCAT", contractUri(META), SALT, ETH_Q, 5n]);
    const stock = launchTx(FACTORY, META, SALT, AAPL_PAIR, 7n);
    expect(stock.value).toBe(0n);
    expect(decodeFunctionData({ abi: LAUNCHPAD_ABI, data: stock.data! }).args).toEqual(["Night Cat", "NCAT", contractUri(META), SALT, AAPL, 7n]);
    const collect = decodeFunctionData({ abi: LAUNCHPAD_ABI, data: collectTx(FACTORY, TOKEN).data! });
    expect([collect.functionName, collect.args]).toEqual(["collect", [TOKEN]]);
  });

  it("values the whole supply at about 5 ETH at the opening price", () => {
    expect(openingValueEth()).toBeCloseTo(4.97, 2);
    expect(openingValueEth(0)).toBe(1e9);
  });

  /** MEASURED 2026-10-02 by scripts/quote-ticks.ts: NVDAc's NAV $231.42 and ETH's price gave 396800, ≈ 58.6 NVDAc. */
  it("prices a stock pair in the stock's own 8 decimals, and finds the tick that matches a dollar value", () => {
    expect(openingValue(STOCK_TICK, 8)).toBeCloseTo(58.6, 1);
    // the same tick read as an 18-decimal quote would be ten orders of magnitude off (hard rule 3)
    expect(openingValue(STOCK_TICK, 18) / openingValue(STOCK_TICK, 8)).toBeCloseTo(1e-10, 15);
    expect(startTickFor(58.6 * 231.42, 231.42, 8)).toBe(STOCK_TICK);
    expect(startTickFor(openingValueEth() * 4000, 4000, 18)).toBe(LAUNCHPAD_EXPECTS.startTick);
  });
});

describe("the factory on Base", () => {
  it("is waiting until the owner deploys it, and checksummed once they have", () => {
    pinned.factory = null;
    expect(launchFactory()).toEqual({ waiting: expect.stringContaining("not deployed yet") });
    pinned.factory = FACTORY.toLowerCase();
    expect(launchFactory()).toEqual({ address: FACTORY, version: 2 });
    pinned.factory = null;
  });

  it("is accepted only when every number it reports is the one this build expects", async () => {
    net({ rpc: ethCalls({ [FACTORY]: factory() }) });
    expect(await checkFactory(FACTORY)).toEqual({ kind: "ok" });
    for (const [over, why] of [
      [{ TOTAL_SUPPLY: 1n }, `its supply is 1, not ${LAUNCHPAD_EXPECTS.supply}`],
      [{ LP_FEE: 3000 }, "its pool fee is 3000, not 10000"],
      [{ CREATOR_SHARE_BPS: 5000 }, "its launcher share is 5000 bps, not 8000"],
      [{ ethTick: 0 }, "its ETH opening tick is 0, not 191200"],
      // viem reads an address back checksummed
      [{ protocolRecipient: ME }, `its protocol share goes to ${toChecksumAddress(ME)}, not to this app's fee address`],
    ] as const) {
      const { ethTick, ...rest } = over as { ethTick?: number };
      net({ rpc: ethCalls({ [FACTORY]: factory(rest, ethTick === undefined ? QUOTES : { [ETH_Q]: [true, ethTick] }) }) });
      const check = await checkFactory(FACTORY);
      expect(check).toEqual({ kind: "refused", why: `This build will not sign for the launchpad at ${FACTORY}: ${why}. Nothing was sent.` });
    }
  });

  it("is refused while this app has no fee address at all", async () => {
    pinned.treasury = null;
    net({ rpc: ethCalls({ [FACTORY]: factory({ protocolRecipient: ME }) }) });
    expect((await checkFactory(FACTORY)).kind).toBe("refused");
    pinned.treasury = "0xD5C1dFc036F9911348EA8065F73c8123f4013FAB";
  });

  it("predicts the token's address, checksummed", async () => {
    net({ rpc: ethCalls({ [FACTORY]: factory({ predictToken: TOKEN.toLowerCase() }) }) });
    expect(await predictToken(FACTORY, ME, SALT)).toBe(TOKEN);
  });

  it("reads what really launched from the factory's own event, and nothing from anyone else's", () => {
    const receipt = (logs: Receipt["logs"]): Receipt => ({ status: "success", blockNumber: 5n, logs } as unknown as Receipt);
    const other = { address: "0x0000000000000000000000000000000000000001", topics: launchedLog().topics, data: launchedLog().data };
    const payment = { address: FACTORY, topics: [`0x${"33".repeat(32)}`], data: "0x" };
    expect(launchedIn(receipt([other, payment, launchedLog()]), FACTORY)).toEqual({ token: TOKEN, devBuyIn: 10n ** 17n, devBuyTokens: 9n * 10n ** 25n });
    expect(launchedIn(receipt([other, payment]), FACTORY)).toBeNull();
  });

  it("reads a pair as the factory has it, and offers only the stocks it enabled, by address", async () => {
    forgetCatalog();
    const stocksAndEth = { ...QUOTES, [DKNG.toLowerCase()]: [true, STOCK_TICK] as const };
    net({ get: (u) => (u === `${STOCKS_PATH}/base` ? MARKETS_FX.coinbaseStocks : undefined), rpc: ethCalls({ [FACTORY]: factory({}, stocksAndEth) }) });
    expect(await quoteOf(FACTORY, AAPL)).toEqual({ enabled: true, startTick: STOCK_TICK });
    // DraftKings is enabled on the factory but its transfers are paused: it is not offered, nor even asked about
    expect(await launchPairs(FACTORY)).toEqual({ pairs: [ETH_PAIR, AAPL_PAIR], problem: null });
  });

  it("keeps ETH when the stock list cannot be read, says why, and drops ETH if the factory disabled it", async () => {
    forgetCatalog();
    net({ get: (u) => (u === `${STOCKS_PATH}/base` ? DOWN : undefined), rpc: ethCalls({ [FACTORY]: factory({}, {}) }) });
    expect(await launchPairs(FACTORY)).toEqual({ pairs: [], problem: "This app's server could not be reached for the list of stocks on Base." });
    forgetCatalog();
  });
});

describe("the window", () => {
  function wallet(account: string | null) {
    const sent: Record<string, string>[] = [];
    const provider: Eip1193Provider = {
      request(args: Eip1193Request) {
        if (args.method === "eth_accounts") return Promise.resolve(account ? [account] : []);
        if (args.method === "eth_chainId") return Promise.resolve(BASE.idHex);
        if (args.method === "eth_sendTransaction") {
          sent.push(args.params?.[0] as Record<string, string>);
          return Promise.resolve(HASH);
        }
        return Promise.reject(new Error(`unstubbed ${args.method}`));
      },
    };
    vi.stubGlobal("ethereum", provider);
    return sent;
  }

  /** The factory's captured log page, re-pointed at this test's factory, token and wallet — a variant, built here. */
  function myLogs(): unknown {
    const page = copy(LX.blockscoutFactoryLogs);
    for (const item of page.items) {
      item.topics[1] = `0x${TOKEN.slice(2).toLowerCase().padStart(64, "0")}`;
      item.topics[2] = `0x${ME.slice(2).padStart(64, "0")}`;
    }
    return page;
  }

  /** Base for the window: the factory's reads, Coinbase's stock list, the wallet's ETH and Apple shares, the simulation and the receipt. */
  function chain(
    w: {
      balance?: bigint;
      shares?: bigint;
      factory?: Partial<Record<string, unknown>>;
      quotes?: Quotes;
      launched?: Record<string, unknown>;
      logs?: unknown[];
      mine?: Answer;
      v1?: Answer;
      v1Calls?: (data: `0x${string}`) => `0x${string}`;
      stocks?: Answer;
      slot0?: `0x${string}`;
      /** DexScreener: down unless a test gives it an answer */
      dex?: Answer;
      /** the visitor's country (lib/region.ts) — unread unless given */
      country?: string;
    } = {},
  ) {
    const calls = ethCalls({
      [FACTORY]: factory(w.factory, w.quotes, w.launched),
      [AAPL]: erc20(w.shares ?? 10n ** 8n),
      // every pool reads as freshly opened at the ETH tick, unless a test says otherwise
      [UNISWAP_V4_POOL_MANAGER]: () => w.slot0 ?? slot0At(LAUNCHPAD_EXPECTS.startTick),
      ...(w.v1Calls ? { [V1]: w.v1Calls } : {}),
    });
    return net({
      get: (u) =>
        u === "/api/region" && w.country
          ? { country: w.country }
          : u === `${STOCKS_PATH}/base`
          ? (w.stocks ?? MARKETS_FX.coinbaseStocks)
          : u.startsWith(`${BLOCKSCOUT}/addresses/${FACTORY}/logs`)
            ? (w.mine ?? myLogs())
            : u.startsWith(`${BLOCKSCOUT}/addresses/${V1}/logs`)
              ? (w.v1 ?? { items: [], next_page_params: null })
              : u.startsWith("https://api.dexscreener.com/")
                ? (w.dex ?? DOWN)
                : undefined,
      rpc: (m, p) =>
        simulated()(m, p) ??
        (m === "eth_getBalance"
          ? `0x${(w.balance ?? 10n ** 18n).toString(16)}`
          : m === "eth_getTransactionReceipt"
            ? { status: "0x1", blockNumber: "0x5", logs: w.logs ?? [launchedLog()] }
            : calls(m, p)),
    });
  }

  function mount(node = <BaseLaunch />) {
    return render(<WalletProvider>{node}</WalletProvider>);
  }

  /** the launch's one call to action (the collect form below has its own button) */
  const cta = () => document.querySelector<HTMLButtonElement>(".mf__cta")!;

  async function fill(firstBuy = "", pair?: string) {
    if (pair) {
      await screen.findByRole("option", { name: new RegExp(pair) });
      await userEvent.selectOptions(screen.getByLabelText("Paired with"), screen.getByRole("option", { name: new RegExp(pair) }));
    }
    await userEvent.type(screen.getByLabelText("Name"), "Night Cat");
    await userEvent.type(screen.getByLabelText("Symbol"), "NCAT");
    if (firstBuy) await userEvent.type(screen.getByLabelText("First buy"), firstBuy);
  }

  it("says it is waiting for the deploy, and offers nothing to sign until then", async () => {
    pinned.factory = null;
    wallet(ME);
    mount();
    await act(async () => {});
    expect(screen.getByLabelText("Launchpad status")).toHaveTextContent("not deployed yet");
    await fill();
    expect(cta()).toHaveTextContent("Not deployed yet");
    expect(cta()).toBeDisabled();
    // with neither factory deployed there is nothing to list or collect
    expect(screen.queryByRole("group", { name: "Your launches" })).not.toBeInTheDocument();
  });

  it("names what is missing, in order", async () => {
    pinned.factory = FACTORY;
    wallet(null);
    chain();
    const first = mount();
    await act(async () => {});
    expect(cta()).toHaveTextContent("Connect a wallet first");
    first.unmount();
    wallet(ME);
    mount();
    await act(async () => {});
    expect(cta()).toHaveTextContent("Enter a name");
    await fill("abc");
    expect(cta()).toHaveTextContent(/^First buy: /);
    await userEvent.clear(screen.getByLabelText("First buy"));
    expect(cta()).toHaveTextContent("Review launch");
    pinned.factory = null;
  });

  it("reads a blank first buy as none, and an amount exactly in the pair's own decimals", () => {
    expect(readFirstBuy(" ", 18)).toEqual({ raw: 0n });
    expect(readFirstBuy("0.25", 18)).toEqual({ raw: 25n * 10n ** 16n });
    expect(readFirstBuy("0.25", 8)).toEqual({ raw: 25n * 10n ** 6n });
    expect(readFirstBuy("0.000000001", 8)).toHaveProperty("problem");
    expect(readFirstBuy("1e3", 18)).toHaveProperty("problem");
  });

  it("checks the factory, predicts the token, launches, and says what really launched", async () => {
    pinned.factory = FACTORY;
    const sent = wallet(ME);
    chain();
    mount();
    await act(async () => {});
    await fill("0.1");
    await userEvent.click(cta());
    const review = await screen.findByLabelText(/ready to launch on Base/);
    expect(review).toHaveTextContent(`${TOKEN} (predicted`);
    expect(review).toHaveTextContent("1,000,000,000 NCAT, fixed — no admin, nobody can mint, pause or seize");
    expect(review).toHaveTextContent("0.1 ETH, in the same transaction, before anyone else can buy");
    expect(review).toHaveTextContent("the whole supply ≈ 4.97 ETH at the first price");
    expect(review).not.toHaveTextContent("Coinbase");
    expect(screen.queryByText(/DexScreener, and the bots/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Launch in wallet" }));
    await waitFor(() => expect(screen.getByText(/^Live:/)).toBeInTheDocument());
    expect(screen.getByText(/^Live:/)).toHaveTextContent("your first buy: 90,000,000 for 0.1 ETH");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to!.toLowerCase()).toBe(FACTORY.toLowerCase());
    expect(BigInt(sent[0]!.value!)).toBe(10n ** 17n);
    // any edit throws the review away
    await userEvent.type(screen.getByLabelText("Name"), "!");
    expect(screen.queryByLabelText(/ready to launch on Base/)).not.toBeInTheDocument();
    pinned.factory = null;
  });

  it("shows a launch with no first buy, and says so when the receipt carries no Launched event", async () => {
    pinned.factory = FACTORY;
    wallet(ME);
    chain({ logs: [] });
    mount();
    await act(async () => {});
    await fill();
    await userEvent.click(cta());
    expect(await screen.findByLabelText(/ready to launch on Base/)).toHaveTextContent("First buynone");
    await userEvent.click(screen.getByRole("button", { name: "Launch in wallet" }));
    expect(await screen.findByText(/Launched event could not be read/)).toBeInTheDocument();
    pinned.factory = null;
  });

  it("launches with no first buy, with a description and links in the metadata", async () => {
    pinned.factory = FACTORY;
    const sent = wallet(ME);
    chain({ logs: [launchedLog(TOKEN, 0n, 0n)] });
    mount();
    await act(async () => {});
    await fill();
    await userEvent.type(screen.getByLabelText("Description"), "a cat");
    await userEvent.type(screen.getByLabelText("Image"), "https://img.example/cat.png");
    await userEvent.type(screen.getByLabelText("Website"), "https://cat.example");
    await userEvent.click(cta());
    await userEvent.click(await screen.findByRole("button", { name: "Launch in wallet" }));
    await waitFor(() => expect(screen.getByText(/^Live:/)).toBeInTheDocument());
    expect(screen.getByText(/^Live:/)).not.toHaveTextContent("first buy");
    const { args } = decodeFunctionData({ abi: LAUNCHPAD_ABI, data: sent[0]!.data as `0x${string}` });
    expect(args[2]).toBe(contractUri({ name: "Night Cat", symbol: "NCAT", description: "a cat", image: "https://img.example/cat.png", website: "https://cat.example" }));
    pinned.factory = null;
  });

  it("refuses a factory that answers different numbers, and a wallet without the ETH", async () => {
    pinned.factory = FACTORY;
    wallet(ME);
    chain({ factory: { LP_FEE: 3000 } });
    const first = mount();
    await act(async () => {});
    await fill();
    await userEvent.click(cta());
    expect(await screen.findByLabelText("Launch error")).toHaveTextContent("This build will not sign for the launchpad");
    first.unmount();

    chain({ balance: 10n ** 16n });
    mount();
    await act(async () => {});
    await fill("1");
    await userEvent.click(cta());
    expect(await screen.findByLabelText("Launch error")).toHaveTextContent("Not enough ETH: the first buy and gas need more than the 0.01 ETH");
    pinned.factory = null;
  });

  it("collects a token's fees from the wallet, once a valid address is given", async () => {
    pinned.factory = FACTORY;
    const sent = wallet(ME);
    chain();
    mount();
    await act(async () => {});
    const collect = () => screen.getByRole("button", { name: /Enter a token|Token|Collect$/ });
    expect(collect()).toHaveTextContent("Enter a token address");
    await userEvent.type(screen.getByLabelText("Token to collect for"), "0x12");
    expect(collect()).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("Token to collect for"));
    await userEvent.type(screen.getByLabelText("Token to collect for"), TOKEN);
    await userEvent.click(collect());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(decodeFunctionData({ abi: LAUNCHPAD_ABI, data: sent[0]!.data as `0x${string}` }).args).toEqual([TOKEN]);
    pinned.factory = null;
  });

  it("asks for a wallet before collecting", async () => {
    pinned.factory = FACTORY;
    wallet(null);
    mount();
    await act(async () => {});
    await userEvent.type(screen.getByLabelText("Token to collect for"), TOKEN);
    // the launch button and the collect button both ask for it
    expect(screen.getAllByRole("button", { name: "Connect a wallet first" })).toHaveLength(2);
    pinned.factory = null;
  });

  it("lists the wallet's own launches with the fees waiting, and collects one, then reads them again", async () => {
    pinned.factory = FACTORY;
    const sent = wallet(ME);
    const asked = chain();
    mount();
    const list = await screen.findByLabelText("Your launches", { selector: "ul" });
    expect(list).toHaveTextContent("0xB200…19D9");
    expect(list).toHaveTextContent("0.001 ETH + 0 tokens waiting — 80% of it to you");
    // read from the pool; with DexScreener down there is no ETH price, so it is said in ETH
    expect(list).toHaveTextContent("4.97 ETH for the supply");
    await userEvent.click(screen.getByRole("button", { name: `Collect ${TOKEN}` }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(decodeFunctionData({ abi: LAUNCHPAD_ABI, data: sent[0]!.data as `0x${string}` }).args).toEqual([TOKEN]);
    // after the collection the list is read again
    const listReads = () => asked.filter((c) => c.url.startsWith(`${BLOCKSCOUT}/addresses/${FACTORY}/logs`)).length;
    await waitFor(() => expect(listReads()).toBe(2));
    pinned.factory = null;
  });

  it("says when there are no launches, when the index ran out of pages, and when it could not be read", async () => {
    pinned.factory = FACTORY;
    wallet(ME);
    chain({ mine: { items: [], next_page_params: null } });
    const a = mount();
    expect(await screen.findByText("No launches from this wallet.")).toBeInTheDocument();
    a.unmount();

    const endless = { ...(myLogs() as object), next_page_params: { block_number: 1, index: 1 } } as unknown as { items: { topics: string[] }[] };
    endless.items = endless.items.map((i) => ({ ...i, topics: [i.topics[0]!, i.topics[1]!, `0x${"0".repeat(63)}1`] }));
    chain({ mine: endless });
    const b = mount();
    expect(await screen.findByText("No launches from this wallet in the launchpad's newest logs.")).toBeInTheDocument();
    b.unmount();

    chain({ mine: DOWN });
    mount();
    expect(await screen.findByText(/^Your launches could not be read:/)).toBeInTheDocument();
    pinned.factory = null;
  });

  it("does not offer to collect what is not there or could not be read, and shows at most the newest few", async () => {
    pinned.factory = FACTORY;
    wallet(ME);
    const many = myLogs() as { items: unknown[] };
    many.items = Array.from({ length: SHOWN_LAUNCHES + 2 }, (_, i) => {
      const item = copy(many.items[0]) as { topics: string[]; block_timestamp: string | null };
      item.topics[1] = `0x${(BigInt(TOKEN) + BigInt(i)).toString(16).padStart(64, "0")}`;
      // an index row with no timestamp still lists, without "launched …"
      item.block_timestamp = null;
      return item;
    });
    chain({ mine: many, factory: { collect: [0n, 0n] } });
    mount();
    const list = await screen.findByLabelText("Your launches", { selector: "ul" });
    expect(list.querySelectorAll("li")).toHaveLength(SHOWN_LAUNCHES);
    expect(list).toHaveTextContent("no fees waiting");
    expect(screen.getByRole("button", { name: `Collect ${TOKEN}` })).toBeDisabled();
    expect(list).not.toHaveTextContent("launched");
    pinned.factory = null;
  });

  /** Linked to the coin pages (2026-10-02): a launch just made, and each of yours, open their page in Coins. */
  it("opens a coin's own page from the launch just made and from Your launches", async () => {
    pinned.factory = FACTORY;
    wallet(ME);
    chain();
    const open = vi.fn();
    render(
      <OpenWindowProvider open={open}>
        <WalletProvider>
          <BaseLaunch />
        </WalletProvider>
      </OpenWindowProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: `Open ${TOKEN}` }));
    expect(open).toHaveBeenCalledWith("coins", { t: TOKEN });
    await fill();
    await userEvent.click(cta());
    await userEvent.click(await screen.findByRole("button", { name: "Launch in wallet" }));
    await userEvent.click(await screen.findByRole("button", { name: "its page here" }));
    expect(open).toHaveBeenLastCalledWith("coins", { t: TOKEN });
    pinned.factory = null;
  });

  it("says when a launch's fees could not be read, and offers nothing to collect for it", async () => {
    pinned.factory = FACTORY;
    wallet(ME);
    chain({ factory: { collect: undefined } });
    mount();
    const list = await screen.findByLabelText("Your launches", { selector: "ul" });
    expect(list).toHaveTextContent("fees could not be read");
    expect(screen.getByRole("button", { name: `Collect ${TOKEN}` })).toBeDisabled();
    pinned.factory = null;
  });

  it("suggests a famous computer for the name and symbol, each one launchable as written", async () => {
    expect(suggestion(0)).toEqual({ name: "ENIAC", symbol: "ENIAC" });
    expect(suggestion(0.9999)).toBe(SUGGESTIONS.at(-1));
    for (const s of SUGGESTIONS) expect(metadataProblem({ name: s.name, symbol: s.symbol, description: "", image: "", website: "" }), s.name).toBeNull();
    vi.spyOn(Math, "random").mockReturnValue(0.35);
    pinned.factory = null;
    wallet(null);
    mount();
    await act(async () => {});
    expect(screen.getByLabelText("Name")).toHaveAttribute("placeholder", "e.g. Commodore 64");
    expect(screen.getByLabelText("Symbol")).toHaveAttribute("placeholder", "e.g. C64");
    vi.restoreAllMocks();
  });

  it("says no stock is enabled yet, rather than leaving ETH alone unexplained", async () => {
    forgetCatalog();
    pinned.factory = FACTORY;
    wallet(ME);
    chain({ quotes: { [ETH_Q]: [true, LAUNCHPAD_EXPECTS.startTick] } });
    mount();
    expect(await screen.findByText(/^No stock is enabled on the launchpad yet/)).toBeInTheDocument();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["ETH"]);
    pinned.factory = null;
  });

  it("words the fees for each case, in the quote's own units", () => {
    expect(feesText(null, [])).toBe("fees could not be read");
    expect(feesText({ quote: ETH_Q, inQuote: 0n, inToken: 0n }, [])).toBe("no fees waiting");
    expect(feesText({ quote: ETH_Q, inQuote: 2n * 10n ** 15n, inToken: 15n * 10n ** 20n }, [])).toBe(
      "0.002 ETH + 1,500 tokens waiting — 80% of it to you",
    );
    expect(feesText({ quote: AAPL.toLowerCase(), inQuote: 10n ** 6n, inToken: 0n }, [AAPL_PAIR])).toBe("0.01 AAPLc + 0 tokens waiting — 80% of it to you");
    // a stock the list no longer has: raw units, named by address, never guessed at 18 decimals
    expect(quoteAmount(123n, AAPL, [])).toBe("123 raw units of 0xb200…d1fb");
  });

  it("writes a review that names what was checked, and for a stock, who issues it", () => {
    const r = reviewReport(META, { factory: FACTORY, salt: SALT, token: TOKEN, pair: ETH_PAIR, firstBuy: 0n }, ME);
    expect(r.title).toBe("Night Cat (NCAT) — ready to launch on Base");
    expect(r.sources).toEqual(["the launchpad on Base (read directly)"]);
    const stock = reviewReport(META, { factory: FACTORY, salt: SALT, token: TOKEN, pair: AAPL_PAIR, firstBuy: 5n * 10n ** 7n }, ME);
    const by = (label: string) => stock.rows.find((x) => x.label === label);
    expect(by("Paired with")).toMatchObject({ value: "AAPLc — Apple Inc., Coinbase's stock token on Base", href: expect.stringContaining(AAPL) });
    expect(by("Opening value")?.value).toMatch(/^the whole supply ≈ 58\.\d+ AAPLc at the first price/);
    expect(by("First buy")?.value).toBe("0.5 AAPLc, in the same transaction, before anyone else can buy — an exact approval first");
    expect(stock.notes.join(" ")).toContain("only for eligible persons outside the U.S.");
    expect(stock.sources).toContain("Coinbase's tokenized stocks API (the list)");
  });

  it("launches against a stock: lists the enabled ones, approves exactly the first buy, then launches", async () => {
    pinned.factory = FACTORY;
    const sent = wallet(ME);
    chain({ logs: [launchedLog(TOKEN, 5n * 10n ** 7n)] });
    mount();
    await act(async () => {});
    // only what the factory enabled is offered: ETH and Apple, not the other four stocks
    await screen.findByRole("option", { name: /AAPLc/ });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["ETH", "AAPLc — Apple Inc."]);
    await userEvent.type(screen.getByLabelText("First buy"), "0.3");
    await fill("0.5", "AAPLc");
    // picking a pair cleared the amount typed for the other one
    expect(screen.getByLabelText("First buy")).toHaveValue("0.5");
    expect(screen.getByText("AAPLc", { selector: ".unit" })).toBeInTheDocument();
    await userEvent.click(cta());
    const review = await screen.findByLabelText(/ready to launch on Base/);
    expect(review).toHaveTextContent("Coinbase's stocks are only for eligible persons outside the U.S.");
    expect(review).toHaveTextContent(STOCK_PAIR_PRICE_NOTE);
    // the form says it too, before anything is reviewed — and only for a stock pair
    expect(screen.getAllByText(new RegExp(STOCK_PAIR_PRICE_NOTE.slice(0, 40))).length).toBeGreaterThan(1);
    await userEvent.click(screen.getByRole("button", { name: "Launch in wallet" }));
    await waitFor(() => expect(screen.getByText(/^Live:/)).toBeInTheDocument());
    expect(screen.getByText(/^Live:/)).toHaveTextContent("your first buy: 90,000,000 for 0.5 AAPLc");
    expect(sent).toHaveLength(2);
    expect(sent[0]!.to!.toLowerCase()).toBe(AAPL.toLowerCase());
    expect(decodeFunctionData({ abi: erc20Abi, data: sent[0]!.data as `0x${string}` }).args).toEqual([FACTORY, 5n * 10n ** 7n]);
    expect(sent[1]!.to!.toLowerCase()).toBe(FACTORY.toLowerCase());
    expect(BigInt(sent[1]!.value ?? "0x0")).toBe(0n);
    expect(decodeFunctionData({ abi: LAUNCHPAD_ABI, data: sent[1]!.data as `0x${string}` }).args.slice(4)).toEqual([AAPL, 5n * 10n ** 7n]);
    pinned.factory = null;
  });

  it("offers a U.S. visitor ETH alone, and says why", async () => {
    pinned.factory = FACTORY;
    wallet(ME);
    chain({ country: "US" });
    mount();
    await act(async () => {});
    await screen.findByText(/not offered where you are/);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["ETH"]);
  });

  it("launches against a stock with no first buy in one signature, nothing to approve", async () => {
    pinned.factory = FACTORY;
    const sent = wallet(ME);
    chain({ logs: [launchedLog(TOKEN, 0n, 0n)] });
    mount();
    await act(async () => {});
    await fill("", "AAPLc");
    await userEvent.click(cta());
    await userEvent.click(await screen.findByRole("button", { name: "Launch in wallet" }));
    await waitFor(() => expect(screen.getByText(/^Live:/)).toBeInTheDocument());
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to!.toLowerCase()).toBe(FACTORY.toLowerCase());
    pinned.factory = null;
  });

  it("refuses a stock the factory disabled since the list was read, too few shares, and too little ETH for gas", async () => {
    pinned.factory = FACTORY;
    wallet(ME);
    const quotes: Record<string, readonly [boolean, number]> = { ...QUOTES };
    chain({ quotes });
    const a = mount();
    await act(async () => {});
    await fill("", "AAPLc");
    delete quotes[AAPL.toLowerCase()];
    await userEvent.click(cta());
    expect(await screen.findByLabelText("Launch error")).toHaveTextContent("The launchpad no longer pairs with AAPLc. Nothing was sent.");
    a.unmount();

    chain({ shares: 10n ** 7n });
    const b = mount();
    await act(async () => {});
    await fill("0.5", "AAPLc");
    await userEvent.click(cta());
    expect(await screen.findByLabelText("Launch error")).toHaveTextContent("Not enough AAPLc: the first buy needs 0.5 and this wallet holds 0.1.");
    b.unmount();

    chain({ balance: 10n ** 12n });
    mount();
    await act(async () => {});
    await fill("", "AAPLc");
    await userEvent.click(cta());
    expect(await screen.findByLabelText("Launch error")).toHaveTextContent("Not enough ETH for gas: this wallet holds 0.000001 ETH on Base.");
    pinned.factory = null;
  });

  it("offers ETH alone, and says why, when the stock list cannot be read", async () => {
    forgetCatalog();
    pinned.factory = FACTORY;
    wallet(ME);
    chain({ stocks: DOWN });
    mount();
    expect(await screen.findByText(/^Stock pairs are not listed right now: /)).toBeInTheDocument();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["ETH"]);
    forgetCatalog();
    pinned.factory = null;
  });

  it("says nothing about pairs when the factory cannot be read for them", async () => {
    forgetCatalog();
    pinned.factory = FACTORY;
    wallet(ME);
    net({
      get: (u) => (u === `${STOCKS_PATH}/base` ? MARKETS_FX.coinbaseStocks : u.includes("/logs") ? { items: [], next_page_params: null } : undefined),
      rpc: (m) => (m === "eth_call" ? DOWN : undefined),
    });
    mount();
    expect(await screen.findByText(/^Stock pairs are not listed right now: /)).toBeInTheDocument();
    pinned.factory = null;
  });

  it("lists launches from version 1 while version 2 waits, and collects each on its own factory", async () => {
    pinned.factory = null;
    pinned.v1 = V1;
    const sent = wallet(ME);
    // the stock-paired launch is a v2 shape; on v1 every launch is ETH, which is all this needs
    chain({ v1: myLogs(), v1Calls: factory() });
    mount();
    const list = await screen.findByLabelText("Your launches", { selector: "ul" });
    expect(list).toHaveTextContent("0.001 ETH + 0 tokens waiting");
    expect(cta()).toHaveTextContent("Not deployed yet");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["ETH"]);
    await userEvent.click(screen.getByRole("button", { name: `Collect ${TOKEN}` }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.to!.toLowerCase()).toBe(V1.toLowerCase());
    pinned.v1 = null;
  });

  it("finds a pasted token's factory before collecting, and refuses a token neither launched", async () => {
    pinned.factory = FACTORY;
    pinned.v1 = V1;
    const sent = wallet(ME);
    const nobody = { creator: ETH_Q, creatorRecipient: ETH_Q, key: { currency0: ETH_Q, currency1: ETH_Q, fee: 0, tickSpacing: 0, hooks: ETH_Q } };
    const OTHER = "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed";
    chain({ launched: { [TOKEN.toLowerCase()]: nobody, [OTHER.toLowerCase()]: nobody }, v1Calls: factory({}, QUOTES, { [OTHER.toLowerCase()]: nobody }) });
    mount();
    await act(async () => {});
    await userEvent.type(screen.getByLabelText("Token to collect for"), TOKEN);
    await userEvent.click(screen.getByRole("button", { name: "Collect" }));
    // not on v2, so v1
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.to!.toLowerCase()).toBe(V1.toLowerCase());
    await userEvent.clear(screen.getByLabelText("Token to collect for"));
    await userEvent.type(screen.getByLabelText("Token to collect for"), OTHER);
    await userEvent.click(screen.getByRole("button", { name: "Collect" }));
    expect(await screen.findByText(`${OTHER} was not launched on this app's launchpad.`)).toBeInTheDocument();
    expect(sent).toHaveLength(1);
    pinned.factory = null;
    pinned.v1 = null;
  });

  it("shows a stock-paired launch's fees in the stock", async () => {
    pinned.factory = FACTORY;
    wallet(ME);
    chain({ launched: { [TOKEN.toLowerCase()]: record(TOKEN, AAPL) }, factory: { collect: [10n ** 6n, 5n * 10n ** 20n] } });
    mount();
    const list = await screen.findByLabelText("Your launches", { selector: "ul" });
    await waitFor(() => expect(list).toHaveTextContent("0.01 AAPLc + 500 tokens waiting"));
    pinned.factory = null;
  });

  it("values each launch from its own pool, in USD when the quote's price is known", async () => {
    // the captured WETH market, so ETH has a real price
    pinned.factory = FACTORY;
    wallet(ME);
    chain({ dex: MARKETS_FX.dexBase });
    mount();
    const list = await screen.findByLabelText("Your launches", { selector: "ul" });
    await waitFor(() => expect(list).toHaveTextContent(/market cap ≈ \$[\d,]+\.\d\d/));
    pinned.factory = null;
  });

  it("says when a launch's pool could not be read", async () => {
    pinned.factory = FACTORY;
    wallet(ME);
    chain({ slot0: `0x${"0".repeat(64)}` });
    mount();
    const list = await screen.findByLabelText("Your launches", { selector: "ul" });
    await waitFor(() => expect(list).toHaveTextContent("value not read"));
    pinned.factory = null;
  });

  it("words a pool value with and without a USD price", () => {
    const v = { quote: AAPL, quoteSymbol: "AAPLc", quoteDecimals: 8, supplyInQuote: 40.9, quoteUsd: 331.25 };
    expect(valueText(v)).toBe("market cap ≈ $13,548.13");
    expect(valueText({ ...v, quoteUsd: null })).toBe("40.9 AAPLc for the supply");
    expect(valueText(null)).toBe("value not read");
  });
});

describe("the Launch window", () => {
  it("is this app's launchpad and nothing else — o1 was taken out on 2026-10-02", async () => {
    pinned.factory = null;
    render(
      <WalletProvider>
        <LaunchPanel />
      </WalletProvider>,
    );
    await act(async () => {});
    expect(screen.getByLabelText("Launchpad status")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "o1" })).not.toBeInTheDocument();
  });
});
