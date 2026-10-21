import { useCallback, useEffect, useState } from "react";
import type { ToolRun } from "@/adapters/types";
import { bazaarPage, BAZAAR, type BazaarPage } from "@/adapters/http/bazaar";
import { payEndpoint, quoteEndpoint, type EndpointQuote } from "@/adapters/http/endpoint";
import { formatAmount } from "@/lib/amount";
import { USDC_DOMAIN } from "@/lib/eip712";
import { paymentSignatureHeader, signAuthorization } from "@/lib/payment";
import { loadPins, lookupWith, savePins, userPinFor, withoutPin, withPin, type UserPin } from "@/lib/pins";
import { authorizationFor, whyNotSign, type PaymentRequirements } from "@/lib/requirements";
import { messageOf } from "@/lib/errors";
import type { Wallet } from "@/lib/wallet";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import type { WalletSession } from "@/ui/WalletProvider";
import { Settled } from "@/features/panels/Anchor";
import { Requirements, SpendLimits, WalletStatus, type Spending } from "@/features/panels/X402Parts";

/**
 * Pay any x402 URL: pasted, or picked from Coinbase's Bazaar.
 *
 * The directory half of this window (`X402Panel`) pays tools from one catalog. This half
 * pays whatever URL it is given, which is the product's claim — agents spend on "any x402
 * endpoint" — made true for a person first. Everything that decides the money is shared
 * with the directory half: `checkRequirements`, the wallet session, the spending limits.
 *
 * ── The payee is the step this half adds ──────────────────────────────────────
 * A server this build has never heard of names its own payee, and a payee named by the
 * party asking to be paid is not evidence of anything. So an unpinned payee is refused
 * (`whyNotSign`), and the way through is deliberate: tick that the address was checked
 * somewhere other than this server's reply, then pin it. Two actions, because one click
 * next to a warning is the click people make without reading. From then on a CHANGE of
 * payee at that origin is caught exactly as a shipped pin catches one.
 *
 * ── No stub, no fallback ──────────────────────────────────────────────────────
 * The directory half runs against a local stub in tests and a live catalog in the app.
 * A pasted URL has no stub: it is live or it is nothing, and a failure says which route
 * failed (direct, forwarder, none) in `adapters/http/endpoint.ts`'s words.
 */

type Props = {
  wallet: Wallet;
  session: WalletSession;
  onConnect: () => void;
  spending: Spending;
  /**
   * A URL chosen elsewhere — this app's own API, picked in `X402Own`. It is priced at once,
   * and the URL box and the Bazaar are not shown: the choice was already made.
   */
  fixedUrl?: string;
};

function initialPins(): { pins: UserPin[]; error: string | null } {
  try {
    return { pins: loadPins(localStorage), error: null };
  } catch (e) {
    return { pins: [], error: (e as Error).message };
  }
}

export function X402Url({ wallet, session, onConnect, spending, fixedUrl }: Props) {
  const [text, setText] = useState(fixedUrl ?? "");
  const [quote, setQuote] = useState<EndpointQuote | null>(null);
  const [reading, setReading] = useState(false);
  const [run, setRun] = useState<ToolRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pinState, setPinState] = useState(initialPins);
  const [checked, setChecked] = useState(false);
  const [bazaar, setBazaar] = useState<BazaarPage | null>(null);
  const [bazaarError, setBazaarError] = useState<string | null>(null);

  /**
   * Quote `url` against `pins`. Both are parameters rather than read from state, because
   * pinning re-quotes in the same handler that changed the pins — state would still hold
   * the old list — and a quote classified against the old list would keep refusing the
   * payee the user just confirmed.
   */
  const read = useCallback(async (url: string, pins: readonly UserPin[]) => {
    setReading(true);
    setQuote(null);
    setRun(null);
    setError(null);
    setChecked(false);
    try {
      setQuote(await quoteEndpoint(url, lookupWith(pins)));
    } catch (e) {
      setError(messageOf(e));
    }
    setReading(false);
  }, []);

  useEffect(() => {
    if (fixedUrl !== undefined) void read(fixedUrl, pinState.pins);
    // priced once, when the window is handed the URL — a new URL is a new component (its `key`)
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const browse = async () => {
    setBazaarError(null);
    try {
      setBazaar(await bazaarPage());
    } catch (e) {
      setBazaarError(messageOf(e));
    }
  };

  const repin = (next: UserPin[], url: string) => {
    savePins(localStorage, next);
    setPinState({ pins: next, error: null });
    void read(url, next);
  };

  const paid = quote?.price.kind === "paid" ? quote.price.requirements : null;
  const userPin = quote ? userPinFor(pinState.pins, quote.origin) : null;
  const refusal = paid ? whyNotSign(paid) : null;
  const over = paid ? spending.refusal(paid.value) : null;
  const walletBlock = wallet.kind === "ready" ? null : wallet.why;

  /**
   * Takes what it pays with as arguments, already narrowed where the button is drawn —
   * rather than re-checking `quote`, `paid` and the wallet here, where every "missing"
   * branch would be one the disabled button makes unreachable (see `messageOf`'s note on
   * why an unreachable branch is not free in this repo).
   */
  const pay = async (target: EndpointQuote, paid: PaymentRequirements, account: string) => {
    setBusy(true);
    setError(null);
    try {
      /** Enforced where the signature is made — not only by the disabled button. */
      spending.assertAllowed(paid.value);
      const { authorization } = authorizationFor(paid, account, BigInt(Math.floor(Date.now() / 1000)));
      const signature = await signAuthorization(session.signingProvider(), USDC_DOMAIN, authorization);
      /** Recorded before it is sent; a record that cannot be stored stops the send. See `X402Panel`. */
      spending.record({ value: paid.value, payee: authorization.to, resource: target.url });
      setRun(await payEndpoint(target, paymentSignatureHeader(paid, authorization, signature)));
    } catch (e) {
      setRun(null);
      setError(messageOf(e));
    }
    setBusy(false);
  };

  return (
    <>
      <fieldset className="group">
        <legend>Endpoint</legend>
        {fixedUrl === undefined ? (
          <>
        <label className="group__row">
          <span>URL</span>
          <input
            className="field"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="https://…"
            aria-label="Endpoint URL"
            spellCheck={false}
          />
        </label>
        <div className="group__row group__row--actions">
          <Gel onClick={() => void read(text, pinState.pins)} disabled={reading || text.trim() === ""}>
            {reading ? "Reading…" : "Read price"}
          </Gel>
          <Gel quiet onClick={() => void browse()}>
            Browse the {BAZAAR.name}
          </Gel>
        </div>
        {bazaar ? (
          <>
            <select
              className="field"
              value=""
              aria-label="Bazaar listing"
              onChange={(e) => {
                setText(e.target.value);
                void read(e.target.value, pinState.pins);
              }}
            >
              <option value="" disabled>
                Pick one of {bazaar.listings.length} this build can pay…
              </option>
              {bazaar.listings.map((l) => (
                <option key={l.url} value={l.url}>
                  {l.description}
                </option>
              ))}
            </select>
            <p className="dim">
              {bazaar.listings.length} of the first {bazaar.seen} listed
              {bazaar.total === null ? "" : ` (of ${bazaar.total} in the directory)`} can be paid by
              this build. Prices are read from each endpoint when you pick it, never from the list.
            </p>
          </>
        ) : null}
          </>
        ) : (
          <p className="dim">
            <code>{fixedUrl}</code>
          </p>
        )}
        {bazaarError ? <p className="caution">{bazaarError}</p> : null}
        {pinState.error ? <p className="caution">{pinState.error}</p> : null}

        {quote?.price.kind === "free" ? (
          <p className="dim">Free. It answered without asking to be paid, and its answer is below.</p>
        ) : null}
        {paid && quote ? (
          <>
            <Requirements requirements={paid} />
            {quote.route === "forwarded" ? (
              <p className="dim">
                Read through this app&apos;s forwarder: {quote.origin} does not let a browser read it
                directly.
              </p>
            ) : null}
            {paid.payee.kind === "unpinned" ? (
              <div className="group__row group__row--actions">
                <label className="check">
                  <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                  <span>
                    I checked <code>{paid.payee.address}</code> somewhere other than this server&apos;s reply
                  </span>
                </label>
                <Gel
                  quiet
                  disabled={!checked}
                  onClick={() => repin(withPin(pinState.pins, quote.origin, paid.payee.address, new Date()), quote.url)}
                >
                  Pin this payee for {quote.origin}
                </Gel>
              </div>
            ) : null}
            {userPin ? (
              <div className="group__row group__row--actions">
                <p className="dim">You confirmed this origin&apos;s payee on {userPin.pinnedAt.slice(0, 10)}.</p>
                <Gel quiet onClick={() => repin(withoutPin(pinState.pins, quote.origin), quote.url)}>
                  Forget
                </Gel>
              </div>
            ) : null}
          </>
        ) : null}
      </fieldset>

      {paid ? <SpendLimits spending={spending} /> : null}
      {paid ? <WalletStatus wallet={wallet} onConnect={onConnect} /> : null}

      {paid && quote ? (
        <Gel
          onClick={wallet.kind === "ready" ? () => void pay(quote, paid, wallet.account) : undefined}
          disabled={busy || refusal !== null || over !== null || walletBlock !== null}
        >
          {busy ? "Paying…" : `Pay ${formatAmount(paid.value, paid.asset.decimals)} ${paid.asset.symbol} and fetch`}
        </Gel>
      ) : null}
      {over ? <p className="caution">{over}</p> : null}

      <Crt label="x402 output">
        {error ? (
          <span className="crt__amber">{error}</span>
        ) : run ? (
          <>
            <span className="crt__pre">{run.output}</span>
            <Settled settlement={run.settlement} />
          </>
        ) : quote?.answer ? (
          <span className="crt__pre">{quote.answer}</span>
        ) : (
          <span className="crt__dim">{"// paste an x402 URL, or browse the Bazaar"}</span>
        )}
      </Crt>
    </>
  );
}
