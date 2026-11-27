import { useEffect, useRef } from "react";
import artwork from "../../public/brand/banners/q001-dot-matrix.svg?raw";
import meadowImg from "@/assets/quadra-wallpaper.jpg";
import studioImg from "@/assets/quadra-machine.jpg";
import {
  DOT_SHAPES,
  WALLPAPER_SCENES,
  customWallpaperImage,
  wallpaperScene,
  wallpaperShape,
  type DotShape,
  type WallpaperScene,
} from "@/lib/settings";
import { useSetting } from "@/ui/useSettings";
import "./DesktopWallpaper.css";

const sourceDots = Array.from(artwork.matchAll(/cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g),
  ([, x, y, r]) => ({ x: Number(x) - 652, y: Number(y) - 65, radius: Number(r) }));

const SCENE_IMAGE: Partial<Record<WallpaperScene, string>> = {
  meadow: meadowImg,
  sky: "/brand/computer-sky.webp",
  studio: studioImg,
};

type Dot = { readonly x: number; readonly y: number; readonly radius: number; readonly color?: string };

function urlParam<T extends string>(key: string, list: readonly { readonly id: T }[]): T | null {
  const param = new URLSearchParams(window.location.search).get(key);
  return list.some((item) => item.id === param) ? (param as T) : null;
}

/** Compact 3×5 dot-matrix glyphs adapted from Base Mode's Rain renderer. */
const RAIN_GLYPHS: readonly (readonly string[])[] = [
  ["010", "101", "101", "101", "010"], // 0
  ["010", "110", "010", "010", "111"], // 1
  ["000", "010", "111", "010", "000"], // +
  ["001", "001", "010", "100", "100"], // /
  ["010", "010", "000", "010", "010"], // :
  ["101", "111", "101", "111", "101"], // #
];

export function drawGlyph(
  ctx: CanvasRenderingContext2D,
  kind: DotShape,
  x: number,
  y: number,
  r: number,
  seed = 0,
): void {
  const hr = Math.max(0.6, r * 0.5);
  if (kind === "circle") {
    ctx.moveTo(x + hr, y);
    ctx.arc(x, y, hr, 0, Math.PI * 2);
  } else if (kind === "square") {
    const s = hr * 1.72;
    ctx.rect(x - s / 2, y - s / 2, s, s);
  } else if (kind === "jumbo") {
    // Adapted from Base Mode Jumbotron: 3 vertical LED subpixel bars with crisp gaps.
    const totalW = hr * 2.05;
    const totalH = hr * 1.95;
    const gap = Math.max(0.45, totalW * 0.11);
    const barW = Math.max(0.65, (totalW - gap * 2) / 3);
    const left = x - totalW / 2;
    const heights = [0.76, 0.9, 1.0];
    for (let i = 0; i < 3; i++) {
      const bh = totalH * heights[i]!;
      ctx.rect(left + i * (barW + gap), y - bh / 2, barW, bh);
    }
  } else if (kind === "rain") {
    // Adapted from Base Mode Rain: crisp dot-matrix pixel glyphs.
    const glyph = RAIN_GLYPHS[Math.abs(seed) % RAIN_GLYPHS.length]!;
    const px = Math.max(0.65, hr * 0.44);
    const ox = x - (3 * px) / 2;
    const oy = y - (5 * px) / 2;
    for (let row = 0; row < 5; row++) {
      const bits = glyph[row]!;
      for (let col = 0; col < 3; col++) {
        if (bits[col] === "1") {
          ctx.rect(ox + col * px, oy + row * px, px * 0.86, px * 0.86);
        }
      }
    }
  } else {
    // Adapted from Base Mode Blueprint: technical drafted square outline + center tick.
    const s = hr * 1.9;
    const t = Math.max(0.65, hr * 0.24);
    const half = s / 2;
    ctx.rect(x - half, y - half, s, t);
    ctx.rect(x - half, y + half - t, s, t);
    ctx.rect(x - half, y - half, t, s);
    ctx.rect(x + half - t, y - half, t, s);
    const dot = Math.max(0.7, t * 1.15);
    ctx.rect(x - dot / 2, y - dot / 2, dot, dot);
  }
}

/** Subtle architectural drafting grid adapted from Base Mode Blueprint. */
function drawBlueprintGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const step = 24;
  ctx.save();
  ctx.strokeStyle = "rgba(244, 240, 230, 0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= width; x += step) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
  }
  for (let y = 0; y <= height; y += step) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}

/** Draw an image cover-fit into a target canvas/context. */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, width: number, height: number): void {
  const imgRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
  const viewRatio = width / Math.max(1, height);
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (imgRatio > viewRatio) {
    sw = img.naturalHeight * viewRatio;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = img.naturalWidth / viewRatio;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
}

/** Sample a real photograph into a halftone dot matrix preserving its exact original RGB colors. */
function samplePhotoDots(img: HTMLImageElement, width: number, height: number): Dot[] {
  const cell = Math.max(8, Math.round(Math.min(width, height) / 86));
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const off = document.createElement("canvas");
  off.width = cols;
  off.height = rows;
  const sctx = off.getContext("2d");
  if (!sctx) return [];
  drawCover(sctx, img, cols, rows);
  const data = sctx.getImageData(0, 0, cols, rows).data;
  const out: Dot[] = [];
  for (let row = 0; row < rows; row++) {
    const xShift = row % 2 === 1 ? cell * 0.5 : 0;
    for (let col = 0; col < cols; col++) {
      const idx = (row * cols + col) * 4;
      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const radius = cell * (0.52 + (1 - lum) * 0.42);
      out.push({
        x: (col / cols) * width + xShift + cell * 0.5,
        y: (row / rows) * height + cell * 0.5,
        radius,
        color: `rgb(${r},${g},${b})`,
      });
    }
  }
  return out;
}

export function DesktopWallpaper() {
  const ref = useRef<HTMLCanvasElement>(null);
  const savedShape = useSetting(wallpaperShape);
  const savedScene = useSetting(wallpaperScene);
  const customPhoto = useSetting(customWallpaperImage);
  const activeShape = urlParam("shape", DOT_SHAPES) ?? savedShape;
  const activeScene = urlParam("scene", WALLPAPER_SCENES) ?? savedScene;
  const shapeRef = useRef<DotShape>(activeShape);
  shapeRef.current = activeShape;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0, height = 0, frame = 0, hover = 0;
    let pointer: { x: number; y: number } | null = null;
    let cursor = { x: 0, y: 0 };
    let dots: Dot[] = [];
    let photo: HTMLImageElement | null = null;
    let alive = true;

    const imgSrc = customPhoto ?? SCENE_IMAGE[activeScene] ?? null;

    function buildDots() {
      if (!customPhoto && activeScene === "q001") {
        const scale = Math.min(width / 487, height / 499) * 1.3;
        const left = (width - 487 * scale) / 2;
        const top = (height - 499 * scale) / 2;
        dots = sourceDots.map(({ x, y, radius }) => ({
          x: left + x * scale,
          y: top + y * scale,
          radius: radius * scale * 0.88,
        }));
      } else if (photo && photo.complete && photo.naturalWidth > 0) {
        dots = samplePhotoDots(photo, width, height);
      } else {
        dots = [];
      }
    }

    function draw(ms: number) {
      if (!ctx) return;
      const time = motion.matches ? 0 : ms / 1000;
      hover += ((pointer && !motion.matches ? 1 : 0) - hover) * .12;
      if (pointer) {
        cursor.x += (pointer.x - cursor.x) * .2;
        cursor.y += (pointer.y - cursor.y) * .2;
      }
      ctx.clearRect(0, 0, width, height);
      const kind = shapeRef.current;
      const rainTick = Math.floor(time * 2.2);

      if (!customPhoto && activeScene === "q001") {
        if (kind === "blueprint") drawBlueprintGrid(ctx, width, height);
        const driftX = Math.sin(time * 0.95) * 2.5;
        const driftY = Math.cos(time * 1.15) * 3.5;
        ctx.fillStyle = "rgba(244, 240, 230, 0.92)";
        ctx.beginPath();
        for (let i = 0; i < dots.length; i++) {
          const dot = dots[i]!;
          const dx = dot.x - cursor.x, dy = dot.y - cursor.y;
          const lift = hover > .005 ? hover * Math.max(0, 1 - Math.hypot(dx, dy) / 170) ** 2 : 0;
          const rainPulse = kind === "rain"
            ? 0.82 + 0.34 * Math.sin(time * 2.8 - dot.x * 0.04 - dot.y * 0.03)
            : 1;
          const x = dot.x + driftX + dx * lift * .42;
          const y = dot.y + driftY + dy * lift * .42;
          const r = dot.radius * rainPulse * (1 + lift * .65);
          drawGlyph(ctx, kind, x, y, r, i + rainTick);
        }
        ctx.fill();
      } else if (photo && photo.complete && photo.naturalWidth > 0) {
        ctx.save();
        ctx.globalAlpha = 0.72;
        drawCover(ctx, photo, width, height);
        ctx.restore();
        if (kind === "blueprint") drawBlueprintGrid(ctx, width, height);
        const wave = Math.sin(time * 0.9);
        for (let i = 0; i < dots.length; i++) {
          const dot = dots[i]!;
          const dx = dot.x - cursor.x, dy = dot.y - cursor.y;
          const lift = hover > .005 ? hover * Math.max(0, 1 - Math.hypot(dx, dy) / 160) ** 2 : 0;
          const rainPulse = kind === "rain"
            ? 0.85 + 0.28 * Math.sin(time * 2.8 - dot.x * 0.04 - dot.y * 0.03)
            : 1;
          const x = dot.x + wave * 0.8 + dx * lift * .26;
          const y = dot.y + dy * lift * .26;
          const r = dot.radius * rainPulse * (1 + lift * .55);
          ctx.fillStyle = dot.color ?? "#f4f0e6";
          ctx.beginPath();
          drawGlyph(ctx, kind, x, y, r, i + rainTick);
          ctx.fill();
        }
      }
      if (!motion.matches) frame = requestAnimationFrame(draw);
    }

    function resize() {
      if (!canvas || !ctx) return;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildDots();
      cancelAnimationFrame(frame);
      draw(performance.now());
    }

    if (imgSrc) {
      const img = new Image();
      photo = img;
      img.onload = () => {
        if (!alive) return;
        buildDots();
        cancelAnimationFrame(frame);
        draw(performance.now());
      };
      img.src = imgSrc;
    }

    const move = (e: PointerEvent) => {
      if (e.pointerType === "mouse") {
        const bounds = canvas.getBoundingClientRect();
        const next = { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
        if (pointer === null) cursor = { ...next };
        pointer = next;
      }
    };
    const leave = () => { pointer = null; };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener("pointermove", move);
    document.documentElement.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);
    motion.addEventListener("change", resize);
    resize();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", leave);
      motion.removeEventListener("change", resize);
    };
  }, [activeScene, customPhoto]);

  return <canvas ref={ref} className="desktop-wallpaper" aria-hidden="true" />;
}
