import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { collectTx } from "@/adapters/http/launchpad";
import { BASE } from "@/config/chain";
import { toChecksumAddress } from "@/lib/address";
import { accountKind, balanceOf, ETH, type AccountKind } from "@/lib/erc20";
import { messageOf } from "@/lib/errors";
import { tokenBalances, type TokenBalance } from "@/skills/blockscout";
import { LAUNCHPAD_DECIMALS } from "@/config/launchpad";
import { chainToken } from "@/skills/chaintoken";
import { ethUsd } from "@/skills/dexscreener";
import { explorer, short, tokenAmount, usd } from "@/skills/format";
import { launchesBy, pendingFees, poolValue, sharedQuoteUsd, type Launch, type PoolValue } from "@/skills/launchpad";
import { nameOf, type ReverseName } from "@/skills/names";
import { activityOf, holdingsOf, transfersOf, type ActivityItem, type Holding } from "@/skills/profile";
import { resolveTarget } from "@/skills/target";
import { Gel } from "@/ui/Gel";
import { useWalletSession } from "@/ui/WalletProvider";
import { useOpenWindow, useRunCommand } from "@/features/openWindow";
import { feesText, valueText } from "@/features/panels/BaseLaunch";
import { CardPanel } from "@/features/panels/BaseCard";
import { TxStepList, useTxSteps } from "@/features/panels/TxSteps";

/**
 * Profile / Creator Console — a wallet as a person and creator sees it.
 * Combines on-chain Holdings (Wallet assets), Coins launched, Fees, Referrals, Activity,
 * Base card, and editable local Creator Profile settings (avatar, name, links, bio).
 */

type Tab = "holdings" | "settings" | "coins" | "fees" | "referrals" | "activity" | "card";
type Read<T> = T | "reading" | { readonly problem: string };
type Mine = Launch & { readonly name: string | null; readonly value: PoolValue | null; readonly fees: Awaited<ReturnType<typeof pendingFees>> | null };

export type CreatorProfileMeta = {
  readonly name: string;
  readonly website: string;
  readonly x: string;
  readonly telegram: string;
  readonly bio: string;
  readonly avatar: string | null;
};

const EMPTY_META: CreatorProfileMeta = { name: "", website: "", x: "", telegram: "", bio: "", avatar: null };

function profileStorageKey(address: string): string {
  return `quadra.creator-profile.v1.${address.toLowerCase()}`;
}

export function loadCreatorProfile(address: string | null): CreatorProfileMeta {
  if (!address) return EMPTY_META;
  try {
    const raw = globalThis.localStorage?.getItem(profileStorageKey(address));
    if (!raw) return EMPTY_META;
    const parsed = JSON.parse(raw) as Partial<CreatorProfileMeta>;
    return {
      name: typeof parsed.name === "string" ? parsed.name.slice(0, 40) : "",
      website: typeof parsed.website === "string" ? parsed.website : "",
      x: typeof parsed.x === "string" ? parsed.x : "",
      telegram: typeof parsed.telegram === "string" ? parsed.telegram : "",
      bio: typeof parsed.bio === "string" ? parsed.bio.slice(0, 180) : "",
      avatar: typeof parsed.avatar === "string" ? parsed.avatar : null,
    };
  } catch {
    return EMPTY_META;
  }
}

export function saveCreatorProfile(address: string, meta: CreatorProfileMeta): void {
  try {
    globalThis.localStorage?.setItem(profileStorageKey(address), JSON.stringify(meta));
  } catch {
    // ignore quota or private-mode errors
  }
}

/** What an account is, in words — 7702 delegation is an ordinary wallet (MEASURED on the owner's). */
export function kindText(kind: AccountKind | null): string {
  if (kind === null) return "not read";
  return kind.kind === "wallet" ? "a wallet" : kind.kind === "delegated" ? "a wallet with a smart-account delegation (EIP-7702)" : "a contract";
}

/** A Basename only when it resolves back here (hard rule 13); a claim that does not is said in red. */
export function nameText(name: ReverseName | null): { readonly text: string; readonly bad: boolean } {
  if (name === null) return { text: "not read", bad: false };
  if (name.kind === "none") return { text: "no Basename", bad: false };
  if (name.kind === "verified") return { text: name.name, bad: false };
  return { text: `${name.name} — unverified: it points to ${name.pointsTo ?? "nothing"}`, bad: true };
}

function useRead<T>(address: string | null, read: (a: string) => Promise<T>, deps: readonly unknown[] = []): Read<T> | null {
  const [state, setState] = useState<Read<T> | null>(null);
  useEffect(() => {
    if (!address) return setState(null);
    let live = true;
    setState("reading");
    read(address).then(
      (v) => live && setState(v),
      (e: unknown) => live && setState({ problem: messageOf(e) }),
    );
    return () => {
      live = false;
    };
  }, [address, ...deps]);
  return state;
}

function say<T extends object>(state: Read<T> | null, words: (v: T) => string): string {
  const v = done(state);
  return v !== null ? words(v) : state !== null && state !== "reading" ? "not read" : "…";
}

function done<T extends object>(state: Read<T> | null): T | null {
  return state !== null && state !== "reading" && !("problem" in state) ? state : null;
}

function ReadLine<T extends object>({ state, what, children }: { state: Read<T> | null; what: string; children: (v: T) => JSX.Element }) {
  const v = done(state);
  if (v !== null) return children(v);
  if (state !== null && state !== "reading") return <p className="tx__warn">{`Could not read ${what}: ${(state as { problem: string }).problem}`}</p>;
  return <p className="dim">Reading {what}…</p>;
}

export type Coins = { readonly launches: readonly Launch[]; readonly all: ReadonlySet<string>; readonly mine: readonly Mine[]; readonly complete: boolean };

const NO_COINS: Coins = { launches: [], all: new Set(), mine: [], complete: false };

export async function readCoins(address: string): Promise<Coins> {
  const { launches, complete } = await launchesBy(null);
  const usdOf = sharedQuoteUsd();
  const own = launches.filter((l) => l.creator.toLowerCase() === address.toLowerCase());
  const mine = await Promise.all(
    own.map(async (l) => ({
      ...l,
      name: await chainToken(l.token).then((t) => `${t.name} (${t.symbol})`, () => null),
      value: await poolValue(l.factory, l.token, usdOf).catch(() => null),
      fees: await pendingFees(l.factory, l.token).catch(() => null),
    })),
  );
  return { launches, all: new Set(launches.map((l) => l.token.toLowerCase())), mine, complete };
}

type Holdings = { readonly eth: bigint; readonly ethUsd: number | null; readonly shown: Holding[]; readonly hidden: number };

export const COINS_CHECKED = 30;

export async function readHoldings(address: string, coins: Coins): Promise<Holdings> {
  const [eth, price, indexed] = await Promise.all([balanceOf(ETH, address), ethUsd(), tokenBalances(address)]);
  const usdOf = sharedQuoteUsd();
  const values = new Map<string, number | null>();
  const fromChain = (
    await Promise.all(
      coins.launches.slice(0, COINS_CHECKED).map(async (l): Promise<TokenBalance | null> => {
        const raw = await balanceOf({ kind: "erc20", address: l.token, symbol: "", decimals: LAUNCHPAD_DECIMALS }, address).catch(() => null);
        if (raw === null || raw === 0n) return null;
        const [facts, v] = await Promise.all([chainToken(l.token).catch(() => null), poolValue(l.factory, l.token, usdOf).catch(() => null)]);
        values.set(l.token.toLowerCase(), v && v.quoteUsd !== null ? (v.supplyInQuote * v.quoteUsd) / 1e9 : null);
        return { token: l.token, symbol: facts?.symbol ?? "unnamed", name: facts?.name ?? "", decimals: LAUNCHPAD_DECIMALS, raw, price: null };
      }),
    )
  ).filter((b): b is TokenBalance => b !== null);
  const balances = [...indexed.filter((b) => !coins.all.has(b.token.toLowerCase())), ...fromChain];
  return { eth, ethUsd: price, ...holdingsOf(balances, coins.all, (t) => values.get(t.toLowerCase()) ?? null) };
}

export function ProfilePanel() {
  const [params, setParams] = useSearchParams();
  const openWindow = useOpenWindow();
  const { wallet, signingProvider } = useWalletSession();
  const me = wallet?.kind === "ready" ? wallet.account : null;
  const asked = params.get("a");
  const [typed, setTyped] = useState(asked ?? "");
  const [tab, setTab] = useState<Tab>("holdings");
  const [fresh, setFresh] = useState(0);
  const [copied, setCopied] = useState<"ref" | "profile" | "addr" | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const collecting = useTxSteps();

  const target = useRead(asked ?? me, async (text) => (asked ? resolveTarget(text, "Profile") : { address: toChecksumAddress(text), via: null }), [asked]);
  const address = done(target)?.address ?? null;
  const own = address !== null && me !== null && address.toLowerCase() === me.toLowerCase();

  const [meta, setMeta] = useState<CreatorProfileMeta>(EMPTY_META);
  useEffect(() => {
    setMeta(loadCreatorProfile(address));
    setSavedNotice(false);
  }, [address]);

  const name = useRead(address, nameOf);
  const kind = useRead(address, accountKind);
  const coins = useRead(address, readCoins, [fresh]);
  const read = done(coins);
  const basis = read ?? (coins !== null && coins !== "reading" ? NO_COINS : null);
  const holdings = useRead(basis ? address : null, (a) => readHoldings(a, basis!), [basis]);
  const activity = useRead(basis ? address : null, async (a) => ({ items: activityOf(a, await transfersOf(a), basis!.mine, basis!.all) }), [basis]);

  const look = (text: string | null) => {
    const next = new URLSearchParams(params);
    if (text) next.set("a", text.trim());
    else next.delete("a");
    setParams(next, { replace: true });
  };
  const openCoin = (token: string) => openWindow?.("coins", { t: token });
  const runCommand = useRunCommand();
  const waiting = (read?.mine ?? []).filter((c) => c.fees && (c.fees.inQuote > 0n || c.fees.inToken > 0n));
  const onCollectAll = async () => {
    const steps = waiting.map((c) => ({ label: `Collect the fees of ${short(c.token)}`, build: () => collectTx(c.factory, c.token) }));
    if ((await collecting.run(signingProvider(), me!, steps)) !== null) setFresh((n) => n + 1);
  };

  const origin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "https://quadracomputer.xyz";
  const referralUrl = address ? `${origin}/?do=launch&ref=${address}` : "";
  const profileUrl = address ? `${origin}/?do=profile&a=${address}` : "";

  const copyText = (which: "ref" | "profile" | "addr", text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(which);
    setTimeout(() => setCopied((c) => (c === which ? null : c)), 1800);
  };

  const onSaveMeta = () => {
    if (!address) return;
    saveCreatorProfile(address, meta);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  const avatarInitial = (meta.name.trim()[0] ?? (address ? address.slice(2, 3) : "Q")).toUpperCase();

  const navItems: readonly { readonly id: Tab; readonly label: string }[] = [
    { id: "holdings", label: "Holdings" },
    { id: "settings", label: "Profile settings" },
    { id: "coins", label: "Coins launched" },
    { id: "fees", label: "Fees" },
    { id: "referrals", label: "Referrals" },
    { id: "activity", label: "Activity" },
    { id: "card", label: "Base card" },
  ];

  return (
    <div className="stack profile-page">
      <form
        className="group__row group__row--actions"
        onSubmit={(e) => {
          e.preventDefault();
          look(typed);
        }}
      >
        <input className="field" aria-label="Look up" placeholder="any address or Basename" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <Gel className="gel--quiet" type="submit" disabled={typed.trim() === ""}>
          Look up
        </Gel>
        {asked && me ? (
          <button type="button" className="chip" onClick={() => (setTyped(""), look(null))}>
            Mine
          </button>
        ) : null}
      </form>

      {target === null ? (
        <p className="dim">Connect a wallet to see your own profile — or look up any address. Nothing here needs a signature.</p>
      ) : target === "reading" ? (
        <p className="dim">Finding {asked}…</p>
      ) : "problem" in target ? (
        <p className="tx__warn">{target.problem}</p>
      ) : (
        <>
          <header className="profile__banner">
            <div className="profile__identity">
              <div className="profile__avatar" aria-hidden="true">
                {meta.avatar ? <img src={meta.avatar} alt="" /> : <span>{avatarInitial}</span>}
              </div>
              <div>
                <strong className="profile__title">{meta.name.trim() || "Creator console"}</strong>
                <div className="profile__addr-row">
                  <a href={explorer.address(target.address)} target="_blank" rel="noreferrer" className="mono">
                    {short(target.address)}
                  </a>
                  <button type="button" className="chip" onClick={() => copyText("addr", target.address)}>
                    {copied === "addr" ? "Copied" : "Copy"}
                  </button>
                  {own ? <span className="dim">you</span> : null}
                </div>
              </div>
            </div>
            <div className="row">
              {openWindow ? (
                <button type="button" className="chip" onClick={() => openWindow("coins")}>
                  All tokens
                </button>
              ) : null}
              <button type="button" className="chip chip--mode" aria-pressed={tab === "holdings"} onClick={() => setTab("holdings")}>
                Wallet assets
              </button>
            </div>
          </header>

          <dl className="profile__head" aria-label="Who">
            <dt>Address</dt>
            <dd>
              <a href={explorer.address(target.address)} target="_blank" rel="noreferrer">
                {target.address}
              </a>
              {own ? " — you" : ""}
            </dd>
            <dt>Basename</dt>
            <dd className={nameText(done(name)).bad ? "tx__bad" : undefined}>{say(name, (n) => nameText(n).text)}</dd>
            <dt>Account</dt>
            <dd>{say(kind, kindText)}</dd>
            <dt>Launched here</dt>
            <dd>{say(coins, (c) => `${c.mine.length} coin${c.mine.length === 1 ? "" : "s"}${c.complete ? "" : " in the launchpad's newest logs"}`)}</dd>
          </dl>

          <div className="profile__console">
            <nav className="profile__nav" role="group" aria-label="Profile">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="chip chip--mode profile__nav-btn"
                  aria-pressed={tab === item.id}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="profile__body stack">
              {tab === "settings" ? (
                <div className="profile__settings-grid">
                  <div className="stack profile__form">
                    <h3 className="profile__section-title">Profile settings</h3>
                    <div className="profile__avatar-row">
                      <div className="profile__avatar profile__avatar--lg" aria-hidden="true">
                        {meta.avatar ? <img src={meta.avatar} alt="" /> : <span>{avatarInitial}</span>}
                      </div>
                      <div className="stack">
                        <label className="chip">
                          Change avatar
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            className="sr-only"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file || file.size > 2 * 1024 * 1024) return;
                              const reader = new FileReader();
                              reader.onload = () => {
                                if (typeof reader.result === "string") setMeta((m) => ({ ...m, avatar: reader.result as string }));
                              };
                              reader.readAsDataURL(file);
                            }}
                          />
                        </label>
                        <span className="dim">PNG, JPG, WEBP, or GIF. Max 2 MB.</span>
                      </div>
                    </div>

                    <div className="profile__fields-2">
                      <label className="field-label">
                        Name ({meta.name.length}/40)
                        <input
                          className="field"
                          maxLength={40}
                          placeholder="Launch creator"
                          value={meta.name}
                          onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))}
                        />
                      </label>
                      <label className="field-label">
                        Website
                        <input
                          className="field"
                          placeholder="https://yourproject.xyz"
                          value={meta.website}
                          onChange={(e) => setMeta((m) => ({ ...m, website: e.target.value }))}
                        />
                      </label>
                      <label className="field-label">
                        X
                        <input
                          className="field"
                          placeholder="x.com/yourprofile"
                          value={meta.x}
                          onChange={(e) => setMeta((m) => ({ ...m, x: e.target.value }))}
                        />
                      </label>
                      <label className="field-label">
                        Telegram
                        <input
                          className="field"
                          placeholder="t.me/yourprofile"
                          value={meta.telegram}
                          onChange={(e) => setMeta((m) => ({ ...m, telegram: e.target.value }))}
                        />
                      </label>
                    </div>

                    <label className="field-label">
                      Bio ({meta.bio.length}/180)
                      <textarea
                        className="field"
                        rows={3}
                        maxLength={180}
                        placeholder="A short intro shown on your creator profile."
                        value={meta.bio}
                        onChange={(e) => setMeta((m) => ({ ...m, bio: e.target.value }))}
                      />
                    </label>

                    <div className="row">
                      <Gel type="button" onClick={onSaveMeta}>
                        {savedNotice ? "Saved" : "Save profile"}
                      </Gel>
                      <span className="dim">Stored locally in this browser for {short(target.address)}.</span>
                    </div>
                  </div>

                  <aside className="profile__ref-card stack" aria-label="Referral link">
                    <div className="profile__ref-orb">
                      <span>{avatarInitial}</span>
                    </div>
                    <strong>Referral link</strong>
                    <span className="dim mono">Referrer {short(target.address)}</span>
                    <div className="row">
                      <Gel type="button" onClick={() => copyText("ref", referralUrl)}>
                        {copied === "ref" ? "Copied referral" : "Referral"}
                      </Gel>
                      <Gel type="button" className="gel--quiet" onClick={() => copyText("profile", profileUrl)}>
                        {copied === "profile" ? "Copied profile" : "Profile"}
                      </Gel>
                    </div>
                    <code className="profile__ref-url">{referralUrl}</code>
                  </aside>
                </div>
              ) : tab === "holdings" ? (
                <ReadLine state={holdings} what="the holdings">
                  {(h) => (
                    <>
                      <ul className="notes" aria-label="Holdings">
                        <li>
                          <span className="notes__row">
                            <strong>{tokenAmount(h.eth, 18, 6)} ETH</strong>
                            <span className="notes__id">{h.ethUsd === null ? "price not read" : usd((Number(h.eth) / 1e18) * h.ethUsd)}</span>
                          </span>
                        </li>
                        {h.shown.map((x) => (
                          <li key={x.token}>
                            <span className="notes__row">
                              {x.coin ? (
                                <button type="button" className="chip" onClick={() => openCoin(x.token)}>
                                  {x.amount} {x.symbol}
                                </button>
                              ) : (
                                <span>
                                  <a href={explorer.token(x.token)} target="_blank" rel="noreferrer">
                                    {x.amount} {x.symbol}
                                  </a>
                                  {runCommand ? (
                                    <button type="button" className="report__go" aria-label={`verdict ${x.token}`} title="Token Verdict" onClick={() => runCommand(`verdict ${x.token}`)}>
                                      check
                                    </button>
                                  ) : null}
                                </span>
                              )}
                              <span className="notes__id">{x.usd === null ? "value not read" : usd(x.usd)}</span>
                            </span>
                            {x.coin ? <span className="notes__why">a coin launched here — valued from its own pool</span> : null}
                          </li>
                        ))}
                      </ul>
                      {h.hidden > 0 ? (
                        <p className="dim">{h.hidden} more hidden: tokens with no price or a look-alike name — mostly airdropped lures. Never approve one.</p>
                      ) : null}
                    </>
                  )}
                </ReadLine>
              ) : tab === "coins" ? (
                <ReadLine state={coins} what="the coins launched">
                  {(c) =>
                    c.mine.length === 0 ? (
                      <div className="stack">
                        <p className="dim">This address has launched no coin here.</p>
                        {openWindow ? (
                          <div>
                            <Gel type="button" onClick={() => openWindow("launch")}>
                              Launch a token
                            </Gel>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        <ul className="notes" aria-label="Coins launched">
                          {c.mine.map((m) => (
                            <li key={m.token}>
                              <span className="notes__row">
                                <button type="button" className="chip" onClick={() => openCoin(m.token)} disabled={!openWindow}>
                                  {m.name ?? short(m.token)}
                                </button>
                                <span className="notes__id">{m.value ? `vs ${m.value.quoteSymbol}` : "pair not read"}</span>
                              </span>
                              <span className="notes__why">
                                {valueText(m.value)} · {feesText(m.fees, m.value ? [{ address: m.value.quote, symbol: m.value.quoteSymbol, name: m.value.quoteSymbol, decimals: m.value.quoteDecimals, startTick: 0 }] : [])}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {own ? (
                          <>
                            <Gel className="gel--quiet" onClick={() => void onCollectAll()} disabled={waiting.length === 0 || collecting.running}>
                              {waiting.length === 0 ? "No fees waiting" : `Collect all — ${waiting.length} with fees waiting`}
                            </Gel>
                            <TxStepList states={collecting.states} label="Collect progress" />
                          </>
                        ) : null}
                      </>
                    )
                  }
                </ReadLine>
              ) : tab === "fees" ? (
                <ReadLine state={coins} what="the creator fees">
                  {(c) => (
                    <div className="stack">
                      <h3 className="profile__section-title">Creator fees (80% of every trade)</h3>
                      {c.mine.length === 0 ? (
                        <p className="dim">No launched coins found for this wallet yet.</p>
                      ) : (
                        <>
                          <ul className="notes" aria-label="Fees by coin">
                            {c.mine.map((m) => (
                              <li key={m.token}>
                                <span className="notes__row">
                                  <button type="button" className="chip" onClick={() => openCoin(m.token)} disabled={!openWindow}>
                                    {m.name ?? short(m.token)}
                                  </button>
                                  <span className="notes__id">{m.value ? `vs ${m.value.quoteSymbol}` : "pair not read"}</span>
                                </span>
                                <span className="notes__why">
                                  {feesText(m.fees, m.value ? [{ address: m.value.quote, symbol: m.value.quoteSymbol, name: m.value.quoteSymbol, decimals: m.value.quoteDecimals, startTick: 0 }] : [])}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {own ? (
                            <>
                              <Gel onClick={() => void onCollectAll()} disabled={waiting.length === 0 || collecting.running}>
                                {waiting.length === 0 ? "No fees waiting" : `Collect all — ${waiting.length} with fees waiting`}
                              </Gel>
                              <TxStepList states={collecting.states} label="Collect progress" />
                            </>
                          ) : null}
                        </>
                      )}
                    </div>
                  )}
                </ReadLine>
              ) : tab === "referrals" ? (
                <div className="stack">
                  <h3 className="profile__section-title">Referrals</h3>
                  <p className="dim">
                    Approved referrers on Launchpad v3 earn <strong>5% of trading fees</strong> for every coin launched with their referral address — recorded on-chain permanently at launch.
                  </p>
                  <div className="profile__ref-card stack">
                    <strong>Your referral link</strong>
                    <code className="profile__ref-url">{referralUrl}</code>
                    <div className="row">
                      <Gel type="button" onClick={() => copyText("ref", referralUrl)}>
                        {copied === "ref" ? "Copied referral link" : "Copy referral link"}
                      </Gel>
                      <Gel type="button" className="gel--quiet" onClick={() => copyText("profile", profileUrl)}>
                        {copied === "profile" ? "Copied profile link" : "Copy profile link"}
                      </Gel>
                    </div>
                  </div>
                </div>
              ) : tab === "card" ? (
                <div className="stack">
                  <CardPanel />
                </div>
              ) : (
                <ReadLine state={activity} what="the activity">
                  {({ items }: { items: ActivityItem[] }) =>
                    items.length === 0 ? (
                      <p className="dim">No token movements on record.</p>
                    ) : (
                      <ul className="notes" aria-label="Activity">
                        {items.map((i, n) => (
                          <li key={`${i.tx}:${n}`} className={i.tone === "bad" ? "tx__bad" : undefined}>
                            <span className="notes__why">
                              {i.at ? `${i.at.toLocaleString()} · ` : ""}
                              {i.text}
                              {i.tx ? (
                                <>
                                  {" · "}
                                  <a href={explorer.tx(i.tx)} target="_blank" rel="noreferrer">
                                    tx
                                  </a>
                                </>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )
                  }
                </ReadLine>
              )}
            </div>
          </div>
          <p className="dim">Read from {BASE.name}, Blockscout (an indexer, seconds behind) and DexScreener. The newest movements only.</p>
        </>
      )}
    </div>
  );
}
