# RevenueShare — integration note for Blue Agent

Status 2026-10-28: **built and tested in Quadra, simulated on mainnet state against the deployed v3
(ETH and NVDAc coins: every step succeeded, splits exact to the wei — contracts/README.md), NOT
deployed, NOT audited, waiting on ShunTr's approval.** Nothing below has an address yet; every `<…>` is filled in after the owner deploys.
Design, guarantees and limits: `contracts/README.md`, section "RevenueShare".

## Addresses (Base 8453)

| Contract | Address |
|---|---|
| LaunchFactoryV3 (the launchpad) | `0x006Da367654a487bb277fe25ff54f0fE0f741377` |
| RevenueShareDeployer (bound to v3) | `<not deployed>` |
| A coin's RevenueShare | `deployer.predict(token, agent, agentBps)` — known before it exists |

Never hard-code a share contract's address: predict it, or read `Created` events from the deployer.
Before showing a share contract as live, check `share.isActive()` (it is the coin's creator
recipient right now) and `share.launchpad() == 0x006D…1377`.

## The calls, in order

1. **Launch** (unchanged): `LaunchFactoryV3.launch(name, symbol, contractURI, salt, quote, quoteIn, fee, referrer)`
   with Blue Agent's approved referrer.
2. **Create the share contract** — anyone may send it (the user's wallet, or Blue Agent's relayer):
   `RevenueShareDeployer.create(token, agent, agentBps) returns (address share)`
   - `agent`: the agent's wallet; `agentBps`: its fixed share, 1–9000 (0.01%–90%).
   - No agent share: `create(token, address(0), 0)`. Every other combination reverts `BadSplit`.
   - Reverts `AlreadyCreated` if that exact (token, agent, agentBps) exists — use `predict`.
3. **Hand the launcher's share over — irreversible** — sent by the coin's CURRENT creator recipient
   (the launcher, unless they already moved it):
   `LaunchFactoryV3.setCreatorRecipient(token, share)`
   This REPLACES Blue Agent's current step 2 (`setCreatorRecipient → the agent's wallet`): the
   agent is paid through `agentBps` instead. Steps 2 and 3 can be one EIP-5792 batch
   (`wallet_sendCalls`) when the launcher's wallet sends both, since the address is predictable.
   Show, before the signature: "This cannot be undone. The launcher's fee share will go to this
   contract for good."
4. **Bring fees in** — anyone, any time: `share.harvest()` (= the launchpad's `collect(token)` +
   accounting). `share.sync()` accounts without collecting. Fees then reach stakers over 7 days.
5. **Holders stake** — `coin.approve(share, amount)` + `share.stake(amount)`, or one transaction:
   `share.stakeWithPermit(amount, deadline, v, r, s)` (EIP-2612 permit on the coin; the B20 supports it).
   `share.unstake(amount)` any time, no lock, no fee.
6. **Holders claim** — `share.claim(to) returns (uint256 paid0, uint256 paid1)`: both currencies to
   `to`. A currency `to` refuses stays credited (event `Claimed(…, paid: false)`).
   Preview: `share.claimable(staker) returns (amount0, amount1)` — exactly what a claim now pays.
7. **The agent is paid** — anyone: `share.payAgent()`.
8. **Rare**: if the launchpad could not pay the share contract (a stock policy refused it), its
   `owed(share, currency)` is non-zero; anyone calls `share.pullOwed(currency)`.

`currency0`/`currency1` are the pool's, sorted by address; ETH is `address(0)`. A stock quote has
**8 decimals** — never format it as 18.

## ABI (human-readable)

```
// RevenueShareDeployer
function launchpad() view returns (address)
function create(address token, address agent, uint16 agentBps) returns (address share)
function predict(address token, address agent, uint16 agentBps) view returns (address)
event Created(address indexed token, address indexed share, address indexed agent, uint16 agentBps)

// RevenueShare
function launchpad() view returns (address)
function token() view returns (address)
function currency0() view returns (address)
function currency1() view returns (address)
function agent() view returns (address)
function agentBps() view returns (uint16)
function STREAM() view returns (uint256)            // 604800 (7 days)
function MAX_AGENT_BPS() view returns (uint16)      // 9000
function isActive() view returns (bool)
function totalStaked() view returns (uint256)
function stakedOf(address staker) view returns (uint256)
function claimable(address staker) view returns (uint256 amount0, uint256 amount1)
function streams(uint256 i) view returns ((uint256 accounted, uint256 unreleased, uint256 perShare, uint256 agentOwed, uint64 lastUpdate, uint64 finish))
function stake(uint256 amount)
function stakeWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
function unstake(uint256 amount)
function claim(address to) returns (uint256 paid0, uint256 paid1)
function payAgent()
function harvest()
function sync()
function pullOwed(address currency)
event Staked(address indexed staker, uint256 amount)
event Unstaked(address indexed staker, uint256 amount)
event Arrived(address indexed currency, uint256 amount, uint256 toAgent)
event Claimed(address indexed staker, address indexed to, address indexed currency, uint256 amount, bool paid)
event AgentPaid(address indexed currency, uint256 amount, bool paid)
error NotLaunched() / BadSplit() / ZeroAmount() / Insufficient() / TransferFailed() / Reentrancy()
```

The full JSON ABI: `cd contracts && base-forge inspect RevenueShare abi --json`.

## Wording — for ShunTr to approve before any page shows it

This is a securities-sensitive feature. Say what it does, never what it will earn.

- Use: "Stakers of $X receive a share of the trading fees this coin's pool collects, while staked.
  Fees depend on trading and may be zero. They are paid in $X and <quote>, whose prices change.
  Not an investment product; no return is promised. Unstake at any time."
- Say plainly: holders who do NOT stake receive nothing; the hand-over in step 3 cannot be undone.
- Never: "yield", "APY/APR", "dividends", "passive income", "profit", a projected or past-period
  return, or a dollar figure for future fees.
- The agent split is shown as a fact: "<agent> receives N% of the launcher's fee share; stakers
  share the rest." The launcher's share is 80% of the pool fee; the protocol's and a referrer's
  shares are not affected.
