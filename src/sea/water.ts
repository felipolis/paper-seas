/**
 * What the sea, the streams and the ponds share, so they are one water printed with the same terms: the palette, the
 * paper fibre, the clock, the wind and the sun as uniforms (one object each: the sea updates them, every water material
 * follows), and the GLSL of the water itself: hash, value noise, lens-shaped cut dashes, the printed depth steps, the
 * slow light net, the waterline at the bank and the paper fibre through it all. Each water draws them with its own
 * colours and sizes (the sea's palette and shore distance, a stream's biome palette and its distance from the bank).
 */
import * as THREE from 'three';
import { PALETTE } from '../config/palette';
import { SEA_WIND } from '../config/world';
import { paperDetail } from '../art/paper-maps';

let shared: Record<string, THREE.IUniform> | null = null;

/** The uniforms every water material shares (created on first use, after the paper maps are loaded). */
export function waterUniforms(): Record<string, THREE.IUniform> {
  shared ??= {
    uSeaDeep: { value: new THREE.Color(PALETTE.seaDeep) },
    uSeaMid: { value: new THREE.Color(PALETTE.sea) },
    uSeaLight: { value: new THREE.Color(PALETTE.seaLight) },
    uSeaFoam: { value: new THREE.Color(PALETTE.foam) },
    uSeaShallow: { value: new THREE.Color(PALETTE.seaShallow) },
    uSeaFibre: { value: paperDetail() },
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(SEA_WIND.x, SEA_WIND.z) },
  };
  return shared;
}

export const WATER_GLSL = /* glsl */ `
uniform vec3 uSeaDeep;
uniform vec3 uSeaMid;
uniform vec3 uSeaLight;
uniform vec3 uSeaFoam;
uniform vec3 uSeaShallow;
uniform sampler2D uSeaFibre;
uniform float uTime;
uniform vec2 uWind;          // drift direction of the dashes (unit)

// Hash without sin(): sin of large arguments is evaluated differently from pixel to pixel on some GPUs (D3D).
float seaHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float seaNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(seaHash(i), seaHash(i + vec2(1.0, 0.0)), f.x), mix(seaHash(i + vec2(0.0, 1.0)), seaHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// lens-shaped cut dash centred at c: L = half length, th = half thickness in the middle
float seaLens(vec2 c, float L, float th, float aa) {
  float d = c.x / L;
  float k = max(1.0 - d * d, 0.0);
  return (1.0 - smoothstep(th * k - aa, th * k + aa, abs(c.y))) * smoothstep(0.0, 0.3, k);
}
// the paper fibre printed through the water
float seaFibre(vec2 p) {
  return texture2D(uSeaFibre, p * 0.5).r * 0.7 + texture2D(uSeaFibre, p * 0.19 + 0.37).r * 0.3;
}
// three printed depth steps: the share of each step x has risen past (each fading in between its two edges)
float printedSteps(float x, vec3 from, vec3 to, vec3 share) {
  return share.x * smoothstep(from.x, to.x, x) + share.y * smoothstep(from.y, to.y, x) + share.z * smoothstep(from.z, to.z, x);
}
// the slow light net drifting over the water, this strong
vec3 waterLight(vec3 col, vec2 p, float T, float strength) {
  float ca = sin(p.x * 3.1 + 1.4 * sin(p.y * 2.2 + T * 0.55)) * sin(p.y * 3.7 + 1.2 * sin(p.x * 2.6 - T * 0.4));
  return col * (1.0 + strength * (smoothstep(0.3, 0.95, ca) - 0.5 * smoothstep(0.3, 0.95, -ca)));
}
// the waterline: darker by dark at the bank (d = 0), gone width into the water
vec3 waterline(vec3 col, float d, float width, float dark) {
  return col * (1.0 - dark * (1.0 - smoothstep(0.0, width, d)));
}
// the paper fibre through the water
vec3 waterFibre(vec3 col, vec2 p) {
  return col * (1.0 + (seaFibre(p) - 0.5) * 1.1);
}
`;
