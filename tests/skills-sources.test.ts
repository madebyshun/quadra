import { describe, expect, it } from "vitest";
import {
  BLOCKSCOUT,
  parseHolders,
  parseToken,
  parseTokenBalances,
  partyOf,
  priced,
  tokenBalances,
  tokenInfo,
  topHolders,
} from "@/skills/blockscout";
import { BATCH, deepest, ethUsd, markets, marketsOf, parseMarkets, type Market } from "@/skills/dexscreener";
import { flagOf, parseScan, scan } from "@/skills/goplus";
import { ADDR, copy, FX } from "./fixtures/base";
import { net, urls, useNet } from "./net";

useNet();

describe("Blockscout: a party", () => {
  it("prefers a Basename over an indexer label, and marks contracts", () => {
    expect(partyOf({ hash: "0xa", ens_domain_name: "jesse.base.eth", name: "Wallet", is_contract: true })).toEqual({
      address: "0xa",
      label: "jesse.base.eth",
      isContract: true,
    });
    expect(partyOf({ hash: "0xa", ens_domain_name: null, name: "GnosisSafeProxy" })).toEqual({
      address: "0xa",
      label: "GnosisSafeProxy",
      isContract: false,
    });
    expect(partyOf({ hash: "0xa" })?.label).toBeNull();
  });

  it("is null without an address", () => {
    expect(partyOf(null)).toBeNull();
    expect(partyOf({ name: "x" })).toBeNull();
  });
});

describe("Blockscout: token balances", () => {
  const parsed = parseTokenBalances(FX.tokenBalancesJesse);

  /**
   * The capture holds 18 entries: 12 priced ERC-20s, two unpriced, one ERC-20 with no
   * decimals, one with `token: null`, one ERC-721 and one ERC-1155. Only the ERC-20s whose
   * amount can be read survive — 14.
   */
  it("keeps readable ERC-20s and drops NFTs, null tokens and tokens with no decimals", () => {
    expect(FX.tokenBalancesJesse).toHaveLength(18);
    expect(parsed).toHaveLength(14);
    expect(parsed.map((b) => b.symbol)).not.toContain("AERO-CL-POS");
  });

  it("reads amount, decimals and price as Blockscout sends them", () => {
    const usdc = parsed.find((b) => b.symbol === "USDC")!;
    expect(usdc).toEqual({
      token: ADDR.usdc,
      symbol: "USDC",
      // MEASURED: Blockscout names it "USDC", not the contract's own "USD Coin"
      name: "USDC",
      decimals: 6,
      raw: 4_244_385_701n,
      price: 0.999838,
    });
  });

  it("leaves an unpriced token's price null rather than zero", () => {
    expect(parsed.find((b) => b.symbol === "SHIBASE")?.price).toBeNull();
  });

  it("names a token with no symbol or name as ?", () => {
    const [first] = copy(FX.tokenBalancesJesse);
    const token = first!.token as Record<string, unknown>;
    token.symbol = null;
    token.name = "";
    expect(parseTokenBalances([first])[0]).toMatchObject({ symbol: "?", name: "?" });
  });

  it("drops an entry with an unreadable amount or address", () => {
    const [a, b] = copy(FX.tokenBalancesJesse);
    a!.value = "not a number";
    (b!.token as Record<string, unknown>).address_hash = null;
    expect(parseTokenBalances([a, b, "junk"])).toEqual([]);
    expect(parseTokenBalances({ items: [] })).toEqual([]);
  });

  it("lists only priced tokens, by USD value, largest first", () => {
    const list = priced(parsed);
    expect(list.every((p) => p.token.price !== null && p.token.raw > 0n)).toBe(true);
    expect(list.map((p) => p.value)).toEqual([...list.map((p) => p.value)].sort((a, b) => b - a));
    expect(list.map((p) => p.token.symbol)).not.toContain("SHIBASE");
    expect(priced([{ ...parsed[0]!, raw: 0n }])).toEqual([]);
  });

  it("fetches from the address's token-balances", async () => {
    net({ get: urls({ [`${BLOCKSCOUT}/addresses/${ADDR.jesse}/token-balances`]: FX.tokenBalancesJesse }) });
    expect(await tokenBalances(ADDR.jesse)).toHaveLength(14);
  });
});

describe("Blockscout: a token", () => {
  it("reads DEGEN", () => {
    expect(parseToken(FX.tokenDegen)).toEqual({
      address: ADDR.degen,
      symbol: "DEGEN",
      name: "Degen",
      decimals: 18,
      totalSupply: 36083622668802065124373821514n,
      holders: 1225549,
      price: 0.00108986,
      type: "ERC-20",
    });
  });

  it("is null without an address or decimals", () => {
    expect(parseToken(null)).toBeNull();
    expect(parseToken({ ...FX.tokenDegen, address_hash: null })).toBeNull();
    expect(parseToken({ ...FX.tokenDegen, decimals: null })).toBeNull();
  });

  it("fills what is missing with ? and null", () => {
    expect(parseToken({ address_hash: "0xa", decimals: "8" })).toEqual({
      address: "0xa",
      symbol: "?",
      name: "?",
      decimals: 8,
      totalSupply: null,
      holders: null,
      price: null,
      type: null,
    });
  });

  it("fetches it, and reads a 404 as no token", async () => {
    net({
      get: urls({
        [`${BLOCKSCOUT}/tokens/${ADDR.degen}`]: FX.tokenDegen,
        [`${BLOCKSCOUT}/tokens/0xnone`]: new Response("{}", { status: 404 }),
      }),
    });
    expect((await tokenInfo(ADDR.degen))?.symbol).toBe("DEGEN");
    expect(await tokenInfo("0xnone")).toBeNull();
  });
});

describe("Blockscout: holders", () => {
  it("reads each holder and amount", () => {
    const parsed = parseHolders(FX.holdersDegen);
    expect(parsed).toHaveLength(12);
    expect(parsed[0]).toEqual({
      holder: { address: "0x06A19654e0872Ba71c2261EA691Ecf8a0c677156", label: "GnosisSafeProxy", isContract: true },
      raw: 8146548469706150495940807558n,
    });
  });

  it("skips entries it cannot read", () => {
    expect(parseHolders({ items: [{ address: null, value: "1" }, { address: { hash: "0xa" }, value: "x" }, 7] })).toEqual([]);
    expect(parseHolders(null)).toEqual([]);
  });

  it("fetches the first page", async () => {
    net({ get: urls({ [`${BLOCKSCOUT}/tokens/${ADDR.degen}/holders`]: FX.holdersDegen }) });
    expect(await topHolders(ADDR.degen)).toHaveLength(12);
  });
});

describe("DexScreener", () => {
  /** MEASURED: an array of pairs, prices as strings, created-at in milliseconds. */
  it("reads DEGEN's market", () => {
    expect(parseMarkets(FX.dexscreenerDegen)).toEqual([
      {
        dex: "uniswap",
        pair: "0xc9034c3E7F58003E6ae0C8438e7c8f4598d5ACAA",
        priceUsd: 0.001091,
        liquidityUsd: 132845.39,
        volume24h: 93013.41,
        createdAt: 1704655845000,
        quote: "WETH",
        url: "https://dexscreener.com/base/0xc9034c3e7f58003e6ae0c8438e7c8f4598d5acaa",
        buys24h: FX.dexscreenerDegen[0]!.txns.h24.buys,
        sells24h: FX.dexscreenerDegen[0]!.txns.h24.sells,
        base: ADDR.degen,
        symbol: "DEGEN",
        marketCap: FX.dexscreenerDegen[0]!.marketCap,
      },
    ]);
  });

  it("reads a pair with nothing in it as unknowns, and ignores junk", () => {
    expect(parseMarkets([{}, 3, null])).toEqual([
      {
        dex: "?",
        pair: null,
        priceUsd: null,
        liquidityUsd: null,
        volume24h: null,
        createdAt: null,
        quote: "?",
        url: null,
        buys24h: null,
        sells24h: null,
        base: null,
        symbol: null,
        marketCap: null,
      },
    ]);
    expect(parseMarkets({ pairs: [] })).toEqual([]);
  });

  it("picks the deepest market, and none from none", () => {
    const m = (liquidityUsd: number | null): Market => ({ ...parseMarkets([{}])[0]!, liquidityUsd });
    expect(deepest([])).toBeNull();
    expect(deepest([m(5), m(50), m(null)])?.liquidityUsd).toBe(50);
    // a market with no reported depth is still a market, not "none found"
    const [only] = [m(null)];
    expect(deepest([only!])).toBe(only);
    expect(deepest([m(null), m(0)])?.liquidityUsd).toBe(0);
  });

  it("fetches the token's pairs on Base", async () => {
    net({ get: urls({ [`https://api.dexscreener.com/tokens/v1/base/${ADDR.degen}`]: FX.dexscreenerDegen }) });
    expect(await markets(ADDR.degen)).toHaveLength(1);
  });

  it("asks for up to a batch of tokens in one request, and asks for nothing when given none", async () => {
    const tokens = Array.from({ length: BATCH + 2 }, (_, i) => `0x${String(i).padStart(40, "0")}`);
    const calls = net({ get: urls({ [`https://api.dexscreener.com/tokens/v1/base/${tokens.slice(0, BATCH).join(",")}`]: FX.dexscreenerDegen }) });
    expect(await marketsOf(tokens)).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(await marketsOf([])).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("prices ETH from the deepest WETH market, and says null rather than guess", async () => {
    const weth = "https://api.dexscreener.com/tokens/v1/base/0x4200000000000000000000000000000000000006";
    net({ get: urls({ [weth]: [{ priceUsd: "2660.28", liquidity: { usd: 9 } }] }) });
    expect(await ethUsd()).toBe(2660.28);
    net({ get: urls({ [weth]: [] }) });
    expect(await ethUsd()).toBeNull();
    net({ get: urls({ [weth]: new Response("", { status: 500 }) }) });
    expect(await ethUsd()).toBeNull();
  });
});

describe("GoPlus", () => {
  it("reads a flag three ways, and never reads absence as no", () => {
    expect(flagOf("1")).toBe("yes");
    expect(flagOf("0")).toBe("no");
    expect(flagOf("")).toBe("unknown");
    expect(flagOf(undefined)).toBe("unknown");
    expect(flagOf(0)).toBe("unknown");
  });

  it("reads DEGEN's full scan", () => {
    expect(parseScan(FX.goplusDegen, ADDR.degen)).toEqual({
      honeypot: "no",
      cannotSellAll: "unknown",
      mintable: "yes",
      hiddenOwner: "no",
      ownerCanChangeBalance: "no",
      takeBackOwnership: "no",
      transferPausable: "no",
      blacklist: "no",
      slippageModifiable: "no",
      proxy: "no",
      openSource: "yes",
      selfdestruct: "no",
      buyTax: 0,
      sellTax: 0,
      holders: 1182677,
      topHolderShare: 0.225736907068913407,
      owner: "0x704ec5c12ca20a293c2c0b72b22619a4231f3c0d",
    });
  });

  /** MEASURED: a B20 token comes back with no honeypot flags at all. */
  it("reads BRTC's partial scan as mostly not checked", () => {
    const s = parseScan(FX.goplusBrtc, ADDR.brtc)!;
    expect(s.honeypot).toBe("unknown");
    expect(s.mintable).toBe("unknown");
    expect(s.openSource).toBe("yes");
    expect(s.buyTax).toBeNull();
    expect(s.owner).toBeNull();
    expect(s.topHolderShare).toBe(0.408523506083782848);
  });

  it("is null for a token GoPlus has no report on", () => {
    expect(parseScan(FX.goplusUnknown, "0x000000000000000000000000000000000000dEaD")).toBeNull();
  });

  it("reads no top holder when the list is empty", () => {
    const body = copy(FX.goplusBrtc);
    (body.result as Record<string, Record<string, unknown>>)[ADDR.brtc.toLowerCase()]!.holders = [];
    expect(parseScan(body, ADDR.brtc)?.topHolderShare).toBeNull();
  });

  it("asks for chain 8453", async () => {
    net({
      get: urls({ [`https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${ADDR.degen}`]: FX.goplusDegen }),
    });
    expect((await scan(ADDR.degen))?.mintable).toBe("yes");
  });
});
