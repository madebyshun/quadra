import { isObj, numOf, objAt, strOf } from "@/skills/json";

/**
 * An X (Twitter) profile, read through FxTwitter's public API — the Base card's source (owner,
 * 2026-10-21: "the Base card is made from an X handle, not a wallet"). MEASURED 2026-10-21:
 * `GET https://api.fxtwitter.com/<handle>` needs no key and answers `access-control-allow-origin: *`;
 * a profile is `{code: 200, user: {…}}`, an unknown handle `404 {"message": "User not found"}`, a
 * suspended one `404 {"reason": "suspended"}`, and a path that is not a handle a 302 to GitHub (which
 * a browser cannot follow across origins). The captures are in tests/fixtures/x/.
 *
 * 🔴 MEASURED the same day: `jack` answered "User not found" once and its profile a second later, so
 * "not found" is worded as what FxTwitter SAID, never as a fact about X — and a failure of the service
 * is "could not be reached", never "no such account".
 *
 * The handle goes to api.fxtwitter.com and nowhere else; the avatar is read from pbs.twimg.com.
 */

export const FXTWITTER = "https://api.fxtwitter.com/";

export type XUser = {
  /** as X spells it */
  readonly handle: string;
  /** the display name, or the handle when there is none */
  readonly name: string;
  readonly bio: string | null;
  readonly followers: number | null;
  /** the 400×400 picture */
  readonly avatar: string | null;
  readonly joined: Date | null;
};

export type XLookup =
  | { readonly kind: "found"; readonly user: XUser }
  | { readonly kind: "missing"; readonly handle: string }
  | { readonly kind: "suspended"; readonly handle: string }
  | { readonly kind: "unreachable"; readonly handle: string; readonly why: string };

/** A handle as typed — "@name", "name", or an x.com / twitter.com link — to the bare handle; anything else throws. */
export function parseHandle(text: string): string {
  const t = text.trim().replace(/^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(t)) throw new Error("An X handle is 1 to 15 letters, digits or underscores — like @base.");
  return t;
}

/** The full-size picture: X's `_normal` (48×48) becomes `_400x400`. */
export const bigAvatar = (url: string) => url.replace(/_normal(\.[a-z]+)$/i, "_400x400$1");

/** A FxTwitter answer to a user, or `null` when it carries none. Tolerates any field being absent. */
export function parseXProfile(body: unknown): XUser | null {
  const u = objAt(body, "user");
  const handle = strOf(u.screen_name);
  if (handle === null) return null;
  const joined = strOf(u.joined);
  const when = joined === null ? null : new Date(joined);
  const avatar = strOf(u.avatar_url);
  const bio = strOf(u.description)?.trim() || null;
  return {
    handle,
    name: strOf(u.name)?.trim() || handle,
    bio,
    followers: numOf(u.followers),
    avatar: avatar === null ? null : bigAvatar(avatar),
    joined: when === null || Number.isNaN(when.getTime()) ? null : when,
  };
}

export async function xProfile(handle: string): Promise<XLookup> {
  let answer: Response;
  let body: unknown;
  try {
    answer = await fetch(FXTWITTER + encodeURIComponent(handle));
    body = await answer.json();
  } catch {
    return { kind: "unreachable", handle, why: "FxTwitter could not be reached." };
  }
  if (answer.status === 404 && isObj(body)) {
    return strOf(body.reason) === "suspended" ? { kind: "suspended", handle } : { kind: "missing", handle };
  }
  const user = answer.ok ? parseXProfile(body) : null;
  if (user === null) return { kind: "unreachable", handle, why: `FxTwitter answered ${answer.status} without a profile.` };
  return { kind: "found", user };
}

/** What a lookup that found nobody says — the card wizard prints it. */
export function lookupWords(l: Exclude<XLookup, { kind: "found" }>): string {
  if (l.kind === "missing") return `FxTwitter found no X account @${l.handle}. Check the spelling, or try again in a moment.`;
  if (l.kind === "suspended") return `@${l.handle} is suspended on X, so there is no profile to draw.`;
  return `X could not be read just now: ${l.why} Nothing is wrong with @${l.handle} — try again.`;
}

/** A picture URL as a `data:` URL, so drawing it keeps the canvas untainted; any failure is `null`. */
export async function pictureData(url: string | null): Promise<string | null> {
  if (url === null) return null;
  try {
    const answer = await fetch(url);
    const type = answer.headers.get("content-type") ?? "";
    if (!answer.ok || !type.startsWith("image/")) return null;
    return await dataUrl(new Blob([await answer.arrayBuffer()], { type }));
  } catch {
    return null;
  }
}

/** A file or blob as a `data:` URL, read in the page — nothing is uploaded anywhere. */
export function dataUrl(blob: Blob): Promise<string> {
  return new Promise((done, fail) => {
    const reader = new FileReader();
    reader.onload = () => done(String(reader.result));
    reader.onerror = () => fail(new Error("The picture could not be read."));
    reader.readAsDataURL(blob);
  });
}
