import { DirectionalLight, Fog, HemisphereLight, PerspectiveCamera, PointLight, Raycaster, Scene, Vector2, type Camera, type Texture } from "three";
import { CSS3DObject, CSS3DRenderer } from "three/addons/renderers/CSS3DRenderer.js";
import { buildMachine } from "@/intro/machine";
import { buildRoom } from "@/intro/room";
import { cameraAt, ease, REST, startOf, PHASES, wideDistance, type Orbit } from "@/intro/timeline";

/**
 * The intro's stage: the machine, its lights, a camera that follows `timeline.ts`, and two
 * renderers stacked in `host` — the HTML screen in a CSS3D layer at the BACK, the WebGL picture
 * in front of it with a transparent hole where the tube is (see `machine.ts`).
 *
 * The WebGL renderer is handed in (`gl`) rather than made here, so the whole scene — geometry,
 * lights, camera, layering, resizing and teardown — runs under test, where there is no GPU.
 * `webgl.ts` makes the real one.
 */

/** What this scene needs from a renderer: the slice of `WebGLRenderer` it calls. */
export type GL = {
  readonly domElement: HTMLElement;
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number): void;
  render(scene: Scene, camera: Camera): void;
  dispose(): void;
};

/** The boot screen is laid out at this size in CSS pixels, then scaled onto the tube. */
export const SCREEN_PX = { width: 640, height: 480 } as const;
export const FOV = 30;
/** The room's darkness — the same colour as the overlay's CSS background at its edges. */
export const ROOM = "#c8c6be";

export type Pointer = { x: number; y: number };

/** What is under the pointer: the tube, the rest of the machine, or nothing that can be clicked. */
export type Hit = "screen" | "machine" | null;

export type IntroScene = {
  /** draw the moment `ms` into the intro, with the visitor's view */
  frame(ms: number, pointer: Pointer, orbit?: Orbit): void;
  /** what is at this point of the page, in −1..1 each way (the last frame's camera) */
  hit(x: number, y: number): Hit;
  resize(width: number, height: number): void;
  dispose(): void;
};

export type SceneOptions = {
  readonly host: HTMLElement;
  /** the element that IS the screen — its content belongs to whoever made it */
  readonly screenEl: HTMLElement;
  readonly gl: GL;
  /** an environment map for the plastic's soft reflections, or none */
  readonly environment: Texture | null;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
};

const WARM_AT = startOf("warm");
const WARM_MS = PHASES.find((p) => p.id === "warm")!.ms;
const DARK_MS = PHASES.find((p) => p.id === "dark")!.ms;

export function createScene(o: SceneOptions): IntroScene {
  const scene = new Scene();
  scene.environment = o.environment;
  scene.environmentIntensity = 0.6;
  // the desk runs off into the dark of the room instead of ending at a horizon line
  const fog = new Fog(ROOM, 16, 34);
  scene.fog = fog;
  const machine = buildMachine();
  scene.add(machine.group);
  // the desk's other things and the posters: their own group, so the hit test below never reads them
  const things = buildRoom();
  scene.add(things.group);

  const hemi = new HemisphereLight("#e1edff", "#79684e", 0.9);
  const key = new DirectionalLight("#fff1dc", 2.4);
  key.position.set(-5, 9, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.00015;
  key.shadow.normalBias = 0.025;
  key.shadow.radius = 3;
  Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7 });
  const rim = new DirectionalLight("#a8d4ff", 1.2);
  rim.position.set(6, 5, -6);
  // the tube's own light on the keyboard and the desk, once it is on
  const glow = new PointLight("#cfd8e6", 0, 9, 2);
  glow.position.set(machine.screen.center.x, machine.screen.center.y, machine.screen.center.z + 1.4);
  scene.add(hemi, key, rim, glow);
  const room = [
    [hemi, 0.9],
    [key, 2.4],
    [rim, 1.2],
  ] as const;

  const camera = new PerspectiveCamera(FOV, o.width / o.height, 0.05, 100);

  // the screen, at the back
  const css = new CSS3DRenderer();
  css.domElement.classList.add("intro__css");
  const screen = new CSS3DObject(o.screenEl);
  screen.position.set(machine.screen.center.x, machine.screen.center.y, machine.screen.center.z);
  screen.scale.setScalar(machine.screen.width / SCREEN_PX.width);
  scene.add(screen);

  // the picture, in front
  o.gl.setPixelRatio(o.pixelRatio);
  o.gl.domElement.classList.add("intro__gl");
  o.host.append(css.domElement, o.gl.domElement);

  function resize(width: number, height: number) {
    o.gl.setSize(width, height);
    css.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // the fog starts just past the machine, wherever the camera has had to stand to see it all
    // (MEASURED: a fixed 16..34 hid the machine at a phone's distance of ~32)
    const back = wideDistance(camera.aspect, FOV);
    fog.near = back + 3;
    fog.far = back + 20;
  }
  resize(o.width, o.height);

  const ray = new Raycaster();
  return {
    frame(ms, pointer, orbit = REST) {
      const shot = cameraAt(ms, machine.screen, camera.aspect, FOV, pointer, orbit);
      camera.position.set(shot.position.x, shot.position.y, shot.position.z);
      camera.lookAt(shot.target.x, shot.target.y, shot.target.z);
      const lit = ease(ms / DARK_MS);
      for (const [light, full] of room) light.intensity = full * lit;
      machine.setPower(ms >= WARM_AT);
      glow.intensity = 2.2 * ease((ms - WARM_AT) / WARM_MS);
      o.gl.render(scene, camera);
      css.render(scene, camera);
    },
    hit(x, y) {
      ray.setFromCamera(new Vector2(x, y), camera);
      const first = ray.intersectObject(machine.group, true).find((h) => h.object !== machine.desk);
      return first === undefined ? null : first.object === machine.hole ? "screen" : "machine";
    },
    resize,
    dispose() {
      machine.dispose();
      things.dispose();
      o.gl.dispose();
      o.gl.domElement.remove();
      css.domElement.remove();
    },
  };
}
