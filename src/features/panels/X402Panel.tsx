import { useCallback, useEffect, useState } from "react";
import { useAdapters } from "@/adapters/AdaptersProvider";
import type { Quote, Tool, ToolRun } from "@/adapters/types";
import { BASE } from "@/config/chain";
import { formatAmount } from "@/lib/amount";
import { whyNotSign, type PaymentRequirements } from "@/lib/requirements";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import { Settled } from "@/features/panels/Anchor";

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
 */

export function X402Panel() {
  const { catalog } = useAdapters();

  const [tools, setTools] = useState<Tool[]>([]);
  const [toolId, setToolId] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [input, setInput] = useState<Record<string, string>>({});
  const [run, setRun] = useState<ToolRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const go = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setRun(await catalog.run(toolId, input));
    } catch (e) {
      setRun(null);
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }, [catalog, toolId, input]);

  const label = () => {
    if (busy) return "Running…";
    if (!quote) return "Run";
    if (quote.price.kind === "free") return "Run — free";
    const { value, asset } = quote.price.requirements;
    return `Run for ${formatAmount(value, asset.decimals)} ${asset.symbol}`;
  };

  return (
    <div className="stack">
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

      {/*
        Disabled until the price is in hand. `quote === null` is not just tidiness: a
        live run POSTs for real now, and a button that reads a bare "Run" because the
        quote has not landed is the one wording this panel exists to avoid. Nothing
        gets clicked before the amount next to it is known.
      */}
      <Gel onClick={() => void go()} disabled={busy || toolId === "" || quote === null || why !== null}>
        {label()}
      </Gel>
      {why ? <p className="dim">{why}</p> : null}

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

/**
 * What a paid run will cost, who receives it, and how long the signature stays
 * spendable.
 *
 * Every field here survived `checkRequirements`, which is why this component can
 * render them flatly with no hedging: the amount is exact base units, the asset's
 * decimals came from this repo's verified table rather than from the 402, and the
 * chain was refused unless it was `eip155:8453`. That last one is why the chain
 * prints as `BASE.name` and not as a string off the wire — the name is a
 * restatement of an assertion that passed, not config quietly overriding upstream.
 *
 * ── The window is on screen because it is the exposure ───────────────────────────
 * An EIP-3009 authorization is a bearer instrument: once signed, whoever holds it
 * can redeem it once, at any moment until `validBefore`. So the honest unit of
 * risk is not the amount alone, it is the amount multiplied by how long the slip
 * stays live. Upstream asks for 120 seconds. This panel printed neither number
 * until the requirements check existed to read them, and hiding the window while
 * showing the price would describe the smaller half of what is being agreed to.
 *
 * ── An unrecognised payee is shown, not swallowed ────────────────────────────────
 * ⚠️ `whyNotSign` is asked here even though this build cannot sign anything yet,
 * and its sentence is rendered in `.caution` rather than as an error. Two reasons,
 * and the second is the load-bearing one:
 *
 *   - It is not an error. The quote parsed, the price is real, and the tool is
 *     still perfectly runnable the moment a wallet exists — nothing failed.
 *   - Suppressing it until signing is wired up would mean the day signing lands is
 *     the day the warning first appears, which is the worst possible day to
 *     discover that upstream's payee moved. A warning that only shows up once it
 *     has teeth has been silent for exactly the period when it was free to read.
 */
function Requirements({ requirements }: { requirements: PaymentRequirements }) {
  const { payee, value, asset, lifetimeSeconds } = requirements;
  const refusal = whyNotSign(requirements);
  return (
    <>
      <p className="dim">
        {formatAmount(value, asset.decimals)} {asset.symbol} on {BASE.name}, to{" "}
        <code>{payee.address}</code>. Charged only if the tool answers.
      </p>
      <p className="dim">
        {"The authorization it asks you to sign stays spendable for "}
        {`${lifetimeSeconds}`} seconds, then expires on its own.
      </p>
      {refusal ? <p className="caution">{refusal}</p> : null}
    </>
  );
}
