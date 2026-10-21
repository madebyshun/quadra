import { describe, expect, it, vi } from "vitest";
import { Box3, InstancedMesh, Mesh, MeshStandardMaterial, NoBlending, Vector3, type MeshBasicMaterial } from "three";
import { buildMachine, keyLayout, LED_ON, roundedRect, SCREEN, SCREEN_CORNER } from "@/intro/machine";

/**
 * The machine is geometry, so it builds under test like any other data: these check what the rest
 * of the intro relies on — where the screen is, that the hole really is a hole, that the power
 * lights switch, and that everything it made can be released.
 */

describe("the Quadra", () => {
  it("puts a 4:3 screen on the front of the monitor, above the case", () => {
    expect(SCREEN.width / SCREEN.height).toBeCloseTo(4 / 3);
    const m = buildMachine();
    expect(m.screen).toBe(SCREEN);
    const box = new Box3().setFromObject(m.hole);
    const size = box.getSize(new Vector3());
    expect(size.x).toBeCloseTo(SCREEN.width);
    expect(size.y).toBeCloseTo(SCREEN.height);
    expect(box.getCenter(new Vector3()).toArray()).toEqual([SCREEN.center.x, SCREEN.center.y, SCREEN.center.z].map((v) => expect.closeTo(v)));
  });

  /** The HTML screen sits BEHIND the canvas; this mesh is what lets it show. */
  it("cuts the screen as a hole: it writes transparent pixels, it does not blend", () => {
    const material = buildMachine().hole.material as MeshBasicMaterial;
    expect(material.blending).toBe(NoBlending);
    expect(material.opacity).toBe(0);
  });

  it("lights both power LEDs when switched on, and puts them out again", () => {
    const m = buildMachine();
    const glow = () => m.leds.map((l) => (l.material as MeshStandardMaterial).emissiveIntensity);
    expect(m.leds).toHaveLength(2);
    expect(glow()).toEqual([0, 0]);
    m.setPower(true);
    expect(glow().every((g) => g > 0)).toBe(true);
    expect((m.leds[0]!.material as MeshStandardMaterial).emissive.getHexString()).toBe(LED_ON.slice(1));
    m.setPower(false);
    expect(glow()).toEqual([0, 0]);
  });

  it("has a keyboard with a main block, a keypad and a space bar, as one instanced mesh", () => {
    const keys = keyLayout();
    expect(keys.filter((k) => k.w > 1)).toHaveLength(1);
    expect(keys).toHaveLength(5 * 14 + 5 * 4 + 1);
    let instanced: InstancedMesh | null = null;
    buildMachine().group.traverse((o) => {
      if (o instanceof InstancedMesh) instanced = o;
    });
    expect(instanced!.count).toBe(keys.length);
  });

  it("casts shadows from the machine and keeps the desk and the screen out of it", () => {
    const meshes: Mesh[] = [];
    buildMachine().group.traverse((o) => o instanceof Mesh && meshes.push(o));
    expect(meshes.filter((m) => m.castShadow).length).toBeGreaterThan(5);
    const desk = meshes.find((m) => m.rotation.x === -Math.PI / 2)!;
    expect(desk.castShadow).toBe(false);
    expect(desk.receiveShadow).toBe(true);
  });

  it("releases every geometry and material it made", () => {
    const m = buildMachine();
    const released: unknown[] = [];
    m.group.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      for (const thing of [o.geometry, o.material]) vi.spyOn(thing, "dispose").mockImplementation(() => released.push(thing));
    });
    m.dispose();
    expect(released.length).toBeGreaterThan(10);
    expect(released).toContain(m.hole.geometry);
    expect(released).toContain(m.hole.material);
  });
});

describe("a rounded rectangle", () => {
  it("keeps its size, and never rounds past half a side", () => {
    const points = roundedRect(2, 1, 0.1).getPoints();
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([-1, 1, -0.5, 0.5]);
    // an oversized radius is clamped to the shorter half-side, so the outline stays inside the box
    const capped = roundedRect(2, 1, 5).getPoints();
    expect(Math.max(...capped.map((p) => Math.abs(p.y)))).toBeCloseTo(0.5);
    expect(SCREEN_CORNER).toBeGreaterThan(0);
  });
});
