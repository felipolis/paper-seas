/**
 * The living sea: one large sheet that follows the focus, printed and animated in world space.
 *
 *   depth      deep and mid blues mottled like paper; a lighter shelf near land; three printed steps of shallow
 *              aqua toward every beach (shore distance from the DistanceMap texture)
 *   light net  a slow moving caustic net, strongest in the shallows
 *   shore      cream foam lines lapping in and out along the beaches, a dark waterline just off the sand
 *   marks      engraved swell marks, and cream lens-shaped dashes drifting with the wind (gathering near coasts),
 *              now and then a ring spreading where a fish touched the surface
 *   mirror     the world mirrored in the water (render/reflection.ts), rippled and tinted teal
 */
import * as THREE from 'three';
import { WATER_GLSL, waterUniforms } from './water';
import type { DistanceMap } from './distance-map';
import type { Reflection } from '../render/reflection';

const SIZE = 280;
/**
 * papertrails' mirror (config/world.js water.mirror there, render/water.js WATER_DEFAULTS.mirror): its sideways
 * ripple (world units), its strength, how far its image is tinted toward the water, its gain, and the gain of what is
 * brighter than paper.
 */
const MIRROR_DISTORT = '0.017';
const MIRROR_STRENGTH = '0.7';
const MIRROR_TINT = '0.6';
const MIRROR_GAIN = '0.88';
const MIRROR_HOT = '0.62';
/**
 * papertrails only ever shows its mirror on foot, the focus 10.8 from its camera; the ripple's wave trains and
 * displacement are sized for that framing. Seen from further (the ship's 18), the same world sizes would shrink to
 * ~5 px rows that read as scanlines, so they keep the size on screen they have in papertrails at its framing: they
 * grow with the camera's distance beyond MIRROR_FRAMING. The wave is laid out from an anchor that moves to the focus
 * whenever the size changes (keeping the wave where it was there), so a zoom stretches it about the middle of the
 * picture instead of sliding it by the world's far-off coordinates; at a steady size it stays put in the world.
 */
const MIRROR_FRAMING = 10.8;
/** The wave's frequencies are multiples of 2 pi / MIRROR_WRAP (papertrails' WKF), so its offset wraps there exactly. */
const MIRROR_WRAP = 256;

const SEA_GLSL = /* glsl */ `
varying vec3 vSeaPos;
uniform sampler2D uDist;
uniform vec3 uDistInfo;      // origin x, origin z, size
uniform sampler2D uRefl;
uniform mat4 uReflMatrix;
uniform float uReflOn;
uniform float uReflScale;    // the ripple's size relative to papertrails' (its framing / ours, at least 1)
uniform vec4 uReflAnchor;    // the wave laid out as (p - xy) / uReflScale + zw
vec3 gSeaMirror;
float gSeaMirrorW;

float shoreDist(vec2 p) {
  vec2 uv = (p - uDistInfo.xy) / uDistInfo.z;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 12.0;
  return texture2D(uDist, uv).r;
}

vec3 seaColour(vec2 p) {
  float T = uTime;
  // (never 0: smoothstep with equal edges is undefined and comes out NaN on some GPUs)
  float aa = max(fwidth(p.x) * 1.2, 1e-4);
  float d = shoreDist(p);
  // ---- depth tones ----
  float n = seaNoise(p * 0.045) * 0.55 + seaNoise(p * 0.13 + 7.3) * 0.3 + seaNoise(p * 0.5 + 1.1) * 0.15;
  vec3 col = mix(uSeaDeep, uSeaMid, smoothstep(0.25, 0.7, n));
  col = mix(col, uSeaLight, smoothstep(0.62, 0.9, n) * 0.5);
  float shelf = 1.0 - smoothstep(1.5, 7.0, d);
  col = mix(col, uSeaLight, shelf * 0.35);
  // shallows: three printed steps with wobbling edges
  float dn = d + 0.35 * (seaNoise(p * 0.9) - 0.5) + 0.2 * (seaNoise(p * 2.7 + 4.0) - 0.5);
  float steps = 0.34 * (1.0 - smoothstep(2.1, 2.25, dn)) + 0.33 * (1.0 - smoothstep(1.2, 1.32, dn)) + 0.33 * (1.0 - smoothstep(0.5, 0.6, dn));
  col = mix(col, uSeaShallow, steps * 0.85);
  // ---- slow light net, strongest in the shallows ----
  float ca = sin(p.x * 3.1 + 1.4 * sin(p.y * 2.2 + T * 0.55)) * sin(p.y * 3.7 + 1.2 * sin(p.x * 2.6 - T * 0.4));
  col *= 1.0 + (0.05 + 0.1 * steps) * (smoothstep(0.3, 0.95, ca) - 0.5 * smoothstep(0.3, 0.95, -ca));
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
  col *= 1.0 - 0.28 * (1.0 - smoothstep(0.0, 0.14, d));
  // ---- paper fibre ----
  col *= 1.0 + (seaFibre(p) - 0.5) * 1.1;
  // ---- mirror image ----
  gSeaMirror = vec3(0.0);
  gSeaMirrorW = 0.0;
  if (uReflOn > 0.5) {
    // papertrails' real mirror (render/water.js there): the image sways sideways on its broad wave train (period 0.15
    // units, its WKF(1700)), MIRROR_DISTORT units at most, uReflScale larger so it is the size on screen it is in
    // papertrails at its framing. Its finer train (WKF(4100), which also dimmed the image in bands) is left out: over a
    // dark hull on our paler sea it split the image into rows with water showing between them, stripes papertrails'
    // mid-tone pieces over deep teal never show
    vec2 rp = (p - uReflAnchor.xy) / uReflScale + uReflAnchor.zw;
    float w1 = sin(rp.y * 41.72 + T * 1.5 + 1.8 * sin(rp.x * 6.381 + T * 0.45));
    vec4 rc4 = uReflMatrix * vec4(p.x + w1 * ${MIRROR_DISTORT} * uReflScale, 0.0, p.y, 1.0);
    vec4 m = texture2D(uRefl, rc4.xy / rc4.w);
    float cover = clamp(m.a, 0.0, 1.0) * (1.0 - clamp(dash + foam, 0.0, 1.0));
    // its colour: the image tinted MIRROR_TINT of the way to the water under it and a little darker (MIRROR_GAIN);
    // what is brighter than paper (lit panes, lanterns) stays bright and untinted (MIRROR_HOT), and always shows
    vec3 rcol = m.rgb / max(m.a, 0.05);
    vec3 rtint = mix(vec3(1.0), col / max(max(col.r, max(col.g, col.b)), 0.05), ${MIRROR_TINT});
    float rhot = smoothstep(0.9, 2.2, max(rcol.r, max(rcol.g, rcol.b)));
    gSeaMirror = rcol * mix(rtint * ${MIRROR_GAIN}, vec3(${MIRROR_HOT}), rhot);
    gSeaMirrorW = max(cover * ${MIRROR_STRENGTH}, rhot * cover);
  }
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
      uRefl: { value: null },
      uReflMatrix: { value: new THREE.Matrix4() },
      uReflOn: { value: 0 },
      uReflScale: { value: 1 },
      uReflAnchor: { value: new THREE.Vector4(0, 0, 0, 0) },
    };
    const uniforms = this.uniforms;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSeaPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeaPos = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${WATER_GLSL}\n${SEA_GLSL}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= seaColour(vSeaPos.xz);
// the mirror replaces part of the diffuse paper (it already carries its own light)
diffuseColor.rgb *= 1.0 - gSeaMirrorW;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += gSeaMirror * gSeaMirrorW;`);
    };
    material.customProgramCacheKey = () => 'sea-v4';
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

  setReflection(r: Reflection | null): void {
    this.uniforms.uReflOn.value = r ? 1 : 0;
    if (r) {
      this.uniforms.uRefl.value = r.target.texture;
      (this.uniforms.uReflMatrix.value as THREE.Matrix4).copy(r.matrix);
    }
  }

  /**
   * cameraDistance: how far the camera stands from its focus (fx, fz): the mirror's ripple keeps papertrails' size on
   * screen, re-anchored at the focus when that size changes (see MIRROR_FRAMING).
   */
  update(time: number, cameraDistance: number, fx: number, fz: number): void {
    this.uniforms.uTime.value = time;
    const scale = Math.max(1, cameraDistance / MIRROR_FRAMING);
    const u = this.uniforms.uReflScale;
    if (scale !== u.value) {
      // the wave at the focus stays where it is: (f - a) / old + o, re-laid from the focus
      const a = this.uniforms.uReflAnchor.value as THREE.Vector4;
      const wrap = (v: number) => v - MIRROR_WRAP * Math.floor(v / MIRROR_WRAP);
      a.set(fx, fz, wrap((fx - a.x) / u.value + a.z), wrap((fz - a.y) / u.value + a.w));
      u.value = scale;
    }
  }
}
