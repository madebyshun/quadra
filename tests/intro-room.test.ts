import { describe, expect, it, vi } from "vitest";
import { BoxGeometry, Mesh, MeshStandardMaterial } from "three";
import { BASE_BLUE, buildRoom, POSTER_Q } from "@/intro/room";

/** The things around the machine: built from boxes in the app's own colours, apart from what can be clicked. */
describe("the room around the machine", () => {
  it("draws the poster's Q from its own 7×7 grid, in Base blue", () => {
    expect(POSTER_Q).toHaveLength(7);
    for (const row of POSTER_Q) expect(row).toMatch(/^[01]{7}$/);
    const room = buildRoom();
    const meshes: Mesh[] = [];
    room.group.traverse((o) => o instanceof Mesh && meshes.push(o));
    const lit = POSTER_Q.join("").split("").filter((c) => c === "1").length;
    const blueCells = meshes.filter(
      (m) =>
        (m.material as MeshStandardMaterial).color.getHexString() === BASE_BLUE.slice(1) &&
        m.geometry instanceof BoxGeometry &&
        m.geometry.parameters.width === 0.2,
    );
    expect(blueCells).toHaveLength(lit);
    // nothing in the room sits below the desk, and everything casts and takes shadows
    for (const m of meshes) {
      expect(m.castShadow).toBe(true);
      expect(m.receiveShadow).toBe(true);
    }
  });

  it("gives back every geometry and material it made", () => {
    const room = buildRoom();
    const freed: string[] = [];
    room.group.traverse((o) => {
      if (o instanceof Mesh) {
        vi.spyOn(o.geometry, "dispose").mockImplementation(() => void freed.push("g"));
        vi.spyOn(o.material as never as { dispose(): void }, "dispose").mockImplementation(() => void freed.push("m"));
      }
    });
    room.dispose();
    expect(freed.filter((f) => f === "g").length).toBeGreaterThan(0);
    expect(freed.filter((f) => f === "m").length).toBeGreaterThan(0);
  });
});
