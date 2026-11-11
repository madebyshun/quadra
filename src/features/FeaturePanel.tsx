import type { ReactNode } from "react";
import type { Feature } from "@/features/registry";
import { FEATURES, isEnabled } from "@/features/registry";
import { Crt } from "@/ui/Crt";
import { InferencePanel } from "@/features/panels/InferencePanel";
import { X402Panel } from "@/features/panels/X402Panel";
import { HooksPanel } from "@/features/panels/HooksPanel";
import { McpPanel } from "@/features/panels/McpPanel";
import { WalletPanel } from "@/features/panels/WalletPanel";
import { SkillWindow } from "@/features/panels/SkillWindow";
import { SendPanel } from "@/features/panels/SendPanel";
import { LaunchPanel } from "@/features/panels/LaunchPanel";
import { CoinsPanel } from "@/features/panels/CoinsPanel";
import { ProfilePanel } from "@/features/panels/ProfilePanel";
import { TradePanel } from "@/features/panels/TradePanel";
import { MarketsPanel } from "@/features/panels/MarketsPanel";
import { SwapPanel } from "@/features/panels/SwapPanel";
import { BridgePanel } from "@/features/panels/BridgePanel";
import { TerminalPanel } from "@/features/panels/TerminalPanel";
import { TaskManagerPanel } from "@/features/panels/TaskManagerPanel";
import { TrashPanel } from "@/features/panels/TrashPanel";
import { FolderPanel, SoonPanel } from "@/features/panels/FolderPanel";
import { ControlPanel } from "@/features/panels/ControlPanel";
import { ReadmePanel } from "@/features/panels/ReadmePanel";
import { RugsweeperPanel } from "@/features/panels/RugsweeperPanel";
import { AchievementsPanel } from "@/features/panels/AchievementsPanel";
import { LeaderboardPanel } from "@/features/panels/LeaderboardPanel";
import { CardPanel } from "@/features/panels/BaseCard";
import { radarSkill } from "@/skills/radar";
import { collateralSkill } from "@/skills/collateral";
import { depthSkill } from "@/skills/depth";
import { verdictSkill } from "@/skills/verdict";
import { gateSkill } from "@/skills/gate";
import { forensicsSkill } from "@/skills/forensics";
import { launcherSkill } from "@/skills/launcher";
import { sendCheckSkill } from "@/skills/sendcheck";
import { ExplorePanel } from "@/features/panels/ExplorePanel";

/**
 * How each window explains itself before you touch anything. Second person,
 * no jargon, and it says what the thing actually does rather than what it is. A folder, the Control
 * Panel and the Read Me have none: like the era's, they are the window and nothing else.
 */
const EXPLAIN: Partial<Record<Feature["id"], string>> = {
  wallet:
    "Connect a wallet you control. Nothing here ever holds a key: anything that moves money is signed in your own wallet. Looking things up needs no wallet at all.",
  terminal: "Type a command, get an answer read straight from Base. `help` lists every skill.",
  research:
    "See what launched on Base in the last hour, or how far a wallet's stock loans are from liquidation — read straight from the chain.",
  safety:
    "Before you buy: a real buy and sell of the token, run on Base without sending anything, plus what its owner can do, who really holds it, who launched it and how deep its market is.",
  markets:
    "Prices and charts for what you watch: tokens and Coinbase's stocks on Base. Every number says where it came from.",
  trade: "Buy or sell a token or a Coinbase stock on Base, for USDC or ETH, at a live quote signed in your wallet.",
  send: "Pay any address or Basename from your own wallet.",
  swap: "Trade any token on Base, quoted live and signed in your wallet.",
  bridge: "Move ETH or USDC from Base to Robinhood Chain, to your own address, signed in your wallet.",
  launch:
    "Put a coin out on Base, paired with ETH or a stock: a fixed supply nobody can mint, liquidity nobody can pull, and 80% of every trade's fee to you.",
  coins:
    "Every coin launched here, with its numbers. Open one for its page: its value, who launched it, the fees waiting, a buy or sell, and a full verdict.",
  profile:
    "Your wallet as you would want to read it — or anybody's: what it holds, the coins it launched here and the fees waiting, and what moved through it, with fake look-alike tokens called out.",
  taskmgr: "This computer's CPU is Base. Watch it work: every block, how full it is, what gas costs, and which launchpads are busiest right now.",
  trash: "Pools on Base that lost almost all their liquidity in the last three hours. You cannot restore them. You can find out why.",
  rugsweeper: "Minesweeper on the newest launches on Base. The mines are real: launches the radar flags red.",
  achievements: "What you have earned here — some read from your wallet on Base, some counted on this computer.",
  leaderboard: "The busiest launchers and coins on this computer's own launchpad.",
  explore: "Projects building on Base, in folders. Double-click one to see what it is and where its link goes — nothing opens until you say so.",
  card: "Your X profile painted as a card, for sharing: your picture, a title and a quote, all drawn from your handle and bio.",
  x402:
    "This app's own tools, sold per call over x402 — the way an agent pays for them. Pick one, see its price, pay in USDC from your wallet, and get the report and the receipt. The same tools are free in the windows.",
  mcp: "Plug all of this into your own AI agent. It runs on your computer, and your agent never holds your keys.",
  inference:
    "Run an AI model on a GPU that nobody can look into, not even its owner. Pick a model, ask it something, pay per question. The answer comes with a proof it ran inside the chip.",
  audit: "Point it at a GitHub repo and get a score with the reasons written out.",
  hooks:
    "A Uniswap v4 pool can carry a hook: code the pool runs around every swap. What a hook may do is written into its own address, so it can be read, not promised.",
};

/**
 * Which features are actually built. A feature absent from here renders the
 * not-built panel below, which says so outright — the alternative is a window
 * that looks finished because it has a text box in it.
 */
const BUILT: Partial<Record<Feature["id"], () => ReactNode>> = {
  wallet: () => <WalletPanel />,
  terminal: () => <TerminalPanel />,
  research: () => <SkillWindow label="Research" window="research" skills={[radarSkill, collateralSkill, depthSkill]} />,
  // ONE window to check anything (2026-10-29): a token, a recipient, a launch, a launcher
  safety: () => <SkillWindow label="Check" window="safety" skills={[verdictSkill, sendCheckSkill, forensicsSkill, launcherSkill, gateSkill]} />,
  markets: () => <MarketsPanel />,
  trade: () => <TradePanel />,
  send: () => <SendPanel />,
  swap: () => <SwapPanel />,
  bridge: () => <BridgePanel />,
  launch: () => <LaunchPanel />,
  coins: () => <CoinsPanel />,
  taskmgr: () => <TaskManagerPanel />,
  trash: () => <TrashPanel />,
  soon: () => <SoonPanel />,
  rugsweeper: () => <RugsweeperPanel />,
  achievements: () => <AchievementsPanel />,
  leaderboard: () => <LeaderboardPanel />,
  card: () => <CardPanel />,
  explore: () => <ExplorePanel />,
  profile: () => <ProfilePanel />,
  inference: () => <InferencePanel />,
  x402: () => <X402Panel />,
  hooks: () => <HooksPanel />,
  mcp: () => <McpPanel />,
  computer: () => <FolderPanel id="computer" />,
  "folder-research": () => <FolderPanel id="folder-research" />,
  "folder-money": () => <FolderPanel id="folder-money" />,
  "folder-launchpad": () => <FolderPanel id="folder-launchpad" />,
  "folder-games": () => <FolderPanel id="folder-games" />,
  "folder-agents": () => <FolderPanel id="folder-agents" />,
  control: () => <ControlPanel />,
  readme: () => <ReadmePanel />,
};

/**
 * What each switched-on-but-unbuilt window is actually waiting on.
 *
 * The notice used to read "switched on but not built yet" for every one, which is
 * true and close to useless. Each window is missing a different piece, and someone
 * looking at an amber box cannot otherwise tell a deliberate omission from a
 * dependency nobody has got to — those warrant completely different reactions.
 *
 * Deliberately no price in here. Writing what something costs into this file is the
 * stale-price bug the x402 panel is built to avoid — the failure mode of a frozen
 * price is agreeing to the wrong amount. `swap`'s entry says a live price is what it
 * is missing precisely so that nobody fills the gap with a number.
 *
 * (`audit` had an entry here until it was switched off on 2026-09-29. A reason kept
 * for a switched-off window is an excuse for nothing, and a test forbids it.)
 */
export const WAITING_ON: Readonly<Partial<Record<Feature["id"], string>>> = {};

/**
 * Switched on, and nothing behind it. The exact set of windows that render the
 * amber notice, so it is the set that has to explain itself.
 *
 * Derived from `FLAGS` and `BUILT` rather than typed out, because a hand-kept list
 * of "the unfinished ones" is wrong the day one gets finished — and wrong in the
 * flattering direction, still claiming an excuse for a window that works.
 */
export const UNBUILT: readonly Feature[] = FEATURES.filter((f) => isEnabled(f) && !BUILT[f.id]);

/**
 * The amber sentence, composed rather than written out, so that both halves are
 * reachable from a test.
 *
 * Same reason `apiLede` takes its endpoints and `assertDeployed` takes an address:
 * every switched-on-unbuilt feature names its blocker today, so a function reading
 * `WAITING_ON` directly could never reach its own no-reason branch — and that
 * branch is exactly what ships the day someone adds a feature and forgets. A test
 * asserts the omission cannot happen; this keeps the wording honest if it does.
 */
export function notBuiltNotice(title: string, waitingOn: string | undefined): string {
  const opening = `${title} is switched on but not built yet. There is nothing here to click, and nothing here will move money.`;
  return waitingOn ? `${opening} It is waiting on ${waitingOn}` : opening;
}

export function FeaturePanel({ feature }: { feature: Feature }) {
  const on = isEnabled(feature);
  const built = BUILT[feature.id];
  const lede = EXPLAIN[feature.id];

  return (
    <div className="stack">
      {lede ? <p className="panel__lede">{lede}</p> : null}

      {!on ? (
        <Crt label={`${feature.title} is off`}>
          <span className="crt__amber">
            {feature.title} is not switched on. Nothing here will move money.
          </span>
        </Crt>
      ) : built ? (
        built()
      ) : (
        <Crt label={`${feature.title} is not built yet`}>
          <span className="crt__amber">{notBuiltNotice(feature.title, WAITING_ON[feature.id])}</span>
        </Crt>
      )}
    </div>
  );
}
