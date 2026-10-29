// Hand-run: builds the $QUADRA launch calldata (v3, paired with AAPLc, 1%, no referrer) with the
// on-chain pixel logo in its metadata. Nothing is signed: `npx vite-node scripts/prepare-quadra-launch.ts <logo.svg> <out>`.
import { readFileSync, writeFileSync } from "node:fs";
import { encodeFunctionData, toHex } from "viem";
import { LAUNCHPAD_V3_ABI } from "../src/config/launchpad";
const [svgPath, out] = process.argv.slice(2);
const svg = readFileSync(svgPath!, "utf8");
const image = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const meta = {
  name: "Quadra",
  symbol: "QUADRA",
  description: "The token of Quadra, an on-chain supercomputer for Base: check any token before you buy, launch a coin paired with ETH or a stock, every action signed in your own wallet. Paired with AAPLc. No admin, fixed supply, liquidity locked for good.",
  image,
};
const contractURI = `data:application/json;base64,${Buffer.from(JSON.stringify(meta)).toString("base64")}`;
const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
const data = encodeFunctionData({
  abi: LAUNCHPAD_V3_ABI,
  functionName: "launch",
  args: ["Quadra", "QUADRA", contractURI, salt, "0xb200000000000000000000C2e324d24d7eEcd1fb", 0n, 10_000, "0x0000000000000000000000000000000000000000"],
});
writeFileSync(out!, data);
console.log("calldata bytes:", (data.length - 2) / 2, "contractURI chars:", contractURI.length);
