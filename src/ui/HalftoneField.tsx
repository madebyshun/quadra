import { useEffect, useRef } from "react";
import "./HalftoneField.css";

const hash = (x: number, y: number) => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

export function HalftoneField({ variant }: { variant: "intro" | "document" }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !canvas.parentElement) return;
    const surface = canvas.parentElement;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const step = variant === "document" ? 12 : 10;
    let width = 0;
    let height = 0;
    let frame = 0;
    let visible = true;
    let pointer: { x: number; y: number } | null = null;
    let dots: { x: number; y: number; weight: number; phase: number; speed: number }[] = [];

    const draw = (ms: number) => {
      frame = 0;
      const t = ms / 1000;
      ctx.clearRect(0, 0, width, height);
      ctx.beginPath();
      for (const { x, y, weight, phase, speed } of dots) {
        const wave = calm.matches ? .72 : .7 + .25 * Math.sin(t * speed + phase + y * .02);
        const lift = pointer && !calm.matches
          ? .42 * Math.exp(-((x - pointer.x) ** 2 + (y - pointer.y) ** 2) / 2600)
          : 0;
        const radius = step * .34 * weight * (wave + lift);
        ctx.moveTo(x + radius, y);
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      }
      ctx.fill();
      canvas.dataset.painted = "true";
      if (visible && !calm.matches) frame = requestAnimationFrame(draw);
    };

    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (visible) draw(performance.now());
    };

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = getComputedStyle(canvas).color;
      dots = [];
      for (let y = step / 2; y < height; y += step) {
        for (let x = step / 2; x < width; x += step) {
          const density = Math.max(0, Math.min(1, (y / height - .08) * 1.35));
          const seed = hash(x, y);
          if (seed > density + .04) continue;
          dots.push({ x, y, weight: .4 + density * .6, phase: seed * Math.PI * 2, speed: .9 + hash(y, x) * 1.4 });
        }
      }
      refresh();
    };

    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const bounds = canvas.getBoundingClientRect();
      pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    const leave = () => { pointer = null; };
    const sizeObserver = new ResizeObserver(resize);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      refresh();
    });
    resize();

    sizeObserver.observe(canvas);
    visibilityObserver.observe(canvas);
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerleave", leave);
    calm.addEventListener("change", refresh);
    return () => {
      cancelAnimationFrame(frame);
      sizeObserver.disconnect();
      visibilityObserver.disconnect();
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerleave", leave);
      calm.removeEventListener("change", refresh);
    };
  }, [variant]);

  return <canvas ref={ref} className={`halftone-field halftone-field--${variant}`} aria-hidden="true" />;
}
