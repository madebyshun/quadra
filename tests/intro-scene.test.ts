import { describe, expect, it, vi } from "vitest";
import { DirectionalLight, PerspectiveCamera, PointLight, type Fog, type Scene } from "three";
import { createScene, FOV, ROOM, SCREEN_PX, type GL } from "@/intro/scene";
import { SCREEN } from "@/intro/machine";
import { cameraAt, startOf, wideDistance } from "@/intro/timeline";

/**
 * The scene runs here with a stand-in for the WebGL renderer: everything it does — the layers in
 * the page, the camera, the lights, the power, resizing and teardown — is real three.js and real
 * DOM. Only the pixels are missing, and those are what the real render was checked for by eye.
 */

function fakeGL() {
  const drawn: { scene: Scene; camera: PerspectiveCamera }[] = [];
  const gl = {
    domElement: document.createElement("canvas"),
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn((scene: Scene, camera: PerspectiveCamera) => drawn.push({ scene, camera })),
    dispose: vi.fn(),
  } satisfies GL;
  return { gl, drawn };
}

function stage(width = 1120, height = 700) {
  const host = document.createElement("div");
  document.body.append(host);
  const screenEl = document.createElement("div");
  const { gl, drawn } = fakeGL();
  const scene = createScene({ host, screenEl, gl, environment: null, width, height, pixelRatio: 2 });
  return { host, screenEl, gl, drawn, scene };
}

describe("the intro's scene", () => {
  it("stacks the HTML screen behind the picture, and sizes both to the page", () => {
    const { host, screenEl, gl, scene } = stage();
    expect([...host.children].map((c) => c.className)).toEqual(["intro__css", "intro__gl"]);
    // CSS3D moves the element into its layer on the first render
    scene.frame(0, { x: 0, y: 0 });
    expect(host.querySelector(".intro__css")!.contains(screenEl)).toBe(true);
    expect(gl.setPixelRatio).toHaveBeenCalledWith(2);
    expect(gl.setSize).toHaveBeenCalledWith(1120, 700);
  });

  it("scales the screen element onto the tube exactly", () => {
    const { drawn, scene } = stage();
    scene.frame(0, { x: 0, y: 0 });
    let screenScale = 0;
    drawn[0]!.scene.traverse((o) => {
      if ((o as { isCSS3DObject?: boolean }).isCSS3DObject) screenScale = o.scale.x;
    });
    expect(screenScale * SCREEN_PX.width).toBeCloseTo(SCREEN.width);
    expect(screenScale * SCREEN_PX.height).toBeCloseTo(SCREEN.height);
  });

  it("says what a point of the page is over: the screen, the rest of the machine, or nothing — never the desk", () => {
    const { scene } = stage();
    // square on the screen, at the end of the fly-in, the whole view is the tube
    scene.frame(startOf("fade"), { x: 0, y: 0 });
    expect(scene.hit(0, 0)).toBe("screen");
    // in the wide shot, the sky above the machine is nothing, and the desk below it is not the machine
    scene.frame(startOf("idle"), { x: 0, y: 0 });
    expect(scene.hit(0, 0.97)).toBeNull();
    expect(scene.hit(0, -0.97)).toBeNull();
    expect(scene.hit(-0.05, -0.15)).not.toBeNull();
  });

  it("turns the camera where the visitor dragged it", () => {
    const { drawn, scene } = stage();
    const orbit = { yaw: 0.6, pitch: 0.2, zoom: 0.9 };
    scene.frame(startOf("idle"), { x: 0, y: 0 }, orbit);
    const shot = cameraAt(startOf("idle"), SCREEN, 1120 / 700, FOV, { x: 0, y: 0 }, orbit);
    expect(drawn[0]!.camera.position.toArray()).toEqual([shot.position.x, shot.position.y, shot.position.z]);
  });

  it("puts the camera where the timeline says, at the timeline's field of view", () => {
    const { drawn, scene } = stage();
    const ms = startOf("zoom") + 500;
    scene.frame(ms, { x: 0.3, y: -0.2 });
    const { camera } = drawn[0]!;
    const shot = cameraAt(ms, SCREEN, 1120 / 700, FOV, { x: 0.3, y: -0.2 });
    expect(camera.fov).toBe(FOV);
    expect(camera.position.toArray()).toEqual([shot.position.x, shot.position.y, shot.position.z]);
  });

  it("starts in a dark room, brings the light up, switches the machine on, then the tube glows", () => {
    const { drawn, scene } = stage();
    const levels = (ms: number) => {
      scene.frame(ms, { x: 0, y: 0 });
      const lights = { key: 0, glow: 0 };
      drawn.at(-1)!.scene.traverse((o) => {
        if (o instanceof DirectionalLight && o.castShadow) lights.key = o.intensity;
        if (o instanceof PointLight) lights.glow = o.intensity;
      });
      return lights;
    };
    expect(levels(0)).toEqual({ key: 0, glow: 0 });
    expect(levels(startOf("warm")).key).toBeCloseTo(2.4);
    expect(levels(startOf("warm")).glow).toBe(0);
    expect(levels(startOf("icon")).glow).toBeCloseTo(2.2);
  });

  it("fades the desk into the room's darkness", () => {
    const { drawn, scene } = stage();
    scene.frame(0, { x: 0, y: 0 });
    expect(drawn[0]!.scene.fog?.color.getHexString()).toBe(ROOM.slice(1));
  });

  it("follows a resize, and moves the fog back with the camera so the machine stays out of it", () => {
    const { gl, drawn, scene } = stage();
    scene.resize(390, 844);
    expect(gl.setSize).toHaveBeenLastCalledWith(390, 844);
    scene.frame(0, { x: 0, y: 0 });
    expect(drawn[0]!.camera.aspect).toBeCloseTo(390 / 844);
    const fog = drawn[0]!.scene.fog as Fog;
    expect(fog.near).toBeCloseTo(wideDistance(390 / 844, FOV) + 3);
    expect(fog.far).toBeCloseTo(wideDistance(390 / 844, FOV) + 20);
  });

  it("takes both layers out of the page and releases the renderer", () => {
    const { host, gl, scene } = stage();
    scene.dispose();
    expect(host.children).toHaveLength(0);
    expect(gl.dispose).toHaveBeenCalledOnce();
  });
});
