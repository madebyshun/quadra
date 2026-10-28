/**
 * Handing a file to the user, which is the one step of a backup that needs a DOM.
 *
 * ── Why this is not in `lib/backup.ts` ────────────────────────────────────────
 * `backup.ts` decides what the bytes are; this decides how they reach a disk. Keeping
 * them apart is what lets the format be tested without a browser and lets this be tested
 * without a pool. It also keeps the interesting file free of the two globals below, so a
 * reader auditing hard rule 4 ("a note's secret never leaves the browser") can see the
 * whole of the format module without a `URL` or a `document` in it.
 *
 * ⚠️ There is no `fetch` here and there must never be one. This module exists precisely
 * because the file has to go to the user's own disk and nowhere else: a Blob is created,
 * clicked, and revoked, all inside this tab. The moment anything here uploads, the
 * product's central claim is false — see the header of `lib/backup.ts`.
 */

/**
 * How long the blob URL stays alive after the click.
 *
 * 🔴 Both ends of this are a real hazard, which is why it is a named constant with a
 * paragraph rather than an inline `0`.
 *
 * Revoking immediately after `click()` is the tidy version and it drops downloads: the
 * click starts a fetch of the blob URL, and a URL revoked in the same task has been
 * observed to cancel it. The failure is the worst kind for this particular file — the
 * user clicks "export", believes they have a backup, and has nothing. So the revoke
 * waits.
 *
 * Never revoking is the other tempting shape, and it is worse. The blob holds every note
 * secret in plaintext, and a live `blob:` URL is an *addressable* copy of it that lives
 * as long as the document. Waiting a few seconds bounds that; forgetting does not.
 */
const REVOKE_AFTER_MS = 4000;

/**
 * Offer `body` to the user as a file named `filename`.
 *
 * Returns nothing. There is deliberately no success signal, because there is no honest
 * one available: whether the file reached the disk is decided by the browser's download
 * UI and by the user, neither of which reports back. A caller that said "backed up ✓"
 * on the strength of this returning would be claiming something it cannot know. The UI
 * says what it actually knows — the file was offered — and tells the user to check it.
 */
export function offerDownload(file: { filename: string; body: string }): void {
  /**
   * `type` matters: without it the browser may hand the file to a viewer instead of the
   * download manager, and a backup that opens in a tab is a backup the user has to think
   * about saving.
   */
  const url = URL.createObjectURL(new Blob([file.body], { type: "application/json" }));

  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  /** Not appended to the document: nothing needs to see it, and nothing should. */
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

/**
 * Read a file the user picked, as text.
 *
 * ── Why `FileReader` and not the one-liner `await file.text()` ────────────────
 * MEASURED, not preferred: jsdom's `Blob` implements exactly `slice`, `size` and `type`.
 * There is no `.text()`, no `.arrayBuffer()`, no `.stream()`, so the one-line version is
 * code no test in this repo can execute — and an untested read is not acceptable on the
 * only path by which a user recovers their money. `new Response(file).text()` was tried
 * too and is worse than unavailable: it resolves to the string `"[object File]"`, a wrong
 * answer with no error, which would have shipped a restore that reliably rejects every
 * real backup. `FileReader` reads correctly here and has the wider browser baseline of the
 * two anyway, so the testable choice is also the more portable one.
 *
 * Refuses an empty file rather than handing `""` to the parser. The parser would reject it
 * too, with "it is not even JSON" — accurate and useless, because what went wrong is
 * upstream of the contents. An empty pick is usually the wrong file or a half-written one,
 * and saying so is what lets the user go and look.
 */
export async function readTextFile(
  file: File,
  /**
   * The reader, injectable for one reason: a file read genuinely fails — the file is moved
   * between picking and reading, a permission is revoked, the disk errors — and that has
   * to arrive as a message the user can act on rather than a promise that never settles.
   * jsdom cannot be made to fail a read of a valid Blob, so without this seam the error
   * branch is unreachable in a test, which is the same as unwritten. Same defaulted-
   * dependency shape as `hash` and `disk` on `LocalShieldedPool`.
   */
  Reader: new () => FileReader = FileReader,
): Promise<string> {
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new Reader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(
        new Error(
          `${file.name} could not be read${reader.error === null ? "" : `: ${reader.error.message}`}. ` +
            `If it is on a removable disk or in a synced folder, copy it somewhere local and try again.`,
        ),
      );
    reader.readAsText(file);
  });

  if (text.trim() === "") {
    throw new Error(`${file.name} is empty. Pick the backup file you exported.`);
  }
  return text;
}
