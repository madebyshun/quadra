import { useEffect, useState } from "react";
import { counts, onCounts, type Counts } from "@/lib/achievements";
import { launchesBy, pendingFees } from "@/skills/launchpad";
import { nameOf } from "@/skills/names";
import { lureOf, transfersOf } from "@/skills/profile";
import { useWalletSession } from "@/ui/WalletProvider";

/**
 * Achievements. Two kinds, kept apart because their evidence is different: what this browser did
 * here (counted locally — the chain cannot know you ran a verdict), and what a WALLET did on Base
 * (read from the chain for the connected wallet). A wallet achievement that could not be read is
 * "not checked", never "locked": a missing answer is not a no (CLAUDE.md).
 */

export type Earned = "earned" | "locked" | "unknown";
export type Achievement = { readonly id: string; readonly title: string; readonly how: string; readonly state: Earned; readonly progress?: string };

const ACH = (id: string, title: string, how: string, state: Earned, progress?: string): Achievement => ({ id, title, how, state, ...(progress ? { progress } : {}) });

/** The achievements this browser earned, from its counters. */
export function localAchievements(c: Counts): Achievement[] {
  return [
    ACH("look", "Looked before leaping", "Run Token Verdict once.", c.verdicts >= 1 ? "earned" : "locked"),
    ACH("skeptic", "Professional skeptic", "Run Token Verdict ten times.", c.verdicts >= 10 ? "earned" : "locked", `${Math.min(c.verdicts, 10)}/10`),
    ACH("sweeper", "Rug sweeper", "Win a game of Rugsweeper.", c.sweepWins >= 1 ? "earned" : "locked"),
    ACH("diver", "Bin diver", "Look through the Recycle Bin.", c.binVisits >= 1 ? "earned" : "locked"),
    ACH("sysadmin", "Sysadmin", "Open Task Manager and watch Base breathe.", c.taskmgr >= 1 ? "earned" : "locked"),
  ];
}

export type WalletFacts = {
  readonly launches: number | null;
  readonly stockPaired: boolean | null;
  readonly feesWaiting: boolean | null;
  readonly basename: boolean | null;
  readonly poisoned: boolean | null;
};

const ETH = "0x0000000000000000000000000000000000000000";
const settled = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

/** What the chain says about a wallet, each fact read on its own — one failing leaves the others standing. */
export async function walletFacts(address: string): Promise<WalletFacts> {
  const [made, name, moved] = await Promise.all([settled(launchesBy(address)), settled(nameOf(address)), settled(transfersOf(address))]);
  let stockPaired: boolean | null = null;
  let feesWaiting: boolean | null = null;
  if (made) {
    const pools = await Promise.all(made.launches.slice(0, 10).map((l) => settled(pendingFees(l.factory, l.token))));
    const read = pools.filter((p) => p !== null);
    stockPaired = read.some((p) => p.quote.toLowerCase() !== ETH) ? true : read.length === pools.length ? false : null;
    feesWaiting = read.some((p) => p.inQuote > 0n || p.inToken > 0n) ? true : read.length === pools.length ? false : null;
  }
  return {
    launches: made ? made.launches.length : null,
    stockPaired,
    feesWaiting,
    basename: name ? name.kind === "verified" : null,
    poisoned: moved ? moved.some((m) => lureOf(m.symbol, m.token) !== null) : null,
  };
}

const known = (v: boolean | null): Earned => (v === null ? "unknown" : v ? "earned" : "locked");

export function walletAchievements(f: WalletFacts): Achievement[] {
  return [
    ACH("hello", "Hello, world", "Launch a coin on this computer's launchpad.", f.launches === null ? "unknown" : f.launches >= 1 ? "earned" : "locked"),
    ACH("serial", "Serial launcher", "Launch five coins here.", f.launches === null ? "unknown" : f.launches >= 5 ? "earned" : "locked", f.launches === null ? undefined : `${Math.min(f.launches, 5)}/5`),
    ACH("wallst", "Wall Street", "Launch a coin paired with a stock.", known(f.stockPaired)),
    ACH("farmer", "Fee farmer", "Have trading fees waiting on a coin you launched.", known(f.feesWaiting)),
    ACH("named", "Name on the door", "Own a Basename that points back to your wallet.", known(f.basename)),
    ACH("survivor", "Survivor", "Have fake look-alike tokens sent to you — and not fall for them.", known(f.poisoned)),
  ];
}

function List({ items }: { items: readonly Achievement[] }) {
  return (
    <ul className="ach" aria-label="Achievements">
      {items.map((a) => (
        <li key={a.id} className={`ach__item ach__item--${a.state}`}>
          <span className="ach__badge" aria-hidden="true">
            {a.state === "earned" ? "★" : a.state === "unknown" ? "?" : "☆"}
          </span>
          <span>
            <strong>{a.title}</strong>
            {a.progress ? <span className="mono"> {a.progress}</span> : null}
            <br />
            <span className="dim">{a.state === "unknown" ? "Not checked — could not be read just now. " : ""}{a.how}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** `walletFacts` never rejects — each fact fails on its own, to "not checked" — so there is no failed state. */
type Chain = { readonly kind: "none" } | { readonly kind: "reading" } | { readonly kind: "ok"; readonly facts: WalletFacts };

export function AchievementsPanel() {
  const { wallet } = useWalletSession();
  const me = wallet?.kind === "ready" ? wallet.account : null;
  const [local, setLocal] = useState<Counts>(counts);
  const [chain, setChain] = useState<Chain>({ kind: "none" });
  useEffect(() => onCounts(setLocal), []);
  useEffect(() => {
    if (!me) {
      setChain({ kind: "none" });
      return;
    }
    setChain({ kind: "reading" });
    void walletFacts(me).then((facts) => setChain({ kind: "ok", facts }));
  }, [me]);

  const mine = localAchievements(local);
  const earned = mine.filter((a) => a.state === "earned").length + (chain.kind === "ok" ? walletAchievements(chain.facts).filter((a) => a.state === "earned").length : 0);
  return (
    <div className="stack">
      <p>
        <strong>{earned}</strong> earned.
      </p>
      <h3 className="ach__head">Your wallet, on Base</h3>
      {chain.kind === "none" ? (
        <p className="dim">Connect a wallet to see what it has earned on chain — nothing is signed to read it.</p>
      ) : chain.kind === "reading" ? (
        <p className="dim">Reading your wallet from Base…</p>
      ) : (
        <List items={walletAchievements(chain.facts)} />
      )}
      <h3 className="ach__head">This computer</h3>
      <List items={mine} />
      <p className="dim">Wallet achievements are read from Base, Blockscout and this computer's launchpad; the rest are counted in this browser only.</p>
    </div>
  );
}
