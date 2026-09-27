import { useCallback, useEffect, useState } from "react";
import { useAdapters } from "@/adapters/AdaptersProvider";
import type { Quote, Tool, ToolRun } from "@/adapters/types";
import { formatAmount } from "@/lib/amount";
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
    return quote.price.kind === "free"
      ? "Run — free"
      : `Run for ${formatAmount(quote.price.amountBaseUnits, quote.price.asset.decimals)} ${quote.price.asset.symbol}`;
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
          <p className="dim">
            {formatAmount(quote.price.amountBaseUnits, quote.price.asset.decimals)}{" "}
            {quote.price.asset.symbol} on {quote.price.network}, to{" "}
            <code>{quote.price.payTo}</code>. Charged only if the tool answers.
          </p>
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
