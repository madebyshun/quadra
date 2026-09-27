/**
 * Taking the notes out and putting them back.
 *
 * ── What these tests are actually defending ──────────────────────────────────
 * Every failure mode here has the same shape: the user believes their money is
 * safe when it is not. A file that looks like a backup and holds nothing. An
 * import that reports success and leaves a pool that cannot open. A restore that
 * silently merges two pools into a tree belonging to nobody. None of those throw
 * on their own — they all look like success at the moment they happen and only
 * become visible at the one moment the user is relying on them.
 *
 * So the round-trip test is the least interesting one in this file. The refusals
 * are the product.
 */

import { describe, expect, it } from "vitest";
import { LocalShieldedPool } from "@/adapters/local/pool";
import { MemoryNoteStore, STORE_VERSION } from "@/adapters/local/store";
import type { NoteStore, StoredPool } from "@/adapters/local/store";
import { BACKUP_FORMAT, backupFilename, exportBackup, importBackup } from "@/lib/backup";
import type { Backup } from "@/lib/backup";
import { parseAmount } from "@/lib/amount";
import { USDC } from "@/config/chain";
import { standInHash } from "@/lib/hash";

const usdc = { address: USDC.address, symbol: USDC.symbol, decimals: USDC.decimals };
const to = "0x7777777777777777777777777777777777777777";

/** A disk with `count` notes on it, written by a real pool. */
async function seeded(count: number): Promise<MemoryNoteStore> {
  const disk = new MemoryNoteStore();
  const pool = new LocalShieldedPool(standInHash, disk);
  for (let i = 1; i <= count; i++) await pool.deposit(usdc, parseAmount(String(i), 6));
  return disk;
}

async function bodyOf(disk: NoteStore): Promise<Backup> {
  return JSON.parse((await exportBackup(disk)).body) as Backup;
}

describe("backupFilename", () => {
  it("names the file by date, so two backups are tellable apart", () => {
    expect(backupFilename(new Date("2026-09-28T11:22:33.000Z"))).toBe(
      "quadra-pool-backup-2026-09-28.json",
    );
  });

  /**
   * A filename shows up in a downloads list, a screenshot, and a shared folder —
   * every place the pool's contents should not be legible without opening anything.
   *
   * The date is removed before asserting rather than allowed for in the pattern.
   * A naive "no run of four or more digits" fails on the year, and loosening the
   * pattern to let the year through would also let an amount through. Taking the
   * one intended number out first leaves an assertion that says what it means:
   * whatever else is in this name, it is not data.
   */
  it("says nothing about what is inside: no amount, no token, no address", async () => {
    const name = backupFilename(new Date("2026-09-28T00:00:00.000Z"));
    expect(name).toContain("2026-09-28");
    expect(name.replace("2026-09-28", "")).not.toMatch(/usdc|aapl|0x|[0-9]/i);
  });
});

describe("exportBackup", () => {
  it("writes a tagged file with the pool inside it", async () => {
    const backup = await bodyOf(await seeded(2));
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.pool.version).toBe(STORE_VERSION);
    expect(backup.pool.notes).toHaveLength(2);
  });

  it("stamps when it was written", async () => {
    const at = new Date("2026-09-28T11:22:33.000Z");
    const { filename, body } = await exportBackup(await seeded(1), at);
    expect(filename).toBe("quadra-pool-backup-2026-09-28.json");
    expect((JSON.parse(body) as Backup).exportedAt).toBe("2026-09-28T11:22:33.000Z");
  });

  /**
   * The file IS the money, so it has to carry the secrets — a backup that cannot
   * restore is not a backup. Asserted explicitly rather than left implied, because
   * an over-zealous later redaction would produce a file that passes every other
   * test in here and restores nothing.
   */
  it("carries the secrets, because a backup without them restores nothing", async () => {
    const disk = await seeded(1);
    const saved = (await disk.load()) as StoredPool;
    const backup = await bodyOf(disk);
    expect(backup.pool.notes[0]?.secret).toBe(saved.notes[0]?.secret);
    expect(backup.pool.notes[0]?.secret).not.toBe("");
  });

  /**
   * Inherited from `store.ts` rather than re-decided here, and worth pinning: a
   * `scheme` tag read back off disk is a claim, not a derivation (hard rule 10).
   * The backup must not be the place it sneaks back in.
   */
  it("carries no commitment and no scheme tag, so neither can be forged into it", async () => {
    const { body } = await exportBackup(await seeded(2));
    expect(body).not.toContain("scheme");
    expect(body).not.toContain("commitment");
    expect(body).not.toContain("stand-in");
  });

  it("keeps the nullifier set, so a restored pool still refuses a spent note", async () => {
    const disk = new MemoryNoteStore();
    const pool = new LocalShieldedPool(standInHash, disk);
    const note = await pool.deposit(usdc, parseAmount("5", 6));
    await pool.withdraw(note.id, to);

    const backup = await bodyOf(disk);
    expect(backup.pool.nullifiers).toHaveLength(1);
  });

  /**
   * 🔴 The refusal that matters most in this file.
   *
   * An empty pool exports a perfectly valid file: right name, right shape, opens
   * fine, restores nothing. It is indistinguishable from a real backup at every
   * moment except the one where the user needs it. Erroring now is the kinder
   * failure by a wide margin.
   */
  it("refuses to write a file with no notes in it", async () => {
    await expect(exportBackup(new MemoryNoteStore())).rejects.toThrow("nothing to back up yet");
  });

  it("refuses an empty pool even once it has a saved record", async () => {
    const disk = new MemoryNoteStore();
    await disk.save({ version: STORE_VERSION, notes: [], nullifiers: [] });
    await expect(exportBackup(disk)).rejects.toThrow("nothing to back up yet");
  });
});

describe("importBackup", () => {
  it("restores the notes, and reports how many", async () => {
    const { body } = await exportBackup(await seeded(3));
    const fresh = new MemoryNoteStore();

    expect(await importBackup(fresh, body)).toEqual({ notes: 3 });
    expect(await new LocalShieldedPool(standInHash, fresh).notes()).toHaveLength(3);
  });

  /**
   * The whole point, stated as one assertion: the restored pool computes the same
   * root. Same root means the same tree, which means every witness the restored
   * pool serves is the witness the original would have served.
   */
  it("restores a pool that agrees on the root, note for note", async () => {
    const disk = await seeded(4);
    const before = await new LocalShieldedPool(standInHash, disk).root();
    const { body } = await exportBackup(disk);

    const fresh = new MemoryNoteStore();
    await importBackup(fresh, body);
    const after = await new LocalShieldedPool(standInHash, fresh).root();
    expect(after.value).toBe(before.value);
  });

  it("restores the nullifier set, so a note spent before the export stays spent", async () => {
    const disk = new MemoryNoteStore();
    const pool = new LocalShieldedPool(standInHash, disk);
    const note = await pool.deposit(usdc, parseAmount("5", 6));
    await pool.send(note.id, to, parseAmount("2", 6));
    const { body } = await exportBackup(disk);

    const fresh = new MemoryNoteStore();
    await importBackup(fresh, body);
    const restored = new LocalShieldedPool(standInHash, fresh);
    await expect(restored.withdraw(note.id, to)).rejects.toThrow("A note spends once.");
    /** And the change note came back spendable, so the refusal is targeted. */
    expect(await restored.notes()).toHaveLength(1);
  });

  it("refuses a file that is not JSON at all", async () => {
    await expect(importBackup(new MemoryNoteStore(), "not a file")).rejects.toThrow(
      "not even JSON",
    );
  });

  /**
   * Checked before the contents, so someone who picked the wrong file in the
   * dialog is told exactly that — instead of a confusing complaint about a version
   * number, which is what a contents-first order would produce.
   */
  it("refuses JSON that is not a backup, naming what a backup starts with", async () => {
    for (const wrong of ['{"hello":true}', "[]", "null", '"a string"', "42"]) {
      await expect(importBackup(new MemoryNoteStore(), wrong)).rejects.toThrow(
        'not a Quadra backup. A backup starts with "format"',
      );
    }
  });

  it("refuses a backup written by a format it does not know", async () => {
    const backup = await bodyOf(await seeded(1));
    await expect(
      importBackup(new MemoryNoteStore(), JSON.stringify({ ...backup, format: "quadra.v99" })),
    ).rejects.toThrow("not a Quadra backup");
  });

  /**
   * 🔴 Not merged, not overwritten, refused.
   *
   * Merging is not a gentler restore: both pools number their leaves from zero, so
   * the result has duplicate indices and a root belonging to nobody — which
   * `decodePool` would then refuse on every subsequent load, permanently. And
   * overwriting silently destroys whatever was already in this browser. Neither is
   * a decision to take on the user's behalf.
   */
  it("refuses to restore into a browser that already holds notes", async () => {
    const { body } = await exportBackup(await seeded(1));
    const occupied = await seeded(2);

    await expect(importBackup(occupied, body)).rejects.toThrow("already holds notes");
    /** And it did not half-apply: what was there is untouched. */
    expect(((await occupied.load()) as StoredPool).notes).toHaveLength(2);
  });

  /**
   * The mirror of the case above, and it must NOT refuse: a browser whose notes
   * have all been spent holds a record with an empty `notes` array, and that user
   * has the most reason of anyone to be restoring something.
   */
  it("restores over a pool whose notes are all gone", async () => {
    const { body } = await exportBackup(await seeded(2));
    const emptied = new MemoryNoteStore();
    await emptied.save({ version: STORE_VERSION, notes: [], nullifiers: [] });

    expect(await importBackup(emptied, body)).toEqual({ notes: 2 });
  });

  it("refuses a backup with no pool in it", async () => {
    const at = { format: BACKUP_FORMAT, exportedAt: new Date().toISOString() };
    await expect(importBackup(new MemoryNoteStore(), JSON.stringify(at))).rejects.toThrow(
      "no pool in it",
    );
  });

  /**
   * 🔴 The refusal that is easiest to get subtly wrong.
   *
   * `importBackup` validates through `decodePool` — the same function the pool
   * loads with. If it had its own looser check, a damaged file could import
   * "successfully" and leave behind a pool that throws on open: the user is told
   * they restored their money, deletes the file, and discovers otherwise on the
   * next page load. The assertion below is that a file the LOADER would reject is
   * rejected at IMPORT time, which is the only ordering that cannot strand anyone.
   */
  it("rejects at import anything the loader would reject at open", async () => {
    const backup = await bodyOf(await seeded(2));
    const gapped = {
      ...backup,
      pool: {
        ...backup.pool,
        notes: backup.pool.notes.map((n) => (n.leafIndex === 1 ? { ...n, leafIndex: 5 } : n)),
      },
    };

    const fresh = new MemoryNoteStore();
    await expect(importBackup(fresh, JSON.stringify(gapped))).rejects.toThrow("jumps from leaf");
    /** And nothing was written, so the browser is still openable. */
    expect(await fresh.load()).toBeNull();
  });

  it("rejects a pool from a future build at import rather than at open", async () => {
    const backup = await bodyOf(await seeded(1));
    const future = { ...backup, pool: { ...backup.pool, version: STORE_VERSION + 1 } };
    await expect(importBackup(new MemoryNoteStore(), JSON.stringify(future))).rejects.toThrow(
      "and this build reads version",
    );
  });

  /** A write that the browser refuses has to reach the caller, not be swallowed. */
  it("surfaces a disk that refuses the write", async () => {
    const { body } = await exportBackup(await seeded(1));
    const failing: NoteStore = {
      load: async () => null,
      save: async () => {
        throw new Error("QuotaExceededError");
      },
    };
    await expect(importBackup(failing, body)).rejects.toThrow("QuotaExceededError");
  });
});

describe("export and import are each other's inverse", () => {
  /**
   * Asserted on the bytes, not on the object: a round-trip that compares decoded
   * pools would pass even if the encoder quietly dropped a field the decoder
   * happens to default. The file is what the user keeps, so the file is what has
   * to survive the trip.
   */
  it("a restored browser exports a byte-identical pool", async () => {
    const original = await seeded(3);
    const first = await exportBackup(original, new Date("2026-09-28T00:00:00.000Z"));

    const fresh = new MemoryNoteStore();
    await importBackup(fresh, first.body);
    const second = await exportBackup(fresh, new Date("2026-09-28T00:00:00.000Z"));

    expect(second.body).toBe(first.body);
  });

  it("survives two trips, so nothing accumulates or drifts", async () => {
    const { body } = await exportBackup(await seeded(2), new Date("2026-09-28T00:00:00.000Z"));
    const once = new MemoryNoteStore();
    await importBackup(once, body);
    const twice = new MemoryNoteStore();
    await importBackup(twice, (await exportBackup(once, new Date("2026-09-28T00:00:00.000Z"))).body);

    expect((await exportBackup(twice, new Date("2026-09-28T00:00:00.000Z"))).body).toBe(body);
  });
});
