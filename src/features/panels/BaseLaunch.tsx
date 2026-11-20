import { useEffect, useState } from "react";
import {
  checkFactory,
  collectTx,
  ECOSYSTEM_QUOTES,
  launchedIn,
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
  type Launched,
  type Metadata,
  type Opening,
  type Pair,
  type Version,
} from "@/adapters/http/launchpad";
import { BASE } from "@/config/chain";
import { TRADE_CRYPTO } from "@/config/markets";
import { feePercent, LAUNCHPAD_DECIMALS, LAUNCHPAD_EXPECTS } from "@/config/launchpad";
import { assertChecksummedAddress, toChecksumAddress } from "@/lib/address";
import { formatAmount, parseAmount } from "@/lib/amount";
import { approveData, balanceOf, ETH, ETH_GAS_RESERVE } from "@/lib/erc20";
import { messageOf } from "@/lib/errors";
import { explorer, quoteWords, short, tokenAmount, usd } from "@/skills/format";
import { factories, launchesBy, launchOf, pendingFees, poolValue, type PoolValue } from "@/skills/launchpad";
import { row, type Report } from "@/skills/types";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import { useWalletSession } from "@/ui/WalletProvider";
import { ReportView } from "@/features/panels/ReportView";
import { TxStepList, useTxSteps, type Step } from "@/features/panels/TxSteps";
import { useOpenWindow } from "@/features/openWindow";
import { RESTRICTED_TEXT, useStocksClosed } from "@/lib/region";

/**
 * Launch a coin on this app's own launchpad on Base (`contracts/src/LaunchFactory.sol`), paired with
 * ETH or with one of Coinbase's stocks on Base that the factory has enabled.
 *
 * Fill in → **Review** (the factory is read and checked, the pair re-read, the token's address
 * predicted, the balance read) → **Launch** (one signature; two for a stock first buy — an EXACT
 * approval, then the launch). Any edit throws the review away, so what was reviewed is what is
 * signed. What the review promises — fixed supply, no role held, liquidity no function can remove —
 * is the contract's code; the window only checks it is talking to that contract.
 */

const ETH_QUOTE = "0x0000000000000000000000000000000000000000";
const ETH_PAIR_FALLBACK: Pair = { address: ETH_QUOTE, symbol: "ETH", name: "Ether", decimals: 18, startTick: LAUNCHPAD_EXPECTS.startTick };

/** One of the wallet's own launches, with the fees `collect` would pay now (`null`: not readable). */
type Mine = {
  readonly factory: string;
  readonly token: string;
  readonly at: Date | null;
  readonly fees: { readonly quote: string; readonly inQuote: bigint; readonly inToken: bigint } | null;
  /** the whole supply's value on its own pool (`null`: not readable) */
  readonly value: PoolValue | null;
};
/** How many of a wallet's launches get their fees read — newest first. */
export const SHOWN_LAUNCHES = 10;

/** A quote's amount in its own units, by the pairs this window knows — ETH always, stocks once listed. */
export function quoteAmount(amount: bigint, quote: string, pairs: readonly Pair[]): string {
  const pair = quote === ETH_QUOTE ? ETH_PAIR_FALLBACK : pairs.find((p) => p.address.toLowerCase() === quote.toLowerCase());
  return pair ? `${tokenAmount(amount, pair.decimals, 6)} ${pair.symbol}` : `${amount} raw units of ${short(quote)}`;
}

/** A launch's market cap read from its own pool — the figure DexScreener does not give a stock pair. */
export function valueText(value: PoolValue | null): string {
  if (value === null) return "value not read";
  if (value.quoteUsd === null) return `${quoteWords(value.supplyInQuote)} ${value.quoteSymbol} for the supply`;
  return `market cap ≈ ${usd(value.supplyInQuote * value.quoteUsd)}`;
}

/**
 * MEASURED 2026-10-02 on the owner's AAPLc launches: DexScreener did not list a stock-paired pool at
 * all until its FIRST trade (a KyberSwap buy through MetaMask), then listed it priced in USD
 * ($13,455 fdv). Two TSLAc-paired pools it lists still show no USD price, so it is not promised.
 */
export const STOCK_PAIR_PRICE_NOTE =
  "DexScreener, and the bots that read it, list a coin paired with a stock only after its first trade, and may not price it in USD; this app reads its value from the pool.";

export function feesText(fees: Mine["fees"], pairs: readonly Pair[]): string {
  if (fees === null) return "fees could not be read";
  if (fees.inQuote === 0n && fees.inToken === 0n) return "no fees waiting";
  return `${quoteAmount(fees.inQuote, fees.quote, pairs)} + ${tokenAmount(fees.inToken, LAUNCHPAD_DECIMALS, 2)} tokens waiting — 80% of it to you`;
}

type Review = {
  readonly factory: string;
  readonly salt: `0x${string}`;
  readonly token: string;
  readonly pair: Pair;
  readonly firstBuy: bigint;
  /** v3 only: the coin's chosen fee, and the opening READ from the factory's hook at Review */
  readonly v3?: { readonly fee: LaunchFee; readonly opening: Opening };
};

/** v3's opening protection in words, in the hook's own numbers — never the deploy script's defaults assumed. */
export function openingText(fee: number, opening: Opening): string {
  return `for the first ${opening.window} s the fee falls from ${feePercent(opening.startFee)} to your ${feePercent(fee)} — a sniper pays most of it; your own first buy inside the launch pays only your ${feePercent(fee)}`;
}

const EMPTY: Metadata = { name: "", symbol: "", description: "", image: "", website: "" };

/**
 * What the empty Name and Symbol boxes suggest: a famous computer, one per opening of the window —
 * the owner's choice (2026-10-02), in keeping with an app named after one. A placeholder only:
 * nothing is filled in, and every symbol passes `metadataProblem`.
 */
export const SUGGESTIONS: readonly { readonly name: string; readonly symbol: string }[] = [
  { name: "ENIAC", symbol: "ENIAC" },
  { name: "UNIVAC I", symbol: "UNIVAC" },
  { name: "Altair 8800", symbol: "ALTAIR" },
  { name: "Apple II", symbol: "APPLE2" },
  { name: "Commodore 64", symbol: "C64" },
  { name: "ZX Spectrum", symbol: "ZX" },
  { name: "BBC Micro", symbol: "BBC" },
  { name: "Amiga 500", symbol: "AMIGA" },
  { name: "Atari ST", symbol: "ATARI" },
  { name: "NeXTcube", symbol: "NEXT" },
  { name: "Cray-1", symbol: "CRAY" },
  { name: "PowerBook 100", symbol: "PB100" },
];

/** One suggestion, from a number in [0, 1) — `Math.random()` in the window, a fixed one in a test. */
export function suggestion(r: number) {
  return SUGGESTIONS[Math.floor(r * SUGGESTIONS.length)]!;
}
const SUPPLY_WORDS = (LAUNCHPAD_EXPECTS.supply / 10n ** BigInt(LAUNCHPAD_DECIMALS)).toLocaleString("en-US");

/** The first buy in the pair's own units, or why it cannot be one. Blank means no first buy. */
export function readFirstBuy(text: string, decimals: number): { readonly raw: bigint } | { readonly problem: string } {
  if (text.trim() === "") return { raw: 0n };
  try {
    return { raw: parseAmount(text.trim(), decimals) };
  } catch (e) {
    return { problem: `First buy: ${messageOf(e)}` };
  }
}

export function reviewReport(m: Metadata, review: Review, creator: string): Report {
  const { pair } = review;
  const stock = pair.address !== ETH_QUOTE;
  const opening = openingValue(pair.startTick, pair.decimals);
  const fee = review.v3 ? feePercent(review.v3.fee) : "1%";
  return {
    title: `${m.name.trim()} (${m.symbol.trim()}) — ready to launch on ${BASE.name}`,
    rows: [
      row("Token address", `${review.token} (predicted — it exists once the launch confirms)`),
      row("Supply", `${SUPPLY_WORDS} ${m.symbol.trim()}, fixed — no admin, nobody can mint, pause or seize`, { tone: "ok" }),
      row("Paired with", stock ? `${pair.symbol} — ${pair.name}, Coinbase's stock token on ${BASE.name}` : "ETH", stock ? { href: explorer.token(pair.address) } : {}),
      row("Pool", `Uniswap v4, ${m.symbol.trim()}/${pair.symbol}, ${fee} fee on every trade${review.v3 ? " — your choice" : ""}`),
      ...(review.v3 ? [row("Opening protection", openingText(review.v3.fee, review.v3.opening), { tone: "ok" as const })] : []),
      row("Opening value", `the whole supply ≈ ${opening.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${pair.symbol} at the first price — read from the launchpad`),
      row("Liquidity", "the whole supply, locked in the launchpad forever — it has no function that removes it", { tone: "ok" }),
      row("Fees", `80% of every trade's fee to you, 20% to this app, paid in ${pair.symbol} and the coin — collect them any time`),
      row(
        "First buy",
        review.firstBuy === 0n
          ? "none"
          : `${tokenAmount(review.firstBuy, pair.decimals, 8)} ${pair.symbol}, in the same transaction, before anyone else can buy${stock ? " — an exact approval first" : ""}`,
      ),
      row("Creator", toChecksumAddress(creator), { href: explorer.address(toChecksumAddress(creator)) }),
      row("Sends to", `the launchpad ${review.factory} — checked on ${BASE.name}`, { href: explorer.address(review.factory), tone: "ok" }),
    ],
    notes: [
      "Public: the token, your address as its creator and every trade are visible on Base to anyone.",
      review.v3
        ? "Checked on the chain just now: the launchpad's supply, its two fees, split, fee address, its hook's opening and this pair's opening price."
        : "Checked on the chain just now: the launchpad's supply, fee, split, fee address and this pair's opening price.",
      ...(stock
        ? [
            `${pair.symbol} is issued by Coinbase, which can restrict who holds it; Coinbase's stocks are only for eligible persons outside the U.S. A fee in ${pair.symbol} that cannot be paid to a wallet is kept for that wallet to withdraw.`,
            STOCK_PAIR_PRICE_NOTE,
          ]
        : []),
      "Your wallet shows each transaction again. Gas is extra.",
    ],
    sources: [`the launchpad on ${BASE.name} (read directly)`, ...(stock ? ["Coinbase's tokenized stocks API (the list)"] : [])],
  };
}

export function BaseLaunch() {
  const { wallet, signingProvider } = useWalletSession();
  const openWindow = useOpenWindow();
  const pinned = launchFactory();
  const [meta, setMeta] = useState<Metadata>(EMPTY);
  const [hint] = useState(() => suggestion(Math.random()));
  const [pairs, setPairs] = useState<{ readonly pairs: readonly Pair[]; readonly problem: string | null }>({ pairs: [], problem: null });
  const [pairAt, setPairAt] = useState(ETH_QUOTE);
  const [firstBuy, setFirstBuy] = useState("");
  const [fee, setFee] = useState<LaunchFee>(LAUNCH_FEES[0]);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ readonly launched: Launched; readonly pair: Pair } | "unread" | null>(null);
  const steps = useTxSteps();
  const [feeToken, setFeeToken] = useState("");
  const collecting = useTxSteps();
  const [mine, setMine] = useState<{ readonly list: readonly Mine[]; readonly complete: boolean } | "reading" | { readonly problem: string } | null>(null);
  /** bumped after a launch or a collection, so the list and its fees are read again */
  const [fresh, setFresh] = useState(0);

  const ready = wallet?.kind === "ready" ? wallet : null;
  const factoryAt = "address" in pinned ? pinned.address : null;
  const version: Version | null = "version" in pinned ? pinned.version : null;
  const account = ready?.account ?? null;
  // a U.S. visitor is offered ETH only (lib/region.ts) — a stock picked before the country was read falls back to ETH
  const closed = useStocksClosed();
  const pair = (closed ? undefined : pairs.pairs.find((p) => p.address === pairAt)) ?? ETH_PAIR_FALLBACK;
  const buy = readFirstBuy(firstBuy, pair.decimals);
  const anyFactory = factories().length > 0;

  /** The pairs the factory has enabled, read when the window opens. */
  useEffect(() => {
    if (!factoryAt) return;
    let live = true;
    launchPairs(factoryAt).then(
      (p) => live && setPairs(p),
      (e: unknown) => live && setPairs({ pairs: [], problem: messageOf(e) }),
    );
    return () => {
      live = false;
    };
  }, [factoryAt]);

  /** The wallet's own launches on every factory, newest first, each with the fees waiting for it. */
  useEffect(() => {
    if (!account || !anyFactory) return setMine(null);
    let live = true;
    setMine("reading");
    launchesBy(account).then(
      async ({ launches, complete }) => {
        const list = await Promise.all(
          launches
            .slice(0, SHOWN_LAUNCHES)
            .map(async (l) => ({
              factory: l.factory,
              token: l.token,
              at: l.at,
              fees: await pendingFees(l.factory, l.token).catch(() => null),
              value: await poolValue(l.factory, l.token).catch(() => null),
            })),
        );
        if (live) setMine({ list, complete });
      },
      (e: unknown) => live && setMine({ problem: messageOf(e) }),
    );
    return () => {
      live = false;
    };
  }, [account, anyFactory, fresh]);

  const changed = () => {
    setReview(null);
    setError(null);
    setDone(null);
    steps.reset();
  };
  const set = (key: keyof Metadata) => (v: string) => {
    setMeta({ ...meta, [key]: v });
    changed();
  };

  const blocker =
    "waiting" in pinned
      ? "Not deployed yet"
      : !ready
        ? "Connect a wallet first"
        : (metadataProblem(meta) ?? ("problem" in buy ? buy.problem : null));

  const onReview = async () => {
    setBusy(true);
    setError(null);
    const factory = (pinned as { address: string }).address;
    const chosen = fee;
    const raw = (buy as { raw: bigint }).raw;
    const asked = pair;
    try {
      const check = await checkFactory(factory, version!);
      if (check.kind === "refused") throw new Error(check.why);
      // the pair as the factory has it NOW: still enabled, at the tick the review will show
      const now = await quoteOf(factory, asked.address);
      if (!now.enabled) throw new Error(`The launchpad no longer pairs with ${asked.symbol}. Nothing was sent.`);
      const fresh = { ...asked, startTick: now.startTick };
      const eth = await balanceOf(ETH, ready!.account);
      if (asked.address === ETH_QUOTE) {
        if (raw + ETH_GAS_RESERVE > eth) {
          throw new Error(`Not enough ETH: the first buy and gas need more than the ${formatAmount(eth, 18)} ETH this wallet holds on ${BASE.name}.`);
        }
      } else {
        if (ETH_GAS_RESERVE > eth) throw new Error(`Not enough ETH for gas: this wallet holds ${formatAmount(eth, 18)} ETH on ${BASE.name}.`);
        const held = await balanceOf({ kind: "erc20", address: asked.address, symbol: asked.symbol, decimals: asked.decimals }, ready!.account);
        if (raw > held) throw new Error(`Not enough ${asked.symbol}: the first buy needs ${tokenAmount(raw, asked.decimals, 8)} and this wallet holds ${tokenAmount(held, asked.decimals, 8)}.`);
      }
      const salt = newSalt();
      const v3 = check.opening ? { v3: { fee: chosen, opening: check.opening } } : {};
      setReview({ factory, salt, token: await predictToken(factory, ready!.account, salt), pair: fresh, firstBuy: raw, ...v3 });
    } catch (e) {
      setError(messageOf(e));
    }
    setBusy(false);
  };

  const onLaunch = async () => {
    const r = review!;
    const approve: Step[] =
      r.pair.address !== ETH_QUOTE && r.firstBuy > 0n
        ? [{ label: `Approve exactly ${tokenAmount(r.firstBuy, r.pair.decimals, 8)} ${r.pair.symbol} for the launchpad`, build: () => ({ to: r.pair.address, data: approveData(r.factory, r.firstBuy) }) }]
        : [];
    const receipts = await steps.run(signingProvider(), ready!.account, [
      ...approve,
      { label: `Launch ${meta.symbol.trim()} on ${BASE.name}, paired with ${r.pair.symbol}`, build: () => launchTx(r.factory, meta, r.salt, r.pair, r.firstBuy, r.v3?.fee) },
    ]);
    if (receipts !== null) {
      const launched = launchedIn(receipts.at(-1)!, r.factory);
      setDone(launched ? { launched, pair: r.pair } : "unread");
      setFresh((n) => n + 1);
    }
  };

  const feeProblem = (() => {
    if (feeToken.trim() === "") return "Enter a token address";
    try {
      assertChecksummedAddress(feeToken.trim(), "Token");
      return null;
    } catch (e) {
      return messageOf(e);
    }
  })();

  const onCollect = async (raw: string, known?: string) => {
    const token = toChecksumAddress(raw.trim());
    const finished = await collecting.run(signingProvider(), ready!.account, [
      {
        label: `Collect the fees of ${short(token)}`,
        build: async () => {
          // a pasted token is looked up on every factory; a listed one already knows its own
          const factory = known ?? (await launchOf(token))?.factory;
          if (!factory) throw new Error(`${token} was not launched on this app's launchpad.`);
          return collectTx(factory, token);
        },
      },
    ]);
    if (finished !== null) setFresh((n) => n + 1);
  };

  const field = (label: string, key: keyof Metadata, placeholder: string) => (
    <label className="group__row">
      <span>{label}</span>
      <input className="field" aria-label={label} placeholder={placeholder} value={meta[key]} onChange={(e) => set(key)(e.target.value)} />
    </label>
  );

  const ecosystemAddresses = new Set<string>(ECOSYSTEM_QUOTES.map((c) => c.address.toLowerCase()));
  const cryptoAddresses = new Set<string>(TRADE_CRYPTO.map((c) => c.address.toLowerCase()));
  const ecosystems = pairs.pairs.filter((p) => ecosystemAddresses.has(p.address.toLowerCase()));
  const cryptos = pairs.pairs.filter((p) => p.address !== ETH_QUOTE && cryptoAddresses.has(p.address.toLowerCase()));
  const stocks = closed ? [] : pairs.pairs.filter((p) => p.address !== ETH_QUOTE && !ecosystemAddresses.has(p.address.toLowerCase()) && !cryptoAddresses.has(p.address.toLowerCase()));
  const hasIdentity = meta.name.trim().length > 0 && meta.symbol.trim().length > 0 && metadataProblem(meta) === null;
  const hasPair = !("problem" in buy);
  const currentStep = review !== null ? 4 : !hasIdentity ? 1 : !hasPair ? 2 : 3;

  return (
    <div className="stack">
      {"waiting" in pinned ? (
        <Crt label="Launchpad status">
          <span className="crt__amber">{pinned.waiting}</span>
        </Crt>
      ) : null}

      <ol className="launch__steps" aria-label="Launch steps">
        <li className={currentStep === 1 ? "launch__step launch__step--active" : hasIdentity ? "launch__step launch__step--done" : "launch__step"}>
          <span>1. identity</span>
        </li>
        <li className={currentStep === 2 ? "launch__step launch__step--active" : hasPair && hasIdentity ? "launch__step launch__step--done" : "launch__step"}>
          <span>2. pair</span>
        </li>
        <li className={currentStep === 3 ? "launch__step launch__step--active" : review !== null ? "launch__step launch__step--done" : "launch__step"}>
          <span>3. options</span>
        </li>
        <li className={currentStep === 4 ? "launch__step launch__step--active" : "launch__step"}>
          <span>4. review</span>
        </li>
      </ol>

      <div className="launch__layout">
        <div className="stack launch__form">
          <fieldset className="group">
            <legend>Your coin</legend>
            {field("Name", "name", `e.g. ${hint.name}`)}
            {field("Symbol", "symbol", `e.g. ${hint.symbol}`)}
            <label className="group__row">
              <span>Description</span>
              <textarea className="field" aria-label="Description" rows={2} value={meta.description} onChange={(e) => set("description")(e.target.value)} />
            </label>
            {field("Image", "image", "https://… link to the picture (optional)")}
            {field("Website", "website", "https://… (optional)")}
            <label className="group__row">
              <span>Paired with</span>
              <select
                className="field"
                aria-label="Paired with"
                value={pair.address}
                onChange={(e) => {
                  setPairAt(e.target.value);
                  setFirstBuy("");
                  changed();
                }}
              >
                <optgroup label="Base crypto">
                  <option value={ETH_QUOTE}>ETH</option>
                  {cryptos.map((p) => (
                    <option key={p.address} value={p.address}>
                      {p.symbol} — {p.name}
                    </option>
                  ))}
                </optgroup>
                {ecosystems.length > 0 ? (
                  <optgroup label="Ecosystem (Quadra)">
                    {ecosystems.map((p) => (
                      <option key={p.address} value={p.address}>
                        {p.symbol} — {p.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {stocks.length > 0 ? (
                  <optgroup label="Coinbase stocks on Base">
                    {stocks.map((p) => (
                      <option key={p.address} value={p.address}>
                        {p.symbol} — {p.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </label>
            <label className="group__row">
              <span>First buy</span>
              <input
                className="field field--short"
                aria-label="First buy"
                inputMode="decimal"
                placeholder={pair.address === ETH_QUOTE ? "0.1 (optional)" : "1 (optional)"}
                value={firstBuy}
                onChange={(e) => {
                  setFirstBuy(e.target.value);
                  changed();
                }}
              />
              <span className="unit">{pair.symbol}</span>
            </label>
            {version === 3 ? (
              <div className="group__row" role="group" aria-label="Fee">
                <span>Fee</span>
                <span className="row">
                  {LAUNCH_FEES.map((f) => (
                    <button
                      key={f}
                      type="button"
                      className="chip chip--mode"
                      aria-pressed={fee === f}
                      onClick={() => {
                        setFee(f);
                        changed();
                      }}
                    >
                      {feePercent(f)}
                    </button>
                  ))}
                </span>
                <span className="unit">a trade</span>
              </div>
            ) : null}
            {closed ? (
              <p className="crt__amber">{RESTRICTED_TEXT} ETH pairs work as usual.</p>
            ) : pairs.problem ? (
              <p className="dim">Stock pairs are not listed right now: {pairs.problem}</p>
            ) : pairs.pairs.length > 0 && stocks.length === 0 ? (
              <p className="dim">No stock is enabled on the launchpad yet — its quote admin turns each one on (setQuote). ETH works now.</p>
            ) : null}
            {cryptos.length === 0 && ecosystems.length === 0 ? (
              <p className="dim">Base crypto &amp; ecosystem pairs (USDC, cbBTC, AERO, QUADRA) and more stocks appear here once enabled on the factory via setQuote.</p>
            ) : null}
            <p className="dim">
              {SUPPLY_WORDS} tokens, all of it in a Uniswap v4 pool against {pair.symbol} that nobody can pull. You earn 80% of the {version === 3 ? feePercent(fee) : "1%"} fee
              on every trade. The first buy happens in the launch itself, before any bot can see the pool.
              {version === 3 ? " In the first seconds the fee starts far higher, so a sniper pays most of it." : null}
              {pair.address === ETH_QUOTE ? null : ` ${STOCK_PAIR_PRICE_NOTE}`}
            </p>
          </fieldset>

          {review === null ? (
            <Gel className="mf__cta" onClick={() => void onReview()} disabled={blocker !== null || busy}>
              {busy ? "Checking the launchpad…" : (blocker ?? "Review launch")}
            </Gel>
          ) : (
            <>
              <ReportView report={reviewReport(meta, review, ready!.account)} />
              <Gel className="mf__cta" onClick={() => void onLaunch()} disabled={steps.running || steps.states.length > 0}>
                {steps.states.length > 0 ? "Launched — edit a field to start another" : "Launch in wallet"}
              </Gel>
            </>
          )}
        </div>

        <aside className="group launch__preview" aria-label="Draft preview">
          <div className="launch__preview-head">
            <span className="badge badge--ok">draft</span>
            <strong>{meta.name.trim() || hint.name}</strong>
            <span className="mono dim">{meta.symbol.trim() || hint.symbol}</span>
          </div>
          {meta.description.trim() ? <p className="dim">{meta.description.trim()}</p> : <p className="dim">No description yet.</p>}
          <dl className="pair__facts">
            <dt>Pair</dt>
            <dd>{pair.symbol}</dd>
            <dt>Supply</dt>
            <dd>{SUPPLY_WORDS}</dd>
            <dt>Fee</dt>
            <dd>{version === 3 ? `${feePercent(fee)} (80% to you)` : "1% (80% to you)"}</dd>
            <dt>First buy</dt>
            <dd>{firstBuy.trim() ? `${firstBuy.trim()} ${pair.symbol}` : "none"}</dd>
            <dt>Liquidity</dt>
            <dd>Locked forever</dd>
          </dl>
        </aside>
      </div>

      {error ? (
        <Crt label="Launch error">
          <span className="crt__amber">{error}</span>
        </Crt>
      ) : null}
      <TxStepList states={steps.states} label="Launch progress" />
      {done === null ? null : done === "unread" ? (
        <p className="tx__warn">The launch confirmed, but its Launched event could not be read from the receipt — look the transaction up on the explorer.</p>
      ) : (
        <div className="group launch__done">
          <p className="tx__ok">
            Live:{" "}
            <a href={explorer.token(done.launched.token)} target="_blank" rel="noreferrer">
              {done.launched.token}
            </a>
            {done.launched.devBuyIn > 0n
              ? ` — your first buy: ${tokenAmount(done.launched.devBuyTokens, LAUNCHPAD_DECIMALS, 2)} for ${tokenAmount(done.launched.devBuyIn, done.pair.decimals, 8)} ${done.pair.symbol}`
              : ""}
          </p>
          <div className="row">
            {openWindow ? (
              <Gel onClick={() => openWindow("coins", { t: done.launched.token })}>
                its page here
              </Gel>
            ) : null}
            <a className="chip" href={`https://dexscreener.com/base/${done.launched.token}`} target="_blank" rel="noreferrer">
              chart
            </a>
          </div>
        </div>
      )}

      {anyFactory ? (
        <fieldset className="group">
          <legend>Your launches</legend>
          {mine === null ? (
            <p className="dim">Connect a wallet to see the coins it launched here and the fees waiting for it.</p>
          ) : mine === "reading" ? (
            <p className="dim">Reading your launches…</p>
          ) : "problem" in mine ? (
            <p className="tx__warn">Your launches could not be read: {mine.problem}</p>
          ) : mine.list.length === 0 ? (
            <p className="dim">No launches from this wallet{mine.complete ? "" : " in the launchpad's newest logs"}.</p>
          ) : (
            <ul className="notes" aria-label="Your launches">
              {mine.list.map((m) => (
                <li key={m.token}>
                  <span className="notes__row">
                    {openWindow ? (
                      <button type="button" className="chip" aria-label={`Open ${m.token}`} onClick={() => openWindow("coins", { t: m.token })}>
                        {short(m.token)}
                      </button>
                    ) : (
                      <a className="notes__id" href={explorer.token(m.token)} target="_blank" rel="noreferrer">
                        {short(m.token)}
                      </a>
                    )}
                    <button
                      type="button"
                      className="chip"
                      aria-label={`Collect ${m.token}`}
                      onClick={() => void onCollect(m.token, m.factory)}
                      disabled={!ready || collecting.running || m.fees === null || (m.fees.inQuote === 0n && m.fees.inToken === 0n)}
                    >
                      Collect
                    </button>
                  </span>
                  <span className="notes__why">
                    {m.at ? `launched ${m.at.toLocaleString()} · ` : ""}
                    {valueText(m.value)} · {feesText(m.fees, pairs.pairs)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <label className="group__row">
            <span>Another</span>
            <input className="field" aria-label="Token to collect for" placeholder="0x… a token launched here" value={feeToken} onChange={(e) => setFeeToken(e.target.value)} />
          </label>
          <Gel className="gel--quiet" onClick={() => void onCollect(feeToken)} disabled={!ready || feeProblem !== null || collecting.running}>
            {!ready ? "Connect a wallet first" : (feeProblem ?? "Collect")}
          </Gel>
          <p className="dim">Anyone may collect; the launchpad always pays 80% to the coin&apos;s creator and 20% to this app.</p>
          <TxStepList states={collecting.states} label="Collect progress" />
        </fieldset>
      ) : null}
    </div>
  );
}
