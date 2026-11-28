/**
 * The opening tick for EVERY tradeable Coinbase stock on Base + ecosystem/crypto pairs
 * (`$QUADRA`, `USDC`, `cbBTC`, `AERO`, `VVV`, `VIRTUAL`, `TOSHI`, `CLANKER`), from live prices
 * (Chainlink NAV or DexScreener spot for any minted/liquid Base stock) — what the launchpad's
 * quote admin passes to `setQuote`.
 *
 * Usage:
 *   npx vite-node scripts/quote-ticks.ts [factory address] [--only-missing] [--min-liq=1000]
 *
 * Defaults to CONTRACTS.launchFactoryV3 (0x006Da367654a487bb277fe25ff54f0fE0f741377).
 */
import { ECOSYSTEM_QUOTES, openingValue, openingValueEth, quoteOf, startTickFor } from "../src/adapters/http/launchpad";
import { baseStocks, spots } from "../src/adapters/http/markets";
import { CONTRACTS } from "../src/config/chain";
import { TRADE_CRYPTO } from "../src/config/markets";
import { ethUsd } from "../src/skills/dexscreener";

const args = process.argv.slice(2);
const factory = args.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a)) ?? CONTRACTS.launchFactoryV3 ?? "<factory>";
const onlyMissing = args.includes("--only-missing");
const minLiqArg = args.find((a) => a.startsWith("--min-liq="));
const minLiq = minLiqArg ? Number(minLiqArg.split("=")[1]) : 0;

const eth = await ethUsd();
if (eth === null) throw new Error("No ETH price: DexScreener could not be read.");
const targetUsd = openingValueEth() * eth;
const stocks = await baseStocks();
const allStocks = [...stocks.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
const liveSpots = await spots("base", allStocks.map((s) => s.address));

console.log(`Factory: ${factory}`);
console.log(`ETH $${eth.toFixed(2)} → every pair opens with the supply worth ≈ $${Math.round(targetUsd).toLocaleString("en-US")}`);
console.log(`Catalog: ${allStocks.length} Base stocks (${liveSpots.size} with live DEX pairs)\n`);

const lines: string[] = [];
let enabledAlready = 0;

for (const s of allStocks) {
  if (s.paused.includes(0)) {
    continue;
  }
  const sp = liveSpots.get(s.address.toLowerCase()) ?? null;
  const px = s.nav ?? sp?.price ?? null;
  const liq = sp?.depth ?? 0;
  if (px === null || px <= 0) continue;
  if (minLiq > 0 && liq < minLiq && s.nav === null) continue;

  if (onlyMissing && /^0x[0-9a-fA-F]{40}$/.test(factory)) {
    const existing = await quoteOf(factory, s.address).catch(() => ({ enabled: false, startTick: 0 }));
    if (existing.enabled) {
      enabledAlready++;
      continue;
    }
  }

  const tick = startTickFor(targetUsd, px, s.decimals);
  const src = s.nav !== null ? "NAV" : `DEX ($${Math.round(liq).toLocaleString("en-US")} liq)`;
  console.log(`${s.symbol.padEnd(8)} $${px.toFixed(2).padStart(9)}  ${src.padEnd(20)}  tick ${tick}  opens ≈ ${openingValue(tick, s.decimals).toFixed(2)} ${s.symbol}`);
  lines.push(`base-cast send ${factory} "setQuote(address,bool,int24)" ${s.address} true ${tick} --rpc-url https://mainnet.base.org --account quadra-deployer`);
}

console.log(`\n# Ecosystem & Base crypto quotes (supply target ≈ $${Math.round(targetUsd).toLocaleString("en-US")}):`);
for (const q of [...ECOSYSTEM_QUOTES, ...TRADE_CRYPTO]) {
  if (onlyMissing && /^0x[0-9a-fA-F]{40}$/.test(factory)) {
    const existing = await quoteOf(factory, q.address).catch(() => ({ enabled: false, startTick: 0 }));
    if (existing.enabled) continue;
  }
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

console.log(`\n# Summary: ${lines.length} quotes to enable${onlyMissing ? ` (${enabledAlready} already enabled on-chain)` : ""}`);
console.log(`\n${lines.join("\n")}`);
