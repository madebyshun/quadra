/**
 * Launchpad v3 against REAL Base mainnet state, without deploying or sending anything — and the APP
 * against v3: the launch transactions are built by this app's own `launchTx` (src/adapters/http/
 * launchpad.ts), the later buys and the sell by its own `src/lib/v4swap.ts` (`buildSwap` through the
 * real Universal Router, a sell's approvals through the real Permit2 with `approveData` /
 * `permit2ApproveData`), and Uniswap's real Quoter is asked with the app's own `quoteCall` in the
 * same block, just before each swap — so quote and delivery are compared on the same state.
 *
 * One `eth_simulateV1` call, three simulated blocks pinned on one real block (the opening fee depends
 * on the block's timestamp, so the clock has to move — `blockOverrides.time`), from keyless addresses
 * given ETH by state override:
 *
 *   block T     deploy LaunchFactoryV3 (its hook at the salt mined here) → the app launches a 1% coin
 *               and a 3% coin, each with a 0.01 ETH first buy → collect both (the first buy's fee: the
 *               CHOSEN fee, not the opening one) — and, for gas, deploy v2 and make the same 1% launch
 *   block T+1   quote → a sniper buys 0.1 ETH of the 1% coin through the Universal Router → collect
 *   block T+20  quote → a buyer buys 0.1 ETH of each coin → collect; then the buyer SELLS 1,000,000 of
 *               the 1% coin: approve Permit2, Permit2-approve the router, quote, swap
 *
 * Against the real Uniswap v4 PoolManager, Quoter, Universal Router, Permit2 and the real B20
 * precompile. mainnet.base.org first, Tenderly's public gateway on a 429 (the indexer's endpoints).
 * Hand-run; never broadcasts, holds no key:
 *
 *   PATH="$HOME/.foundry/bin:$PATH" npx vite-node scripts/simulate-launchpad-v3.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  concatHex,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getContractAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  toHex,
  type Hex,
} from "viem";
import { CONTRACTS, UNISWAP_V4_POOL_MANAGER } from "../src/config/chain";
import { DYNAMIC_FEE_FLAG, LAUNCH_HOOK_ABI } from "../src/config/launchpad";
import { UNISWAP_V4 } from "../src/config/uniswap";
import { launchTx, type Pair } from "../src/adapters/http/launchpad";
import { buildSwap, NATIVE, permit2ApproveData, quoteCall, quoteFrom, zeroForOneFor, type LaunchPool } from "../src/lib/v4swap";
import { approveData } from "../src/lib/erc20";
import { poolIdOf } from "../src/skills/launchpad";
import { archiveRpc } from "../src/server/indexer";

const rpc = archiveRpc;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIM = "0x5157000000000000000000000000000000005157";
const SNIPER = "0x5157000000000000000000000000000000005158";
const BUYER = "0x5157000000000000000000000000000000005159";
const B20_FACTORY = "0xB20f000000000000000000000000000000000000";
const ETH = "0x0000000000000000000000000000000000000000";
const ETH_START = 191_200;
const START_FEE = 500_000;
const WINDOW = 15;
// beforeInitialize | beforeAddLiquidity | beforeSwap, the low 14 bits of the hook's address
const FLAGS = (1n << 13n) | (1n << 11n) | (1n << 7n);

execFileSync("base-forge", ["build"], { cwd: resolve(ROOT, "contracts"), stdio: "ignore" });
const bytecode = (name: string, file = name) =>
  JSON.parse(readFileSync(resolve(ROOT, `contracts/out/${file}.sol/${name}.json`), "utf8")).bytecode.object as Hex;

const FACTORY_ABI = parseAbi([
  "function launch(string name, string symbol, string contractURI, bytes32 salt, address quote, uint256 quoteIn, uint24 fee) payable returns (address)",
  "function launch(string name, string symbol, string contractURI, bytes32 salt, address quote, uint256 quoteIn) payable returns (address)",
  "function collect(address token) returns (uint256, uint256)",
  "function hook() view returns (address)",
]);
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const TRANSFER = keccak256(toHex("Transfer(address,address,uint256)"));
const NATIVE_LOGS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

// every read and the simulation pinned on ONE real block, so the run is about one state
const pinned = (await rpc("eth_getBlockByNumber", ["latest", false])) as { number: string; timestamp: string };
const AT = pinned.number;
const nonce = BigInt((await rpc("eth_getTransactionCount", [SIM, AT])) as string);
const factory = getContractAddress({ from: SIM, nonce });
const v2 = getContractAddress({ from: SIM, nonce: nonce + 1n });

// the hook's salt, mined against the factory's address exactly as script/HookSalt.sol does
const hookInit = keccak256(
  concatHex([bytecode("LaunchHook"), encodeAbiParameters(parseAbiParameters("address, uint24, uint32"), [UNISWAP_V4_POOL_MANAGER, START_FEE, WINDOW])]),
);
let hookSalt: Hex = "0x";
let hook: Hex = "0x";
for (let i = 0n; ; i++) {
  const salt = toHex(i, { size: 32 });
  const at = getContractAddress({ opcode: "CREATE2", from: factory, salt, bytecodeHash: hookInit });
  if ((BigInt(at) & ((1n << 14n) - 1n)) === FLAGS) {
    [hookSalt, hook] = [salt, at];
    break;
  }
}

const deployV3 = concatHex([
  bytecode("LaunchFactoryV3"),
  encodeAbiParameters(parseAbiParameters("address, address, address, int24, uint24, uint32, bytes32"), [
    UNISWAP_V4_POOL_MANAGER,
    CONTRACTS.treasury as Hex,
    SIM,
    ETH_START,
    START_FEE,
    WINDOW,
    hookSalt,
  ]),
]);
const deployV2 = concatHex([
  bytecode("LaunchFactory"),
  encodeAbiParameters(parseAbiParameters("address, address, address, int24"), [UNISWAP_V4_POOL_MANAGER, CONTRACTS.treasury as Hex, SIM, ETH_START]),
]);

const predict = async (at: Hex, salt: Hex) => {
  const data = encodeFunctionData({
    abi: parseAbi(["function getB20Address(uint8, address, bytes32) view returns (address)"]),
    args: [0, at, keccak256(encodeAbiParameters(parseAbiParameters("address, bytes32"), [SIM, salt]))],
  });
  return `0x${((await rpc("eth_call", [{ to: B20_FACTORY, data }, AT])) as string).slice(-40)}` as Hex;
};
const [oneSalt, threeSalt] = [toHex(1, { size: 32 }), toHex(2, { size: 32 })];
const [one, three] = [await predict(factory, oneSalt), await predict(factory, threeSalt)];

const FIRST_BUY = 10n ** 16n;
const BUY = 10n ** 17n;
const SELL = 1_000_000n * 10n ** 18n;
const call = (from: string, to: string | undefined, data: Hex, value = 0n) => ({
  from,
  ...(to ? { to } : {}),
  data,
  value: `0x${value.toString(16)}`,
  gas: "0x1c9c380",
});
const ETH_PAIR: Pair = { address: ETH, symbol: "ETH", name: "Ether", decimals: 18, startTick: ETH_START };
const meta = { name: "Sim Cat", symbol: "SCAT", description: "simulated", image: "", website: "" };
// THE APP'S OWN LAUNCH TRANSACTION — what the Launch window and the `launch` skill send
const appLaunch = (salt: Hex, fee: 10_000 | 30_000) => {
  const tx = launchTx(factory, meta, salt, ETH_PAIR, FIRST_BUY, fee);
  return call(SIM, tx.to, tx.data as Hex, tx.value);
};
const collect = (token: Hex) => call(SIM, factory, encodeFunctionData({ abi: FACTORY_ABI, functionName: "collect", args: [token] }));
// the pool as the app's poolKeyOf hands it over for a v3 coin: ETH (address 0) is currency0, the dynamic flag, the hook
const poolOf = (token: Hex): LaunchPool => ({
  factory,
  key: { currency0: NATIVE, currency1: token, fee: DYNAMIC_FEE_FLAG, tickSpacing: 200, hooks: hook },
  token,
  quote: NATIVE,
  tokenIs0: false,
});
const deadline = Number(BigInt(pinned.timestamp) + 3600n);
// THE APP'S OWN QUOTE AND SWAP — Uniswap's Quoter via quoteCall, the Universal Router via buildSwap
const quote = (from: string, token: Hex, side: "buy" | "sell", amountIn: bigint) => {
  const q = quoteCall(poolOf(token).key, zeroForOneFor(poolOf(token), side), amountIn);
  return call(from, q.to, q.data);
};
const swap = (from: string, token: Hex, side: "buy" | "sell", amountIn: bigint) => {
  const tx = buildSwap({ key: poolOf(token).key, zeroForOne: zeroForOneFor(poolOf(token), side), amountIn, minOut: 1n, deadline });
  return call(from, tx.to, tx.data, tx.value);
};
const balance = (token: Hex, who: string) => call(SIM, token, encodeFunctionData({ abi: ERC20, functionName: "balanceOf", args: [who as Hex] }));
const currentFee = (token: Hex) =>
  call(SIM, hook, encodeFunctionData({ abi: LAUNCH_HOOK_ABI, functionName: "currentFee", args: [poolIdOf(poolOf(token).key)] }));

const T = BigInt(pinned.timestamp) + 2n;
const rich = { balance: `0x${(10n ** 19n).toString(16)}` };
type Step = readonly [name: string, call: ReturnType<typeof call>];
const blocks: { blockOverrides: { time: string }; stateOverrides?: Record<string, unknown>; steps: Step[] }[] = [
  {
    blockOverrides: { time: toHex(T) },
    stateOverrides: { [SIM]: rich, [SNIPER]: rich, [BUYER]: rich },
    steps: [
      ["deploy v3 (+ its hook)", call(SIM, undefined, deployV3)],
      ["deploy v2 (gas comparison)", call(SIM, undefined, deployV2)],
      ["factory.hook()", call(SIM, factory, encodeFunctionData({ abi: FACTORY_ABI, functionName: "hook" }))],
      ["APP launchTx: 1% coin, 0.01 ETH first buy", appLaunch(oneSalt, 10_000)],
      ["APP launchTx: 3% coin, 0.01 ETH first buy", appLaunch(threeSalt, 30_000)],
      ["collect 1% coin (the first buy's fee)", collect(one)],
      ["collect 3% coin (the first buy's fee)", collect(three)],
      ["v2 launch, 0.01 ETH first buy", call(SIM, v2, encodeFunctionData({ abi: FACTORY_ABI, functionName: "launch", args: ["Sim Cat", "SCAT", "", oneSalt, ETH, FIRST_BUY] }), FIRST_BUY)],
    ],
  },
  {
    blockOverrides: { time: toHex(T + 1n) },
    steps: [
      ["T+1s: hook.currentFee, 1% coin", currentFee(one)],
      ["T+1s: Quoter, sniper buy 0.1 ETH of 1% coin", quote(SNIPER, one, "buy", BUY)],
      ["T+1s: APP buildSwap, sniper buys 0.1 ETH", swap(SNIPER, one, "buy", BUY)],
      ["T+1s: 1% coin held by the sniper", balance(one, SNIPER)],
      ["collect 1% coin (the sniper's fee)", collect(one)],
    ],
  },
  {
    blockOverrides: { time: toHex(T + 20n) },
    steps: [
      ["T+20s: hook.currentFee, 1% coin", currentFee(one)],
      ["T+20s: Quoter, buy 0.1 ETH of 1% coin", quote(BUYER, one, "buy", BUY)],
      ["T+20s: APP buildSwap, buyer buys 0.1 ETH (1%)", swap(BUYER, one, "buy", BUY)],
      ["T+20s: 1% coin held by the buyer", balance(one, BUYER)],
      ["collect 1% coin (the buyer's fee)", collect(one)],
      ["T+20s: hook.currentFee, 3% coin", currentFee(three)],
      ["T+20s: Quoter, buy 0.1 ETH of 3% coin", quote(BUYER, three, "buy", BUY)],
      ["T+20s: APP buildSwap, buyer buys 0.1 ETH (3%)", swap(BUYER, three, "buy", BUY)],
      ["T+20s: 3% coin held by the buyer", balance(three, BUYER)],
      ["collect 3% coin (the buyer's fee)", collect(three)],
      ["APP approveData: 1% coin → Permit2, exact", call(BUYER, one, approveData(UNISWAP_V4.permit2, SELL))],
      ["APP permit2ApproveData: router, exact", call(BUYER, UNISWAP_V4.permit2, permit2ApproveData(one, UNISWAP_V4.universalRouter, SELL, deadline))],
      ["T+20s: Quoter, sell 1,000,000 of 1% coin", quote(BUYER, one, "sell", SELL)],
      ["T+20s: APP buildSwap, buyer sells 1,000,000", swap(BUYER, one, "sell", SELL)],
      ["collect 1% coin (the seller's fee, in the coin)", collect(one)],
    ],
  },
];

const result = (await rpc("eth_simulateV1", [
  { blockStateCalls: blocks.map(({ steps, ...b }) => ({ ...b, calls: steps.map(([, c]) => c) })), traceTransfers: true, validation: false },
  AT,
])) as { timestamp: string; calls: { status: string; gasUsed: string; returnData: string; logs: { address: string; topics: string[]; data: string }[]; error?: { message: string } }[] }[];

let lastQuote = 0n;
const paidFor: Record<string, bigint> = { "collect 1% coin (the first buy's fee)": FIRST_BUY, "collect 3% coin (the first buy's fee)": FIRST_BUY };
console.log(`pinned on Base block ${Number(AT)} (time ${Number(pinned.timestamp)})`);
result.forEach((block, b) => {
  console.log(`— block at T+${BigInt(block.timestamp) - T}s`);
  block.calls.forEach((c, i) => {
    const name = blocks[b]!.steps[i]![0];
    const ok = c.status === "0x1";
    let value = "";
    if (ok && name.startsWith("collect")) {
      const [eth, tokens] = decodeFunctionResult({ abi: FACTORY_ABI, functionName: "collect", data: c.returnData as Hex });
      if (name.includes("seller")) value = `${tokens} token-wei (${((Number(tokens) / Number(SELL)) * 100).toFixed(3)}% of the 1,000,000 sold) / ${eth} wei ETH`;
      else {
        const paid = paidFor[name] ?? BUY;
        value = `${eth} wei ETH (${((Number(eth) / Number(paid)) * 100).toFixed(3)}% of ${Number(paid) / 1e18} ETH) / ${tokens} token`;
      }
    } else if (ok && name.includes("currentFee")) {
      value = `${Number(BigInt(c.returnData))} (${(Number(BigInt(c.returnData)) / 1e4).toFixed(2)}%)`;
    } else if (ok && name.includes("Quoter")) {
      lastQuote = quoteFrom(c.returnData as Hex).amountOut;
      value = `quote ${lastQuote}`;
    } else if (ok && name.includes("held by")) {
      // each holder held none of that coin before this buy, so what it holds IS what the swap delivered
      const held = BigInt(c.returnData);
      value = `delivered ${held}; quote ${lastQuote}; ${held === lastQuote ? "EXACTLY the quote" : `differs by ${held - lastQuote}`}`;
    } else if (ok && name.includes("sells")) {
      // ETH delivered: the native transfers traceTransfers reports to the seller
      const got = c.logs
        .filter((l) => l.address.toLowerCase() === NATIVE_LOGS && l.topics[0] === TRANSFER && `0x${l.topics[2]!.slice(-40)}`.toLowerCase() === BUYER.toLowerCase())
        .reduce((sum, l) => sum + BigInt(l.data), 0n);
      value = `delivered ${got} wei ETH; quote ${lastQuote}; ${got === lastQuote ? "EXACTLY the quote" : `differs by ${got - lastQuote}`}`;
    } else if (ok && (name.includes("launch") || name === "factory.hook()")) {
      value = `0x${c.returnData.slice(-40)}`;
    }
    console.log(`${ok ? "✓" : "✗"} ${name.padEnd(48)} gas ${String(Number(BigInt(c.gasUsed))).padStart(9)}  ${ok ? value : c.error?.message}`);
  });
});
console.log(`factory ${factory} · hook ${hook} (salt ${BigInt(hookSalt)}) · 1% coin ${one} · 3% coin ${three}`);
