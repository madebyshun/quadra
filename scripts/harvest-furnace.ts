/**
 * Permissionless keeper script for QuadraFurnace (`harvest()`).
 *
 * Anyone may call `harvest()` — no Treasury or admin key is needed. Use a small dedicated gas wallet
 * (~$3 ETH on Base; each call costs <$0.001). When run without `HARVEST_PRIVATE_KEY`, it performs a
 * read-only dry run showing pending pool fees and projected burn / buyback amounts.
 *
 * Usage:
 *   npx vite-node scripts/harvest-furnace.ts                # dry run
 *   HARVEST_PRIVATE_KEY=0x... npx vite-node scripts/harvest-furnace.ts
 *   FORCE=1 HARVEST_PRIVATE_KEY=0x... npx vite-node scripts/harvest-furnace.ts
 */
import { createPublicClient, createWalletClient, formatEther, http, parseAbi, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const RPC = process.env.BASE_RPC_URL?.trim() || "https://base.publicnode.com";
const FACTORY = "0x006Da367654a487bb277fe25ff54f0fE0f741377" as const;
const TOKEN = "0xB200000000000000000000bdb78b7B145fB15d7F" as const;
const DEAD = "0x000000000000000000000000000000000000dEaD" as const;

const MIN_ETH_WEI = parseEther(process.env.MIN_ETH || "0.001");
const MIN_QUADRA_WEI = parseEther(process.env.MIN_QUADRA || "10000");
const FORCE = process.env.FORCE === "1" || process.env.FORCE === "true";

const factoryAbi = parseAbi([
  "function launches(address) view returns (address creator, address creatorRecipient, bytes32 poolId, address quote)",
  "function collect(address token) returns (uint256 amount0, uint256 amount1)",
]);

const furnaceAbi = parseAbi([
  "function burnBps() view returns (uint256)",
  "function toBuy() view returns (uint256)",
  "function burnedFromFees() view returns (uint256)",
  "function burnedFromBuybacks() view returns (uint256)",
  "function harvest()",
]);

async function main() {
  const transport = http(RPC);
  const publicClient = createPublicClient({ chain: base, transport });

  const [, furnace] = await publicClient.readContract({
    address: FACTORY,
    abi: factoryAbi,
    functionName: "launches",
    args: [TOKEN],
  });

  const [burnBps, toBuyBefore, burnedFeesBefore, burnedBuybacksBefore] = await Promise.all([
    publicClient.readContract({ address: furnace, abi: furnaceAbi, functionName: "burnBps" }),
    publicClient.readContract({ address: furnace, abi: furnaceAbi, functionName: "toBuy" }),
    publicClient.readContract({ address: furnace, abi: furnaceAbi, functionName: "burnedFromFees" }),
    publicClient.readContract({ address: furnace, abi: furnaceAbi, functionName: "burnedFromBuybacks" }),
  ]);

  // Simulate collect(TOKEN) to measure exact uncollected fees in LaunchFactoryV3
  const sim = await publicClient.simulateContract({
    address: FACTORY,
    abi: factoryAbi,
    functionName: "collect",
    args: [TOKEN],
    account: DEAD,
  });
  const [ethFees, quadraFees] = sim.result;
  const estBurnQuadra = ((quadraFees * 8000n) / 10000n) * burnBps / 10000n;
  const estToBuyEth = ((ethFees * 8000n) / 10000n) * burnBps / 10000n;

  console.log("QuadraFurnace:", furnace);
  console.log("Pending pool fees:", `${formatEther(ethFees)} ETH`, "+", `${formatEther(quadraFees)} QUADRA`);
  console.log("Projected on harvest:", `burn ${formatEther(estBurnQuadra)} QUADRA`, "|", `add ${formatEther(estToBuyEth)} ETH to toBuy`);
  console.log("Current totals:", `burned=${formatEther(burnedFeesBefore + burnedBuybacksBefore)} QUADRA`, "|", `toBuy=${formatEther(toBuyBefore)} ETH`);

  const meetsThreshold = FORCE || ethFees >= MIN_ETH_WEI || quadraFees >= MIN_QUADRA_WEI;
  if (!meetsThreshold) {
    console.log(`Below threshold (MIN_ETH=${formatEther(MIN_ETH_WEI)}, MIN_QUADRA=${formatEther(MIN_QUADRA_WEI)}). Skipping.`);
    return;
  }

  const pk = process.env.HARVEST_PRIVATE_KEY?.trim();
  if (!pk) {
    console.log("Dry run complete (set HARVEST_PRIVATE_KEY to broadcast harvest()).");
    return;
  }

  const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Hex);
  const walletClient = createWalletClient({ account, chain: base, transport });

  const { request } = await publicClient.simulateContract({
    address: furnace,
    abi: furnaceAbi,
    functionName: "harvest",
    account,
  });
  const hash = await walletClient.writeContract(request);
  console.log("Sent harvest() tx:", `https://basescan.org/tx/${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`harvest() reverted: ${hash}`);

  const [toBuyAfter, burnedFeesAfter, burnedBuybacksAfter] = await Promise.all([
    publicClient.readContract({ address: furnace, abi: furnaceAbi, functionName: "toBuy" }),
    publicClient.readContract({ address: furnace, abi: furnaceAbi, functionName: "burnedFromFees" }),
    publicClient.readContract({ address: furnace, abi: furnaceAbi, functionName: "burnedFromBuybacks" }),
  ]);

  console.log("Confirmed in block:", receipt.blockNumber.toString());
  console.log("New totals:", `burned=${formatEther(burnedFeesAfter + burnedBuybacksAfter)} QUADRA`, "|", `toBuy=${formatEther(toBuyAfter)} ETH`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
