# quadra / visual system

For anyone (or any model: Gemini, ChatGPT, Midjourney) making images for Quadra. Every image should look
like it came out of the same machine. Written 2026-11-25 from the app's own tokens
(src/styles/workspace.css, theme.css) and the owner's mood board: blue halftone photos, dithered skies,
a blueprint "instrument panel" poster, a blue print magazine, a CRT with a blue screen, stacked
warning dialogs over a film photo.

## 1 / the idea

webcore, printed. The look of early personal computing (Mac OS 8 windows, CRTs, dialog boxes, 1-bit
dither) put through one ink: cobalt on warm paper. A risograph or a newspaper halftone, not a neon
vaporwave screen. Calm, technical, a little funny. The data is real; the picture is quiet.

- one ink. Cobalt carries the whole image. Everything else is paper, ink black or grey.
- a screen made of dots. Photos are halftoned or dithered, never shown as full-color glossy pictures.
- windows as frames. A dialog, a window or a CRT bezel holds the message.
- a grid underneath. Fine graph-paper lines, tick marks, small labels: an instrument, not a poster.

## 2 / color

| token | hex | use |
|---|---|---|
| cobalt | `#0a3dff` | THE ink: halftone dots, big type, fills |
| indigo | `#2422cf` | selections, title bars, the second blue (shadows of cobalt) |
| deep | `#171b29` | night backgrounds (the CRT scene), dark text on paper |
| paper | `#fffdf6` | the default ground, warm white |
| paper-2 | `#f4f0e6` | panels, cards, the grey of a window face |
| line | `#d4cfc3` | graph-paper grid, hairlines |
| ink | `#000000` / `#292a31` | small text, window outlines |
| sky | `#3d7bd9` | only inside a dithered sky photo, as the light end of cobalt |
| signal red | `#d6342b` | ONLY for a real warning: red verdict, close box. Never decoration |
| amber | `#e0a100` | ONLY "not checked" / caution. Never decoration |

Ratio: about 70% paper, 25% cobalt, 5% ink. A night variant inverts it: deep ground, cobalt screen
glowing, paper text. No gradients except the CRT's glow. No purple, no pink, no neon, no green.

## 3 / type

- **Inter** (OFL): everything. Headlines in Inter 700-800, tight tracking (-3%), lowercase, very large,
  left aligned, allowed to crop off the edge (the "designed to evolve" poster).
- **JetBrains Mono** (OFL): labels, addresses, numbers, tick marks, coordinates. Small, uppercase allowed
  here only ("STATE: IDLE", "49 HZ", "BLOCK 56,054,550").
- Window titles: Inter 600, small, inside a title bar.
- No pixel fonts, no Apple fonts or artwork, no script faces. Serif (Newsreader) only on editorial surfaces, see 6b.
- Copy follows the brand voice: lowercase, short lines, plain ASCII, `/` for folder-like headings,
  `-` for entries, no emoji, no arrows, no hype.

## 4 / texture library

Use one per image, never three at once.

1. **halftone dots**: round dots on a square grid, size = tone (the mountain, the sky). Dot pitch
   coarse enough to see at phone size.
2. **ordered dither**: 1-bit Bayer pattern, square pixels (the cloud, the butterfly, the buildings).
3. **film grain + duotone**: a real photo mapped to cobalt/paper with fine noise (the Cusco street).
4. **blueprint grid**: paper ground, fine cobalt-tinted graph lines, filled and empty rectangles,
   radial dot rings, mono labels (the instrument poster). Good for data and flywheel diagrams.

## 5 / objects

Allowed, drawn in our own style, never copied from a real product: a beige CRT monitor (generic,
no logo), a Platinum-style window (grey face, close box left), a dialog with one icon and one button,
folders, files, a floppy disk, a menu bar, the q mark (`public/brand/icon.svg`).
Not allowed: real OS logos (Apple, Windows), real app screenshots, coin cartoons, rockets, moons,
lambos, faces of real people, invented terminal commands.

## 6 / layouts

- **poster** (4:5, 1080x1350): huge lowercase headline top-left, one halftone subject bleeding off an
  edge, two or three small mono labels, `quadra` wordmark bottom-left.
- **window card** (16:9, 1600x900): a halftone or dithered photo as the wallpaper, one to three stacked
  windows or dialogs carrying the message (the "warning" image), menu bar optional.
- **crt** (4:5): deep background, the CRT centered, its screen cobalt with a grid of words or numbers,
  tiny mono caption under it, a barcode-like block at the bottom.
- **instrument** (4:5 or 1:1): blueprint grid, data as rectangles, rows of cells and dot rings,
  real numbers in mono.
- Margins: 6% of the short side. Everything aligns to a 12-column grid.

## 6b / the folio (the fee-flow diagram, src/pages/Flywheel.tsx + .css)

The owner's favourite surface (2026-11-25). It is the quiet, editorial twin of the halftone images:
the same paper and cobalt, but drawn as a printed system manual. Measured from Flywheel.css:

- **frame**: one Platinum window. 1px `#24221e` outline, hard offset shadow `4px 4px 0 #24221e` (no
  blur, ever), grey title bar `#d6d6d6` with a small square glyph, "system / fee flow" left and a status
  ("read only") right.
- **ground**: paper `#ece8df` with a dot grid, `radial-gradient(#24221e24 .7px, transparent .7px)` at 8px.
- **sections**: numbered path label in cobalt, 11px, tracked (`01 / launchpad`), then a two-line serif
  headline whose second line is italic ("a trade comes in. / the fee branches out."), then one sentence
  of 12px sans.
- **the source block**: a solid indigo `#2422cf` slab, paper text, the figure in large serif
  ("1% or 3%", the "or" small italic).
- **folders**: cards `#f4f0e6` with a tab on top (the `::before` tab, 48% wide), 1px outline,
  `2px 2px 0` shadow, label "creator /", the figure in cobalt serif, a 10px explanation.
- **planned row**: dashed hairlines above and below, a mono uppercase status ("not connected"), a dashed
  pill ("planned"). Dashed = not live. Solid = live. Never mix them up.
- **result panel**: sage `#dce7d9` (the only non-blue tint, reserved for "where it ends": burn, payout),
  split into columns by `#24221e55` hairlines, big serif figures.
- **footer**: a hairline, then facts joined by " / " in 10px ("base / fixed supply / no admin /
  contracts not audited"). The caveat is part of the design, not small print to hide.

Type in the folio: **serif for figures and headlines** (Newsreader, OFL, via `--font-serif`; Georgia is only its fallback), sans for prose, mono for status.
That is a change from section 3: the serif is allowed in editorial surfaces (About, the folio, share cards,
posters), never in app chrome (menus, windows' controls, forms).

Code: tokens and classes in `src/styles/folio.css` (`.folio`, `__bar`, `__body`, `__path`, `__title`, `__slab`, `__figure`, `__card--tab`, `__end`, `__pending`, `__status`, `__pill`, `__caveat`). App windows stay Platinum; the folio is for About, landing, banners and share cards.

Colors in the folio: ink `#24221e` (warm black), paper `#ece8df` / `#f4f0e6`, indigo `#2422cf`, sage
`#dce7d9`, muted `#5d584e` / `#817c72`, hairline `#aaa398`.

Rules:
- one indigo slab per folio, at the source of whatever flows.
- figures are real and from the contract (80 / 5 / 15-20, 50 / 50), never rounded into a promise.
- "/" separates, never arrows (fixed 2026-11-26): write
  "to treasury" / "to furnace".
- every folio ends with its caveat line.

## 7 / rules for data in images

Numbers in an image must be real and measured (block, burnt supply, fees), with their date. A ticker is
never the only name of a token: show the address short form (`0xB200...5d7F`). Never write "safe",
"guaranteed" or a price promise. A warning in red only when it is a real warning.

## 8 / prompt template (paste into Gemini / ChatGPT)

```
Style: "quadra" webcore print. One ink: cobalt blue #0A3DFF on warm off-white paper #FFFDF6,
accents #2422CF, dark #171B29. [TEXTURE: coarse round halftone dots | 1-bit ordered dither with square
pixels | duotone photo with fine film grain | blueprint graph-paper grid]. Retro personal-computer
objects drawn generically (beige CRT without logo, grey Mac OS 8 style window with close box on the left,
simple dialog box). Typography: Inter bold, lowercase, very large, tight tracking, left aligned; small
labels in JetBrains Mono. Flat, printed, matte, no gradients, no glow except a CRT screen, no neon,
no purple, no 3D render shine, no real brand logos, no emoji. Generous paper margins.
Subject: [SUBJECT]. Text on image, exactly: "[TEXT]". Format: [4:5 | 16:9 | 1:1].
```

Examples of SUBJECT / TEXT:
- a dithered mountain range with a rising price line made of dots / "steeper than the alps"
- three stacked dialog windows over a duotone photo of a city street / "check before you sign"
- a CRT whose screen is a grid of token addresses / "every coin, read from the chain"
- instrument poster of the furnace: burnt supply as filled cells / "burnt / 2.92% of supply"

Checklist before posting: one ink, paper ground, one texture, lowercase headline, real numbers,
no logos, no emoji. If it looks like vaporwave, it is wrong; if it looks like a printed manual from a
computer company in 1991 that happens to be about Base, it is right.

## 9 / the Q-001 computer asset

Use `public/brand/quadra-q001.svg` when composing banners or share cards in code.
The SVG is a transparent illustration with a `620 × 680` viewBox and no external
fonts or images. Embed the SVG as an image to keep the blank cobalt screen.

```html
<img src="/brand/quadra-q001.svg" alt="Quadra Q-001 compact CRT"
     width="620" height="680">
```

For screen content, inline the SVG and insert SVG elements in
`<g id="screen-content"/>`. Start with x=170–330 and y=170–335, then check the
composition at the final output size. The screen group clips content to the
curved glass. Keep the upright casing, recessed bezel, narrow disk slot,
stepped foot and low side vents. For previews with multiple inline instances,
prefix the IDs and matching references in each instance.

Handoff for Claude or Gemini: attach the SVG and this section if the model
cannot read the repo. Ask it to reuse the vector paths, place the machine in the
right column of a paper folio, and change only `screen-content` as needed.
