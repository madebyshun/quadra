/**
 * Permissionless keeper for Stage C (docs/BACKSTOP.md): the FeeRouter's `distribute([ETH])` and the Backstop's
 * `poke()`. Neither needs the treasury: any gas wallet may call both. Without `HARVEST_PRIVATE_KEY` it is a dry
 * run that prints what it would do.
 *
 *   npx vite-node scripts/keep-backstop.ts
 *   HARVEST_PRIVATE_KEY=0x... npx vite-node scripts/keep-backstop.ts
 */
import { createPublicClient, createWalletClient, formatEther, http, parseAbi, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const RPC = process.env.BASE_RPC_URL?.trim() || "https://base.publicnode.com";
// CONTRACTS.feeRouter / CONTRACTS.backstop in src/config/chain.ts, deployed 2026-11-26
const ROUTER = "0xFad19ece5eB90cC4442589541fa3Be9d0853169c" as const;
const BACKSTOP = "0xc5b6CA155E17a4Ff45ffC056Ff39468d48940409" as const;
const ETH = "0x0000000000000000000000000000000000000000" as const;
// $QUADRA (CONTRACTS.token): its pool pays the protocol share in the coin too, all of it to the treasury
const QUADRA = "0xB200000000000000000000bdb78b7B145fB15d7F" as const;
/** Below this the router's ETH is left to grow: a distribute costs gas for nothing. */
const MIN_DISTRIBUTE = parseEther(process.env.MIN_DISTRIBUTE || "0.0002");

const routerAbi = parseAbi(["function distribute(address[] currencies)"]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const backstopAbi = parseAbi([
  "function poke()",
  "function liquidity() view returns (uint128)",
  "function lower() view returns (int24)",
  "function upper() view returns (int24)",
  "function burned() view returns (uint256)",
  "function lastPoke() view returns (uint256)",
  "function MIN_ETH() view returns (uint256)",
  "function MIN_INTERVAL() view returns (uint256)",
]);

async function main() {
  const transport = http(RPC);
  const pub = createPublicClient({ chain: base, transport });
  const pk = process.env.HARVEST_PRIVATE_KEY?.trim();
  let wallet: ReturnType<typeof createWalletClient> | null = null;
  let account: ReturnType<typeof privateKeyToAccount> | null = null;
  if (pk) {
    const hex = pk.startsWith("0x") ? pk.slice(2) : pk;
    // say what is wrong with the secret by its shape only, never any of it
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`HARVEST_PRIVATE_KEY is not 64 hex characters (got ${hex.length} characters).`);
    account = privateKeyToAccount(`0x${hex}` as Hex);
    wallet = createWalletClient({ account, chain: base, transport });
  }

  const send = async (label: string, address: `0x${string}`, abi: typeof routerAbi | typeof backstopAbi, functionName: string, args: readonly unknown[] = []) => {
    if (!wallet || !account) return console.log(`dry run: would call ${label}`);
    // simulated first: a refusal (TooSoon, nothing to do) is printed and skipped, never sent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { request } = await pub.simulateContract({ address, abi, functionName, args, account } as any);
    const hash = await wallet.writeContract(request as never);
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
    console.log(`${label}: https://basescan.org/tx/${hash} (block ${r.blockNumber})`);
  };

  const routerEth = await pub.getBalance({ address: ROUTER });
  console.log("FeeRouter ETH:", formatEther(routerEth));
  if (routerEth >= MIN_DISTRIBUTE) await send("distribute([ETH])", ROUTER, routerAbi, "distribute", [[ETH]]);
  else console.log(`below ${formatEther(MIN_DISTRIBUTE)} ETH, not distributed`);
  const routerCoins = await pub.readContract({ address: QUADRA, abi: erc20Abi, functionName: "balanceOf", args: [ROUTER] });
  if (routerCoins > 0n) await send("distribute([QUADRA])", ROUTER, routerAbi, "distribute", [[QUADRA]]);

  const read = (functionName: string) => pub.readContract({ address: BACKSTOP, abi: backstopAbi, functionName } as never) as Promise<bigint>;
  const [eth, liquidity, minEth, lastPoke, interval, burned] = await Promise.all([
    pub.getBalance({ address: BACKSTOP }),
    read("liquidity"),
    read("MIN_ETH"),
    read("lastPoke"),
    read("MIN_INTERVAL"),
    read("burned"),
  ]);
  console.log("Backstop:", `held ${formatEther(eth)} ETH`, `| liquidity ${liquidity}`, `| burnt ${formatEther(burned)} QUADRA`);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (liquidity > 0n && now < lastPoke + interval) return console.log("poke: too soon, skipped");
  if (liquidity === 0n && eth < minEth) return console.log(`poke: under ${formatEther(minEth)} ETH and no band placed, skipped`);
  await send("poke()", BACKSTOP, backstopAbi, "poke");
  const [lower, upper] = await Promise.all([read("lower"), read("upper")]);
  console.log("band:", `${lower}..${upper}`, `| burnt ${formatEther(await read("burned"))} QUADRA`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
