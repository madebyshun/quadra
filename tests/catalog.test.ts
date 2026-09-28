import { describe, expect, it } from "vitest";
import { LOCAL_TOOLS, LocalCatalog, priceOf } from "@/adapters/local/catalog";
import type { Catalog } from "@/adapters/types";
import { BLUEAGENT } from "@/config/upstream";
import { USDC } from "@/config/chain";
import { USDC_DOMAIN } from "@/lib/eip712";

const free = () => LOCAL_TOOLS.find((t) => t.priceBaseUnits === 0n)!;
const paid = () => LOCAL_TOOLS.find((t) => t.priceBaseUnits > 0n)!;
const noInputs = () => LOCAL_TOOLS.find((t) => t.inputs.length === 0)!;

describe("the local catalog", () => {
  it("is never live, because nothing it returns was paid for", () => {
    expect(new LocalCatalog().isLive).toBe(false);
  });

  it("offers every tool, with its inputs", async () => {
    const tools = await new LocalCatalog().tools();
    expect(tools).toHaveLength(LOCAL_TOOLS.length);
    expect(tools.map((t) => t.id)).toEqual(LOCAL_TOOLS.map((t) => t.id));
  });

  /**
   * The price is on the internal record and deliberately not on the `Tool` the UI
   * receives. A tool carrying its own price invites the UI to display that instead
   * of the quote, which is the stale-price bug the panel exists to avoid.
   */
  it("hands out tools without a price attached", async () => {
    const [first] = await new LocalCatalog().tools();
    expect(first).toBeDefined();
    expect(first).not.toHaveProperty("priceBaseUnits");
  });

  it("copies the list, so a caller cannot edit the catalog", async () => {
    const catalog = new LocalCatalog();
    const tools = await catalog.tools();
    tools.length = 0;
    expect(await catalog.tools()).toHaveLength(LOCAL_TOOLS.length);
  });

  it("covers every shape the UI has to render", () => {
    expect(LOCAL_TOOLS.some((t) => t.priceBaseUnits === 0n)).toBe(true);
    expect(LOCAL_TOOLS.some((t) => t.priceBaseUnits > 0n)).toBe(true);
    expect(LOCAL_TOOLS.some((t) => t.inputs.length === 0)).toBe(true);
    expect(LOCAL_TOOLS.some((t) => t.inputs.length > 1)).toBe(true);
    expect(LOCAL_TOOLS.some((t) => t.inputs.some((f) => !f.required))).toBe(true);
  });

  /**
   * Every price runs here, paid included. That is the difference from `HttpCatalog`,
   * which can only run the free ones: a paid run there needs a signature, and this
   * stub charges nothing, so there is nothing to sign.
   */
  it("has no reason a run cannot be attempted, whatever the price", () => {
    /** Through the interface, because the class ignores the price it is handed. */
    const catalog: Catalog = new LocalCatalog();
    expect(catalog.whyNot(priceOf(free()))).toBeNull();
    expect(catalog.whyNot(priceOf(paid()))).toBeNull();
  });
});

describe("quoting a tool", () => {
  it("prices a paid tool in USDC on Base, to the published payee", async () => {
    const tool = paid();
    const quote = await new LocalCatalog().quote(tool.id);
    expect(quote.toolId).toBe(tool.id);
    if (quote.price.kind !== "paid") throw new Error("expected a paid quote");
    expect(quote.price.requirements.value).toBe(tool.priceBaseUnits);
    expect(quote.price.requirements.asset).toEqual(USDC);
    expect(quote.price.requirements.toolId).toBe(tool.id);
  });

  /**
   * ⚠️ The chain is asserted by its ABSENCE from the struct, which is the only place
   * it can be asserted now.
   *
   * This used to read `expect(quote.price.network).toBe("eip155:8453")`, and that
   * test could pass with the network never checked — a string copied off the wire
   * and displayed is indistinguishable from a string that was verified. Today
   * `checkRequirements` refuses anything but `eip155:8453` and then does not keep it,
   * because a field that survived a check has nothing left to tell a caller. So the
   * statement "this quote is on Base" is now carried by the quote existing at all,
   * and the refusals are pinned where they belong, in `tests/requirements.test.ts`.
   */
  it("keeps no network string, because a checked chain has nothing left to report", async () => {
    const quote = await new LocalCatalog().quote(paid().id);
    if (quote.price.kind !== "paid") throw new Error("expected a paid quote");
    expect(quote.price.requirements).not.toHaveProperty("network");
  });

  /**
   * The stub must not contain an invented address. This pins it to the one
   * BLUEAGENT publishes, so a typo in either place is a failing test rather than
   * a payment to a wallet nobody controls.
   *
   * `kind: "known"` is the second half of the same statement: the checker compared
   * this address against `BLUEAGENT.knownPayTo` and recognised it. A stub whose
   * payee came back `unrecognised` would still render, and would be a stub that
   * disagrees with the config it claims to copy.
   */
  it("pays the address upstream actually publishes, not a made-up one", async () => {
    const quote = await new LocalCatalog().quote(paid().id);
    if (quote.price.kind !== "paid") throw new Error("expected a paid quote");
    expect(quote.price.requirements.payee.address).toBe(BLUEAGENT.knownPayTo);
    expect(quote.price.requirements.payee.kind).toBe("known");
  });

  /** Copied from upstream's live 402, not from `DEFAULT_AUTHORIZATION_SECONDS`. */
  it("asks for the settlement window upstream asks for", async () => {
    const quote = await new LocalCatalog().quote(paid().id);
    if (quote.price.kind !== "paid") throw new Error("expected a paid quote");
    expect(quote.price.requirements.lifetimeSeconds).toBe(120n);
  });

  it("calls a free tool free, rather than pricing it at zero", async () => {
    const quote = await new LocalCatalog().quote(free().id);
    expect(quote.price.kind).toBe("free");
    expect(quote.price).not.toHaveProperty("requirements");
  });

  it("names what exists when asked for a tool that does not", async () => {
    await expect(new LocalCatalog().quote("teleport")).rejects.toThrow(
      /No tool called "teleport"\. Available: /,
    );
  });

  it("is free to quote: reading a price charges nothing", async () => {
    const run = await new LocalCatalog().quote(paid().id);
    expect(run).not.toHaveProperty("settlement");
  });
});

describe("running a tool", () => {
  it("refuses a paid tool with a missing input, before any payment", async () => {
    await expect(new LocalCatalog().run("competitor-scan", { project: "Quadra" })).rejects.toThrow(
      "Competitor Scan needs description.",
    );
  });

  it("names every missing input at once, not one per attempt", async () => {
    await expect(new LocalCatalog().run("competitor-scan", {})).rejects.toThrow(
      "Competitor Scan needs project and description.",
    );
  });

  it("treats whitespace as missing, so a space does not buy a run", async () => {
    await expect(
      new LocalCatalog().run("competitor-scan", { project: "  ", description: "a pool" }),
    ).rejects.toThrow("Competitor Scan needs project.");
  });

  /** 66 of the 115 tools upstream have one of these. Demanding it would strand them. */
  it("runs without an optional field, and does not name it as missing", async () => {
    const run = await new LocalCatalog().run("competitor-scan", {
      project: "Quadra",
      description: "a shielded pool",
    });
    expect(run.toolId).toBe("competitor-scan");
  });

  it("runs a tool that takes no inputs", async () => {
    const run = await new LocalCatalog().run(noInputs().id, {});
    expect(run.toolId).toBe(noInputs().id);
    expect(run.output).toContain("[nothing ran]");
  });

  it("says outright that nothing ran, rather than reading like an answer", async () => {
    const run = await new LocalCatalog().run("token-price", { token: "0xabc" });
    expect(run.output.startsWith("[nothing ran]")).toBe(true);
  });

  it("echoes the input back, which is the one thing a stub can prove", async () => {
    const input = { token: "0xabc" };
    const run = await new LocalCatalog().run("token-price", input);
    expect(run.output).toContain(JSON.stringify(input));
  });

  /**
   * The load-bearing assertion of this whole file. A stub that returned `settled`
   * with a txHash would render as a real payment in the CRT panel, and the type
   * system cannot stop it — `Settlement` has to allow `settled` for the real
   * adapter. So the guarantee has to be a test.
   */
  it("never reports a settlement, because nothing was ever charged", async () => {
    const catalog = new LocalCatalog();
    for (const tool of LOCAL_TOOLS) {
      const input = Object.fromEntries(tool.inputs.map((field) => [field.name, "x"]));
      const run = await catalog.run(tool.id, input);
      expect(run.settlement.kind, tool.id).not.toBe("settled");
      expect(run.settlement, tool.id).not.toHaveProperty("txHash");
    }
  });

  it("distinguishes a free tool from an unpaid one", async () => {
    const catalog = new LocalCatalog();
    expect((await catalog.run(free().id, {})).settlement.kind).toBe("free");
    const run = await catalog.run("token-price", { token: "0xabc" });
    expect(run.settlement.kind).toBe("unsettled");
  });

  it("explains why nothing was paid, in words a user can read", async () => {
    const run = await new LocalCatalog().run("token-price", { token: "0xabc" });
    if (run.settlement.kind !== "unsettled") throw new Error("expected unsettled");
    expect(run.settlement.why).toMatch(/nothing was charged/);
  });

  it("names what exists when asked to run a tool that does not", async () => {
    await expect(new LocalCatalog().run("teleport", {})).rejects.toThrow(
      /No tool called "teleport"/,
    );
  });
});

describe("priceOf", () => {
  /**
   * Exercised directly as well as through `quote`, because the free branch turns
   * on an exact `0n`. A tool priced at `1n` must be paid, not rounded to free.
   */
  it("treats one base unit as paid, not as free", () => {
    const price = priceOf({ id: "x", title: "X", summary: "", inputs: [], priceBaseUnits: 1n });
    expect(price.kind).toBe("paid");
  });

  it("treats exactly zero as free", () => {
    const price = priceOf({ id: "x", title: "X", summary: "", inputs: [], priceBaseUnits: 0n });
    expect(price.kind).toBe("free");
  });

  /**
   * 🔴 The stub's price is the checker's OUTPUT, not a struct shaped like one.
   *
   * `toBe` and not `toEqual`, on purpose: the domain must be the very object
   * `config/chain.ts` exports, which is only true if `assertDomain` returned
   * `USDC_DOMAIN` by identity after comparing upstream's `extra` against it. A
   * hand-built `PaymentRequirements` literal in this file would pass a `toEqual`
   * and would prove nothing about production — that is the drift this whole stub
   * exists to make impossible, and it is why `priceOf` assembles upstream's
   * envelope and hands it to `checkRequirements` instead of assembling the result.
   */
  it("produces a price that production's own checker produced", () => {
    const price = priceOf({ id: "x", title: "X", summary: "", inputs: [], priceBaseUnits: 1n });
    if (price.kind !== "paid") throw new Error("expected a paid price");
    expect(price.requirements.domain).toBe(USDC_DOMAIN);
  });

  /**
   * The cap in `requirements.ts` is anchored to the real catalog's maximum
   * (`blue-audit`, $1.00), so every price this stub carries must sit under it. If a
   * future entry is priced past the cap, this fails here rather than at the moment
   * a user is shown a number the signer would refuse.
   */
  it("prices every tool within the cap the checker enforces", () => {
    for (const tool of LOCAL_TOOLS) {
      expect(() => priceOf(tool)).not.toThrow();
    }
  });
});
