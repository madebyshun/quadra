/**
 * BasketRouter against REAL Base mainnet state, without deploying or sending anything.
 *
 * One `eth_simulateV1` block on the latest real block:
 *   1. a keyless deployer (given ETH by state override) deploys BasketRouter with the real USDC and
 *      Relay's two pinned approval proxies (config/routes.ts);
 *   2. the buyer approves the router for exactly the basket's total;
 *   3. the buyer calls `buy(legs, deadline)` — each leg is a LIVE Relay quote asked with the router as
 *      the sender and the buyer as the recipient, checked by this app's own `checkSwap`;
 *   4. the buyer's balance of each stock is read in the same block.
 *
 * The buyer is a real address holding real USDC (the owner's test wallet by default). Never
 * broadcasts, holds no key:
 *
 *   PATH="$HOME/.foundry/bin:$PATH" npx vite-node scripts/simulate-basket-router.ts [buyer] [usdc each]
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { concatHex, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, erc20Abi, getContractAddress } from "viem";
import { USDC } from "../src/config/chain";
import { RELAY, RELAY_V32 } from "../src/config/routes";
import { buyData, deadlineFrom, routerLeg, totalOf, type RouterLeg } from "../src/lib/basketRouter";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RPC = "https://mainnet.base.org";
const BUYER = (process.argv[2] ?? "0x92c0a50966CcDB5e25770CFFD64B4B249ADf42e9") as `0x${string}`;
const EACH = BigInt(Math.round(Number(process.argv[3] ?? "0.25") * 1e6));
const DEPLOYER = "0x00000000000000000000000000000000BA5CE700" as const;
const STOCKS = {
  NVDAc: "0xb20000000000000000000078ee7ce2fE4908108C",
  AAPLc: "0xb200000000000000000000C2e324d24d7eEcd1fb",
} as const;

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

const artifact = JSON.parse(readFileSync(resolve(ROOT, "contracts/out/BasketRouter.sol/BasketRouter.json"), "utf8")) as { bytecode: { object: `0x${string}` } };
const args = encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }], [USDC.address, RELAY.approvalProxy, RELAY_V32.approvalProxy]);
// ROUTER=0x… simulates against a router already on chain; otherwise one is deployed in the block
const DEPLOYED = process.env.ROUTER as `0x${string}` | undefined;
const router = DEPLOYED ?? getContractAddress({ from: DEPLOYER, nonce: 0n });

// the app's own leg builder: a Relay quote with the router as sender and the buyer as recipient, checked by checkSwap
const quoted: { leg: RouterLeg; out: bigint }[] = [];
for (const [symbol, token] of Object.entries(STOCKS)) {
  const { leg, quote } = await routerLeg(router, BUYER, { kind: "erc20", address: token, symbol, decimals: 8 }, EACH, 100);
  quoted.push({ leg, out: quote.out });
  await new Promise((r) => setTimeout(r, 1500)); // Relay refuses a burst (MEASURED)
}
const legs = quoted.map((q) => q.leg);
const total = totalOf(legs);
const deadline = deadlineFrom(Date.now());
const calls = [
  ...(DEPLOYED ? [{ from: DEPLOYER, to: DEPLOYER, data: "0x" as const }] : [{ from: DEPLOYER, data: concatHex([artifact.bytecode.object, args]) }]),
  { from: BUYER, to: USDC.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [router, total] }) },
  { from: BUYER, to: router, data: buyData(legs, deadline) },
  ...Object.values(STOCKS).map((t) => ({ to: t, data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [BUYER] }) })),
  { to: USDC.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [router] }) },
];
const before = await Promise.all(Object.values(STOCKS).map(async (t) => BigInt((await rpc("eth_call", [{ to: t, data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [BUYER] }) }, "latest"])) as string)));
const result = (await rpc("eth_simulateV1", [{ blockStateCalls: [{ stateOverrides: { [DEPLOYER]: { balance: "0xde0b6b3a7640000" } }, calls }], validation: false }, "latest"])) as { calls: { status: string; returnData: string; gasUsed: string; error?: { message: string } }[] }[];
const r = result[0]!.calls;
console.log(`router (simulated) ${router}; buyer ${BUYER}; ${legs.length} legs, ${Number(total) / 1e6} USDC`);
console.log(`deploy ${r[0]!.status}  approve ${r[1]!.status}  buy ${r[2]!.status} gas ${BigInt(r[2]!.gasUsed)}${r[2]!.error ? ` — ${r[2]!.error.message}` : ""}`);
Object.keys(STOCKS).forEach((s, i) => {
  const after = decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", data: r[3 + i]!.returnData as `0x${string}` });
  console.log(`${s}: quoted ${Number(quoted[i]!.out) / 1e8}, min ${Number(legs[i]!.minOut) / 1e8}, arrived ${Number(after - before[i]!) / 1e8}`);
});
console.log(`USDC left in the router: ${decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", data: r.at(-1)!.returnData as `0x${string}` })}`);
