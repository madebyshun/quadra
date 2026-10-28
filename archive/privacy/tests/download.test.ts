import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offerDownload, readTextFile } from "@/lib/download";

/**
 * jsdom implements `Blob` and `document`, but not `URL.createObjectURL` — it is one of the
 * handful of APIs it leaves undefined. So these are assigned rather than stubbed through
 * `vi.stubGlobal`: replacing the whole `URL` global would take `new URL()` with it, which
 * jsdom needs internally, and `vi.unstubAllGlobals` in `tests/setup.ts` would not restore
 * a property that was never there to begin with. Saved and deleted by hand instead.
 */
const created: string[] = [];
const revoked: string[] = [];
let blobs: Blob[] = [];

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  blobs = [];
  vi.useFakeTimers();

  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b) => {
    blobs.push(b);
    const url = `blob:quadra/${created.length}`;
    created.push(url);
    return url;
  };
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (u) => {
    revoked.push(u);
  };
});

afterEach(() => {
  vi.useRealTimers();
  delete (URL as unknown as Record<string, unknown>).createObjectURL;
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
});

const file = { filename: "quadra-pool-backup-2026-09-28.json", body: '{"format":"x"}' };

/**
 * Read a jsdom Blob, which cannot be done with `blob.text()` — see the note on
 * `readTextFile`. The same reason the source uses a `FileReader` applies to the test.
 */
function blobText(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(b);
  });
}

describe("offerDownload", () => {
  it("clicks an anchor carrying the filename and the blob", () => {
    const clicks: { download: string; href: string }[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag as "a");
      if (tag === "a") {
        (el as HTMLAnchorElement).click = () => {
          const a = el as HTMLAnchorElement;
          clicks.push({ download: a.download, href: a.href });
        };
      }
      return el;
    });

    offerDownload(file);

    expect(clicks).toEqual([{ download: file.filename, href: created[0] }]);
  });

  it("puts the exact bytes in the blob, as JSON", async () => {
    /** Real timers: `FileReader` in `blobText` resolves on a task a fake clock holds. */
    vi.useRealTimers();
    offerDownload(file);
    expect(blobs).toHaveLength(1);
    expect((blobs[0] as Blob).type).toBe("application/json");
    expect(await blobText(blobs[0] as Blob)).toBe(file.body);
  });

  /**
   * 🔴 The two halves of the `REVOKE_AFTER_MS` argument, as two assertions.
   *
   * Not revoking synchronously is what stops the download being cancelled mid-click; the
   * failure that guards against is silent — the user believes they exported and did not.
   * Revoking eventually is what stops a `blob:` URL holding every note secret in plaintext
   * for the life of the document. A test for one without the other would pass on a version
   * with the bug the other one is about.
   */
  it("does not revoke the url in the same task as the click", () => {
    offerDownload(file);
    expect(revoked).toEqual([]);
  });

  it("revokes the url once the download has had time to start", () => {
    offerDownload(file);
    vi.advanceTimersByTime(10_000);
    expect(revoked).toEqual([created[0]]);
  });

  it("gives each export its own url and revokes both", () => {
    offerDownload(file);
    offerDownload({ ...file, filename: "second.json" });
    vi.advanceTimersByTime(10_000);

    expect(created).toHaveLength(2);
    expect(new Set(created).size).toBe(2);
    expect(revoked.sort()).toEqual([...created].sort());
  });

  /**
   * Hard rule 4, asserted rather than trusted. The backup is plaintext secrets, so the one
   * thing this module must never grow is a network call — and a stubbed-throwing `fetch` is
   * already installed for every test by `tests/setup.ts`, which would turn any request into
   * a failure here. This states the intent so the next reader sees it as a requirement.
   */
  it("sends nothing anywhere", () => {
    expect(() => offerDownload(file)).not.toThrow();
  });
});

describe("readTextFile", () => {
  /**
   * `FileReader` resolves on a real task, which a fake clock never advances — with fake
   * timers installed every test in here hangs to the vitest timeout instead of failing.
   * Only `offerDownload` needs the fake clock, so this block gives it back.
   */
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("reads the text back out", async () => {
    const f = new File(['{"format":"quadra.pool.backup.v1"}'], "backup.json", {
      type: "application/json",
    });
    expect(await readTextFile(f)).toBe('{"format":"quadra.pool.backup.v1"}');
  });

  /**
   * Named in the message, because "the file is empty" about a file the user can see in
   * their downloads folder is the kind of error that gets read as a bug in the app.
   */
  it("refuses an empty file by name instead of passing it to the parser", async () => {
    const f = new File([""], "quadra-pool-backup-2026-09-28.json");
    await expect(readTextFile(f)).rejects.toThrow(
      "quadra-pool-backup-2026-09-28.json is empty. Pick the backup file you exported.",
    );
  });

  it("refuses a file that is only whitespace", async () => {
    await expect(readTextFile(new File(["  \n\t "], "blank.json"))).rejects.toThrow("is empty");
  });

  /** Not trimmed on the way through: the parser is entitled to the bytes as written. */
  it("hands the contents over unchanged, padding and all", async () => {
    expect(await readTextFile(new File(['  {"a":1}  '], "padded.json"))).toBe('  {"a":1}  ');
  });

  /**
   * A reader that fails, which is the branch the injectable `Reader` exists for.
   *
   * 🔴 The assertion that matters is not the wording, it is that the promise **settles**.
   * A `FileReader` whose `onerror` were left unset simply never resolves: the panel's
   * spinner stays up, no message appears, and the user is looking at a restore that is
   * neither working nor failing. That is the worst outcome on this path, because the
   * obvious next move is to assume the app is broken and clear site data.
   */
  function failingReader(error: DOMException | null): new () => FileReader {
    return class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result: string | null = null;
      error = error;
      readAsText(): void {
        setTimeout(() => this.onerror?.(), 0);
      }
    } as unknown as new () => FileReader;
  }

  it("rejects with something readable when the read itself fails", async () => {
    await expect(
      readTextFile(new File(["x"], "on-a-usb-stick.json"), failingReader(new DOMException("NotReadableError"))),
    ).rejects.toThrow("on-a-usb-stick.json could not be read: NotReadableError");
  });

  /** Some browsers leave `error` null. The message still has to name the file. */
  it("still names the file when the reader offers no reason", async () => {
    await expect(readTextFile(new File(["x"], "mystery.json"), failingReader(null))).rejects.toThrow(
      "mystery.json could not be read. If it is on a removable disk",
    );
  });
});
