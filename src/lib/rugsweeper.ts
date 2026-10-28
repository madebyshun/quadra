/**
 * Rugsweeper's rules, pure: Minesweeper on a board of real launches, where the mines are the ones
 * Launch Radar flags red. No randomness — the board is the chain's, laid out newest first — so a game
 * is reproducible from its launches and testable without a clock or a dice.
 */

export type Cell = {
  readonly index: number;
  /** null: a square with no launch on it (fewer launches than squares) — always safe */
  readonly token: string | null;
  readonly symbol: string;
  readonly mine: boolean;
  readonly why: string | null;
  readonly near: number;
};

export type Board = { readonly size: number; readonly cells: readonly Cell[]; readonly mines: number };

export type Play = { readonly open: ReadonlySet<number>; readonly flags: ReadonlySet<number>; readonly state: "playing" | "won" | "lost"; readonly hit: number | null };

export function neighbours(i: number, size: number): number[] {
  const r = Math.floor(i / size);
  const c = i % size;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && rr < size && cc >= 0 && cc < size) out.push(rr * size + cc);
    }
  return out;
}

export function buildBoard(launches: readonly { token: string; symbol: string; mine: boolean; why: string | null }[], size: number): Board {
  const n = size * size;
  const base = Array.from({ length: n }, (_, i) => launches[i] ?? { token: null, symbol: "", mine: false, why: null });
  const cells = base.map((b, i) => ({ index: i, token: b.token, symbol: b.symbol, mine: b.mine, why: b.why, near: neighbours(i, size).filter((j) => base[j]!.mine).length }));
  return { size, cells, mines: cells.filter((c) => c.mine).length };
}

export const START: Play = { open: new Set(), flags: new Set(), state: "playing", hit: null };

/** Open a square: a mine ends the game; a square with no mines near it opens its neighbours too. */
export function reveal(board: Board, play: Play, i: number): Play {
  if (play.state !== "playing" || play.open.has(i) || play.flags.has(i)) return play;
  const cell = board.cells[i]!;
  if (cell.mine) return { ...play, open: new Set([...play.open, i]), state: "lost", hit: i };
  const open = new Set(play.open);
  const todo = [i];
  while (todo.length) {
    const j = todo.pop()!;
    if (open.has(j)) continue;
    open.add(j);
    if (board.cells[j]!.near === 0) for (const k of neighbours(j, board.size)) if (!open.has(k) && !board.cells[k]!.mine && !play.flags.has(k)) todo.push(k);
  }
  const won = open.size === board.cells.length - board.mines;
  return { ...play, open, state: won ? "won" : "playing" };
}

/** Put a flag on a closed square, or take it off. */
export function toggleFlag(play: Play, i: number): Play {
  if (play.state !== "playing" || play.open.has(i)) return play;
  const flags = new Set(play.flags);
  if (flags.has(i)) flags.delete(i);
  else flags.add(i);
  return { ...play, flags };
}
