import { useEffect, useState } from "react";
import { useRunCommand } from "@/features/openWindow";
import { messageOf } from "@/lib/errors";
import { marketsOf, deepest, type Market } from "@/skills/dexscreener";
import { short, usd } from "@/skills/format";
import { launchesBy, type Launch } from "@/skills/launchpad";
import { launchpadCoins, type LaunchpadIndex } from "@/adapters/http/indexer";

/**
 * The Leaderboard: this computer's launchpad, ranked. Launchers by how many coins they put out here,
 * coins by what traded in the last 24 hours. Every launch comes from the factories' own logs; volumes
 * from DexScreener, which lists a pool only after its first trade (MEASURED) — so an untraded coin
 * shows "not traded yet", never $0.
 */

export const TOP = 10;

export type Board = {
  readonly launchers: readonly { readonly address: string; readonly launches: number }[];
  readonly coins: readonly { readonly token: string; readonly symbol: string; readonly market: Market | null }[];
  readonly total: number;
  readonly complete: boolean;
};

export function rank(launches: readonly Launch[], markets: readonly Market[]): Board {
  const by = new Map<string, number>();
  for (const l of launches) by.set(l.creator, (by.get(l.creator) ?? 0) + 1);
  const launchers = [...by].map(([address, n]) => ({ address, launches: n })).sort((a, b) => b.launches - a.launches).slice(0, TOP);
  const coins = launches
    .map((l) => {
      const market = deepest(markets.filter((m) => m.base?.toLowerCase() === l.token.toLowerCase()));
      return { token: l.token, symbol: market?.symbol ?? short(l.token), market };
    })
    .sort((a, b) => (b.market?.volume24h ?? -1) - (a.market?.volume24h ?? -1))
    .slice(0, TOP);
  return { launchers, coins, total: launches.length, complete: true };
}

/**
 * The same board from this computer's own launchpad indexer (`server/indexer.ts`), which counts every
 * trade straight from the pool — including a coin DexScreener has not listed yet. Coins rank by trades
 * in 24 h (their volumes are in different quote currencies, so they cannot be summed against each other).
 */
export function rankIndexed(index: LaunchpadIndex): Board & { readonly trades: ReadonlyMap<string, string> } {
  const launchers = index.creators.slice(0, TOP).map((c) => ({ address: c.creator, launches: c.launches }));
  const sorted = [...index.coins].sort((a, b) => b.trades24h - a.trades24h || b.trades - a.trades).slice(0, TOP);
  const trades = new Map(sorted.map((c) => [c.token, c.trades24h > 0 ? `${c.trades24h} trades in 24 h` : c.trades > 0 ? `${c.trades} trades, none today` : "not traded yet"]));
  return { launchers, coins: sorted.map((c) => ({ token: c.token, symbol: c.symbol ?? short(c.token), market: null })), total: index.coins.length, complete: index.behind === 0, trades };
}

/** The board without the indexer: every launch from the factories' log index, volumes from DexScreener. */
export async function fromLogs(): Promise<Board> {
  const { launches, complete } = await launchesBy(null);
  const tokens = launches.map((l) => l.token);
  const pages: string[][] = [];
  for (let i = 0; i < tokens.length; i += 30) pages.push(tokens.slice(i, i + 30));
  const markets = (await Promise.all(pages.map((p) => marketsOf(p).catch(() => [] as Market[])))).flat();
  return { ...rank(launches, markets), complete };
}

type State =
  | { readonly kind: "reading" }
  | { readonly kind: "ok"; readonly board: Board & { readonly trades?: ReadonlyMap<string, string> }; readonly source: string }
  | { readonly kind: "failed"; readonly why: string };

const medal = (i: number) => ["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`;

export function LeaderboardPanel() {
  const [state, setState] = useState<State>({ kind: "reading" });
  const run = useRunCommand();
  useEffect(() => {
    launchpadCoins()
      .then((index) => ({ board: rankIndexed(index), source: "this computer's launchpad indexer (every trade, read from the pools)" }))
      .catch(async () => ({ board: await fromLogs(), source: "the launchpad factories' logs (Blockscout) and DexScreener's 24 h volume" }))
      .then(
        ({ board, source }) => setState({ kind: "ok", board, source }),
        (e) => setState({ kind: "failed", why: messageOf(e) }),
      );
  }, []);
  if (state.kind === "reading") return <p className="dim">Counting every launch on this computer's launchpad…</p>;
  if (state.kind === "failed") return <p className="caution">Not checked — the launches could not be read: {state.why}</p>;
  const { board } = state;
  const go = (line: string) => run?.(line);
  return (
    <div className="stack">
      <p>
        <strong>{board.total}</strong>
        {board.complete ? "" : "+"} coins launched here so far.
      </p>
      <h3 className="ach__head">Top launchers</h3>
      <ol className="lb" aria-label="Top launchers">
        {board.launchers.map((l, i) => (
          <li key={l.address}>
            <span className="lb__rank">{medal(i)}</span>
            <button type="button" className="lb__who mono" onClick={() => go(`profile ${l.address}`)}>
              {short(l.address)}
            </button>
            <span className="mono">{l.launches} {l.launches === 1 ? "launch" : "launches"}</span>
          </li>
        ))}
      </ol>
      <h3 className="ach__head">Top coins — most traded</h3>
      <ol className="lb" aria-label="Top coins">
        {board.coins.map((c, i) => (
          <li key={c.token}>
            <span className="lb__rank">{medal(i)}</span>
            <button type="button" className="lb__who mono" onClick={() => go(`coin ${c.token}`)}>
              {c.symbol}
            </button>
            <span className="mono">{board.trades?.get(c.token) ?? (c.market?.volume24h != null ? usd(c.market.volume24h) : "not traded yet")}</span>
          </li>
        ))}
      </ol>
      <p className="dim">Read from {state.source}.</p>
    </div>
  );
}
