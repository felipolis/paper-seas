/**
 * The living sea: one large sheet that follows the focus, printed and animated in world space.
 *
 *   depth      deep and mid blues mottled like paper; a lighter shelf near land; three printed steps of shallow
 *              aqua toward every beach (shore distance from the DistanceMap texture)
 *   light net  a slow moving caustic net, strongest in the shallows
 *   shore      cream foam lines lapping in and out along the beaches, a dark waterline just off the sand
 *   marks      cream lens-shaped dashes drifting with the wind (gathering near coasts), now and then a ring
 *              spreading where a fish touched the surface
 *   fibre      the paper's own fibre over all of it
 *   mirror     the world mirrored in the water (sea/mirror.ts), rippled and tinted teal
 */
import * as THREE from 'three';
import { WATER_GLSL, waterUniforms } from './water';
import { FAR, type DistanceMap } from './distance-map';
import { MIRROR_APPLY, MIRROR_GLSL, mirrorUniforms } from './mirror';

const SIZE = 280;

/**
 * The sea's depth print, which the chart paints too (game/exploration.ts): the mid tone's noise edges; the lighter
 * shelf, the shore distances it fades out over and its strength; the wobble of the shallows' edges; their three steps,
 * each the shore distances it fades out over and its share; how far the steps go toward the shallow aqua.
 */
export const DEPTH_PRINT = {
  mid: [0.25, 0.7],
  shelf: [1.5, 7],
  shelfLight: 0.35,
  wobble: 0.35,
  steps: [
    [2.1, 2.25, 0.34],
    [1.2, 1.32, 0.33],
    [0.5, 0.6, 0.33],
  ],
  shallow: 0.85,
} as const;

// (printedSteps, water.ts, takes the steps as the three components of a vec3 each: a fourth would be dropped)
if (DEPTH_PRINT.steps.length !== 3) throw new Error('sea-surface: the depth print must have exactly three steps');

const f = (v: number): string => v.toFixed(3);
/** The shallows: the sum of the steps' shares less those dn has risen past (water.ts printedSteps). */
const vec = (k: number): string => `vec3(${DEPTH_PRINT.steps.map((s) => f(s[k])).join(', ')})`;
const STEPS_GLSL = `${f(DEPTH_PRINT.steps.reduce((sum, s) => sum + s[2], 0))} - printedSteps(dn, ${vec(0)}, ${vec(1)}, ${vec(2)})`;

const SEA_GLSL = /* glsl */ `
varying vec3 vSeaPos;
uniform sampler2D uDist;
uniform vec3 uDistInfo;      // origin x, origin z, size

float shoreDist(vec2 p) {
  vec2 uv = (p - uDistInfo.xy) / uDistInfo.z;
  // (open sea past the window's edge, eased in over its last 10 units so its edge never shows as a seam)
  float edge = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y)) * uDistInfo.z;
  if (edge <= 0.0) return ${FAR.toFixed(1)};
  // (read at its one level: after a return some pixels skip, the screen derivatives a filtered read takes its level
  // from are undefined)
  return mix(${FAR.toFixed(1)}, textureLod(uDist, uv, 0.0).r, smoothstep(0.0, 10.0, edge));
}

vec3 seaColour(vec2 p) {
  float T = uTime;
  // (never 0: smoothstep with equal edges is undefined and comes out NaN on some GPUs)
  float aa = max(max(fwidth(p.x), fwidth(p.y)) * 1.2, 1e-4);
  float d = shoreDist(p);
  // ---- depth tones ----
  float n = seaNoise(p * 0.045) * 0.55 + seaNoise(p * 0.13 + 7.3) * 0.3 + seaNoise(p * 0.5 + 1.1) * 0.15;
  vec3 col = mix(uSeaDeep, uSeaMid, smoothstep(${f(DEPTH_PRINT.mid[0])}, ${f(DEPTH_PRINT.mid[1])}, n));
  col = mix(col, uSeaLight, smoothstep(0.62, 0.9, n) * 0.5);
  float shelf = 1.0 - smoothstep(${f(DEPTH_PRINT.shelf[0])}, ${f(DEPTH_PRINT.shelf[1])}, d);
  col = mix(col, uSeaLight, shelf * ${f(DEPTH_PRINT.shelfLight)});
  // shallows: three printed steps with wobbling edges
  float dn = d + ${f(DEPTH_PRINT.wobble)} * (seaNoise(p * 0.9) - 0.5) + 0.2 * (seaNoise(p * 2.7 + 4.0) - 0.5);
  float steps = ${STEPS_GLSL};
  col = mix(col, uSeaShallow, steps * ${f(DEPTH_PRINT.shallow)});
  // ---- slow light net, strongest in the shallows ----
  col = waterLight(col, p, T, 0.05 + 0.1 * steps);
  // ---- drifting cream dashes (screen-horizontal, like cut paper), gathering toward the coasts ----
  vec2 q = vec2(p.x - uWind.x * T * 0.18, p.y - uWind.y * T * 0.06) / vec2(0.55, 0.16);
  vec2 id = floor(q);
  float h = seaHash(id + 1.7);
  vec2 c = (fract(q) - 0.5) * vec2(0.55, 0.16);
  c.x += (seaHash(id + 9.2) - 0.5) * 0.12;
  float near = 1.0 - smoothstep(0.5, 4.0, d);
  float dash = step(h, 0.03 + 0.18 * near) * seaLens(c, 0.12 + 0.08 * fract(h * 7.3), 0.012, aa) * (0.45 + 0.55 * (0.5 + 0.5 * sin(T * 0.8 + h * 40.0)));
  // ---- a ring now and then ----
  vec2 rg = p / 2.2;
  vec2 rid = floor(rg);
  float rh = seaHash(rid + 11.3);
  vec2 rc = (fract(rg) - 0.5) * 2.2 - (vec2(seaHash(rid + 5.1), seaHash(rid + 23.9)) - 0.5) * 1.2;
  float rt = fract(T * 0.13 + rh * 9.0);
  float rd = length(rc * vec2(1.0, 1.4));
  float ring = max(1.0 - smoothstep(0.008, 0.008 + aa, abs(rd - (0.04 + 0.32 * rt))), 0.7 * (1.0 - smoothstep(0.006, 0.006 + aa, abs(rd - (0.02 + 0.2 * rt)))));
  ring *= step(rh, 0.1) * (1.0 - rt) * smoothstep(0.0, 0.1, rt);
  col = mix(col, uSeaFoam, clamp(dash + ring * 0.8, 0.0, 1.0) * 0.85);
  // ---- shore: foam lines lapping in and out, a dark waterline right at the sand ----
  float lap = 0.5 + 0.5 * sin(T * 0.9 + seaNoise(p * 0.4) * 6.28);
  float fd1 = abs(dn - (0.12 + 0.28 * lap));
  float fd2 = abs(dn - (0.55 + 0.35 * fract(T * 0.11 + seaNoise(p * 0.3) * 3.0)));
  float broken = smoothstep(0.35, 0.65, seaNoise(p * 3.0 + vec2(T * 0.2, 0.0)));
  float foam = (1.0 - smoothstep(0.03, 0.03 + aa * 2.0, fd1)) * (0.55 + 0.45 * broken)
             + (1.0 - smoothstep(0.02, 0.02 + aa * 2.0, fd2)) * broken * 0.55 * (1.0 - smoothstep(0.4, 1.2, dn));
  col = mix(col, uSeaFoam, clamp(foam, 0.0, 1.0) * (1.0 - smoothstep(1.2, 1.6, d)));
  col = waterline(col, d, 0.14, 0.28);
  // ---- paper fibre ----
  col = waterFibre(col, p);
  // ---- mirror image ----
  mirrorImage(p, 0.0, col, 1.0 - clamp(dash + foam, 0.0, 1.0));
  return col;
}
`;

export class SeaSurface {
  readonly mesh: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;

  constructor() {
    const geometry = new THREE.PlaneGeometry(SIZE, SIZE, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    this.uniforms = {
      ...waterUniforms(),
      uDist: { value: null },
      uDistInfo: { value: new THREE.Vector3(0, 0, 1) },
      ...mirrorUniforms(),
    };
    const uniforms = this.uniforms;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSeaPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeaPos = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${WATER_GLSL}\n${MIRROR_GLSL}\n${SEA_GLSL}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= seaColour(vSeaPos.xz);
${MIRROR_APPLY.colour}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
${MIRROR_APPLY.emissive}`);
    };
    material.customProgramCacheKey = () => 'sea-v7';
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = -1;
  }

  /** Keeps the sheet centred under the focus (snapped, the print is in world space anyway). */
  follow(x: number, z: number): void {
    this.mesh.position.set(Math.round(x / 4) * 4, 0, Math.round(z / 4) * 4);
  }

  setDistanceMap(map: DistanceMap): void {
    this.uniforms.uDist.value = map.texture;
    (this.uniforms.uDistInfo.value as THREE.Vector3).set(map.origin.x, map.origin.y, map.size);
  }

  update(time: number): void {
    this.uniforms.uTime.value = time;
  }
}
