/**
 * RevenueShare (contracts/src/RevenueShare.sol) against REAL Base mainnet state and the DEPLOYED
 * launchpad v3 (`CONTRACTS.launchFactoryV3`), without deploying or sending anything.
 *
 * One `eth_simulateV1` call, four simulated blocks pinned on one real block (the stream releases over
 * time, so the clock has to move — `blockOverrides.time`), from keyless addresses given ETH by state
 * override:
 *
 *   block T          deploy RevenueShareDeployer(v3) → a trader buys NVDAc through Relay → the app's
 *                    own `launchTx` launches a 1% ETH coin (0.01 ETH first buy, Blue Agent's approved
 *                    referrer) and a 1% NVDAc coin (no first buy) on the REAL v3 → the deployer creates a
 *                    share for each (agent 20%) → the launcher `setCreatorRecipient`s both → isActive
 *   block T+30s      (the anti-sniper opening is over) the trader buys the ETH coin with ETH and the
 *                    NVDAc coin with NVDAc, and sells some of the ETH coin, all through the app's own
 *                    `buildSwap` + Permit2 → the launcher stakes the ETH coin, the trader the NVDAc coin →
 *                    `harvest` both → claimable (0: nothing is released in the same second)
 *   block +STREAM/2  claimable (about half)
 *   block +STREAM+1  claimable → claim both → payAgent both → read the agent's and stakers' balances,
 *                    what the launchpad still owes each share (0 = every push was accepted) → unstake
 *
 * Against the real Uniswap v4 PoolManager, Universal Router, Permit2, the real B20 precompile and
 * Coinbase's real NVDAc with its real transfer policies — the question this answers is whether those
 * policies let a freshly deployed RevenueShare RECEIVE and SEND NVDAc. Hand-run; never broadcasts,
 * holds no key:
 *
 *   PATH="$HOME/.foundry/bin:$PATH" npx vite-node scripts/simulate-revenue-share.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  concatHex,
  decodeEventLog,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getContractAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  toHex,
  type Abi,
  type Hex,
} from "viem";
import { CONTRACTS } from "../src/config/chain";
import { DYNAMIC_FEE_FLAG } from "../src/config/launchpad";
import { RELAY } from "../src/config/routes";
import { UNISWAP_V4 } from "../src/config/uniswap";
import { launchTx, type Pair } from "../src/adapters/http/launchpad";
import { buildSwap, NATIVE, permit2ApproveData, zeroForOneFor, type LaunchPool } from "../src/lib/v4swap";
import { approveData } from "../src/lib/erc20";
import { stepsOf } from "../src/skills/simulate";
import { archiveRpc as rpc } from "../src/server/indexer";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LAUNCHER = "0x5157000000000000000000000000000000005160";
const TRADER = "0x5157000000000000000000000000000000005161";
const AGENT = "0x5157000000000000000000000000000000005162";
/** Blue Agent's referrer — approvedReferrers == true on v3, read below rather than assumed. */
const BLUE_AGENT = "0x884fbdd5cf193e7f87cba76419e526d8f4df7a9b";
const NVDA = "0xb20000000000000000000078ee7ce2fE4908108C";
const B20_FACTORY = "0xB20f000000000000000000000000000000000000";
const AGENT_BPS = 2_000;
const STREAM = 7n * 24n * 3600n;
const V3 = CONTRACTS.launchFactoryV3 as Hex;

execFileSync("base-forge", ["build"], { cwd: resolve(ROOT, "contracts"), stdio: "ignore" });
const artifact = (name: string) => JSON.parse(readFileSync(resolve(ROOT, `contracts/out/RevenueShare.sol/${name}.json`), "utf8"));
const SHARE_ABI = artifact("RevenueShare").abi as Abi;
const DEPLOYER_ABI = artifact("RevenueShareDeployer").abi as Abi;
const FACTORY_ABI = parseAbi([
  "function hook() view returns (address)",
  "function approvedReferrers(address) view returns (bool)",
  "function quotes(address) view returns (bool enabled, int24 startTick)",
  "function setCreatorRecipient(address token, address recipient)",
  "function referrerOf(address token) view returns (address)",
  "function owed(address account, address currency) view returns (uint256)",
  "event FeesCollected(address indexed token, uint256 amount0, uint256 amount1)",
]);
const ERC20 = parseAbi(["function approve(address, uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const TRANSFER = keccak256(toHex("Transfer(address,address,uint256)"));
const NATIVE_LOGS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

const pinned = (await rpc("eth_getBlockByNumber", ["latest", false])) as { number: string; timestamp: string };
const AT = pinned.number;
const read = async (to: string, data: Hex) => (await rpc("eth_call", [{ to, data }, AT])) as Hex;
const hook = `0x${(await read(V3, encodeFunctionData({ abi: FACTORY_ABI, functionName: "hook" }))).slice(-40)}` as Hex;
const blueApproved = BigInt(await read(V3, encodeFunctionData({ abi: FACTORY_ABI, functionName: "approvedReferrers", args: [BLUE_AGENT] }))) === 1n;
const [nvdaEnabled, nvdaTick] = decodeFunctionResult({
  abi: FACTORY_ABI,
  functionName: "quotes",
  data: await read(V3, encodeFunctionData({ abi: FACTORY_ABI, functionName: "quotes", args: [NVDA] })),
});
if (!nvdaEnabled) throw new Error("NVDAc is not enabled on v3 at this block.");

const nonce = BigInt((await rpc("eth_getTransactionCount", [LAUNCHER, AT])) as string);
const deployer = getContractAddress({ from: LAUNCHER, nonce });
const predictToken = async (salt: Hex) => {
  const data = encodeFunctionData({
    abi: parseAbi(["function getB20Address(uint8, address, bytes32) view returns (address)"]),
    args: [0, V3, keccak256(encodeAbiParameters(parseAbiParameters("address, bytes32"), [LAUNCHER, salt]))],
  });
  return `0x${(await read(B20_FACTORY, data)).slice(-40)}` as Hex;
};
// a salt nobody has used yet: the launcher is keyless, but the salt is still bound to it
const [ethSalt, stockSalt] = [keccak256(toHex(`rs-eth-${AT}`)), keccak256(toHex(`rs-stock-${AT}`))];
const [ethCoin, stockCoin] = [await predictToken(ethSalt), await predictToken(stockSalt)];
// the share contracts' addresses, exactly as RevenueShareDeployer.predict computes them
const shareInit = (token: Hex) =>
  keccak256(concatHex([artifact("RevenueShare").bytecode.object as Hex, encodeAbiParameters(parseAbiParameters("address, address, address, uint16"), [V3, token, AGENT, AGENT_BPS])]));
const sharesSalt = (token: Hex) => keccak256(encodeAbiParameters(parseAbiParameters("address, address, uint16"), [token, AGENT, AGENT_BPS]));
const shareOf = (token: Hex) => getContractAddress({ opcode: "CREATE2", from: deployer, salt: sharesSalt(token), bytecodeHash: shareInit(token) });
const [ethShare, stockShare] = [shareOf(ethCoin), shareOf(stockCoin)];

// NVDAc for the trader: Relay's own route, run inside the same simulated block
const relayQuote = await (
  await fetch(`${RELAY.api}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: TRADER, recipient: TRADER, originChainId: 8453, destinationChainId: 8453, originCurrency: NATIVE, destinationCurrency: NVDA, amount: (3n * 10n ** 17n).toString(), tradeType: "EXACT_INPUT" }),
  })
).json();
const relay = stepsOf(relayQuote);
const nvdaIn = (BigInt(relayQuote.details.currencyOut.amount) * 90n) / 100n; // what the trader spends on the coin

const call = (from: string, to: string | undefined, data: Hex, value = 0n) => ({ from, ...(to ? { to } : {}), data, value: `0x${value.toString(16)}`, gas: "0x1c9c380" });
const meta = { name: "Agent Cat", symbol: "ACAT", description: "simulated", image: "", website: "" };
const pairOf = (address: string, symbol: string, decimals: number, startTick: number): Pair => ({ address, symbol, name: symbol, decimals, startTick });
const FIRST_BUY = 10n ** 16n;
const appLaunch = (salt: Hex, pair: Pair, firstBuy: bigint, referrer?: string) => {
  const tx = launchTx(V3, meta, salt, pair, firstBuy, 10_000, referrer);
  return call(LAUNCHER, tx.to, tx.data as Hex, tx.value);
};
const poolOf = (token: Hex, quote: string): LaunchPool => {
  const tokenIs0 = BigInt(token) < BigInt(quote);
  return {
    factory: V3,
    key: { currency0: tokenIs0 ? token : quote, currency1: tokenIs0 ? quote : token, fee: DYNAMIC_FEE_FLAG, tickSpacing: 200, hooks: hook },
    token,
    quote,
    tokenIs0,
  };
};
const T = BigInt(pinned.timestamp) + 2n;
const deadline = Number(T + 30n * 86400n);
const swap = (from: string, pool: LaunchPool, side: "buy" | "sell", amountIn: bigint) => {
  const tx = buildSwap({ key: pool.key, zeroForOne: zeroForOneFor(pool, side), amountIn, minOut: 1n, deadline });
  return call(from, tx.to, tx.data, tx.value);
};
const permit2 = (from: string, token: string, amount: bigint) => [
  call(from, token, approveData(UNISWAP_V4.permit2, amount)),
  call(from, UNISWAP_V4.permit2, permit2ApproveData(token, UNISWAP_V4.universalRouter, amount, deadline)),
];
const shareCall = (from: string, share: string, functionName: string, args: readonly unknown[] = []) =>
  call(from, share, encodeFunctionData({ abi: SHARE_ABI, functionName, args }));
const balance = (token: string, who: string) => call(LAUNCHER, token, encodeFunctionData({ abi: ERC20, functionName: "balanceOf", args: [who as Hex] }));
const owedTo = (share: string, currency: string) => call(LAUNCHER, V3, encodeFunctionData({ abi: FACTORY_ABI, functionName: "owed", args: [share as Hex, currency as Hex] }));

const ETH_STAKE = 1_000_000n * 10n ** 18n; // of ~2M the 0.01 ETH first buy gets
const STOCK_STAKE = 10_000n * 10n ** 18n;
const SELL = 5_000_000n * 10n ** 18n;
const ethPool = poolOf(ethCoin, NATIVE);
const stockPool = poolOf(stockCoin, NVDA);
const rich = { balance: `0x${(10n ** 19n).toString(16)}` };

type Step = readonly [name: string, call: ReturnType<typeof call>];
const blocks: { blockOverrides: { time: string }; stateOverrides?: Record<string, unknown>; steps: Step[] }[] = [
  {
    blockOverrides: { time: toHex(T) },
    stateOverrides: { [LAUNCHER]: rich, [TRADER]: rich },
    steps: [
      ["deploy RevenueShareDeployer(v3)", call(LAUNCHER, undefined, concatHex([artifact("RevenueShareDeployer").bytecode.object as Hex, encodeAbiParameters(parseAbiParameters("address"), [V3])]))],
      ...relay.map((s, i) => [`Relay step ${i + 1}: trader buys NVDAc`, call(TRADER, s.to, s.data as Hex, s.value)] as const),
      ["APP launchTx: ETH coin 1%, 0.01 ETH, Blue Agent referrer", appLaunch(ethSalt, pairOf(NATIVE, "ETH", 18, 191_200), FIRST_BUY, BLUE_AGENT)],
      ["APP launchTx: NVDAc coin 1%, no first buy", appLaunch(stockSalt, pairOf(NVDA, "NVDAc", 8, nvdaTick), 0n)],
      ["v3.referrerOf(ETH coin)", call(LAUNCHER, V3, encodeFunctionData({ abi: FACTORY_ABI, functionName: "referrerOf", args: [ethCoin] }))],
      ["deployer.create(ETH coin, agent, 20%)", call(LAUNCHER, deployer, encodeFunctionData({ abi: DEPLOYER_ABI, functionName: "create", args: [ethCoin, AGENT, AGENT_BPS] }))],
      ["deployer.create(NVDAc coin, agent, 20%)", call(LAUNCHER, deployer, encodeFunctionData({ abi: DEPLOYER_ABI, functionName: "create", args: [stockCoin, AGENT, AGENT_BPS] }))],
      ["v3.setCreatorRecipient(ETH coin → share)", call(LAUNCHER, V3, encodeFunctionData({ abi: FACTORY_ABI, functionName: "setCreatorRecipient", args: [ethCoin, ethShare] }))],
      ["v3.setCreatorRecipient(NVDAc coin → share)", call(LAUNCHER, V3, encodeFunctionData({ abi: FACTORY_ABI, functionName: "setCreatorRecipient", args: [stockCoin, stockShare] }))],
      ["ETH share isActive", shareCall(LAUNCHER, ethShare, "isActive")],
      ["NVDAc share isActive", shareCall(LAUNCHER, stockShare, "isActive")],
    ],
  },
  {
    blockOverrides: { time: toHex(T + 30n) },
    steps: [
      ["trader buys ETH coin, 0.5 ETH", swap(TRADER, ethPool, "buy", 5n * 10n ** 17n)],
      ...permit2(TRADER, NVDA, nvdaIn).map((c, i) => [`trader: NVDAc ${i === 0 ? "→ Permit2" : "Permit2 → router"}, exact`, c] as const),
      [`trader buys NVDAc coin with ${Number(nvdaIn) / 1e8} NVDAc`, swap(TRADER, stockPool, "buy", nvdaIn)],
      ...permit2(TRADER, ethCoin, SELL).map((c, i) => [`trader: ETH coin ${i === 0 ? "→ Permit2" : "Permit2 → router"}, exact`, c] as const),
      ["trader sells 5,000,000 ETH coin", swap(TRADER, ethPool, "sell", SELL)],
      ["launcher approves ETH coin → share", call(LAUNCHER, ethCoin, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ethShare, ETH_STAKE] }))],
      ["launcher stakes 1,000,000 ETH coin", shareCall(LAUNCHER, ethShare, "stake", [ETH_STAKE])],
      ["trader approves NVDAc coin → share", call(TRADER, stockCoin, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [stockShare, STOCK_STAKE] }))],
      ["trader stakes 10,000 NVDAc coin", shareCall(TRADER, stockShare, "stake", [STOCK_STAKE])],
      ["harvest ETH share", shareCall(TRADER, ethShare, "harvest")],
      ["harvest NVDAc share", shareCall(TRADER, stockShare, "harvest")],
      ["v3.owed(NVDAc share, NVDAc)", owedTo(stockShare, NVDA)],
      ["claimable launcher (ETH share), same second", shareCall(LAUNCHER, ethShare, "claimable", [LAUNCHER])],
      ["claimable trader (NVDAc share), same second", shareCall(LAUNCHER, stockShare, "claimable", [TRADER])],
    ],
  },
  {
    blockOverrides: { time: toHex(T + 30n + STREAM / 2n) },
    steps: [
      ["claimable launcher (ETH share), +STREAM/2", shareCall(LAUNCHER, ethShare, "claimable", [LAUNCHER])],
      ["claimable trader (NVDAc share), +STREAM/2", shareCall(LAUNCHER, stockShare, "claimable", [TRADER])],
    ],
  },
  {
    blockOverrides: { time: toHex(T + 31n + STREAM) },
    steps: [
      ["claimable launcher (ETH share), +STREAM", shareCall(LAUNCHER, ethShare, "claimable", [LAUNCHER])],
      ["claimable trader (NVDAc share), +STREAM", shareCall(LAUNCHER, stockShare, "claimable", [TRADER])],
      ["launcher claims (ETH share)", shareCall(LAUNCHER, ethShare, "claim", [LAUNCHER])],
      ["trader claims (NVDAc share)", shareCall(TRADER, stockShare, "claim", [TRADER])],
      ["payAgent (ETH share)", shareCall(TRADER, ethShare, "payAgent")],
      ["payAgent (NVDAc share)", shareCall(TRADER, stockShare, "payAgent")],
      ["agent's NVDAc", balance(NVDA, AGENT)],
      ["agent's NVDAc coin", balance(stockCoin, AGENT)],
      ["agent's ETH coin", balance(ethCoin, AGENT)],
      ["NVDAc left in the NVDAc share", balance(NVDA, stockShare)],
      ["launcher unstakes", shareCall(LAUNCHER, ethShare, "unstake", [ETH_STAKE])],
      ["trader unstakes", shareCall(TRADER, stockShare, "unstake", [STOCK_STAKE])],
    ],
  },
];

type Log = { address: string; topics: string[]; data: string };
const result = (await rpc("eth_simulateV1", [
  { blockStateCalls: blocks.map(({ steps, ...b }) => ({ ...b, calls: steps.map(([, c]) => c) })), traceTransfers: true, validation: false },
  AT,
])) as { timestamp: string; calls: { status: string; gasUsed: string; returnData: string; logs: Log[]; error?: { message: string } }[] }[];

const events = (logs: Log[], abi: Abi, at: string) =>
  logs
    .filter((l) => l.address.toLowerCase() === at.toLowerCase())
    .flatMap((l) => {
      try {
        return [decodeEventLog({ abi, topics: l.topics as [Hex, ...Hex[]], data: l.data as Hex })];
      } catch {
        return [];
      }
    });
const ethTo = (logs: Log[], from: string, to: string) =>
  logs
    .filter((l) => l.address.toLowerCase() === NATIVE_LOGS && l.topics[0] === TRANSFER && `0x${l.topics[1]!.slice(-40)}` === from.toLowerCase() && `0x${l.topics[2]!.slice(-40)}` === to.toLowerCase())
    .reduce((s, l) => s + BigInt(l.data), 0n);

const symbolOf = (c: string) => (c === NATIVE ? "ETH" : c.toLowerCase() === NVDA.toLowerCase() ? "NVDAc" : c.toLowerCase() === ethCoin.toLowerCase() ? "ETH coin" : "NVDAc coin");
const arrived: Record<string, { amount: bigint; toAgent: bigint }> = {}; // keyed share:currency
const claimed: Record<string, bigint> = {};
const agentPaid: Record<string, bigint> = {};
const collected: string[] = [];

console.log(`pinned on Base block ${Number(AT)} (time ${Number(pinned.timestamp)}) · v3 ${V3} · hook ${hook}`);
console.log(`Blue Agent approved on v3: ${blueApproved} · NVDAc enabled at tick ${nvdaTick} · Relay out ${Number(relayQuote.details.currencyOut.amount) / 1e8} NVDAc`);
result.forEach((block, b) => {
  console.log(`— block at T+${BigInt(block.timestamp) - T}s`);
  block.calls.forEach((c, i) => {
    const name = blocks[b]!.steps[i]![0];
    const ok = c.status === "0x1";
    let value = "";
    if (ok && (name.includes("isActive") || name.includes("referrerOf") || name.startsWith("v3.owed") || name.startsWith("agent's") || name.startsWith("NVDAc left"))) {
      value = name.includes("referrerOf") ? `0x${c.returnData.slice(-40)}` : BigInt(c.returnData).toString();
    } else if (ok && (name.startsWith("claimable") || name.includes(" claims"))) {
      const [a0, a1] = decodeFunctionResult({ abi: SHARE_ABI, functionName: name.startsWith("claimable") ? "claimable" : "claim", data: c.returnData as Hex }) as [bigint, bigint];
      value = `${a0} / ${a1}`;
    }
    for (const share of [ethShare, stockShare]) {
      for (const e of events(c.logs, SHARE_ABI, share)) {
        const args = e.args as unknown as Record<string, unknown>;
        const key = `${share}:${String(args.currency).toLowerCase()}`;
        if (e.eventName === "Arrived") {
          arrived[key] = { amount: (arrived[key]?.amount ?? 0n) + (args.amount as bigint), toAgent: (arrived[key]?.toAgent ?? 0n) + (args.toAgent as bigint) };
          value += ` Arrived ${args.amount} ${symbolOf(String(args.currency))} (agent ${args.toAgent});`;
        } else if (e.eventName === "Claimed") {
          if (args.paid) claimed[key] = (claimed[key] ?? 0n) + (args.amount as bigint);
          value += ` Claimed ${args.amount} ${symbolOf(String(args.currency))} paid=${args.paid};`;
        } else if (e.eventName === "AgentPaid") {
          if (args.paid) agentPaid[key] = (agentPaid[key] ?? 0n) + (args.amount as bigint);
          value += ` AgentPaid ${args.amount} ${symbolOf(String(args.currency))} paid=${args.paid};`;
        }
      }
    }
    for (const e of events(c.logs, FACTORY_ABI, V3)) {
      if (e.eventName !== "FeesCollected") continue;
      const args = e.args as unknown as { token: string; amount0: bigint; amount1: bigint };
      const pool = args.token.toLowerCase() === ethCoin.toLowerCase() ? ethPool : stockPool;
      const share = pool === ethPool ? ethShare : stockShare;
      // what the launchpad pushed to the share: 80% of each currency, by its own rounding
      const c0 = (args.amount0 * 8000n) / 10000n;
      const c1 = (args.amount1 * 8000n) / 10000n;
      const ethPushed = ethTo(c.logs, V3, share);
      collected.push(
        `${symbolOf(args.token)}: collect ${args.amount0} ${symbolOf(pool.key.currency0)} / ${args.amount1} ${symbolOf(pool.key.currency1)} → share's 80% = ${c0} / ${c1}` +
          (pool === ethPool ? ` · ETH pushed to the share (traceTransfers) ${ethPushed} ${ethPushed === c0 ? "= 80%" : "≠ 80%"}` : ""),
      );
      value += ` FeesCollected ${args.amount0} / ${args.amount1};`;
    }
    console.log(`${ok ? "✓" : "✗"} ${name.padEnd(52)} gas ${String(Number(BigInt(c.gasUsed))).padStart(9)}  ${ok ? value.trim() : c.error?.message}`);
  });
});

console.log("— the split, checked");
for (const line of collected) console.log(line);
for (const [key, a] of Object.entries(arrived)) {
  const [share, currency] = key.split(":") as [string, string];
  const who = share === ethShare ? "ETH share" : "NVDAc share";
  const stakers = a.amount - a.toAgent;
  const got = claimed[key] ?? 0n;
  const agent = agentPaid[key] ?? 0n;
  const exactAgent = a.toAgent === (a.amount * BigInt(AGENT_BPS)) / 10000n;
  console.log(
    `${who} · ${symbolOf(currency)}: arrived ${a.amount} → agent ${a.toAgent} (${exactAgent ? "exactly 20%" : "NOT 20%"}), paid ${agent} · stakers ${stakers}, the only staker claimed ${got} (left behind ${stakers - got})`,
  );
}
console.log(`deployer ${deployer} · ETH coin ${ethCoin} → share ${ethShare} · NVDAc coin ${stockCoin} → share ${stockShare} (coin is currency${stockPool.tokenIs0 ? 0 : 1})`);
