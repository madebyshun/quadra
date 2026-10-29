/**
 * The opening tick for every Coinbase stock on Base, from live prices — what the launchpad's quote
 * admin passes to `setQuote`. Hand-run (it hits the network):
 *
 *   npx vite-node scripts/quote-ticks.ts [factory address]
 *
 * Every pair opens at the same VALUE as an ETH launch: the ETH pair's whole supply is worth
 * `openingValueEth()` ETH at its opening tick, priced here in USD from the deepest WETH market,
 * and each stock's tick is the one that makes the supply worth the same at that stock's Chainlink
 * NAV (from Coinbase's own API). A stock with no NAV, or with transfers paused, is left out — never
 * guessed. Prints one `base-cast send` line per stock for the quote admin's keystore.
 */
import { openingValue, openingValueEth, startTickFor } from "../src/adapters/http/launchpad";
import { baseStocks } from "../src/adapters/http/markets";
import { ethUsd } from "../src/skills/dexscreener";

const factory = process.argv[2] ?? "<factory>";
const eth = await ethUsd();
if (eth === null) throw new Error("No ETH price: DexScreener could not be read.");
const targetUsd = openingValueEth() * eth;
// every page of Coinbase's list (MEASURED 2026-10-29: the first page alone missed AAPLc, NVDAc and SPCXc)
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
console.log(`\n${lines.join("\n")}`);
