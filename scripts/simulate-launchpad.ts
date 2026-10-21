/**
 * The v2 launchpad against REAL Base mainnet state, without deploying or sending anything.
 *
 * One `eth_simulateV1` block, from a keyless address given 10 ETH by state override:
 * deploy LaunchFactory v2 → enable NVDAc at its live opening tick → buy NVDAc through Relay →
 * launch an ETH pair with a 0.01 ETH first buy → launch an NVDAc pair with a first buy in NVDAc →
 * collect both → read every balance back. Against the real Uniswap v4 PoolManager, the real B20
 * precompile and Coinbase's real NVDAc with its real transfer policies. Hand-run:
 *
 *   PATH="$HOME/.foundry/bin:$PATH" npx vite-node scripts/simulate-launchpad.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, getContractAddress, keccak256, parseAbi, parseAbiParameters, toHex } from "viem";
import { CONTRACTS, UNISWAP_V4_POOL_MANAGER } from "../src/config/chain";
import { RELAY } from "../src/config/routes";
import { openingValueEth, startTickFor } from "../src/adapters/http/launchpad";
import { parseBaseStocks } from "../src/adapters/http/markets";
import { ethUsd } from "../src/skills/dexscreener";
import { rpc } from "../src/skills/http";
import { stepsOf } from "../src/skills/simulate";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIM = "0x5157000000000000000000000000000000005157";
const NVDA = "0xb20000000000000000000078ee7ce2fE4908108C";
const B20_FACTORY = "0xB20f000000000000000000000000000000000000";
const ETH_START = 191_200;

execFileSync("base-forge", ["build"], { cwd: resolve(ROOT, "contracts"), stdio: "ignore" });
const artifact = JSON.parse(readFileSync(resolve(ROOT, "contracts/out/LaunchFactory.sol/LaunchFactory.json"), "utf8"));
const FACTORY_ABI = parseAbi([
  "function setQuote(address quote, bool enabled, int24 startTick)",
  "function launch(string name, string symbol, string contractURI, bytes32 salt, address quote, uint256 quoteIn) payable returns (address)",
  "function collect(address token) returns (uint256, uint256)",
]);
const ERC20 = parseAbi(["function approve(address, uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

// the opening tick for NVDAc, from live prices — exactly what scripts/quote-ticks.ts prints
const eth = (await ethUsd())!;
const nvda = parseBaseStocks(await (await fetch("https://api.coinbase.com/v1/tokenized-stocks")).json()).get(NVDA.toLowerCase())
  ?? [...parseBaseStocks(await (await fetch("https://api.coinbase.com/v1/tokenized-stocks")).json()).values()].find((s) => s.symbol === "NVDAc")!;
const nvdaTick = startTickFor(openingValueEth() * eth, nvda.nav!, nvda.decimals);
console.log(`ETH $${eth.toFixed(0)} · NVDAc NAV $${nvda.nav} · NVDAc opening tick ${nvdaTick}`);

const nonce = Number(BigInt((await rpc("eth_getTransactionCount", [SIM, "latest"])) as string));
const factory = getContractAddress({ from: SIM, nonce: BigInt(nonce) });
const deploy = (artifact.bytecode.object as string) + encodeAbiParameters(parseAbiParameters("address, address, address, int24"), [UNISWAP_V4_POOL_MANAGER, CONTRACTS.treasury as `0x${string}`, SIM, ETH_START]).slice(2);

const predict = async (salt: `0x${string}`) => {
  const data = encodeFunctionData({ abi: parseAbi(["function getB20Address(uint8, address, bytes32) view returns (address)"]), args: [0, factory, keccak256(encodeAbiParameters(parseAbiParameters("address, bytes32"), [SIM, salt]))] });
  return `0x${((await rpc("eth_call", [{ to: B20_FACTORY, data }, "latest"])) as string).slice(-40)}`;
};
const ethSalt = toHex(1, { size: 32 });
const stockSalt = toHex(2, { size: 32 });
const [ethToken, stockToken] = [await predict(ethSalt), await predict(stockSalt)];

// NVDAc for the keyless buyer: Relay's own route, run inside the same simulated block
const quote = await (
  await fetch(`${RELAY.api}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: SIM, recipient: SIM, originChainId: 8453, destinationChainId: 8453, originCurrency: "0x0000000000000000000000000000000000000000", destinationCurrency: NVDA, amount: (5n * 10n ** 16n).toString(), tradeType: "EXACT_INPUT" }),
  })
).json();
const relay = stepsOf(quote);
const shares = (BigInt(quote.details.currencyOut.amount) * 95n) / 100n;

const call = (to: string | undefined, data: string, value = 0n) => ({ from: SIM, ...(to ? { to } : {}), data, value: `0x${value.toString(16)}`, gas: "0x1c9c380" });
const balance = (token: string, who: string) => call(token, encodeFunctionData({ abi: ERC20, functionName: "balanceOf", args: [who as `0x${string}`] }));
const calls = [
  call(undefined, deploy),
  call(factory, encodeFunctionData({ abi: FACTORY_ABI, functionName: "setQuote", args: [NVDA, true, nvdaTick] })),
  ...relay.map((s) => call(s.to, s.data, s.value)),
  call(NVDA, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [factory, shares] })),
  call(factory, encodeFunctionData({ abi: FACTORY_ABI, functionName: "launch", args: ["Sim Cat", "SCAT", "", ethSalt, "0x0000000000000000000000000000000000000000", 10n ** 16n] }), 10n ** 16n),
  call(factory, encodeFunctionData({ abi: FACTORY_ABI, functionName: "launch", args: ["Sim Stock Cat", "SSCAT", "", stockSalt, NVDA, shares] })),
  call(factory, encodeFunctionData({ abi: FACTORY_ABI, functionName: "collect", args: [ethToken as `0x${string}`] })),
  call(factory, encodeFunctionData({ abi: FACTORY_ABI, functionName: "collect", args: [stockToken as `0x${string}`] })),
  balance(ethToken, SIM),
  balance(stockToken, SIM),
  balance(stockToken, UNISWAP_V4_POOL_MANAGER),
  balance(NVDA, factory),
];
const names = ["deploy v2", "setQuote(NVDAc)", ...relay.map((_, i) => `Relay step ${i + 1} (buy NVDAc)`), "approve NVDAc", "launch ETH pair, 0.01 ETH first buy", `launch NVDAc pair, ${Number(shares) / 1e8} NVDAc first buy`, "collect ETH pair", "collect NVDAc pair", "ETH-pair token held by launcher", "NVDAc-pair token held by launcher", "NVDAc-pair token in the pool", "NVDAc left in the factory"];

const result = (await rpc("eth_simulateV1", [{ blockStateCalls: [{ stateOverrides: { [SIM]: { balance: `0x${(10n ** 19n).toString(16)}` } }, calls }], traceTransfers: true, validation: false }, "latest"])) as {
  calls: { status: string; gasUsed: string; returnData: string; error?: { message: string } }[];
}[];
result[0]!.calls.forEach((c, i) => {
  const ok = c.status === "0x1";
  const value = ok && c.returnData.length === 66 ? BigInt(c.returnData).toString() : ok && names[i]!.startsWith("collect") ? decodeFunctionResult({ abi: FACTORY_ABI, functionName: "collect", data: c.returnData as `0x${string}` }).join(" / ") : "";
  console.log(`${ok ? "✓" : "✗"} ${names[i]!.padEnd(42)} gas ${String(Number(BigInt(c.gasUsed))).padStart(9)}  ${ok ? value : c.error?.message}`);
});
console.log(`factory ${factory} · ETH-pair token ${ethToken} · NVDAc-pair token ${stockToken} (${BigInt(stockToken) > BigInt(NVDA) ? "token is currency1" : "token is currency0"})`);
