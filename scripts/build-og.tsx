/**
 * Draws every page's share card to public/og/<id>.png (hand-run: `npm run build:og`, then commit
 * the PNGs). Each card is features/og/OgCard.tsx rendered to markup and photographed by headless
 * Chrome at exactly 1200x630, with Inter and JetBrains Mono loaded so the picture matches the app.
 * Re-run after changing a page's copy in src/server/og.ts — tests/og.test.tsx fails while a page
 * has no picture.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { OgCard, OG_H, OG_W } from "@/features/og/OgCard";
import { OG_PAGES } from "@/server/og";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "og");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FONTS = "https://fonts.googleapis.com/css2?family=Inter:wght@400..800&family=JetBrains+Mono:wght@400;500&display=block";

mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "og-"));
for (const page of OG_PAGES) {
  const html = join(work, `${page.id}.html`);
  writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${FONTS}"><style>html,body{margin:0}</style></head><body>${renderToStaticMarkup(<OgCard page={page} />)}</body></html>`);
  execFileSync(CHROME, ["--headless", "--disable-gpu", "--hide-scrollbars", "--virtual-time-budget=4000", `--window-size=${OG_W},${OG_H}`, `--screenshot=${join(OUT, `${page.id}.png`)}`, `file://${html}`], { stdio: "ignore" });
  console.log(`og/${page.id}.png`);
}
