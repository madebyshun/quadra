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
import { TxStepList, useTxSteps } from "@/features/panels/TxSteps";
import { BaseCard } from "@/features/panels/BaseCard";

/**
 * Profile — a wallet as a person sees it (owner, 2026-10-02: "there is no page for the user"). The
 * connected wallet by default; `?do=profile&a=<address or Basename>` is anybody's, so a coin's
 * launcher can be looked at before anyone buys (phase 2). Three tabs:
 *
 *   Holdings — ETH, priced tokens, and coins launched here valued from their pools; the unpriced
 *              rest is counted, never listed (mostly airdropped lures)
 *   Coins    — what this address launched here, each with its value and the fees waiting; on your
 *              own profile, one "Collect all"
 *   Activity — launches and token movements, with address-poisoning lures named as such
 *
 * No account and no server: the address is the identity and everything is read from the chain,
 * Blockscout and DexScreener. Nothing is signed here except a collection, in the user's own wallet.
 */

type Tab = "holdings" | "coins" | "activity" | "card";
type Read<T> = T | "reading" | { readonly problem: string };
type Mine = Launch & { readonly name: string | null; readonly value: PoolValue | null; readonly fees: Awaited<ReturnType<typeof pendingFees>> | null };

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

/** A small read in words: its value, "not read" when it failed, "…" until it arrives. */
function say<T extends object>(state: Read<T> | null, words: (v: T) => string): string {
  const v = done(state);
  return v !== null ? words(v) : state !== null && state !== "reading" ? "not read" : "…";
}

/** A read that came back — narrowed from "not asked", "reading" and "failed". */
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

/** Coins launched here whose balance is read from the chain — at most this many, newest first. */
export const COINS_CHECKED = 30;

async function readHoldings(address: string, coins: Coins): Promise<Holdings> {
  const [eth, price, indexed] = await Promise.all([balanceOf(ETH, address), ethUsd(), tokenBalances(address)]);
  // MEASURED 2026-10-02: Blockscout's balance list did not yet have a launchpad coin bought minutes
  // earlier — so a coin launched here is read from the CHAIN, and valued from its own pool
  const usdOf = sharedQuoteUsd();
  const values = new Map<string, number | null>();
  const fromChain = (
    await Promise.all(
      coins.launches.slice(0, COINS_CHECKED).map(async (l): Promise<TokenBalance | null> => {
        const raw = await balanceOf({ kind: "erc20", address: l.token, symbol: "", decimals: LAUNCHPAD_DECIMALS }, address).catch(() => null);
        if (raw === null || raw === 0n) return null;
        const [facts, v] = await Promise.all([chainToken(l.token).catch(() => null), poolValue(l.factory, l.token, usdOf).catch(() => null)]);
        values.set(l.token.toLowerCase(), v && v.quoteUsd !== null ? (v.supplyInQuote * v.quoteUsd) / 1e9 : null);
        // an unread name is "unnamed", not a shortened address: "…" is not ASCII, and would read as a look-alike lure
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
  const collecting = useTxSteps();

  // whose profile: the address or Basename in the link, else the connected wallet
  const target = useRead(asked ?? me, async (text) => (asked ? resolveTarget(text, "Profile") : { address: toChecksumAddress(text), via: null }), [asked]);
  const address = done(target)?.address ?? null;
  const own = address !== null && me !== null && address.toLowerCase() === me.toLowerCase();

  const name = useRead(address, nameOf);
  const kind = useRead(address, accountKind);
  const coins = useRead(address, readCoins, [fresh]);
  const read = done(coins);
  // both wait for the launchpad's list, which says which tokens are coins launched here; when it
  // could not be read they go ahead without it rather than wait forever
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

  return (
    <div className="stack">
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

          <div className="group__row group__row--actions" role="group" aria-label="Profile">
            {(["holdings", "coins", "activity", "card"] as const).map((t) => (
              <button key={t} type="button" className="chip chip--mode" aria-pressed={tab === t} onClick={() => setTab(t)}>
                {t === "holdings" ? "Holdings" : t === "coins" ? "Coins launched" : t === "activity" ? "Activity" : "Base card"}
              </button>
            ))}
          </div>

          {tab === "holdings" ? (
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
                  <p className="dim">This address has launched no coin here.</p>
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
          ) : tab === "card" ? (
            <BaseCard
              facts={{
                address: target.address,
                name: done(name)?.kind === "verified" ? nameText(done(name)).text : null,
                launched: read ? read.mine.length : null,
                feesWaiting: read ? waiting.length : null,
                holdings: done(holdings) ? `ETH and ${done(holdings)!.shown.length} priced tokens` : null,
                lures: done(activity) ? done(activity)!.items.filter((i) => i.tone === "bad").length : null,
              }}
            />
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
          <p className="dim">Read from {BASE.name}, Blockscout (an indexer, seconds behind) and DexScreener. The newest movements only.</p>
        </>
      )}
    </div>
  );
}
