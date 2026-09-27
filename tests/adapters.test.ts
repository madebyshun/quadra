import { beforeEach, describe, expect, it } from "vitest";
import { adapters, bothDeployed, onchainReady, resolvePool } from "@/adapters";
import { LocalShieldedPool } from "@/adapters/local/pool";
import { LOCAL_MODELS, LocalEnclave } from "@/adapters/local/enclave";
import { LocalCatalog } from "@/adapters/local/catalog";
import { HttpCatalog } from "@/adapters/http/catalog";
import type { Note } from "@/adapters/types";
import { AAPL_BASE } from "@/config/pair";
import { BLUEAGENT } from "@/config/upstream";
import { CONTRACTS, USDC } from "@/config/chain";
import { formatAmount, parseAmount } from "@/lib/amount";

const usdc = { address: USDC.address, symbol: USDC.symbol, decimals: USDC.decimals };
const aaplc = { address: AAPL_BASE.address, symbol: AAPL_BASE.symbol, decimals: AAPL_BASE.decimals };

/** Every test starts from an empty browser. */
let pool: LocalShieldedPool;
beforeEach(() => {
  pool = new LocalShieldedPool();
});

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

describe("LocalShieldedPool: what it refuses to claim", () => {
  it("is not live, and cannot be talked into saying it is", () => {
    expect(pool.isLive).toBe(false);
  });

  it("anchors every fact as local, with a reason the UI can show", async () => {
    const note = await pool.deposit(usdc, 1_000_000n);
    expect(note.anchoring).toEqual({
      kind: "local",
      why: "held in this browser only — the pool is not deployed yet",
    });
  });

  it("produces no txHash anywhere, because the local variant has no such field", async () => {
    const note = await pool.deposit(usdc, 1_000_000n);
    const receipt = await pool.withdraw(note.id, "0x1111111111111111111111111111111111111111");
    for (const anchoring of [note.anchoring, receipt.anchoring]) {
      expect(anchoring.kind).toBe("local");
      expect(anchoring).not.toHaveProperty("txHash");
      expect(anchoring).not.toHaveProperty("block");
    }
  });
});

describe("LocalShieldedPool.deposit", () => {
  it("returns a note holding exactly what was put in", async () => {
    const note = await pool.deposit(usdc, 250_000_000n);
    expect(note.amount).toBe(250_000_000n);
    expect(note.token).toEqual(usdc);
    expect(note.spentAt).toBeNull();
  });

  it("gives the note a secret and a commitment that are not the same value", async () => {
    const note = await pool.deposit(usdc, 1n);
    expect(note.secret).toMatch(/^0x[0-9a-f]{64}$/);
    expect(note.commitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(note.secret).not.toBe(note.commitment);
  });

  it("never issues the same id, commitment or secret twice", async () => {
    const many = await Promise.all(Array.from({ length: 40 }, () => pool.deposit(usdc, 1n)));
    for (const key of ["id", "commitment", "secret"] as const) {
      expect(new Set(many.map((n) => n[key])).size).toBe(many.length);
    }
  });

  it("stamps a parseable creation time", async () => {
    const note = await pool.deposit(usdc, 1n);
    expect(Number.isNaN(Date.parse(note.createdAt))).toBe(false);
  });

  it("refuses zero and negative deposits", async () => {
    await expect(pool.deposit(usdc, 0n)).rejects.toThrow("greater than zero");
    await expect(pool.deposit(usdc, -1n)).rejects.toThrow("greater than zero");
  });

  it("keeps an 8-decimal token and a 6-decimal token apart", async () => {
    const a = await pool.deposit(aaplc, parseAmount("1", aaplc.decimals));
    const u = await pool.deposit(usdc, parseAmount("1", usdc.decimals));
    expect(a.amount).toBe(100_000_000n);
    expect(u.amount).toBe(1_000_000n);
    expect(a.token.decimals).toBe(8);
    expect(u.token.decimals).toBe(6);
  });
});

describe("LocalShieldedPool.notes", () => {
  it("is empty in a fresh browser", async () => {
    expect(await pool.notes()).toEqual([]);
  });

  it("lists newest first", async () => {
    const first = await pool.deposit(usdc, 1n);
    const second = await pool.deposit(usdc, 2n);
    expect((await pool.notes()).map((n) => n.id)).toEqual([second.id, first.id]);
  });

  it("hides spent notes by default and shows them when asked", async () => {
    const note = await pool.deposit(usdc, 1_000_000n);
    await pool.withdraw(note.id, "0x1111111111111111111111111111111111111111");

    expect(await pool.notes()).toEqual([]);
    const all = await pool.notes({ includeSpent: true });
    expect(all).toHaveLength(1);
    expect(all[0]?.spentAt).not.toBeNull();
  });

  it("treats includeSpent: false the same as omitting it", async () => {
    const note = await pool.deposit(usdc, 1_000_000n);
    await pool.withdraw(note.id, "0x1111111111111111111111111111111111111111");
    expect(await pool.notes({ includeSpent: false })).toEqual([]);
  });

  it("hands back a copy, so a caller cannot edit the pool's own list", async () => {
    await pool.deposit(usdc, 1n);
    const listed = await pool.notes();
    listed.length = 0;
    expect(await pool.notes()).toHaveLength(1);
  });
});

describe("LocalShieldedPool.send", () => {
  const to = "0x2222222222222222222222222222222222222222";

  it("spends the note and returns change as a new unspent note", async () => {
    const note = await pool.deposit(usdc, parseAmount("10", 6));
    const receipt = await pool.send(note.id, to, parseAmount("3", 6));

    expect(receipt.summary).toContain("You paid 3 USDC");
    expect(receipt.summary).toContain(to);
    expect(receipt.summary).toContain("The remaining 7 came back as a new note.");

    const unspent = await pool.notes();
    expect(unspent).toHaveLength(1);
    expect(unspent[0]?.amount).toBe(parseAmount("7", 6));
    expect(unspent[0]?.id).not.toBe(note.id);
  });

  it("conserves value: change plus payment equals the original note", async () => {
    const note = await pool.deposit(usdc, parseAmount("10", 6));
    await pool.send(note.id, to, parseAmount("3.5", 6));
    const change = (await pool.notes())[0] as Note;
    expect(change.amount + parseAmount("3.5", 6)).toBe(note.amount);
  });

  it("mints no change note when the whole note is spent", async () => {
    const note = await pool.deposit(usdc, parseAmount("10", 6));
    const receipt = await pool.send(note.id, to, parseAmount("10", 6));
    expect(receipt.summary).not.toContain("came back as a new note");
    expect(await pool.notes()).toEqual([]);
  });

  it("says the pool paid, not the user — that is the product", async () => {
    const note = await pool.deposit(usdc, parseAmount("1", 6));
    const receipt = await pool.send(note.id, to, parseAmount("1", 6));
    expect(receipt.summary).toContain("The pool paid it");
    expect(receipt.summary).toContain("never saw which note it came from");
  });

  it("refuses to overspend, and names both amounts in the token's own decimals", async () => {
    const note = await pool.deposit(aaplc, parseAmount("1.5", 8));
    await expect(pool.send(note.id, to, parseAmount("2", 8))).rejects.toThrow(
      "That note holds 1.5 AAPLc, which is less than 2.",
    );
  });

  it("leaves the note unspent when it refuses", async () => {
    const note = await pool.deposit(usdc, parseAmount("1", 6));
    await expect(pool.send(note.id, to, parseAmount("2", 6))).rejects.toThrow();
    expect((await pool.notes())[0]?.spentAt).toBeNull();
  });

  it("refuses zero and negative sends", async () => {
    const note = await pool.deposit(usdc, parseAmount("1", 6));
    await expect(pool.send(note.id, to, 0n)).rejects.toThrow("greater than zero");
    await expect(pool.send(note.id, to, -1n)).rejects.toThrow("greater than zero");
  });

  it("refuses an id this browser does not hold", async () => {
    await expect(pool.send("0xdeadbeef", to, 1n)).rejects.toThrow(
      "No note with id 0xdeadbeef in this browser.",
    );
  });

  it("refuses to spend the same note twice", async () => {
    const note = await pool.deposit(usdc, parseAmount("10", 6));
    await pool.send(note.id, to, parseAmount("1", 6));
    await expect(pool.send(note.id, to, parseAmount("1", 6))).rejects.toThrow(
      "A note spends once.",
    );
  });
});

describe("LocalShieldedPool.withdraw", () => {
  const to = "0x3333333333333333333333333333333333333333";

  it("spends the whole note and says the amount is now public", async () => {
    const note = await pool.deposit(aaplc, parseAmount("2.5", 8));
    const receipt = await pool.withdraw(note.id, to);

    expect(receipt.summary).toBe(
      `You withdrew 2.5 AAPLc to ${to}. That note is spent and the amount is now public.`,
    );
    expect(await pool.notes()).toEqual([]);
  });

  it("refuses an unknown id", async () => {
    await expect(pool.withdraw("0xnope", to)).rejects.toThrow("No note with id 0xnope");
  });

  it("refuses a note that was already spent", async () => {
    const note = await pool.deposit(usdc, 1n);
    await pool.withdraw(note.id, to);
    await expect(pool.withdraw(note.id, to)).rejects.toThrow("A note spends once.");
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
  it("reports not ready while the pool and verifier are unset", () => {
    expect(CONTRACTS.shieldedPool).toBeNull();
    expect(CONTRACTS.verifier).toBeNull();
    expect(onchainReady()).toBe(false);
  });

  it("needs BOTH the pool and its verifier, not either one", () => {
    const addr = "0x4444444444444444444444444444444444444444";
    expect(bothDeployed(null, null)).toBe(false);
    expect(bothDeployed(addr, null)).toBe(false);
    expect(bothDeployed(null, addr)).toBe(false);
    expect(bothDeployed(addr, addr)).toBe(true);
  });

  it("returns the local pool when nothing is deployed", () => {
    expect(resolvePool(false)).toBeInstanceOf(LocalShieldedPool);
  });

  /**
   * The branch that matters on deploy day. Tested by passing `ready` directly:
   * `onchainReady` closes over the real CONTRACTS, so this path is unreachable
   * by mocking, and would otherwise first run in production.
   */
  it("throws rather than silently serving local state once a pool is deployed", () => {
    expect(() => resolvePool(true)).toThrow(
      "no on-chain ShieldedPool is implemented yet",
    );
  });

  it("builds both adapters, and neither claims to be live", () => {
    const { pool: p, enclave: e } = adapters();
    expect(p).toBeInstanceOf(LocalShieldedPool);
    expect(e).toBeInstanceOf(LocalEnclave);
    expect(p.isLive).toBe(false);
    expect(e.isLive).toBe(false);
  });

  /**
   * The catalog resolves live while the other two do not, by the same rule: return
   * whatever actually exists. There is no deployed pool and no TEE, but the catalog
   * is a free CORS-open GET that answers today — so handing back the stub would be
   * choosing four invented tools over the 115 real ones.
   */
  it("resolves the real catalog, not the offline stub", () => {
    const { catalog } = adapters();
    expect(catalog).toBeInstanceOf(HttpCatalog);
    expect(catalog).not.toBeInstanceOf(LocalCatalog);
  });

  /**
   * Live reads, and still not live: `isLive` is about settlement, and nothing settles.
   * A free run reaching upstream for real does not change that — it returns an answer
   * nobody paid for, which is the opposite of a settlement.
   */
  it("does not let a live read make the catalog claim it settled anything", () => {
    const { catalog } = adapters();
    expect(catalog.isLive).toBe(false);
    expect(catalog.whyNot({ kind: "free", why: "no payment" })).toBeNull();
    expect(
      catalog.whyNot({
        kind: "paid",
        payTo: BLUEAGENT.knownPayTo,
        amountBaseUnits: 10_000n,
        asset: usdc,
        network: "eip155:8453",
      }),
    ).not.toBeNull();
  });

  it("gives each call its own pool, so one page cannot read another's notes", async () => {
    const a = adapters();
    await a.pool.deposit(usdc, 1n);
    expect(await adapters().pool.notes()).toEqual([]);
  });
});
