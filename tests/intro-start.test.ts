import { describe, expect, it, vi } from "vitest";

/** `startScene` joins the real renderer to the scene; the renderer is the one part replaced. */

const gl = vi.hoisted(() => ({
  domElement: document.createElement("canvas"),
  setPixelRatio: () => {},
  setSize: () => {},
  render: () => {},
  dispose: () => {},
}));

vi.mock("@/intro/webgl", () => ({ createGL: () => ({ gl, environment: null }) }));

describe("starting the intro", () => {
  it("loads three.js and the scene on demand, and hands the scene its renderer", async () => {
    const { startScene } = await import("@/intro/start");
    const host = document.createElement("div");
    const scene = await startScene(host, document.createElement("div"), { width: 800, height: 600, pixelRatio: 1 });
    expect(host.lastElementChild).toBe(gl.domElement);
    scene.dispose();
    expect(host.children).toHaveLength(0);
  });
});
