/**
 * Connecting a wallet, and never believing an answer that could be measured again.
 *
 * ── The line this module sits on ──────────────────────────────────────────────────
 * It asks; it does not hold. No key, no signature, no transaction — the same boundary
 * `lib/eip712.ts` and `lib/requirements.ts` keep, for the same reason (hard rule 5).
 * The injected wallet owns the key material; this file owns the verdicts about what it
 * said. If signing ever moves in here, that is a custody change and ShunTr's call, not
 * a refactor.
 *
 * ── Every request ends by re-measuring ───────────────────────────────────────────
 * `connectWallet` and `requestBaseChain` both finish with a `readWallet`, and an error
 * from the request they just made can only *relabel* that measurement — never replace
 * it. An error code describes the instant a request was refused; the measurement
 * describes now, and the user may have acted in between.
 *
 * `wallet_switchEthereumChain` is the case that forces this. EIP-3326 has it resolve
 * `null` on success, and `null` is also what a wallet resolves when it decided to leave
 * you where you were — so its return value carries no information whatsoever, and the
 * only way to know which chain you are on is to ask which chain you are on. The same
 * reasoning is why `watchWallet`'s handler takes no arguments; see there.
 *
 * ── Why five states, and why `ready` carries no chain ────────────────────────────
 * A `{ address, chainId } | null` would collapse four different situations into "no
 * wallet", and they need four different sentences and three different buttons: nothing
 * installed (install one), installed but not answering (unlock it), answering but not
 * connected (connect), connected to the wrong network (switch). A boolean or a null
 * makes the panel guess which one, and the guess is usually "install a wallet" said to
 * somebody who has one — the same class of lie `lib/address.ts` documents, where a
 * mistyped address is told to paste an address.
 *
 * `ready` carries the account and no chain id, which is deliberate and is the same
 * decision `PaymentRequirements` makes about `network`: a chain that has been checked
 * has nothing left to report. Holding a `ready` already means Base. `wrongChain` does
 * carry its chain id, because that one is the unverified fact the user has to see.
 *
 * ── Status: NOTHING IMPORTS THIS YET ─────────────────────────────────────────────
 * ⚠️ Measured 2026-09-28, in the bundle and not by reading `src/`: none of
 * `wallet_switchEthereumChain`, `eth_requestAccounts`, `accountsChanged` or the literal
 * `Free tools need no wallet` appears in `dist/assets/*.js` (`grep -cF` → 0 for all four,
 * while the four keccak control needles are 1 each, so the method itself works). No panel
 * reaches this file; `tests/wallet.test.ts` is its only importer. The bundle did not grow
 * by a single byte when this module landed — 229.46 kB before and after — which is the
 * measurement, not the intention.
 *
 * Worth stating because this is now the **third** module in this position, and the other
 * two are the reason the paragraph exists at all: `lib/transaction.ts` still has only its
 * own test as an importer, and `lib/eip712.ts` now ships its *domain* while its *digest*
 * never runs (see its own status block, which was stale until today). A module at 100%
 * coverage with vectors matching a deployed contract is indistinguishable from a wired-up
 * one from the inside. Re-grep for `from "@/lib/wallet"` rather than trusting this.
 *
 * Deliberate rather than abandoned: it is step 1 of T4, taken ahead of the forwarder
 * decision because connecting a wallet needs no forwarder and no owner call. The next
 * increment is the wiring — a React seam that holds a `Wallet`, the x402 panel rendering
 * these five states, and T4 step 6's relaxation of `whyNot`. Until that lands, treat the
 * 65 passing tests as saying only that the verdicts are right about a **fake** provider.
 * No real wallet has ever answered this code.
 */

import { checkAddress } from "@/lib/address";
import { BASE } from "@/config/chain";
/**
 * Imported for the product name in three sentences below, which is `tests/brand.test.ts`
 * working exactly as intended rather than a nuisance import. Those three are **prose** —
 * words a person reads and acts on — so they follow a rename. Contrast the four strings
 * that guard exempts: a `localStorage` key, a hash domain tag, a backup format marker and
 * an empty-leaf preimage, each keyed to bytes already written to a disk or a chain, which
 * a rename must *not* touch. Nothing in this file is in the second category.
 */
import { BRAND } from "@/brand";

/* ── the provider, as little of it as this file needs ──────────────────────────── */

export type Eip1193Request = {
  readonly method: string;
  readonly params?: readonly unknown[];
};

/**
 * The slice of EIP-1193 this module uses.
 *
 * `on` and `removeListener` are optional because they genuinely are: the events are a
 * SHOULD in EIP-1193, and provider wrappers (embedded webviews, some account-abstraction
 * SDKs) ship `request` alone. `watchWallet` degrades to a no-op rather than throwing —
 * a wallet that cannot announce a chain switch still works, the panel just updates when
 * something else re-reads.
 */
export type Eip1193Provider = {
  request(args: Eip1193Request): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
};

/**
 * The injected provider, or `null` if there is nothing usable at `ethereum`.
 *
 * `scope` defaults to `globalThis`, which in a browser *is* `window` — the same object
 * a wallet extension writes to, and the one `vi.stubGlobal("ethereum", …)` reaches. It
 * is a parameter only so a test can hand in a bare object and assert the shape checks
 * below rather than fighting a global.
 *
 * A truthy `ethereum` without a callable `request` returns `null`, not a distinct state.
 * There is nothing here that can tell a broken wallet apart from an unrelated global
 * that happens to share the name, and inventing a fifth sentence for a situation we
 * cannot identify is exactly the fabrication rule 10 is about.
 *
 * ⚠️ Reads one provider and does not implement EIP-6963 multi-wallet discovery. With two
 * wallets installed, `ethereum` is whichever extension won the race to assign it, so the
 * user picks by disabling one. That is a real limitation and is written down rather than
 * papered over: a picker is a UI decision, and guessing would mean asking a wallet the
 * user did not choose to sign a payment.
 */
export function injectedProvider(scope: object = globalThis): Eip1193Provider | null {
  const candidate: unknown = (scope as { ethereum?: unknown }).ethereum;
  if (typeof candidate !== "object" || candidate === null) return null;
  if (typeof (candidate as { request?: unknown }).request !== "function") return null;
  return candidate as Eip1193Provider;
}

/* ── what can be true about the wallet ────────────────────────────────────────── */

export type Wallet =
  /** Nothing injected. Not a failure — there is simply nothing to ask. */
  | { readonly kind: "unavailable"; readonly why: string }
  /**
   * A provider is present and would not give a usable answer: the request threw, or the
   * account or chain id it returned is not something this build will act on. Kept apart
   * from `unavailable` because the fix is different (unlock/reload, not install).
   */
  | { readonly kind: "failed"; readonly why: string }
  /** Answering, with no account authorised for this origin yet. `connectWallet` fixes it. */
  | { readonly kind: "disconnected"; readonly why: string }
  /** An account, on a chain that is not Base. `requestBaseChain` asks it to move. */
  | { readonly kind: "wrongChain"; readonly why: string; readonly chainId: bigint }
  /** An account, on Base. The only state from which a payment can be signed. */
  | { readonly kind: "ready"; readonly account: string };

/** Base, as the number a chain id is compared against. See `parseChainId`. */
const BASE_CHAIN_ID = BigInt(BASE.id);

/* ── reading a chain id without trusting its spelling ─────────────────────────── */

/** EIP-695: `eth_chainId` answers hex. Any length — a non-minimal `0x02105` is still Base. */
const CHAIN_ID_HEX = /^0x[0-9a-fA-F]+$/;

/**
 * A chain id as a number, or `null` if the provider said something unreadable.
 *
 * 🔴 **The comparison downstream is numeric, and a string comparison against
 * `BASE.idHex` would pass every test in this repo while being wrong.** Base is `0x2105`
 * — four digits, no letters — so `answer === BASE.idHex` works for Base and breaks for
 * any chain whose id contains `a`–`f`, where a wallet answering `0xA4B1` and one
 * answering `0xa4b1` mean the same chain and compare unequal. The bug would arrive the
 * first time somebody reuses this for a second chain, long after the decision that
 * caused it. Parsing also absorbs a non-minimal `0x02105`, which a string compare
 * refuses as the wrong chain while the user sits on the right one.
 *
 * A decimal string is refused rather than accepted generously, because it is genuinely
 * ambiguous: `"2105"` is chain 2105 read as decimal and chain 8453 read as the hex a
 * provider forgot to prefix, and nothing here can tell which was meant. Compare
 * `errorCode`, which *does* accept a numeric string — the asymmetry is not sloppiness.
 * Strictness is priced per field: a misread error code costs a less friendly sentence,
 * a misread chain id costs a signature on a chain nobody chose.
 */
export function parseChainId(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return CHAIN_ID_HEX.test(text) ? BigInt(text) : null;
}

/* ── the sentences, written for whoever has to act on them ────────────────────── */

const SHOWN_MAX = 40;

/**
 * Format something a provider returned, for a sentence a user reads.
 *
 * Quoted when it is a string so an empty answer is visible as `""` rather than as a gap
 * in the middle of a sentence, and length-capped because this lands in the DOM.
 */
function shown(value: unknown): string {
  const text = typeof value === "string" ? `"${value}"` : String(value);
  return text.length > SHOWN_MAX ? `${text.slice(0, SHOWN_MAX)}…` : text;
}

/** The wallet's own message, in parentheses, when there is one worth repeating. */
function detail(err: unknown): string {
  return err instanceof Error && err.message !== "" ? ` (${err.message})` : "";
}

/*
 * Nothing injected is NOT the same as "you cannot sign in", and this string used
 * to say it was — "there is nothing to ask", full stop. WalletConnect and
 * Coinbase Smart Wallet both open a session with no extension present, so the
 * accurate sentence names them first and leaves installing as the alternative.
 * A true-but-discouraging line on the one screen a first-time visitor reads is
 * indistinguishable from a sign-in that does not work.
 */
const NO_WALLET_HERE =
  "No browser wallet is injected here, so there is nothing on this device to ask. You can " +
  "still sign in: WalletConnect pairs a wallet on your phone, and Coinbase Smart Wallet needs " +
  "no extension at all. Install a browser wallet and reload if you would rather use one, or " +
  `open ${BRAND.name} inside a wallet's own browser. Free tools need no wallet.`;

const NOT_CONNECTED =
  "No account is connected yet. Connect one to pay for a run — the free tools need no " +
  "wallet at all, and nothing is charged until you sign.";

const DECLINED =
  "You declined the connection request, so no account is connected. Nothing was signed " +
  "and nothing was charged.";

const ALREADY_ASKING =
  "Your wallet already has a request open. Switch to its window and answer it — asking " +
  "again only queues another one behind the first.";

const unansweredAccounts = (err: unknown): string =>
  `Your wallet is installed but did not answer when asked which accounts it has${detail(err)}. ` +
  "Unlock it and try again; nothing will be signed until it answers.";

const unansweredChain = (err: unknown): string =>
  `Your wallet did not answer when asked which chain it is on${detail(err)}. Until it does, ` +
  "nothing can be signed — a payment is only valid on one chain.";

/**
 * An unreadable chain id is **not** the wrong chain, and saying so is the point.
 *
 * Collapsing the two tells somebody already on Base to switch to Base, which is the one
 * instruction they cannot follow. What is true here is narrower and more useful: nothing
 * is known about the chain, so nothing will be signed.
 */
const unreadableChain = (raw: unknown): string =>
  `Your wallet answered ${shown(raw)} when asked for its chain id, and this build will not ` +
  "guess at that. It is not a claim that you are on the wrong network — nothing is known " +
  "about which chain you are on, which is why nothing will be signed.";

const unusableAccount = (why: string): string =>
  `Your wallet reported an account this build will not sign from. ${why}`;

const notAnAccount = (raw: unknown): string =>
  `Your wallet answered ${shown(raw)} where an account address was expected, so there is ` +
  "nothing to pay from. Reload the page; if it persists, the wallet extension is misbehaving.";

/**
 * Accurate about the mechanism, deliberately. A wallet on the wrong chain does not
 * produce a quietly-useless signature in every case — some wallets compare
 * `domain.chainId` against the selected network and refuse outright. Both outcomes are
 * covered by saying what is certain: the authorization names USDC on Base and only Base
 * can settle it. Inventing the more dramatic of the two mechanisms would be fabricating
 * a fact to make a warning sound better.
 */
const wrongChainWhy = (chainId: bigint): string =>
  `Your wallet is on chain ${chainId}. ${BRAND.name} pays USDC on ${BASE.name} (${BASE.id}), ` +
  "and the authorization names that chain and that token — so a wallet on another chain either " +
  `refuses to sign it or signs something ${BASE.name} will never accept. Switch to ` +
  `${BASE.name} before paying.`;

/**
 * 🔴 This build never calls `wallet_addEthereumChain`, and this sentence is where that
 * decision is visible to the user.
 *
 * Adding a chain is not a convenience, it is a **write into the user's wallet that
 * outlives this page**: it stores an RPC endpoint, an explorer and a currency symbol
 * under the name "Base", and every later transaction they make on Base — with any site
 * — goes through whatever we wrote. A dapp that saves one manual step by permanently
 * repointing someone's RPC is making a decision that is not its to make. So this asks,
 * and explains why it is asking.
 */
const addBaseYourself = (): string =>
  `Your wallet does not have ${BASE.name} (${BASE.id}) configured, so it has nothing to switch ` +
  `to. Add the network in the wallet itself, then come back. ${BRAND.name} deliberately does ` +
  "not add it for you: adding a chain writes an RPC endpoint into your wallet that outlives " +
  "this page and would then carry your traffic on every other site too.";

/* ── error codes ──────────────────────────────────────────────────────────────── */

/** EIP-1193: the user rejected the request. Their choice, not a malfunction. */
const USER_REJECTED = 4001;
/** MetaMask: a prompt for this permission is already open. */
const ALREADY_PENDING = -32002;
/** EIP-3326: the wallet has no such chain configured. */
const CHAIN_NOT_ADDED = 4902;
/** EIP-1193: the wallet does not support the method. */
const UNSUPPORTED_METHOD = 4200;
/** JSON-RPC: no such method. Some wallets answer an unknown method this way instead. */
const METHOD_NOT_FOUND = -32601;

/**
 * The numeric code off a provider error, or `null`.
 *
 * Accepts a numeric *string* as well as a number, and see `parseChainId` for why that is
 * consistent rather than lax: the worst outcome of misreading a code is a less specific
 * sentence, so generosity here is free, while the worst outcome of misreading a chain id
 * is a signature on the wrong chain.
 */
function errorCode(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const code: unknown = (err as { code?: unknown }).code;
  if (typeof code === "number") return code;
  if (typeof code === "string" && /^-?\d+$/.test(code)) return Number(code);
  return null;
}

function connectNote(err: unknown): string | null {
  const code = errorCode(err);
  if (code === USER_REJECTED) return DECLINED;
  if (code === ALREADY_PENDING) return ALREADY_ASKING;
  return null;
}

function switchNote(err: unknown): string | null {
  const code = errorCode(err);
  if (code === CHAIN_NOT_ADDED) return addBaseYourself();
  if (code === ALREADY_PENDING) return ALREADY_ASKING;
  return null;
}

/**
 * Replace a measured state's sentence with a more specific one, when there is one.
 *
 * Only ever the sentence. The *kind* always comes from the measurement, because the kind
 * is what the UI acts on and the error is already stale by the time this runs.
 *
 * Two states are never relabelled. `ready` means the request worked despite the error —
 * the user approved in another window, or switched by hand while the prompt was open —
 * and a measurement beats an error code. `failed` means the provider is broken *now*,
 * which is both more current and more urgent than why the last request was refused.
 */
function relabel(state: Wallet, note: string | null): Wallet {
  if (note === null || state.kind === "ready" || state.kind === "failed") return state;
  return { ...state, why: note };
}

/* ── reading the account ──────────────────────────────────────────────────────── */

type FirstAccount =
  | { readonly kind: "none" }
  | { readonly kind: "address"; readonly address: string }
  | { readonly kind: "unusable"; readonly why: string };

/**
 * The first account, checked as an address rather than trusted as a string.
 *
 * ⚠️ `eth_accounts` returns an array of whatever the provider felt like. Running it
 * through `checkAddress` costs nothing and converts a failure that would otherwise
 * surface from deep inside `encodeAuthorization` — `addressToUint` throws on a
 * contradicted EIP-55 checksum — into a state the panel can render. `unchecked` is the
 * expected verdict, because wallets hand back lowercase; that is accepted for the same
 * reason `assertChecksummedAddress` accepts it, and a *contradicted* checksum is
 * refused for the same reason too.
 *
 * An answer that is not an array at all — `null` from a locked wallet, say — reports
 * `none` rather than a malformed answer, and that is a judgement worth stating. The only
 * claim it supports is that there is no account to pay from, which is exactly what
 * `disconnected` means, and connecting is the action that fixes it either way. Calling
 * it a failure would send somebody off to unlock a wallet that is not locked.
 */
function firstAccount(accounts: unknown): FirstAccount {
  if (!Array.isArray(accounts) || accounts.length === 0) return { kind: "none" };
  const first: unknown = accounts[0];
  if (typeof first !== "string") return { kind: "unusable", why: notAnAccount(first) };
  const checked = checkAddress(first);
  if (checked.kind === "malformed" || checked.kind === "mismatch") {
    return { kind: "unusable", why: unusableAccount(checked.why) };
  }
  return { kind: "address", address: checked.address };
}

/* ── the three things a caller does ───────────────────────────────────────────── */

/**
 * What the wallet is, right now, without prompting for anything.
 *
 * Accounts first, then the chain, and the order is a decision rather than an accident.
 * The opposite order would report a wrong chain to somebody who has not connected yet,
 * which looks like the early-warning argument that put the unrecognised-payee notice on
 * screen before signing existed — and it is not the same argument. That notice is about
 * *where the money goes*, which the user needs before they can consent. This is about a
 * setting in their own wallet, which they will be asked about anyway and can only
 * sensibly change after deciding to connect at all. Asking somebody to switch networks
 * for a site they have not connected to is the confusing order, not the safe one.
 *
 * Short-circuiting at `disconnected` also means one request instead of two in the state
 * every first-time visitor is in.
 */
/** How long a silent background `readWallet` waits before concluding a hanging provider is not answering. */
export const READ_TIMEOUT_MS = 1_500;

const TIMED_OUT = Symbol("read-timeout");

function readWithTimeout(provider: Eip1193Provider, req: Eip1193Request, ms = READ_TIMEOUT_MS): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  return Promise.race([provider.request(req), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export async function readWallet(provider = injectedProvider(), timeoutMs = READ_TIMEOUT_MS): Promise<Wallet> {
  if (provider === null) return { kind: "unavailable", why: NO_WALLET_HERE };

  let accounts: unknown;
  try {
    accounts = await readWithTimeout(provider, { method: "eth_accounts" }, timeoutMs);
  } catch (err) {
    return { kind: "failed", why: unansweredAccounts(err) };
  }
  if (accounts === TIMED_OUT) return { kind: "disconnected", why: NOT_CONNECTED };

  const account = firstAccount(accounts);
  if (account.kind === "none") return { kind: "disconnected", why: NOT_CONNECTED };
  if (account.kind === "unusable") return { kind: "failed", why: account.why };

  let rawChain: unknown;
  try {
    rawChain = await readWithTimeout(provider, { method: "eth_chainId" }, timeoutMs);
  } catch (err) {
    return { kind: "failed", why: unansweredChain(err) };
  }
  if (rawChain === TIMED_OUT) return { kind: "failed", why: unansweredChain(new Error("timed out")) };

  const chainId = parseChainId(rawChain);
  if (chainId === null) return { kind: "failed", why: unreadableChain(rawChain) };
  if (chainId !== BASE_CHAIN_ID) return { kind: "wrongChain", why: wrongChainWhy(chainId), chainId };

  return { kind: "ready", account: account.address };
}

/**
 * Ask for an account, then measure what actually happened.
 *
 * The return value of `eth_requestAccounts` is deliberately ignored. It resolves with
 * the accounts it just authorised and says nothing about the chain, so acting on it
 * would produce a half-verdict — exactly the mistake `watchWallet` avoids by dropping
 * event payloads. `readWallet` is one call away and answers the whole question.
 */
export async function connectWallet(provider = injectedProvider()): Promise<Wallet> {
  if (provider === null) return { kind: "unavailable", why: NO_WALLET_HERE };
  try {
    await provider.request({ method: "eth_requestAccounts" });
  } catch (err) {
    return relabel(await readWallet(provider), connectNote(err));
  }
  return readWallet(provider);
}

/**
 * Open the wallet's own ACCOUNT PICKER, even when this site already has an account.
 *
 * MEASURED by the owner 2026-09-30: with MetaMask connected, there was no way to switch to a
 * second MetaMask account. `eth_requestAccounts` is why — once a site has permission it
 * resolves at once with the account already granted and shows nothing. EIP-2255's
 * `wallet_requestPermissions` for `eth_accounts` shows the picker every time. A wallet that
 * does not implement it (4200 / -32601) falls back to `connectWallet`, so nothing gets worse.
 * Browser extensions only: a WalletConnect or Coinbase session picks its account in its own app.
 */
export async function chooseAccount(provider = injectedProvider()): Promise<Wallet> {
  if (provider === null) return { kind: "unavailable", why: NO_WALLET_HERE };
  try {
    await provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  } catch (err) {
    const code = errorCode(err);
    if (code === UNSUPPORTED_METHOD || code === METHOD_NOT_FOUND) return connectWallet(provider);
    return relabel(await readWallet(provider), connectNote(err));
  }
  return readWallet(provider);
}

/**
 * Ask the wallet to forget this site's access (`wallet_revokePermissions`), so the next connect
 * shows the account picker instead of silently reusing the old account. Best effort: a wallet
 * without the method keeps its grant, which is why Disconnect also says to remove the site in
 * the wallet itself. Never throws.
 */
export async function releaseAccounts(provider = injectedProvider()): Promise<void> {
  try {
    await provider?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  } catch {
    // the wallet keeps its grant; the sentence Disconnect leaves already covers this
  }
}

/**
 * Ask the wallet to move to Base, then measure which chain it is on.
 *
 * "Refuse rather than prompt-and-hope" is the constraint, and this is the prompt half of
 * *prompt-and-verify*: nothing downstream trusts that the switch happened, because the
 * verdict comes from `eth_chainId` afterwards and not from this call resolving. Per
 * EIP-3326 a successful switch resolves `null`, which is also what a wallet resolves
 * when it left you where you were — so the resolution is not evidence and is discarded.
 */
export async function requestBaseChain(provider = injectedProvider()): Promise<Wallet> {
  if (provider === null) return { kind: "unavailable", why: NO_WALLET_HERE };
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE.idHex }],
    });
  } catch (err) {
    return relabel(await readWallet(provider), switchNote(err));
  }
  return readWallet(provider);
}

/* ── noticing that it moved ───────────────────────────────────────────────────── */

/**
 * Everything worth re-reading for. All four get the same handler, because the response
 * to every one of them is identical: go and look.
 */
export const WALLET_EVENTS = ["accountsChanged", "chainChanged", "connect", "disconnect"] as const;

/**
 * Call `onChange` whenever the wallet moves. Returns the unsubscribe.
 *
 * ── The handler takes no arguments on purpose ────────────────────────────────────
 * `chainChanged` hands over a chain id and `accountsChanged` hands over accounts, and
 * each is half of what a verdict needs: act on the `accountsChanged` payload and you
 * have a fresh account paired with a stale chain. Both are also only the wallet's claim
 * at the instant it fired. So an event is treated as a doorbell — something moved, go
 * and look — and the payload is dropped before anything can lean on it. The wrapper
 * below makes that structural instead of a rule the caller has to remember: `onChange`
 * cannot receive a payload even if its signature later widens.
 *
 * `accountsChanged` with `[]` is worth naming: that is a lock or a revoke, and it is a
 * `disconnected`, not an error. Nothing special is needed here because the handler
 * re-reads and `readWallet` already says so.
 *
 * 🔴 **Does not reload the page, and must not learn to.** Reloading on `chainChanged`
 * was MetaMask's own documented advice for years, and it exists for apps that cached
 * chain-dependent state at load. Nothing here caches it — every verdict in this file
 * comes from a fresh read — so a reload would buy nothing and would cost the contents
 * of the tab: an unsaved note, a quote mid-flight, a half-typed recipient. In this
 * product the notes are the money, so that is the worst trade on the board.
 *
 * Both `on` and `removeListener` are required, not just `on`. A subscription that cannot
 * be cancelled is a leak inside a React effect, and worse than a leak: the handler keeps
 * firing after the component is gone, calling `setState` on something unmounted.
 */
export function watchWallet(onChange: () => void, provider = injectedProvider()): () => void {
  const on = provider?.on;
  const off = provider?.removeListener;
  if (provider === null || typeof on !== "function" || typeof off !== "function") {
    return () => {};
  }
  /** Bound with `.call` because EventEmitter-based providers keep listeners on `this`. */
  const handler = () => onChange();
  for (const event of WALLET_EVENTS) on.call(provider, event, handler);
  return () => {
    for (const event of WALLET_EVENTS) off.call(provider, event, handler);
  };
}
