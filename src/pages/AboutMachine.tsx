import { useEffect, useRef, useState } from "react";
import { BRAND } from "@/brand";

import machineSource from "@/assets/quadra-q001.svg";
import diskSource from "@/assets/quadra-disk.svg";
const columns = 120;
const rows = 74;

function DotMatrixArt({ variant }: { variant: "machine" | "disk" }) {
  const disk = variant === "disk";
  const source = disk ? diskSource : machineSource;
  const width = disk ? 450 : 620;
  const height = disk ? 300 : 680;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointer = useRef({ x: 0, y: 0, active: false });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const field = document.createElement("canvas");
    field.width = columns;
    field.height = rows;
    const sampler = field.getContext("2d");
    if (!sampler) return;

    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const image = new Image();
    let frame = 0;
    let hover = 0;
    let resize: ResizeObserver | undefined;
    let sync: (() => void) | undefined;

    image.onload = () => {
      const samplePose = (angle: number, scale: number) => {
        sampler.fillStyle = disk ? "#000" : "#fff";
        sampler.fillRect(0, 0, columns, rows);
        sampler.save();
        sampler.scale(columns / width, rows / height);
        sampler.translate(width / 2, height / 2);
        sampler.rotate(angle);
        sampler.scale(scale, scale);
        sampler.drawImage(image, -width / 2, -height / 2, width, height);
        sampler.restore();
        return sampler.getImageData(0, 0, columns, rows).data;
      };
      const poses = [samplePose(-.045, .97), samplePose(.065, .91)];
      const dotSize = (pixels: Uint8ClampedArray, offset: number) => {
        const light = (pixels[offset] ?? 255) * .21 + (pixels[offset + 1] ?? 255) * .72 + (pixels[offset + 2] ?? 255) * .07;
        const density = disk ? (light - 8) / 180 : (247 - light) / 168;
        return Math.round(Math.min(1, Math.max(0, density)) * 4) / 4;
      };
      const dots = Array.from({ length: columns * rows }, (_, index) => {
        const x = index % columns;
        const y = Math.floor(index / columns);
        const offset = index * 4;
        const seed = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
        const rowSeed = Math.sin(y * 97.3) * 43758.5453;
        return {
          x, y,
          sizes: poses.map(pose => dotSize(pose, offset)),
          seed: .75 * (seed - Math.floor(seed)) + .25 * (rowSeed - Math.floor(rowSeed)),
        };
      }).filter(dot => dot.sizes.some(size => size > 0));

      function draw(now: number) {
        if (!canvas || !context) return;
        const w = canvas.width;
        const h = canvas.height;
        const time = motion.matches ? 0 : (now / 1000) * (disk ? 1 : 1.75);
        const phase = time % 12;
        const progress = Math.max(0, Math.min(1, phase - 4, 10 - phase));
        const mix = progress * progress * (3 - 2 * progress);
        const pitch = w / columns;
        const rowPitch = h / rows;
        context.clearRect(0, 0, w, h);
        context.fillStyle = disk ? "#f4f0e6" : "#2521c7";
        context.beginPath();
        const cursor = pointer.current;
        hover = motion.matches ? 0 : hover + ((cursor.active ? 1 : 0) - hover) * .14;
        const hoverRadius = w * .13;
        const transitioning = mix > 0 && mix < 1;
        for (const { x, y, sizes, seed } of dots) {
          const size = sizes[seed < mix ? 1 : 0] ?? 0;
          if (!size) continue;
          const dissolve = transitioning ? Math.min(1, Math.abs(seed - mix) / .095) : 1;
          const glitch = transitioning && (y + Math.floor(time * 7) * 13) % 47 === 0 ? 2 : 0;
          const drift = Math.sin(time * Math.PI / 6);
          let cx = (x + .5 + drift * .8 + glitch) * pitch;
          let cy = (y + .5 + drift * .7) * rowPitch;
          const shimmer = .94 + .06 * Math.sin(time * Math.PI + seed * 40);
          let lift = 0;
          if (hover > .005) {
            const dx = cx - cursor.x * w;
            const dy = cy - cursor.y * h;
            const distance = Math.hypot(dx, dy);
            lift = hover * Math.max(0, 1 - distance / hoverRadius) ** 2;
            cx += dx * lift * .42;
            cy += dy * lift * .42;
          }
          const radius = pitch * .49 * size * dissolve * shimmer * (1 + lift * .9);
          context.moveTo(cx + radius, cy);
          context.arc(cx, cy, radius, 0, Math.PI * 2);
        }
        context.fill();
        if (!motion.matches) frame = requestAnimationFrame(draw);
      }

      sync = () => {
        cancelAnimationFrame(frame);
        const dpr = Math.min(window.devicePixelRatio, 2);
        canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
        canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
        draw(performance.now());
      };
      resize = new ResizeObserver(sync);
      resize.observe(canvas);
      motion.addEventListener("change", sync);
      sync();
      setReady(true);
    };
    image.src = source;

    return () => {
      image.onload = null;
      cancelAnimationFrame(frame);
      resize?.disconnect();
      if (sync) motion.removeEventListener("change", sync);
    };
  }, [disk, height, source, width]);

  return (
    <div className={`about__machine-art${disk ? " about__foot-disk" : ""}`} data-ready={ready} aria-hidden={disk || undefined}
      onPointerMove={disk ? undefined : (event) => {
        if (event.pointerType === "touch") return;
        const bounds = event.currentTarget.getBoundingClientRect();
        pointer.current = {
          x: (event.clientX - bounds.left) / bounds.width,
          y: (event.clientY - bounds.top) / bounds.height,
          active: true,
        };
      }}
      onPointerLeave={disk ? undefined : () => { pointer.current.active = false; }}
    >
      <img src={source} width={width} height={height} alt={disk ? "" : `${BRAND.name} Q-001 compact CRT`} />
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}

export function AboutMachine() {
  return (
    <figure className="about__machine">
      <DotMatrixArt variant="machine" />
      <figcaption>fig. 1 / q-001</figcaption>
    </figure>
  );
}

export function AboutDisk() {
  return <DotMatrixArt variant="disk" />;
}
