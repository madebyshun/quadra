import { BRAND } from "@/brand";
import { useCallback, useEffect, useState } from "react";
import { useAdapters } from "@/adapters/AdaptersProvider";
import type { Quote, Tool, ToolRun } from "@/adapters/types";
import { formatAmount } from "@/lib/amount";
import { USDC_DOMAIN } from "@/lib/eip712";
import { paymentHeader, signAuthorization } from "@/lib/payment";
import { authorizationFor } from "@/lib/requirements";
import { type Wallet } from "@/lib/wallet";
import { BLUEAGENT } from "@/config/upstream";
import { FLAGS } from "@/config/chain";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import { useWalletSession } from "@/ui/WalletProvider";
import { Settled } from "@/features/panels/Anchor";
import { Requirements, SpendLimits, useSpending, WalletStatus } from "@/features/panels/X402Parts";
import { X402Url } from "@/features/panels/X402Url";
import { X402Own } from "@/features/panels/X402Own";

/**
 * Pay a 402 endpoint and read what it returns.
 *
 * The price comes from `catalog.quote`, which reads a live 402 rather than a
 * table in this repo. That matters more than it looks: a price held locally goes
 * stale silently, and the failure mode is signing an authorization for the wrong
 * amount. Reading the quote each time a tool is picked means the number on screen
 * is the number the payee asked for.
 *
 * The button says what it will do. "Run for $0.05" and "Run — free" are different
 * promises, and a single "Run" that sometimes charges is the one wording that
 * would be dishonest. When the adapter already knows THIS PRICE cannot be run it says
 * so through `whyNot`, and the button is disabled with the reason underneath rather
 * than inviting a click that throws. It is asked per quote, not once per adapter,
 * because over the live catalog the free ids run and the paid ones cannot — a single
 * answer for both would have to be wrong about half the list.
 *
 * The tool list comes over the network, so it has a failure case: an empty select
 * and the reason in the output window. It must not silently show a shorter list.
 *
 * ── Three ways in ──────────────────────────────────────────────────────────────
 * This app's own tools, sold over x402 by its own API (`X402Own.tsx`, first since
 * 2026-09-30), a tool from the BlueAgent directory (this file), or any x402 URL (`X402Url.tsx`) —
 * pasted, or picked from Coinbase's Bazaar. BlueAgent opens first only because it is
 * the one that needs no forwarder for a quote; it is a directory, not the product.
 * Both halves sign through the same wallet session and under the same spending limits
 * (`X402Parts.tsx`), so switching halves cannot switch off a limit.
 */

/** Which way in the window opens on: this app's own tools unless told otherwise. */
export type X402Mode = "own" | "directory" | "url";

/**
 * The window. While `FLAGS.x402Others` is off (2026-10-02) it is this app's own tools and nothing
 * else — no mode chips, and no request to BlueAgent's catalog at all.
 */
export function X402Panel({ start = "own" }: { readonly start?: X402Mode } = {}) {
  return FLAGS.x402Others ? <X402Workbench start={start} /> : <X402OwnOnly />;
}

function X402OwnOnly() {
  const spending = useSpending();
  const session = useWalletSession();
  const wallet: Wallet = session.wallet ?? { kind: "unavailable", why: "Checking…" };
  // the session's own actions, handed on as they are: switch when Base is the only thing wrong, else connect
  return <X402Own wallet={wallet} session={session} onConnect={wallet.kind === "wrongChain" ? session.switchChain : session.connectInjected} spending={spending} />;
}

function X402Workbench({ start }: { readonly start: X402Mode }) {
  const { catalog } = useAdapters();

  const [tools, setTools] = useState<Tool[]>([]);
  const [toolId, setToolId] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [input, setInput] = useState<Record<string, string>>({});
  const [run, setRun] = useState<ToolRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<X402Mode>(start);
  const spending = useSpending();

  /**
   * 🔴 The page's ONE wallet session, not a second copy.
   *
   * This panel used to hold its own `useState<Wallet>` and call `readWallet()` with
   * no argument, which reads the INJECTED provider and only that. So a user who had
   * signed in through WalletConnect or Coinbase Smart Wallet — in the tray or in the
   * Connect wallet window — was told to connect again here, by a panel that could not
   * see the session they already had. `WalletProvider` exists for exactly this; this
   * panel simply predated it and was not converted with the others.
   */
  const session = useWalletSession();
  /**
   * `null` means the first read has not come back. Rendering that as `unavailable`
   * would flash "no wallet" at somebody who has one, so it gets its own wording.
   */
  const wallet: Wallet = session.wallet ?? { kind: "unavailable", why: "Checking…" };

  /**
   * `connectInjected` when there is no account yet, `switchChain` when there is one on
   * the wrong network. Both live in the provider now, so the result lands in the tray
   * and the Connect wallet window at the same moment it lands here.
   */
  const connect = useCallback(async () => {
    setError(null);
    await (wallet.kind === "wrongChain" ? session.switchChain() : session.connectInjected());
  }, [wallet.kind, session]);

  useEffect(() => {
    let live = true;
    void catalog
      .tools()
      .then((found) => {
        if (!live) return;
        setTools(found);
        const first = found[0];
        setToolId((current) => current || (first ? first.id : ""));
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [catalog]);

  /**
   * Re-quote whenever the tool changes, and drop the previous quote while it is
   * in flight. Showing the old price next to the new tool for even one frame is
   * how someone agrees to the wrong amount.
   */
  useEffect(() => {
    if (!toolId) return;
    let live = true;
    setQuote(null);
    setRun(null);
    setError(null);
    setInput({});
    void catalog
      .quote(toolId)
      .then((found) => {
        if (live) setQuote(found);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [catalog, toolId]);

  const selected = tools.find((t) => t.id === toolId) ?? null;

  /**
   * `null` while the quote is in flight: the price is what decides, so before it
   * arrives there is no reason to give. The button is already disabled by `!quote`
   * making `label()` read a bare "Run", and a reason printed early would be a guess.
   */
  const why = quote ? catalog.whyNot(quote.price) : null;

  /**
   * A free run calls `catalog.run` with no third argument, unchanged from before this
   * increment. A paid one signs only when a wallet is actually `ready` — everything
   * about whether *this price* is safe to sign already happened in `checkRequirements`,
   * so the check here is only "is there a wallet ready to sign at all".
   *
   * With no wallet ready, this still calls `catalog.run(toolId, input)` — no third
   * argument — rather than refusing to click. That is deliberate: whether that is fine
   * is a fact about the *adapter*, not something this panel should guess at. The local
   * stub never charges anyone and answers exactly the same with or without a wallet
   * (see its header); the live catalog throws `NO_WALLET`, a legible reason the run's
   * own `catch` below surfaces. Gating the button on wallet state would block the stub's
   * documented no-wallet-needed runs along with the live ones that truly need it.
   */
  const go = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (quote?.price.kind === "paid" && wallet.kind === "ready") {
        /**
         * The provider the user actually connected with, which is NOT necessarily
         * the injected one — see `signingProvider`'s note. It throws rather than
         * returning null, so a vanished provider is a refusal with a reason in the
         * output window and nothing charged.
         */
        const provider = session.signingProvider();
        const requirements = quote.price.requirements;
        /** Enforced here, where the signature is made — not only by the disabled button. */
        spending.assertAllowed(requirements.value);
        const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
        const { authorization } = authorizationFor(requirements, wallet.account, nowSeconds);
        const signature = await signAuthorization(provider, USDC_DOMAIN, authorization);
        /**
         * Recorded after signing and before sending. If the record cannot be stored this
         * throws, and the signed authorization never leaves the browser — an unrecorded
         * signature that was never sent is no exposure at all. See `lib/spendGuard.ts`.
         */
        spending.record({ value: requirements.value, payee: authorization.to, resource: toolId });
        const payment = paymentHeader(requirements, authorization, signature);
        setRun(await catalog.run(toolId, input, payment));
      } else {
        setRun(await catalog.run(toolId, input));
      }
    } catch (e) {
      setRun(null);
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }, [catalog, toolId, input, quote, wallet, session, spending]);

  const needsWallet = quote?.price.kind === "paid";
  /** The user's own limit, as a reason next to the button — same shape as `why`. */
  const over = quote?.price.kind === "paid" ? spending.refusal(quote.price.requirements.value) : null;

  /*
    Mode chips first: which half of the window this is. `aria-pressed` rather than two
    radio inputs, because they switch what the window shows, not a value in a form.
  */
  const modes = (
    <div className="group__row group__row--actions" role="group" aria-label="Pay">
      <button type="button" className="chip chip--mode" aria-pressed={mode === "own"} onClick={() => setMode("own")}>
        {BRAND.name} tools
      </button>
      <button type="button" className="chip chip--mode" aria-pressed={mode === "directory"} onClick={() => setMode("directory")}>
        {BLUEAGENT.name} tools
      </button>
      <button type="button" className="chip chip--mode" aria-pressed={mode === "url"} onClick={() => setMode("url")}>
        Any x402 URL
      </button>
    </div>
  );

  if (mode === "own") {
    return (
      <div className="stack">
        {modes}
        <X402Own wallet={wallet} session={session} onConnect={() => void connect()} spending={spending} />
      </div>
    );
  }

  if (mode === "url") {
    return (
      <div className="stack">
        {modes}
        <X402Url wallet={wallet} session={session} onConnect={() => void connect()} spending={spending} />
      </div>
    );
  }

  const label = () => {
    if (busy) return "Running…";
    if (!quote) return "Run";
    if (quote.price.kind === "free") return "Run — free";
    const { value, asset } = quote.price.requirements;
    return `Run for ${formatAmount(value, asset.decimals)} ${asset.symbol}`;
  };

  return (
    <div className="stack">
      {modes}
      <fieldset className="group">
        <legend>Endpoint</legend>
        <label className="group__row">
          <span>Tool</span>
          <select
            className="field"
            value={toolId}
            onChange={(e) => setToolId(e.target.value)}
            aria-label="Tool"
          >
            {tools.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title} — {t.summary}
              </option>
            ))}
          </select>
        </label>
        {quote === null ? (
          <p className="dim">Reading the price…</p>
        ) : quote.price.kind === "free" ? (
          <p className="dim">Free. No payment is sent and no wallet is touched.</p>
        ) : (
          <Requirements requirements={quote.price.requirements} />
        )}
      </fieldset>

      {selected && selected.inputs.length > 0 ? (
        <fieldset className="group">
          <legend>What it needs</legend>
          {selected.inputs.map((field) => (
            <label className="group__row" key={field.name}>
              <span>
                {field.name}
                {field.required ? "" : " — optional"}
              </span>
              <input
                className="field"
                value={input[field.name] ?? ""}
                onChange={(e) => setInput((prev) => ({ ...prev, [field.name]: e.target.value }))}
                aria-label={field.name}
                spellCheck={false}
              />
            </label>
          ))}
        </fieldset>
      ) : null}

      {needsWallet ? <SpendLimits spending={spending} /> : null}
      {needsWallet ? <WalletStatus wallet={wallet} onConnect={() => void connect()} /> : null}

      {/*
        Disabled until the price is in hand. `quote === null` is not just tidiness: a
        live run POSTs for real now, and a button that reads a bare "Run" because the
        quote has not landed is the one wording this panel exists to avoid. Nothing
        gets clicked before the amount next to it is known.

        Not disabled for a missing wallet: whether that matters is the adapter's call,
        not this panel's guess (see the note on `go`). A click with no wallet ready
        still runs — the stub answers as documented, and the live catalog throws a
        legible `NO_WALLET` that lands in `error` below rather than a silent nothing.
      */}
      <Gel
        onClick={() => void go()}
        disabled={busy || toolId === "" || quote === null || why !== null || over !== null}
      >
        {label()}
      </Gel>
      {why ? <p className="dim">{why}</p> : null}
      {over ? <p className="caution">{over}</p> : null}

      <Crt label="x402 output">
        {error ? (
          <span className="crt__amber">{error}</span>
        ) : run ? (
          <>
            <span className="crt__pre">{run.output}</span>
            <Settled settlement={run.settlement} />
          </>
        ) : (
          <span className="crt__dim">{"// nothing run yet"}</span>
        )}
      </Crt>
    </div>
  );
}
