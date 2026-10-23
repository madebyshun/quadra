import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bigAvatar, dataUrl, FXTWITTER, lookupWords, parseHandle, parseXProfile, pictureData, xProfile } from "@/skills/xprofile";
import { XF } from "./fixtures/x";
import { DOWN, json, net, urls, useNet } from "./net";

useNet();

const HERE = dirname(fileURLToPath(import.meta.url));
const JPG = readFileSync(resolve(HERE, "fixtures/x/avatar-madebyshun.jpg"));
const AVATAR = "https://pbs.twimg.com/profile_images/2107725118764179457/tuu6xt-I_400x400.jpg";

describe("an X handle as typed", () => {
  it("accepts @name, name and an x.com or twitter.com link, and returns the bare handle", () => {
    expect(parseHandle("madebyshun")).toBe("madebyshun");
    expect(parseHandle("  @madebyshun ")).toBe("madebyshun");
    expect(parseHandle("https://x.com/madebyshun")).toBe("madebyshun");
    expect(parseHandle("https://twitter.com/jessepollak/status/1?s=20")).toBe("jessepollak");
    expect(parseHandle("http://www.x.com/a_b")).toBe("a_b");
    expect(parseHandle("https://mobile.twitter.com/dril")).toBe("dril");
  });

  it("refuses what cannot be a handle: empty, too long, other characters, other sites", () => {
    for (const bad of ["", "@", "thishandleisnotreal9", "bad-handle", "name.base.eth", "https://example.com/x"]) {
      expect(() => parseHandle(bad), bad).toThrow("An X handle is 1 to 15 letters, digits or underscores");
    }
  });
});

describe("parseXProfile, on real FxTwitter answers", () => {
  it("reads the owner's profile, with the 400×400 picture", () => {
    expect(parseXProfile(XF.userMadebyshun)).toEqual({
      handle: "madebyshun",
      name: "Shun Tr",
      bio: "building @blueagent_ , http://basecity.space (@blockyonbase)\nturning creative ideas into AI ecosystems",
      followers: 2235,
      avatar: AVATAR,
      joined: new Date("2024-12-19T04:14:27Z"),
    });
    expect(parseXProfile(XF.userJessepollak)).toMatchObject({ name: "jesse.base.eth", followers: 356525 });
  });

  it("tolerates every field but the handle being absent or odd, and is null without one", () => {
    const user = { ...XF.userMadebyshun.user, name: "  ", description: " ", followers: undefined, avatar_url: undefined, joined: "not a date" };
    expect(parseXProfile({ user })).toEqual({ handle: "madebyshun", name: "madebyshun", bio: null, followers: null, avatar: null, joined: null });
    expect(parseXProfile({ user: { screen_name: "x" } })).toMatchObject({ joined: null, bio: null });
    expect(parseXProfile(XF.notfoundA)).toBeNull();
    expect(parseXProfile(null)).toBeNull();
    expect(bigAvatar("https://pbs.twimg.com/a/b_normal.png")).toBe("https://pbs.twimg.com/a/b_400x400.png");
  });
});

describe("xProfile — found, missing, suspended, and unreachable are four different answers", () => {
  it("finds a profile", async () => {
    const calls = net({ get: urls({ [`${FXTWITTER}madebyshun`]: XF.userMadebyshun }) });
    const l = await xProfile("madebyshun");
    expect(l.kind === "found" && l.user.name).toBe("Shun Tr");
    expect(calls.map((c) => c.url)).toEqual([`${FXTWITTER}madebyshun`]);
  });

  it("words a 404 by what FxTwitter said: no such account, or suspended", async () => {
    net({ get: urls({ [`${FXTWITTER}a`]: json(XF.notfoundA, 404), [`${FXTWITTER}elonjet`]: json(XF.suspendedElonjet, 404) }) });
    const missing = await xProfile("a");
    const suspended = await xProfile("elonjet");
    expect(missing).toEqual({ kind: "missing", handle: "a" });
    expect(suspended).toEqual({ kind: "suspended", handle: "elonjet" });
    expect(lookupWords(missing as never)).toBe("FxTwitter found no X account @a. Check the spelling, or try again in a moment.");
    expect(lookupWords(suspended as never)).toBe("@elonjet is suspended on X, so there is no profile to draw.");
  });

  it("never reads a failure of the service as 'no such account'", async () => {
    net({
      get: urls({
        [`${FXTWITTER}down`]: DOWN,
        [`${FXTWITTER}html`]: new Response("<html>", { status: 200 }),
        [`${FXTWITTER}busy`]: json({ code: 500, message: "oops" }, 500),
        [`${FXTWITTER}odd`]: json([], 404),
      }),
    });
    const down = await xProfile("down");
    expect(down).toEqual({ kind: "unreachable", handle: "down", why: "FxTwitter could not be reached." });
    expect(await xProfile("html")).toMatchObject({ kind: "unreachable" });
    const busy = await xProfile("busy");
    expect(busy).toEqual({ kind: "unreachable", handle: "busy", why: "FxTwitter answered 500 without a profile." });
    expect(await xProfile("odd")).toMatchObject({ kind: "unreachable" });
    expect(lookupWords(busy as never)).toBe("X could not be read just now: FxTwitter answered 500 without a profile. Nothing is wrong with @busy — try again.");
  });
});

describe("the picture, as a data: URL", () => {
  it("reads the real avatar; anything else is null", async () => {
    net({
      get: urls({
        [AVATAR]: new Response(new Uint8Array(JPG), { headers: { "content-type": "image/jpeg" } }),
        "https://pbs.twimg.com/gone": new Response("", { status: 404, headers: { "content-type": "image/jpeg" } }),
        "https://pbs.twimg.com/page": new Response("<html>", { headers: { "content-type": "text/html" } }),
        "https://pbs.twimg.com/bare": new Response(new Uint8Array([1])),
        "https://pbs.twimg.com/down": DOWN,
      }),
    });
    expect(await pictureData(AVATAR)).toMatch(/^data:image\/jpeg;base64,\/9j\//);
    for (const u of ["gone", "page", "bare", "down"]) expect(await pictureData(`https://pbs.twimg.com/${u}`), u).toBeNull();
    expect(await pictureData(null)).toBeNull();
  });

  it("says when a blob cannot be read", async () => {
    const real = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (this: FileReader) {
      queueMicrotask(() => this.onerror?.(new ProgressEvent("error") as never));
    };
    try {
      await expect(dataUrl(new Blob(["x"]))).rejects.toThrow("The picture could not be read.");
    } finally {
      FileReader.prototype.readAsDataURL = real;
    }
  });
});
