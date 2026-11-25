import { FLAGS } from "@/config/chain";
import { useEffect, useState } from "react";
import { LAUNCHPAD_DECIMALS } from "@/config/launchpad";
import { checkAddress, toChecksumAddress } from "@/lib/address";
import { parseAmount } from "@/lib/amount";
import { allowance, approveData } from "@/lib/erc20";
import { messageOf } from "@/lib/errors";
import {
  claimData,
  createData,
  deployer,
  hasCode,
  MAX_AGENT_BPS,
  predictShare,
  setRecipientData,
  shareOf,
  stakeData,
  stakerOf,
  unstakeData,
  type Share,
} from "@/lib/revenueShare";
import { minOutFor, NATIVE, poolKeyOf, quoteV4, zeroForOneFor, type LaunchPool } from "@/lib/v4swap";
import { buyAndBurnData, furnaceOf, harvestData, type Furnace } from "@/lib/furnace";
import { chainToken } from "@/skills/chaintoken";
import { short, tokenAmount } from "@/skills/format";
import type { LaunchRecord } from "@/skills/launchpad";
import { Gel } from "@/ui/Gel";
import { useWalletSession } from "@/ui/WalletProvider";
import { TxStepList, useTxSteps } from "@/features/panels/TxSteps";

/**
 * Where a coin's 80% goes (2026-10-29), on its page:
 *   • a coin whose recipient IS a RevenueShare: stake the coin, see and claim your part;
 *   • the current recipient's own wallet: send the 80% to another wallet (an agent's), or — once the
 *     deployer exists — hand it for good to a RevenueShare that streams it to stakers.
 * Everyone else sees one line: who receives the 80% now. Every action is one or two signatures in the
 * visitor's own wallet; approvals are exact.
 */

type Currency = { readonly symbol: string; readonly decimals: number };
type View = { readonly share: Share | null; readonly furnace: Furnace | null; readonly pool: LaunchPool | null; readonly currencies: readonly [Currency, Currency] };

async function currencyOf(address: string, coin: string, coinSymbol: string): Promise<Currency> {
  if (address.toLowerCase() === NATIVE) return { symbol: "ETH", decimals: 18 };
  if (address.toLowerCase() === coin.toLowerCase()) return { symbol: coinSymbol, decimals: LAUNCHPAD_DECIMALS };
  const t = await chainToken(address);
  return { symbol: t.symbol, decimals: t.decimals };
}

export function CoinRewards({ token, symbol, record }: { token: string; symbol: string; record: LaunchRecord }) {
  const { wallet, signingProvider } = useWalletSession();
  const me = wallet?.kind === "ready" ? wallet.account : null;
  const [view, setView] = useState<View | "reading" | { readonly problem: string }>("reading");
  const [fresh, setFresh] = useState(0);

  useEffect(() => {
    let live = true;
    setView("reading");
    (async () => {
      const [share, pool] = await Promise.all([shareOf(record, token), poolKeyOf(token)]);
      // a furnace is asked only when the recipient is not a share: the two shapes are told apart by `burnBps`
      const furnace = share ? null : await furnaceOf(record, token);
      const keys = pool ? [pool.key.currency0, pool.key.currency1] : [NATIVE, token];
      const currencies = (await Promise.all(keys.map((k) => currencyOf(k, token, symbol)))) as unknown as readonly [Currency, Currency];
      return { share, furnace, pool, currencies };
    })().then(
      (v) => live && setView(v),
      (e: unknown) => live && setView({ problem: messageOf(e) }),
    );
    return () => {
      live = false;
    };
  }, [record, token, symbol, fresh]);

  if (view === "reading") return <p className="dim">Reading where {symbol}&apos;s fees go…</p>;
  if ("problem" in view) return <p className="tx__warn">Where the fees go was not checked — {view.problem}</p>;
  const mine = me !== null && me.toLowerCase() === record.creatorRecipient.toLowerCase();
  return (
    <fieldset className="group">
      <legend>{view.share ? `Stake ${symbol}, earn its fees` : view.furnace ? `${symbol}'s furnace` : "Where the 80% goes"}</legend>
      {view.furnace ? (
        <FurnaceBlock symbol={symbol} furnace={view.furnace} pool={view.pool} currencies={view.currencies} onDone={() => setFresh((n) => n + 1)} />
      ) : view.share ? (
        <Staking token={token} symbol={symbol} share={view.share} currencies={view.currencies} onDone={() => setFresh((n) => n + 1)} />
      ) : (
        <p>
          The creator&apos;s 80% of every trade goes to <span className="mono">{short(record.creatorRecipient)}</span>
          {mine ? " — your wallet." : "."}
        </p>
      )}
      {mine && !view.share && !view.furnace && me ? <Redirect token={token} record={record} me={me} provider={signingProvider} onDone={() => setFresh((n) => n + 1)} /> : null}
    </fieldset>
  );
}

/** 1% under the Quoter's figure: the least a treasury buyback accepts. */
export const BUYBACK_SLIPPAGE_BPS = 100;

function FurnaceBlock({ symbol, furnace, pool, currencies, onDone }: { symbol: string; furnace: Furnace; pool: LaunchPool | null; currencies: readonly [Currency, Currency]; onDone: () => void }) {
  const { wallet, signingProvider } = useWalletSession();
  const me = wallet?.kind === "ready" ? wallet.account : null;
  const [problem, setProblem] = useState<string | null>(null);
  const steps = useTxSteps();
  const quote = pool && pool.tokenIs0 ? currencies[1] : currencies[0];
  const burnt = furnace.burnedFromFees + furnace.burnedFromBuybacks;
  const isTreasury = me !== null && me.toLowerCase() === furnace.treasury.toLowerCase();

  const run = async (label: string, data: `0x${string}`) => {
    if ((await steps.run(signingProvider(), me!, [{ label, build: () => ({ to: furnace.address, data }) }])) !== null) onDone();
  };
  const buyBack = async () => {
    setProblem(null);
    let minOut: bigint;
    try {
      // the floor is today's quote less 1%, read at the click: the treasury signs what it saw
      const q = await quoteV4(pool!.key, zeroForOneFor(pool!, "buy"), furnace.toBuy);
      minOut = minOutFor(q.amountOut, BUYBACK_SLIPPAGE_BPS);
    } catch (e) {
      return setProblem(messageOf(e));
    }
    await run(`buy back ${symbol} with ${tokenAmount(furnace.toBuy, quote.decimals, 6)} ${quote.symbol} and burn it`, buyAndBurnData(furnace.toBuy, minOut));
  };

  return (
    <div className="stack">
      <p>
        Every fee this coin earns its creator goes to the furnace <span className="mono">{short(furnace.address)}</span>: {furnace.burnBps / 100}% to burning {symbol},
        the rest to the treasury <span className="mono">{short(furnace.treasury)}</span>.
      </p>
      <dl className="token__facts" aria-label="Furnace">
        <dt>{symbol} burnt</dt>
        <dd>
          <strong>{tokenAmount(burnt, LAUNCHPAD_DECIMALS, 0)}</strong> — {tokenAmount(furnace.burnedFromFees, LAUNCHPAD_DECIMALS, 0)} from fees,{" "}
          {tokenAmount(furnace.burnedFromBuybacks, LAUNCHPAD_DECIMALS, 0)} bought back
        </dd>
        <dt>{quote.symbol} spent on buybacks</dt>
        <dd>{tokenAmount(furnace.quoteSpent, quote.decimals, 6)}</dd>
        <dt>Waiting to buy back</dt>
        <dd>
          {tokenAmount(furnace.toBuy, quote.decimals, 6)} {quote.symbol}
        </dd>
      </dl>
      <div className="row">
        <Gel quiet disabled={!me || steps.running} onClick={() => void run("harvest the pool's fees into the furnace", harvestData())}>
          {me ? "Harvest fees" : "Connect a wallet to harvest"}
        </Gel>
        {isTreasury ? (
          <Gel quiet disabled={steps.running || furnace.toBuy === 0n || pool === null} onClick={() => void buyBack()}>
            Buy back &amp; burn
          </Gel>
        ) : null}
      </div>
      {problem ? <p className="tx__warn">{problem}</p> : null}
      <TxStepList states={steps.states} label="Furnace progress" />
      <p className="dim">
        Anyone may harvest: it collects the pool&apos;s fees and splits them. Only the treasury buys back, at a floor 1% under today&apos;s quote. The furnace is not audited.
      </p>
    </div>
  );
}

function Staking({ token, symbol, share, currencies, onDone }: { token: string; symbol: string; share: Share; currencies: readonly [Currency, Currency]; onDone: () => void }) {
  const { wallet, signingProvider } = useWalletSession();
  const me = wallet?.kind === "ready" ? wallet.account : null;
  const [mine, setMine] = useState<Awaited<ReturnType<typeof stakerOf>> | null>(null);
  const [amount, setAmount] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const steps = useTxSteps();

  useEffect(() => {
    if (!me) return setMine(null);
    stakerOf(share.address, me).then(setMine, (e: unknown) => setProblem(messageOf(e)));
  }, [me, share.address]);

  const act = async (kind: "stake" | "unstake" | "claim") => {
    setProblem(null);
    let value = 0n;
    if (kind !== "claim") {
      try {
        value = parseAmount(amount, LAUNCHPAD_DECIMALS);
      } catch (e) {
        return setProblem(messageOf(e));
      }
    }
    const list = [];
    if (kind === "stake" && (await allowance(token, me!, share.address)) < value) {
      list.push({ label: `approve exactly ${amount} ${symbol} for staking`, build: () => ({ to: token, data: approveData(share.address, value) }) });
    }
    const data = kind === "stake" ? stakeData(value) : kind === "unstake" ? unstakeData(value) : claimData(me!);
    list.push({ label: kind === "claim" ? "claim your fees" : `${kind} ${amount} ${symbol}`, build: () => ({ to: share.address, data }) });
    if ((await steps.run(signingProvider(), me!, list)) !== null) {
      setAmount("");
      onDone();
    }
  };

  const claim = mine ? `${tokenAmount(mine.claimable[0], currencies[0].decimals, 6)} ${currencies[0].symbol} + ${tokenAmount(mine.claimable[1], currencies[1].decimals, 6)} ${currencies[1].symbol}` : null;
  return (
    <div className="stack">
      <p>
        Fees reach stakers through <span className="mono">{short(share.address)}</span>, released gradually: each arrival is spread, with whatever is still unreleased, over the next seven days.{" "}
        {tokenAmount(share.totalStaked, LAUNCHPAD_DECIMALS, 2)} {symbol} staked in all.
        {share.agent ? ` ${share.agentBps / 100}% goes to ${short(share.agent)} first.` : ""}
      </p>
      {!me ? (
        <p className="dim">Connect a wallet to stake.</p>
      ) : mine ? (
        <>
          <p>
            You staked <strong>{tokenAmount(mine.staked, LAUNCHPAD_DECIMALS, 2)} {symbol}</strong>; claimable now: <strong>{claim}</strong>.
          </p>
          <label className="field-label">
            Amount ({symbol})
            <input className="field" inputMode="decimal" aria-label={`Amount of ${symbol} to stake or unstake`} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <div className="row">
            <Gel quiet disabled={steps.running || amount.trim() === ""} onClick={() => void act("stake")}>
              Stake
            </Gel>
            <Gel quiet disabled={steps.running || amount.trim() === "" || mine.staked === 0n} onClick={() => void act("unstake")}>
              Unstake
            </Gel>
            <Gel quiet disabled={steps.running || (mine.claimable[0] === 0n && mine.claimable[1] === 0n)} onClick={() => void act("claim")}>
              Claim
            </Gel>
          </div>
        </>
      ) : (
        <p className="dim">Reading your stake…</p>
      )}
      {problem ? <p className="tx__warn">{problem}</p> : null}
      <TxStepList states={steps.states} label="Staking progress" />
      <p className="dim">The share contract is not audited. Staked coins can be unstaked at any time; fees earned while staked stay yours.</p>
    </div>
  );
}

function Redirect({ token, record, me, provider, onDone }: { token: string; record: LaunchRecord; me: string; provider: () => ReturnType<ReturnType<typeof useWalletSession>["signingProvider"]>; onDone: () => void }) {
  const [to, setTo] = useState("");
  const [agent, setAgent] = useState("");
  const [bps, setBps] = useState("0");
  const [sure, setSure] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const steps = useTxSteps();
  const at = deployer();

  const address = (raw: string, what: string): string => {
    const c = checkAddress(raw);
    if (c.kind === "malformed" || c.kind === "mismatch") throw new Error(`${what}: ${c.why}`);
    return toChecksumAddress(c.address);
  };

  const send = async () => {
    setProblem(null);
    let target: string;
    try {
      target = address(to, "New recipient");
    } catch (e) {
      return setProblem(messageOf(e));
    }
    const done = await steps.run(provider(), me, [{ label: `send the 80% to ${short(target)}`, build: () => ({ to: record.factory, data: setRecipientData(token, target) }) }]);
    if (done !== null) onDone();
  };

  const share = async () => {
    setProblem(null);
    let who: string | null = null;
    const cut = Number(bps);
    try {
      if (agent.trim() !== "") who = address(agent, "Agent");
      if (!Number.isInteger(cut) || cut < 0 || cut > MAX_AGENT_BPS) throw new Error(`The agent's share is a whole number of basis points from 0 to ${MAX_AGENT_BPS}.`);
      if (who === null && cut > 0) throw new Error("Name the agent that takes the share, or set it to 0.");
    } catch (e) {
      return setProblem(messageOf(e));
    }
    let predicted: string;
    let exists: boolean;
    try {
      predicted = await predictShare(at!, token, who, cut);
      // the same (coin, agent, cut) may already have a share — `create` would revert; use the one there
      exists = await hasCode(predicted);
    } catch (e) {
      return setProblem(messageOf(e));
    }
    const done = await steps.run(provider(), me, [
      ...(exists ? [] : [{ label: "create the share contract", build: () => ({ to: at!, data: createData(token, who, cut) }) }]),
      { label: `hand the 80% to it, for good (${short(predicted)})`, build: () => ({ to: record.factory, data: setRecipientData(token, predicted) }) },
    ]);
    if (done !== null) onDone();
  };

  return (
    <div className="stack">
      <label className="field-label">
        Send your 80% to another wallet — an agent&apos;s, a team&apos;s
        <input className="field mono" aria-label="New fee recipient" placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      <Gel quiet disabled={steps.running || to.trim() === ""} onClick={() => void send()}>
        Send the 80% there
      </Gel>
      <p className="dim">The new recipient can send it on again. Only the current recipient can change it.</p>
      {FLAGS.revenueShare ? (
        <>
      <hr />
      <p>
        <strong>Share it with holders who stake the coin.</strong> The 80% goes to a share contract that releases it to stakers gradually (each arrival spread over the next seven days), with an optional cut for an
        agent. This is for good: nothing can point the 80% anywhere else afterwards.
      </p>
      {at === null ? (
        <p className="dim">Not available yet — the share contract&apos;s deployer is not deployed. It waits on the owner deploying and verifying it.</p>
      ) : (
        <>
          <label className="field-label">
            Agent (optional)
            <input className="field mono" aria-label="Agent wallet" placeholder="0x…" value={agent} onChange={(e) => setAgent(e.target.value)} />
          </label>
          <label className="field-label">
            Agent&apos;s share (basis points, 0–{MAX_AGENT_BPS})
            <input className="field" inputMode="numeric" aria-label="Agent share in basis points" value={bps} onChange={(e) => setBps(e.target.value)} />
          </label>
          <label className="row">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I understand this cannot be undone.
          </label>
          <Gel quiet disabled={steps.running || !sure} onClick={() => void share()}>
            Share with stakers
          </Gel>
        </>
      )}
        </>
      ) : null}
      {problem ? <p className="tx__warn">{problem}</p> : null}
      <TxStepList states={steps.states} label="Fee recipient progress" />
    </div>
  );
}
