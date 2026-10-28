import { describe, expect, it } from "vitest";
import { adapters } from "@/adapters";
import { LOCAL_MODELS, LocalEnclave } from "@/adapters/local/enclave";
import { LOCAL_TOOLS, LocalCatalog, priceOf } from "@/adapters/local/catalog";
import { HttpCatalog } from "@/adapters/http/catalog";
import { USDC } from "@/config/chain";
import { formatAmount } from "@/lib/amount";

/*
  The pool, note-store and reload tests that filled most of this file were archived with the
  privacy model on 2026-09-30 — the full original is at archive/privacy/tests/adapters.test.ts.
  What is left is what still ships: the type-only module, the enclave stub, and the resolver.
*/

describe("adapters/types.ts", () => {
  /**
   * The coverage report shows this file as 0% because it has no runtime code to
   * cover — 0 of 0. This asserts that stays true. If a constant or a helper is
   * ever added there, the 0% becomes a real gap that the 100% threshold would
   * NOT catch (v8 cannot divide by zero either way), so the guard has to be a
   * test rather than a number.
   */
  it("is type-only: it compiles to a module with nothing in it", async () => {
    const mod = await import("@/adapters/types");
    expect(Object.keys(mod)).toEqual([]);
  });
});

describe("LocalEnclave", () => {
  const enclave = new LocalEnclave();

  it("is not live", () => {
    expect(enclave.isLive).toBe(false);
  });

  it("offers three models, priced in USDC base units", async () => {
    const models = await enclave.models();
    expect(models.map((m) => m.id)).toEqual(["quadra-small", "quadra-medium", "quadra-large"]);
    for (const m of models) expect(m.priceBaseUnits).toBeGreaterThan(0n);
  });

  it("prices them in ascending order, so the labels are not the only signal", async () => {
    const prices = (await enclave.models()).map((m) => m.priceBaseUnits);
    expect(prices).toEqual([...prices].sort((a, b) => (a < b ? -1 : 1)));
  });

  it("quotes prices that format as real USDC amounts", async () => {
    const models = await enclave.models();
    expect(models.map((m) => formatAmount(m.priceBaseUnits, USDC.decimals))).toEqual([
      "0.001",
      "0.01",
      "0.1",
    ]);
  });

  it("hands back a copy of the model list", async () => {
    const models = await enclave.models();
    models.length = 0;
    expect(await enclave.models()).toHaveLength(LOCAL_MODELS.length);
  });

  it("attests nothing, and carries no field a verifier could check", async () => {
    const out = await enclave.infer("quadra-medium", "what is this");
    expect(out.attestation).toEqual({
      kind: "local-dev",
      why: "no enclave is running — this answer was not attested by anything",
    });
    expect(out.attestation).not.toHaveProperty("quote");
    expect(out.attestation).not.toHaveProperty("measurement");
    expect(out.attestation).not.toHaveProperty("verified");
  });

  it("says up front that no model ran, in the first line", async () => {
    const out = await enclave.infer("quadra-small", "hello");
    expect(out.text.split("\n")[0]).toBe("[no model ran]");
  });

  it("carries the prompt back intact, which is all a stub can honestly prove", async () => {
    const prompt = "keep\tthis";
    const out = await enclave.infer("quadra-small", `  ${prompt}  `);
    expect(out.text).toContain(JSON.stringify(prompt));
    // counted after trimming, so the padding is not reported as content
    expect(out.text).toContain(`received ${prompt.length}`);
  });

  it("reports which model was asked for", async () => {
    expect((await enclave.infer("quadra-large", "x")).model).toBe("quadra-large");
  });

  it("refuses an unknown model and lists the real ones", async () => {
    await expect(enclave.infer("gpt-4", "x")).rejects.toThrow(
      'No model called "gpt-4". Available: quadra-small, quadra-medium, quadra-large.',
    );
  });

  it("refuses an empty prompt", async () => {
    await expect(enclave.infer("quadra-small", "")).rejects.toThrow("Enter a prompt.");
    await expect(enclave.infer("quadra-small", "   \n ")).rejects.toThrow("Enter a prompt.");
  });
});

describe("resolver", () => {
  it("builds exactly the adapters that still exist, and neither claims to be live", () => {
    const built = adapters();
    expect(Object.keys(built).sort()).toEqual(["catalog", "enclave"]);
    expect(built.enclave).toBeInstanceOf(LocalEnclave);
    expect(built.enclave.isLive).toBe(false);
  });

  /**
   * The catalog resolves live while the enclave does not, by the same rule: return
   * whatever actually exists. There is no TEE, but the catalog is a free CORS-open GET
   * that answers today — so handing back the stub would be choosing four invented tools
   * over the 115 real ones.
   */
  it("resolves the real catalog, not the offline stub", () => {
    const { catalog } = adapters();
    expect(catalog).toBeInstanceOf(HttpCatalog);
    expect(catalog).not.toBeInstanceOf(LocalCatalog);
  });

  /**
   * Live reads, and still not live: `isLive` is about settlement, and nothing settles.
   * The paid price comes from `priceOf` rather than a literal written here, because the
   * only way to hold a paid `Price` is through `checkRequirements`.
   */
  it("does not let a live read make the catalog claim it settled anything", () => {
    const { catalog } = adapters();
    expect(catalog.isLive).toBe(false);
    expect(catalog.whyNot({ kind: "free", why: "no payment" })).toBeNull();
    const paid = priceOf(LOCAL_TOOLS.find((t) => t.priceBaseUnits > 0n)!);
    expect(paid.kind).toBe("paid");
    expect(catalog.whyNot(paid)).toBeNull();
  });

  it("hands out distinct objects each call, so neither holds the other's state", () => {
    expect(adapters().enclave).not.toBe(adapters().enclave);
    expect(adapters().catalog).not.toBe(adapters().catalog);
  });
});
