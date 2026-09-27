import type { Completion, Enclave, Model } from "@/adapters/types";

/**
 * Inference that runs nowhere, and says so.
 *
 * There is no local TEE, so there is no quote to produce. The interesting
 * decision is what this returns INSTEAD. Three options were available:
 *
 *   1. a canned answer that reads like a model wrote it  → indistinguishable
 *      from the real thing in a screenshot, so it can be demoed as real by
 *      accident. Rejected.
 *   2. throw                                             → the UI cannot be
 *      built or tested against it at all. Rejected.
 *   3. an answer that is obviously a placeholder, carrying `kind: "local-dev"`
 *      so no verifier can be fooled and no reader can be either. Chosen.
 *
 * The prompt is echoed back deliberately: it proves the request arrived and was
 * carried intact, which is the only thing a stub can honestly demonstrate.
 */

const WHY_LOCAL = "no enclave is running — this answer was not attested by anything";

/**
 * Prices in USDC base units (6 dp). These are the real shape of what an enclave
 * would charge, so the payment UI is exercised against plausible numbers; they
 * are not quotes from any deployed service.
 */
export const LOCAL_MODELS: readonly Model[] = [
  { id: "quadra-small", label: "Small — fast, cheap, good enough to read a page", priceBaseUnits: 1_000n },
  { id: "quadra-medium", label: "Medium — the default", priceBaseUnits: 10_000n },
  { id: "quadra-large", label: "Large — slow, for work you will act on", priceBaseUnits: 100_000n },
] as const;

export class LocalEnclave implements Enclave {
  /** Never true here. There is no enclave. */
  readonly isLive = false;

  async models(): Promise<Model[]> {
    return [...LOCAL_MODELS];
  }

  async infer(modelId: string, prompt: string): Promise<Completion> {
    const model = LOCAL_MODELS.find((m) => m.id === modelId);
    if (!model) {
      throw new Error(
        `No model called "${modelId}". Available: ${LOCAL_MODELS.map((m) => m.id).join(", ")}.`,
      );
    }

    const text = prompt.trim();
    if (!text) throw new Error("Enter a prompt.");

    return {
      text: [
        "[no model ran]",
        "",
        `This is the local stub standing in for ${model.id}. It received ${text.length}`,
        "characters and did nothing with them. When an enclave is wired up, the",
        "answer appears here with a quote you can check against its measurement.",
        "",
        `Your prompt, carried intact: ${JSON.stringify(text)}`,
      ].join("\n"),
      model: model.id,
      attestation: { kind: "local-dev", why: WHY_LOCAL },
    };
  }
}
