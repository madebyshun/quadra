/**
 * Backstop (contracts/src/Backstop.sol) against REAL Base mainnet state — the real $QUADRA/ETH pool, the real
 * PoolManager and LaunchHook — without deploying or sending anything. Hand-run:
 *
 *   npx vite-node scripts/simulate-backstop.ts [wall ETH] [attack ETH]
 *
 * One `eth_simulateV1` call, blocks pinned on the latest real one, from keyless addresses given ETH by state
 * override. Uniswap's own PoolSwapTest (compiled in contracts/out) does the trading.
 *
 *   A. the job: a seller buys $QUADRA, the Backstop places its ETH under the price, the seller sells it all
 *      back into the band, 31 minutes later a poke burns what the band bought.
 *   B. the attack: the band placed; an attacker pumps $QUADRA with ETH, waits out the interval, pokes so the
 *      band follows the price up (by at most one step), then dumps everything — measured in ETH, against the
 *      same dump with no poke.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { concatHex, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, getContractAddress, parseAbi, type Hex } from "viem";
import { CONTRACTS, UNISWAP_V4_POOL_MANAGER } from "../src/config/chain";
import { rpc } from "../src/skills/http";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WALL = BigInt(Math.round(Number(process.argv[2] ?? "0.2") * 1e18));
const ATTACK = BigInt(Math.round(Number(process.argv[3] ?? "1") * 1e18));
const TOKEN = CONTRACTS.token as Hex;
const FACTORY = CONTRACTS.launchFactoryV3 as Hex;
const DEPLOYER = "0x00000000000000000000000000000000ba5c0001" as Hex;
const SELLER = "0x00000000000000000000000000000000ba5c0002" as Hex;
const ATTACKER = "0x00000000000000000000000000000000ba5c0003" as Hex;
const POKER = "0x00000000000000000000000000000000ba5c0004" as Hex;
/** seconds between simulated blocks: a poke may drag the band one spacing per 24 h */
const STEP = Number(process.env.STEP ?? 24 * 3600 + 60);
const MIN_SQRT = 4295128740n;
const MAX_SQRT = 1461446703485210103287273052203988822378723970341n;

const art = (name: string) => JSON.parse(readFileSync(resolve(ROOT, `contracts/out/${name}.sol/${name}.json`), "utf8")) as { bytecode: { object: Hex } };
const swapperAt = getContractAddress({ from: DEPLOYER, nonce: 0n });
const backstopAt = getContractAddress({ from: DEPLOYER, nonce: 1n });

const LAUNCHES = parseAbi(["function launches(address) view returns ((address creator, address creatorRecipient, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key))"]);
const SWAP = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }",
  "struct TestSettings { bool takeClaims; bool settleUsingBurn; }",
  "function swap(PoolKey key, SwapParams params, TestSettings testSettings, bytes hookData) payable returns (int256 delta)",
]);
const BACKSTOP = parseAbi(["function poke()", "function lower() view returns (int24)", "function liquidity() view returns (uint128)", "function burned() view returns (uint256)"]);
const ERC20 = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

type Call = { from: Hex; to?: Hex; data: Hex; value?: Hex };
const hex = (n: bigint) => `0x${n.toString(16)}` as Hex;

const { key } = (decodeFunctionResult({ abi: LAUNCHES, functionName: "launches", data: (await rpc("eth_call", [{ to: FACTORY, data: encodeFunctionData({ abi: LAUNCHES, functionName: "launches", args: [TOKEN] }) }, "latest"])) as Hex }) as unknown as { key: { currency0: Hex; currency1: Hex; fee: number; tickSpacing: number; hooks: Hex } });

const buy = (from: Hex, eth: bigint): Call => ({ from, to: swapperAt, value: hex(eth), data: encodeFunctionData({ abi: SWAP, functionName: "swap", args: [key, { zeroForOne: true, amountSpecified: -eth, sqrtPriceLimitX96: MIN_SQRT }, { takeClaims: false, settleUsingBurn: false }, "0x"] }) });
const sell = (from: Hex, coins: bigint): Call => ({ from, to: swapperAt, data: encodeFunctionData({ abi: SWAP, functionName: "swap", args: [key, { zeroForOne: false, amountSpecified: -coins, sqrtPriceLimitX96: MAX_SQRT }, { takeClaims: false, settleUsingBurn: false }, "0x"] }) });
const approve = (from: Hex): Call => ({ from, to: TOKEN, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [swapperAt, 2n ** 255n] }) });
const poke: Call = { from: POKER, to: backstopAt, data: encodeFunctionData({ abi: BACKSTOP, functionName: "poke" }) };
const view = (fn: "lower" | "liquidity" | "burned"): Call => ({ from: POKER, to: backstopAt, data: encodeFunctionData({ abi: BACKSTOP, functionName: fn }) });
const balanceOf = (who: Hex): Call => ({ from: POKER, to: TOKEN, data: encodeFunctionData({ abi: ERC20, functionName: "balanceOf", args: [who] }) });
const deploys: Call[] = [
  { from: DEPLOYER, data: concatHex([art("PoolSwapTest").bytecode.object, encodeAbiParameters([{ type: "address" }], [UNISWAP_V4_POOL_MANAGER as Hex])]) },
  { from: DEPLOYER, data: concatHex([art("Backstop").bytecode.object, encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }], [FACTORY, UNISWAP_V4_POOL_MANAGER as Hex, TOKEN])]) },
  { from: DEPLOYER, to: backstopAt, value: hex(WALL), data: "0x" },
];

type Result = { status: string; returnData: Hex; error?: { message: string } };
async function simulate(blocks: Call[][]): Promise<Result[][]> {
  const head = (await rpc("eth_getBlockByNumber", ["latest", false])) as { timestamp: Hex };
  const t0 = Number(BigInt(head.timestamp));
  const rich = { balance: hex(10n ** 21n) };
  const out = (await rpc("eth_simulateV1", [{
    blockStateCalls: blocks.map((calls, i) => ({
      ...(i === 0 ? { stateOverrides: { [DEPLOYER]: rich, [SELLER]: rich, [ATTACKER]: rich, [POKER]: rich } } : {}),
      blockOverrides: { time: hex(BigInt(t0 + 12 + i * STEP)) },
      calls,
    })),
    validation: false,
  }, "latest"])) as { calls: Result[] }[];
  return out.map((b) => b.calls);
}
const ok = (r: Result, what: string) => { if (r.status !== "0x1") throw new Error(`${what} failed: ${r.error?.message ?? r.returnData}`); };
const word = (r: Result) => BigInt(r.returnData.slice(0, 66));
/** PoolSwapTest returns the caller's BalanceDelta: amount0 (ETH) in the high 128 bits, amount1 in the low. */
const deltas = (r: Result) => {
  const d = BigInt.asIntN(256, word(r));
  return { eth: BigInt.asIntN(128, d >> 128n), coins: BigInt.asIntN(128, d & ((1n << 128n) - 1n)) };
};
const eth = (wei: bigint) => (Number(wei) / 1e18).toFixed(6);

// ── A. the job: a holder who bought BEFORE the Backstop existed sells; the band (anchored at deployment) buys
//       what it can under the price, and the next poke burns it
{
  const [swapper, ...backstop] = deploys;
  const placing = [[swapper!, buy(SELLER, BigInt(1e18)), approve(SELLER), balanceOf(SELLER)], [...backstop, poke, view("lower"), view("liquidity")]];
  const [b0, b1] = await simulate(placing);
  [...b0!, ...b1!].forEach((r, i) => ok(r, `A placing ${i}`));
  const held = word(b0!.at(-1)!);
  const run = await simulate([...placing, [sell(SELLER, held), poke, view("burned"), view("liquidity"), view("lower")]]);
  const last = run.at(-1)!;
  last.forEach((r, i) => ok(r, `A filling ${i}`));
  console.log(`A. band ${eth(WALL)} ETH placed at tick ${BigInt.asIntN(24, word(b1!.at(-2)!))} (liquidity ${word(b1!.at(-1)!)}).`);
  console.log(`   a holder sold ${held} $QUADRA wei for ${eth(deltas(last[0]!).eth)} ETH; the poke burned ${word(last[2]!)} $QUADRA wei (${(Number(word(last[2]!)) / 1e25).toFixed(3)}% of the supply); band now ${word(last[3]!)} liquidity at tick ${BigInt.asIntN(24, word(last[4]!))}`);
}

// ── B. the attack: pump, then poke every 30 minutes for k rounds so the band follows, then dump — against k = 0
for (const rounds of [0, 1, 3, 6, 12]) {
  const pokes: Call[][] = Array.from({ length: rounds }, () => [poke]);
  const blocks = await simulate([[...deploys, poke, approve(ATTACKER), buy(ATTACKER, ATTACK), balanceOf(ATTACKER), view("lower")], ...pokes, [view("lower")]]);
  blocks.forEach((b, i) => b.forEach((r, j) => ok(r, `B${rounds} block ${i} call ${j}`)));
  const pumped = deltas(blocks[0]!.at(-3)!);
  const held = word(blocks[0]!.at(-2)!);
  const placedAt = BigInt.asIntN(24, word(blocks[0]!.at(-1)!));
  const draggedTo = BigInt.asIntN(24, word(blocks.at(-1)![0]!));
  const run = await simulate([[...deploys, poke, approve(ATTACKER), buy(ATTACKER, ATTACK)], ...pokes, [sell(ATTACKER, held), poke, view("burned")]]);
  const last = run.at(-1)!;
  last.forEach((r, j) => ok(r, `B${rounds} dump ${j}`));
  const dumped = deltas(last[0]!);
  const net = pumped.eth + dumped.eth;
  console.log(`B. pump ${eth(-pumped.eth)} ETH, ${rounds} poke(s) over ${((rounds * STEP) / 3600).toFixed(1)} h (band tick ${placedAt} -> ${draggedTo}), dump: out ${eth(dumped.eth)} ETH, attacker net ${net >= 0n ? "+" : ""}${eth(net)} ETH; band burned ${word(last[2]!)} wei`);
}

// ── C. the FeeRouter as v3's protocol recipient: the treasury proposes it, it accepts, a real coin's fees are
//       collected into it and split — half the ETH to the Backstop, the rest and every token to the treasury
{
  const TREASURY = CONTRACTS.treasury as Hex;
  // nonce 3: the swapper, the Backstop and the ETH sent to it come first
  const routerAt = getContractAddress({ from: DEPLOYER, nonce: 3n });
  const ROUTER = parseAbi(["function accept()", "function distribute(address[] currencies)"]);
  const V3 = parseAbi(["function proposeProtocolRecipient(address)", "function protocolRecipient() view returns (address)", "function collect(address) returns (uint256,uint256)"]);
  const [b0] = await simulate([[
    ...deploys,
    { from: DEPLOYER, data: concatHex([art("FeeRouter").bytecode.object, encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }], [FACTORY, TREASURY, backstopAt])]) },
    { from: TREASURY, to: FACTORY, data: encodeFunctionData({ abi: V3, functionName: "proposeProtocolRecipient", args: [routerAt] }) },
    { from: POKER, to: routerAt, data: encodeFunctionData({ abi: ROUTER, functionName: "accept" }) },
    { from: POKER, to: FACTORY, data: encodeFunctionData({ abi: V3, functionName: "protocolRecipient" }) },
    { from: POKER, to: swapperAt, value: hex(BigInt(1e17)), data: buy(SELLER, BigInt(1e17)).data },
    { from: POKER, to: FACTORY, data: encodeFunctionData({ abi: V3, functionName: "collect", args: [TOKEN] }) },
    balanceOf(TREASURY),
    { from: POKER, to: routerAt, data: encodeFunctionData({ abi: ROUTER, functionName: "distribute", args: [["0x0000000000000000000000000000000000000000", TOKEN]] }) },
    balanceOf(TREASURY),
    balanceOf(routerAt),
  ]]);
  b0!.forEach((r, i) => ok(r, `C call ${i}`));
  const recipient = `0x${b0![6]!.returnData.slice(26)}`;
  console.log(`C. protocol recipient after accept: ${recipient} (router ${routerAt.toLowerCase()}); treasury $QUADRA ${word(b0![9]!)} -> ${word(b0![11]!)} after distribute; router left ${word(b0![12]!)}`);
}
