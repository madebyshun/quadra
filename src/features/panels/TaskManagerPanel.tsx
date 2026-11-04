import { useCallback, useEffect, useState } from "react";
import { messageOf } from "@/lib/errors";
import { play } from "@/lib/sound";
import { tps, type Pulse } from "@/lib/pulse";
import { launchActivity, type Activity } from "@/skills/activity";
import { usePulse } from "@/ui/usePulse";
import { count } from "@/lib/achievements";
import { Gel } from "@/ui/Gel";

/**
 * Task Manager — this computer's CPU is Base. Performance is the chain's own pulse (blocks, the
 * transactions in them, how full they are, the base fee), read every few seconds; Processes are the
 * launchpads opening pools right now, counted from the chain. "End task" is the one button here that
 * does nothing, and says why.
 */

export const PROCESS_REFRESH_MS = 60_000;

type Tab = "performance" | "processes";
type Procs = { readonly kind: "reading" } | { readonly kind: "ok"; readonly activity: Activity } | { readonly kind: "failed"; readonly why: string };

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** A strip of bars, newest on the right — the graph a 1995 Task Manager would draw. */
export function Bars({ values, label, max }: { values: readonly number[]; label: string; max: number }) {
  return (
    <div className="tm__graph" role="img" aria-label={label}>
      {values.map((v, i) => (
        <span key={i} className="tm__bar" style={{ height: `${Math.max(2, Math.min(100, (v / max) * 100))}%` }} />
      ))}
    </div>
  );
}

function Performance({ history, pulse }: { history: readonly Pulse[]; pulse: Pulse }) {
  const rate = tps(history);
  const maxTxs = Math.max(1, ...history.map((p) => p.txs));
  return (
    <div className="stack">
      <dl className="tm__stats">
        <div>
          <dt>Block</dt>
          <dd className="mono">{pulse.block.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>Transactions / s</dt>
          <dd className="mono">{rate === null ? "measuring…" : rate.toFixed(1)}</dd>
        </div>
        <div>
          <dt>In this block</dt>
          <dd className="mono">{pulse.txs} txs</dd>
        </div>
        <div>
          <dt>Base fee</dt>
          <dd className="mono">{pulse.baseFeeGwei < 0.01 ? pulse.baseFeeGwei.toFixed(4) : pulse.baseFeeGwei.toFixed(3)} gwei</dd>
        </div>
      </dl>
      <p className="tm__caption">CPU usage — how full each block is: {pct(pulse.fullness)}</p>
      <Bars values={history.map((p) => p.fullness)} max={1} label={`Block fullness, last ${history.length} blocks read`} />
      <p className="tm__caption">Transactions per block</p>
      <Bars values={history.map((p) => p.txs)} max={maxTxs} label={`Transactions per block, last ${history.length} blocks read`} />
      <p className="dim tm__source">Read from Base (eth_getBlockByNumber) every few seconds while this window is open.</p>
    </div>
  );
}

function Processes() {
  const [procs, setProcs] = useState<Procs>({ kind: "reading" });
  const [denied, setDenied] = useState<string | null>(null);
  const load = useCallback(() => {
    launchActivity().then(
      (activity) => setProcs({ kind: "ok", activity }),
      (e) => setProcs({ kind: "failed", why: messageOf(e) }),
    );
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, PROCESS_REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  if (procs.kind === "reading") return <p className="dim">Counting the launchpads running on Base…</p>;
  if (procs.kind === "failed") return <p className="caution">Not checked — the launches could not be read: {procs.why}</p>;
  const { activity } = procs;
  const top = Math.max(1, ...activity.processes.map((p) => p.launches));
  return (
    <div className="stack">
      <p className="tm__caption">
        {activity.total} pools opened on Uniswap v4 in the last {activity.minutes} min (to block {activity.latest.toLocaleString("en-US")})
      </p>
      {activity.processes.length === 0 ? (
        <p className="dim">Nothing launched in this window. Quiet.</p>
      ) : (
        <table className="tm__procs">
          <thead>
            <tr>
              <th>Launchpad</th>
              <th>Launches</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {activity.processes.map((p) => (
              <tr key={p.name} className={p.ours ? "tm__ours" : ""}>
                <td className="mono">{p.name}</td>
                <td className="mono">{p.launches}</td>
                <td>
                  <span className="tm__meter" style={{ width: `${(p.launches / top) * 100}%` }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row">
        <Gel
          quiet
          onClick={() => {
            play("error");
            setDenied("Access is denied. Base cannot be stopped from here — it does not belong to this computer, or to anybody's.");
          }}
        >
          End task
        </Gel>
      </div>
      {denied && (
        <p role="alert" className="caution">
          {denied}
        </p>
      )}
      <p className="dim tm__source">Read from Base (Uniswap v4 Initialize logs) and Blockscout (hook names). Refreshed every minute.</p>
    </div>
  );
}

export function TaskManagerPanel() {
  const state = usePulse();
  const [tab, setTab] = useState<Tab>("performance");
  useEffect(() => void count("taskmgr"), []);
  return (
    <div className="stack">
      <div className="row" role="tablist" aria-label="Task Manager">
        {(["performance", "processes"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`chip ${tab === t ? "chip--active" : ""}`} onClick={() => setTab(t)}>
            {t === "performance" ? "Performance" : "Processes"}
          </button>
        ))}
      </div>
      {tab === "processes" ? (
        <Processes />
      ) : state.kind === "waiting" ? (
        <p className="dim">Reading Base…</p>
      ) : state.pulse === null ? (
        <p className="caution">Base could not be reached: {state.kind === "stale" ? state.why : ""}</p>
      ) : (
        <>
          {state.kind === "stale" && <p className="caution">Showing the last block read — the newest could not be: {state.why}</p>}
          <Performance history={state.history} pulse={state.pulse} />
        </>
      )}
    </div>
  );
}
