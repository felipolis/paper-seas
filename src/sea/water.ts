/**
 * What the sea and the streams share, so they are one water printed with the same terms: the palette, the paper
 * fibre, the clock, the wind and the sun as uniforms (one object each: the sea updates them, every water material
 * follows), and the GLSL helpers (hash, value noise, lens-shaped cut dashes).
 */
import * as THREE from 'three';
import { PALETTE } from '../config/palette';
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
    uWind: { value: new THREE.Vector2(0.35, -0.94).normalize() },
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
`;
