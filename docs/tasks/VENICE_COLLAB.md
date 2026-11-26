# task / quadra x venice (vvv)

For: ChatGPT or Gemini, building in this repo. Read CLAUDE.md first; every hard rule there binds this task.
Written 2026-11-26. Research summary at the end, with sources. Anything marked VERIFY must be measured
(on chain, or against Venice's live docs) before it is written into code: no address, price or endpoint
from memory or from this file alone.

## why venice fits quadra

- Venice is a private, uncensored AI platform whose token VVV lives on Base
  (`0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf`, symbol VVV, 18 decimals, read back on chain 2026-11-26).
  Quadra already lists VVV in `src/config/markets.ts` (Trade, crypto tab) and Venice in Explore Base.
- Its API can be paid per call with a Base wallet over x402 (prepaid USDC balance, no account, no API key),
  the same payment rail Quadra sells its own tools on.
- Staking VVV mints DIEM, a token worth $1 of Venice inference per day. Revenue buys back and burns VVV,
  like Quadra's furnace and backstop.
- Liquidity measured 2026-11-26 (DexScreener `/token-pairs/v1`): Aerodrome VVV/WETH about $7.3M, a second
  Aerodrome pool about $2.7M, Uniswap VVV/USDC about $1.1M, Uniswap VVV/WETH about $1.0M. Price about $27.3.

Positioning stays Quadra's: an on-chain supercomputer for Base. Venice is a partner tool, not a platform we
build on (same rule as BlueAgent).

## scope, in order (one PR per part, each with tests at 100% and `npm run gate` green)

### part 1 / "explain this report", private, powered by venice

A button under every Token Verdict and Send Check report: "explain in plain words". It sends the REPORT
(rows, notes, sources, the verdict) to Venice and shows a short plain-English explanation.

- server side only: a Vercel function `api/explain` (built like the others by `npm run build:api` from
  `src/server/`). Venice key or x402 wallet is a Vercel env var, never `VITE_`, never in a response
  (hard rule 14). If the env var is missing the button says what it waits on (no invented key).
- the prompt is the report's own `reportText` and nothing typed by the user. Nothing that controls money goes
  to Venice: no amounts being sent, no recipient the user typed, no wallet history (hard rule 4's general form).
- the explanation may only restate what the report says. System prompt rules: never say "safe", never give
  investment advice, never add a fact not in the report, keep "not checked" rows as "not checked".
  A test feeds a report with an amber "not checked" row and asserts the explanation request carries it.
- label the output "explanation by Venice (<model>), from this report only" with a link to the report rows.
- rate limit per IP in the function; cache by report hash for 10 minutes.
- VERIFY: the current chat endpoint, model ids and pricing at docs.venice.ai before writing the client.

### part 2 / a venice card in Markets (read only)

A "Venice" card in the Markets window, Base first, all numbers read on chain or from DexScreener:
VVV price and 24h move (existing DexScreener reader), VVV staked share, DIEM supply against its cap, and
VVV burnt (balance of the burn address, or Venice's burn events).

- VERIFY every contract (staking / sVVV, DIEM, burn address) on Basescan and from docs.venice.ai/overview/vvv-diem
  before adding it to `src/config/`; an address that cannot be verified stays `null` and the row reads
  "not checked" (hard rules 1 and 12).
- no yield or APR figure unless it is read from Venice's own contract or API; never computed from guesses.

### part 3 / launch coins paired with VVV

Offer VVV as a pair in the Launch window, so a community can launch a coin against VVV on Quadra's launchpad.

- code: nothing new is needed in the app if the factory enables it: `launchPairs` already offers every quote
  the factory has enabled. The work is the OWNER's transaction plus a check:
  1. run `scripts/quote-ticks.ts` with VVV added (18 decimals, price from its deepest pool) to print the
     opening tick and the `setQuote` line;
  2. the quote admin (quadra-deployer) sends `setQuote(VVV, true, <tick>)` on LaunchFactoryV3. Owner signs.
  3. a test in `tests/launchpad-v3.test.tsx` that a VVV quote, once enabled, is offered with its symbol read
     from the token.
- fees of VVV-paired coins arrive at the FeeRouter in VVV and go to the treasury (FeeRouter `distribute`);
  the keeper must also call `distribute([VVV])` (scripts/keep-backstop.ts).
- simulate first: `scripts/simulate-launchpad-v3.ts` with a VVV pair and a first buy, on mainnet state.

### part 4 / an "ai on base" treasury basket preset

A preset in Treasury Basket: VVV, VIRTUAL and other AI tokens already in `TRADE_CRYPTO`, equal weight, each
leg quoted by Relay as today. Copy says it is a preset, not advice. Test: the preset fills the basket form
and every address is in `TRADE_CRYPTO`.

### part 5 / quadra tools inside venice agents (docs only, no code)

Write `docs/integrations/venice.md`: how a Venice-powered agent (Eliza, AgentKit, OpenClaw) calls Quadra's
x402 tools (`/api/skills`) and MCP server, with one worked example (verdict before a swap). This is the
collab pitch's technical half.

## out of scope / never

- no custody: Quadra never holds a Venice key in the browser, never stakes VVV for a user, never holds DIEM.
- no "partnered with Venice" wording anywhere until the owner confirms a partnership exists. Until then:
  "uses Venice's API" / "VVV on Base".
- no Venice logo beyond what base.org's ecosystem list already ships in Explore Base.
- the outreach to Venice, the announcement and any co-marketing are the owner's steps.

## acceptance

- `npm run gate` green, coverage 100%, test count re-measured in CLAUDE.md and TASKS.md.
- every money-adjacent window still has its CTA above the fold (CLAUDE.md, measure, do not eyeball).
- each part checked in a real browser against live data, with a screenshot in the PR.

## research summary (2026-11-26)

- VVV/DIEM: staking VVV mints DIEM, each DIEM is $1 of inference per day; DIEM supply is capped (reported
  38,000 rising toward 40,000). [docs.venice.ai, VVV & DIEM](https://docs.venice.ai/overview/vvv-diem),
  [Crypto Briefing](https://cryptobriefing.com/venice-diem-token-ai-inference-credits/)
- x402: Venice's paid routes accept a wallet with a prepaid USDC balance on Base or Solana; a 402 carries a
  `PAYMENT-REQUIRED` header; a TypeScript client tops up and retries.
  [x402 guide](https://docs.venice.ai/overview/guides/x402-venice-api),
  [wallet budget agent](https://docs.venice.ai/learn/wallet-budget-agent),
  [Base agent plugin](https://docs.base.org/agents/skills/plugins/venice)
- burns and emissions: revenue-funded buy and burn (a share of API credit spend and of each paid plan),
  emissions cut several times in 2026; third-party figures disagree, so read them on chain.
  [TechFlow](https://techflowpost.com/en-US/article/33877),
  [Crypto Briefing](https://cryptobriefing.com/venice-cuts-vvv-emissions-2-million/),
  [DeFiLlama](https://defillama.com/token/vvv)
- company: reported $65M Series A at a $1B valuation (July 2026); integrations with Coinbase AgentKit, Eliza,
  Virtuals; a VVV grant fund for builders on its API (May 2025) worth asking about for this collab.
  [Crypto Briefing](https://cryptobriefing.com/venice-65m-series-a-billion-valuation/),
  [Datawallet](https://www.datawallet.com/crypto/venice-ai-explained)
