import { useCallback, useEffect, useState } from "react";
import { useRunCommand } from "@/features/openWindow";
import { say } from "@/lib/assistant";
import { count } from "@/lib/achievements";
import { messageOf } from "@/lib/errors";
import { buildBoard, reveal, START, toggleFlag, type Board, type Play } from "@/lib/rugsweeper";
import { play as sound } from "@/lib/sound";
import { minefield } from "@/skills/activity";
import { Gel } from "@/ui/Gel";

/**
 * Rugsweeper — Minesweeper on the newest launches on Base. Each square is a real launch from the last
 * half hour; the mines are the ones Launch Radar's quick checks flag red. Clear the board and you have
 * read the radar; hit a mine and you meet the token you should not have bought.
 */

export const SIZE = 8;

type Load = { readonly kind: "reading" } | { readonly kind: "ok"; readonly board: Board } | { readonly kind: "failed"; readonly why: string };

const NEAR_INK = ["", "#1a4fd8", "#1e7d32", "#b3261e", "#3b1d8f", "#7a1f1f", "#00838f", "#000", "#555"];

export function RugsweeperPanel() {
  const [load, setLoad] = useState<Load>({ kind: "reading" });
  const [game, setGame] = useState<Play>(START);
  const [flagging, setFlagging] = useState(false);
  const run = useRunCommand();

  const deal = useCallback(() => {
    setLoad({ kind: "reading" });
    setGame(START);
    minefield(SIZE * SIZE).then(
      (launches) => {
        setLoad({ kind: "ok", board: buildBoard(launches, SIZE) });
        count("sweeps");
      },
      (e) => setLoad({ kind: "failed", why: messageOf(e) }),
    );
  }, []);
  useEffect(deal, [deal]);

  if (load.kind === "reading") return <p className="dim">Laying out the last half hour of launches…</p>;
  if (load.kind === "failed") {
    return (
      <div className="stack">
        <p className="caution">No board — the launches could not be read: {load.why}</p>
        <div className="row">
          <Gel quiet onClick={deal}>
            Try again
          </Gel>
        </div>
      </div>
    );
  }
  const { board } = load;
  const act = (i: number, flag: boolean) => {
    const next = flag ? toggleFlag(game, i) : reveal(board, game, i);
    if (next === game) return;
    setGame(next);
    if (next.state === "lost") sound("boom");
    else if (next.state === "won") {
      sound("ok");
      count("sweepWins");
      say({ id: "sweep-won", tone: "ok", text: `Board cleared — ${board.mines} red-flagged launches avoided. That is the radar, read square by square.` });
    } else if (!flag) sound("click");
  };
  const face = game.state === "lost" ? "😵" : game.state === "won" ? "😎" : "🙂";
  const minesLeft = board.mines - game.flags.size;
  const ended = game.state !== "playing";
  return (
    <div className="stack">
      <div className="sweep__bar">
        <span className="mono sweep__lcd" aria-label="Mines not flagged">
          {String(Math.max(0, minesLeft)).padStart(3, "0")}
        </span>
        <button type="button" className="sweep__face" onClick={deal} aria-label="New board">
          {face}
        </button>
        <button type="button" className={`chip ${flagging ? "chip--active" : ""}`} aria-pressed={flagging} onClick={() => setFlagging((f) => !f)}>
          🚩 Flag mode
        </button>
      </div>
      <div className="sweep" role="grid" aria-label={`Rugsweeper, ${board.mines} mines`} style={{ gridTemplateColumns: `repeat(${board.size}, 1fr)` }}>
        {board.cells.map((c) => {
          const open = game.open.has(c.index) || (ended && c.mine);
          const flagged = game.flags.has(c.index) && !open;
          const label = open ? (c.mine ? `mine: ${c.symbol}` : c.near ? `${c.near} near` : "clear") : flagged ? "flagged" : "closed";
          return (
            <button
              key={c.index}
              type="button"
              role="gridcell"
              aria-label={label}
              title={open && c.token ? c.symbol : undefined}
              className={`sweep__cell ${open ? "sweep__cell--open" : ""} ${open && c.mine ? "sweep__cell--mine" : ""} ${game.hit === c.index ? "sweep__cell--hit" : ""}`}
              onClick={() => act(c.index, flagging)}
              onContextMenu={(e) => {
                e.preventDefault();
                act(c.index, true);
              }}
            >
              {open ? (c.mine ? "💣" : c.near ? <span style={{ color: NEAR_INK[c.near] }}>{c.near}</span> : "") : flagged ? "🚩" : ""}
            </button>
          );
        })}
      </div>
      {game.state === "won" && <p role="status">You cleared it. Every square you opened is a launch the radar found no red flag on — which is not the same as safe.</p>}
      {game.state === "lost" && <p role="status">Boom. That square was a launch the radar flags red.</p>}
      {ended && board.mines > 0 && (
        <ul className="sweep__mines" aria-label="The mines">
          {board.cells
            .filter((c) => c.mine)
            .map((c) => (
              <li key={c.index}>
                <span className="mono">{c.symbol}</span> — {c.why}{" "}
                {run && (
                  <button type="button" className="report__go" aria-label={`verdict ${c.token}`} onClick={() => run(`verdict ${c.token}`)}>
                    ↗
                  </button>
                )}
              </li>
            ))}
        </ul>
      )}
      <p className="dim">
        {board.mines} mines among the {board.cells.filter((c) => c.token).length} newest launches on Base (last half hour). A mine is a launch Launch Radar's quick checks flag red. Right-click
        or Flag mode to flag. Read from Base, DexScreener and Blockscout.
      </p>
    </div>
  );
}
