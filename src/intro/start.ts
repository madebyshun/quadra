import type { IntroScene } from "@/intro/scene";

/**
 * Load three.js and start the intro's scene in `host`, with `screenEl` as the tube.
 *
 * Both modules are imported here, on demand, so three.js is its own chunk: the desktop's bundle
 * does not grow by it, and a visitor who arrives on a `?do=` link never downloads it.
 */
export async function startScene(
  host: HTMLElement,
  screenEl: HTMLElement,
  size: { width: number; height: number; pixelRatio: number },
  /** told each step as it finishes: 1 three.js is here, 2 the room is built */
  onStep: (done: number) => void = () => {},
): Promise<IntroScene> {
  const [{ createScene }, { createGL }] = await Promise.all([import("@/intro/scene"), import("@/intro/webgl")]);
  onStep(1);
  const { gl, environment } = createGL();
  const scene = createScene({ host, screenEl, gl, environment, ...size });
  onStep(2);
  return scene;
}
