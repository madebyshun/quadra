import { useEffect, useMemo, useRef, useState } from "react";
import { baseStocks, type BaseStock } from "@/adapters/http/markets";
import { USDC, WETH } from "@/config/chain";
import { TRADE_CRYPTO } from "@/config/markets";
import { assertChecksummedAddress, sameAddress } from "@/lib/address";
import { formatAmount } from "@/lib/amount";
import { balanceOf, ETH, ETH_GAS_RESERVE, readToken, type Asset } from "@/lib/erc20";
import { useStocksClosed } from "@/lib/region";
import { short } from "@/skills/format";
import { useOptionalWalletSession } from "@/ui/WalletProvider";
import { loadFastWalletRows, type WalletRow } from "@/features/panels/WalletAssets";

/**
 * Token picker: shows the user's wallet tokens by default (with USD value & balance),
 * plus a live search bar ("Enter token name or paste address") to filter any Base crypto,
 * Coinbase tokenized stock, or paste a 0x… contract address directly.
 */

export type Choice = "ETH" | "USDC" | "WETH" | "other";

const KNOWN: Record<"USDC" | "WETH", Asset> = {
  USDC: { kind: "erc20", address: USDC.address, symbol: USDC.symbol, decimals: USDC.decimals },
  WETH: { kind: "erc20", address: WETH.address, symbol: WETH.symbol, decimals: WETH.decimals },
};

const BASE_DEFAULTS: readonly { readonly choice: Choice; readonly address: string | null; readonly symbol: string; readonly name: string }[] = [
  { choice: "ETH", address: null, symbol: "ETH", name: "Ether" },
  { choice: "USDC", address: USDC.address, symbol: "USDC", name: "USD Coin" },
  { choice: "WETH", address: WETH.address, symbol: "WETH", name: "Wrapped Ether" },
];

const EXTRA_CRYPTO = TRADE_CRYPTO.filter((c) => !sameAddress(c.address, USDC.address) && !sameAddress(c.address, WETH.address));

/** The asset a choice names — from verified config for the known ones, read from the chain for any other. */
export async function assetFor(choice: Choice, typed: string, label: string): Promise<Asset> {
  if (choice === "ETH") return ETH;
  if (choice !== "other") return KNOWN[choice];
  return readToken(assertChecksummedAddress(typed, label));
}

type Candidate = {
  readonly key: string;
  readonly choice: Choice;
  readonly address: string | null;
  readonly symbol: string;
  readonly name: string;
  readonly amount?: string;
  readonly value?: string | null;
};

export function TokenPicker({
  label,
  choice,
  address,
  customLabel,
  onChoice,
  onAddress,
}: {
  label: string;
  choice: Choice;
  address: string;
  customLabel?: string | null;
  onChoice: (c: Choice) => void;
  onAddress: (a: string) => void;
}) {
  const session = useOptionalWalletSession();
  const account = session?.wallet?.kind === "ready" ? session.wallet.account : null;
  const closed = useStocksClosed();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [walletRows, setWalletRows] = useState<readonly WalletRow[]>([]);
  const [stocks, setStocks] = useState<readonly BaseStock[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Read only when the menu opens: a closed picker costs no request (and a money form mounts two).
  useEffect(() => {
    if (!open || !account) {
      if (!account) setWalletRows([]);
      return;
    }
    let live = true;
    void loadFastWalletRows(account)
      .then((rows) => live && setWalletRows(rows))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [account, open]);

  useEffect(() => {
    if (closed || !open) return;
    let live = true;
    void baseStocks()
      .then((map) => {
        if (!live) return;
        setStocks([...map.values()].filter((s) => !s.paused.includes(0) && s.nav !== null).sort((a, b) => a.symbol.localeCompare(b.symbol)));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [closed, open]);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 0);
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const catalog = useMemo<readonly Candidate[]>(() => {
    const out: Candidate[] = [
      ...BASE_DEFAULTS.map((d) => ({ key: d.address?.toLowerCase() ?? "eth", ...d })),
      ...EXTRA_CRYPTO.map((c) => ({ key: c.address.toLowerCase(), choice: "other" as const, address: c.address, symbol: c.symbol, name: c.name })),
      ...(!closed ? stocks.map((s) => ({ key: s.address.toLowerCase(), choice: "other" as const, address: s.address, symbol: s.symbol, name: s.name })) : []),
    ];
    return out;
  }, [closed, stocks]);

  const walletCandidates = useMemo<readonly Candidate[]>(() => {
    return walletRows.map((r) => {
      const k = r.address?.toLowerCase() ?? "eth";
      const match = catalog.find((c) => c.key === k);
      return {
        key: k,
        choice: choiceFor(r.address),
        address: r.address,
        symbol: r.symbol,
        // ETH (address null) is always in the catalog, so only a token can fall through to its address
        name: r.name ?? match?.name ?? short(r.address!),
        amount: r.amount,
        value: r.value,
      };
    });
  }, [walletRows, catalog]);

  const q = query.trim();
  const qLower = q.toLowerCase();
  const isHexAddress = /^0x[0-9a-fA-F]{40}$/.test(q);

  const visibleItems = useMemo<readonly Candidate[]>(() => {
    if (!q) {
      if (walletCandidates.length > 0) return walletCandidates;
      return BASE_DEFAULTS.map((d) => ({ key: d.address?.toLowerCase() ?? "eth", ...d }));
    }
    const byKey = new Map<string, Candidate>();
    for (const w of walletCandidates) byKey.set(w.key, w);
    for (const c of catalog) {
      if (!byKey.has(c.key)) byKey.set(c.key, c);
    }
    const matches = [...byKey.values()].filter(
      (c) =>
        c.symbol.toLowerCase().includes(qLower) ||
        c.name.toLowerCase().includes(qLower) ||
        (c.address !== null && c.address.toLowerCase() === qLower),
    );
    if (isHexAddress && !matches.some((m) => m.address?.toLowerCase() === qLower)) {
      matches.unshift({
        key: qLower,
        choice: choiceFor(q),
        address: q,
        symbol: short(q),
        name: "Custom token on Base",
      });
    }
    return matches.slice(0, 30);
  }, [q, qLower, isHexAddress, walletCandidates, catalog]);

  const selectedLabel = useMemo(() => {
    if (choice === "ETH") return "ETH";
    if (choice === "USDC") return "USDC";
    if (choice === "WETH") return "WETH";
    const lower = address.trim().toLowerCase();
    if (!lower) return customLabel || "Select token";
    const found = walletCandidates.find((c) => c.key === lower) ?? catalog.find((c) => c.key === lower);
    if (found) return `${found.symbol} — ${found.name}`;
    return customLabel ? `${customLabel} (${short(address.trim())})` : short(address.trim());
  }, [choice, address, customLabel, walletCandidates, catalog]);

  const pickCandidate = (item: Candidate) => {
    onChoice(item.choice);
    onAddress(item.choice === "other" && item.address ? item.address : "");
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="group__row">
      <span>{label}</span>
      <div className="qselect" ref={rootRef}>
        <select
          className="sr-only"
          aria-label={label}
          value={choice}
          onChange={(e) => onChoice(e.target.value as Choice)}
        >
          <option value="ETH">ETH</option>
          <option value="USDC">USDC</option>
          <option value="WETH">WETH</option>
          <option value="other">{customLabel || "0x…"}</option>
        </select>
        <button
          type="button"
          className="field qselect__btn"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="qselect__val">{selectedLabel}</span>
          <span className="qselect__caret" aria-hidden="true" />
        </button>
        {open ? (
          <div className="menu tp__menu" role="dialog" aria-label={`Select ${label}`}>
            <div className="tp__search-wrap">
              <input
                ref={inputRef}
                className="field tp__search"
                aria-label={`Search ${label}`}
                placeholder="Enter token name or paste address"
                spellCheck={false}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && visibleItems.length > 0) {
                    e.preventDefault();
                    pickCandidate(visibleItems[0]!);
                  }
                }}
              />
            </div>
            <div className="qselect__head">{q ? "Matching tokens" : walletCandidates.length > 0 ? "In your wallet" : "Base tokens"}</div>
            <div className="tp__list" role="listbox" aria-label={`${label} options`}>
              {visibleItems.length === 0 ? (
                <p className="tp__empty">No token found. Paste a 0x… contract address on Base.</p>
              ) : (
                visibleItems.map((item) => {
                  const active =
                    item.choice !== "other"
                      ? choice === item.choice
                      : choice === "other" && item.address !== null && address.trim().toLowerCase() === item.address.toLowerCase();
                  return (
                    <button
                      key={item.key}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className="menu__item qselect__item tp__row"
                      onClick={() => pickCandidate(item)}
                    >
                      <span className="tp__left">
                        <strong>{item.symbol}</strong>
                        <small>{item.name}</small>
                      </span>
                      {item.amount ? (
                        <span className="tp__right">
                          <strong>{item.value ?? "—"}</strong>
                          <small>{item.amount} {item.symbol}</small>
                        </span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
      </div>
      {choice === "other" ? (
        // the address itself stays in view and editable: what is reviewed is what was typed (hard rule 2)
        <label className="group__row">
          <span>{label} address</span>
          <input
            className="field"
            aria-label={`${label} address`}
            placeholder="0x…"
            spellCheck={false}
            value={address}
            onChange={(e) => onAddress(e.target.value)}
          />
        </label>
      ) : null}
    </div>
  );
}

/** Which picker choice names this token — ETH is `null`; anything but USDC/WETH is "other". */
export function choiceFor(address: string | null): Choice {
  if (address === null) return "ETH";
  if (sameAddress(address, USDC.address)) return "USDC";
  if (sameAddress(address, WETH.address)) return "WETH";
  return "other";
}

/**
 * `pct` percent of what `account` holds of the chosen token, as the text an Amount field takes.
 * Read from the chain at the click, not from the list above (an indexer, seconds behind), and
 * truncated, never rounded up. "Max" on ETH keeps `ETH_GAS_RESERVE` back for the gas.
 */
export async function amountFor(choice: Choice, typed: string, label: string, account: string, pct: number): Promise<string> {
  const asset = await assetFor(choice, typed, label);
  const held = await balanceOf(asset, account);
  let amount = (held * BigInt(pct)) / 100n;
  if (asset.kind === "native" && pct === 100) amount = amount > ETH_GAS_RESERVE ? amount - ETH_GAS_RESERVE : 0n;
  return formatAmount(amount, asset.decimals);
}

export const PERCENTS = [25, 50, 75, 100] as const;

/**
 * 25% / 50% / 75% / Max. `pending` is the one being read: it shows "…" and the others wait, so a
 * click always visibly does something — the balance read is a round-trip to the chain.
 */
export function PercentButtons({ onPick, disabled, pending = null }: { onPick: (pct: number) => void; disabled: boolean; pending?: number | null }) {
  return (
    <div className="group__row group__row--actions" role="group" aria-label="Amount shortcuts">
      <span />
      {PERCENTS.map((p) => (
        <button
          key={p}
          type="button"
          className="chip"
          aria-label={p === 100 ? "Max" : `${p}%`}
          aria-busy={pending === p}
          onClick={() => onPick(p)}
          disabled={disabled || pending !== null}
        >
          {pending === p ? "…" : p === 100 ? "Max" : `${p}%`}
        </button>
      ))}
    </div>
  );
}
