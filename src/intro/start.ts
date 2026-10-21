import type { IntroScene } from "@/intro/scene";

/**
 * Load three.js and start the intro's scene in `host`, with `screenEl` as the tube.
 *
 * Both modules are imported here, on demand, so three.js is its own chunk: the desktop's bundle
 * does not grow by it, and a visitor who arrives on a `?do=` link never downloads it.
 */
export async function startScene(host: HTMLElement, screenEl: HTMLElement, size: { width: number; height: number; pixelRatio: number }): Promise<IntroScene> {
  const [{ createScene }, { createGL }] = await Promise.all([import("@/intro/scene"), import("@/intro/webgl")]);
  const { gl, environment } = createGL();
  return createScene({ host, screenEl, gl, environment, ...size });
}
