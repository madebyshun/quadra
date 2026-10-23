/**
 * What's New in this release — the Welcome screen's What's New dialog, as data. `window` is the
 * window "Show me" opens for the first item; ids are checked against the registry by the tests.
 */
export type NewItem = { readonly title: string; readonly text: string; readonly window: string | null };

export const WHATS_NEW: readonly NewItem[] = [
  { title: "Launchpad", text: "launch a coin on Base paired with ETH or a Coinbase stock", window: "launch" },
  { title: "Coins", text: "every coin launched here has its page, with a price chart from its launch price", window: "coins" },
  { title: "Trading on its own pool", text: "buy or sell a coin straight against its own Uniswap v4 pool", window: "coins" },
  { title: "Task Manager", text: "Base as this computer's CPU, block by block", window: "taskmgr" },
  { title: "Trash", text: "pools emptied in the last three hours", window: "trash" },
  { title: "Rugsweeper", text: "minesweeper, where the mines are real red-flagged launches", window: "rugsweeper" },
  { title: "Achievements", text: "what you have done here, and what your wallet has done on Base", window: "achievements" },
  { title: "Leaderboard", text: "the launchpad's coins and creators", window: "leaderboard" },
  { title: "Q", text: "a little assistant that speaks up only when something real happens", window: null },
  { title: "Base card", text: "your X profile as a Mac-style paint card to share", window: "card" },
];
