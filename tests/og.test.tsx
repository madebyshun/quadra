import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { injectMeta, metaFor, OG_PAGES } from "@/server/og";
import { OgCard } from "@/features/og/OgCard";
import middleware, { config } from "../middleware";

/**
 * Share cards per page: which card a URL gets, the tags written into index.html, a picture on disk
 * for every card, and the edge middleware that serves it.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = readFileSync(resolve(ROOT, "index.html"), "utf8");
const at = (path: string) => new URL(`https://quadra.test${path}`);

describe("which card a link gets", () => {
  it("is the window's for a ?do= link, the route's for a page, and the desktop's otherwise", () => {
    expect(metaFor(at("/?do=basket")).id).toBe("basket");
    expect(metaFor(at("/?do=collateral")).id).toBe("research");
    expect(metaFor(at("/?do=x402")).id).toBe("agents");
    expect(metaFor(at("/about")).id).toBe("about");
    expect(metaFor(at("/docs/")).id).toBe("agents");
    expect(metaFor(at("/?do=nonsense")).id).toBe("home");
    expect(metaFor(at("/")).id).toBe("home");
    expect(metaFor(at("/?do=card&t=0x1")).id).toBe("home");
  });

  it("is lowercase plain ASCII, with no live figure in it", () => {
    for (const p of OG_PAGES) {
      for (const text of [p.path, p.title, p.description, ...p.lines]) {
        expect(text, p.id).toMatch(/^[\x20-\x7e]+$/);
        expect(text, p.id).not.toMatch(/->|=>/);
        expect(text.replace(/\$[A-Z]+/g, ""), p.id).toBe(text.replace(/\$[A-Z]+/g, "").toLowerCase());
      }
    }
    expect(new Set(OG_PAGES.map((p) => p.id)).size).toBe(OG_PAGES.length);
  });

  it("has a 1200x630 picture on disk for every card", () => {
    for (const p of OG_PAGES) {
      const file = resolve(ROOT, "public", "og", `${p.id}.png`);
      expect(existsSync(file), `public/og/${p.id}.png — run npm run build:og`).toBe(true);
      const head = readFileSync(file).subarray(16, 24);
      expect([head.readUInt32BE(0), head.readUInt32BE(4)], p.id).toEqual([1200, 630]);
    }
  });
});

describe("the tags written into index.html", () => {
  it("replaces the title and every share tag, with absolute URLs", () => {
    const url = at("/?do=basket");
    const html = injectMeta(INDEX, metaFor(url), url);
    expect(html).toContain("<title>treasury basket - quadra</title>");
    expect(html).toContain('<meta property="og:image" content="https://quadra.test/og/basket.png" />');
    expect(html).toContain('<meta name="twitter:image" content="https://quadra.test/og/basket.png" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<meta property="og:url" content="https://quadra.test/?do=basket" />');
    expect(html.match(/property="og:image"/g)).toHaveLength(1);
    expect(html).not.toContain("computer-sky-og.jpg");
  });

  it("adds a tag the page lacks, and escapes what it writes", () => {
    const html = injectMeta("<html><head><title>x</title></head></html>", { ...OG_PAGES[0]!, title: 'a "b" <c> & d' }, at("/"));
    expect(html).toContain("<title>a &quot;b&quot; &lt;c&gt; &amp; d</title>");
    expect(html).toContain('    <meta name="twitter:title" content="a &quot;b&quot; &lt;c&gt; &amp; d" />\n');
    expect(html.endsWith("  </head></html>")).toBe(true);
  });
});

describe("the card", () => {
  it("draws the page's path, its name big, and its three entries", () => {
    const page = OG_PAGES.find((p) => p.id === "launch")!;
    render(<OgCard page={page} />);
    const svg = screen.getByRole("img", { name: "share card: launchpad / launch a coin" });
    expect(svg).toHaveTextContent("launch a coin");
    for (const line of page.lines) expect(svg).toHaveTextContent(`- ${line}`);
  });
});

describe("the edge middleware", () => {
  it("serves index.html with the page's card, and leaves assets and the api alone", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (u: URL) => (asked.push(String(u)), new Response(INDEX, { status: 200 })));
    const res = await middleware(new Request("https://quadra.test/?do=weekend"));
    expect(asked).toEqual(["https://quadra.test/index.html"]);
    expect(res!.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res!.text()).toContain("https://quadra.test/og/weekend.png");
    const match = new RegExp(`^${config.matcher[0]}$`);
    expect(["/", "/about", "/docs"].every((p) => match.test(p))).toBe(true);
    expect(["/api/skills", "/og/home.png", "/brand/icon.svg", "/assets/index.js", "/index.html"].some((p) => match.test(p))).toBe(false);
  });

  it("serves the page unchanged on a POST, a missing index or a failure", async () => {
    expect(await middleware(new Request("https://quadra.test/", { method: "POST" }))).toBeUndefined();
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    expect(await middleware(new Request("https://quadra.test/"))).toBeUndefined();
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await middleware(new Request("https://quadra.test/"))).toBeUndefined();
  });
});

it("renders the home brand in its share card", () => {
  render(<OgCard page={OG_PAGES[0]!} />);
  expect(screen.getByRole("img", { name: "share card: quadra / desktop" })).toHaveTextContent("quadra");
});
