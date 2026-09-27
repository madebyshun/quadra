import { describe, expect, it } from "vitest";
import { LOCAL_TOOLS, LocalCatalog, priceOf } from "@/adapters/local/catalog";
import type { Catalog } from "@/adapters/types";
import { BLUEAGENT } from "@/config/upstream";
import { USDC } from "@/config/chain";

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
    expect(quote.price.amountBaseUnits).toBe(tool.priceBaseUnits);
    expect(quote.price.asset).toEqual(USDC);
    expect(quote.price.network).toBe("eip155:8453");
  });

  /**
   * The stub must not contain an invented address. This pins it to the one
   * BLUEAGENT publishes, so a typo in either place is a failing test rather than
   * a payment to a wallet nobody controls.
   */
  it("pays the address upstream actually publishes, not a made-up one", async () => {
    const quote = await new LocalCatalog().quote(paid().id);
    if (quote.price.kind !== "paid") throw new Error("expected a paid quote");
    expect(quote.price.payTo).toBe(BLUEAGENT.knownPayTo);
  });

  it("calls a free tool free, rather than pricing it at zero", async () => {
    const quote = await new LocalCatalog().quote(free().id);
    expect(quote.price.kind).toBe("free");
    expect(quote.price).not.toHaveProperty("amountBaseUnits");
    expect(quote.price).not.toHaveProperty("payTo");
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
});
