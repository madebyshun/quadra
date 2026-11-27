/** Render the share cards and X profile banners from the same visual system. */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { OgCard, OG_H, OG_W, XHeader, XPost, X_POSTS } from "@/features/og/OgCard";
import { OG_PAGES } from "@/server/og";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "og");
const BANNERS = join(ROOT, "public", "brand", "banners");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const art = (path: string) => `data:image/svg+xml;base64,${readFileSync(join(ROOT, path)).toString("base64")}`;
const machine = art("public/brand/banners/q001-dot-matrix.svg");
const sourceCards = new Set(["home", "about", "markets"]);

mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "quadra-og-"));
function renderPng(svg: string, output: string, width: number, height: number) {
  const html = join(work, "card.html");
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}svg{display:block}</style>${svg}`);
  execFileSync(CHROME, ["--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--virtual-time-budget=1000", `--user-data-dir=${join(work, "profile")}`, `--window-size=${width},${height}`, `--screenshot=${output}`, pathToFileURL(html).href], { stdio: "ignore" });
  console.log(output);
}

try {
  for (const page of OG_PAGES) {
    if (sourceCards.has(page.id)) {
      writeFileSync(join(BANNERS, `og-${page.id}.svg`), renderToStaticMarkup(<OgCard page={page} artwork="./q001-dot-matrix.svg" />));
    }
    renderPng(renderToStaticMarkup(<OgCard page={page} artwork={machine} />), join(OUT, `${page.id}.png`), OG_W, OG_H);
  }
  renderPng(renderToStaticMarkup(<XHeader artwork={machine} />), join(BANNERS, "x-header-q001.png"), 1500, 500);
  const posts = join(BANNERS, "x-posts");
  mkdirSync(posts, { recursive: true });
  for (const post of X_POSTS) {
    renderPng(renderToStaticMarkup(<XPost post={post} />), join(posts, `${post.id}.png`), 1080, 1080);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
