import type { Eip1193Provider } from "@/lib/wallet";

/**
 * Every browser wallet that is installed, by name — EIP-6963 multi-wallet discovery.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────
 * `window.ethereum` is ONE slot, and with two wallets installed it holds whichever
 * extension won the race to write it. The user could not choose, and the Connect wallet
 * window could not even say which wallet it had connected (MEASURED 2026-09-30: the owner
 * connected, saw an address, and had to ask which wallet it was). EIP-6963 fixes both:
 * each wallet announces itself with a name, an icon and its own provider object, so the
 * app lists them and the provider a signature goes to is the one the user picked.
 *
 * The protocol is two events on `window`: the app dispatches `eip6963:requestProvider`,
 * and every wallet answers with an `eip6963:announceProvider` CustomEvent whose `detail`
 * is `{ info: { uuid, name, icon, rdns }, provider }`. Wallets that load late announce on
 * their own, so the listener stays up for the life of the page.
 *
 * ── An announcement is a claim from another extension ──────────────────────────
 * Anything can dispatch this event, so nothing in it is trusted further than it has to
 * be: the name is text rendered as text (never HTML), and the icon is only kept when it
 * is a `data:image/…` URI, as the spec requires — an `https:` icon would make every page
 * view a request to wherever the announcer chose. A name is not proof of identity either:
 * two wallets can both call themselves "MetaMask". What the user picks is a PROVIDER, and
 * the account and chain are still measured through it (`lib/wallet.ts`), never taken from
 * the announcement.
 */

export type WalletInfo = {
  /** unique per announcement session, per the spec — the key wallets are deduplicated on */
  readonly uuid: string;
  readonly name: string;
  /** a `data:image/…` URI, or `null` when the wallet sent anything else */
  readonly icon: string | null;
  /** reverse-DNS id, e.g. `io.metamask` — what a remembered choice is matched on */
  readonly rdns: string;
};

export type Discovered = { readonly info: WalletInfo; readonly provider: Eip1193Provider };

export const ANNOUNCE = "eip6963:announceProvider";
export const REQUEST = "eip6963:requestProvider";

/** Names are shown on a button; a wallet does not get to fill the window with one. */
const NAME_MAX = 32;

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** An announcement's `detail`, checked, or `null` when it is not one this app will list. */
export function parseAnnouncement(detail: unknown): Discovered | null {
  if (typeof detail !== "object" || detail === null) return null;
  const { info, provider } = detail as { info?: unknown; provider?: unknown };
  if (typeof info !== "object" || info === null) return null;
  if (typeof provider !== "object" || provider === null) return null;
  if (typeof (provider as { request?: unknown }).request !== "function") return null;
  const raw = info as Record<string, unknown>;
  const uuid = text(raw.uuid);
  const name = text(raw.name);
  const rdns = text(raw.rdns);
  if (uuid === null || name === null || rdns === null) return null;
  const icon = typeof raw.icon === "string" && DATA_IMAGE.test(raw.icon) ? raw.icon : null;
  return {
    info: { uuid, name: name.length > NAME_MAX ? `${name.slice(0, NAME_MAX)}…` : name, icon, rdns },
    provider: provider as Eip1193Provider,
  };
}

/**
 * Listen for wallets, ask them to announce, and report the list each time it changes.
 * Returns the unsubscribe. A repeated announcement with the same uuid and the same
 * provider changes nothing and is not reported.
 */
export function discoverWallets(
  onChange: (wallets: readonly Discovered[]) => void,
  target: EventTarget = globalThis as unknown as EventTarget,
): () => void {
  const found = new Map<string, Discovered>();
  const handler = (event: Event) => {
    const wallet = parseAnnouncement((event as CustomEvent<unknown>).detail);
    if (wallet === null || found.get(wallet.info.uuid)?.provider === wallet.provider) return;
    found.set(wallet.info.uuid, wallet);
    onChange([...found.values()]);
  };
  target.addEventListener(ANNOUNCE, handler);
  target.dispatchEvent(new Event(REQUEST));
  return () => target.removeEventListener(ANNOUNCE, handler);
}
