import { useCallback, useEffect, useState } from "react";
import { useAdapters } from "@/adapters/AdaptersProvider";
import type { Completion, Model } from "@/adapters/types";
import { formatAmount } from "@/lib/amount";
import { USDC } from "@/config/chain";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import { Attested } from "@/features/panels/Anchor";

/**
 * Ask a model something and see what proof came back with the answer.
 *
 * The proof is the product, so the attestation is rendered next to the text
 * rather than behind a disclosure. While no enclave exists that line says the
 * answer was attested by nothing, which is the honest thing for it to say and
 * the reason `Attestation` has no `verified: boolean` to render as false.
 */

export function InferencePanel() {
  const { enclave } = useAdapters();

  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [out, setOut] = useState<Completion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void enclave.models().then((found) => {
      if (!live) return;
      setModels(found);
      // Keeps a model the user already picked; falls back to the first offered.
      const first = found[0];
      setModelId((current) => current || (first ? first.id : ""));
    });
    return () => {
      live = false;
    };
  }, [enclave]);

  const ask = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setOut(await enclave.infer(modelId, prompt));
    } catch (e) {
      setOut(null);
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }, [enclave, modelId, prompt]);

  const price = models.find((m) => m.id === modelId)?.priceBaseUnits ?? null;

  return (
    <div className="stack">
      <fieldset className="group">
        <legend>Model</legend>
        <label className="group__row">
          <span>Run on</span>
          <select
            className="field"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            aria-label="Model"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        {price === null ? null : (
          <p className="dim">
            {formatAmount(price, USDC.decimals)} {USDC.symbol} per question, charged when the answer
            comes back.
          </p>
        )}
      </fieldset>

      <fieldset className="group">
        <legend>Your question</legend>
        <textarea
          className="field field--area"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          aria-label="Prompt"
          placeholder="Ask it something."
        />
        <Gel onClick={() => void ask()} disabled={busy || !prompt.trim() || modelId === ""}>
          {busy ? "Asking…" : "Ask"}
        </Gel>
      </fieldset>

      <Crt label="Answer">
        {error ? (
          <span className="crt__amber">{error}</span>
        ) : out ? (
          <>
            <span className="crt__pre">{out.text}</span>
            <Attested attestation={out.attestation} />
          </>
        ) : (
          <span className="crt__dim">{"// nothing asked yet"}</span>
        )}
      </Crt>
    </div>
  );
}
