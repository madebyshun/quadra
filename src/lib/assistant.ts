/**
 * Q, the machine's assistant — a little Macintosh in the corner that speaks up when there is
 * something worth saying. Every tip is triggered by something real (a verdict that came back red,
 * fees waiting in your wallet, a game won), so Q is never a nag with nothing behind it. Off is
 * remembered under `Q_KEY`; tips are a tiny pub-sub so any window can raise one.
 */

export const Q_KEY = "quadra.q.v1";

export type Tip = {
  /** the same id twice in a session is said once */
  readonly id: string;
  readonly text: string;
  /** a command in the app's own language (`features/commands.ts`), offered as a button */
  readonly action?: { readonly label: string; readonly command: string };
  readonly tone?: "bad" | "ok";
};

type Listener = (tip: Tip) => void;
const listeners = new Set<Listener>();
const said = new Set<string>();

export function onTip(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Raise a tip. Said once per id per session, and only while Q is on. */
export function say(tip: Tip): void {
  if (!qOn() || said.has(tip.id)) return;
  said.add(tip.id);
  listeners.forEach((l) => l(tip));
}

/** For tests: let every id be said again. */
export function forgetTips(): void {
  said.clear();
}

export function qOn(): boolean {
  try {
    return globalThis.localStorage?.getItem(Q_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setQOn(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(Q_KEY, on ? "on" : "off");
  } catch {
    // forgetting the choice is harmless: Q only speaks when something real happened
  }
}

/** Hello, once — the first thing Q says on a visit, with the one command worth trying first. */
export const GREETING: Tip = {
  id: "hello",
  text: "Hi, I'm Q. This computer runs on Base: every number on it is read from the chain. Want to see what launched in the last hour?",
  action: { label: "Run radar", command: "radar" },
};
