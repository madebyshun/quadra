/**
 * The opening tick for every Coinbase stock on Base + ecosystem/crypto pairs (`$blocky`, `USDC`,
 * `cbBTC`, `AERO`), from live prices — what the launchpad's quote admin passes to `setQuote`.
 * Hand-run (it hits the network):
 *
 *   npx vite-node scripts/quote-ticks.ts [factory address]
 */
import { ECOSYSTEM_QUOTES, openingValue, openingValueEth, startTickFor } from "../src/adapters/http/launchpad";
import { baseStocks } from "../src/adapters/http/markets";
import { TRADE_CRYPTO } from "../src/config/markets";
import { ethUsd } from "../src/skills/dexscreener";

const factory = process.argv[2] ?? "<factory>";
const eth = await ethUsd();
if (eth === null) throw new Error("No ETH price: DexScreener could not be read.");
const targetUsd = openingValueEth() * eth;
const stocks = await baseStocks();

console.log(`ETH $${eth.toFixed(2)} → every pair opens with the supply worth ≈ $${Math.round(targetUsd).toLocaleString("en-US")}\n`);
const lines: string[] = [];

for (const s of [...stocks.values()].sort((a, b) => a.symbol.localeCompare(b.symbol))) {
  if (s.nav === null || s.paused.length > 0) {
    console.log(`${s.symbol.padEnd(8)} skipped — ${s.nav === null ? "no NAV published" : "a feature is paused"}`);
    continue;
  }
  const tick = startTickFor(targetUsd, s.nav, s.decimals);
  console.log(`${s.symbol.padEnd(8)} $${s.nav.toFixed(2).padStart(9)}  ${s.decimals} dp  tick ${tick}  opens ≈ ${openingValue(tick, s.decimals).toFixed(2)} ${s.symbol}`);
  lines.push(`base-cast send ${factory} "setQuote(address,bool,int24)" ${s.address} true ${tick} --rpc-url https://mainnet.base.org --account quadra-deployer`);
}

console.log(`\n# Ecosystem & Base crypto quotes (supply target ≈ $${Math.round(targetUsd).toLocaleString("en-US")}):`);
for (const q of [...ECOSYSTEM_QUOTES, ...TRADE_CRYPTO]) {
  const res = await fetch(`https://api.dexscreener.com/tokens/v1/base/${q.address}`).then((r) => r.json()).catch(() => []) as { priceUsd?: string }[];
  const px = Number(res[0]?.priceUsd ?? (q.symbol === "USDC" ? 1 : 0));
  if (!Number.isFinite(px) || px <= 0) {
    console.log(`${q.symbol.padEnd(10)} skipped — price not read from DexScreener`);
    continue;
  }
  const tick = startTickFor(targetUsd, px, q.decimals);
  console.log(`${q.symbol.padEnd(10)} $${px.toFixed(6).padStart(11)}  ${q.decimals} dp  tick ${tick}  opens ≈ ${openingValue(tick, q.decimals).toFixed(2)} ${q.symbol}`);
  lines.push(`base-cast send ${factory} "setQuote(address,bool,int24)" ${q.address} true ${tick} --rpc-url https://mainnet.base.org --account quadra-deployer`);
}

console.log(`\n${lines.join("\n")}`);
