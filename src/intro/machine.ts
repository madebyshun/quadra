import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoBlending,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  type BufferGeometry,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { ScreenFrame } from "@/intro/timeline";

/**
 * A desktop Macintosh of the early nineties — the machine this app is named after — built from boxes: a low platinum case, a CRT monitor
 * on top with the tube's tapered back, a keyboard and a mouse, on a dark desk. Units are roughly
 * decimetres; the desk is y = 0 and the machine faces +z.
 *
 * It is a period machine, not a replica of one: no maker's logo, no badge, no trademarked boot
 * artwork — the screen shows this app's own boot. The screen itself is not drawn here. It is a
 * HOLE (`hole`): a mesh that writes transparent pixels, so the HTML screen behind the canvas
 * (`scene.ts`, a CSS3D layer) shows through exactly where the tube is — real text, crisp at any
 * distance, which a texture would not be by the end of the fly-in.
 */

export const PLATINUM = "#d7d1c0";
export const PLATINUM_DARK = "#b9b3a3";
export const SLOT = "#26252a";
export const LED_OFF = "#2b3a2c";
export const LED_ON = "#3cff6a";

/** The tube's visible face: 4:3, like every Macintosh display of the time. */
export const SCREEN: ScreenFrame = { center: { x: 0, y: 2.62, z: 0.93 }, width: 2.6, height: 1.95 };
/** The tube's corner radius, as a fraction of its height — the boot screen's CSS uses the same. */
export const SCREEN_CORNER = 0.06;

export type Machine = {
  readonly group: Group;
  readonly screen: ScreenFrame;
  /** the transparent cut-out the HTML screen shows through */
  readonly hole: Mesh;
  /** the power lights on the case and the monitor */
  readonly leds: readonly Mesh[];
  /** the desk — part of the picture, not of the machine a visitor can click */
  readonly desk: Mesh;
  setPower(on: boolean): void;
  dispose(): void;
};

function plastic(color: string, roughness = 0.62): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

/** A rounded rectangle centred on the origin. */
export function roundedRect(width: number, height: number, radius: number): Shape {
  const w = width / 2;
  const h = height / 2;
  const r = Math.min(radius, w, h);
  const s = new Shape();
  s.moveTo(-w + r, -h);
  s.lineTo(w - r, -h);
  s.quadraticCurveTo(w, -h, w, -h + r);
  s.lineTo(w, h - r);
  s.quadraticCurveTo(w, h, w - r, h);
  s.lineTo(-w + r, h);
  s.quadraticCurveTo(-w, h, -w, h - r);
  s.lineTo(-w, -h + r);
  s.quadraticCurveTo(-w, -h, -w + r, -h);
  return s;
}

/** The keyboard's keys, as one instanced mesh: six rows, a main block and a keypad. */
export function keyLayout(): { x: number; z: number; w: number }[] {
  const keys: { x: number; z: number; w: number }[] = [];
  const pitch = 0.215;
  for (let row = 0; row < 6; row++) {
    const z = -0.55 + row * pitch;
    // the main block: 14 keys, with a wide space bar on the last row
    if (row === 5) keys.push({ x: -0.62, z, w: 1.5 });
    else for (let k = 0; k < 14; k++) keys.push({ x: -2.0 + k * pitch, z, w: 0.18 });
    // the keypad: 4 keys a row, below the function row
    if (row > 0) for (let k = 0; k < 4; k++) keys.push({ x: 1.25 + k * pitch, z, w: 0.18 });
  }
  return keys;
}

export function buildMachine(): Machine {
  const group = new Group();
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const keep = <G extends BufferGeometry>(g: G) => (geometries.push(g), g);
  const paint = <M extends Material>(m: M) => (materials.push(m), m);
  const add = (geometry: BufferGeometry, material: Material, x: number, y: number, z: number, shadows = true) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  const body = paint(plastic(PLATINUM));
  const trim = paint(plastic(PLATINUM_DARK, 0.7));
  const dark = paint(plastic(SLOT, 0.5));

  // the desk
  const desk = add(keep(new PlaneGeometry(60, 60)), paint(new MeshStandardMaterial({ color: "#86674c", roughness: 0.85 })), 0, 0, 0, false);
  desk.rotation.x = -Math.PI / 2;

  // the case: low and wide, a floppy slot on the right, the power light on the left
  add(keep(new RoundedBoxGeometry(4.0, 0.75, 3.8, 3, 0.06)), body, 0, 0.375, 0);
  add(keep(new BoxGeometry(3.9, 0.02, 0.02)), trim, 0, 0.2, 1.905);
  add(keep(new RoundedBoxGeometry(1.15, 0.24, 0.04, 2, 0.02)), trim, 1.05, 0.46, 1.9);
  add(keep(new BoxGeometry(0.9, 0.05, 0.03)), dark, 1.05, 0.46, 1.915);
  add(keep(new BoxGeometry(0.5, 0.11, 0.02)), trim, -1.2, 0.46, 1.905);
  const vent = keep(new BoxGeometry(0.025, 0.19, 0.012));
  for (let i = 0; i < 19; i++) add(vent, dark, -1.5 + i * 0.065, 0.45, 1.91, false);

  const ledGeometry = keep(new CylinderGeometry(0.035, 0.035, 0.03, 12));
  const ledCase = add(ledGeometry, paint(new MeshStandardMaterial({ color: LED_OFF, emissive: LED_ON, emissiveIntensity: 0 })), -1.65, 0.46, 1.905, false);
  ledCase.rotation.x = Math.PI / 2;

  // the monitor: a stand, the front housing, the tube's tapered back
  add(keep(new RoundedBoxGeometry(1.7, 0.12, 1.7, 2, 0.04)), trim, 0, 0.81, 0);
  add(keep(new RoundedBoxGeometry(3.6, 3.2, 0.7, 4, 0.12)), body, 0, 2.47, 0.55);
  const tail = keep(new CylinderGeometry(1.3, 2.35, 2.2, 4, 1));
  tail.rotateY(Math.PI / 4);
  tail.rotateX(-Math.PI / 2);
  tail.scale(1.05, 0.95, 1);
  add(tail, body, 0, 2.5, -0.9);

  // the tube's dark surround, then the hole the screen shows through
  const surround = keep(new ShapeGeometry(roundedRect(SCREEN.width + 0.26, SCREEN.height + 0.24, 0.16)));
  add(surround, dark, SCREEN.center.x, SCREEN.center.y, SCREEN.center.z - 0.02, false);
  const holeMaterial = paint(new MeshBasicMaterial({ color: new Color(0, 0, 0), transparent: false, opacity: 0, blending: NoBlending }));
  const hole = add(keep(new ShapeGeometry(roundedRect(SCREEN.width, SCREEN.height, SCREEN.height * SCREEN_CORNER))), holeMaterial, SCREEN.center.x, SCREEN.center.y, SCREEN.center.z, false);

  // the monitor's chin: a vent line and its own power light
  add(keep(new BoxGeometry(1.2, 0.02, 0.02)), trim, -0.6, 1.18, 0.905);
  const chinVent = keep(new BoxGeometry(0.018, 0.12, 0.015));
  for (let i = 0; i < 22; i++) add(chinVent, dark, -1.45 + i * 0.055, 1.16, 0.91, false);
  const ledMonitor = add(ledGeometry, paint(new MeshStandardMaterial({ color: LED_OFF, emissive: LED_ON, emissiveIntensity: 0 })), 1.45, 1.18, 0.905, false);
  ledMonitor.rotation.x = Math.PI / 2;

  // the keyboard, tilted towards the typist, and its keys
  const board = new Group();
  board.position.set(0, 0.1, 3.5);
  board.rotation.x = 0.07;
  group.add(board);
  const deck = new Mesh(keep(new RoundedBoxGeometry(4.6, 0.18, 1.65, 2, 0.05)), body);
  deck.castShadow = true;
  deck.receiveShadow = true;
  board.add(deck);
  const layout = keyLayout();
  const keys = new InstancedMesh(keep(new RoundedBoxGeometry(1, 0.08, 0.18, 2, 0.02)), paint(plastic("#e9e4d6", 0.55)), layout.length);
  const m = new Matrix4();
  layout.forEach((k, i) => keys.setMatrixAt(i, m.makeScale(k.w, 1, 1).setPosition(k.x, 0.12, k.z)));
  keys.castShadow = true;
  board.add(keys);

  // the mouse, to the right
  add(keep(new RoundedBoxGeometry(0.55, 0.2, 0.9, 3, 0.09)), body, 3.15, 0.1, 3.5);
  add(keep(new BoxGeometry(0.46, 0.012, 0.016)), trim, 3.15, 0.2, 3.38, false);

  const leds = [ledCase, ledMonitor];
  return {
    group,
    screen: SCREEN,
    hole,
    leds,
    desk,
    setPower(on) {
      for (const led of leds) (led.material as MeshStandardMaterial).emissiveIntensity = on ? 2.4 : 0;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const mat of materials) mat.dispose();
    },
  };
}
