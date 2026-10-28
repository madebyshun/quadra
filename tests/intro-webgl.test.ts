import { describe, expect, it, vi } from "vitest";

/**
 * The real renderer needs a GPU, which a test does not have, so three's two GPU-bound classes are
 * replaced and the rest is real: what is checked is how `createGL` CONFIGURES them — transparent,
 * colour-managed, tone-mapped, soft shadows — and that the environment it returns is the room
 * pre-filtered once, with the generator released afterwards.
 */

const made = vi.hoisted(() => ({ renderer: null as Record<string, unknown> | null, pmrem: null as Record<string, unknown> | null }));

vi.mock("three", async (importOriginal) => {
  const real = await importOriginal<typeof import("three")>();
  class WebGLRenderer {
    options: unknown;
    shadowMap = { enabled: false, type: 0 };
    outputColorSpace = "";
    toneMapping = 0;
    toneMappingExposure = 1;
    clear: unknown[] = [];
    constructor(options: unknown) {
      this.options = options;
      made.renderer = this as unknown as Record<string, unknown>;
    }
    setClearColor(...args: unknown[]) {
      this.clear = args;
    }
  }
  class PMREMGenerator {
    scene: unknown = null;
    sigma = 0;
    disposed = false;
    texture = { name: "room" };
    constructor(public renderer: unknown) {
      made.pmrem = this as unknown as Record<string, unknown>;
    }
    fromScene(scene: unknown, sigma: number) {
      this.scene = scene;
      this.sigma = sigma;
      return { texture: this.texture };
    }
    dispose() {
      this.disposed = true;
    }
  }
  return { ...real, WebGLRenderer, PMREMGenerator };
});

describe("the real renderer", () => {
  it("is transparent, colour-managed and tone-mapped, with soft shadows", async () => {
    const three = await import("three");
    const { createGL } = await import("@/intro/webgl");
    const { gl, environment } = createGL();
    const r = gl as unknown as Record<string, unknown>;
    expect(r).toBe(made.renderer);
    expect(r.options).toEqual({ antialias: true, alpha: true, powerPreference: "high-performance" });
    expect(r.outputColorSpace).toBe(three.SRGBColorSpace);
    expect(r.toneMapping).toBe(three.ACESFilmicToneMapping);
    expect(r.shadowMap).toEqual({ enabled: true, type: three.PCFSoftShadowMap });
    expect(r.clear).toEqual([0x000000, 0]);
    expect(environment).toEqual({ name: "room" });
    expect(made.pmrem!.renderer).toBe(gl);
    expect(made.pmrem!.scene).toBeInstanceOf(three.Scene);
    expect(made.pmrem!.disposed).toBe(true);
  });
});
