import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { BRAND } from "@/brand";
import { OpenWindowProvider } from "@/features/openWindow";
import { CardPanel, CardSvg, CardViewer, cellFor, drawCard, factLine, PAINT, PIXEL_FONT, pixelsOf, shareUrl, titleLines, wrap } from "@/features/panels/BaseCard";
import { parseCommand } from "@/features/commands";
import { portrait, portraitOf, PIXELS } from "@/lib/cardArt";
import {
  cardWords,
  clip,
  compact,
  FAMILIES,
  familiesOf,
  fragments,
  PLAIN_QUOTES,
  PLAIN_TITLES,
  seeded,
  ships,
  TIER_QUOTES,
  TIER_TITLES,
  type WordFacts,
} from "@/lib/cardWords";
import { FXTWITTER, parseXProfile, type XUser } from "@/skills/xprofile";
import { XF } from "./fixtures/x";
import { json, net, urls, useNet } from "./net";

useNet();

const NOW = new Date("2026-10-21T00:00:00Z");
const SHUN = parseXProfile(XF.userMadebyshun)!;
const JESSE = parseXProfile(XF.userJessepollak)!;
const DRIL = parseXProfile(XF.userDril)!;
const BARE: XUser = { handle: "nobody_", name: "nobody_", bio: null, followers: null, avatar: null, joined: null };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the card's words — read from the bio, never invented", () => {
  it("is the same for the same handle (any case) and roll, and different across rolls", () => {
    expect(cardWords(SHUN, 0, NOW)).toEqual(cardWords({ ...SHUN, handle: "MadeByShun" }, 0, NOW));
    const rolls = new Set(Array.from({ length: 16 }, (_, r) => cardWords(SHUN, r, NOW).title));
    expect(rolls.size).toBeGreaterThan(3);
    const a = seeded("x");
    const b = seeded("x");
    expect([a(), a()]).toEqual([b(), b()]);
  });

  it("finds the families a real bio names, and the shipped sticker only for a builder", () => {
    expect(familiesOf(SHUN.bio).map((f) => f.id)).toEqual(["builder", "ai", "art"]);
    expect(familiesOf(JESSE.bio).map((f) => f.id)).toEqual(["builder", "ai", "base"]);
    expect(familiesOf(DRIL.bio)).toEqual([]);
    expect(familiesOf(null)).toEqual([]);
    expect(ships(SHUN.bio)).toBe(true);
    expect(ships(DRIL.bio)).toBe(false);
    expect(ships(null)).toBe(false);
  });

  it("titles a bio from its families, and riffs on a quoted fragment of it — 'AI ECOSYSTEM FARMER' among them", () => {
    const titles = new Set(FAMILIES.filter((f) => ["builder", "ai", "art"].includes(f.id)).flatMap((f) => f.titles));
    const seen = new Set<string>();
    const quotes = new Set<string>();
    for (let roll = 0; roll < 60; roll++) {
      const w = cardWords(SHUN, roll, NOW);
      expect(titles.has(w.title), w.title).toBe(true);
      expect(w.quote).toMatch(/^“(building @blueagent_|turning creative ideas into AI ecosystems)/);
      expect(w.colours).toHaveLength(w.title.length);
      expect(w.tilt).toBeLessThanOrEqual(-2);
      expect(w.tilt).toBeGreaterThanOrEqual(-7);
      seen.add(w.title);
      quotes.add(w.quote);
    }
    expect(seen).toContain("AI ECOSYSTEM FARMER");
    expect(quotes).toContain("“turning creative ideas into AI ecosystems” — which sounds like a cottage industry run entirely out of one very busy GPU.");
  });

  it("cuts a bio into clean fragments: no links, no salt, nothing empty", () => {
    expect(fragments(SHUN.bio)).toEqual(["building @blueagent_", "turning creative ideas into AI ecosystems"]);
    expect(fragments(JESSE.bio)).toEqual(["@base builder #001", "send your agent to get building"]);
    expect(fragments(DRIL.bio)).toEqual([]);
    expect(fragments("gm. I am jesse.base.eth! see foo.xyz/x​ ok")).toEqual(["gm.", "I am jesse.base.eth!", "see ok"]);
    expect(fragments(null)).toEqual([]);
    expect(clip("short")).toBe("short");
    expect(clip("a".repeat(70))).toBe(`${"a".repeat(60)}…`);
    expect(clip("one two three, four five", 16)).toBe("one two three…");
  });

  it("with no usable bio, speaks from the followers and the account's age; with nothing, from a plain list", () => {
    for (let roll = 0; roll < 20; roll++) {
      const d = cardWords(DRIL, roll, NOW);
      expect(["MAIN CHARACTER", "X VETERAN"]).toContain(d.title);
      expect(["1.6M followers, and somehow still answers the replies.", "On X since 2008. Remembers when it was a bird."]).toContain(d.quote);
      const b = cardWords(BARE, roll, NOW);
      expect(PLAIN_TITLES).toContain(b.title);
      expect(PLAIN_QUOTES.map((q) => q(BARE))).toContain(b.quote);
    }
    // a bio with a fragment but no family: the plain riff on it, or the numbers
    const loose = { ...BARE, bio: "just vibes here", followers: 12 };
    const said = new Set(Array.from({ length: 20 }, (_, r) => cardWords(loose, r, NOW).quote));
    expect(said).toEqual(new Set(["“just vibes here” — said with the confidence of a fresh block.", "12 followers — a small, hand-picked fan club."]));
    // a family named only in a salty fragment earns its title but no riff on that fragment
    const salty = cardWords({ ...BARE, bio: "shit developer" }, 0, NOW);
    expect(FAMILIES[0]!.titles).toContain(salty.title);
    expect(PLAIN_QUOTES.map((q) => q(BARE))).toContain(salty.quote);
  });

  it("every tier is true of the numbers it is picked for, and says nothing about money", () => {
    const kinds: WordFacts[] = [
      { ...BARE, followers: 500_000, joined: new Date("2009-01-01T00:00:00Z") },
      { ...BARE, followers: 20_000 },
      { ...BARE, followers: 2_000, joined: new Date("2026-06-01T00:00:00Z") },
      { ...BARE, followers: 3 },
    ];
    for (const t of TIER_TITLES) expect(kinds.some((k) => t.when(k, NOW)), t.say).toBe(true);
    for (const q of TIER_QUOTES) {
      const k = kinds.find((x) => q.when(x, NOW))!;
      expect(q.say(k, NOW)).not.toMatch(/undefined|null|NaN|\b(buy|sell|invest|profit)\b/i);
    }
    for (const t of TIER_TITLES) expect(t.when(BARE, NOW)).toBe(false);
    for (const f of FAMILIES) for (const r of f.riffs) expect(r("x")).not.toMatch(/\b(buy|sell|invest|profit)\b/i);
  });

  it("counts compactly, truncating", () => {
    expect([compact(0), compact(999), compact(2235), compact(12_999), compact(356_527), compact(1_686_046), compact(25_000_000)]).toEqual(["0", "999", "2.2K", "12K", "356K", "1.6M", "25M"]);
  });
});

describe("the pixel portrait", () => {
  it("is a mirrored 12×12 face, the same for the same handle in any case", () => {
    const p = portraitOf("madebyshun");
    expect(p).toEqual(portraitOf("MadeByShun"));
    expect(p).not.toEqual(portraitOf("dril"));
    expect(p.cells).toHaveLength(PIXELS * PIXELS);
    for (let row = 0; row < PIXELS; row++) {
      const cells = p.cells.slice(row * PIXELS, (row + 1) * PIXELS);
      expect(cells).toEqual([...cells].reverse());
    }
  });

  it("wears a hat for some seeds and not others; non-hex reads as zeros", () => {
    const z = portrait("0xzz");
    expect(portrait("0x" + "f".repeat(40)).cells.slice(0, PIXELS)).toContain(2);
    expect(z.cells.slice(0, PIXELS)).not.toContain(2);
    expect(z).toEqual(portrait("0x" + "0".repeat(40)));
  });
});

describe("the card's layout helpers", () => {
  it("writes the handle and the followers under the name — an unread count is left off, never a zero", () => {
    expect(factLine(SHUN)).toBe("@madebyshun · 2.2K followers");
    expect(factLine({ ...BARE, followers: 1 })).toBe("@nobody_ · 1 follower");
    expect(factLine(BARE)).toBe("@nobody_");
  });

  it("wraps words into at most so many rows, ending a cut quote in '…'", () => {
    expect(wrap("one two three four", 9)).toEqual(["one two", "three", "four"]);
    expect(wrap("one two three four", 9, 2)).toEqual(["one two", "three…"]);
    expect(wrap("“ab cd,” ef", 6, 1)).toEqual(["“ab…"]);
    expect(titleLines("MEME LORD")).toEqual(["MEME LORD"]);
    expect(titleLines("SUPERCALIFRAGILISTIC")).toEqual(["SUPERCALIFRAGILISTIC"]);
    expect(titleLines("AI ECOSYSTEM FARMER")).toEqual(["AI ECOSYSTEM", "FARMER"]);
    expect(titleLines("A LONGER TITLE HERE")).toEqual(["A LONGER", "TITLE HERE"]);
  });

  it("posts on X with the handle and where to make one; the picture is the user's to attach", () => {
    const w = cardWords(SHUN, 0, NOW);
    const url = shareUrl("madebyshun", w);
    expect(url.startsWith("https://x.com/intent/post?text=")).toBe(true);
    const text = decodeURIComponent(url.split("text=")[1]!);
    expect(text).toContain("@madebyshun");
    expect(text).toContain(w.title);
    expect(text).toContain(BRAND.name);
    expect(text).toContain(`make yours at ${window.location.origin}/?do=card`);
  });
});

describe("the card", () => {
  it("draws one 1600×900 SVG: picture, WordArt, display name, handle and followers, quote — shipped only for a builder", () => {
    const w = cardWords(SHUN, 0, NOW);
    const { container, rerender } = render(<CardSvg user={SHUN} words={w} picture={null} />);
    const svg = screen.getByRole("img", { name: "Base card for Shun Tr" });
    expect(svg).toHaveAttribute("viewBox", "0 0 1600 900");
    expect(container.querySelector('[aria-label="pixel portrait"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="shipped!"]')).not.toBeNull();
    expect(svg).toHaveTextContent("@madebyshun · 2.2K followers");
    expect(svg).toHaveTextContent("BASE 8453");
    rerender(<CardSvg user={{ ...DRIL, name: "a display name that is far too long to fit on one line of the card" }} words={{ ...w, title: "MEME LORD", quote: "word ".repeat(60) }} picture="data:image/png;base64,AAA" />);
    expect(container.querySelector("image")).toHaveAttribute("href", "data:image/png;base64,AAA");
    expect(container.querySelector('[aria-label="shipped!"]')).toBeNull();
    expect(container.querySelector('[textLength="880"]')).not.toBeNull();
    expect(svg).toHaveTextContent("word…");
    expect(container.querySelector('[aria-label="MEME LORD"]')).not.toBeNull();
  });

  it("draws the title in its own bitmap letters, sized so the longest line fits", () => {
    for (const rows of Object.values(PIXEL_FONT)) expect(rows).toMatch(/^[.#]{35}$/);
    expect(pixelsOf("I")).toHaveLength([...PIXEL_FONT.I!].filter((c) => c === "#").length);
    expect(pixelsOf("ab").every((p) => p.x < 12 && p.y < 7)).toBe(true);
    expect(pixelsOf("é")).toEqual(pixelsOf("?"));
    expect(pixelsOf(" ")).toEqual([]);
    expect(pixelsOf("TT").filter((p) => p.letter === 1)[0]).toEqual({ x: 6, y: 0, letter: 1 });
    expect(cellFor(["MEME LORD"], 860, 18)).toBe(16);
    expect(cellFor(["AB"], 860, 18)).toBe(18);
    expect(cellFor(["CHIEF EVERYTHING", "OFFICER"], 860, 18)).toBe(9);
  });
});

/** An Image whose load or error the test decides. */
function stubImage(outcome: "load" | "error") {
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) {
        queueMicrotask(() => (outcome === "load" ? this.onload?.() : this.onerror?.()));
      }
    },
  );
}

function canvasOk(blob: Blob | null = new Blob(["png"], { type: "image/png" })) {
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: draw } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAA");
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(blob));
  return draw;
}

describe("drawCard", () => {
  it("draws at 1600×900, or says why it could not", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    stubImage("load");
    const draw = canvasOk();
    const c = await drawCard(svg);
    expect([c.width, c.height]).toEqual([1600, 900]);
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 900);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(drawCard(svg)).rejects.toThrow("This browser cannot draw the picture");
    stubImage("error");
    await expect(drawCard(svg)).rejects.toThrow("The picture could not be drawn");
  });
});

/** The viewer, for a profile with no picture to read unless one is routed. */
const viewer = (user: XUser = { ...SHUN, avatar: null }, onBack?: () => void) => render(<CardViewer user={user} onBack={onBack} />);

describe("the Paint viewer", () => {
  it("frames the card in Paint with its toolbar, links the X profile, says where it was read from, and rerolls", async () => {
    viewer();
    expect(screen.getByRole("toolbar", { name: PAINT })).toBeInTheDocument();
    expect(PAINT).toBe(`${BRAND.name}Paint`);
    expect(screen.getByLabelText("madebyshun — Paint")).toHaveTextContent(`Make yours at ${window.location.host}`);
    expect(screen.getByLabelText("madebyshun — Paint")).toHaveTextContent("Read from X through FxTwitter; nothing is stored.");
    const x = screen.getByRole("link", { name: "@madebyshun on X" });
    expect(x).toHaveAttribute("href", "https://x.com/madebyshun");
    expect(x).toHaveAttribute("target", "_blank");
    const first = screen.getByRole("link", { name: "Post on X" }).getAttribute("href");
    for (let i = 0; i < 6 && screen.getByRole("link", { name: "Post on X" }).getAttribute("href") === first; i++) {
      await userEvent.click(screen.getByRole("button", { name: "Reroll" }));
    }
    expect(screen.getByRole("link", { name: "Post on X" }).getAttribute("href")).not.toBe(first);
    expect(screen.queryByRole("button", { name: "Back to wizard" })).toBeNull();
  });

  it("downloads the PNG as <handle>_base_card.png", async () => {
    stubImage("load");
    canvasOk();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    viewer();
    await userEvent.click(screen.getByRole("button", { name: "Download PNG" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved to your computer."));
    expect((click.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe("madebyshun_base_card.png");
  });

  it("says when the download cannot be drawn", async () => {
    stubImage("error");
    viewer();
    await userEvent.click(screen.getByRole("button", { name: "Download PNG" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("The picture could not be drawn"));
  });

  it("copies the picture to the clipboard, and says so when it cannot", async () => {
    viewer();
    await userEvent.click(screen.getByRole("button", { name: "Copy image" }));
    expect(screen.getByRole("status")).toHaveTextContent("This browser cannot copy pictures — use Download PNG instead.");

    stubImage("load");
    canvasOk();
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("ClipboardItem", class {
      constructor(readonly items: Record<string, Blob>) {}
    });
    Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
    await userEvent.click(screen.getByRole("button", { name: "Copy image" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copied — paste it anywhere."));
    expect(write).toHaveBeenCalledOnce();

    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(null));
    await userEvent.click(screen.getByRole("button", { name: "Copy image" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Could not copy: The picture could not be made. Use Download PNG instead."));

    stubImage("error");
    await userEvent.click(screen.getByRole("button", { name: "Copy image" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Could not copy: The picture could not be drawn"));

    Object.defineProperty(navigator, "clipboard", { value: {}, configurable: true });
    await userEvent.click(screen.getByRole("button", { name: "Copy image" }));
    expect(screen.getByRole("status")).toHaveTextContent("This browser cannot copy pictures");
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });

  it("changes the picture to a local file, read in the page, and refuses a file that is not a picture", async () => {
    const { container } = viewer();
    const input = screen.getByLabelText("Picture file") as HTMLInputElement;
    const pick = vi.spyOn(input, "click");
    await userEvent.click(screen.getByRole("button", { name: "Change picture…" }));
    expect(pick).toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [] } });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.change(input, { target: { files: [new File(["x"], "a.txt", { type: "text/plain" })] } });
    expect(screen.getByRole("status")).toHaveTextContent("That file is not a picture.");
    fireEvent.change(input, { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Picture changed — it stays on this computer."));
    expect(container.querySelector("image")!.getAttribute("href")).toMatch(/^data:image\/png;base64,/);
  });

  it("draws the profile's own picture from pbs.twimg.com", async () => {
    net({ get: urls({ [SHUN.avatar!]: new Response(new Uint8Array([255, 216, 255]), { headers: { "content-type": "image/jpeg" } }) }) });
    const { container, unmount } = viewer(SHUN);
    await waitFor(() => expect(container.querySelector("image")).not.toBeNull());
    unmount();
  });
});

function program(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <OpenWindowProvider open={vi.fn()}>
        <CardPanel />
      </OpenWindowProvider>
    </MemoryRouter>,
  );
}

const HANDLES = {
  [`${FXTWITTER}madebyshun`]: { ...XF.userMadebyshun, user: { ...XF.userMadebyshun.user, avatar_url: undefined } },
  [`${FXTWITTER}a`]: json(XF.notfoundA, 404),
};

describe("the Card Wizard", () => {
  it("asks for an X handle — no wallet prefill — reads it, and shows the card; Back and Cancel go between them", async () => {
    const calls = net({ get: urls(HANDLES) });
    program();
    const form = screen.getByRole("form", { name: "Card Wizard" });
    expect(form).toHaveTextContent("Create my Base card");
    expect(form).toHaveTextContent(`Type your X handle. ${BRAND.name} reads your profile picture and bio, then paints a shareable 1600×900 Base card in ${PAINT}.`);
    const input = screen.getByLabelText("X handle");
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", "yourhandle");
    expect(screen.getByRole("button", { name: "Create card" })).toBeDisabled();
    await userEvent.type(input, "@madebyshun");
    await userEvent.click(screen.getByRole("button", { name: "Create card" }));
    await screen.findByLabelText("madebyshun — Paint");
    expect(calls.map((c) => c.url)).toEqual([`${FXTWITTER}madebyshun`]);
    await userEvent.click(screen.getByRole("button", { name: "Back to wizard" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByLabelText("madebyshun — Paint");
  });

  it("refuses a handle that cannot be one without asking anybody, says FxTwitter found nobody, and Cancel clears", async () => {
    const calls = net({ get: urls(HANDLES) });
    program();
    const input = screen.getByLabelText("X handle");
    await userEvent.type(input, "not a handle");
    await userEvent.click(screen.getByRole("button", { name: "Create card" }));
    expect(screen.getByText(/An X handle is 1 to 15/, { selector: ".tx__warn" })).toBeInTheDocument();
    expect(calls).toEqual([]);
    await userEvent.clear(input);
    await userEvent.type(input, "a");
    await userEvent.click(screen.getByRole("button", { name: "Create card" }));
    expect(await screen.findByText("FxTwitter found no X account @a. Check the spelling, or try again in a moment.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("X handle")).toHaveValue("");
    expect(screen.queryByText(/FxTwitter found/)).toBeNull();
  });

  it("makes the card a link or the Terminal asked for (`card madebyshun`), saying it is reading meanwhile", async () => {
    let finish: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", () => new Promise<Response>((r) => (finish = r)));
    program("/?c=madebyshun");
    expect(await screen.findByText("Reading @madebyshun from X…")).toBeInTheDocument();
    await act(async () => finish(json(HANDLES[`${FXTWITTER}madebyshun`])));
    expect(await screen.findByLabelText("madebyshun — Paint")).toBeInTheDocument();
    expect(within(screen.getByRole("toolbar")).getByRole("button", { name: "Back to wizard" })).toBeInTheDocument();
  });

  it("is a Terminal shortcut", () => {
    expect(parseCommand("card madebyshun")).toEqual({ kind: "open", opening: { window: "card", params: { c: "madebyshun" } } });
    expect(parseCommand("card")).toEqual({ kind: "open", opening: { window: "card", params: {} } });
  });
});
