import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, type BufferGeometry, type Material } from "three";

/**
 * The room around the machine (2026-11-04, after c-na.dev's desk): the things an early-nineties desk
 * had on it — a stack of floppy disks, a mug, an anglepoise lamp — and two posters on the wall behind,
 * every one built from boxes and cylinders in this app's own colours. No picture, no logo and no
 * product of anybody's is drawn: the posters are this app's pixel "Q" and a Base-blue block print.
 *
 * Its own group, apart from the machine's: the scene's hit test reads the machine alone, so a click
 * on the lamp never switches the computer on. Units are the machine's (decimetres, desk at y = 0).
 */

export type Room = { readonly group: Group; dispose(): void };

/** Base blue, this app's accent. */
export const BASE_BLUE = "#0052ff";
/** The 7×7 pixel "Q" on the first poster — 1 is a lit cell. */
export const POSTER_Q: readonly string[] = ["0111110", "1100011", "1100011", "1100011", "1101011", "1100110", "0111101"];

export function buildRoom(): Room {
  const group = new Group();
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const keep = <G extends BufferGeometry>(g: G) => (geometries.push(g), g);
  const paint = (color: string, roughness = 0.6, emissive?: string) => {
    const m = new MeshStandardMaterial({ color, roughness, ...(emissive ? { emissive, emissiveIntensity: 1.6 } : {}) });
    materials.push(m);
    return m;
  };
  const add = (geometry: BufferGeometry, material: Material, x: number, y: number, z: number, parent: Group = group) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // floppy disks, three high, left of the keyboard — each with its metal shutter and label
  const disk = keep(new BoxGeometry(0.9, 0.032, 0.94));
  const shutter = keep(new BoxGeometry(0.42, 0.036, 0.3));
  const label = keep(new BoxGeometry(0.62, 0.036, 0.34));
  const metal = paint("#a9aeb6", 0.35);
  const paper = paint("#f1ede2", 0.8);
  ["#1b1c22", BASE_BLUE, "#d7d1c0"].forEach((color, i) => {
    const y = 0.016 + i * 0.034;
    const stack = new Group();
    stack.position.set(-3.45, y, 2.55);
    stack.rotation.y = 0.18 - i * 0.13;
    group.add(stack);
    add(disk, paint(color, 0.5), 0, 0, 0, stack);
    add(shutter, metal, 0.1, 0, -0.3, stack);
    add(label, paper, 0, 0, 0.22, stack);
  });

  // a mug, behind the disks: an open cylinder, so the coffee sits inside it rather than on a lid
  add(keep(new CylinderGeometry(0.26, 0.24, 0.55, 20, 1, true)), paint("#f1ede2", 0.4), -3.15, 0.275, 0.7);
  add(keep(new CylinderGeometry(0.235, 0.235, 0.02, 20)), paint("#3b2618", 0.3), -3.15, 0.45, 0.7);
  add(keep(new CylinderGeometry(0.24, 0.24, 0.02, 20)), paint("#f1ede2", 0.4), -3.15, 0.01, 0.7);

  // an anglepoise lamp, right and behind: a post, an arm reaching over the desk, a shade facing down
  const lamp = new Group();
  lamp.position.set(3.7, 0, -0.6);
  group.add(lamp);
  const enamel = paint("#1e2230", 0.45);
  add(keep(new CylinderGeometry(0.42, 0.48, 0.1, 24)), enamel, 0, 0.05, 0, lamp);
  add(keep(new BoxGeometry(0.09, 2.4, 0.09)), enamel, 0, 1.25, 0, lamp);
  add(keep(new BoxGeometry(1.4, 0.09, 0.09)), enamel, -0.66, 2.45, 0, lamp);
  add(keep(new CylinderGeometry(0.16, 0.42, 0.5, 20, 1, true)), enamel, -1.35, 2.22, 0, lamp);
  add(keep(new CylinderGeometry(0.1, 0.1, 0.1, 12)), paint("#fff1c4", 0.2, "#ffd98a"), -1.35, 2.05, 0, lamp);

  // two posters on the wall behind: the app's pixel Q, and a Base-blue block print
  const frame = keep(new BoxGeometry(2.1, 2.7, 0.06));
  const dark = paint("#14161d", 0.7);
  const cell = keep(new BoxGeometry(0.2, 0.2, 0.02));
  const poster = (x: number, y: number, tilt: number, fill: string) => {
    const p = new Group();
    p.position.set(x, y, -5.2);
    p.rotation.z = tilt;
    group.add(p);
    add(frame, dark, 0, 0, 0, p);
    add(keep(new BoxGeometry(1.86, 2.46, 0.02)), paint(fill, 0.85), 0, 0, 0.04, p);
    return p;
  };
  // low enough on the wall to sit inside the opening shot (MEASURED: at y 4.3 the frames were cut off)
  const q = poster(-3.4, 3.3, 0.02, "#e9e4d6");
  const lit = paint(BASE_BLUE, 0.6);
  POSTER_Q.forEach((row, r) =>
    [...row].forEach((c, col) => {
      if (c === "1") add(cell, lit, (col - 3) * 0.22, (3 - r) * 0.22 + 0.2, 0.06, q);
    }),
  );
  const print = poster(3.4, 3.5, -0.03, BASE_BLUE);
  const white = paint("#f4f6ff", 0.6);
  for (let i = 0; i < 4; i++) add(keep(new BoxGeometry(1.3 - i * 0.25, 0.14, 0.02)), white, 0, 0.7 - i * 0.32, 0.06, print);

  return {
    group,
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
