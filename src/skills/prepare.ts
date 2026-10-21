import { BRAND } from "@/brand";
import {
  checkFactory,
  launchFactory,
  launchPairs,
  launchTx,
  LAUNCH_FEES,
  metadataProblem,
  newSalt,
  openingValue,
  predictToken,
  quoteOf,
  type LaunchFee,
  type Metadata,
  type Pair,
} from "@/adapters/http/launchpad";
import { feePercent } from "@/config/launchpad";
import { assertChecksummedAddress, hasAddressShape, toChecksumAddress } from "@/lib/address";
import { formatAmount, parseAmount } from "@/lib/amount";
import { approveData, balanceOf, ETH, ETH_GAS_RESERVE } from "@/lib/erc20";
import { chainToken } from "@/skills/chaintoken";
import { explorer } from "@/skills/format";
import { row, type Report, type Row, type Skill } from "@/skills/types";

/**
 * Launch (prepared) — a coin on this app's own launchpad, for an AGENT: it checks the launchpad and
 * the pair on the chain and returns the transaction(s) to sign, UNSIGNED, with the token's address
 * predicted. Nothing here signs or sends (hard rule 5): the creator's own wallet signs, in order.
 * 2026-10-02, the sixth of the x402 tools the owner chose — the one that earns beyond its price,
 * because every coin launched pays this app 20% of its pool's 1% fee for good.
 *
 * The same checks the Launch window makes: the factory answers every expected number
 * (`checkFactory`), the pair is ENABLED at the tick read now, a first buy is an exact amount in the
 * pair's own decimals (hard rules 3, 7), and a stock first buy comes with its EXACT approval first.
 */

const ETH_QUOTE = "0x0000000000000000000000000000000000000000";
const ETH_PAIR = (startTick: number): Pair => ({ address: ETH_QUOTE, symbol: "ETH", name: "Ether", decimals: 18, startTick });

/** The pair asked for: ETH, a stock the factory enabled by its symbol, or any enabled quote by address. */
async function pairOf(factory: string, asked: string): Promise<Pair> {
  const text = asked.trim();
  if (text === "" || text.toUpperCase() === "ETH") {
    const q = await quoteOf(factory, ETH_QUOTE);
    if (!q.enabled) throw new Error("The launchpad does not pair with ETH right now.");
    return ETH_PAIR(q.startTick);
  }
  if (hasAddressShape(text)) {
    const address = toChecksumAddress(assertChecksummedAddress(text, "Pair"));
    const q = await quoteOf(factory, address);
    if (!q.enabled) throw new Error(`The launchpad does not pair with ${address}: its quote admin has not enabled it.`);
    const t = await chainToken(address);
    return { address, symbol: t.symbol, name: t.name, decimals: t.decimals, startTick: q.startTick };
  }
  const { pairs, problem } = await launchPairs(factory);
  const found = pairs.find((p) => p.symbol.toLowerCase() === text.toLowerCase());
  if (found) return found;
  const offered = pairs.map((p) => p.symbol).join(", ");
  throw new Error(
    problem
      ? `The list of stocks could not be read (${problem}) — give the stock token's address instead of "${text}".`
      : `The launchpad does not pair with "${text}". It pairs with: ${offered}.`,
  );
}

/** The fee asked for: "1%" or "3%" (v3 only); blank is 1%. Anything else is refused by name. */
export function feeOf(text: string, version: 2 | 3): LaunchFee | undefined {
  const t = text.trim().replace(/\s+/g, "");
  if (version === 2) {
    if (t === "") return undefined;
    throw new Error(`This launchpad (version 2) has one fee, 1% — a fee of "${text.trim()}" cannot be chosen until version 3 is deployed. Leave the fee out.`);
  }
  if (t === "") return LAUNCH_FEES[0];
  const found = LAUNCH_FEES.find((f) => t === feePercent(f) || t === String(f / 10_000));
  if (found === undefined) throw new Error(`The fee must be 1% or 3%; "${text.trim()}" is neither.`);
  return found;
}

/** The transaction rows for one step: where it goes, the ETH it carries, and its calldata. */
export function stepRows(n: number, what: string, tx: { to: string; value?: bigint; data?: string }): Row[] {
  return [
    row(`Step ${n}`, what),
    row(`Step ${n} to`, tx.to, { href: explorer.address(tx.to) }),
    row(`Step ${n} value`, `${(tx.value ?? 0n).toString()} wei`),
    row(`Step ${n} data`, tx.data ?? "0x"),
  ];
}

export async function prepareLaunch(args: readonly string[]): Promise<Report> {
  const [nameText = "", symbolText = "", creatorText = "", pairText = "", buyText = "", feeText = ""] = args;
  const pinned = launchFactory();
  if ("waiting" in pinned) throw new Error(pinned.waiting);
  const factory = pinned.address;
  const fee = feeOf(feeText, pinned.version);
  // a name with spaces arrives joined by underscores — a Terminal line splits on spaces
  const meta: Metadata = { name: nameText.replace(/_/g, " ").trim(), symbol: symbolText.trim(), description: "", image: "", website: "" };
  const bad = metadataProblem(meta);
  if (bad) throw new Error(`${bad}.`);
  const creator = toChecksumAddress(assertChecksummedAddress(creatorText.trim(), "Creator"));

  const check = await checkFactory(factory, pinned.version);
  if (check.kind === "refused") throw new Error(check.why);
  const pair = await pairOf(factory, pairText);
  const firstBuy = buyText.trim() === "" ? 0n : parseAmount(buyText.trim(), pair.decimals);
  const stock = pair.address !== ETH_QUOTE;

  const salt = newSalt();
  const [token, eth, held] = await Promise.all([
    predictToken(factory, creator, salt),
    balanceOf(ETH, creator).catch(() => null),
    stock && firstBuy > 0n ? balanceOf({ kind: "erc20", address: pair.address, symbol: pair.symbol, decimals: pair.decimals }, creator).catch(() => null) : Promise.resolve(null),
  ]);
  const needEth = (stock ? 0n : firstBuy) + ETH_GAS_RESERVE;
  const funds: Row[] = [
    eth === null
      ? row("Creator's ETH", "not checked — the balance could not be read", { tone: "warn" })
      : row("Creator's ETH", `${formatAmount(eth, 18)} ETH${eth < needEth ? ` — not enough: the ${stock ? "gas" : "first buy and gas"} need about ${formatAmount(needEth, 18)}` : ""}`, {
          tone: eth < needEth ? "bad" : "ok",
        }),
    ...(stock && firstBuy > 0n
      ? [
          held === null
            ? row(`Creator's ${pair.symbol}`, "not checked — the balance could not be read", { tone: "warn" as const })
            : row(`Creator's ${pair.symbol}`, `${formatAmount(held, pair.decimals)}${held < firstBuy ? " — not enough for the first buy" : ""}`, { tone: held < firstBuy ? "bad" : "ok" }),
        ]
      : []),
  ];

  const launch = launchTx(factory, meta, salt, pair, firstBuy, fee);
  const pct = fee === undefined ? "1%" : feePercent(fee);
  // v3: the opening as its hook answered at the check — the numbers, not the deploy script's defaults
  const v3Rows =
    fee !== undefined && check.opening
      ? [
          row("Fee", `${pct} of every trade, chosen for this coin (1% or 3%)`),
          row(
            "Opening protection",
            `for the first ${check.opening.window} s the fee falls from ${feePercent(check.opening.startFee)} to ${pct} — a sniper pays most of it; the creator's own first buy inside the launch pays only ${pct}`,
            { tone: "ok" },
          ),
        ]
      : [];
  const steps =
    stock && firstBuy > 0n
      ? [
          ...stepRows(1, `approve exactly ${formatAmount(firstBuy, pair.decimals)} ${pair.symbol} for the launchpad`, { to: pair.address, data: approveData(factory, firstBuy) }),
          ...stepRows(2, `launch ${meta.symbol}`, launch),
        ]
      : stepRows(1, `launch ${meta.symbol}`, launch);
  const short = funds.some((r) => r.tone === "bad");
  const opening = openingValue(pair.startTick, pair.decimals).toLocaleString("en-US", { maximumFractionDigits: 2 });

  return {
    title: `Launch ${meta.name} (${meta.symbol}) — prepared, not sent`,
    rows: [
      row("Ready", short ? "Not yet — the creator's wallet is short (see below)" : stock && firstBuy > 0n ? "Two signatures, in order" : "One signature", { tone: short ? "bad" : "ok" }),
      row("Token", `${token} (predicted — it exists once the launch confirms; only this creator can launch it with this salt)`, { href: explorer.token(token) }),
      row("Creator", creator, { href: explorer.address(creator) }),
      row("Paired with", stock ? `${pair.symbol} — ${pair.address}` : "ETH", stock ? { href: explorer.token(pair.address) } : {}),
      row("Opening value", `the whole supply ≈ ${opening} ${pair.symbol} at the launchpad's opening tick, read now`),
      row("First buy", firstBuy === 0n ? "none" : `${formatAmount(firstBuy, pair.decimals)} ${pair.symbol}, inside the launch, before anyone else can buy`),
      row(
        "Launchpad",
        fee === undefined
          ? `${factory} — checked: supply, 1% fee, 80/20 split, fee address`
          : `${factory} (version 3) — checked: supply, 1%/3% fees, 80/20 split, fee address, its hook's opening`,
        { href: explorer.address(factory), tone: "ok" },
      ),
      ...v3Rows,
      ...funds,
      ...steps,
    ],
    notes: [
      "Nothing was signed or sent. Send each step from the creator's own wallet, in order, waiting for each to confirm — and simulate it first (eth_call), as this app does before every transaction.",
      "The salt is random and binds the token's address to this creator: anyone else sending this calldata gets a different token, or none.",
      `Public: the token, the creator's address and every trade are visible on Base. The creator earns 80% of the pool's ${pct} fee; ${BRAND.name} 20%.`,
      ...(stock ? [`${pair.symbol} is a Coinbase stock token: Coinbase restricts who may hold it (eligible persons outside the U.S.).`] : []),
    ],
    sources: [`Base (the launchpad${stock ? ", the pair's token" : ""} and the creator's balances, read directly)`],
    next: [{ label: "Launch it in the window instead", command: "launch" }],
  };
}

export const prepareLaunchSkill: Skill = {
  id: "launch",
  title: "Launch (prepared)",
  summary: "A coin on this app's own Base launchpad, prepared for your wallet to sign — checked, unsigned, its address predicted.",
  args: [
    { name: "name", hint: "Night_Cat (underscores become spaces)" },
    { name: "symbol", hint: "NCAT" },
    { name: "creator", hint: "0x… the wallet that will sign" },
    { name: "pair", hint: "ETH, a stock symbol like NVDAc, or its address", optional: true },
    { name: "first buy", hint: "0.01 — in the pair's own units", optional: true },
    { name: "fee", hint: "1% or 3% — launchpad version 3 only; 1% if left out", optional: true },
  ],
  run: (args) => prepareLaunch(args),
};
