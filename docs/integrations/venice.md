# integrations / venice

How an agent running on Venice (through Eliza, Coinbase AgentKit, OpenClaw or its own loop) uses Quadra's
checks before it acts on Base, and how Quadra uses Venice. Written 2026-11-26. Measured against the live
server the same day; nothing here is a partnership claim: Quadra uses Venice's API, and VVV trades on Base.

## 1 / quadra's tools, for a venice agent

Two doors, the same skills behind both (`src/skills/`, one `Report` shape).

### x402, paid per call in USDC on Base

- list, free: `GET https://quadracomputer.xyz/api/skills` returns every tool with its id, arguments, URL
  and price (`price.amount` in USDC base units, 6 decimals).
- call: `GET https://quadracomputer.xyz/api/skills/<id>?arg=<value>` (repeat `arg` for more arguments, in
  the order the list gives). Without payment it answers `402` with a base64 `PAYMENT-REQUIRED` header
  (x402 v2, scheme `exact`, network `eip155:8453`, USDC, payee the treasury `0xD5C1...3FAB`). Pay it with an
  EIP-3009 authorization in `PAYMENT-SIGNATURE` and call again; the report comes back as JSON with a
  `PAYMENT-RESPONSE` header. Only a settled payment gets a report; a skill that fails is a `422` and nothing
  is charged.
- prices on 2026-11-26 (`src/config/api.ts` `SKILL_PRICES`): verdict $0.05, gate $0.01, sendcheck $0.005,
  forensics $0.10, launcher $0.05, radar $0.02, launch $0.05, collateral $0.02, depth $0.01.
- measured: `GET /api/skills` 200; `GET /api/skills/verdict?arg=0xacfE...21bf` 402 with `PAYMENT-REQUIRED`.

Venice's own x402 client (`venice-x402-client`) signs for Venice's routes; for Quadra's routes use any x402 v2
client (Coinbase's `x402-fetch`, or AgentKit's x402 action) with the same Base wallet.

### MCP, free, read only

`tools/quadra-mcp/` is a stdio MCP server: every skill as a tool plus `quadra_status`, `quadra_list_tools`,
`quadra_quote_tool`, `quadra_amount`, `quadra_read_hook`. It holds no key and cannot sign (hard rule 5).
Run it next to the agent: `node tools/quadra-mcp/index.mjs`.

## 2 / worked example: verdict before a swap

An agent asked to "buy $50 of <token> on Base":

1. `GET /api/skills/gate?arg=<token>` ($0.01). The answer is `allow`, `caution` or `block` with reason codes
   (`row-label:block`).
2. `block`: stop and tell the user why, quoting the reason codes. `caution`: ask the user, showing the amber
   rows. A row reading "not checked" is never treated as a pass.
3. `allow`: for the full picture call `verdict` ($0.05) and show its rows; then hand the swap to the user's
   own wallet. Quadra never signs and never holds the funds.
4. Before sending to an address the user typed or pasted: `sendcheck` ($0.005) with the recipient and the
   sender, to catch a look-alike or poisoned address.

```ts
// sketch: an x402-capable fetch bound to the agent's Base wallet
const gate = await paidFetch(`https://quadracomputer.xyz/api/skills/gate?arg=${token}`).then((r) => r.json());
if (gate.rows.some((r) => r.tone === "red")) return explainRefusal(gate);
```

The agent's own explanation of a report can come from Venice: send it the report's text and nothing else
(see section 3 for the rules Quadra holds itself to).

## 3 / venice inside quadra

"Explain in plain words" under a Token Verdict or Send Check report (`src/features/panels/ExplainReport.tsx`,
`src/server/explain.ts`, route `POST /api/explain`):

- server side only; `VENICE_API_KEY` (and optionally `VENICE_MODEL`) are Vercel environment variables, never
  `VITE_`, never in a response. Missing key: the route answers a named 503 and the button says so.
- the browser sends only `{ skill, args }` for `"verdict"` or `"sendcheck"`; the server runs the skill
  itself and feeds only the resulting report text to Venice (so the route cannot be used as an open Venice
  proxy). The system prompt treats token names/symbols as untrusted data, forbids new facts, "safe", and
  advice, and keeps "not checked" rows as not checked. Before returning or caching, `filterExplanation`
  withholds any reply that calls the subject "safe" or gives buy/sell/investment advice (HTTP 502). The
  answer is labelled "Explanation by Venice (<model>), from this report only" with a link back to the rows.
- per-IP limit of 12 a minute and a 10-minute cache by skill and arguments, both in the function's memory.

Open items (review 2026-11-26):
- resolved: `/api/explain` no longer accepts raw `reportText` from the browser; it accepts only
  `{ skill, args }` (`"verdict"` or `"sendcheck"`) and rebuilds the report server-side.
- resolved: `filterExplanation` checks Venice's output before returning or caching and withholds replies
  containing unnegated `"safe"` or buy/sell/investment advice.
- the default model id and its price come from Venice's changelog as read by the builder; re-check at
  docs.venice.ai before turning the key on.

## 4 / vvv in quadra today

- VVV `0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf` (18 decimals, read on chain) is in Trade's crypto list and
  the "AI on Base" Treasury Basket preset.
- Launch pairs: VVV is offered as a pair only once the quote admin enables it on LaunchFactoryV3
  (`setQuote`, the owner's transaction, after `scripts/quote-ticks.ts` prints the tick).
- Fees a VVV-paired coin pays to the protocol arrive at the FeeRouter in VVV and are swept to the treasury by
  the keeper (`scripts/keep-backstop.ts`).

## sources

- [Venice x402 guide](https://docs.venice.ai/overview/guides/x402-venice-api)
- [Venice: VVV and DIEM](https://docs.venice.ai/overview/vvv-diem)
- [Venice wallet budget agent](https://docs.venice.ai/learn/wallet-budget-agent)
- [Base docs: Venice plugin](https://docs.base.org/agents/skills/plugins/venice)
