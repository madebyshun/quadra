import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionResult, erc20Abi, parseAbi, parseAbiParameters } from "viem";
import { UNISWAP_V4_POOL_MANAGER } from "@/config/chain";
import { LAUNCHPAD_ABI } from "@/config/launchpad";
import { UNISWAP_V4 } from "@/config/uniswap";
import { checkAddress } from "@/lib/address";
import {
  ACTIONS,
  buildSwap,
  minOutFor,
  NATIVE,
  permit2Allowance,
  permit2ApproveData,
  poolKeyOf,
  quoteV4,
  swapSteps,
  V4_SWAP,
  zeroForOneFor,
  type LaunchPool,
  type SwapParams,
} from "@/lib/v4swap";
import { COINS, REQUESTS, V4, type RpcBody } from "./fixtures/v4swap";
import { DOWN, net, RpcError, useNet, type Answer } from "./net";
import { withoutV3 } from "./v2only";

// Its fixtures are real v2/v1 captures, so it runs as the app did before v3 was set.
withoutV3();

useNet();

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PERIPHERY = resolve(ROOT, "contracts/lib/v4-periphery");
const read = (path: string) => readFileSync(path, "utf8");

/** What the chain answered, by the exact request the capture sent; `extra` answers a test's own variants. */
function chain(extra: Record<string, Answer> = {}): (method: string, params: readonly unknown[]) => Answer | undefined {
  const byRequest = new Map(Object.entries(REQUESTS.calls).map(([name, c]) => [`${c.to.toLowerCase()} ${c.data.toLowerCase()}`, V4[name]!]));
  return (method, params) => {
    if (method !== "eth_call") return undefined;
    const { to, data } = params[0] as { to: string; data: string };
    const k = `${to.toLowerCase()} ${data.toLowerCase()}`;
    if (k in extra) return extra[k];
    const body: RpcBody | undefined = byRequest.get(k);
    if (!body) return undefined;
    return body.error ? new RpcError(body.error.message) : body.result;
  };
}
const req = (name: string) => REQUESTS.calls[name]!;
const keyOf = (to: string, data: string) => `${to.toLowerCase()} ${data.toLowerCase()}`;

const ETH_KEY = { currency0: NATIVE, currency1: COINS.eth, fee: 10_000, tickSpacing: 200, hooks: NATIVE };
const STOCK_KEY = { currency0: COINS.stock, currency1: COINS.aapl, fee: 10_000, tickSpacing: 200, hooks: NATIVE };

// ── the numbers, held to the Solidity they come from ────────────────────────

describe("the router's commands and actions", () => {
  it("are v4-periphery's Actions, read from the installed package (byte-identical to the deployed router's)", () => {
    const sol = read(resolve(PERIPHERY, "src/libraries/Actions.sol"));
    for (const [name, value] of Object.entries(ACTIONS)) {
      const m = new RegExp(`constant ${name} = (0x[0-9a-f]+);`).exec(sol);
      expect(m, name).not.toBeNull();
      expect(Number(m![1]), name).toBe(value);
    }
  });

  it("V4_SWAP is the Universal Router's own Commands.V4_SWAP, from its verified source", () => {
    const m = /uint256 constant V4_SWAP = (0x[0-9a-f]+);/.exec(read(resolve(ROOT, "tests/fixtures/v4swap/Commands.sol")));
    expect(Number(m![1])).toBe(V4_SWAP);
  });

  it("the structs and Permit2 calls are the ones the Solidity declares, field for field", () => {
    const router = read(resolve(PERIPHERY, "src/interfaces/IV4Router.sol")).replace(/\s+/g, " ");
    expect(router).toContain("struct ExactInputSingleParams { PoolKey poolKey; bool zeroForOne; uint128 amountIn; uint128 amountOutMinimum; bytes hookData; }");
    const quoter = read(resolve(PERIPHERY, "src/interfaces/IV4Quoter.sol")).replace(/\s+/g, " ");
    expect(quoter).toContain("struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }");
    expect(quoter).toContain("function quoteExactInputSingle(QuoteExactSingleParams memory params) external returns (uint256 amountOut, uint256 gasEstimate);");
    const permit2 = read(resolve(PERIPHERY, "lib/permit2/src/interfaces/IAllowanceTransfer.sol")).replace(/\s+/g, " ");
    expect(permit2).toContain("function approve(address token, address spender, uint160 amount, uint48 expiration) external;");
    expect(permit2).toContain("function allowance(address user, address token, address spender) external view returns (uint160 amount, uint48 expiration, uint48 nonce);");
  });
});

describe("config/uniswap", () => {
  it("reuses the pinned PoolManager, and every address carries a valid EIP-55 checksum", () => {
    expect(UNISWAP_V4.poolManager).toBe(UNISWAP_V4_POOL_MANAGER);
    for (const a of Object.values(UNISWAP_V4)) expect(checkAddress(a).kind, a).toBe("checksummed");
  });

  it("the deployed Quoter answers to that PoolManager (captured)", () => {
    expect(req("quoter-poolManager").to).toBe(UNISWAP_V4.quoter);
    expect(`0x${V4["quoter-poolManager"]!.result!.slice(-40)}`).toBe(UNISWAP_V4_POOL_MANAGER.toLowerCase());
  });
});

// ── the pool ─────────────────────────────────────────────────────────────────

describe("poolKeyOf", () => {
  it("finds an ETH-paired v1 launch past v2's empty record: ETH is currency0, so buying is zeroForOne", async () => {
    const calls = net({ rpc: chain() });
    const pool = (await poolKeyOf(COINS.eth))!;
    expect(pool).toEqual({ factory: "0xcDb2eC1c487fbcB6B4AF25cCD86aFf8120FaB8a5", key: ETH_KEY, token: COINS.eth, quote: NATIVE, tokenIs0: false });
    expect(zeroForOneFor(pool, "buy")).toBe(true);
    expect(zeroForOneFor(pool, "sell")).toBe(false);
    expect(calls.map((c) => c.rpc)).toEqual(["eth_call", "eth_call", "eth_call"]);
  });

  it("finds the AAPLc-paired v2 launch: the coin is currency0, so buying with AAPLc is oneForZero", async () => {
    net({ rpc: chain() });
    const pool = (await poolKeyOf(COINS.stock))!;
    expect(pool).toEqual({ factory: "0xef1F427bB57e0ECd7BB8051cE8bC7AAb709a0c03", key: STOCK_KEY, token: COINS.stock, quote: COINS.aapl, tokenIs0: true });
    expect(zeroForOneFor(pool, "buy")).toBe(false);
    expect(zeroForOneFor(pool, "sell")).toBe(true);
  });

  it("is null for a token neither factory launched (both records all zero, as captured)", async () => {
    const empty = V4["launches-v2-ethcoin"]!.result!;
    const unknown = "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed";
    const data = (f: string) => [f, `0x1f2d8550${unknown.slice(2).toLowerCase().padStart(64, "0")}`] as const;
    net({ rpc: chain({ [keyOf(...data("0xef1F427bB57e0ECd7BB8051cE8bC7AAb709a0c03"))]: empty, [keyOf(...data("0xcDb2eC1c487fbcB6B4AF25cCD86aFf8120FaB8a5"))]: empty }) });
    expect(await poolKeyOf(unknown)).toBeNull();
  });

  // a record that is not a launchpad pool's — built FROM the capture, one field changed each time
  const captured = () => {
    const { result } = V4["launches-v2-stockcoin"]!;
    return decodeFunctionResultLaunches(result!);
  };
  const variants: [string, (r: ReturnType<typeof captured>) => void][] = [
    ["a fee other than 1%", (r) => (r.key.fee = 3_000)],
    ["another tick spacing", (r) => (r.key.tickSpacing = 60)],
    ["a hook", (r) => (r.key.hooks = "0x00000000000000000000000000000000000000c4")],
    ["a key that does not hold the token", (r) => (r.key.currency0 = "0x0000000000000000000000000000000000000001")],
  ];
  for (const [what, change] of variants) {
    it(`refuses ${what}, naming what the launchpad recorded`, async () => {
      const record = captured();
      change(record);
      const body = encodeFunctionResult({ abi: LAUNCHPAD_ABI, functionName: "launches", result: record as never });
      net({ rpc: chain({ [keyOf(req("launches-v2-stockcoin").to, req("launches-v2-stockcoin").data)]: body }) });
      await expect(poolKeyOf(COINS.stock)).rejects.toThrow(/^This build will not trade through 0xb200.*E124's pool: .* Nothing was sent\.$/);
    });
  }
});

function decodeFunctionResultLaunches(data: string) {
  const [r] = decodeAbiParameters(
    parseAbiParameters("(address creator, address creatorRecipient, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key)"),
    data as `0x${string}`,
  );
  return { creator: r.creator, creatorRecipient: r.creatorRecipient, key: { ...r.key } as { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string } };
}

// ── the quote ────────────────────────────────────────────────────────────────

describe("quoteV4 (Base's Quoter returns its figures — captured)", () => {
  it("0.001 ETH into the ETH pool buys 198,796.77… coins, and the request is the captured one byte for byte", async () => {
    const calls = net({ rpc: chain() });
    expect(await quoteV4(ETH_KEY, true, 10n ** 15n)).toEqual({ amountOut: 198_796_772_071_564_533_414_463n, gasEstimate: 0xa783n });
    expect(calls).toHaveLength(1);
  });

  it("100 coins sold back fetch 492,068,712,490 wei", async () => {
    net({ rpc: chain() });
    expect(await quoteV4(ETH_KEY, false, 100n * 10n ** 18n)).toEqual({ amountOut: 0x728978902an, gasEstimate: 0x12c6fn });
  });

  it("0.001 AAPLc — 100,000 units, 8 decimals (hard rule 3) — buys 24,180.51… coins", async () => {
    net({ rpc: chain() });
    expect(await quoteV4(STOCK_KEY, false, 100_000n)).toEqual({ amountOut: 0x51ed40eb488ed360e73n, gasEstimate: 0xa552n });
  });

  it("a sell larger than the pool's ETH is a refusal in words, never an amount of zero", async () => {
    net({ rpc: chain() });
    await expect(quoteV4(ETH_KEY, false, 100_000n * 10n ** 18n)).rejects.toThrow(
      "Uniswap's quoter could not fill this swap from the pool (the chain said: execution reverted). Usually the pool does not yet hold enough of the other side — try a smaller amount.",
    );
  });

  it("a pool that does not exist is refused the same way", async () => {
    net({ rpc: chain() });
    await expect(quoteV4({ ...ETH_KEY, fee: 3_000, tickSpacing: 60 }, true, 10n ** 15n)).rejects.toThrow(/could not fill this swap/);
  });

  it("an unreachable node is NOT a refusal — it says so", async () => {
    net({ rpc: () => DOWN });
    await expect(quoteV4(ETH_KEY, true, 10n ** 15n)).rejects.toThrow("The Base RPC could not be reached for eth_call.");
  });

  it("refuses zero, and anything past 128 bits, before asking anybody", async () => {
    const calls = net({});
    await expect(quoteV4(ETH_KEY, true, 0n)).rejects.toThrow("The amount in must be more than zero and fit in 128 bits; it was 0.");
    await expect(quoteV4(ETH_KEY, true, 1n << 128n)).rejects.toThrow(/fit in 128 bits/);
    expect(calls).toEqual([]);
  });
});

describe("minOutFor", () => {
  it("takes the slippage off in integer math and truncates", () => {
    expect(minOutFor(1_000n, 100)).toBe(990n);
    expect(minOutFor(999n, 1)).toBe(998n); // 998.9001 → 998, never rounded up
    expect(minOutFor(198_796_772_071_564_533_414_463n, 100)).toBe(196_808_804_350_848_888_080_318n); // the simulation's own figure
    expect(minOutFor(7n, 0)).toBe(7n);
  });

  it("refuses a slippage that is not a whole number of basis points below 100%, and a negative quote", () => {
    for (const bps of [-1, 10_000, 1.5, Number.NaN]) expect(() => minOutFor(1_000n, bps)).toThrow(/^Slippage must be a whole number of basis points/);
    expect(() => minOutFor(-1n, 100)).toThrow("A quote cannot be negative.");
  });
});

// ── the transaction ──────────────────────────────────────────────────────────

const ROUTER_ABI = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
const PERMIT2_ABI = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);
const DEADLINE = 1_792_000_000;

function decodeSwap(data: `0x${string}`) {
  const { args } = decodeFunctionData({ abi: ROUTER_ABI, data });
  const [commands, inputs, deadline] = args;
  const [actions, params] = decodeAbiParameters(parseAbiParameters("bytes, bytes[]"), inputs[0]!);
  const [swap] = decodeAbiParameters(
    parseAbiParameters("((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)"),
    params[0]!,
  );
  const settle = decodeAbiParameters(parseAbiParameters("address, uint256"), params[1]!);
  const take = decodeAbiParameters(parseAbiParameters("address, uint256"), params[2]!);
  return { commands, inputs: inputs.length, deadline, actions, params: params.length, swap, settle, take };
}

describe("buildSwap", () => {
  const buy: SwapParams = { key: ETH_KEY, zeroForOne: true, amountIn: 10n ** 15n, minOut: 196_808_804_350_848_888_080_318n, deadline: DEADLINE };

  it("ETH in: one V4_SWAP command — swap, settle all, take all — to the router, the ETH as its value", () => {
    const tx = buildSwap(buy);
    expect(tx.to).toBe(UNISWAP_V4.universalRouter);
    expect(tx.value).toBe(10n ** 15n);
    const d = decodeSwap(tx.data);
    expect(d.commands).toBe("0x10");
    expect(d.inputs).toBe(1);
    expect(d.deadline).toBe(BigInt(DEADLINE));
    expect(d.actions).toBe("0x060c0f");
    expect(d.params).toBe(3);
    expect(d.swap).toEqual({ poolKey: ETH_KEY, zeroForOne: true, amountIn: 10n ** 15n, amountOutMinimum: buy.minOut, hookData: "0x" });
    expect(d.settle).toEqual([NATIVE, 10n ** 15n]);
    expect(d.take).toEqual([COINS.eth, buy.minOut]);
  });

  it("a token in (selling the coin): no ETH rides along, and the currencies swap places", () => {
    const tx = buildSwap({ ...buy, zeroForOne: false, amountIn: 100n * 10n ** 18n, minOut: 1n });
    expect(tx.value).toBe(0n);
    const d = decodeSwap(tx.data);
    expect(d.settle).toEqual([COINS.eth, 100n * 10n ** 18n]);
    expect(d.take).toEqual([NATIVE, 1n]);
  });

  it("refuses a swap with no minimum, an amount past 128 bits and a deadline that is not a time", () => {
    expect(() => buildSwap({ ...buy, minOut: 0n })).toThrow("The minimum out must be more than zero and fit in 128 bits; it was 0.");
    expect(() => buildSwap({ ...buy, amountIn: 1n << 128n })).toThrow(/The amount in must be/);
    for (const deadline of [0, -5, 1.5, 2 ** 48]) expect(() => buildSwap({ ...buy, deadline })).toThrow(/^The deadline must be a time in unix seconds/);
  });

  it("permit2ApproveData is Permit2's approve, exact amount, expiring when asked", () => {
    const { args } = decodeFunctionData({ abi: PERMIT2_ABI, data: permit2ApproveData(COINS.aapl, UNISWAP_V4.universalRouter, 100_000n, DEADLINE) });
    expect(args).toEqual([COINS.aapl, UNISWAP_V4.universalRouter, 100_000n, DEADLINE]);
  });
});

// ── the steps a wallet signs ─────────────────────────────────────────────────

describe("swapSteps", () => {
  const stockPool: LaunchPool = { factory: "0xef1F427bB57e0ECd7BB8051cE8bC7AAb709a0c03", key: STOCK_KEY, token: COINS.stock, quote: COINS.aapl, tokenIs0: true };
  const withAapl = { key: stockPool.key, zeroForOne: zeroForOneFor(stockPool, "buy"), amountIn: 100_000n, minOut: 1n, deadline: DEADLINE, from: COINS.creator };
  const erc20 = req("erc20-allowance-treasury-aapl-permit2");
  const viaPermit2 = req("permit2-allowance-treasury-aapl");
  const permit2Answer = (amount: bigint, expiration: number) =>
    encodeFunctionResult({ abi: parseAbi(["function allowance(address, address, address) view returns (uint160, uint48, uint48)"]), functionName: "allowance", result: [amount, expiration, 0] });

  it("ETH in: the swap alone, nothing read", async () => {
    const calls = net({});
    const steps = await swapSteps({ key: ETH_KEY, zeroForOne: true, amountIn: 10n ** 15n, minOut: 1n, deadline: DEADLINE, from: COINS.creator });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ to: UNISWAP_V4.universalRouter, value: 10n ** 15n, what: "swap through the launchpad pool on Uniswap v4" });
    expect(calls).toEqual([]);
  });

  it("AAPLc in with no allowances (captured): an EXACT approval to Permit2, an EXACT Permit2 approval to the router, then the swap", async () => {
    net({ rpc: chain() });
    const steps = await swapSteps({ ...withAapl, asset: { symbol: "AAPLc", decimals: 8 } });
    expect(steps.map((s) => s.what)).toEqual([
      "approve exactly 0.001 AAPLc for Permit2",
      "let Uniswap's router take exactly 0.001 AAPLc through Permit2, until the swap's deadline",
      "swap through the launchpad pool on Uniswap v4",
    ]);
    expect(steps[0]!.to).toBe(COINS.aapl);
    expect(decodeFunctionData({ abi: erc20Abi, data: steps[0]!.data }).args).toEqual([UNISWAP_V4.permit2, 100_000n]);
    expect(steps[1]!.to).toBe(UNISWAP_V4.permit2);
    expect(decodeFunctionData({ abi: PERMIT2_ABI, data: steps[1]!.data }).args).toEqual([COINS.aapl, UNISWAP_V4.universalRouter, 100_000n, DEADLINE]);
    expect(steps.map((s) => s.value)).toEqual([0n, 0n, 0n]);
    expect(steps[2]!.data).toBe(buildSwap(withAapl).data);
  });

  it("without a name for the asset, the steps speak in base units", async () => {
    net({ rpc: chain() });
    const steps = await swapSteps(withAapl);
    expect(steps[0]!.what).toBe(`approve exactly 100000 base units of ${COINS.aapl} for Permit2`);
  });

  it("enough of both allowances, lasting past the deadline: the swap alone", async () => {
    const enough = encodeAbiParameters(parseAbiParameters("uint256"), [100_000n]);
    net({ rpc: chain({ [keyOf(erc20.to, erc20.data)]: enough, [keyOf(viaPermit2.to, viaPermit2.data)]: permit2Answer(100_000n, DEADLINE) }) });
    expect((await swapSteps(withAapl)).map((s) => s.what)).toEqual(["swap through the launchpad pool on Uniswap v4"]);
  });

  it("a Permit2 allowance that runs out before the deadline is renewed; a big enough ERC-20 one is left alone", async () => {
    const enough = encodeAbiParameters(parseAbiParameters("uint256"), [10n ** 18n]);
    net({ rpc: chain({ [keyOf(erc20.to, erc20.data)]: enough, [keyOf(viaPermit2.to, viaPermit2.data)]: permit2Answer(10n ** 18n, DEADLINE - 1) }) });
    const steps = await swapSteps(withAapl);
    expect(steps.map((s) => s.to)).toEqual([UNISWAP_V4.permit2, UNISWAP_V4.universalRouter]);
  });

  it("permit2Allowance reads Permit2's answer (captured: none)", async () => {
    net({ rpc: chain() });
    expect(await permit2Allowance(COINS.creator, COINS.aapl, UNISWAP_V4.universalRouter)).toEqual({ amount: 0n, expiration: 0 });
  });
});
