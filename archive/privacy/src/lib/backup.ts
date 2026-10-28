import type { NoteStore, StoredPool } from "@/adapters/local/store";
import { decodePool } from "@/adapters/local/store";
import { BRAND } from "@/brand";

/**
 * Taking the notes out of this browser, and putting them back.
 *
 * ── Why this file exists at all ───────────────────────────────────────────────
 * `store.ts` made the notes survive a reload, and in doing so it created a hazard
 * that did not exist before: the app now *looks* durable. Clearing site data,
 * closing a private window, or a browser evicting storage under pressure destroys
 * every note, and the notes ARE the money — there is no server-side copy, by
 * design. Before persistence landed nobody could believe otherwise, because
 * nothing survived anything. Now they can, and they would be wrong.
 *
 * So `localStorage` is not a backup. This is the backup.
 *
 * ── The file contains the secrets, in plaintext, and that is not hidden ───────
 * A backup without secrets restores nothing, because the secret is the money. So
 * the exported file is exactly as valuable as the pool it came from, and every
 * name in this module says so rather than implying a safe little settings export.
 *
 * ⚠️ This does NOT weaken hard rule 4 ("a note's secret never leaves the
 * browser"), and the distinction is worth stating because it looks like it might.
 * That rule is about the secret reaching a THIRD PARTY — a server, a URL, a log.
 * A file the user saves to their own disk is the user taking custody of their own
 * money. What would violate the rule is mailing it, uploading it, or putting it
 * in a query string. Hence: nothing here touches `fetch`, nothing here runs
 * without an explicit click, and the download is a Blob that never leaves the
 * machine.
 *
 * 🔴 The file is NOT encrypted, and no code here pretends it is. A passphrase
 * wrapper (WebCrypto PBKDF2 + AES-GCM, no new dependency) is the obvious next
 * step and is deliberately not stubbed in: a half-built encryption path is worse
 * than a plainly-labelled plaintext one, because the label is what makes the user
 * careful. Recorded as an open decision in TASKS.md rather than sketched here.
 */

/**
 * Tagged so a file can say what it is before anything tries to read its contents.
 *
 * Separate from `STORE_VERSION` on purpose: that number describes the shape of the
 * pool, this one describes the shape of the wrapper around it. They will move for
 * different reasons, and a file that got the wrapper wrong deserves a different
 * sentence than one whose pool is from a future build.
 *
 * 🔴 A frozen literal, NOT `` `${BRAND.slug}.pool.backup.v1` ``, and the difference
 * is data loss. This string is written into files that are already on people's
 * disks, and `importBackup` refuses anything that does not match it exactly. Derive
 * it from the brand and renaming the product silently turns every backup exported
 * before the rename into "that file is not a backup" — at the one moment the user
 * is relying on it, which is after they have lost the original. The brand may be
 * renamed; a format identifier in data that already exists may not. `STORE_KEY` and
 * the domain tag in `lib/hash.ts` are frozen for the same reason; see `brand.ts`.
 */
export const BACKUP_FORMAT = "quadra.pool.backup.v1";

export type Backup = {
  format: string;
  /** When the file was written. Display only — nothing decides anything on it. */
  exportedAt: string;
  pool: StoredPool;
};

/**
 * A filename that tells two backups apart and says nothing else.
 *
 * Deliberately carries no amount, no token symbol and no address. A filename is
 * the one part of this that shows up in a downloads list, a screenshot, a shared
 * folder, or a backup of the backup — all places the pool's contents should not
 * be legible without opening anything.
 *
 * Derived from the brand, unlike `BACKUP_FORMAT` directly above, and the test for
 * which way round to go is "does anything read this back?". Nothing does — the
 * filename is a label for a human, and `importBackup` decides what a file is from
 * its contents. So a rename can safely change the name new exports carry, while
 * files already written keep importing.
 */
export function backupFilename(now: Date): string {
  return `${BRAND.slug}-pool-backup-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * The exact bytes of a backup file, plus the name to offer it under.
 *
 * Refuses when there is nothing to back up, rather than producing a valid file
 * with no notes in it. That file would be indistinguishable from a real backup —
 * same name, same shape, opens fine — and the user would find out it was empty at
 * the only moment it mattered. An error now is the kinder failure.
 */
export async function exportBackup(
  store: NoteStore,
  now: Date = new Date(),
): Promise<{ filename: string; body: string }> {
  const pool = await store.load();
  if (pool === null || pool.notes.length === 0) {
    throw new Error("There is nothing to back up yet. Put money in first, then export.");
  }

  const backup: Backup = { format: BACKUP_FORMAT, exportedAt: now.toISOString(), pool };
  return {
    filename: backupFilename(now),
    /** Indented because a human may well open this file to check it is real. */
    body: JSON.stringify(backup, null, 2),
  };
}

/**
 * Read a backup and make it this browser's pool.
 *
 * Three refusals, in this order, and the order is the design:
 *
 * 1. **Not a backup file** — checked before the contents, so a user who picked the
 *    wrong file gets told that, instead of a confusing complaint about a version.
 * 2. **This browser already holds notes** — refused rather than merged or replaced.
 *    Merging is not a smaller version of restoring: two pools both number their
 *    leaves from zero, so the result has duplicate indices and a root belonging to
 *    nobody, which `decodePool` would then refuse forever. Replacing silently
 *    destroys whatever was already here. Neither is a thing to do without being
 *    asked, so this says what to do instead.
 * 3. **The pool inside does not decode** — and it is checked with `decodePool`,
 *    the same function the pool itself loads through.
 *
 * 🔴 That third point is the one that would be easy to get wrong. If this
 * validated with its own looser check, an import could report success and leave
 * behind a pool that throws on open — the user would believe they had restored
 * their money and find out otherwise on the next page load, with the file possibly
 * already deleted. Any future validation here must run through the loader, not
 * alongside it.
 */
export async function importBackup(store: NoteStore, text: string): Promise<{ notes: number }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`That file is not a ${BRAND.name} backup — it is not even JSON.`);
  }

  const backup = parsed as Partial<Backup>;
  if (backup === null || typeof backup !== "object" || backup.format !== BACKUP_FORMAT) {
    throw new Error(
      `That file is not a ${BRAND.name} backup. A backup starts with "format": "${BACKUP_FORMAT}".`,
    );
  }

  const existing = await store.load();
  if (existing !== null && existing.notes.length > 0) {
    throw new Error(
      "This browser already holds a balance, and a restore would have to either merge or " +
        "overwrite it. Neither is safe to do for you. Export what is here first, then " +
        "clear this browser's data, then restore.",
    );
  }

  /** Validated with the loader, never beside it — see the note above. */
  const decoded = decodePool(backup.pool ?? null);
  if (decoded === null) {
    throw new Error("That backup has no pool in it.");
  }

  await store.save(backup.pool as StoredPool);
  return { notes: decoded.notes.length };
}
