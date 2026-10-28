import { ACESFilmicToneMapping, PCFSoftShadowMap, PMREMGenerator, SRGBColorSpace, WebGLRenderer, type Texture } from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/**
 * The real WebGL renderer for the intro, and the soft studio light its plastic reflects
 * (`RoomEnvironment`, pre-filtered once). Transparent, so the page's own background and the
 * HTML screen behind the canvas show through (`scene.ts`).
 *
 * Throws where there is no GPU context — `start.ts` turns that into "no intro, straight to the
 * desktop", never a blank page.
 */
export function createGL(): { gl: WebGLRenderer; environment: Texture } {
  const gl = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  gl.outputColorSpace = SRGBColorSpace;
  gl.toneMapping = ACESFilmicToneMapping;
  gl.toneMappingExposure = 1.05;
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = PCFSoftShadowMap;
  gl.setClearColor(0x000000, 0);
  const pmrem = new PMREMGenerator(gl);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return { gl, environment };
}
