import { useCallback, useEffect, useState } from "react";
import { useRunCommand } from "@/features/openWindow";
import { messageOf } from "@/lib/errors";
import { play } from "@/lib/sound";
import { explorer, short, usd } from "@/skills/format";
import { recycleBin, type Bin } from "@/skills/rugs";
import { lureOf } from "@/skills/profile";
import { Gel } from "@/ui/Gel";
import { count } from "@/lib/achievements";

/**
 * The Trash: Uniswap v4 pools emptied on Base in the last three hours, read from the chain
 * (`skills/rugs.ts`). Each is a file you cannot restore — the joke is the format; the facts in each
 * line are exact, and each links to Token Verdict and to whoever emptied it. "Emptied" is what
 * happened, not why: a creator closing a test pool empties it too, and the window says so.
 */

type State = { readonly kind: "reading" } | { readonly kind: "ok"; readonly bin: Bin } | { readonly kind: "failed"; readonly why: string };

/**
 * The file name an emptied coin gets in the bin — ASCII only, so a look-alike symbol cannot pose as a
 * real one, and a coin calling itself ETH, WETH or USDC from the wrong contract is named FAKE-
 * (MEASURED 2026-10-14: a "USDC" at 0x1698… was in the bin).
 */
export function fileName(symbol: string, token = ""): string {
  if (token && lureOf(symbol, token)) return `FAKE-${symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 10) || "TOKEN"}`;
  const clean = symbol.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16);
  return clean || "UNNAMED";
}

export function TrashPanel() {
  const [state, setState] = useState<State>({ kind: "reading" });
  const [note, setNote] = useState<string | null>(null);
  const run = useRunCommand();
  const load = useCallback(() => {
    setState({ kind: "reading" });
    recycleBin().then(
      (bin) => setState({ kind: "ok", bin }),
      (e) => setState({ kind: "failed", why: messageOf(e) }),
    );
  }, []);
  useEffect(load, [load]);
  useEffect(() => void count("binVisits"), []);

  if (state.kind === "reading") return <p className="dim">Looking through the last three hours of Base for emptied pools…</p>;
  if (state.kind === "failed") {
    return (
      <div className="stack">
        <p className="caution">Not checked — the pools could not be read: {state.why}</p>
        <div className="row">
          <Gel quiet onClick={load}>
            Try again
          </Gel>
        </div>
      </div>
    );
  }
  const { bin } = state;
  const say = (line: string) => setNote(run ? run(line) : "Windows open from the desktop.");
  return (
    <div className="stack">
      <p>
        <strong>{bin.emptied.length}</strong> {bin.emptied.length === 1 ? "item" : "items"} — pools on Uniswap v4 that lost 90% or more of their liquidity in the last{" "}
        {bin.minutes / 60} hours ({bin.removals} pools had something taken out).
      </p>
      {bin.unread > 0 && (
        <p className="caution">
          {bin.unread} more emptied {bin.unread === 1 ? "pool" : "pools"} could not be read just now — the bin is not complete. Try again in a minute.
        </p>
      )}
      {bin.emptied.length === 0 ? (
        <p className="dim">The Trash is empty. Nobody emptied a pool lately — or nobody got caught doing it.</p>
      ) : (
        <ul className="bin" aria-label="Emptied pools">
          {bin.emptied.map((e) => (
            <li key={e.pool} className="bin__item">
              <span className="bin__file mono">{fileName(e.symbol, e.token)}</span>
              <span className="bin__why">
                Cannot restore {fileName(e.symbol, e.token)}: liquidity not found. Emptied {e.minutesAgo} min ago by{" "}
                <a href={explorer.address(e.by)} target="_blank" rel="noreferrer">
                  {short(e.by)}
                </a>
                {e.market?.volume24h ? ` · traded ${usd(e.market.volume24h)} in 24h` : ""} ·{" "}
                <a href={explorer.tx(e.tx)} target="_blank" rel="noreferrer">
                  the transaction
                </a>
              </span>
              <span className="row">
                <Gel quiet onClick={() => say(`verdict ${e.token}`)}>
                  Why?
                </Gel>
                <Gel quiet onClick={() => say(`profile ${e.by}`)}>
                  Who
                </Gel>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <Gel
          quiet
          onClick={() => {
            play("trash");
            setNote("The bin cannot be emptied any further: its owners already took everything out.");
          }}
        >
          Empty Trash
        </Gel>
        <Gel quiet onClick={load}>
          Refresh
        </Gel>
      </div>
      {note && <p role="status">{note}</p>}
      <p className="dim">
        "Emptied" is what the chain shows, not why — a creator closing a test pool empties it too. Read from Base (Uniswap v4 ModifyLiquidity logs, each pool's
        liquidity now, the emptying transaction) and DexScreener (names, volume).
      </p>
    </div>
  );
}
